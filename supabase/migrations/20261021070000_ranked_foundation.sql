-- Ranked authority is separate from host-authored custom Cup snapshots.
-- No queue worker or rating algorithm is deployed by this migration.
begin;

create table public.polycup_ranked_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  model_version text,
  provisional_matches integer check (provisional_matches between 1 and 100),
  -- Exactly six increasing floors, Bronze through Master. GM is a leaderboard_position.
  tier_floors integer[],
  check (not enabled or (model_version is not null and length(model_version) between 1 and 80
    and provisional_matches is not null and tier_floors is not null)),
  check (tier_floors is null or (cardinality(tier_floors)=6 and array_lower(tier_floors,1)=1 and array_ndims(tier_floors)=1
    and array_position(tier_floors,null) is null and tier_floors[1]=0
    and tier_floors[1]<tier_floors[2] and tier_floors[2]<tier_floors[3]
    and tier_floors[3]<tier_floors[4] and tier_floors[4]<tier_floors[5]
    and tier_floors[5]<tier_floors[6]))
);
insert into public.polycup_ranked_config default values;

create table public.polycup_ranked_matches (
  id uuid primary key,
  host_id uuid references public.profiles(id) on delete set null,
  status text not null default 'reserved' check (status in
    ('reserved','drafting','racing','review','disputed','completed','cancelled','unrated')),
  roster uuid[] not null,
  rules jsonb not null,
  track_pool jsonb not null,
  draft jsonb,
  model_version text not null,
  result jsonb,
  terminal_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  deadline timestamptz not null default now()+interval '5 minutes'
);
create index polycup_ranked_expiry on public.polycup_ranked_matches(deadline)
  where status in ('reserved','drafting','racing','review','disputed');
create table public.polycup_ranked_members (
  match_id uuid not null references public.polycup_ranked_matches(id),
  player_id uuid not null references public.profiles(id) on delete cascade,
  instance_id uuid,
  accepted boolean not null default false,
  seen_at timestamptz,
  primary key(match_id,player_id)
);
-- One account can hold only one ranked seat. Terminal transitions release it.
create table public.polycup_ranked_claims (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  match_id uuid not null references public.polycup_ranked_matches(id)
);
create table public.polycup_ranked_reports (
  match_id uuid not null,
  player_id uuid not null,
  report jsonb not null,
  created_at timestamptz not null default now(),
  primary key(match_id,player_id),
  foreign key(match_id,player_id) references public.polycup_ranked_members(match_id,player_id) on delete cascade
);
create table public.polycup_rating_events (
  match_id uuid not null references public.polycup_ranked_matches(id),
  player_id uuid not null references public.profiles(id) on delete cascade,
  rating_before integer,
  rating_after integer not null check (rating_after>=0),
  matches_before integer not null,
  model_version text not null,
  -- Model-specific uncertainty/state remains private and reproducible.
  state_before jsonb,
  state_after jsonb not null,
  created_at timestamptz not null default now(),
  primary key(match_id,player_id)
);
create table public.polycup_rating_state (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  state jsonb not null
);

alter table public.polycup_ranked_config enable row level security;
alter table public.polycup_ranked_matches enable row level security;
alter table public.polycup_ranked_members enable row level security;
alter table public.polycup_ranked_claims enable row level security;
alter table public.polycup_ranked_reports enable row level security;
alter table public.polycup_rating_events enable row level security;
alter table public.polycup_rating_state enable row level security;
revoke all on public.polycup_ranked_config,public.polycup_ranked_matches,
  public.polycup_ranked_members,public.polycup_ranked_claims,public.polycup_ranked_reports,
  public.polycup_rating_events,public.polycup_rating_state from public,anon,authenticated;
grant all on public.polycup_ranked_config,public.polycup_ranked_matches,
  public.polycup_ranked_members,public.polycup_ranked_claims,public.polycup_ranked_reports,
  public.polycup_rating_events,public.polycup_rating_state to service_role;

-- Preserve administrative account deletion. A missing participant invalidates an
-- active match; surviving players keep their already-completed rating history.
create function public.polycup_ranked_account_removed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  with ended as (
    update public.polycup_ranked_matches set
      status=case when started_at is null then 'cancelled' else 'unrated' end,
      terminal_reason='account_removed',finished_at=now()
    where old.id=any(roster) and status in ('reserved','drafting','racing','review','disputed') returning id
  ) delete from public.polycup_ranked_claims where match_id in (select id from ended);
  return old;
end $$;
revoke all on function public.polycup_ranked_account_removed() from public,anon,authenticated;
create trigger polycup_ranked_account_removed before delete on public.profiles
  for each row execute function public.polycup_ranked_account_removed();

create function public.polycup_ranked_rules()
returns jsonb language sql immutable set search_path='' as $$
 select '{"version":1,"targetPlayers":4,"minPlayers":2,"maxPlayers":4,
 "allowRacerChanges":false,"allowSpectatorFreecam":true,"uploadLeaderboardTimes":false,
 "roundsPerTrack":3,"pointsToWin":140,"finalist":true,"points":[10,8,6,5,4,3,2,1],
 "selection":"draft","bansPerRacer":2,"picksPerRacer":2,"pool":["official","community"],
 "warmup":"first-visit","warmupTiming":"wr","warmupSeconds":90,
 "warmupMultiplier":1.5,"warmupMinimumSeconds":30,"readyEndsWarmup":true,
 "finishTimeoutSeconds":10,"roundBreakSeconds":5}'::jsonb
$$;

-- Called by a future worker on a schedule, and lazily on admission/poll.
-- Incomplete or disputed matches expire without changing ratings.
create function public.polycup_ranked_expire()
returns void language plpgsql security definer set search_path='' as $$
begin
  with expired as (
    update public.polycup_ranked_matches m
    set status=case when started_at is null then 'cancelled' else 'unrated' end,
      terminal_reason='expired',finished_at=now()
    where status in ('reserved','drafting','racing','review','disputed')
      and (deadline<=now() or (status in ('drafting','racing') and exists (
        select 1 from public.polycup_ranked_members p where p.match_id=m.id
          and p.player_id=m.host_id and p.seen_at<now()-interval '120 seconds')))
    returning id
  ) delete from public.polycup_ranked_claims where match_id in (select id from expired);
end $$;

-- Only the trusted matchmaker may reserve a roster and a catalog snapshot.
-- Pool entries: {id, category: official|community, digest: SHA256 of track data}.
create function public.polycup_ranked_reserve(match_key uuid, players uuid[], pool jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare p uuid; c public.polycup_ranked_config%rowtype; old public.polycup_ranked_matches%rowtype;
begin
  if match_key is null or players is null or cardinality(players) not between 2 and 4
    or array_ndims(players)<>1 or array_lower(players,1)<>1
    or array_position(players,null) is not null
    or (select count(distinct x) from unnest(players) x)<>cardinality(players)
    then raise exception 'Invalid ranked roster.'; end if;
  if pool is null or jsonb_typeof(pool)<>'array' or octet_length(pool::text)>1000000 then raise exception 'Invalid track pool.'; end if;
  if jsonb_array_length(pool)<cardinality(players)*4
    or (select count(distinct x->>'id') from jsonb_array_elements(pool) x)<>jsonb_array_length(pool)
    or exists(select 1 from jsonb_array_elements(pool) x where
      coalesce(length(x->>'id'),0) not between 1 and 200
      or coalesce(x->>'category','') not in ('official','community')
      or coalesce(x->>'digest','') !~ '^[a-f0-9]{64}$') then raise exception 'Invalid track pool.'; end if;
  -- Same lock as custom Cup admission; deterministic ordering prevents crossed rosters.
  for p in select x from unnest(players) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended(p::text,774));
  end loop;
  perform public.polycup_ranked_expire();
  select * into old from public.polycup_ranked_matches where id=match_key;
  if found then
    if old.roster is distinct from players or old.track_pool is distinct from pool then raise exception 'Match ID already used.'; end if;
    return old.id;
  end if;
  select * into c from public.polycup_ranked_config where singleton;
  if not c.enabled then raise exception 'Ranked is not enabled.'; end if;
  if (select count(*) from auth.users u join public.profiles p on p.id=u.id
    where u.id=any(players) and not coalesce(u.is_anonymous,true))<>cardinality(players)
    then raise exception 'Ranked requires signed-in accounts.'; end if;
  if exists(select 1 from public.polycup_ranked_claims where player_id=any(players))
    or exists(select 1 from public.polycup_room_members m join public.polycup_rooms r on r.id=m.room
      where m.actor=any(players) and r.seen_at>now()-interval '90 seconds')
    then raise exception 'A player is already in a Cup.'; end if;
  insert into public.polycup_ranked_matches(id,host_id,roster,rules,track_pool,model_version)
    values(match_key,players[1],players,public.polycup_ranked_rules(),pool,c.model_version);
  insert into public.polycup_ranked_members(match_id,player_id) select match_key,x from unnest(players) x;
  insert into public.polycup_ranked_claims(player_id,match_id) select x,match_key from unnest(players) x;
  return match_key;
end $$;

-- Client API is limited to its own acceptance, lease, withdrawal and readback.
create function public.polycup_ranked_member(match_key uuid, instance_key uuid, action text default 'poll')
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p public.polycup_ranked_members%rowtype;
begin
  if auth.uid() is null or instance_key is null or action is null or action not in ('poll','accept','withdraw') then raise exception 'Invalid ranked request.'; end if;
  perform public.polycup_ranked_expire();
  select * into m from public.polycup_ranked_matches where id=match_key for update;
  select * into p from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid();
  if p.player_id is null then raise exception 'You are not in this ranked match.'; end if;
  if m.status in ('reserved','drafting','racing','review','disputed') then
    if p.instance_id is not null and p.instance_id<>instance_key and p.seen_at>now()-interval '35 seconds' then raise exception 'This player is active in another window.'; end if;
    if action='withdraw' then
      if m.status<>'reserved' then raise exception 'A started match retains your seat until it ends.'; end if;
      update public.polycup_ranked_matches set status='cancelled',terminal_reason='declined',finished_at=now() where id=match_key returning * into m;
      delete from public.polycup_ranked_claims where match_id=match_key;
    else
      if action='accept' and m.status<>'reserved' then raise exception 'Acceptance has closed.'; end if;
      update public.polycup_ranked_members set instance_id=instance_key,seen_at=now(),accepted=accepted or action='accept'
        where match_id=match_key and player_id=auth.uid()
          and (instance_id is distinct from instance_key or seen_at is null or seen_at<now()-interval '10 seconds' or action='accept');
    end if;
  end if;
  return jsonb_build_object('id',m.id,'status',m.status,'rules',m.rules,'roster',m.roster,
    'host_id',m.host_id,'track_pool',m.track_pool,'draft',m.draft,'deadline',m.deadline,
    'reason',m.terminal_reason,'accepted',(select coalesce(jsonb_agg(player_id),'[]') from public.polycup_ranked_members where match_id=match_key and accepted));
end $$;

create function public.polycup_ranked_advance(match_key uuid, action text, draft_data jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; picks jsonb; bans jsonb;
begin
  perform public.polycup_ranked_expire();
  select * into m from public.polycup_ranked_matches where id=match_key for update;
  if m.id is null then raise exception 'Match not found.'; end if;
  if action='draft' then
    if m.status='drafting' then return; end if;
    if m.status<>'reserved' or exists(select 1 from public.polycup_ranked_members where match_id=match_key and (not accepted or seen_at<now()-interval '35 seconds')) then raise exception 'All racers must accept.'; end if;
    update public.polycup_ranked_matches set status='drafting',deadline=now()+interval '15 minutes' where id=match_key;
  elsif action='race' then
    if m.status='racing' and m.draft=draft_data then return; end if;
    if m.status<>'drafting' then raise exception 'Match is not drafting.'; end if;
    if exists(select 1 from public.polycup_ranked_members where match_id=match_key
      and (seen_at is null or seen_at<now()-interval '35 seconds')) then raise exception 'Reconnect all racers before racing.'; end if;
    if draft_data is null or octet_length(draft_data::text)>20000 then raise exception 'Invalid draft.'; end if;
    bans:=draft_data->'bans'; picks:=draft_data->'picks';
    if jsonb_typeof(bans) is distinct from 'array' or jsonb_typeof(picks) is distinct from 'array' then raise exception 'Invalid draft.'; end if;
    if jsonb_array_length(bans)<>cardinality(m.roster)*2 or jsonb_array_length(picks)<>cardinality(m.roster)*2
      or (select count(distinct x->>'track_id') from jsonb_array_elements(bans) x)<>jsonb_array_length(bans)
      or exists(select 1 from unnest(m.roster) p where
        (select count(*) from jsonb_array_elements(bans) x where x->>'player_id'=p::text)<>2
        or (select count(*) from jsonb_array_elements(picks) x where x->>'player_id'=p::text)<>2
        or (select count(distinct x->>'track_id') from jsonb_array_elements(picks) x where x->>'player_id'=p::text)<>2)
      or exists(select 1 from jsonb_array_elements(bans||picks) x where not exists(
        select 1 from jsonb_array_elements(m.track_pool) t where t->>'id'=x->>'track_id'))
      or exists(select 1 from jsonb_array_elements(picks) x join jsonb_array_elements(bans) b on b->>'track_id'=x->>'track_id')
      then raise exception 'Draft does not match ranked rules.'; end if;
    update public.polycup_ranked_matches set status='racing',draft=draft_data,started_at=now(),deadline=now()+interval '6 hours' where id=match_key;
  elsif action in ('cancel','unrated') then
    if m.status in ('cancelled','unrated') then return; end if;
    if m.status='completed' then raise exception 'Match already rated.'; end if;
    update public.polycup_ranked_matches set status=case when started_at is null then 'cancelled' else 'unrated' end,
      terminal_reason='service_cancelled',finished_at=now() where id=match_key;
    delete from public.polycup_ranked_claims where match_id=match_key;
  else raise exception 'Unknown ranked transition.';
  end if;
end $$;

-- Recovery after a reload or sign-in on another device, without exposing the
-- other instance's lease identifier. Reclaiming still goes through member().
create function public.polycup_ranked_current()
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform public.polycup_ranked_expire();
  return (select match_id from public.polycup_ranked_claims where player_id=auth.uid());
end $$;

-- Reports are observations, never an authority to award points. Exact retries
-- are safe; a client cannot replace its submitted evidence. Array order is normalized.
create function public.polycup_ranked_report(match_key uuid, instance_key uuid, evidence jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; normalized jsonb; previous jsonb; standings jsonb;
begin
  perform public.polycup_ranked_expire();
  select * into m from public.polycup_ranked_matches where id=match_key for update;
  if auth.uid() is null or not exists(select 1 from public.polycup_ranked_members
    where match_id=match_key and player_id=auth.uid() and instance_id=instance_key)
    then raise exception 'Rejoin this ranked match first.'; end if;
  if evidence is null or octet_length(evidence::text)>20000
    or jsonb_typeof(evidence->'standings') is distinct from 'array'
    or coalesce(evidence->>'digest','') !~ '^[a-f0-9]{64}$'
    or coalesce(evidence->>'rounds','') !~ '^[1-9][0-9]{0,4}$'
    then raise exception 'Invalid result report.'; end if;
  standings:=evidence->'standings';
  if jsonb_array_length(standings)<>cardinality(m.roster)
    or (select count(distinct x->>'player_id') from jsonb_array_elements(standings) x)<>cardinality(m.roster)
    or exists(select 1 from jsonb_array_elements(standings) x where
      not (x->>'player_id'=any(m.roster::text[])) or x->>'player_id' is null
      or coalesce(x->>'place','') !~ '^[1-4]$' or (x->>'place')::integer>cardinality(m.roster)
      or coalesce(x->>'points','') !~ '^(0|[1-9][0-9]{0,2})$' or (x->>'points')::integer>140)
    or (select count(*) from jsonb_array_elements(standings) x where x->>'place'='1' and x->>'points'='140')<>1
    or (select count(*) from jsonb_array_elements(standings) x where x->>'place'='1')<>1
    then raise exception 'Result roster or placement is invalid.'; end if;
  select jsonb_build_object('digest',evidence->>'digest','rounds',(evidence->>'rounds')::integer,
    'standings',jsonb_agg(jsonb_build_object('player_id',x->>'player_id','place',(x->>'place')::integer,'points',(x->>'points')::integer) order by x->>'player_id'))
    into normalized from jsonb_array_elements(standings) x;
  select report into previous from public.polycup_ranked_reports where match_id=match_key and player_id=auth.uid();
  if previous is not null then
    if previous<>normalized then raise exception 'A submitted report cannot be replaced.'; end if;
    return m.status;
  end if;
  if m.status not in ('racing','review','disputed') then raise exception 'Match is not accepting results.'; end if;
  insert into public.polycup_ranked_reports(match_id,player_id,report) values(match_key,auth.uid(),normalized);
  update public.polycup_ranked_matches set
    status=case when (select count(distinct report) from public.polycup_ranked_reports where match_id=match_key)>1 then 'disputed' else 'review' end,
    deadline=case when status='racing' then now()+interval '10 minutes' else deadline end
    where id=match_key returning * into m;
  return m.status;
end $$;

-- The future trusted validator/model supplies a complete rating batch. It must
-- validate the transcript, finalist win and physics policy, not merely consensus.
-- Atomic compare-and-set + immutable ledger prevents retries and stale workers
-- from awarding a result twice. No formula or starting rating is invented here.
create function public.polycup_ranked_finalize(match_key uuid, model text, updates jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p uuid; item jsonb; r public.player_ratings%rowtype; prior_state jsonb; result_data jsonb;
begin
  perform public.polycup_ranked_expire();
  select * into m from public.polycup_ranked_matches where id=match_key for update;
  if m.id is null or model is distinct from m.model_version then raise exception 'Wrong match or rating model.'; end if;
  if updates is null or jsonb_typeof(updates)<>'array' or octet_length(updates::text)>20000 then raise exception 'Invalid rating batch.'; end if;
  if jsonb_array_length(updates)<>cardinality(m.roster)
    or (select count(distinct x->>'player_id') from jsonb_array_elements(updates) x)<>cardinality(m.roster)
    or exists(select 1 from jsonb_array_elements(updates) x where
      x->>'player_id' is null or not(x->>'player_id'=any(m.roster::text[]))
      or coalesce(x->>'after','') !~ '^(0|[1-9][0-9]{0,7})$'
      or not (x ? 'before' and x ? 'matches_before' and x ? 'state_before')
      or jsonb_typeof(x->'state_after') is distinct from 'object') then raise exception 'Invalid rating batch.'; end if;
  if m.status='completed' then
    if exists(select 1 from jsonb_array_elements(updates) x join public.polycup_rating_events e
      on e.match_id=match_key and e.player_id=(x->>'player_id')::uuid
      where e.rating_after is distinct from (x->>'after')::integer
        or e.rating_before is distinct from (x->>'before')::integer
        or e.matches_before is distinct from (x->>'matches_before')::integer
        or e.state_after is distinct from x->'state_after'
        or e.state_before is distinct from nullif(x->'state_before','null'::jsonb)) then raise exception 'Finalized batch differs.'; end if;
    return;
  end if;
  if m.status<>'review' or (select count(*) from public.polycup_ranked_reports where match_id=match_key)<>cardinality(m.roster)
    or (select count(distinct report) from public.polycup_ranked_reports where match_id=match_key)<>1
    then raise exception 'Complete, consistent reports are required.'; end if;
  select report into result_data from public.polycup_ranked_reports where match_id=match_key limit 1;
  for p in select x from unnest(m.roster) x order by x loop
    select * into r from public.player_ratings where player_id=p for update;
    select x into item from jsonb_array_elements(updates) x where x->>'player_id'=p::text;
    select state into prior_state from public.polycup_rating_state where player_id=p;
    if r.player_id is null or r.rating is distinct from (item->>'before')::integer
      or r.rated_matches is distinct from (item->>'matches_before')::integer
      or prior_state is distinct from nullif(item->'state_before','null'::jsonb) then raise exception 'Rating state changed. Recalculate the entire batch.'; end if;
    insert into public.polycup_rating_events(match_id,player_id,rating_before,rating_after,matches_before,model_version,state_before,state_after)
      values(match_key,p,r.rating,(item->>'after')::integer,r.rated_matches,model,prior_state,item->'state_after');
    update public.player_ratings set rating=(item->>'after')::integer,rated_matches=r.rated_matches+1,updated_at=now() where player_id=p;
    insert into public.polycup_rating_state(player_id,state) values(p,item->'state_after') on conflict(player_id) do update set state=excluded.state;
  end loop;
  update public.polycup_ranked_matches set status='completed',result=result_data,finished_at=now() where id=match_key;
  delete from public.polycup_ranked_claims where match_id=match_key;
end $$;

-- Public projection: account display name, rating and leaderboard_position only. No Discord
-- identity, auth metadata, presence, room codes, reports or model state.
-- Ties favor the earlier rating achievement, then UUID for stable pagination.
create function public.polycup_ranked_board()
returns table(player_id uuid,display_name text,rating integer,rated_matches integer,
  provisional boolean,leaderboard_position bigint,tier text,gm_position bigint)
language sql stable security definer set search_path='' as $$
 with eligible as (
   select r.*,p.display_name,c.provisional_matches,c.tier_floors,
     row_number() over(order by r.rating desc,r.updated_at,r.player_id) pos
   from public.player_ratings r join public.profiles p on p.id=r.player_id
   join auth.users u on u.id=p.id cross join public.polycup_ranked_config c
   where r.rating is not null and r.rated_matches>=c.provisional_matches
     and c.tier_floors is not null and not coalesce(u.is_anonymous,true)
 ), all_rated as (
   select r.*,p.display_name,c.provisional_matches,c.tier_floors,e.pos
   from public.player_ratings r join public.profiles p on p.id=r.player_id
   join auth.users u on u.id=p.id cross join public.polycup_ranked_config c
   left join eligible e on e.player_id=r.player_id
   where r.rating is not null and r.rated_matches>0 and not coalesce(u.is_anonymous,true)
     and c.provisional_matches is not null and c.tier_floors is not null
 ) select player_id,display_name,rating,rated_matches,rated_matches<provisional_matches,pos,
   case when rated_matches<provisional_matches then 'provisional'
     when rating>=tier_floors[6] and pos<=10 then 'grandmaster'
     when rating>=tier_floors[6] then 'master'
     when rating>=tier_floors[5] then 'diamond'
     when rating>=tier_floors[4] then 'platinum'
     when rating>=tier_floors[3] then 'gold'
     when rating>=tier_floors[2] then 'silver' else 'bronze' end,
   case when rated_matches>=provisional_matches and rating>=tier_floors[6] and pos<=10 then pos end
 from all_rated
$$;

create function public.polycup_leaderboard(page_size integer default 50,page_offset integer default 0)
returns table(player_id uuid,display_name text,rating integer,rated_matches integer,
  leaderboard_position bigint,tier text,gm_position bigint)
language sql stable security definer set search_path='' as $$
 select player_id,display_name,rating,rated_matches,leaderboard_position,tier,gm_position
 from public.polycup_ranked_board() where not provisional order by leaderboard_position
 limit greatest(1,least(coalesce(page_size,50),100)) offset greatest(0,least(coalesce(page_offset,0),10000))
$$;
create function public.polycup_ranked_profile(player_key uuid)
returns table(player_id uuid,display_name text,rating integer,rated_matches integer,
  provisional boolean,leaderboard_position bigint,tier text,gm_position bigint)
language sql stable security definer set search_path='' as $$
 select * from public.polycup_ranked_board() where player_id=player_key
$$;
create function public.polycup_ranked_history(player_key uuid,page_size integer default 20,page_offset integer default 0)
returns table(match_id uuid,finished_at timestamptz,place integer,rating_before integer,rating_after integer,model_version text)
language sql stable security definer set search_path='' as $$
 select e.match_id,m.finished_at,(s->>'place')::integer,e.rating_before,e.rating_after,e.model_version
 from public.polycup_rating_events e join public.polycup_ranked_matches m on m.id=e.match_id,
 jsonb_array_elements(m.result->'standings') s
 where e.player_id=player_key and s->>'player_id'=player_key::text and m.status='completed'
 order by m.finished_at desc,m.id
 limit greatest(1,least(coalesce(page_size,20),100)) offset greatest(0,least(coalesce(page_offset,0),10000))
$$;

-- Preserve custom Cups and guest access; only ranked participants are fenced.
create or replace function public.polycup_room(op text, room_key uuid, instance_key uuid, args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid();
begin
  if who is null then raise exception 'A guest session is required.'; end if;
  if op in ('create','join') then
    perform pg_advisory_xact_lock(hashtextextended(who::text,774));
    perform public.polycup_ranked_expire();
    if exists(select 1 from public.polycup_ranked_claims where player_id=who) then raise exception 'You are already in a ranked Cup.'; end if;
    if exists(select 1 from public.polycup_room_members m join public.polycup_rooms r on r.id=m.room
      where m.actor=who and m.room<>room_key and r.seen_at>now()-interval '90 seconds') then
      raise exception 'You are already in another Cup. Leave it before joining a different one.';
    end if;
  end if;
  return public.polycup_room_internal(op,room_key,instance_key,args);
end $$;

revoke all on function public.polycup_ranked_rules(),public.polycup_ranked_expire(),
  public.polycup_ranked_reserve(uuid,uuid[],jsonb),public.polycup_ranked_member(uuid,uuid,text),
  public.polycup_ranked_advance(uuid,text,jsonb),public.polycup_ranked_report(uuid,uuid,jsonb),
  public.polycup_ranked_finalize(uuid,text,jsonb),public.polycup_ranked_board(),
  public.polycup_ranked_current(),
  public.polycup_leaderboard(integer,integer),public.polycup_ranked_profile(uuid),
  public.polycup_ranked_history(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.polycup_ranked_expire(),public.polycup_ranked_reserve(uuid,uuid[],jsonb),
  public.polycup_ranked_advance(uuid,text,jsonb),public.polycup_ranked_finalize(uuid,text,jsonb) to service_role;
grant execute on function public.polycup_ranked_member(uuid,uuid,text),public.polycup_ranked_report(uuid,uuid,jsonb) to authenticated;
grant execute on function public.polycup_ranked_current() to authenticated;
grant execute on function public.polycup_ranked_rules(),public.polycup_leaderboard(integer,integer),
  public.polycup_ranked_profile(uuid),public.polycup_ranked_history(uuid,integer,integer) to anon,authenticated,service_role;
commit;
