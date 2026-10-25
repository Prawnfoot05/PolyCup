import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('friend activity and joining expose only live public accepted-friend rooms',async()=>{
 const db=await PGlite.create();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const f of ['20261021000000_account_friends_foundation.sql','20261021010000_friends_presence.sql','20261021040000_waiting_rooms.sql','20261021050000_single_cup_membership.sql','20261022050000_friend_public_games.sql'])await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 for(let n=1;n<=3;n++)await db.query('insert into auth.users values($1,$2)',[id(n),{full_name:'Player '+n}]);
 await db.query("insert into public.friendships(requester_id,addressee_id,status) values($1,$2,'accepted'),($1,$3,'pending')",[id(1),id(2),id(3)]);
 const as=(who,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id(who)]);return tx.query(sql,args);});
 const data={cup:{id:id(100),name:'Cup',phase:'registration',draft:{stage:'roster'},roster:[]},public:false,launch:null};
 await as(1,"select public.polycup_room('create',$1,$2,$3)",[id(100),id(11),{version:'test',name:'Host',data}]);
 const list=async who=>(await as(who,'select * from public.polycup_friends_v2()')).rows;
 const join=who=>as(who,'select public.polycup_friend_game($1) code',[id(1)]);
 assert.equal((await list(2))[0].activity,null);await assert.rejects(join(2),/no longer/);
 await db.exec("update public.polycup_rooms set data=jsonb_set(data,'{public}','true')");
 assert.equal((await list(2))[0].activity,'lobby');assert.equal((await list(2))[0].can_join,true);assert.ok((await join(2)).rows[0].code);
 assert.equal((await list(3))[0].can_join,false);await assert.rejects(join(3),/no longer/);
 await db.exec(`update public.polycup_rooms set data=jsonb_set(data,'{launch}','{"stage":"racing"}')`);assert.equal((await list(2))[0].activity,'racing');
 await db.exec("update public.polycup_rooms set data=jsonb_set(data,'{public}','false')");await assert.rejects(join(2),/no longer/);assert.equal((await list(2))[0].activity,null);
 await db.exec("update public.polycup_rooms set data=jsonb_set(data,'{public}','true'),seen_at=now()-interval '91 seconds'");assert.equal((await list(2))[0].can_join,false);
 await db.exec("update public.polycup_rooms set seen_at=now();update public.polycup_room_members set seen_at=now()-interval '36 seconds'");await assert.rejects(join(2),/no longer/);
 await db.exec('update public.polycup_room_members set seen_at=now()');await db.query('update public.polycup_rooms set blocked=$1',[[id(2)]]);await assert.rejects(join(2),/no longer/);
 await assert.rejects(as(2,'select * from public.polycup_friend_public_game($1)',[id(1)]),/permission denied/);
 }finally{await db.close();}
});
