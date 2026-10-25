-- Public summary of completed, rated Cups only. No model state or reports exposed.
begin;
create index if not exists polycup_rating_events_player_matches on public.polycup_rating_events(player_id,match_id);
create function public.polycup_ranked_stats(player_key uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with results as (
   select exists(select 1 from jsonb_array_elements(m.result->'standings') s
     where s->>'player_id'=player_key::text and (s->>'place')::integer=1) as won
   from public.polycup_rating_events e join public.polycup_ranked_matches m on m.id=e.match_id
   where e.player_id=player_key and m.status='completed'
 ), totals as (select count(*) as matches,count(*) filter(where won) as wins from results)
 select jsonb_build_object('matches',matches,'wins',wins,
   'win_rate',case when matches>0 then round(100.0*wins/matches,1) else null end) from totals
$$;
revoke all on function public.polycup_ranked_stats(uuid) from public;
grant execute on function public.polycup_ranked_stats(uuid) to anon,authenticated,service_role;
commit;
