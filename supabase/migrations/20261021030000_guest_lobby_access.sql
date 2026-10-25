begin;

-- Public listings and their join codes are intentionally visible without a login.
-- Listing changes still require an owned authenticated (Discord or guest) identity.
create or replace function public.polycup_lobbies()
returns table(host_id uuid,cup_id text,host_name text,title text,mod_version text,phase text,players integer,capacity integer)
language sql stable security definer set search_path = '' as $$
  select l.host_id,l.cup_id,p.display_name,l.title,l.mod_version,l.phase,l.players,l.capacity
  from public.polycup_lobby_listings l join public.profiles p on p.id=l.host_id
  where l.updated_at>now()-interval '90 seconds' and l.invite_expires_at>now()
  order by case l.phase when 'waiting' then 0 when 'drafting' then 1 else 2 end,l.updated_at desc,l.host_id
  limit 100;
$$;
create or replace function public.polycup_join_lobby(host_key uuid, expected_cup text, client_version text)
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  select invite_code into code from public.polycup_lobby_listings
  where host_id=host_key and updated_at>now()-interval '90 seconds' and invite_expires_at>now()
    and players<capacity and mod_version=client_version and cup_id=expected_cup;
  if code is null then raise exception using errcode='P0001',message='Lobby unavailable. Refresh and try again.'; end if;
  return code;
end;
$$;
grant execute on function public.polycup_lobbies() to anon;
grant execute on function public.polycup_join_lobby(uuid,text,text) to anon;
commit;
