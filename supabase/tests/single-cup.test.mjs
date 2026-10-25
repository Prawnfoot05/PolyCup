import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('account admission fences separate Cups and preserves reconnects',async()=>{
 const db=await PGlite.create();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;`);
  for(const f of ['20261021040000_waiting_rooms.sql','20261021050000_single_cup_membership.sql'])await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  for(let n=1;n<=3;n++)await db.query('insert into auth.users values($1)',[id(n)]);
  const rpc=(who,room,op,instance,args={})=>db.transaction(async tx=>{
   await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id(who)]);
   return (await tx.query('select public.polycup_room($1,$2,$3,$4) result',[op,id(room),id(instance),args])).rows[0].result;
  });
  const create=(who,room,instance)=>rpc(who,room,'create',instance,{version:'test',name:'Host',data:{cup:{id:id(room),name:'Cup',phase:'registration',draft:{stage:'roster'},roster:[]},public:true,launch:null}});
  const join=(room,instance)=>rpc(3,room,'join',instance,{version:'test',name:'Racer'});
  await create(1,100,11);await create(2,200,22);
  const admitted=await Promise.allSettled([join(100,31),join(200,32)]);
  assert.equal(admitted.filter(r=>r.status==='fulfilled').length,1);
  const first=admitted[0].status==='fulfilled'?100:200,other=first===100?200:100;
  const instance=first===100?31:32;
  const original=await rpc(3,first,'poll',instance);
  await assert.rejects(join(other,33),/already in another Cup/);
  await assert.rejects(create(3,300,33),/already in another Cup/);
  await assert.rejects(join(first,33),/another window/);
  await db.query("update public.polycup_room_members set seen_at=now()-interval '36 seconds' where actor=$1",[id(3)]);
  await assert.rejects(join(other,33),/already in another Cup/);
  const rejoined=await join(first,33);
  assert.equal(rejoined.self,original.self);assert.notEqual(rejoined.ticket,original.ticket);
  await assert.rejects(rpc(3,first,'poll',instance),/Join this waiting room first/);
  await rpc(3,first,'leave',33);await join(other,33);
  await db.query("update public.polycup_rooms set seen_at=now()-interval '91 seconds' where id=$1",[id(other)]);
  await join(first,34);
  await assert.rejects(rpc(3,other,'poll',33),/no longer available/);
  await db.transaction(async tx=>{
   await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id(3)]);
   await assert.rejects(tx.query("select public.polycup_room_internal('join',$1,$2,'{}')",[id(other),id(35)]),/permission denied/);
  });
 }finally{await db.close();}
});
