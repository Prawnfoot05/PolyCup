-- Local preparation only. Account-scoped delivery receipts, never rating writes.
begin;
create table public.polycup_ranked_result_receipts (
 match_id uuid not null,
 player_id uuid not null references public.profiles(id) on delete cascade,
 seen_at timestamptz,
 delivery_owner uuid,
 delivery_until timestamptz,
 primary key(match_id,player_id),
 foreign key(match_id,player_id) references public.polycup_rating_events(match_id,player_id) on delete cascade
);
alter table public.polycup_ranked_result_receipts enable row level security;
revoke all on public.polycup_ranked_result_receipts from public,anon,authenticated;
grant all on public.polycup_ranked_result_receipts to service_role;
-- Installing notifications must not replay a player's entire historical career.
insert into public.polycup_ranked_result_receipts(match_id,player_id,seen_at)
 select e.match_id,e.player_id,now() from public.polycup_rating_events e
 join public.polycup_ranked_matches m on m.id=e.match_id where m.status='completed';

create function public.polycup_ranked_claim_result(delivery_key uuid,match_key uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); chosen uuid;
begin
 if who is null or delivery_key is null then raise exception 'Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(who::text,778));
 if exists(select 1 from public.polycup_ranked_result_receipts r where r.player_id=who and r.seen_at is null
   and r.delivery_until>now() and r.delivery_owner<>delivery_key) then return null; end if;
 select e.match_id into chosen from public.polycup_rating_events e
 join public.polycup_ranked_matches m on m.id=e.match_id
 left join public.polycup_ranked_result_receipts r on r.match_id=e.match_id and r.player_id=e.player_id
 where e.player_id=who and m.status='completed' and r.seen_at is null
   and (match_key is null or e.match_id=match_key)
 order by m.finished_at,m.id limit 1;
 if chosen is null then return null; end if;
 insert into public.polycup_ranked_result_receipts(match_id,player_id,delivery_owner,delivery_until)
 values(chosen,who,delivery_key,now()+interval '2 minutes')
 on conflict(match_id,player_id) do update set delivery_owner=excluded.delivery_owner,delivery_until=excluded.delivery_until;
 return chosen;
end $$;
revoke all on function public.polycup_ranked_claim_result(uuid,uuid) from public,anon;
grant execute on function public.polycup_ranked_claim_result(uuid,uuid) to authenticated;

create function public.polycup_ranked_seen_result(match_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid();
begin
 if who is null then raise exception 'Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(who::text,778));
 if not exists(select 1 from public.polycup_rating_events e join public.polycup_ranked_matches m on m.id=e.match_id
   where e.match_id=match_key and e.player_id=who and m.status='completed') then raise exception 'No settled result for this player.'; end if;
 insert into public.polycup_ranked_result_receipts(match_id,player_id,seen_at) values(match_key,who,now())
 on conflict(match_id,player_id) do update set seen_at=coalesce(polycup_ranked_result_receipts.seen_at,excluded.seen_at),delivery_owner=null,delivery_until=null;
end $$;
revoke all on function public.polycup_ranked_seen_result(uuid) from public,anon;
grant execute on function public.polycup_ranked_seen_result(uuid) to authenticated;
commit;
