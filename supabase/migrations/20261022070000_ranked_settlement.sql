-- Local result-integrity pipeline. Does not enable ranked or deploy a worker.
begin;
create table public.polycup_ranked_transcripts (
 match_id uuid not null references public.polycup_ranked_matches(id),
 player_id uuid not null references public.profiles(id) on delete cascade,
 transcript jsonb not null,
 created_at timestamptz not null default now(),
 primary key(match_id,player_id)
);
create table public.polycup_ranked_validations (
 match_id uuid primary key references public.polycup_ranked_matches(id),
 digest text not null,
 method text not null,
 created_at timestamptz not null default now()
);
alter table public.polycup_ranked_transcripts enable row level security;
alter table public.polycup_ranked_validations enable row level security;
revoke all on public.polycup_ranked_transcripts,public.polycup_ranked_validations from public,anon,authenticated;
grant all on public.polycup_ranked_transcripts,public.polycup_ranked_validations to service_role;

create function public.polycup_ranked_submit(match_key uuid,instance_key uuid,transcript jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p public.polycup_ranked_members%rowtype; prior jsonb;
begin
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 select * into p from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid();
 if p.player_id is null or instance_key is null then raise exception 'Rejoin this ranked match first.'; end if;
 if transcript is null or octet_length(transcript::text)>250000 or transcript->>'schema' is distinct from '1'
   or transcript->>'match' is distinct from match_key::text or transcript->>'launch' is distinct from m.session->'launch'->>'id'
   or jsonb_typeof(transcript->'rounds') is distinct from 'array' or jsonb_array_length(transcript->'rounds') not between 1 and 1000
   then raise exception 'Invalid ranked transcript.'; end if;
 select t.transcript into prior from public.polycup_ranked_transcripts t where match_id=match_key and player_id=auth.uid();
 if prior is not null then
   if prior<>transcript then raise exception 'Submitted evidence cannot be replaced.'; end if;
   return m.status;
 end if;
 if m.status not in ('racing','review') then return m.status; end if;
 if p.instance_id is distinct from instance_key then raise exception 'Rejoin this ranked match first.'; end if;
 if m.deadline<=now() then
   update public.polycup_ranked_matches set status='unrated',terminal_reason='expired',finished_at=now() where id=match_key;
   delete from public.polycup_ranked_claims where match_id=match_key;
   return 'unrated';
 end if;
 insert into public.polycup_ranked_transcripts values(match_key,auth.uid(),transcript,now());
 -- Protect a fully received result from subsequent host disconnect/lease expiry.
 if (select count(*) from public.polycup_ranked_transcripts where match_id=match_key)=cardinality(m.roster) then
   update public.polycup_ranked_matches set status='review',deadline=now()+interval '30 minutes' where id=match_key;
   return 'review';
 end if;
 return m.status;
end $$;
revoke all on function public.polycup_ranked_submit(uuid,uuid,jsonb) from public,anon;
grant execute on function public.polycup_ranked_submit(uuid,uuid,jsonb) to authenticated;
-- Retire the older scoreboard-only client path; it could enter review before
-- the other racers had a durable transcript.
revoke execute on function public.polycup_ranked_report(uuid,uuid,jsonb) from authenticated;

-- Even the old service entry point now requires a validation record. Only the
-- trusted worker can create one; game clients cannot choose rating deltas.
alter function public.polycup_ranked_rate(uuid) rename to polycup_ranked_rate_internal;
revoke all on function public.polycup_ranked_rate_internal(uuid) from public,anon,authenticated,service_role;
create function public.polycup_ranked_rate(match_key uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.polycup_ranked_validations where match_id=match_key) then raise exception 'Result validation required.'; end if;
 perform public.polycup_ranked_rate_internal(match_key);
end $$;
revoke all on function public.polycup_ranked_rate(uuid) from public,anon,authenticated;
grant execute on function public.polycup_ranked_rate(uuid) to service_role;

create function public.polycup_ranked_settle_validated(match_key uuid,digest text,evidence jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p uuid;
begin
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 if m.status='completed' then
   if not exists(select 1 from public.polycup_ranked_validations v where v.match_id=match_key and v.digest=polycup_ranked_settle_validated.digest) then raise exception 'Validated result differs.'; end if;
   return;
 end if;
 if m.status<>'review' or digest !~ '^[a-f0-9]{64}$' or evidence->>'digest' is distinct from digest
   or (select count(*) from public.polycup_ranked_transcripts where match_id=match_key)<>cardinality(m.roster)
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
revoke all on function public.polycup_ranked_settle_validated(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.polycup_ranked_settle_validated(uuid,text,jsonb) to service_role;

create function public.polycup_ranked_result_status(match_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid()) then raise exception 'Match member required.'; end if;
 perform public.polycup_ranked_expire();
 return (select jsonb_build_object('status',status,'reason',terminal_reason) from public.polycup_ranked_matches where id=match_key);
end $$;
revoke all on function public.polycup_ranked_result_status(uuid) from public,anon;
grant execute on function public.polycup_ranked_result_status(uuid) to authenticated;
create function public.polycup_ranked_reject_result(match_key uuid,instance_key uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.polycup_ranked_matches where id=match_key for update;
 if not exists(select 1 from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid() and instance_id=instance_key) then raise exception 'Rejoin this ranked match first.'; end if;
 update public.polycup_ranked_matches set status='unrated',terminal_reason='player_result_mismatch',finished_at=now()
 where id=match_key and status in ('racing','review');
 delete from public.polycup_ranked_claims where match_id=match_key and exists(select 1 from public.polycup_ranked_matches where id=match_key and status='unrated');
end $$;
revoke all on function public.polycup_ranked_reject_result(uuid,uuid) from public,anon;
grant execute on function public.polycup_ranked_reject_result(uuid,uuid) to authenticated;
commit;
