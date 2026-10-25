begin;

-- Unranked, host-controlled setup. No client can write ratings through this API.
create table public.polycup_rooms (
  id uuid primary key,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  host_user uuid not null references auth.users(id) on delete cascade,
  host_instance uuid not null,
  version text not null,
  revision bigint not null default 1,
  next_member_id integer not null default 2,
  data jsonb not null,
  blocked uuid[] not null default '{}',
  seen_at timestamptz not null default now()
);
create table public.polycup_room_members (
  room uuid not null references public.polycup_rooms(id) on delete cascade,
  actor uuid not null references auth.users(id) on delete cascade,
  instance uuid not null,
  member_id integer not null,
  name text not null,
  country text,
  style text,
  ticket uuid not null default gen_random_uuid(),
  native_id integer,
  launch_id text,
  seen_at timestamptz not null default now(),
  primary key(room,actor), unique(room,member_id)
);
create table public.polycup_room_events (
  seq bigint generated always as identity primary key,
  room uuid not null references public.polycup_rooms(id) on delete cascade,
  actor uuid not null,
  member_id integer not null,
  request uuid not null,
  kind text not null,
  value jsonb,
  done boolean not null default false,
  error text,
  created_at timestamptz not null default now(),
  unique(room,actor,request)
);
create index polycup_room_events_pending on public.polycup_room_events(room,seq) where not done;
alter table public.polycup_rooms enable row level security;
alter table public.polycup_room_members enable row level security;
alter table public.polycup_room_events enable row level security;
revoke all on public.polycup_rooms,public.polycup_room_members,public.polycup_room_events from public,anon,authenticated;

create function public.polycup_room_directory()
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(row),'[]'::jsonb) from (
  select r.id, r.data->'cup'->>'name' title, r.version,
    coalesce(r.data->'launch'->>'stage',r.data->'cup'->'draft'->>'stage','roster') phase,
    (select m.name from public.polycup_room_members m where m.room=r.id and m.actor=r.host_user) host_name,
    (select count(*) from public.polycup_room_members m where m.room=r.id and m.seen_at>now()-interval '35 seconds') players
  from public.polycup_rooms r
  where r.seen_at>now()-interval '90 seconds' and r.data->>'public'='true'
    and coalesce(r.data->'launch'->>'stage','') <> 'connecting'
  order by r.seen_at desc limit 100
 ) row
$$;
revoke all on function public.polycup_room_directory() from public;
grant execute on function public.polycup_room_directory() to anon,authenticated;

create function public.polycup_room(op text, room_key uuid, instance_key uuid, args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 who uuid := auth.uid();
 r public.polycup_rooms%rowtype;
 m public.polycup_room_members%rowtype;
 is_host boolean;
 n integer;
 item jsonb;
 next_data jsonb;
 old_stage text;
 new_stage text;
 result jsonb;
begin
 if who is null then raise exception 'A guest session is required.'; end if;
 if instance_key is null or room_key is null or args is null or octet_length(args::text)>25000000 then raise exception 'Invalid room request.'; end if;
 if op='create' then
  perform pg_advisory_xact_lock(hashtextextended(who::text,774));
  delete from public.polycup_rooms where seen_at<now()-interval '1 day';
  if exists(select 1 from public.polycup_rooms where host_user=who and seen_at>now()-interval '90 seconds' and id<>room_key) then raise exception 'You already host a waiting room.'; end if;
  next_data:=args->'data';
  if next_data->'cup'->>'id' is distinct from room_key::text or next_data->'cup'->>'phase' is distinct from 'registration'
    or next_data->'cup'->'draft'->>'stage' is distinct from 'roster'
    or jsonb_array_length(next_data->'cup'->'roster')<>0
    or length(args->>'version') not between 1 and 40
    or length(btrim(args->>'name')) not between 1 and 64 then raise exception 'Invalid room setup.'; end if;
  insert into public.polycup_rooms(id,host_user,host_instance,version,data)
    values(room_key,who,instance_key,args->>'version',next_data) on conflict(id) do nothing;
  select * into r from public.polycup_rooms where id=room_key for update;
  if r.host_user<>who or r.host_instance<>instance_key then raise exception 'Room already exists.'; end if;
  insert into public.polycup_room_members(room,actor,instance,member_id,name,country,style)
    values(room_key,who,instance_key,1,btrim(args->>'name'),case when args->>'country' ~ '^[a-z]{2}$' then args->>'country' end,left(args->>'style',1024))
    on conflict(room,actor) do nothing;
 else
  select * into r from public.polycup_rooms where id=room_key for update;
  if not found or r.seen_at<now()-interval '90 seconds' then raise exception 'This waiting room is no longer available.'; end if;
 end if;
 is_host:=r.host_user=who and r.host_instance=instance_key;
 select * into m from public.polycup_room_members where room=room_key and actor=who;
 if op='join' then
  if who=any(r.blocked) then raise exception 'You were removed from this room.'; end if;
  if r.version is distinct from args->>'version' then raise exception 'Update PolyCup to join this room.'; end if;
  if not found then
   if r.data->>'public' is distinct from 'true' and r.code is distinct from upper(args->>'code') then raise exception 'This room is private. Use its room code.'; end if;
   if coalesce(r.data->'launch'->>'stage','') = 'connecting' then raise exception 'This Cup is starting. Try again later.'; end if;
   if length(btrim(args->>'name')) not between 1 and 64 then raise exception 'Enter a player name.'; end if;
   select count(*) into n from public.polycup_room_members where room=room_key;
   if n>=16 then raise exception 'This waiting room is full.'; end if;
   n:=r.next_member_id;
   insert into public.polycup_room_members(room,actor,instance,member_id,name,country,style)
     values(room_key,who,instance_key,n,btrim(args->>'name'),case when args->>'country' ~ '^[a-z]{2}$' then args->>'country' end,left(args->>'style',1024));
   update public.polycup_rooms set revision=revision+1,next_member_id=next_member_id+1 where id=room_key returning * into r;
  elsif m.instance<>instance_key then
   if m.seen_at>now()-interval '35 seconds' then raise exception 'This player is already in the room in another window.'; end if;
   update public.polycup_room_members set instance=instance_key,ticket=gen_random_uuid(),native_id=null,launch_id=null where room=room_key and actor=who;
   if r.host_user=who then update public.polycup_rooms set host_instance=instance_key where id=room_key returning * into r; is_host:=true; end if;
  end if;
  select * into m from public.polycup_room_members where room=room_key and actor=who;
 end if;
 if m.actor is null or m.instance<>instance_key then raise exception 'Join this waiting room first.'; end if;
 update public.polycup_room_members set seen_at=now() where room=room_key and actor=who and seen_at<now()-interval '10 seconds';
 if is_host then update public.polycup_rooms set seen_at=now() where id=room_key and seen_at<now()-interval '10 seconds'; end if;
 if op='leave' then
  if is_host then delete from public.polycup_rooms where id=room_key;
  else
   delete from public.polycup_room_members where room=room_key and actor=who;
   update public.polycup_rooms set revision=revision+1 where id=room_key;
  end if;
  return null;
 elsif op='event' then
  if args->>'kind' not in ('join','leave','draft-ready','remove-pick','ban','pick','custom','preset','reopen','begin','public','mute','remove-racer','start','cancel','chat') then raise exception 'Unknown room action.'; end if;
  if args->>'kind' in ('preset','reopen','begin','public','mute','remove-racer','start','cancel') and not is_host then raise exception 'Only the host can do that.'; end if;
  if args->>'kind'='cancel' and r.data->'launch'->>'stage'='racing' then raise exception 'The Cup has already started.'; end if;
  if octet_length((args->'value')::text)>2100000 then raise exception 'Action is too large.'; end if;
  if not exists(select 1 from public.polycup_room_events where room=room_key and actor=who and request=(args->>'request')::uuid) then
   if (select count(*) from public.polycup_room_events where room=room_key and actor=who and created_at>now()-interval '10 seconds')>=25 then raise exception 'Slow down and try again.'; end if;
   if (select count(*) from public.polycup_room_events where room=room_key and not done)>=100 then raise exception 'The host is catching up. Try again shortly.'; end if;
   insert into public.polycup_room_events(room,actor,member_id,request,kind,value) values(room_key,who,m.member_id,(args->>'request')::uuid,args->>'kind',args->'value');
   -- A queued edit must invalidate an in-flight start commit immediately.
   update public.polycup_rooms set revision=revision+1 where id=room_key returning * into r;
  end if;
 elsif op='commit' then
  if not is_host then raise exception 'Only the host can commit setup.'; end if;
  if r.revision<>(args->>'revision')::bigint then raise exception using errcode='40001',message='Room changed; retry.'; end if;
  next_data:=args->'data';
  if next_data->'cup'->>'id' is distinct from room_key::text or next_data->'cup'->>'phase' is distinct from 'registration'
    or jsonb_typeof(next_data->'chat') is distinct from 'array' or jsonb_array_length(next_data->'chat')>200
    or jsonb_typeof(next_data->'public') is distinct from 'boolean' then raise exception 'Invalid room snapshot.'; end if;
  for item in select value from jsonb_array_elements(coalesce(args->'results','[]')) loop
   update public.polycup_room_events set done=true,error=left(item->>'error',200) where room=room_key and seq=(item->>'seq')::bigint;
  end loop;
  old_stage:=coalesce(r.data->'launch'->>'stage',''); new_stage:=coalesce(next_data->'launch'->>'stage','');
  if new_stage='connecting' and old_stage='grace' then
   if exists(select 1 from public.polycup_room_events where room=room_key and not done)
      or (r.data->'launch'->>'at')::bigint > extract(epoch from clock_timestamp())*1000 then raise exception 'Ready-up grace period is still active.'; end if;
  end if;
  if new_stage='racing' and old_stage<>'racing' then
   if old_stage<>'connecting' or exists(
     select 1 from jsonb_array_elements(next_data->'cup'->'roster') racer where not exists(
       select 1 from public.polycup_room_members p where p.room=room_key and p.member_id=(racer->>'id')::int
       and p.native_id is not null and p.launch_id=next_data->'launch'->>'id' and p.seen_at>now()-interval '35 seconds'))
     then raise exception 'Every racer must connect before racing.'; end if;
  end if;
  if next_data->'launch'->>'id' is distinct from r.data->'launch'->>'id' then
    update public.polycup_room_members set native_id=null,launch_id=null where room=room_key;
  end if;
  -- Track exports are transferred to the host once, not fanned out on every UI update.
  next_data:=jsonb_set(next_data,'{codes}',coalesce((
    select jsonb_object_agg(key,value) from jsonb_each(coalesce(r.data->'codes','{}') || coalesce(next_data->'codes','{}')) c
    where exists(select 1 from jsonb_array_elements(next_data->'cup'->'tracks') t where t->>'id'=c.key)
  ),'{}'));
  update public.polycup_rooms set data=next_data,revision=revision+1 where id=room_key returning * into r;
  delete from public.polycup_room_events where room=room_key and done and created_at<now()-interval '2 minutes';
 elsif op='tracks' then
  if not is_host then raise exception 'Only the host can fetch the track pack.'; end if;
  return coalesce(r.data->'codes','{}');
 elsif op='kick' then
  if not is_host or (args->>'member')::int=1 then raise exception 'Only the host can remove another player.'; end if;
  update public.polycup_rooms set blocked=array_append(blocked,(select actor from public.polycup_room_members where room=room_key and member_id=(args->>'member')::int)),revision=revision+1 where id=room_key returning * into r;
  delete from public.polycup_room_members where room=room_key and member_id=(args->>'member')::int;
 elsif op='bind' then
  if not is_host or r.data->'launch'->>'stage'<>'connecting' or r.data->'launch'->>'id' is distinct from args->>'launch' then raise exception 'No matching start attempt.'; end if;
  n:=(args->>'native')::integer;
  if n<1 or n>1000000 then raise exception 'Invalid connection.'; end if;
  if exists(select 1 from public.polycup_room_members where room=room_key and native_id=n and ticket<>(args->>'ticket')::uuid) then raise exception 'Connection is already assigned.'; end if;
  update public.polycup_room_members set native_id=n,launch_id=args->>'launch'
   where room=room_key and ticket=(args->>'ticket')::uuid and seen_at>now()-interval '35 seconds'
    and (native_id is null or native_id=n) returning member_id into n;
  if n is null then raise exception 'Invalid connection ticket.'; end if;
  return to_jsonb(n);
 elsif op not in ('create','join','poll') then raise exception 'Unknown room operation.';
 end if;
 select jsonb_build_object(
  'id',r.id,'code',r.code,'host',1,'self',m.member_id,'revision',r.revision,'ticket',m.ticket,
  'data',case when op='poll' and args->>'revision'=r.revision::text then null else (r.data-'codes')||jsonb_build_object('codes','{}'::jsonb) end,
  'members',case when op='poll' and args->>'revision'=r.revision::text and args->>'presence'=(
    select string_agg(p.member_id::text||':'||(p.seen_at>now()-interval '35 seconds')::text,',' order by p.member_id) from public.polycup_room_members p where p.room=room_key
   ) then null else (select coalesce(jsonb_agg(jsonb_build_object('id',p.member_id,'name',p.name,'country',p.country,'style',p.style,'online',p.seen_at>now()-interval '35 seconds') order by p.member_id),'[]') from public.polycup_room_members p where p.room=room_key) end,
  'events',case when is_host then (select coalesce(jsonb_agg(jsonb_build_object('seq',e.seq,'actor',e.member_id,'kind',e.kind,'value',e.value,'request',e.request) order by e.seq),'[]') from public.polycup_room_events e where e.room=room_key and not done) else '[]'::jsonb end,
  'results',(select coalesce(jsonb_agg(jsonb_build_object('request',e.request,'error',e.error)),'[]') from public.polycup_room_events e where e.room=room_key and e.actor=who and done and e.created_at>now()-interval '2 minutes' and (not(args ? 'requests') or e.request::text in (select jsonb_array_elements_text(args->'requests'))))
 ) into result;
 return result;
end $$;
revoke all on function public.polycup_room(text,uuid,uuid,jsonb) from public;
grant execute on function public.polycup_room(text,uuid,uuid,jsonb) to authenticated;

create function public.polycup_room_by_code(room_code text)
returns uuid language sql stable security definer set search_path='' as $$
 select id from public.polycup_rooms where code=upper(btrim(room_code)) and seen_at>now()-interval '90 seconds'
$$;
revoke all on function public.polycup_room_by_code(text) from public;
grant execute on function public.polycup_room_by_code(text) to authenticated;
commit;
