// LOCAL TEST SERVER ONLY: synthetic authentication; never deploy.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {runResultBatch,errorCode} from '../worker/processor.ts';
import {loadCorpus,processInputReviews} from '../input-review/processor.ts';
const db=await PGlite.create();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let guestIndex=3;let settlementPaused=false;
const users=Array.from({length:32},(_,i)=>i+1).map((n)=>({id:id(n),aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},
 user_metadata:{full_name:['Alice','Bob','Charlie','Guest'][n-1],custom_claims:{global_name:['Alice display','Bob display','Charlie display','Guest'][n-1]}},created_at:new Date().toISOString()}));
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;
 grant execute on function auth.uid() to authenticated,anon,service_role;`);
for(const migration of ['20261021000000_account_friends_foundation.sql','20261021010000_friends_presence.sql','20261021020000_lobby_directory.sql','20261021030000_guest_lobby_access.sql','20261021040000_waiting_rooms.sql','20261021050000_single_cup_membership.sql','20261021060000_friend_cup_invites.sql','20261021070000_ranked_foundation.sql','20261022000000_ranked_rating_history.sql','20261022010000_ranked_queue.sql','20261022020000_ranked_profile_stats.sql','20261022030000_ranked_session.sql','20261022040000_lobby_ranks.sql','20261022050000_friend_public_games.sql','20261022060000_friends_leaderboard.sql'])
 await db.exec(await readFile('supabase/migrations/'+migration,'utf8'));
for(const user of users)await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[user.id,user.user_metadata]);
await db.exec(await readFile('supabase/migrations/20261022070000_ranked_settlement.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261022080000_ranked_abandonment.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261023000000_ranked_result_notifications.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261023010000_ranked_result_worker.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261023050000_ranked_static_snapshot.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261023070000_ranked_explicit_abandon.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261025000000_input_review_pilot.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261025010000_profile_pictures.sql','utf8'));
if(process.env.POLYCUP_QA_SEASON==='1')for(const f of ['20261026000000_ranked_seasons.sql','20261026010000_ranked_single_track_session.sql','20261026020000_ranked_season_standings.sql','20261026030000_ranked_active_season_ranks.sql','20261026040000_online_player_count.sql'])await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
if(process.env.POLYCUP_QA_INPUT_REVIEW==='1'){
 await db.exec('update public.polycup_input_review_config set enabled=true');
 const corpus=await loadCorpus();let checking=false;
 setInterval(async()=>{if(checking)return;checking=true;try{await processInputReviews(db,corpus);}catch(e){console.error('Input review:',e.message);}finally{checking=false;}},1000);
}
const workerDb={transaction:fn=>db.transaction(async tx=>{await tx.query('set local role polycup_result_worker');return fn(tx);})};
if(process.env.POLYCUP_QA_RANKED==='1'){
 await db.query("insert into public.friendships(requester_id,addressee_id,status) values($1,$2,'accepted')",[id(1),id(2)]);
 await db.query('update public.player_ratings set rating=27845,rated_matches=20 where player_id=$1',[id(1)]);
 await db.exec('update public.polycup_ranked_config set enabled=true,provisional_matches=3,tier_floors=array[0,5000,10000,15000,20000,25000]');
 await db.query('update public.polycup_queue_config set enabled=true,catalog=$1',[Array.from({length:16},(_,i)=>({id:'fixture-track-'+i,category:'official',digest:'a'.repeat(64)}))]);
}
if(process.env.POLYCUP_QA_SEASON==='1') await db.exec("update public.polycup_queue_config set version='0.4.1'");
if(process.env.POLYCUP_QA_SETTLEMENT==='1') {
 for(const n of [1,2,3,4]) {
  await db.query('update public.player_ratings set rating=12500,rated_matches=20 where player_id=$1',[id(n)]);
  await db.query('insert into public.polycup_rating_state values($1,$2)',[id(n),{model:'btf-6.2.0-t025-softplus-v1',mu:25,sigma:3}]);
 }
 let busy=false;
 setInterval(async()=>{if(busy||settlementPaused)return;busy=true;try{await runResultBatch(workerDb);}catch(e){console.error('Settlement worker:',errorCode(e));}finally{busy=false;}},500);
}
const rpc={polycup_online_count:['select public.polycup_online_count() result'],polycup_seasons:['select public.polycup_seasons() result'],polycup_season_leaderboard:['select public.polycup_season_leaderboard($1,$2,$3,$4) result','season_key','friends_only','page_size','page_offset'],polycup_friends_v2:['select * from public.polycup_friends_v2()'],polycup_friend_game:['select public.polycup_friend_game($1) result','friend_key'],polycup_friends_leaderboard:['select * from public.polycup_friends_leaderboard($1,$2)','page_size','page_offset'],polycup_leaderboard:['select * from public.polycup_leaderboard($1,$2)','page_size','page_offset'],polycup_lobby_ranks:['select public.polycup_lobby_ranks($1,$2,$3) result','room_key','instance_key','ranked'],polycup_invite_friend:['select public.polycup_invite_friend($1,$2,$3)','room_key','instance_key','friend_key'],polycup_friend_invites:['select * from public.polycup_friend_invites()'],polycup_dismiss_invite:['select public.polycup_dismiss_invite($1)','invite_key'],polycup_room:['select public.polycup_room($1,$2,$3,$4) result','op','room_key','instance_key','args'],polycup_room_directory:['select public.polycup_room_directory() result'],polycup_room_by_code:['select public.polycup_room_by_code($1) result','room_code'],polycup_lobbies:['select * from public.polycup_lobbies()'],polycup_join_lobby:['select public.polycup_join_lobby($1,$2,$3) code','host_key','expected_cup','client_version'],polycup_unlist_lobby:['select public.polycup_unlist_lobby($1)','instance_key'],polycup_list_lobby:['select public.polycup_list_lobby($1,$2,$3,$4,$5,$6,$7,$8,$9)','instance_key','cup_key','lobby_title','code','version','stage','player_count','player_limit','invite_seconds'],polycup_presence_touch:['select public.polycup_presence_touch($1)','session_key'],polycup_presence_leave:['select public.polycup_presence_leave($1)','session_key'],
 polycup_friends:['select * from public.polycup_friends()'],polycup_find_players:['select * from public.polycup_find_players($1)','search_text'],
 polycup_queue:['select public.polycup_queue($1,$2,$3) result','action','instance_key','client_version'],
 polycup_ranked_session:['select public.polycup_ranked_session($1,$2,$3,$4) result','match_key','instance_key','action','value'],
 polycup_ranked_session_v2:['select public.polycup_ranked_session_v2($1,$2,$3,$4,$5) result','match_key','instance_key','action','value','known_static_key'],
 polycup_ranked_current:['select public.polycup_ranked_current() result'],
 polycup_ranked_abandon:['select public.polycup_ranked_abandon($1,$2) result','match_key','instance_key'],
 polycup_ranked_stats:['select public.polycup_ranked_stats($1) result','player_key'],
 polycup_ranked_profile:['select * from public.polycup_ranked_profile($1)','player_key'],
 polycup_queue_info:['select public.polycup_queue_info() result'],
 polycup_ranked_history:['select * from public.polycup_ranked_history($1,$2,$3)','player_key','page_size','page_offset'],
 polycup_ranked_match:['select public.polycup_ranked_match($1) result','match_key']};
rpc.polycup_ranked_claim_result=['select public.polycup_ranked_claim_result($1,$2) result','delivery_key','match_key'];
rpc.polycup_ranked_seen_result=['select public.polycup_ranked_seen_result($1) result','match_key'];
rpc.polycup_ranked_submit=['select public.polycup_ranked_submit($1,$2,$3) result','match_key','instance_key','transcript'];
rpc.polycup_ranked_result_status=['select public.polycup_ranked_result_status($1) result','match_key'];
rpc.polycup_ranked_reject_result=['select public.polycup_ranked_reject_result($1,$2) result','match_key','instance_key'];
rpc.polycup_input_review_policy=['select public.polycup_input_review_policy() result'];
rpc.polycup_profile_pictures=['select public.polycup_profile_pictures($1) result','player_keys'];
rpc.polycup_submit_input_run=['select public.polycup_submit_input_run($1,$2,$3) result','match_key','instance_key','run'];
rpc.polycup_input_review=['select public.polycup_input_review($1,$2) result','match_keys','player_key'];
http.createServer(async(req,res)=>{
 const reply=(status,data)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));
 try{
  const url=new URL(req.url,'http://127.0.0.1:8811');let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):{};
  if(url.pathname==='/test/pause-settlement'){settlementPaused=!!body.paused;return reply(200,{paused:settlementPaused});}
  if(url.pathname==='/test/receipts')return reply(200,(await db.query('select match_id,player_id,seen_at from public.polycup_ranked_result_receipts')).rows);
  if(url.pathname==='/test/input-review')return reply(200,{runs:(await db.query('select match_id,player_id,round,track,finish,native_finish,time_offset,length(recording) bytes from public.polycup_input_runs')).rows,checks:(await db.query('select * from public.polycup_input_checks')).rows});
  if(url.pathname==='/test/settlement')return reply(200,{ratings:(await db.query('select player_id,rating,rated_matches from public.player_ratings where player_id=any($1)',[[id(1),id(2)]])).rows,events:(await db.query('select match_id,player_id,rating_before,rating_after from public.polycup_rating_events')).rows,transcripts:(await db.query('select match_id,player_id,transcript from public.polycup_ranked_transcripts')).rows});
  if(url.pathname==='/test/settle-again') {await Promise.all(Array.from({length:5},()=>runResultBatch(workerDb)));return reply(200,{});}
  if(url.pathname==='/test/catalog' && process.env.POLYCUP_QA_SEASON==='1'){
 await db.query("update public.polycup_ranked_seasons set catalog=$1 where id='season-1' and starts_at is null",[body.tracks]);
 if(!(await db.query("select starts_at from public.polycup_ranked_seasons where id='season-1'")).rows[0].starts_at)await db.query("select public.polycup_ranked_activate_season('season-1')");return reply(200,{});
}
if(url.pathname==='/test/catalog'){await db.query('update public.polycup_queue_config set catalog=$1',[body.tracks]);return reply(200,{});}
  if(url.pathname==='/test/host-expire'){await db.exec("update public.polycup_ranked_members r set seen_at=now()-interval '121 seconds' from public.polycup_ranked_matches m where r.match_id=m.id and r.player_id=m.host_id");return reply(200,{});}
  if(url.pathname==='/test/queue-age'){await db.query("update public.polycup_ranked_queue set joined_at=now()-make_interval(secs=>$1) where ($2::uuid is null or player_id=$2)",[body.seconds,body.player??null]);return reply(200,{});}
  if(url.pathname==='/test/queue-expire'){await db.query("update public.polycup_ranked_queue set seen_at=now()-interval '36 seconds' where player_id=$1",[body.player]);return reply(200,{});}
  if(url.pathname==='/test/match-expire'){await db.exec("update public.polycup_ranked_matches set deadline=now()-interval '1 second' where status='reserved'");return reply(200,{});}
  if(url.pathname==='/test/ranked-member-expire'){await db.query("update public.polycup_ranked_members set seen_at=now()-interval '36 seconds' where player_id=$1",[body.player]);return reply(200,{});}
  if(url.pathname==='/test/ranked-bindings')return reply(200,(await db.query("select r.player_id,r.native_id from public.polycup_ranked_members r join public.polycup_ranked_matches m on m.id=r.match_id where m.status='racing'")).rows);
  if(url.pathname==='/test/ranked-state')return reply(200,{queue:(await db.query('select player_id,joined_at from public.polycup_ranked_queue')).rows,matches:(await db.query('select id,status,roster,session,rules,selected_track from public.polycup_ranked_matches')).rows});
  if(url.pathname==='/test/reset-ranked'){await db.exec("delete from public.polycup_ranked_queue;delete from public.polycup_ranked_claims;update public.polycup_ranked_matches set status='cancelled',finished_at=now() where status in ('reserved','drafting','racing')");return reply(200,{});}
  if(url.pathname==='/test/rooms')return reply(200,(await db.query('select id,revision,data from public.polycup_rooms')).rows);
  if(url.pathname==='/test/clear-rooms'){await db.exec('delete from public.polycup_rooms');guestIndex=3;return reply(200,{});}
  if(url.pathname==='/test/expire') {await db.query("update public.friend_presence_sessions set last_seen=now()-interval '91 seconds' where user_id=$1",[body.user]);return reply(200,{});}
  if(url.pathname==='/test/count')return reply(200,(await db.query('select count(*)::int n from public.friend_presence_sessions where user_id=$1',[body.user])).rows[0]);
  if(url.pathname==='/test/lobbies')return reply(200,(await db.query('select host_id,cup_id,title,phase,players from public.polycup_lobby_listings')).rows);
  if(url.pathname==='/test/expire-lobbies'){await db.exec("update public.polycup_lobby_listings set updated_at=now()-interval '91 seconds'");return reply(200,{});}
  if(url.pathname==='/test/clear-lobbies'){await db.exec('delete from public.polycup_lobby_listings');return reply(200,{});}
  if(url.pathname==='/auth/v1/signup'){const user=users[guestIndex++];await db.query('update auth.users set is_anonymous=true where id=$1',[user.id]);const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');return reply(200,{access_token:enc({alg:'HS256'})+'.'+enc({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})+'.test',refresh_token:'guest-test',expires_in:3600,token_type:'bearer',user:{...user,is_anonymous:true}});}
  const token=req.headers.authorization?.split(' ')[1];
  let actor=null;try{actor=JSON.parse(Buffer.from(token?.split('.')[1]??'','base64url').toString()).sub;}catch{}
  const user=users.find(u=>u.id===actor);if(!user&&!['/rest/v1/rpc/polycup_online_count','/rest/v1/rpc/polycup_seasons','/rest/v1/rpc/polycup_season_leaderboard','/rest/v1/rpc/polycup_leaderboard','/rest/v1/rpc/polycup_lobbies','/rest/v1/rpc/polycup_join_lobby','/rest/v1/rpc/polycup_room_directory','/rest/v1/rpc/polycup_queue_info','/rest/v1/rpc/polycup_ranked_history','/rest/v1/rpc/polycup_ranked_match','/rest/v1/rpc/polycup_input_review_policy','/rest/v1/rpc/polycup_input_review','/rest/v1/rpc/polycup_profile_pictures'].includes(url.pathname))return reply(401,{message:'Test user required'});
  if(url.pathname==='/auth/v1/user')return reply(200,user);
  if(url.pathname==='/auth/v1/logout')return reply(200,{});
  const result=await db.transaction(async tx=>{
   await tx.exec('set local role '+(user?'authenticated':'anon'));
   await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor??'']);
   const name=url.pathname.split('/').at(-1);
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const spec=rpc[name];if(!spec)throw new Error('Unknown test RPC');
    const rows=(await tx.query(spec[0],spec.slice(1).map(k=>['value','transcript','run'].includes(k)?JSON.stringify(body[k]??null):body[k]))).rows;return rows[0]&&Object.hasOwn(rows[0],'result')?rows[0].result:name==='polycup_join_lobby'?rows[0].code:rows;
   }
   if(name==='profiles'){
    if(req.method==='PATCH')return (await tx.query('update public.profiles set display_name=$1 where id=$2 returning display_name',[body.display_name,url.searchParams.get('id')?.slice(3)])).rows[0];
    return (await tx.query('select display_name from public.profiles where id=$1',[url.searchParams.get('id')?.slice(3)])).rows[0];
   }
   if(name==='player_ratings')return (await tx.query('select rating from public.player_ratings where player_id=$1',[url.searchParams.get('player_id')?.slice(3)])).rows[0];
   if(name==='friendships'){
    if(req.method==='POST')await tx.query('insert into public.friendships(requester_id,addressee_id) values($1,$2)',[body.requester_id,body.addressee_id]);
    else if(req.method==='PATCH')await tx.query('update public.friendships set status=$1 where id=$2 and status=$3',[body.status,url.searchParams.get('id')?.slice(3),url.searchParams.get('status')?.slice(3)]);
    else if(req.method==='DELETE')await tx.query('delete from public.friendships where id=$1 and status=$2',[url.searchParams.get('id')?.slice(3),url.searchParams.get('status')?.slice(3)]);
    return null;
   }
   throw new Error('Unknown test endpoint');
  });
  reply(200,result);
 }catch(error){reply(400,{code:error.code??'TEST',message:error.message});}
}).listen(Number(process.env.POLYCUP_QA_PORT || 8813),'127.0.0.1',()=>console.log('Isolated waiting-room database test server ready on '+(process.env.POLYCUP_QA_PORT || 8813)+'.'));

