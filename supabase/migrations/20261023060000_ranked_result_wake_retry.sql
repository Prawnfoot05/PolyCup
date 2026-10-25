-- Retry a missed best-effort result wake from the participant's existing poll.
-- Uses the same in-flight receipt and backoff as Cron; no extra client polling.
begin;
create or replace function public.polycup_ranked_result_status(match_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid()) then raise exception 'Match member required.'; end if;
 perform public.polycup_ranked_expire();
 if public.polycup_ranked_result_ready(match_key) then
  begin
   perform public.polycup_ranked_dispatch_tick();
  exception when others then
   -- Status stays readable during a dispatch outage. Cron remains a fallback.
   null;
  end;
 end if;
 return (select jsonb_build_object('status',status,'reason',terminal_reason) from public.polycup_ranked_matches where id=match_key);
end $$;
revoke all on function public.polycup_ranked_result_status(uuid) from public,anon;
grant execute on function public.polycup_ranked_result_status(uuid) to authenticated;
commit;
