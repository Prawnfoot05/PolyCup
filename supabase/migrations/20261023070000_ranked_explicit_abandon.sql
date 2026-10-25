begin;

-- Explicit consent ends the reconnect grace immediately. The match key and
-- instance fence prevent a stale popup from abandoning another match/window.
create function public.polycup_ranked_abandon(match_key uuid, instance_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare m public.polycup_ranked_matches%rowtype; p public.polycup_ranked_members%rowtype;
begin
 perform pg_advisory_xact_lock(777,1);
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 select * into p from public.polycup_ranked_members where match_id=match_key and player_id=auth.uid() for update;
 if p.player_id is null or instance_key is null or p.instance_id is distinct from instance_key then
   raise exception 'Reopen this ranked match in its original window first.';
 end if;
 if p.abandoned_at is not null then return; end if;
 if exists(select 1 from public.polycup_ranked_transcripts where match_id=match_key and player_id=auth.uid()) then
   raise exception 'Your result is already submitted. Wait for settlement.';
 end if;
 if m.status<>'racing' then raise exception 'This ranked Cup is no longer racing.'; end if;
 update public.polycup_ranked_members set left_at=coalesce(left_at,now()),
   disconnected_since=coalesce(disconnected_since,now()),abandoned_at=now()
   where match_id=match_key and player_id=auth.uid();
 perform public.polycup_ranked_expire();
 -- Existing settlement owns all rating writes and duplicate protection.
end $$;
revoke all on function public.polycup_ranked_abandon(uuid,uuid) from public,anon;
grant execute on function public.polycup_ranked_abandon(uuid,uuid) to authenticated;

alter function public.polycup_queue(text,uuid,text) rename to polycup_queue_before_reconnect_choice;
revoke all on function public.polycup_queue_before_reconnect_choice(text,uuid,text) from public,anon,authenticated,service_role;
create function public.polycup_queue(action text,instance_key uuid,client_version text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare response jsonb; m public.polycup_ranked_matches%rowtype;
begin
 response:=public.polycup_queue_before_reconnect_choice(action,instance_key,client_version);
 if response->>'state'='matched' then
   select * into m from public.polycup_ranked_matches where id=(response->'match'->>'id')::uuid;
   response:=jsonb_set(response,'{match}',response->'match'||jsonb_build_object(
     'is_host',m.host_id=auth.uid(),
     'result_submitted',exists(select 1 from public.polycup_ranked_transcripts where match_id=m.id and player_id=auth.uid()),
     'can_reconnect',m.status='racing' and m.host_id<>auth.uid()
       and not coalesce((response->'match'->>'host_disconnected')::boolean,false)
       and not coalesce((response->'match'->>'abandoned')::boolean,false)));
 end if;
 return response;
end $$;
revoke all on function public.polycup_queue(text,uuid,text) from public,anon;
grant execute on function public.polycup_queue(text,uuid,text) to authenticated;
commit;
