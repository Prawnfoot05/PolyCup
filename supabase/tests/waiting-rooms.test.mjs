import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('waiting rooms isolate membership and fence racing handoffs',async t=>{
 const db=await PGlite.create();
 try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;`);
  await db.exec(await readFile('supabase/migrations/20261021040000_waiting_rooms.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20261021050000_single_cup_membership.sql','utf8'));
  for(let n=1;n<=4;n++)await db.query('insert into auth.users values($1)',[id(n)]);
  async function as(who,sql,params=[],role='authenticated'){
   return db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[who? id(who):'']);return tx.query(sql,params);});
  }
  const rpc=async(who,op,args={},instance=who+10)=>(await as(who,'select public.polycup_room($1,$2,$3,$4) result',[op,id(100),id(instance),args])).rows[0].result;
  const data={cup:{id:id(100),name:'Friday Cup',phase:'registration',draft:{stage:'roster'},roster:[]},public:true,chat:[],codes:{},muted:[],launch:null};
  let host,guest;
  await t.test('guests may browse; only authenticated room members may read state',async()=>{
   const rows=await as(null,'select public.polycup_room_directory() rows',[],'anon');assert.deepEqual(rows.rows[0].rows,[]);
   host=await rpc(1,'create',{data,version:'test',name:'Host'});
   assert.equal(host.self,1);assert.equal((await as(null,'select public.polycup_room_directory() rows',[],'anon')).rows[0].rows.length,1);
   await assert.rejects(as(null,'select * from public.polycup_rooms',[],'anon'),/permission denied/);
   await assert.rejects(rpc(2,'poll'),/Join this waiting room/);
   guest=await rpc(2,'join',{version:'test',name:'Guest'});assert.equal(guest.self,2);
   assert.notEqual(guest.ticket,host.ticket);assert.ok(!JSON.stringify(guest.members).includes(host.ticket));
  });
  await t.test('window leases, host rights and private room codes',async()=>{
   await assert.rejects(rpc(2,'poll',{},88),/Join this waiting room/);
   await assert.rejects(rpc(2,'event',{kind:'start',request:id(200)}),/Only the host/);
   host=await rpc(1,'poll');host.data.public=false;
   host=await rpc(1,'commit',{revision:host.revision,data:host.data,results:[]});
   await assert.rejects(rpc(3,'join',{version:'test',name:'Other'}),/private/);
   await assert.rejects(rpc(3,'join',{version:'old',name:'Other',code:host.code}),/Update/);
   assert.equal((await rpc(3,'join',{version:'test',name:'Other',code:host.code})).self,3);
  });
  await t.test('pending unready invalidates concurrent start commit; retries are idempotent',async()=>{
   host=await rpc(1,'poll');host.data.launch={id:id(300),stage:'grace',at:Date.now()-1000,code:''};host.data.cup.roster=[{id:1,name:'Host'},{id:2,name:'Guest'}];
   host=await rpc(1,'commit',{revision:host.revision,data:host.data,results:[]});
   const old=host.revision;
   guest=await rpc(2,'event',{kind:'draft-ready',value:'editing',request:id(201)});
   const retry=await rpc(2,'event',{kind:'draft-ready',value:'editing',request:id(201)});assert.equal(retry.revision,guest.revision);
   host.data.launch.stage='connecting';
   await assert.rejects(rpc(1,'commit',{revision:old,data:host.data,results:[]}),/Room changed/);
   host=await rpc(1,'poll');host.data.launch.stage='connecting';
   await assert.rejects(rpc(1,'commit',{revision:host.revision,data:host.data,results:[]}),/grace period/);
   host.data.launch=null;
   host=await rpc(1,'commit',{revision:host.revision,data:host.data,results:host.events.map(e=>({seq:e.seq,error:null}))});
   assert.equal((await rpc(2,'poll')).results[0].error,null);
  });
  await t.test('start cannot skip grace or acquire another player ticket; all racers required',async()=>{
   host=await rpc(1,'poll');host.data.launch={id:id(301),stage:'grace',at:Date.now()+50000,code:''};
   host=await rpc(1,'commit',{revision:host.revision,data:host.data,results:[]});host.data.launch.stage='connecting';
   await assert.rejects(rpc(1,'commit',{revision:host.revision,data:host.data,results:[]}),/grace period/);
   await db.query("update public.polycup_rooms set data=jsonb_set(data,'{launch,at}',to_jsonb($1::bigint)) where id=$2",[Date.now()-1000,id(100)]);
   host=await rpc(1,'poll');host.data.launch.stage='connecting';host=await rpc(1,'commit',{revision:host.revision,data:host.data,results:[]});
   await assert.rejects(rpc(2,'bind',{ticket:guest.ticket,native:5,launch:id(301)}),/matching start/);
   await assert.rejects(rpc(1,'bind',{ticket:guest.ticket,native:5,launch:id(300)}),/matching start/);
   assert.equal(await rpc(1,'bind',{ticket:host.ticket,native:1,launch:id(301)}),1);
   host.data.launch.stage='racing';await assert.rejects(rpc(1,'commit',{revision:host.revision,data:host.data,results:[]}),/Every racer/);
   await assert.rejects(rpc(1,'bind',{ticket:guest.ticket,native:1,launch:id(301)}),/already assigned/);
   assert.equal(await rpc(1,'bind',{ticket:guest.ticket,native:5,launch:id(301)}),2);
   host=await rpc(1,'commit',{revision:host.revision,data:host.data,results:[]});assert.equal(host.data.launch.stage,'racing');
  });
  await t.test('unchanged polls omit snapshots; departed and stale rooms are inaccessible',async()=>{
   const same=await rpc(2,'poll',{revision:host.revision});assert.equal(same.data,null);
   await rpc(3,'leave');await assert.rejects(rpc(3,'poll'),/Join this/);
   const late=await rpc(4,'join',{version:'test',name:'Late spectator',code:host.code});assert.equal(late.self,4,'departed racer IDs must never be recycled');
   assert.equal(late.data.cup.roster.length,2,'late join starts as a spectator');
   host=await rpc(1,'poll');host.data.cup.tracks=[{id:'custom',name:'Custom'}];host.data.codes={custom:'large-track-export'};
   host=await rpc(1,'commit',{revision:host.revision,data:host.data,results:[]});
   assert.deepEqual(host.data.codes,{});assert.deepEqual((await rpc(2,'poll')).data.codes,{});
   assert.deepEqual(await rpc(1,'tracks'),{custom:'large-track-export'});await assert.rejects(rpc(2,'tracks'),/Only the host/);
   await rpc(1,'kick',{member:4});await assert.rejects(rpc(4,'join',{version:'test',name:'Late spectator',code:host.code}),/removed/);
   await db.exec("update public.polycup_rooms set seen_at=now()-interval '91 seconds'");
   await assert.rejects(rpc(1,'poll'),/no longer available/);
  });
 }finally{await db.close();}
});
