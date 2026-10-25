import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [alice,bob,charlie]=[id(1),id(2),id(3)];
test('friends and presence enforce identity, relationship privacy, expiry, and request limits',async t=>{
 const db=await PGlite.create();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to authenticated,anon,service_role;
   grant execute on function auth.uid() to authenticated,anon,service_role;`);
  await db.exec(await readFile(new URL('../migrations/20261021000000_account_friends_foundation.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1,$2)',[alice,{full_name:'Alice',email:'private@example.test',custom_claims:{global_name:'Alice display'}}]);
  await db.exec(await readFile(new URL('../migrations/20261021010000_friends_presence.sql',import.meta.url),'utf8'));
  for(const [player,name] of [[bob,'Bob'],[charlie,'Charlie']]) await db.query('insert into auth.users values($1,$2)',[player,{full_name:name,avatar_url:'https://cdn.discordapp.com/embed/avatars/0.png'}]);
  async function as(user,sql,params=[],role='authenticated') {
   await db.exec(`set role ${role}`);
   try {await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);return await db.query(sql,params);}
   finally {await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}
  }
  const list=async user=>(await as(user,'select * from public.polycup_friends()')).rows;
  const touch=(user,session)=>as(user,'select public.polycup_presence_touch($1)',[session]);
  const leave=(user,session)=>as(user,'select public.polycup_presence_leave($1)',[session]);
  const request=(from,to)=>as(from,'insert into public.friendships(requester_id,addressee_id) values($1,$2) returning id',[from,to]);
  let friendship;
  await t.test('backfill and signup expose only display identity, not private auth fields',async()=>{
   const row=(await as(alice,'select * from public.profiles where id=$1',[alice])).rows[0];
   assert.equal(row.discord_name,'Alice display'); assert.equal(row.discord_username,'Alice'); assert.ok(!('email' in row));
   const other=(await as(alice,'select * from public.profiles where id=$1',[bob])).rows[0];
   assert.match(other.avatar_url,/cdn.discordapp.com/);
   await assert.rejects(as(alice,"update public.profiles set discord_name='Forged' where id=$1",[alice]),/permission denied/);
   await db.query('update auth.users set raw_user_meta_data=$1 where id=$2',[{full_name:'Updated',avatar_url:'https://evil.test/avatar.png'},bob]);
   assert.equal((await as(alice,'select avatar_url from public.profiles where id=$1',[bob])).rows[0].avatar_url,'');
  });
  await t.test('search excludes self, bounds results, and treats wildcard characters literally',async()=>{
   assert.equal((await as(alice,'select * from public.polycup_find_players($1)',['Bo'])).rows[0].player_id,bob);
   for(const q of ['B','%_','Alice','x'.repeat(65)]) assert.equal((await as(alice,'select * from public.polycup_find_players($1)',[q])).rows.length,0);
   const row=(await as(alice,'select * from public.polycup_find_players($1)',[bob])).rows[0];
   assert.equal(row.player_id,bob); assert.ok(!('online' in row)); assert.ok(!('last_seen' in row));
  });
  await t.test('pending requests do not expose presence and outsiders see no relationships',async()=>{
   friendship=(await request(alice,bob)).rows[0].id; await touch(bob,id(100));
   assert.equal((await list(alice))[0].online,false);assert.equal((await list(bob))[0].direction,'incoming');
   assert.deepEqual(await list(charlie),[]);
   await assert.rejects(as(charlie,'select * from public.friend_presence_sessions'),/permission denied/);
   await assert.rejects(as(null,'select * from public.polycup_friends()',[],'anon'),/permission denied/);
   await assert.rejects(touch(null,id(100)),/Sign in first/);
  });
  await t.test('only recipient acceptance reveals presence to friends',async()=>{
   assert.equal((await as(alice,"update public.friendships set status='accepted' where id=$1 returning id",[friendship])).rows.length,0);
   await as(bob,"update public.friendships set status='accepted' where id=$1",[friendship]);
   assert.equal((await list(alice))[0].online,true);assert.deepEqual(await list(charlie),[]);
  });
  await t.test('multiple sessions aggregate and callers cannot remove another player presence',async()=>{
   await touch(bob,id(101));await leave(alice,id(100));assert.equal((await list(alice))[0].online,true);
   await leave(bob,id(100));assert.equal((await list(alice))[0].online,true);
   await leave(bob,id(101));assert.equal((await list(alice))[0].online,false);
  });
  await t.test('server timestamps expire stale sessions and repeated heartbeat does not trust client time',async()=>{
   await touch(bob,id(100));
   await db.query("update public.friend_presence_sessions set last_seen=now()-interval '91 seconds' where user_id=$1",[bob]);
   assert.equal((await list(alice))[0].online,false);
   await touch(bob,id(101));assert.equal((await list(alice))[0].online,true);
   assert.equal((await db.query('select count(*)::int n from public.friend_presence_sessions where user_id=$1',[bob])).rows[0].n,1);
   for(let n=200;n<212;n++)await touch(bob,id(n));
   assert.equal((await db.query('select count(*)::int n from public.friend_presence_sessions where user_id=$1',[bob])).rows[0].n,8);
  });
  await t.test('unfriending immediately hides presence and allows a new request',async()=>{
   await as(alice,'delete from public.friendships where id=$1',[friendship]);assert.deepEqual(await list(alice),[]);
   await request(bob,alice);assert.equal((await list(alice))[0].online,false);
   await as(alice,'delete from public.friendships');
  });
  await t.test('cancel and resend cannot bypass server request rate limit',async()=>{
   await db.query('delete from public.friend_request_limits where user_id=$1',[alice]);
   for(let n=0;n<10;n++){await request(alice,charlie);await as(alice,'delete from public.friendships');}
   await assert.rejects(request(alice,charlie),/Too many friend requests/);
   await db.query("update public.friend_request_limits set window_start=now()-interval '61 seconds' where user_id=$1",[alice]);
   await request(alice,charlie);
   await assert.rejects(as(alice,'delete from public.friend_request_limits'),/permission denied/);
  });
 } finally {await db.close();}
});
