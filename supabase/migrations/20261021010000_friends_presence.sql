begin;

alter table public.profiles add column discord_name text not null default '',
  add column discord_username text not null default '',
  add column avatar_url text not null default '';

create function public.polycup_identity_fields(metadata jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'discord_name', left(coalesce(nullif(metadata #>> '{custom_claims,global_name}', ''), nullif(metadata ->> 'global_name', ''), metadata ->> 'full_name', 'Player'), 80),
    'discord_username', left(coalesce(metadata ->> 'user_name', metadata ->> 'preferred_username', metadata ->> 'full_name', ''), 80),
    'avatar_url', case when length(coalesce(metadata ->> 'avatar_url',metadata ->> 'picture','')) <= 2048
      and coalesce(metadata ->> 'avatar_url',metadata ->> 'picture','') ~ '^https://(cdn[.]discordapp[.]com|media[.]discordapp[.]net)/(avatars|embed/avatars)/'
      then coalesce(metadata ->> 'avatar_url',metadata ->> 'picture','') else '' end
  );
$$;
revoke all on function public.polycup_identity_fields(jsonb) from public, anon, authenticated;

create function public.sync_polycup_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare identity_data jsonb;
begin
  identity_data := public.polycup_identity_fields(new.raw_user_meta_data);
  update public.profiles set discord_name = identity_data ->> 'discord_name',
    discord_username = identity_data ->> 'discord_username', avatar_url = identity_data ->> 'avatar_url'
    where id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_polycup_identity() from public, anon, authenticated;
-- Runs after polycup_account_created, including for new sign-ups.
create trigger polycup_identity_changed after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.sync_polycup_identity();
update public.profiles p set
  discord_name = public.polycup_identity_fields(u.raw_user_meta_data) ->> 'discord_name',
  discord_username = public.polycup_identity_fields(u.raw_user_meta_data) ->> 'discord_username',
  avatar_url = public.polycup_identity_fields(u.raw_user_meta_data) ->> 'avatar_url'
from auth.users u where u.id = p.id;

-- No direct client access to timestamps or session identifiers.
create table public.friend_presence_sessions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  last_seen timestamptz not null default now(),
  primary key(user_id,session_id)
);
alter table public.friend_presence_sessions enable row level security;
revoke all on public.friend_presence_sessions from public,anon,authenticated;
grant all on public.friend_presence_sessions to service_role;

create function public.polycup_presence_touch(session_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise insufficient_privilege using message = 'Sign in first'; end if;
  if session_key is null then raise invalid_parameter_value using message = 'Session key required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,1));
  delete from public.friend_presence_sessions where user_id=actor and last_seen < now()-interval '90 seconds';
  insert into public.friend_presence_sessions(user_id,session_id) values(actor,session_key)
  on conflict(user_id,session_id) do update set last_seen=now()
    where public.friend_presence_sessions.last_seen < now()-interval '15 seconds';
  delete from public.friend_presence_sessions where user_id=actor and session_id in (
    select session_id from public.friend_presence_sessions where user_id=actor order by last_seen desc,session_id offset 8
  );
end;
$$;
create function public.polycup_presence_leave(session_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Sign in first'; end if;
  delete from public.friend_presence_sessions where user_id=auth.uid() and session_id=session_key;
end;
$$;

create function public.polycup_friends()
returns table(friendship_id uuid,direction text,status text,player_id uuid,display_name text,
  discord_name text,discord_username text,avatar_url text,rating integer,online boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, case when f.requester_id=auth.uid() then 'outgoing' else 'incoming' end, f.status,
    p.id,p.display_name,p.discord_name,p.discord_username,p.avatar_url,r.rating,
    f.status='accepted' and exists(select 1 from public.friend_presence_sessions s
      where s.user_id=p.id and s.last_seen > now()-interval '90 seconds')
  from public.friendships f
  join public.profiles p on p.id=case when f.requester_id=auth.uid() then f.addressee_id else f.requester_id end
  left join public.player_ratings r on r.player_id=p.id
  where auth.uid() in (f.requester_id,f.addressee_id)
  order by lower(p.display_name),p.id;
$$;

create function public.polycup_find_players(search_text text)
returns table(player_id uuid,display_name text,discord_name text,discord_username text,avatar_url text,rating integer)
language sql stable security definer set search_path = '' as $$
  select p.id,p.display_name,p.discord_name,p.discord_username,p.avatar_url,r.rating
  from public.profiles p left join public.player_ratings r on r.player_id=p.id
  where auth.uid() is not null and p.id<>auth.uid()
    and char_length(btrim(search_text)) between 2 and 64
    and (strpos(lower(p.display_name),lower(btrim(search_text)))>0 or p.id::text=btrim(search_text))
  order by lower(p.display_name),p.id limit 20;
$$;

-- Bound request spam even if a sender repeatedly cancels and re-sends.
create table public.friend_request_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(),
  requests integer not null default 0
);
alter table public.friend_request_limits enable row level security;
revoke all on public.friend_request_limits from public,anon,authenticated;
grant all on public.friend_request_limits to service_role;
create function public.limit_polycup_friend_requests()
returns trigger language plpgsql security definer set search_path = '' as $$
declare count_now integer;
begin
  if auth.uid() is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,2));
  if (select count(*) from public.friendships where requester_id=auth.uid() and status='pending')>=20 then
    raise exception using errcode='P0001',message='You already have 20 pending friend requests.';
  end if;
  insert into public.friend_request_limits(user_id,requests) values(auth.uid(),1)
  on conflict(user_id) do update set
    requests=case when public.friend_request_limits.window_start < now()-interval '1 minute' then 1 else public.friend_request_limits.requests+1 end,
    window_start=case when public.friend_request_limits.window_start < now()-interval '1 minute' then now() else public.friend_request_limits.window_start end
  returning requests into count_now;
  if count_now>10 then raise exception using errcode='P0001',message='Too many friend requests. Try again in a minute.'; end if;
  return new;
end;
$$;
revoke all on function public.limit_polycup_friend_requests() from public,anon,authenticated;
create trigger polycup_request_limit before insert on public.friendships
  for each row execute function public.limit_polycup_friend_requests();

revoke all on function public.polycup_presence_touch(uuid),public.polycup_presence_leave(uuid),
  public.polycup_friends(),public.polycup_find_players(text) from public,anon,authenticated;
grant execute on function public.polycup_presence_touch(uuid),public.polycup_presence_leave(uuid),
  public.polycup_friends(),public.polycup_find_players(text) to authenticated;
commit;
