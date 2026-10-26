begin;
-- Inert until an operator activates a season. Existing matches retain 0.4 rules.
create table public.polycup_ranked_seasons (
 id text primary key check(length(id) between 1 and 64),
 name text not null check(length(name) between 1 and 64),
 game_version text not null, client_version text not null,
 community_collection text not null,
 catalog jsonb not null check(jsonb_typeof(catalog)='array'),
 rules jsonb not null, tier_floors integer[] not null,
 provisional_matches integer not null,
 starts_at timestamptz, ends_at timestamptz
);
alter table public.polycup_ranked_seasons enable row level security;
revoke all on public.polycup_ranked_seasons from public,anon,authenticated;
grant all on public.polycup_ranked_seasons to service_role;
alter table public.polycup_ranked_config add column season_id text references public.polycup_ranked_seasons(id);
alter table public.polycup_ranked_matches add column season_id text references public.polycup_ranked_seasons(id), add column selected_track text;
create index polycup_ranked_season_matches on public.polycup_ranked_matches(season_id,finished_at);
alter table public.polycup_ranked_members add column garage_name text, add column garage_country text, add column garage_style text;

create function public.polycup_ranked_season_rules() returns jsonb language sql immutable set search_path='' as $$
 select public.polycup_ranked_rules() || '{"singleTrack":true,"uploadLeaderboardTimes":true,"selection":"random","roundsPerTrack":1,"pointsToWin":30,"points":[10,7,4,2,0,0,0,0],"bansPerRacer":0,"picksPerRacer":0,"warmup":"first-visit","warmupTiming":"fixed","warmupSeconds":30,"readyEndsWarmup":false,"roundBreakSeconds":3}'::jsonb
$$;
revoke all on function public.polycup_ranked_season_rules() from public,anon,authenticated;
grant execute on function public.polycup_ranked_season_rules() to service_role;

create or replace function public.polycup_ranked_reserve(match_key uuid,players uuid[],pool jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare season public.polycup_ranked_seasons%rowtype; reserved_id uuid; existed boolean;
begin
 perform pg_advisory_xact_lock(777,1);
 select s.* into season from public.polycup_ranked_seasons s join public.polycup_ranked_config c on c.season_id=s.id;
 if season.id is not null and (season.starts_at is null or season.ends_at is not null or pool is distinct from season.catalog
   or (select version from public.polycup_queue_config where singleton)<>season.client_version) then
   raise exception 'Ranked season configuration is unavailable.';
 end if;
 existed:=exists(select 1 from public.polycup_ranked_matches where id=match_key);
 reserved_id:=public.polycup_ranked_reserve_internal(match_key,players,pool);
 if season.id is not null and not existed then
   update public.polycup_ranked_matches set season_id=season.id,rules=season.rules,
     selected_track=season.catalog->floor(random()*jsonb_array_length(season.catalog))::integer->>'id'
   where id=reserved_id;
 end if;
 return reserved_id;
end $$;

alter function public.polycup_ranked_advance(uuid,text,jsonb) rename to polycup_ranked_advance_legacy;
revoke all on function public.polycup_ranked_advance_legacy(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.polycup_ranked_advance(match_key uuid,action text,draft_data jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype;
begin
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 if m.season_id is null or action<>'race' then
   perform public.polycup_ranked_advance_legacy(match_key,action,draft_data); return;
 end if;
 if m.status='racing' then return; end if;
 if m.status<>'drafting' or m.selected_track is null or not exists(select 1 from jsonb_array_elements(m.track_pool) t where t->>'id'=m.selected_track)
 or exists(select 1 from public.polycup_ranked_members where match_id=m.id and (not accepted or seen_at<now()-interval '35 seconds'))
 or draft_data is distinct from '{"bans":[],"picks":[]}'::jsonb then raise exception 'Invalid single-track ranked start.'; end if;
 update public.polycup_ranked_matches set status='racing',draft=draft_data,started_at=now(),deadline=now()+interval '6 hours' where id=m.id;
end $$;
revoke all on function public.polycup_ranked_advance(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.polycup_ranked_advance(uuid,text,jsonb) to service_role;

-- Activation serializes with queue formation. Never cut over active seats or
-- unfinished settlements, and never reset underlying skill or lifetime history.
create function public.polycup_ranked_activate_season(season_key text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.polycup_ranked_seasons%rowtype; old_key text;
begin
 perform pg_advisory_xact_lock(777,1);
 select * into s from public.polycup_ranked_seasons where id=season_key for update;
 if s.id is null or s.starts_at is not null or jsonb_array_length(s.catalog)<16 then raise exception 'Season cannot be activated.'; end if;
 if exists(select 1 from public.polycup_ranked_queue) or exists(select 1 from public.polycup_ranked_claims)
 or exists(select 1 from public.polycup_ranked_matches where status in ('reserved','drafting','racing','review','disputed')) then
 raise exception 'Wait for current queues and matches to finish.'; end if;
 select season_id into old_key from public.polycup_ranked_config where singleton;
 update public.polycup_ranked_seasons set ends_at=now() where id=old_key;
 update public.polycup_ranked_seasons set starts_at=now() where id=s.id;
 update public.polycup_ranked_config set season_id=s.id,tier_floors=s.tier_floors,provisional_matches=s.provisional_matches where singleton;
 update public.polycup_queue_config set version=s.client_version,catalog=s.catalog where singleton;
end $$;
revoke all on function public.polycup_ranked_activate_season(text) from public,anon,authenticated;
grant execute on function public.polycup_ranked_activate_season(text) to service_role;

create function public.polycup_seasons() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'starts_at',s.starts_at,'ends_at',s.ends_at,
 'active',s.id=c.season_id,'community_collection',s.community_collection) order by s.starts_at desc),'[]')
 from public.polycup_ranked_seasons s cross join public.polycup_ranked_config c where s.starts_at is not null
$$;
revoke all on function public.polycup_seasons() from public;
grant execute on function public.polycup_seasons() to anon,authenticated,service_role;
commit;


