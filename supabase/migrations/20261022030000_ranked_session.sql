-- Ranked draft and native handoff. All choices are validated against the reservation.
begin;
alter table public.polycup_ranked_matches add column session jsonb;
alter table public.polycup_ranked_members add column ticket uuid not null default gen_random_uuid(), add column ticket_instance uuid, add column native_id integer, add column launch_id text;
create function public.polycup_ranked_session(match_key uuid,instance_key uuid,action text default 'poll',value jsonb default 'null')
returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); m public.polycup_ranked_matches%rowtype; p public.polycup_ranked_members%rowtype;
 s jsonb; item jsonb; chosen text; count_p integer; now_ms bigint:=floor(extract(epoch from now())*1000); bound uuid; seq integer;
begin
 if who is null or instance_key is null or action is null or octet_length(coalesce(value,'null')::text)>2048 then raise exception 'Invalid ranked request.'; end if;
 -- Same lock order as queue polling and reservations.
 perform pg_advisory_xact_lock(777,1);
 perform public.polycup_ranked_member(match_key,instance_key,'poll');
 select * into m from public.polycup_ranked_matches where id=match_key for update;
 if m.status not in ('drafting','racing') then return null; end if;
 select * into p from public.polycup_ranked_members where match_id=match_key and player_id=who;
 if p.ticket_instance is distinct from instance_key then
  update public.polycup_ranked_members set ticket=gen_random_uuid(),ticket_instance=instance_key where match_id=match_key and player_id=who returning * into p;
 end if;
 s:=coalesce(m.session,jsonb_build_object('bans','[]'::jsonb,'picks','[]'::jsonb,'ready','[]'::jsonb,'chat','[]'::jsonb,'launch',null,'revision',0));
 chosen:=value#>>'{}';
 if action='leave' then
  if m.started_at is null or who=m.host_id then perform public.polycup_ranked_advance(match_key,'cancel');
  else update public.polycup_ranked_members set seen_at=now()-interval '36 seconds' where match_id=match_key and player_id=who; end if;
  return null;
 elsif action='chat' then
  if jsonb_typeof(value)<>'string' or length(chosen) not between 1 and 400 then raise exception 'Use 1-400 characters.'; end if;
  select coalesce(max((x->>'seq')::integer),0)+1 into seq from jsonb_array_elements(s->'chat') x;
  s:=jsonb_set(s,'{chat}',(s->'chat')||jsonb_build_array(jsonb_build_object('seq',seq,'at',now_ms,'speaker',array_position(m.roster,who),'color',array_position(m.roster,who)%8,'name',(select display_name from public.profiles where id=who),'text',chosen)));
  if jsonb_array_length(s->'chat')>100 then s:=jsonb_set(s,'{chat}',(s->'chat')-0); end if;
 elsif action in ('ban','pick','remove-pick','draft-ready') then
  if m.status<>'drafting' or s->'launch' is distinct from 'null'::jsonb then raise exception 'Draft choices are locked while connecting.'; end if;
  if action in ('ban','pick') and not exists(select 1 from jsonb_array_elements(m.track_pool) t where t->>'id'=chosen) then raise exception 'Track is not in the ranked pool.'; end if;
  if action='ban' then
   count_p:=jsonb_array_length(s->'bans');
   if count_p>=cardinality(m.roster)*2 or m.roster[(count_p%cardinality(m.roster))+1]<>who then raise exception 'Wait for your ban turn.'; end if;
   if exists(select 1 from jsonb_array_elements(s->'bans') x where x->>'track_id'=chosen) then raise exception 'Track already banned.'; end if;
   s:=jsonb_set(s,'{bans}',(s->'bans')||jsonb_build_array(jsonb_build_object('player_id',who,'track_id',chosen)));
  else
   if jsonb_array_length(s->'bans')<>cardinality(m.roster)*2 then raise exception 'Finish bans first.'; end if;
   if action in ('pick','remove-pick') and s->'ready' @> to_jsonb(array[who]) then raise exception 'Unready before editing your picks.'; end if;
   if action='pick' then
    select count(*) into count_p from jsonb_array_elements(s->'picks') x where x->>'player_id'=who::text;
    if count_p>=2 then raise exception 'Two picks per racer.'; end if;
    if exists(select 1 from jsonb_array_elements(s->'bans') x where x->>'track_id'=chosen)
      or exists(select 1 from jsonb_array_elements(s->'picks') x where x->>'track_id'=chosen and x->>'player_id'=who::text) then raise exception 'Pick unavailable.'; end if;
    s:=jsonb_set(s,'{picks}',(s->'picks')||jsonb_build_array(jsonb_build_object('player_id',who,'track_id',chosen)));
   elsif action='remove-pick' then
    s:=jsonb_set(s,'{picks}',coalesce((select jsonb_agg(x) from jsonb_array_elements(s->'picks') x where not (x->>'player_id'=who::text and x->>'track_id'=chosen)),'[]'));
   elsif chosen='ready' then
    if (select count(*) from jsonb_array_elements(s->'picks') x where x->>'player_id'=who::text)<>2 then raise exception 'Choose both tracks first.'; end if;
    if not s->'ready' @> to_jsonb(array[who]) then s:=jsonb_set(s,'{ready}',(s->'ready')||to_jsonb(who)); end if;
   elsif chosen='editing' then s:=jsonb_set(s,'{ready}',(s->'ready')-who::text);
   else raise exception 'Invalid ready state.'; end if;
  end if;
 elsif action='code' then
  if who<>m.host_id or s->'launch'->>'stage' is distinct from 'connecting' or value->>'attempt' is distinct from s->'launch'->>'id' or coalesce(value->>'code','')!~ '^[A-Za-z0-9_-]{4,128}$' then raise exception 'Invalid race invitation.'; end if;
  s:=jsonb_set(s,'{launch,code}',value->'code');
 elsif action='bind' then
  if who<>m.host_id or s->'launch'->>'id' is null or value->>'attempt' is distinct from s->'launch'->>'id' or coalesce(value->>'native','')!~ '^[0-9]{1,8}$' then raise exception 'Invalid connection binding.'; end if;
  select player_id into bound from public.polycup_ranked_members where match_id=match_key and ticket=(value->>'ticket')::uuid and seen_at>now()-interval '35 seconds';
  if bound is null or exists(select 1 from public.polycup_ranked_members where match_id=match_key and player_id<>bound and launch_id=value->>'attempt' and native_id=(value->>'native')::integer) then raise exception 'Connection ticket unavailable.'; end if;
  update public.polycup_ranked_members set native_id=(value->>'native')::integer,launch_id=value->>'attempt' where match_id=match_key and player_id=bound;
  return to_jsonb(array_position(m.roster,bound));
 elsif action='race' then
  if who<>m.host_id or s->'launch'->>'id' is null or value#>>'{}' is distinct from s->'launch'->>'id' then raise exception 'Invalid start attempt.'; end if;
  if m.status<>'racing' then
   if s->'launch'->>'stage' is distinct from 'connecting' or exists(select 1 from public.polycup_ranked_members where match_id=match_key and (native_id is null or launch_id is distinct from s->'launch'->>'id')) then raise exception 'Wait for every connection.'; end if;
   perform public.polycup_ranked_advance(match_key,'race',jsonb_build_object('bans',s->'bans','picks',s->'picks'));
   s:=jsonb_set(s,'{launch,stage}','"racing"');
  end if;
 elsif action='failed' then
  if m.status='drafting' and value#>>'{}'=s->'launch'->>'id' then
   s:=jsonb_set(jsonb_set(s,'{launch}','null'),'{ready}','[]');
   s:=jsonb_set(s,'{error}','"Connection failed. Your picks are saved; ready up to retry."');
  end if;
 elsif action<>'poll' then raise exception 'Action unavailable in ranked.';
 end if;
 if m.status='drafting' then
  if s->'launch' is distinct from 'null'::jsonb and (exists(select 1 from public.polycup_ranked_members where match_id=match_key and seen_at<now()-interval '35 seconds') or (s->'launch'->>'stage'='connecting' and now_ms-(s->'launch'->>'at')::bigint>90000)) then
   s:=jsonb_set(jsonb_set(s,'{launch}','null'),'{ready}','[]');
   s:=jsonb_set(s,'{error}','"A racer disconnected. Your picks are saved; ready up to retry."');
  elsif s->'launch'->>'stage'='grace' and now_ms>=(s->'launch'->>'at')::bigint then
   s:=jsonb_set(jsonb_set(s,'{launch,stage}','"connecting"'),'{launch,at}',to_jsonb(now_ms));
  elsif s->'launch'='null'::jsonb and jsonb_array_length(s->'ready')=cardinality(m.roster) and not exists(select 1 from public.polycup_ranked_members where match_id=match_key and seen_at<now()-interval '35 seconds') then
   s:=jsonb_set(s,'{launch}',jsonb_build_object('id',gen_random_uuid(),'stage','grace','at',now_ms+5000,'code',''))-'error';
   select coalesce(max((x->>'seq')::integer),0)+1 into seq from jsonb_array_elements(s->'chat') x;
   s:=jsonb_set(s,'{chat}',(s->'chat')||jsonb_build_array(jsonb_build_object('seq',seq,'at',now_ms,'speaker',0,'color',0,'name','','text','Match starting in 5…','system',true)));
   update public.polycup_ranked_members set native_id=null,launch_id=null where match_id=match_key;
  end if;
 end if;
 if s is distinct from m.session then
  s:=jsonb_set(s,'{revision}',to_jsonb(coalesce((s->>'revision')::integer,0)+1));
  update public.polycup_ranked_matches set session=s where id=match_key;
 end if;
 return jsonb_build_object('id',m.id,'status',(select status from public.polycup_ranked_matches where id=match_key),'host',array_position(m.roster,m.host_id),'self',array_position(m.roster,who),'ticket',p.ticket,'rules',m.rules,'pool',m.track_pool,'session',s,
 'members',(select jsonb_agg(jsonb_build_object('id',array_position(m.roster,r.player_id),'account',r.player_id,'name',f.display_name,'country',null,'online',r.seen_at>now()-interval '35 seconds','native',r.native_id) order by array_position(m.roster,r.player_id)) from public.polycup_ranked_members r join public.profiles f on f.id=r.player_id where r.match_id=match_key));
end $$;
revoke all on function public.polycup_ranked_session(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.polycup_ranked_session(uuid,uuid,text,jsonb) to authenticated;
commit;
