begin;

-- Listings are host announcements, never trusted match results or rating evidence.
create table public.polycup_lobby_listings (
  host_id uuid primary key references public.profiles(id) on delete cascade,
  instance_id uuid not null,
  cup_id text not null,
  title text not null,
  invite_code text not null,
  mod_version text not null,
  phase text not null,
  players integer not null,
  capacity integer not null,
  invite_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.polycup_lobby_listings enable row level security;
revoke all on public.polycup_lobby_listings from public, anon, authenticated;
grant all on public.polycup_lobby_listings to service_role;

create function public.polycup_list_lobby(instance_key uuid, cup_key text, lobby_title text,
  code text, version text, stage text, player_count integer, player_limit integer, invite_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing public.polycup_lobby_listings;
begin
  if actor is null then raise insufficient_privilege using message='Sign in first'; end if;
  if instance_key is null or cup_key is null or length(cup_key) not between 1 and 100
    or lobby_title is null or length(btrim(lobby_title)) not between 1 and 80 or lobby_title ~ '[[:cntrl:]]'
    or code is null or code !~ '^[A-Z0-9]{8}$'
    or version is null or version !~ '^[a-zA-Z0-9.+-]{1,40}$'
    or stage is null or stage not in ('waiting','drafting','racing')
    or player_count is null or player_limit is null or player_limit not between 2 and 16
    or player_count not between 1 and player_limit
    or invite_seconds is null or invite_seconds not between 1 and 3600
    then raise invalid_parameter_value using message='Invalid lobby'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,2));
  select * into existing from public.polycup_lobby_listings where host_id=actor;
  if existing.host_id is not null and existing.instance_id<>instance_key
    and existing.updated_at>now()-interval '90 seconds' and existing.invite_expires_at>now()
    then raise exception using errcode='P0001',message='Another window is already listing a lobby'; end if;
  insert into public.polycup_lobby_listings values(actor,instance_key,cup_key,btrim(lobby_title),code,version,stage,
    player_count,player_limit,now()+make_interval(secs=>invite_seconds),now())
  on conflict(host_id) do update set instance_id=excluded.instance_id,cup_id=excluded.cup_id,title=excluded.title,
    invite_code=excluded.invite_code,mod_version=excluded.mod_version,phase=excluded.phase,players=excluded.players,
    capacity=excluded.capacity,invite_expires_at=excluded.invite_expires_at,updated_at=now();
end;
$$;
create function public.polycup_unlist_lobby(instance_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise insufficient_privilege using message='Sign in first'; end if;
  delete from public.polycup_lobby_listings where host_id=auth.uid() and instance_id=instance_key;
end;
$$;
create function public.polycup_lobbies()
returns table(host_id uuid,cup_id text,host_name text,title text,mod_version text,phase text,players integer,capacity integer)
language sql stable security definer set search_path = '' as $$
  select l.host_id,l.cup_id,p.display_name,l.title,l.mod_version,l.phase,l.players,l.capacity
  from public.polycup_lobby_listings l join public.profiles p on p.id=l.host_id
  where auth.uid() is not null and l.updated_at>now()-interval '90 seconds' and l.invite_expires_at>now()
  order by case l.phase when 'waiting' then 0 when 'drafting' then 1 else 2 end,l.updated_at desc,l.host_id
  limit 100;
$$;
create function public.polycup_join_lobby(host_key uuid, expected_cup text, client_version text)
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if auth.uid() is null then raise insufficient_privilege using message='Sign in first'; end if;
  select invite_code into code from public.polycup_lobby_listings
  where host_id=host_key and updated_at>now()-interval '90 seconds' and invite_expires_at>now()
    and players<capacity and mod_version=client_version and cup_id=expected_cup;
  if code is null then raise exception using errcode='P0001',message='Lobby unavailable. Refresh and try again.'; end if;
  return code;
end;
$$;
revoke all on function public.polycup_list_lobby(uuid,text,text,text,text,text,integer,integer,integer) from public,anon;
revoke all on function public.polycup_unlist_lobby(uuid) from public,anon;
revoke all on function public.polycup_lobbies() from public,anon;
revoke all on function public.polycup_join_lobby(uuid,text,text) from public,anon;
grant execute on function public.polycup_list_lobby(uuid,text,text,text,text,text,integer,integer,integer) to authenticated;
grant execute on function public.polycup_unlist_lobby(uuid) to authenticated;
grant execute on function public.polycup_lobbies() to authenticated;
grant execute on function public.polycup_join_lobby(uuid,text,text) to authenticated;
commit;
