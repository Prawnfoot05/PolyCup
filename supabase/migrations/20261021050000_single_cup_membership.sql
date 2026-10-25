begin;

-- Keep the existing room protocol, but serialize admission across all rooms
-- for one account. A disconnected member retains their seat until they leave
-- or the room's host lease expires; reconnecting to that room remains allowed.
alter function public.polycup_room(text,uuid,uuid,jsonb) rename to polycup_room_internal;
revoke all on function public.polycup_room_internal(text,uuid,uuid,jsonb) from public,anon,authenticated;

create function public.polycup_room(op text, room_key uuid, instance_key uuid, args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who uuid := auth.uid();
begin
  if who is null then raise exception 'A guest session is required.'; end if;
  if op in ('create','join') then
    perform pg_advisory_xact_lock(hashtextextended(who::text,774));
    if exists (
      select 1 from public.polycup_room_members m
      join public.polycup_rooms r on r.id=m.room
      where m.actor=who and m.room<>room_key
        and r.seen_at>now()-interval '90 seconds'
    ) then
      raise exception 'You are already in another Cup. Leave it before joining a different one.';
    end if;
  end if;
  return public.polycup_room_internal(op,room_key,instance_key,args);
end $$;
revoke all on function public.polycup_room(text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.polycup_room(text,uuid,uuid,jsonb) to authenticated;

commit;
