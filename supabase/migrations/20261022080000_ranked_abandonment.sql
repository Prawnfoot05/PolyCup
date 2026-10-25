-- Local only: server-owned racing reconnect grace and forfeit evidence.
begin;
alter table public.polycup_ranked_members
 add column play_seen_at timestamptz,
 add column disconnected_since timestamptz,
 add column left_at timestamptz,
 add column native_lost_at timestamptz,
 add column abandoned_at timestamptz;

create or replace function public.polycup_ranked_expire()
returns void language plpgsql security definer set search_path='' as $$
begin
 -- Start the grace when an outage is observed, not retrospectively at the last
 -- heartbeat. A common backend outage must not instantly forfeit everyone.
 update public.polycup_ranked_members p set disconnected_since=now()
 from public.polycup_ranked_matches m
 where p.match_id=m.id and m.status='racing' and p.disconnected_since is null
 and coalesce(p.play_seen_at,p.seen_at,m.started_at)<now()-interval '35 seconds'
 and not exists(select 1 from public.polycup_ranked_transcripts t where t.match_id=m.id and t.player_id=p.player_id)
 and exists(select 1 from public.polycup_ranked_members witness where witness.match_id=m.id
   and witness.player_id<>p.player_id and witness.left_at is null and witness.abandoned_at is null
   and coalesce(witness.play_seen_at,witness.seen_at)>now()-interval '35 seconds');
 update public.polycup_ranked_members p set abandoned_at=now()
 from public.polycup_ranked_matches m
 where p.match_id=m.id and m.status='racing' and p.abandoned_at is null
 and p.disconnected_since<=now()-interval '120 seconds'
 and (p.player_id=m.host_id or exists(select 1 from public.polycup_ranked_members host
   where host.match_id=m.id and host.player_id=m.host_id and host.left_at is null and host.native_lost_at is null
   and coalesce(host.play_seen_at,host.seen_at)>now()-interval '35 seconds'))
 and not exists(select 1 from public.polycup_ranked_transcripts t where t.match_id=m.id and t.player_id=p.player_id)
 and exists(select 1 from public.polycup_ranked_members witness where witness.match_id=m.id
   and witness.player_id<>p.player_id and witness.left_at is null and witness.abandoned_at is null
   and coalesce(witness.play_seen_at,witness.seen_at)>now()-interval '35 seconds');
 -- Preserve confirmed forfeits for the worker; never silently discard the loss.
 update public.polycup_ranked_matches m set status='review',deadline=now()+interval '30 minutes',terminal_reason='abandonment_interrupted'
 where m.status='racing' and exists(select 1 from public.polycup_ranked_members p
   where p.match_id=m.id and p.abandoned_at is not null)
 and (m.deadline<=now() or exists(select 1 from public.polycup_ranked_members p
   where p.match_id=m.id and p.player_id=m.host_id and p.abandoned_at is not null));
 with expired as (
   update public.polycup_ranked_matches m set status=case when started_at is null then 'cancelled' else 'unrated' end,
     terminal_reason='expired',finished_at=now()
   where status in ('reserved','drafting','racing','review','disputed') and terminal_reason is distinct from 'abandonment_interrupted'
   and (deadline<=now() or (status='drafting' and exists(select 1 from public.polycup_ranked_members p
     where p.match_id=m.id and p.player_id=m.host_id and p.seen_at<now()-interval '120 seconds')))
   returning id
 ) delete from public.polycup_ranked_claims where match_id in(select id from expired);
end $$;

alter function public.polycup_ranked_session(uuid,uuid,text,jsonb) rename to polycup_ranked_session_internal;
revoke all on function public.polycup_ranked_session_internal(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.polycup_ranked_session(match_key uuid,instance_key uuid,action text default 'poll',value jsonb default 'null')
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p public.polycup_ranked_members%rowtype; result jsonb;
begin
 perform pg_advisory_xact_lock(777,1);
 perform public.polycup_ranked_expire();
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 select * into p from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid();
 if p.player_id is null or instance_key is null then raise exception 'You are not in this ranked match.'; end if;
 if p.instance_id is not null and p.instance_id<>instance_key and p.seen_at>now()-interval '35 seconds' then raise exception 'This player is active in another window.'; end if;
 if p.abandoned_at is not null or m.status not in ('drafting','racing') then return null; end if;
 if action='leave' and m.status='racing' then
   update public.polycup_ranked_members set left_at=coalesce(left_at,now()),disconnected_since=coalesce(disconnected_since,now())
     where match_id=match_key and player_id=auth.uid();
   return null;
 end if;
 if action='connection-lost' and m.status='racing' then
   update public.polycup_ranked_members set native_lost_at=coalesce(native_lost_at,now()),disconnected_since=coalesce(disconnected_since,now()),play_seen_at=now()
     where match_id=match_key and player_id=auth.uid();
   action:='poll';
 end if;
 if action='rejoin' then
   -- A closed host process has lost the authoritative native race. Reopening
   -- cannot renew that authority or keep extending the original grace.
   if m.status='racing' and m.host_id=auth.uid() then
     update public.polycup_ranked_members set left_at=coalesce(left_at,now()),disconnected_since=coalesce(disconnected_since,now())
       where match_id=match_key and player_id=auth.uid();
     return null;
   end if;
   update public.polycup_ranked_members set left_at=null,native_lost_at=null,disconnected_since=null where match_id=match_key and player_id=auth.uid();
   action:='poll';
 elsif p.left_at is not null then return null;
 end if;
 if action='bind' and exists(select 1 from public.polycup_ranked_members target
   where target.match_id=match_key and target.ticket=(value->>'ticket')::uuid
   and (target.abandoned_at is not null or target.left_at is not null)) then
   raise exception 'Connection ticket unavailable.';
 end if;
 result:=public.polycup_ranked_session_internal(match_key,instance_key,action,value);
 if result is not null and jsonb_typeof(result)='object' then
   update public.polycup_ranked_members set play_seen_at=now(),disconnected_since=case when native_lost_at is null then null else disconnected_since end
   where match_id=match_key and player_id=auth.uid() and abandoned_at is null
     and (play_seen_at is null or play_seen_at<now()-interval '10 seconds' or disconnected_since is not null);
   result:=result||jsonb_build_object('reconnect',(select coalesce(jsonb_agg(jsonb_build_object(
     'player',r.player_id,'name',f.display_name,'until',r.disconnected_since+interval '120 seconds','abandoned',r.abandoned_at is not null)),'[]')
     from public.polycup_ranked_members r join public.profiles f on f.id=r.player_id where r.match_id=match_key and r.disconnected_since is not null));
 end if;
 return result;
end $$;
revoke all on function public.polycup_ranked_session(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.polycup_ranked_session(uuid,uuid,text,jsonb) to authenticated;

-- Queue polling alone cannot clear a voluntary leave or extend racing presence.
alter function public.polycup_queue(text,uuid,text) rename to polycup_queue_internal;
revoke all on function public.polycup_queue_internal(text,uuid,text) from public,anon,authenticated,service_role;
create function public.polycup_queue(action text,instance_key uuid,client_version text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; p public.polycup_ranked_members%rowtype;
begin
 result:=public.polycup_queue_internal(action,instance_key,client_version);
 if result->>'state'='matched' then
   select * into p from public.polycup_ranked_members where match_id=(result->'match'->>'id')::uuid and player_id=auth.uid();
   result:=jsonb_set(result,'{match}',result->'match'||jsonb_build_object('reconnect_until',p.disconnected_since+interval '120 seconds','abandoned',p.abandoned_at is not null,'left',p.left_at is not null,
     'host_disconnected',exists(select 1 from public.polycup_ranked_matches m join public.polycup_ranked_members host on host.match_id=m.id and host.player_id=m.host_id where m.id=p.match_id and host.disconnected_since is not null)));
 end if;
 return result;
end $$;
revoke all on function public.polycup_queue(text,uuid,text) from public,anon;
grant execute on function public.polycup_queue(text,uuid,text) to authenticated;
create or replace function public.polycup_ranked_settle_validated(match_key uuid,digest text,evidence jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p uuid;
begin
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 if m.status='completed' then
   if not exists(select 1 from public.polycup_ranked_validations v where v.match_id=match_key and v.digest=polycup_ranked_settle_validated.digest) then raise exception 'Validated result differs.'; end if;
   return;
 end if;
 if m.status<>'review' or digest !~ '^[a-f0-9]{64}$' or evidence->>'digest' is distinct from digest
   or exists(select 1 from public.polycup_ranked_members p where p.match_id=match_key and p.abandoned_at is null and not exists(select 1 from public.polycup_ranked_transcripts t where t.match_id=match_key and t.player_id=p.player_id))
   or (select count(distinct transcript) from public.polycup_ranked_transcripts where match_id=match_key)<>1
   then raise exception 'Complete matching evidence required.'; end if;
 for p in select unnest(m.roster) loop
   insert into public.polycup_ranked_reports(match_id,player_id,report) values(match_key,p,evidence)
   on conflict(match_id,player_id) do nothing;
 end loop;
 if exists(select 1 from public.polycup_ranked_reports where match_id=match_key and report<>evidence) then raise exception 'Conflicting prior report.'; end if;
 insert into public.polycup_ranked_validations values(match_key,digest,'local-peer-transcript-v1',now());
 perform public.polycup_ranked_rate(match_key);
end $$;

create or replace function public.polycup_ranked_rate_internal(match_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p uuid; prior public.player_ratings%rowtype;
  stored jsonb; inputs jsonb:='[]'; batch jsonb:='[]'; calculated jsonb; item jsonb;
  result_report jsonb; forced jsonb; place integer; idx integer:=0;
begin
  perform public.polycup_ranked_expire();
  select * into m from public.polycup_ranked_matches where id=match_key for update;
  if m.id is null or m.model_version<>'btf-6.2.0-t025-softplus-v1' then raise exception 'Unsupported rating model.'; end if;
  if m.status='completed' then return; end if;
  if m.status<>'review' or (select count(*) from public.polycup_ranked_reports where match_id=match_key)<>cardinality(m.roster)
    or (select count(distinct report) from public.polycup_ranked_reports where match_id=match_key)<>1 then raise exception 'Complete, consistent reports are required.'; end if;
  select report into result_report from public.polycup_ranked_reports where match_id=match_key limit 1;
  -- Lock and snapshot the entire batch before calculation. Same lock order as finalization.
  for p in select x from unnest(m.roster) x order by x loop
    select * into prior from public.player_ratings where player_id=p for update;
    select state into stored from public.polycup_rating_state where player_id=p;
    if prior.player_id is null then raise exception 'Missing player rating.'; end if;
    if stored is null then
      if prior.rating is not null or prior.rated_matches<>0 then raise exception 'Existing rating needs an explicit model migration.'; end if;
      item:=jsonb_build_object('mu',25.0,'sigma',25.0/3);
    else
      if stored->>'model' is distinct from m.model_version then raise exception 'Existing rating needs an explicit model migration.'; end if;
      item:=stored;
      if prior.rating is distinct from public.polycup_rating_display((stored->>'mu')::double precision) then raise exception 'Stored rating and model state disagree.'; end if;
    end if;
    select (x->>'place')::integer into place from jsonb_array_elements(result_report->'standings') x where x->>'player_id'=p::text;
    inputs:=inputs||jsonb_build_array(item||jsonb_build_object('place',place));
    batch:=batch||jsonb_build_array(jsonb_build_object('player_id',p,'before',prior.rating,
      'matches_before',prior.rated_matches,'state_before',stored));
  end loop;
  calculated:=public.polycup_rating_calculate(inputs);
  for item in select value from jsonb_array_elements(batch) loop
    if exists(select 1 from public.polycup_ranked_members where match_id=match_key and player_id=(item->>'player_id')::uuid and abandoned_at is not null) then
      select jsonb_agg(x || jsonb_build_object('place',case when ord-1=idx then cardinality(m.roster) else 1 end) order by ord) into forced from jsonb_array_elements(inputs) with ordinality v(x,ord);
      calculated:=jsonb_set(calculated,array[idx::text],public.polycup_rating_calculate(forced)->idx);
    end if;
    batch:=jsonb_set(batch,array[idx::text],item||jsonb_build_object('after',calculated->idx->'rating',
      'state_after',jsonb_build_object('model',m.model_version,'mu',calculated->idx->'mu','sigma',calculated->idx->'sigma')));
    idx:=idx+1;
  end loop;
  perform public.polycup_ranked_finalize(match_key,m.model_version,batch);
end $$;



alter function public.polycup_ranked_submit(uuid,uuid,jsonb) rename to polycup_ranked_submit_internal;
revoke all on function public.polycup_ranked_submit_internal(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.polycup_ranked_submit(match_key uuid,instance_key uuid,transcript jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p public.polycup_ranked_members%rowtype;
begin
 perform public.polycup_ranked_expire();
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 select * into p from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid();
 if p.player_id is null then raise exception 'Rejoin this ranked match first.'; end if;
 if p.abandoned_at is not null then return m.status; end if;
 return public.polycup_ranked_submit_internal(match_key,instance_key,transcript);
end $$;
revoke all on function public.polycup_ranked_submit(uuid,uuid,jsonb) from public,anon;
grant execute on function public.polycup_ranked_submit(uuid,uuid,jsonb) to authenticated;
create or replace function public.polycup_ranked_reject_result(match_key uuid,instance_key uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.polycup_ranked_matches where id=match_key for update;
 if not exists(select 1 from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid() and instance_id=instance_key and abandoned_at is null) then raise exception 'Rejoin this ranked match first.'; end if;
 if exists(select 1 from public.polycup_ranked_members where match_id=match_key and abandoned_at is not null) then
   update public.polycup_ranked_matches set status='review',terminal_reason='abandonment_interrupted',deadline=now()+interval '30 minutes' where id=match_key and status in ('racing','review');
 else
   update public.polycup_ranked_matches set status='unrated',terminal_reason='player_result_mismatch',finished_at=now() where id=match_key and status in ('racing','review');
   delete from public.polycup_ranked_claims where match_id=match_key and exists(select 1 from public.polycup_ranked_matches where id=match_key and status='unrated');
 end if;
end $$;

create or replace function public.polycup_ranked_match(match_key uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('match_id',m.id,'finished_at',m.finished_at,'rounds',(m.result->>'rounds')::integer,
   'players',(select jsonb_agg(jsonb_build_object('player_id',s->>'player_id',
     'display_name',coalesce(p.display_name,'Deleted player'),'place',(s->>'place')::integer,
     'abandoned',exists(select 1 from public.polycup_ranked_members member where member.match_id=m.id and member.player_id=(s->>'player_id')::uuid and member.abandoned_at is not null),'rating_before',e.rating_before,'rating_after',e.rating_after) order by (s->>'place')::integer,s->>'player_id')
     from jsonb_array_elements(m.result->'standings') s
     left join public.profiles p on p.id=(s->>'player_id')::uuid
     left join public.polycup_rating_events e on e.match_id=m.id and e.player_id=p.id))
 from public.polycup_ranked_matches m where m.id=match_key and m.status='completed'
$$;

commit;
