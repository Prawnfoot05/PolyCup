import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('public lobby announcements enforce ownership, expiry, leases and fresh joins',async t=>{
 const db=await PGlite.create();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const file of ['20261021000000_account_friends_foundation.sql','20261021010000_friends_presence.sql','20261021020000_lobby_directory.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  for(let n=1;n<4;n++)await db.query('insert into auth.users values($1,$2)',[id(n),{full_name:'Player '+n}]);
  async function as(actor,sql,params=[],role='authenticated'){
   await db.exec('set role '+role);try{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);return await db.query(sql,params);}finally{await db.exec('reset role');}
  }
  const publish=(actor=id(1),instance=id(10),options={})=>as(actor,'select public.polycup_list_lobby($1,$2,$3,$4,$5,$6,$7,$8,$9)',[instance,'cup-a','Friday Cup','ABCDEFGH','0.4.0-dev.1','waiting',options.players??3,8,options.seconds??3600]);
  const list=async()=> (await as(id(2),'select * from public.polycup_lobbies()')).rows;
  const join=(cup='cup-a',version='0.4.0-dev.1')=>as(id(2),'select public.polycup_join_lobby($1,$2,$3) code',[id(1),cup,version]);
  await t.test('empty until explicitly listed; only display fields exposed',async()=>{
   assert.deepEqual(await list(),[]);await publish();const row=(await list())[0];
   assert.equal(row.host_name,'Player 1');assert.equal(row.players,3);assert.ok(!('invite_code' in row));assert.ok(!('instance_id' in row));
   await assert.rejects(as(id(2),'select * from public.polycup_lobby_listings'),/permission denied/);
   await assert.rejects(as(null,'select * from public.polycup_lobbies()',[],'anon'),/permission denied/);
  });
  await t.test('ownership and instance leases prevent other accounts or windows changing a listing',async()=>{
   await as(id(2),'select public.polycup_unlist_lobby($1)',[id(10)]);assert.equal((await list()).length,1);
   await as(id(1),'select public.polycup_unlist_lobby($1)',[id(11)]);assert.equal((await list()).length,1);
   await assert.rejects(publish(id(1),id(11)),/Another window/);await publish();assert.equal((await list()).length,1);
  });
  await t.test('join validates the current cup, version and capacity',async()=>{
   assert.equal((await join()).rows[0].code,'ABCDEFGH');await assert.rejects(join('old-cup'),/unavailable/);
   await assert.rejects(join('cup-a','0.3.3'),/unavailable/);await publish(id(1),id(10),{players:8});await assert.rejects(join(),/unavailable/);
  });
  await t.test('stale heartbeats and expired invites disappear and cannot be joined',async()=>{
   await db.exec("update public.polycup_lobby_listings set updated_at=now()-interval '91 seconds'");assert.deepEqual(await list(),[]);await assert.rejects(join(),/unavailable/);
   await publish(id(1),id(11));assert.equal((await list()).length,1);
   await db.exec("update public.polycup_lobby_listings set invite_expires_at=now()-interval '1 second'");assert.deepEqual(await list(),[]);await assert.rejects(join(),/unavailable/);
  });
  await t.test('invalid counts, missing identity and bad lifetime cannot be published',async()=>{
   await assert.rejects(publish(null),/Sign in/);await assert.rejects(publish(id(1),id(10),{players:17}),/Invalid/);await assert.rejects(publish(id(1),id(10),{seconds:99999}),/Invalid/);
  });
  await t.test('guest access migration opens browsing and joining but not listing writes',async()=>{
   await db.exec(await readFile(new URL('../migrations/20261021030000_guest_lobby_access.sql',import.meta.url),'utf8'));
   await publish();
   assert.equal((await as(null,'select * from public.polycup_lobbies()',[],'anon')).rows.length,1);
   assert.equal((await as(null,'select public.polycup_join_lobby($1,$2,$3) code',[id(1),'cup-a','0.4.0-dev.1'],'anon')).rows[0].code,'ABCDEFGH');
   await assert.rejects(as(null,'select public.polycup_unlist_lobby($1)',[id(10)],'anon'),/permission denied/);
   await assert.rejects(as(null,'select * from public.polycup_lobby_listings',[],'anon'),/permission denied/);
  });
  await t.test('unlisting is immediate and account deletion removes its announcement',async()=>{
   await publish();await as(id(1),'select public.polycup_unlist_lobby($1)',[id(10)]);assert.deepEqual(await list(),[]);
   await publish();await db.query('delete from auth.users where id=$1',[id(1)]);assert.deepEqual(await list(),[]);
  });
 }finally{await db.close();}
});
