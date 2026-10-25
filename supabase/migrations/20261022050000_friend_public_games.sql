begin;
-- Only accepted friends in a currently public, live custom Cup expose activity.
create function public.polycup_friend_public_game(friend_key uuid)
returns table(code text,activity text) language sql stable security definer set search_path='' as $$
 select r.code,case when r.data->'launch'->>'stage'='racing' then 'racing' else 'lobby' end
 from public.polycup_room_members m join public.polycup_rooms r on r.id=m.room
 where m.actor=friend_key and m.seen_at>now()-interval '35 seconds'
 and r.seen_at>now()-interval '90 seconds' and r.data->>'public'='true'
 and coalesce(r.data->'launch'->>'stage','') not in ('connecting','grace')
 and not auth.uid()=any(r.blocked)
 and (select count(*) from public.polycup_room_members x where x.room=r.id)<16
 and exists(select 1 from public.friendships f where f.status='accepted' and
   ((f.requester_id=auth.uid() and f.addressee_id=friend_key) or (f.addressee_id=auth.uid() and f.requester_id=friend_key)))
 order by r.seen_at desc limit 1
$$;
revoke all on function public.polycup_friend_public_game(uuid) from public,anon,authenticated;
create function public.polycup_friends_v2()
returns table(friendship_id uuid,direction text,status text,player_id uuid,display_name text,
 discord_name text,discord_username text,avatar_url text,rating integer,online boolean,activity text,can_join boolean)
language sql stable security definer set search_path='' as $$
 select f.friendship_id,f.direction,f.status,f.player_id,f.display_name,f.discord_name,f.discord_username,f.avatar_url,f.rating,
 f.online or g.code is not null,g.activity,g.code is not null
 from public.polycup_friends() f left join lateral public.polycup_friend_public_game(f.player_id) g on true
$$;
create function public.polycup_friend_game(friend_key uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare code text;
begin
 select g.code into code from public.polycup_friend_public_game(friend_key) g;
 if code is null then raise exception 'This friend is no longer in a joinable public Cup.'; end if;
 return code;
end $$;
revoke all on function public.polycup_friends_v2(),public.polycup_friend_game(uuid) from public,anon;
grant execute on function public.polycup_friends_v2(),public.polycup_friend_game(uuid) to authenticated;
commit;
