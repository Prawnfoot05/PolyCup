begin;
create or replace function public.polycup_ranked_board()
returns table(player_id uuid,display_name text,rating integer,rated_matches integer,
  provisional boolean,leaderboard_position bigint,tier text,gm_position bigint)
language sql stable security definer set search_path='' as $$
 with eligible as (
   select r.*,p.display_name,c.provisional_matches,c.tier_floors,
     row_number() over(order by r.rating desc,r.updated_at,r.player_id) pos
   from public.player_ratings r join public.profiles p on p.id=r.player_id
   join auth.users u on u.id=p.id cross join public.polycup_ranked_config c
   where (c.season_id is null or exists(select 1 from public.polycup_rating_events se join public.polycup_ranked_matches sm on sm.id=se.match_id where se.player_id=r.player_id and sm.season_id=c.season_id))
     and r.rating is not null and r.rated_matches>=c.provisional_matches
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

create or replace function public.polycup_leaderboard(page_size integer default 50,page_offset integer default 0)
returns table(player_id uuid,display_name text,rating integer,rated_matches integer,
  leaderboard_position bigint,tier text,gm_position bigint)
language sql stable security definer set search_path='' as $$
 select player_id,display_name,rating,rated_matches,leaderboard_position,tier,gm_position
 from public.polycup_ranked_board() where not provisional and leaderboard_position is not null order by leaderboard_position
 limit greatest(1,least(coalesce(page_size,50),100)) offset greatest(0,least(coalesce(page_offset,0),10000))
$$;
create or replace function public.polycup_friends_leaderboard(page_size integer default 50,page_offset integer default 0)
returns table(player_id uuid,display_name text,rating integer,rated_matches integer,leaderboard_position bigint,tier text,gm_position bigint,friend_position bigint)
language sql stable security definer set search_path='' as $$
 select b.player_id,b.display_name,b.rating,b.rated_matches,b.leaderboard_position,b.tier,b.gm_position,
 row_number() over(order by b.leaderboard_position) friend_position
 from public.polycup_ranked_board() b where not b.provisional and b.leaderboard_position is not null and auth.uid() is not null
 and (b.player_id=auth.uid() or exists(select 1 from public.friendships f where f.status='accepted' and
 ((f.requester_id=auth.uid() and f.addressee_id=b.player_id) or (f.addressee_id=auth.uid() and f.requester_id=b.player_id))))
 order by b.leaderboard_position limit greatest(1,least(coalesce(page_size,50),100)) offset greatest(0,least(coalesce(page_offset,0),10000))
$$;

alter function public.polycup_ranked_match(uuid) rename to polycup_ranked_match_before_seasons;
revoke all on function public.polycup_ranked_match_before_seasons(uuid) from public,anon,authenticated,service_role;
create function public.polycup_ranked_match(match_key uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.polycup_ranked_match_before_seasons(match_key) || jsonb_build_object('season',
  (select jsonb_build_object('id',s.id,'name',s.name) from public.polycup_ranked_matches m join public.polycup_ranked_seasons s on s.id=m.season_id where m.id=match_key))
$$;
revoke all on function public.polycup_ranked_match(uuid) from public;
grant execute on function public.polycup_ranked_match(uuid) to anon,authenticated,service_role;
commit;
