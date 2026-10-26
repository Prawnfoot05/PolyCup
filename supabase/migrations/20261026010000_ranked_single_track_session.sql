begin;
create or replace function public.polycup_ranked_session_internal(match_key uuid,instance_key uuid,action text default 'poll',value jsonb default 'null')
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
 if m.season_id is not null and m.session is null then s:=jsonb_set(s,'{ready}',to_jsonb(m.roster)); end if;
 if action='garage' then
  if jsonb_typeof(value) is distinct from 'object' or length(coalesce(value->>'name','')) not between 1 and 128
   or (value->>'country' is not null and value->>'country' !~ '^[a-zA-Z]{2}$')
   or length(coalesce(value->>'style',''))>1500 then raise exception 'Invalid garage profile.'; end if;
  update public.polycup_ranked_members set garage_name=value->>'name',garage_country=lower(value->>'country'),garage_style=value->>'style'
    where match_id=match_key and player_id=who;
  action:='poll';
 end if;
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
  if m.season_id is not null then
   if action<>'draft-ready' or chosen<>'ready' then raise exception 'This ranked match uses one fixed random track.'; end if;
   if not s->'ready' @> to_jsonb(array[who]) then s:=jsonb_set(s,'{ready}',(s->'ready')||to_jsonb(who)); end if;
  else
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
   s:=jsonb_set(s,'{error}','"Connection failed. Ready up to retry the connection."');
  end if;
 elsif action<>'poll' then raise exception 'Action unavailable in ranked.';
 end if;
 if m.status='drafting' then
  if s->'launch' is distinct from 'null'::jsonb and (exists(select 1 from public.polycup_ranked_members where match_id=match_key and seen_at<now()-interval '35 seconds') or (s->'launch'->>'stage'='connecting' and now_ms-(s->'launch'->>'at')::bigint>90000)) then
   s:=jsonb_set(jsonb_set(s,'{launch}','null'),'{ready}','[]');
   s:=jsonb_set(s,'{error}','"A racer disconnected. Ready up to retry the connection."');
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
 return jsonb_build_object('id',m.id,'status',(select status from public.polycup_ranked_matches where id=match_key),'host',array_position(m.roster,m.host_id),'self',array_position(m.roster,who),'ticket',p.ticket,'selected_track',m.selected_track,'season',(select jsonb_build_object('id',id,'name',name) from public.polycup_ranked_seasons where id=m.season_id),'rules',m.rules,'pool',m.track_pool,'session',s,
 'members',(select jsonb_agg(jsonb_build_object('id',array_position(m.roster,r.player_id),'account',r.player_id,'name',coalesce(r.garage_name,f.display_name),'country',r.garage_country,'style',r.garage_style,'online',r.seen_at>now()-interval '35 seconds','native',r.native_id) order by array_position(m.roster,r.player_id)) from public.polycup_ranked_members r join public.profiles f on f.id=r.player_id where r.match_id=match_key));
end $$;

-- Preconfigured but inactive: live ranked is unchanged until explicit activation.
insert into public.polycup_ranked_seasons(id,name,game_version,client_version,community_collection,catalog,rules,tier_floors,provisional_matches) values
('season-1','Season 1','0.6.3','0.4.1','0.6.3', '[{"id":"0338f449b9948f06c03ffc2ab3ab6cf551fd08a9f2c09a16156b93ef52dd4411","category":"community","digest":"e089057d979f49bccafbbe7bc2085c49122a73b08f6c1b24366afd870a8295e8"},{"id":"148826aa16ffaa23dbc453b32cff05e025ddbce1773fc7733cc13d218926515a","category":"official","digest":"95a0b9f0dddb1a29107459eb4ea1a00ee03a7ec61d0eb07fe360e8dd70e60a4c"},{"id":"225fad12335dadc12b60bfa1b31369b1026d8a084fd4670583870fb3b71f7ec0","category":"community","digest":"abb858de02ae52649420fcb63b6bb136c2cb017da1b10de0ca60d70348646438"},{"id":"27c3384de80b1bed23f1ea15316abe62c8cca33e955805f23d461803f6dee8d4","category":"community","digest":"e95e234f25eb40fb57f4f3ef6196a81117bdcd0618c7709a378a1607b5c57502"},{"id":"2806030c503abb41a1a26fa9a570888be14296172bb273798ef0ad87a108a2ec","category":"official","digest":"b7a8e4f5c73460ed941c06a5b050b64f752a6f1259b2275fe92864086a475c69"},{"id":"2fe4bd46b0075cc25fc770ce50adbb68447cf493c999635bb272d231811dd264","category":"official","digest":"216e6c53ec5dc725f14f808fa0865ecad1cd4813a835d8beb0afce80eb1e18c8"},{"id":"387aab2d3400ebf74b5a780d15c911cdc695053b94be3e7ad23f6ae313b2471c","category":"community","digest":"106f02be5915d414e2e5f3c6244a84f47722ea3faafa881cb3b620dce4194110"},{"id":"439f1c61263987365996667f99d65f899ec482dfe21c64edcd9a1b1ae5b4a0a9","category":"community","digest":"5dca02df8a97e4a8a1eef3c5990b0f4e6bc8a5e558e8471fe97d4a3a77cba998"},{"id":"4697ea67b18c3f49b30a3d8884602115536650bc5435c88e3732e64d21a72d33","category":"official","digest":"a21e6b3d4be690f541f5912c04772940340af1ac823face2ea8a4e4c7333f77f"},{"id":"5803f9e963625804e3de3246d043dc7dde847aa32e991f7f7326b0453f1fa038","category":"official","digest":"0f76ea0f7aa2d1696a11bb5a88bc560f324ddfe7fb2a6f634b28bf1f5c66a011"},{"id":"7239b17057127936907a805b0caa5d8c6f6c97eca9bdabf1a5312dce479629b7","category":"official","digest":"c6252e3aadd2b1a8a459f0fd452261ac938aab562c4dc92721fd0985302d4db5"},{"id":"7603aaeffa1989a649dfaa8e1804bed4481b49df233e377687d0669899566e52","category":"official","digest":"8524bae8fd01a6b4607efbd987afb050a9300006ed02f78f454bce14211f6609"},{"id":"7d134c939df80c676a258266201beedd3b93572d5603f3ff4339ff8679803715","category":"official","digest":"1d8fdabc91c39674cdf3cff1cca5f374d3c91ef87f3913535d4e0e07f3596231"},{"id":"7eac4fee1111152cfba4d3737410264ca0f22c7f5a2211e79f0099589b8b48c0","category":"official","digest":"2e83057e196041789b9756f7765e7523e5047e7f6e3ddb71235c125f52e1d554"},{"id":"88647ea04145fbbbb19b55f1590e038fb0378acb2571110f02cb545cc46b0d57","category":"official","digest":"b2b465ba49e0f252ca3984749b25797402cbe04143ae4812093f5b2fee8cc978"},{"id":"93c7363dfea7fb09ca1d23b72cad5df43a30841d41c8ff25fb544c85bb03c7ae","category":"official","digest":"39f629e34f5113c8a2fdef48e2eb6714657a1b2e92038a59c9148e712eaef0a8"},{"id":"99864b635d1891d22e17eb9267527a07a92c49c0f02893729fa2ded90e3ca0f9","category":"official","digest":"3fff1ea8ecd83c776bd7f6196b1f079bfdbd293f05e1e014cf7ad01e8fa8cf7f"},{"id":"a5341fe706097cff2a3812a3fc0d87399254557328351ae8e5c882700fc1a196","category":"official","digest":"66522d0f79b8659c895bcd31cfdbba98d01bbd8ec027c7c8041ba68f2fde1ba1"},{"id":"a680fa81e6a4b9dec06b4197833f0a96334a275faf387d495c9c674ffd6b8686","category":"community","digest":"d57ca1a9194e3891423ace1eca0b4d4e5c249cea0ddac27156dc2131a0e8a7db"},{"id":"c117823cf6788e3247b9ee63a0c091c07352bbe352c650a7790dc6718148c2fa","category":"official","digest":"57ee5d4304fce569e78c362c6514fc81c03b0d93859d4207cd5816e977f52c60"},{"id":"c20b4ee3cd517ca6cae7e43f047548757287fbd08ba81b97892a3ef520159a34","category":"official","digest":"618d88414d8b02f32d386734554b85a95d3d343598b0635bb7df1652b58c3923"},{"id":"d57a81355f36d5ef0bd2c063d251baf6d28401c275a8b3e3a62e0ae5071a2559","category":"community","digest":"28230ece237ed412f63ad2e61dc44e81a8a23253c95f2f7859a52a0567f10620"},{"id":"d9bc51ec180bc46558e079c7949ba10b9ade52078c4c145f217a6a8543df2377","category":"community","digest":"6cf28f35de15f73938157544a0b54e29b3b69b3f4cc78723c4221fd3f5a2ed40"},{"id":"dc7783fef2a5fbb7a2d75b9c6fdd6a9d600b833d47c6274374ea4388c707517a","category":"community","digest":"02716e8f9c7849824acce1021c80db4f18bc3e5f2e095a04ab3b40a987900ed1"},{"id":"e4bcaca3a583bb0eb62a700a69d14e89c852f0c5bf740fca76e0519ebdfc9ab1","category":"official","digest":"8882111f26f655860b3d0ebcee4d674da38189d5ba992a499d600f437eaf69c7"},{"id":"e5d084e06db4ab71196fea44efeceb23c8561266a78669c324a38f92581fe2db","category":"official","digest":"1023cb227137f0dbf5358f02f280b64c078642baa6ddcb1a2195b789c3da8494"},{"id":"f40d385d5e97e00a166a9a05d19789d8f2bf3621a8c1c8919c8bec41ab6347ab","category":"community","digest":"675835b818e1a80a4664b5dacac3870ff9c141b3027c338f809140042a6fbc5d"}]'::jsonb,public.polycup_ranked_season_rules(),array[0,5000,10000,15000,20000,25000],5);
commit;
