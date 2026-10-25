import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pool=Array.from({length:16},(_,i)=>({id:`track-${i}`,category:i%2?'community':'official',digest:'a'.repeat(64)}));

test('ranked foundation against migrated PostgreSQL',async t=>{
 const db=await PGlite.create();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const f of ['20261021000000_account_friends_foundation.sql','20261021010000_friends_presence.sql','20261021040000_waiting_rooms.sql','20261021050000_single_cup_membership.sql','20261021060000_friend_cup_invites.sql','20261021070000_ranked_foundation.sql'])
   await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  for(let n=1;n<=20;n++)await db.query('insert into auth.users(id,raw_user_meta_data,is_anonymous) values($1,$2,$3)',[id(n),{full_name:'Racer '+n},n===20]);
  const query=(role,who,sql,args=[])=>db.transaction(async tx=>{
   await tx.exec(`set local role ${role}`);
   await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[who?id(who):'']);
   return tx.query(sql,args);
  });
  const service=(sql,args=[])=>query('service_role',null,sql,args);
  const client=(who,sql,args=[])=>query('authenticated',who,sql,args);
  const reserve=(key=100,players=[1,2],tracks=pool)=>service('select public.polycup_ranked_reserve($1,$2,$3)',[id(key),players.map(id),tracks]);
  const member=(who,key=100,action='poll',instance=who+1000)=>client(who,'select public.polycup_ranked_member($1,$2,$3) value',[id(key),id(instance),action]);
  const advance=(key,action,draft=null)=>service('select public.polycup_ranked_advance($1,$2,$3)',[id(key),action,draft]);
  const draft=players=>({
   bans:players.flatMap((p,i)=>[0,1].map(j=>({player_id:id(p),track_id:`track-${i*2+j}`}))),
   picks:players.flatMap((p,i)=>[0,1].map(j=>({player_id:id(p),track_id:`track-${players.length*2+i*2+j}`}))),
  });
  const evidence=(players=[1,2],digest='b')=>({digest:digest.repeat(64),rounds:19,standings:players.map((p,i)=>({player_id:id(p),place:i+1,points:i?120:140}))});
  const report=(who,key,ev=evidence(),instance=who+1000)=>client(who,'select public.polycup_ranked_report($1,$2,$3)',[id(key),id(instance),ev]);
  const batch=(players=[1,2])=>players.map((p,i)=>({player_id:id(p),before:null,after:1000-i*10,matches_before:0,state_before:null,state_after:{uncertainty:300}}));
  const finalize=(key,updates=batch(),model='TEST-ONLY')=>service('select public.polycup_ranked_finalize($1,$2,$3)',[id(key),model,updates]);
  const start=async(key,players=[1,2])=>{
   await reserve(key,players);
   for(const p of players)await member(p,key,'accept');
   await advance(key,'draft');await advance(key,'race',draft(players));
  };
  const board=(size=50,offset=0)=>query('anon',null,'select * from public.polycup_leaderboard($1,$2)',[size,offset]);

  await t.test('disabled initially; public rules fixed; privileged endpoints are not client callable',async()=>{
   await assert.rejects(reserve(),/not enabled/);
   const rules=(await query('anon',null,'select public.polycup_ranked_rules() rules')).rows[0].rules;
   assert.equal(rules.bansPerRacer,2);assert.equal(rules.picksPerRacer,2);assert.equal(rules.roundsPerTrack,3);
   assert.equal(rules.pointsToWin,140);assert.equal(rules.finalist,true);assert.deepEqual(rules.pool,['official','community']);
   for(const [sql,args] of [
    ['select public.polycup_ranked_reserve($1,$2,$3)',[id(100),[id(1),id(2)],pool]],
    ['select public.polycup_ranked_advance($1,$2,$3)',[id(100),'draft',null]],
    ['select public.polycup_ranked_finalize($1,$2,$3)',[id(100),'TEST-ONLY',batch()]],
    ['select public.polycup_ranked_expire()',[]],['select * from public.polycup_ranked_board()',[]],
    ['select * from public.polycup_ranked_reports',[]],['select * from public.polycup_rating_state',[]],
    ["update public.player_ratings set rating=999999",[]],
   ])await assert.rejects(client(1,sql,args),/permission denied/);
   assert.equal((await board()).rows.length,0);
   // Deliberately synthetic thresholds/model; never shipped as product decisions.
   await service("update public.polycup_ranked_config set enabled=true,model_version='TEST-ONLY',provisional_matches=3,tier_floors=array[0,500,1000,1500,2000,2500]");
  });
  await t.test('admission, guest rejection, idempotency and bidirectional custom Cup fence',async()=>{
   await assert.rejects(reserve(100,[1,1]),/Invalid ranked roster/);
   await assert.rejects(reserve(100,[1,20]),/signed-in/);
   await assert.rejects(reserve(100,[1,2],[{...pool[0],category:'custom'},...pool.slice(1)]),/Invalid track pool/);
   await reserve();await reserve();
   assert.equal((await client(1,'select public.polycup_ranked_current() current')).rows[0].current,id(100));
   assert.equal((await client(3,'select public.polycup_ranked_current() current')).rows[0].current,null);
   await assert.rejects(reserve(100,[2,1]),/already used/);
   const admitted=await Promise.allSettled([reserve(101,[1,3]),reserve(102,[2,3])]);
   assert.equal(admitted.filter(x=>x.status==='fulfilled').length,0);
   await assert.rejects(client(1,"select public.polycup_room('create',$1,$2,$3)",[id(900),id(901),{}]),/ranked Cup/);
   await assert.rejects(member(3),/not in this ranked match/);
   await assert.rejects(advance(100,'draft'),/must accept/);
   await member(1,100,'withdraw');
   assert.equal((await db.query('select * from public.polycup_ranked_claims')).rows.length,0);
   await reserve();assert.equal((await member(1)).rows[0].value.status,'cancelled');
   const data={cup:{id:id(900),name:'Custom Cup',phase:'registration',draft:{stage:'roster'},roster:[]},public:false,launch:null};
   await client(1,"select public.polycup_room('create',$1,$2,$3)",[id(900),id(901),{version:'test',name:'Racer',data}]);
   await assert.rejects(reserve(101),/already in a Cup/);
   await client(1,"select public.polycup_room('leave',$1,$2)",[id(900),id(901)]);
  });
  await t.test('acceptance, immutable draft validation, reconnect and stale instance fencing',async()=>{
   await reserve(110);
   await member(1,110,'accept');await member(2,110,'accept');
   await assert.rejects(member(1,110,'poll',999),/another window/);
   await advance(110,'draft');await advance(110,'draft');
   const bad=draft([1,2]);bad.picks[0].track_id=bad.bans[0].track_id;
   await assert.rejects(advance(110,'race',bad),/ranked rules/);
   const outside=draft([1,2]);outside.picks[0].track_id='custom';
   await assert.rejects(advance(110,'race',outside),/ranked rules/);
   await advance(110,'race',draft([1,2]));await advance(110,'race',draft([1,2]));
   await assert.rejects(member(1,110,'withdraw'),/retains your seat/);
   await db.query("update public.polycup_ranked_members set seen_at=now()-interval '36 seconds' where match_id=$1 and player_id=$2",[id(110),id(1)]);
   await member(1,110,'poll',999);
   await assert.rejects(report(1,110),/Rejoin/);
   await report(1,110,evidence(),999);
   await assert.rejects(finalize(110),/consistent reports/);
   await report(2,110);
  });
  await t.test('rating settlement is atomic, guarded and idempotent; history is public',async()=>{
   await assert.rejects(finalize(110,batch(),'wrong'),/Wrong match/);
   const stale=batch();stale[1].before=4;
   await assert.rejects(finalize(110,stale),/state changed/);
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,0);
   assert.equal((await db.query('select rating from public.player_ratings where player_id=$1',[id(1)])).rows[0].rating,null);
   await finalize(110);await finalize(110);
   const changed=batch();changed[0].after++;
   await assert.rejects(finalize(110,changed),/differs/);
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,2);
   assert.equal((await db.query('select rated_matches from public.player_ratings where player_id=$1',[id(1)])).rows[0].rated_matches,1);
   assert.equal((await db.query('select * from public.polycup_ranked_claims')).rows.length,0);
   const history=(await query('anon',null,'select * from public.polycup_ranked_history($1)',[id(1)])).rows;
   assert.equal(history.length,1);assert.equal(history[0].place,1);assert.equal(history[0].rating_after,1000);
   assert.equal((await board()).rows.length,0); // provisional does not take a place
   const profile=(await query('anon',null,'select * from public.polycup_ranked_profile($1)',[id(1)])).rows[0];
   assert.equal(profile.tier,'provisional');assert.equal(profile.leaderboard_position,null);
  });
  await t.test('report normalization, mismatches, replacement denial and safe expiry',async()=>{
   await start(120);
   await assert.rejects(report(3,120),/Rejoin/);
   const invalid=evidence();invalid.standings[1].player_id=id(4);
   await assert.rejects(report(1,120,invalid),/roster/);
   await report(1,120);
   const reversed=evidence();reversed.standings.reverse();await report(1,120,reversed);
   await assert.rejects(report(1,120,evidence([1,2],'c')),/cannot be replaced/);
   await report(2,120,evidence([1,2],'c'));
   assert.equal((await member(1,120)).rows[0].value.status,'disputed');
   await assert.rejects(finalize(120),/consistent reports/);
   await db.query("update public.polycup_ranked_matches set deadline=now()-interval '1 second' where id=$1",[id(120)]);
   assert.equal((await member(1,120)).rows[0].value.status,'unrated');
   await assert.rejects(finalize(120),/consistent reports/);
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,2);
  });
  await t.test('missing reports and host loss release seats without inventing a result',async()=>{
   await start(130);await report(1,130);
   await db.query("update public.polycup_ranked_matches set deadline=now()-interval '1 second' where id=$1",[id(130)]);
   await service('select public.polycup_ranked_expire()');
   assert.equal((await member(2,130)).rows[0].value.status,'unrated');
   await start(131);
   await db.query("update public.polycup_ranked_members set seen_at=now()-interval '121 seconds' where match_id=$1 and player_id=$2",[id(131),id(1)]);
   assert.equal((await member(2,131)).rows[0].value.status,'unrated');
   await reserve(132);await db.query("update public.polycup_ranked_matches set deadline=now()-interval '1 second' where id=$1",[id(132)]);
   assert.equal((await member(2,132)).rows[0].value.status,'cancelled');
   await start(133,[1,2,3,4]);await advance(133,'unrated');
   assert.equal((await db.query('select * from public.polycup_ranked_claims')).rows.length,0);
  });
  await t.test('GM is at most ten current Masters; stable global positions survive pagination',async()=>{
   await db.exec("update public.player_ratings set rating=3000,rated_matches=10,updated_at='2026-01-01'");
   const initial=(await board()).rows;
   assert.equal(initial.length,19); // guest excluded
   assert.equal(initial.filter(x=>x.tier==='grandmaster').length,10);
   assert.equal(initial[9].gm_position,10);assert.equal(initial[10].tier,'master');
   const page=(await board(3,8)).rows;assert.deepEqual(page.map(x=>x.leaderboard_position),[9,10,11]);
   assert.deepEqual(Object.keys(initial[0]).sort(),['player_id','display_name','rating','rated_matches','leaderboard_position','tier','gm_position'].sort());
   // A provisional player with the largest rating cannot displace anyone.
   await db.query('update public.player_ratings set rating=9999,rated_matches=1 where player_id=$1',[id(1)]);
   let rows=(await board()).rows;assert.equal(rows[0].player_id,id(2));assert.equal(rows[9].player_id,id(11));
   // Fewer than ten Masters leaves the remaining GM positions unfilled.
   await db.exec('update public.player_ratings set rating=2400');
   await db.query('update public.player_ratings set rating=2500 where player_id=any($1)',[[id(2),id(3),id(4)]]);
   rows=(await board()).rows;assert.equal(rows.filter(x=>x.tier==='grandmaster').length,3);
   assert.equal(rows[3].tier,'diamond');assert.equal(rows[3].gm_position,null);
   // Threshold-crossing demotion is immediate; no stale stored GM flag.
   await db.query('update public.player_ratings set rating=2499 where player_id=$1',[id(2)]);
   assert.equal((await board()).rows.filter(x=>x.tier==='grandmaster').length,2);
  });
  await t.test('account deletion releases active seats and preserves other players completed history',async()=>{
   await start(150);
   await db.query('delete from auth.users where id=$1',[id(1)]);
   assert.equal((await member(2,150)).rows[0].value.status,'unrated');
   assert.equal((await db.query('select * from public.polycup_ranked_claims')).rows.length,0);
   assert.equal((await query('anon',null,'select * from public.polycup_ranked_history($1)',[id(2)])).rows.length,1);
   assert.equal((await query('anon',null,'select * from public.polycup_ranked_history($1)',[id(1)])).rows.length,0);
  });
 } finally {await db.close();}
});
