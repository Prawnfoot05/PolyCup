-- Prepared locally; collection and dispatch remain disabled until operator activation.
begin;
create role polycup_input_worker nologin;
alter table public.polycup_input_runs alter column recording drop not null;
alter table public.polycup_input_runs add column recording_digest text,add column recording_bytes integer,
 add column last_error_code text,add column processed_at timestamptz,add column attempts integer not null default 0,add column next_attempt_at timestamptz not null default now();
update public.polycup_input_runs set recording_digest=encode(sha256(convert_to(recording,'UTF8')),'hex'),recording_bytes=octet_length(recording) where recording_digest is null;
alter table public.polycup_input_runs alter column recording_digest set not null,alter column recording_bytes set not null;
create index polycup_input_pending on public.polycup_input_runs(next_attempt_at,created_at) where processed_at is null and recording is not null;
alter table public.polycup_input_review_config add column raw_bytes bigint not null default 0,
 add column daily_bytes bigint not null default 0,add column daily_runs integer not null default 0,add column max_daily_runs integer not null default 4000,add column retained_runs integer not null default 0,add column max_retained_runs integer not null default 24000,add column budget_day date not null default current_date,
 add column max_raw_bytes bigint not null default 25165824,add column max_daily_bytes bigint not null default 16777216;
update public.polycup_input_review_config set raw_bytes=(select coalesce(sum(recording_bytes),0) from public.polycup_input_runs where recording is not null) where singleton;
update public.polycup_input_review_config set retained_runs=(select count(*) from public.polycup_input_runs) where singleton;
-- A global byte cap prevents an outage or abusive client from filling the Free DB.
create function public.polycup_input_bytes() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.polycup_input_review_config%rowtype;delta bigint;existing boolean;
begin
 if tg_op='INSERT' then
 new.recording_digest:=encode(sha256(convert_to(new.recording,'UTF8')),'hex');new.recording_bytes:=octet_length(new.recording);
 select exists(select 1 from public.polycup_input_runs where (match_id,player_id,round)=(new.match_id,new.player_id,new.round)) into existing;
 if existing then return new;end if;
 delta:=new.recording_bytes;
 elsif tg_op='UPDATE' then delta:=coalesce(octet_length(new.recording),0)-coalesce(octet_length(old.recording),0);
 else delta:=-coalesce(octet_length(old.recording),0);end if;
 select * into cfg from public.polycup_input_review_config where singleton for update;
 if cfg.budget_day<>current_date then cfg.daily_bytes:=0;cfg.daily_runs:=0;end if;
 if tg_op='INSERT' and (cfg.daily_runs>=cfg.max_daily_runs or cfg.retained_runs>=cfg.max_retained_runs) then raise exception 'Input evidence capacity reached' using errcode='PC002';end if;
 if delta>0 and (cfg.raw_bytes+delta>cfg.max_raw_bytes or cfg.daily_bytes+delta>cfg.max_daily_bytes) then raise exception 'Input evidence capacity reached' using errcode='PC002';end if;
 update public.polycup_input_review_config set raw_bytes=greatest(0,raw_bytes+delta),daily_bytes=cfg.daily_bytes+greatest(0,delta),daily_runs=cfg.daily_runs+case when tg_op='INSERT' then 1 else 0 end,retained_runs=retained_runs+case when tg_op='INSERT' then 1 when tg_op='DELETE' then -1 else 0 end,budget_day=current_date where singleton;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.polycup_input_bytes() from public;
create trigger polycup_input_bytes before insert or update of recording or delete on public.polycup_input_runs for each row execute function public.polycup_input_bytes();
create or replace function public.polycup_submit_input_run(match_key uuid,instance_key uuid,run jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype;p public.polycup_ranked_members%rowtype;old public.polycup_input_runs%rowtype;n integer;
begin
 if not (select enabled from public.polycup_input_review_config where singleton) then return false;end if;
 if auth.uid() is null then raise exception 'Sign in first';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,250));
 select * into m from public.polycup_ranked_matches where id=match_key;
 select * into p from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid();
 if p.player_id is null or instance_key is null or p.instance_id is distinct from instance_key then raise exception 'Input submission belongs to another match window';end if;
 if m.status not in('racing','review','completed') or m.started_at is null or now()>coalesce(m.finished_at,m.started_at)+interval '24 hours' then raise exception 'Input submission window closed' using errcode='PC001';end if;
 if run is null or jsonb_typeof(run)<>'object' or octet_length(run::text)>140000 or run->>'gameVersion' is distinct from '0.6.3'
 or coalesce(run->>'round','') !~ '^[0-9]{1,4}$' or coalesce(run->>'finish','') !~ '^[0-9]{1,7}$'
 or coalesce(run->>'nativeFinish','') !~ '^[0-9]{1,7}$' or coalesce(run->>'timeOffset','') !~ '^[0-9]{1,7}$'
 or coalesce(run->>'recording','') !~ '^[A-Za-z0-9_-]+$'
 or not exists(select 1 from jsonb_array_elements(m.track_pool) t where t->>'id'=run->>'track') then raise exception 'Invalid input evidence';end if;
 n:=(run->>'round')::integer;
 if not exists(select 1 from public.polycup_input_runs where match_id=match_key and player_id=auth.uid() and round=n) and
   (select count(*)>=200 or coalesce(sum(recording_bytes),0)+octet_length(run->>'recording')>3500000 from public.polycup_input_runs where match_id=match_key and player_id=auth.uid()) then raise exception 'Input evidence quota reached' using errcode='PC001';end if;
 if (run->>'nativeFinish')::integer+(run->>'timeOffset')::integer<>(run->>'finish')::integer then raise exception 'Input clock mismatch';end if;
 -- The primary key and immutable payload make lost-response retries safe.
 insert into public.polycup_input_runs(match_id,player_id,round,track,finish,recording,native_finish,time_offset,game_version)
 values(match_key,auth.uid(),n,run->>'track',(run->>'finish')::integer,run->>'recording',(run->>'nativeFinish')::integer,(run->>'timeOffset')::integer,run->>'gameVersion') on conflict do nothing;
 select * into old from public.polycup_input_runs where match_id=match_key and player_id=auth.uid() and round=n;
 if old.track<>run->>'track' or old.finish<>(run->>'finish')::integer or old.recording_digest<>encode(sha256(convert_to(run->>'recording','UTF8')),'hex') or old.native_finish<>(run->>'nativeFinish')::integer or old.time_offset<>(run->>'timeOffset')::integer then raise exception 'Conflicting input evidence';end if;
 return true;
end $$;
revoke all on function public.polycup_submit_input_run(uuid,uuid,jsonb) from public,anon;
grant execute on function public.polycup_submit_input_run(uuid,uuid,jsonb) to authenticated;


-- No rating/table-write capability for this worker.
grant usage on schema public to polycup_input_worker;
grant select on public.polycup_input_review_config,public.polycup_input_runs,public.polycup_input_checks,public.polycup_ranked_matches,public.polycup_ranked_validations,public.polycup_ranked_transcripts to polycup_input_worker;
grant update(recording,processed_at,attempts,next_attempt_at,last_error_code) on public.polycup_input_runs to polycup_input_worker;
grant insert,update on public.polycup_input_checks to polycup_input_worker;
create policy input_worker_read on public.polycup_input_review_config for select to polycup_input_worker using(true);
create policy input_worker_runs on public.polycup_input_runs for all to polycup_input_worker using(true) with check(true);
create policy input_worker_checks on public.polycup_input_checks for all to polycup_input_worker using(true) with check(true);
create policy input_worker_matches on public.polycup_ranked_matches for select to polycup_input_worker using(true);
create policy input_worker_validations on public.polycup_ranked_validations for select to polycup_input_worker using(true);
create policy input_worker_transcripts on public.polycup_ranked_transcripts for select to polycup_input_worker using(true);
-- Retain compact verdicts and immutable hashes, not raw recordings. Stalled or
-- unverifiable evidence expires honestly as unsupported, never a clean verdict.
create function public.polycup_input_prune() returns integer language plpgsql security definer set search_path='' as $$
declare r record;n integer:=0;
begin
 for r in select * from public.polycup_input_runs where recording is not null and (created_at<now()-interval '48 hours' or attempts>=6) order by created_at limit 1000 for update skip locked loop
 insert into public.polycup_input_checks(match_id,player_id,round,status,policy,corpus,input_digest,findings)
 values(r.match_id,r.player_id,r.round,'unsupported','retention-v1','unavailable',r.recording_digest,'[]') on conflict do nothing;
 update public.polycup_input_runs set recording=null,processed_at=coalesce(processed_at,now()) where (match_id,player_id,round)=(r.match_id,r.player_id,r.round);n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.polycup_input_prune() from public,anon,authenticated,service_role,polycup_input_worker;
commit;
