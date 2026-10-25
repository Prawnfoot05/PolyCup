-- Local queue/formation stage. Disabled until ranked drafting/racing is connected.
begin;
create table public.polycup_queue_config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 version text not null default '0.4.0-dev.1',
 catalog jsonb,
 three_after integer not null default 60 check(three_after between 1 and 3600),
 two_after integer not null default 120 check(two_after between 1 and 3600),
 unrestricted_after integer not null default 300 check(unrestricted_after between 1 and 7200),
 initial_tolerance double precision not null default 6 check(initial_tolerance>0 and initial_tolerance<1000),
 widen_per_second double precision not null default .1 check(widen_per_second>0 and widen_per_second<10),
 accept_seconds integer not null default 30 check(accept_seconds between 10 and 120),
 check(two_after>=three_after), check(unrestricted_after>=two_after),
 check(not enabled or (catalog is not null and jsonb_typeof(catalog)='array' and jsonb_array_length(catalog)>=16))
);
insert into public.polycup_queue_config default values;
create table public.polycup_ranked_queue (
 player_id uuid primary key references public.profiles(id) on delete cascade,
 instance_id uuid not null,
 joined_at timestamptz not null default now(),
 seen_at timestamptz not null default now(),
 skill double precision not null,
 version text not null
);
create index polycup_ranked_queue_age on public.polycup_ranked_queue(joined_at,player_id);
alter table public.polycup_queue_config enable row level security;
alter table public.polycup_ranked_queue enable row level security;
revoke all on public.polycup_queue_config,public.polycup_ranked_queue from public,anon,authenticated;
grant all on public.polycup_queue_config,public.polycup_ranked_queue to service_role;

-- All reservation paths share the queue lock before taking account locks. This
-- preserves the lock order when a future service worker also forms matches.
alter function public.polycup_ranked_reserve(uuid,uuid[],jsonb) rename to polycup_ranked_reserve_internal;
revoke all on function public.polycup_ranked_reserve_internal(uuid,uuid[],jsonb) from public,anon,authenticated,service_role;
create function public.polycup_ranked_reserve(match_key uuid,players uuid[],pool jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(777,1);
 return public.polycup_ranked_reserve_internal(match_key,players,pool);
end $$;
revoke all on function public.polycup_ranked_reserve(uuid,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.polycup_ranked_reserve(uuid,uuid[],jsonb) to service_role;

create function public.polycup_queue_tolerance(joined timestamptz,c public.polycup_queue_config)
returns double precision language sql stable set search_path='' as $$
 select case when extract(epoch from now()-joined)>=c.unrestricted_after then 'Infinity'::double precision
 else c.initial_tolerance+greatest(0,extract(epoch from now()-joined))*c.widen_per_second end
$$;
revoke all on function public.polycup_queue_tolerance(timestamptz,public.polycup_queue_config) from public,anon,authenticated;

-- Fixed, bounded matchmaking procedure. Players cannot nominate peers, a host,
-- skill, match size, catalog or a match ID. Polling only requests a server tick.
create function public.polycup_queue_tick()
returns void language plpgsql security definer set search_path='' as $$
declare c public.polycup_queue_config%rowtype; anchor public.polycup_ranked_queue%rowtype;
 candidate public.polycup_ranked_queue%rowtype; selected uuid[]; match_key uuid; oldest timestamptz; formations integer:=0;
begin
 perform pg_advisory_xact_lock(777,1);
 perform public.polycup_ranked_expire();
 select * into c from public.polycup_queue_config where singleton;
 delete from public.polycup_ranked_queue q where q.seen_at<=now()-interval '35 seconds'
   or q.version<>c.version or exists(select 1 from public.polycup_ranked_claims where player_id=q.player_id)
   or exists(select 1 from public.polycup_room_members m join public.polycup_rooms r on r.id=m.room
      where m.actor=q.player_id and r.seen_at>now()-interval '90 seconds');
 if not c.enabled or not (select enabled from public.polycup_ranked_config where singleton) then
   delete from public.polycup_ranked_queue; return;
 end if;
 for anchor in select * from public.polycup_ranked_queue order by joined_at,player_id limit 100 loop
   if not exists(select 1 from public.polycup_ranked_queue where player_id=anchor.player_id) then continue; end if;
   selected:=array[anchor.player_id];
   for candidate in select * from public.polycup_ranked_queue where player_id<>anchor.player_id order by joined_at,player_id limit 100 loop
     if not exists(select 1 from public.polycup_ranked_queue q where q.player_id=any(selected)
       and abs(q.skill-candidate.skill)>least(public.polycup_queue_tolerance(q.joined_at,c),public.polycup_queue_tolerance(candidate.joined_at,c))) then
       selected:=array_append(selected,candidate.player_id);
       if cardinality(selected)=4 then exit; end if;
     end if;
   end loop;
   -- Every chosen player must have waited for a reduced-size match. Do not drag
   -- a new arrival straight into a duel because somebody else waited longer.
   if cardinality(selected)<4 then
     select array_agg(player_id order by joined_at,player_id) into selected
       from public.polycup_ranked_queue where player_id=any(selected)
       and joined_at<=now()-make_interval(secs=>c.three_after);
     if coalesce(cardinality(selected),0)<3 then
       select array_agg(player_id order by joined_at,player_id) into selected
         from public.polycup_ranked_queue where player_id=any(selected)
         and joined_at<=now()-make_interval(secs=>c.two_after);
     end if;
   end if;
   if coalesce(cardinality(selected),0)<2 then continue; end if;
   match_key:=gen_random_uuid();
   perform public.polycup_ranked_reserve(match_key,selected,c.catalog);
   update public.polycup_ranked_members m set instance_id=q.instance_id,seen_at=q.seen_at
     from public.polycup_ranked_queue q where m.match_id=match_key and m.player_id=q.player_id;
   update public.polycup_ranked_matches set deadline=now()+make_interval(secs=>c.accept_seconds) where id=match_key;
   delete from public.polycup_ranked_queue where player_id=any(selected);
   formations:=formations+1;
   if formations>=8 then exit; end if;
 end loop;
end $$;
revoke all on function public.polycup_queue_tick() from public,anon,authenticated;
grant execute on function public.polycup_queue_tick() to service_role;

create function public.polycup_queue_info()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',c.enabled and r.enabled,'version',c.version,
   'waiting',(select count(*) from public.polycup_ranked_queue where seen_at>now()-interval '35 seconds' and version=c.version),
   'three_after',c.three_after,'two_after',c.two_after)
 from public.polycup_queue_config c cross join public.polycup_ranked_config r where c.singleton and r.singleton
$$;
revoke all on function public.polycup_queue_info() from public;
grant execute on function public.polycup_queue_info() to anon,authenticated,service_role;

create function public.polycup_queue(action text,instance_key uuid,client_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); c public.polycup_queue_config%rowtype;
 q public.polycup_ranked_queue%rowtype; m public.polycup_ranked_matches%rowtype;
 member public.polycup_ranked_members%rowtype; current_match uuid; data jsonb; skill_value double precision;
begin
 if who is null or not exists(select 1 from auth.users where id=who and not coalesce(is_anonymous,true)) then raise exception 'Sign in with Discord to play ranked.'; end if;
 if instance_key is null or action is null or action not in ('join','poll','cancel','accept','decline','leave-match') then raise exception 'Invalid queue request.'; end if;
 perform pg_advisory_xact_lock(777,1);
 perform public.polycup_ranked_expire();
 select * into c from public.polycup_queue_config where singleton;
 delete from public.polycup_ranked_queue where seen_at<=now()-interval '35 seconds';
 select match_id into current_match from public.polycup_ranked_claims where player_id=who;
 if current_match is not null then
   -- Instance fencing and heartbeat are exactly the same as direct reconnects.
   perform public.polycup_ranked_member(current_match,instance_key,'poll');
   select * into m from public.polycup_ranked_matches where id=current_match for update;
   if action in ('cancel','decline','leave-match') then
     if m.started_at is not null then raise exception 'Your ranked Cup is still in progress. Reconnect to it.'; end if;
     perform public.polycup_ranked_advance(current_match,'cancel');
     current_match:=null;
   elsif action='accept' then
     if m.status='reserved' then perform public.polycup_ranked_member(current_match,instance_key,'accept'); end if;
   end if;
   if current_match is not null and (select status from public.polycup_ranked_matches where id=current_match)='reserved'
     and not exists(select 1 from public.polycup_ranked_members where match_id=current_match and not accepted) then
     perform public.polycup_ranked_advance(current_match,'draft');
   end if;
 else
   select * into q from public.polycup_ranked_queue where player_id=who;
   if q.player_id is not null and q.instance_id<>instance_key then raise exception 'Ranked is open in another window.'; end if;
   if action in ('cancel','decline','leave-match') then delete from public.polycup_ranked_queue where player_id=who;
   elsif action='join' then
     if not c.enabled or not (select enabled from public.polycup_ranked_config where singleton) then raise exception 'Ranked is not available yet.'; end if;
     if client_version is distinct from c.version then raise exception 'Update PolyCup to play ranked.'; end if;
     perform pg_advisory_xact_lock(hashtextextended(who::text,774));
     if exists(select 1 from public.polycup_room_members p join public.polycup_rooms r on r.id=p.room
       where p.actor=who and r.seen_at>now()-interval '90 seconds') then raise exception 'Leave your current Cup before joining ranked.'; end if;
     select (state->>'mu')::double precision into skill_value from public.polycup_rating_state where player_id=who;
     insert into public.polycup_ranked_queue(player_id,instance_id,skill,version)
       values(who,instance_key,coalesce(skill_value,25),client_version)
       on conflict(player_id) do update set seen_at=now();
   elsif action='poll' and q.player_id is not null then
     update public.polycup_ranked_queue set seen_at=now() where player_id=who and seen_at<now()-interval '10 seconds';
   end if;
 end if;
 -- After cancel/decline, tick other waiting players but never silently requeue
 -- cancelled participants. A late cancel after formation cancels the reservation.
 perform public.polycup_queue_tick();
 select match_id into current_match from public.polycup_ranked_claims where player_id=who;
 data:=public.polycup_queue_info();
 if current_match is not null then
   select * into m from public.polycup_ranked_matches where id=current_match;
   return data||jsonb_build_object('state','matched','match',jsonb_build_object('id',m.id,'status',m.status,
     'deadline',m.deadline,'rules',m.rules,'self',who,'can_leave',m.started_at is null,
     'players',(select jsonb_agg(jsonb_build_object('id',p.player_id,'name',u.display_name,'accepted',p.accepted,
       'online',p.seen_at>now()-interval '35 seconds') order by array_position(m.roster,p.player_id))
       from public.polycup_ranked_members p join public.profiles u on u.id=p.player_id where p.match_id=m.id)));
 end if;
 select * into q from public.polycup_ranked_queue where player_id=who;
 return data||jsonb_build_object('state',case when q.player_id is null then 'idle' else 'queued' end,
   'joined_at',q.joined_at,'server_time',now());
end $$;
revoke all on function public.polycup_queue(text,uuid,text) from public,anon;
grant execute on function public.polycup_queue(text,uuid,text) to authenticated;

-- Queue and custom-Cup admission cannot race each other. Do not silently cancel
-- matchmaking merely because a user clicked a public listing.
alter function public.polycup_room(text,uuid,uuid,jsonb) rename to polycup_room_ranked_guard;
revoke all on function public.polycup_room_ranked_guard(text,uuid,uuid,jsonb) from public,anon,authenticated;
create function public.polycup_room(op text,room_key uuid,instance_key uuid,args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if op in ('create','join') then
   perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,774));
   if exists(select 1 from public.polycup_ranked_queue where player_id=auth.uid() and seen_at>now()-interval '35 seconds') then
     raise exception 'Leave the ranked queue before joining another Cup.';
   end if;
 end if;
 return public.polycup_room_ranked_guard(op,room_key,instance_key,args);
end $$;
revoke all on function public.polycup_room(text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.polycup_room(text,uuid,uuid,jsonb) to authenticated;
commit;
