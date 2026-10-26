begin;
create function public.polycup_season_leaderboard(season_key text,friends_only boolean default false,page_size integer default 50,page_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
 with events as (
  select e.*,row_number() over(partition by e.player_id order by e.created_at desc,e.match_id desc) recent,
   count(*) over(partition by e.player_id)::integer season_matches
  from public.polycup_rating_events e join public.polycup_ranked_matches m on m.id=e.match_id where m.season_id=season_key
 ), eligible as (
  select e.player_id,p.display_name,e.rating_after rating,e.season_matches rated_matches,s.tier_floors,
   row_number() over(order by e.rating_after desc,e.created_at,e.player_id) pos
  from events e join public.profiles p on p.id=e.player_id join auth.users u on u.id=p.id
  join public.polycup_ranked_seasons s on s.id=season_key
  where e.recent=1 and e.matches_before+1>=s.provisional_matches and not coalesce(u.is_anonymous,true)
 ), ranked as (
  select player_id,display_name,rating,rated_matches,pos leaderboard_position,
   case when rating>=tier_floors[6] and pos<=10 then 'grandmaster' when rating>=tier_floors[6] then 'master'
    when rating>=tier_floors[5] then 'diamond' when rating>=tier_floors[4] then 'platinum'
    when rating>=tier_floors[3] then 'gold' when rating>=tier_floors[2] then 'silver' else 'bronze' end tier,
   case when rating>=tier_floors[6] and pos<=10 then pos end gm_position
  from eligible
 ), page as (
 select * from ranked b where not friends_only or (auth.uid() is not null and (b.player_id=auth.uid() or exists(
  select 1 from public.friendships f where f.status='accepted' and
  ((f.requester_id=auth.uid() and f.addressee_id=b.player_id) or (f.addressee_id=auth.uid() and f.requester_id=b.player_id)))))
 order by leaderboard_position limit greatest(1,least(coalesce(page_size,50),100)) offset greatest(0,least(coalesce(page_offset,0),10000))
 ) select coalesce(jsonb_agg(to_jsonb(page) order by leaderboard_position),'[]') from page
$$;
revoke all on function public.polycup_season_leaderboard(text,boolean,integer,integer) from public;
grant execute on function public.polycup_season_leaderboard(text,boolean,integer,integer) to anon,authenticated,service_role;

-- A started season is immutable; only its closing timestamp can change.
create function public.polycup_season_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if old.starts_at is not null and (to_jsonb(new)-'ends_at') is distinct from (to_jsonb(old)-'ends_at') then
  raise exception 'Started season rules and catalog are frozen.';
 end if;
 if old.ends_at is not null and new.ends_at is distinct from old.ends_at then raise exception 'Season is already closed.'; end if;
 return new;
end $$;
create trigger polycup_season_immutable before update on public.polycup_ranked_seasons for each row execute function public.polycup_season_immutable();
revoke all on function public.polycup_season_immutable() from public,anon,authenticated;
commit;
