begin;
create function public.polycup_friends_leaderboard(page_size integer default 50,page_offset integer default 0)
returns table(player_id uuid,display_name text,rating integer,rated_matches integer,leaderboard_position bigint,tier text,gm_position bigint,friend_position bigint)
language sql stable security definer set search_path='' as $$
 select b.player_id,b.display_name,b.rating,b.rated_matches,b.leaderboard_position,b.tier,b.gm_position,
 row_number() over(order by b.leaderboard_position) friend_position
 from public.polycup_ranked_board() b where not b.provisional and auth.uid() is not null
 and (b.player_id=auth.uid() or exists(select 1 from public.friendships f where f.status='accepted' and
 ((f.requester_id=auth.uid() and f.addressee_id=b.player_id) or (f.addressee_id=auth.uid() and f.requester_id=b.player_id))))
 order by b.leaderboard_position limit greatest(1,least(coalesce(page_size,50),100)) offset greatest(0,least(coalesce(page_offset,0),10000))
$$;
revoke all on function public.polycup_friends_leaderboard(integer,integer) from public,anon;
grant execute on function public.polycup_friends_leaderboard(integer,integer) to authenticated;
commit;
