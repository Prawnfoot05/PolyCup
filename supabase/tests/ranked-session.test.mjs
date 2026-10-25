import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('ranked draft and handoff enforce the fixed roster and server transitions',async t=>{
 const db=await PGlite.create();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
 for(let i=1;i<=3;i++)await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id(i),{full_name:'Racer '+i}]);
 await db.exec('update public.polycup_ranked_config set enabled=true,provisional_matches=3,tier_floors=array[0,5000,10000,15000,20000,25000]');
 const pool=Array.from({length:16},(_,i)=>({id:(i+1).toString(16).padStart(64,'0'),category:'official',digest:'a'.repeat(64)}));
 const as=(who,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id(who)]);return tx.query(sql,args);});
 const session=async(who,action='poll',value=null,instance=id(100+who))=>(await as(who,'select public.polycup_ranked_session($1,$2,$3,$4) s',[id(500),instance,action,JSON.stringify(value)])).rows[0].s;
 await db.query('select public.polycup_ranked_reserve($1,$2,$3)',[id(500),[id(1),id(2)],pool]);
 for(let i=1;i<=2;i++)await as(i,"select public.polycup_ranked_member($1,$2,'accept')",[id(500),id(100+i)]);
 await db.query("select public.polycup_ranked_advance($1,'draft')",[id(500)]);
 await t.test('versioned static snapshot omits catalog/rules only on a matching cache key; permissions still apply',async()=>{
  const call=async(who,key=null,action='poll',value=null)=>(await as(who,'select public.polycup_ranked_session_v2($1,$2,$3,$4,$5) s',[id(500),id(100+who),action,JSON.stringify(value),key])).rows[0].s;
  const first=await call(1);assert.deepEqual(first.pool,pool);assert.equal(first.rules.pointsToWin,140);
  const next=await call(1,first.static_key);assert.equal(next.pool,undefined);assert.equal(next.rules,undefined);assert.equal(next.members.length,2);
  assert.deepEqual((await call(1,'old-game-catalog')).pool,pool);
  await assert.rejects(call(3,first.static_key),/not in this ranked/);
  await assert.rejects(call(2,first.static_key,'ban',pool[0].id),/turn/);
  await db.query("update public.polycup_ranked_matches set rules=rules||'{\"cache_test\":true}'::jsonb where id=$1",[id(500)]);
  const changed=await call(1,first.static_key);assert.notEqual(changed.static_key,first.static_key);assert.ok(changed.pool);assert.ok(changed.rules.cache_test);
  await db.query("update public.polycup_ranked_matches set rules=rules-'cache_test' where id=$1",[id(500)]);
  assert.equal((await call(1)).static_key,first.static_key);
 });
 await t.test('lobby rank batch is membership-bound and includes only public rating fields',async()=>{
  await db.query('update public.player_ratings set rating=27845,rated_matches=20 where player_id=$1',[id(1)]);
  const ranks=(await as(1,'select public.polycup_lobby_ranks($1,$2,true) r',[id(500),id(101)])).rows[0].r;
  assert.equal(ranks['1'].tier,'grandmaster');assert.equal(ranks['1'].rating,27845);assert.equal(ranks['2'],null);assert.equal(ranks['1'].mu,undefined);
  await assert.rejects(as(3,'select public.polycup_lobby_ranks($1,$2,true)',[id(500),id(103)]),/Join this lobby/);
  await assert.rejects(as(1,'select public.polycup_lobby_ranks($1,$2,true)',[id(500),id(999)]),/Join this lobby/);
 });
 await t.test('only reserved accounts can act; host cannot edit rules or pick out of turn',async()=>{
  await assert.rejects(session(3),/not in this ranked/);await assert.rejects(session(1,'preset',{}),/unavailable/);
  await assert.rejects(session(2,'ban',pool[0].id),/turn/);await assert.rejects(session(1,'pick',pool[5].id),/bans/);
  await assert.rejects(session(1,'ban','custom'),/pool/);
  await assert.rejects(session(1,'race'),/attempt/);
  for(let i=0;i<4;i++)await session(i%2+1,'ban',pool[i].id);
  await assert.rejects(session(1,'pick',pool[0].id),/unavailable/);
  for(let i=1;i<=2;i++){await session(i,'pick',pool[4].id);await session(i,'pick',pool[5].id);}
  await assert.rejects(session(1,'pick',pool[6].id),/Two picks/);
 });
 let attempt;
 await t.test('all-ready creates a grace period; stale attempts and missing bindings cannot start',async()=>{
  assert.equal((await session(1,'draft-ready','ready')).session.launch,null);
  const both=await session(2,'draft-ready','ready');assert.equal(both.session.launch.stage,'grace');assert.equal(both.session.chat.at(-1).text,'Match starting in 5…');attempt=both.session.launch.id;
  await assert.rejects(session(1,'remove-pick',pool[4].id),/locked/);
  await assert.rejects(session(1,'code',{attempt,code:'TESTCODE'}),/invitation/);
  await db.query("update public.polycup_ranked_matches set session=jsonb_set(session,'{launch,at}',to_jsonb((extract(epoch from now())*1000-1)::bigint)) where id=$1",[id(500)]);
  assert.equal((await session(1)).session.launch.stage,'connecting');
  await assert.rejects(session(2,'code',{attempt,code:'TESTCODE'}),/invitation/);
  await session(1,'code',{attempt,code:'TESTCODE'});
  await assert.rejects(session(1,'race',attempt),/every connection/);
 });
 await t.test('failure preserves choices and retry rotates attempt; all verified tickets are required',async()=>{
  const failed=await session(2,'failed',attempt);assert.equal(failed.session.picks.length,4);assert.equal(failed.session.launch,null);assert.deepEqual(failed.session.ready,[]);
  await session(1,'draft-ready','ready');const ready=await session(2,'draft-ready','ready');assert.notEqual(ready.session.launch.id,attempt);const old=attempt;attempt=ready.session.launch.id;
  await assert.rejects(session(1,'bind',{attempt:old,ticket:ready.ticket,native:2}),/binding/);
  await db.query("update public.polycup_ranked_matches set session=jsonb_set(session,'{launch,at}',to_jsonb((extract(epoch from now())*1000-1)::bigint)) where id=$1",[id(500)]);
  const host=await session(1),guest=await session(2);
  assert.equal(await session(1,'bind',{attempt,ticket:host.ticket,native:0}),1);
  await assert.rejects(session(1,'bind',{attempt,ticket:guest.ticket,native:0}),/unavailable/);
  await session(1,'bind',{attempt,ticket:guest.ticket,native:2});
  const racing=await session(1,'race',attempt);assert.equal(racing.status,'racing');assert.equal(racing.rules.roundsPerTrack,3);assert.equal(racing.rules.pointsToWin,140);
  assert.equal((await session(1,'race',attempt)).status,'racing');
  await assert.rejects(session(2,'pick',pool[8].id),/locked/);
 });
 await t.test('reconnect rotates the ticket and host departure preserves the forfeit grace',async()=>{
  const before=await session(2);await assert.rejects(session(2,'poll',null,id(999)),/another window/);
  await db.query("update public.polycup_ranked_members set seen_at=now()-interval '36 seconds' where player_id=$1",[id(2)]);
  const next=await session(2,'poll',null,id(999));assert.notEqual(next.ticket,before.ticket);
  await assert.rejects(session(1,'bind',{attempt,ticket:before.ticket,native:3}),/unavailable/);
  await session(1,'bind',{attempt,ticket:next.ticket,native:3});
  await session(1,'leave');assert.equal((await session(2,'poll',null,id(999))).status,'racing');
  await db.query("update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds' where player_id=$1",[id(1)]);
  assert.equal(await session(2,'poll',null,id(999)),null);
  assert.equal((await db.query('select * from public.polycup_ranked_claims')).rows.length,2);
 });
 await t.test('friends leaderboard includes self and accepted friends, preserving global positions',async()=>{
  await db.query('update public.player_ratings set rating=8000,rated_matches=20 where player_id=$1',[id(2)]);
  await db.query('update public.player_ratings set rating=40000,rated_matches=20 where player_id=$1',[id(3)]);
  await db.query("insert into public.friendships(requester_id,addressee_id,status) values($1,$2,'accepted'),($1,$3,'pending')",[id(1),id(2),id(3)]);
  const rows=(await as(1,'select * from public.polycup_friends_leaderboard(26,0)')).rows;
  assert.deepEqual(rows.map(r=>r.player_id),[id(1),id(2)]);assert.deepEqual(rows.map(r=>Number(r.friend_position)),[1,2]);assert.deepEqual(rows.map(r=>Number(r.leaderboard_position)),[2,3]);
  assert.equal((await as(1,'select * from public.polycup_friends_leaderboard(1,1)')).rows[0].player_id,id(2));
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select * from public.polycup_friends_leaderboard()');}),/permission denied/);
 });
 }finally{await db.close();}
});
