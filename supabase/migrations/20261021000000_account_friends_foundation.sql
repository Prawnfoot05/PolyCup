-- PolyCup 0.4 account foundation. Does not enable matchmaking or change the mod.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (
    char_length(display_name) between 1 and 32
    and display_name = btrim(display_name)
    and display_name !~ '[[:cntrl:]]'
  ),
  created_at timestamptz not null default now()
);

create table public.player_ratings (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  -- NULL is unranked. Rating rules and trusted match validation are future work.
  rating integer check (rating is null or rating >= 0),
  rated_matches integer not null default 0 check (rated_matches >= 0),
  updated_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint friendships_different_players check (requester_id <> addressee_id)
);
create unique index friendships_one_pair on public.friendships (
  least(requester_id, addressee_id), greatest(requester_id, addressee_id)
);
create index friendships_requester on public.friendships(requester_id);
create index friendships_addressee on public.friendships(addressee_id);

alter table public.profiles enable row level security;
alter table public.player_ratings enable row level security;
alter table public.friendships enable row level security;

-- Explicit grants also remove broader Supabase default table privileges.
revoke all on public.profiles, public.player_ratings, public.friendships
  from public, anon, authenticated;
grant select on public.profiles, public.player_ratings, public.friendships to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert (requester_id, addressee_id) on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;
grant delete on public.friendships to authenticated;
grant all on public.profiles, public.player_ratings, public.friendships to service_role;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_edit_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy ratings_read on public.player_ratings for select to authenticated using (true);

create policy friendships_read_participant on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
create policy friendships_request_as_self on public.friendships for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending');
create policy friendships_accept_as_recipient on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid()) and status = 'pending')
  with check (addressee_id = (select auth.uid()) and status = 'accepted');
create policy friendships_delete_participant on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

create function public.create_polycup_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_name text;
begin
  initial_name := coalesce(
    new.raw_user_meta_data ->> 'global_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'user_name',
    'Player'
  );
  initial_name := btrim(left(btrim(regexp_replace(initial_name, '[[:cntrl:]]', '', 'g')), 32));
  if initial_name = '' then initial_name := 'Player'; end if;
  insert into public.profiles(id, display_name) values (new.id, initial_name);
  insert into public.player_ratings(player_id) values (new.id);
  return new;
end;
$$;
revoke all on function public.create_polycup_account() from public, anon, authenticated;
create trigger polycup_account_created after insert on auth.users
  for each row execute function public.create_polycup_account();

-- Support accounts created while configuring OAuth, without overwriting profiles.
insert into public.profiles(id, display_name)
select id, coalesce(nullif(btrim(left(btrim(regexp_replace(coalesce(
  raw_user_meta_data ->> 'global_name', raw_user_meta_data ->> 'full_name',
  raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'user_name', 'Player'
), '[[:cntrl:]]', '', 'g')), 32)), ''), 'Player')
from auth.users on conflict (id) do nothing;
insert into public.player_ratings(player_id)
select id from public.profiles on conflict (player_id) do nothing;

commit;
