import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('private Cup invitations are restricted to current members and accepted friends',async()=>{
 const db=await PGlite.create();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const f of ['20261021000000_account_friends_foundation.sql','20261021010000_friends_presence.sql','20261021040000_waiting_rooms.sql','20261021050000_single_cup_membership.sql','20261021060000_friend_cup_invites.sql'])await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  for(let n=1;n<=3;n++)await db.query('insert into auth.users values($1,$2)',[id(n),{full_name:'Player '+n}]);
  await db.query("insert into public.friendships(requester_id,addressee_id,status) values($1,$2,'accepted')",[id(1),id(2)]);
  const as=(who,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id(who)]);return tx.query(sql,args);});
  const data={cup:{id:id(100),name:'Private Cup',phase:'registration',draft:{stage:'roster'},roster:[]},public:false,launch:null};
  await as(1,"select public.polycup_room('create',$1,$2,$3)",[id(100),id(11),{version:'test',name:'Host',data}]);
  const send=(friend,instance=11)=>as(1,'select public.polycup_invite_friend($1,$2,$3)',[id(100),id(instance),id(friend)]);
  await assert.rejects(send(3),/only invite your friends/);
  await assert.rejects(send(2,99),/Rejoin/);
  await send(2);await send(2);
  const list=who=>as(who,'select * from public.polycup_friend_invites()');
  const invitations=(await list(2)).rows;assert.equal(invitations.length,1);assert.equal(invitations[0].room_title,'Private Cup');assert.ok(invitations[0].code);
  assert.equal((await list(3)).rows.length,0);
  await as(3,'select public.polycup_dismiss_invite($1)',[invitations[0].id]);assert.equal((await list(2)).rows.length,1);
  await assert.rejects(as(2,'select * from public.polycup_friend_invites'),/permission denied/);
  await as(2,'select public.polycup_dismiss_invite($1)',[invitations[0].id]);assert.equal((await list(2)).rows.length,0);
  await send(2);await db.exec("update public.polycup_friend_invites set created_at=now()-interval '6 minutes'");assert.equal((await list(2)).rows.length,0);
  await send(2);await db.exec('delete from public.friendships');assert.equal((await list(2)).rows.length,0);
 }finally{await db.close();}
});
