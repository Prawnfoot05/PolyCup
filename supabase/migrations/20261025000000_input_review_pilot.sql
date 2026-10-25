-- LOCAL PILOT ONLY. No ratings, penalties, or production scheduling changes.
begin;
create table public.polycup_input_review_config(singleton boolean primary key default true check(singleton), enabled boolean not null default false);
insert into public.polycup_input_review_config default values;
create table public.polycup_input_runs(
 match_id uuid not null references public.polycup_ranked_matches(id) on delete cascade,
 player_id uuid not null references public.profiles(id) on delete cascade,
 round integer not null check(round between 1 and 1000),
 track text not null, finish integer not null check(finish between 1 and 3600000),
 recording text not null check(octet_length(recording)<=131072),
 native_finish integer not null check(native_finish between 1 and 3600000),
 time_offset integer not null check(time_offset between 0 and 3600000),
 game_version text not null check(game_version='0.6.3'),
 created_at timestamptz not null default now(),
 primary key(match_id,player_id,round)
);
create table public.polycup_input_checks(
 match_id uuid not null,player_id uuid not null,round integer not null,
 status text not null check(status in('flagged','no_match','partial','no_reference','unsupported','invalid')),
 policy text not null, corpus text not null, input_digest text not null,
 findings jsonb not null default '[]', checked_at timestamptz not null default now(),
 primary key(match_id,player_id,round),
 foreign key(match_id,player_id,round) references public.polycup_input_runs(match_id,player_id,round) on delete cascade
);
alter table public.polycup_input_review_config enable row level security;
alter table public.polycup_input_runs enable row level security;
alter table public.polycup_input_checks enable row level security;
revoke all on public.polycup_input_review_config,public.polycup_input_runs,public.polycup_input_checks from public,anon,authenticated;
grant all on public.polycup_input_review_config,public.polycup_input_runs,public.polycup_input_checks to service_role;

create function public.polycup_input_review_policy() returns boolean language sql stable security definer set search_path='' as $$
 select enabled from public.polycup_input_review_config where singleton
$$;
revoke all on function public.polycup_input_review_policy() from public;
grant execute on function public.polycup_input_review_policy() to anon,authenticated,service_role;

create function public.polycup_submit_input_run(match_key uuid,instance_key uuid,run jsonb) returns boolean
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
   (select count(*)>=200 or coalesce(sum(octet_length(recording)),0)+octet_length(run->>'recording')>3500000 from public.polycup_input_runs where match_id=match_key and player_id=auth.uid()) then raise exception 'Input evidence quota reached' using errcode='PC001';end if;
 if (run->>'nativeFinish')::integer+(run->>'timeOffset')::integer<>(run->>'finish')::integer then raise exception 'Input clock mismatch';end if;
 -- The primary key and immutable payload make lost-response retries safe.
 insert into public.polycup_input_runs(match_id,player_id,round,track,finish,recording,native_finish,time_offset,game_version)
 values(match_key,auth.uid(),n,run->>'track',(run->>'finish')::integer,run->>'recording',(run->>'nativeFinish')::integer,(run->>'timeOffset')::integer,run->>'gameVersion') on conflict do nothing;
 select * into old from public.polycup_input_runs where match_id=match_key and player_id=auth.uid() and round=n;
 if old.track<>run->>'track' or old.finish<>(run->>'finish')::integer or old.recording<>run->>'recording' or old.native_finish<>(run->>'nativeFinish')::integer or old.time_offset<>(run->>'timeOffset')::integer then raise exception 'Conflicting input evidence';end if;
 return true;
end $$;
revoke all on function public.polycup_submit_input_run(uuid,uuid,jsonb) from public,anon;
grant execute on function public.polycup_submit_input_run(uuid,uuid,jsonb) to authenticated;

-- Public summaries are derived from the settled transcript. Raw inputs are NEVER
-- public, and users cannot write checks or name another racer in a submission.
-- Return missing rows as 'unavailable', never silently call them clean.
create function public.polycup_input_review(match_keys uuid[],player_key uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(cardinality(match_keys),0)>25 then raise exception 'Too many matches';end if;
 select coalesce(jsonb_agg(jsonb_build_object('match_id',m.id,'player_id',f->>'player','round',(r->>'round')::integer,'track',r->>'track',
 'status',coalesce(c.status,case when u.match_id is null then 'unavailable' else 'pending' end),
 'findings',coalesce(c.findings,'[]'::jsonb),'policy',c.policy,'corpus',c.corpus) order by m.id,(r->>'round')::integer,f->>'player'),'[]'::jsonb) into result
 from public.polycup_ranked_matches m
 join public.polycup_ranked_validations v on v.match_id=m.id and v.method='local-peer-transcript-v1'
 join lateral (select transcript from public.polycup_ranked_transcripts where match_id=m.id order by player_id limit 1) t on true
 cross join lateral jsonb_array_elements(t.transcript->'rounds') r
 cross join lateral jsonb_array_elements(r->'finishes') f
 left join public.polycup_input_runs u on u.match_id=m.id and u.player_id=(f->>'player')::uuid and u.round=(r->>'round')::integer and u.track=r->>'track' and u.finish=(f->>'frames')::integer
 left join public.polycup_input_checks c on (c.match_id,c.player_id,c.round)=(u.match_id,u.player_id,u.round)
 where m.id=any(match_keys) and m.status='completed' and f->>'frames' is not null and (player_key is null or f->>'player'=player_key::text);
 return result;
end $$;
revoke all on function public.polycup_input_review(uuid[],uuid) from public;
grant execute on function public.polycup_input_review(uuid[],uuid) to anon,authenticated,service_role;
commit;
