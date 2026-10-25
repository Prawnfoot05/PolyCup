-- Prepared locally. Does not enable ranked, start a job, or create login credentials.
begin;
create table public.polycup_ranked_result_jobs (
 match_id uuid primary key references public.polycup_ranked_matches(id) on delete cascade,
 attempts integer not null default 0 check(attempts>=0),
 next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 outcome text,
 last_error_code text
);
create index polycup_ranked_result_jobs_due on public.polycup_ranked_result_jobs(next_attempt_at,created_at) where finished_at is null;
alter table public.polycup_ranked_result_jobs enable row level security;
revoke all on public.polycup_ranked_result_jobs from public,anon,authenticated,service_role;

-- Readiness is deliberately separate from validation: conflicting or malformed
-- complete evidence must reach the validator and resolve unrated, not get stuck.
create function public.polycup_ranked_result_ready(match_key uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.polycup_ranked_matches m where m.id=match_key
  and m.status in ('racing','review') and (
   m.terminal_reason='abandonment_interrupted' or (
    exists(select 1 from public.polycup_ranked_transcripts t where t.match_id=m.id)
    and not exists(select 1 from unnest(m.roster) as racer(player_id)
     where not exists(select 1 from public.polycup_ranked_members p
       where p.match_id=m.id and p.player_id=racer.player_id and p.abandoned_at is not null)
     and not exists(select 1 from public.polycup_ranked_transcripts t
       where t.match_id=m.id and t.player_id=racer.player_id)))))
$$;
revoke all on function public.polycup_ranked_result_ready(uuid) from public,anon,authenticated,service_role;

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
   -- Durable complete evidence survives worker downtime. Incomplete games still expire.
   and not (m.status in ('racing','review') and public.polycup_ranked_result_ready(m.id))
   and (deadline<=now() or (status='drafting' and exists(select 1 from public.polycup_ranked_members p
     where p.match_id=m.id and p.player_id=m.host_id and p.seen_at<now()-interval '120 seconds')))
   returning id
 ) delete from public.polycup_ranked_claims where match_id in(select id from expired);
end $$;


-- Non-login capability role: grant only to the dedicated backend login during
-- deployment. Never grant to authenticator, anon, authenticated or service_role.
create role polycup_result_worker nologin noinherit;
grant usage on schema public to polycup_result_worker;
grant select,insert,update on public.polycup_ranked_result_jobs to polycup_result_worker;
grant select,update on public.polycup_ranked_matches,public.player_ratings to polycup_result_worker;
grant select on public.polycup_ranked_members,public.polycup_ranked_transcripts to polycup_result_worker;
grant select,insert,update on public.polycup_rating_state to polycup_result_worker;
grant insert on public.polycup_rating_events,public.polycup_ranked_validations to polycup_result_worker;
grant select,delete on public.polycup_ranked_claims to polycup_result_worker;
grant execute on function public.polycup_ranked_expire(),public.polycup_ranked_result_ready(uuid),
 public.polycup_ranked_settle_validated(uuid,text,jsonb),public.polycup_rating_calculate(jsonb),
 public.polycup_rating_display(double precision) to polycup_result_worker;
create policy result_worker on public.polycup_ranked_result_jobs to polycup_result_worker using(true) with check(true);
create policy result_worker on public.polycup_ranked_matches to polycup_result_worker using(true) with check(true);
create policy result_worker on public.player_ratings to polycup_result_worker using(true) with check(true);
create policy result_worker on public.polycup_ranked_members to polycup_result_worker using(true) with check(true);
create policy result_worker on public.polycup_ranked_transcripts to polycup_result_worker using(true) with check(true);
create policy result_worker on public.polycup_rating_state to polycup_result_worker using(true) with check(true);
create policy result_worker on public.polycup_rating_events to polycup_result_worker using(true) with check(true);
create policy result_worker on public.polycup_ranked_validations to polycup_result_worker using(true) with check(true);
create policy result_worker on public.polycup_ranked_claims to polycup_result_worker using(true) with check(true);
commit;
