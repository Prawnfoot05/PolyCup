-- One authorized batch for a lobby; clients cache it instead of reading each profile every poll.
begin;
create function public.polycup_lobby_ranks(room_key uuid,instance_key uuid,ranked boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Join this lobby first.'; end if;
 if ranked then
  if not exists(select 1 from public.polycup_ranked_members where match_id=room_key and player_id=auth.uid() and instance_id=instance_key) then raise exception 'Join this lobby first.'; end if;
  select jsonb_object_agg(array_position(m.roster,r.player_id),case when b.player_id is null then 'null'::jsonb else to_jsonb(b) end) into result
  from public.polycup_ranked_members r join public.polycup_ranked_matches m on m.id=r.match_id
  left join public.polycup_ranked_board() b on b.player_id=r.player_id where r.match_id=room_key;
 else
  if not exists(select 1 from public.polycup_room_members where room=room_key and actor=auth.uid() and instance=instance_key) then raise exception 'Join this lobby first.'; end if;
  select jsonb_object_agg(r.member_id,case when b.player_id is null then 'null'::jsonb else to_jsonb(b) end) into result
  from public.polycup_room_members r left join public.polycup_ranked_board() b on b.player_id=r.actor where r.room=room_key;
 end if;
 return coalesce(result,'{}');
end $$;
revoke all on function public.polycup_lobby_ranks(uuid,uuid,boolean) from public,anon;
grant execute on function public.polycup_lobby_ranks(uuid,uuid,boolean) to authenticated;
commit;
