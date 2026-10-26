begin;
-- Name the initial ranked season before activation; preserve its stable internal key.
update public.polycup_ranked_seasons set name='Season 0'
where id='season-1' and starts_at is null;
commit;
