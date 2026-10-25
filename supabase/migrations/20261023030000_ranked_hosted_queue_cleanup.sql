-- Hosted PostgREST enables safeupdate: intentional disabled-queue cleanup must
-- have an explicit predicate. Preserve the server setting and RPC grants.
begin;
create or replace function public.polycup_queue_tick()
returns void language plpgsql security definer set search_path='' as $$
declare c public.polycup_queue_config%rowtype; anchor public.polycup_ranked_queue%rowtype;
 candidate public.polycup_ranked_queue%rowtype; selected uuid[]; match_key uuid; oldest timestamptz; formations integer:=0;
begin
 perform pg_advisory_xact_lock(777,1);
 perform public.polycup_ranked_expire();
 select * into c from public.polycup_queue_config where singleton;
 delete from public.polycup_ranked_queue q where q.seen_at<=now()-interval '35 seconds'
   or q.version<>c.version or exists(select 1 from public.polycup_ranked_claims where player_id=q.player_id)
   or exists(select 1 from public.polycup_room_members m join public.polycup_rooms r on r.id=m.room
      where m.actor=q.player_id and r.seen_at>now()-interval '90 seconds');
 if not c.enabled or not (select enabled from public.polycup_ranked_config where singleton) then
   delete from public.polycup_ranked_queue where player_id is not null; return;
 end if;
 for anchor in select * from public.polycup_ranked_queue order by joined_at,player_id limit 100 loop
   if not exists(select 1 from public.polycup_ranked_queue where player_id=anchor.player_id) then continue; end if;
   selected:=array[anchor.player_id];
   for candidate in select * from public.polycup_ranked_queue where player_id<>anchor.player_id order by joined_at,player_id limit 100 loop
     if not exists(select 1 from public.polycup_ranked_queue q where q.player_id=any(selected)
       and abs(q.skill-candidate.skill)>least(public.polycup_queue_tolerance(q.joined_at,c),public.polycup_queue_tolerance(candidate.joined_at,c))) then
       selected:=array_append(selected,candidate.player_id);
       if cardinality(selected)=4 then exit; end if;
     end if;
   end loop;
   -- Every chosen player must have waited for a reduced-size match. Do not drag
   -- a new arrival straight into a duel because somebody else waited longer.
   if cardinality(selected)<4 then
     select array_agg(player_id order by joined_at,player_id) into selected
       from public.polycup_ranked_queue where player_id=any(selected)
       and joined_at<=now()-make_interval(secs=>c.three_after);
     if coalesce(cardinality(selected),0)<3 then
       select array_agg(player_id order by joined_at,player_id) into selected
         from public.polycup_ranked_queue where player_id=any(selected)
         and joined_at<=now()-make_interval(secs=>c.two_after);
     end if;
   end if;
   if coalesce(cardinality(selected),0)<2 then continue; end if;
   match_key:=gen_random_uuid();
   perform public.polycup_ranked_reserve(match_key,selected,c.catalog);
   update public.polycup_ranked_members m set instance_id=q.instance_id,seen_at=q.seen_at
     from public.polycup_ranked_queue q where m.match_id=match_key and m.player_id=q.player_id;
   update public.polycup_ranked_matches set deadline=now()+make_interval(secs=>c.accept_seconds) where id=match_key;
   delete from public.polycup_ranked_queue where player_id=any(selected);
   formations:=formations+1;
   if formations>=8 then exit; end if;
 end loop;
end $$;
revoke all on function public.polycup_queue_tick() from public,anon,authenticated;
grant execute on function public.polycup_queue_tick() to service_role;


commit;
