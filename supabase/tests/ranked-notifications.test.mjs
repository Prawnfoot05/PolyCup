import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {settleLocalRanked,validateRankedTranscript} from '../ranked-validator.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('account-scoped unread rating notifications',async t=>{
 const db=await PGlite.create();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  for(let n=1;n<=3;n++)await db.query('insert into auth.users values($1,$2,false)',[id(n),{full_name:'Player '+n}]);
  await db.exec('update public.polycup_ranked_config set enabled=true,provisional_matches=3,tier_floors=array[0,5000,10000,15000,20000,25000]');
  const as=(who,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id(who)]);return tx.query(sql,args);});
  const pool=Array.from({length:8},(_,i)=>({id:String(i+1).padStart(64,'0'),category:'official',digest:'a'.repeat(64)}));
  const create=async n=>{
   const rules=(await db.query('select public.polycup_ranked_rules() r')).rows[0].r;
   const match={id:id(n),roster:[id(1),id(2)],rules,track_pool:pool,draft:{bans:pool.slice(0,4).map((x,i)=>({player_id:id(i%2+1),track_id:x.id})),picks:pool.slice(4).map((x,i)=>({player_id:id(i<2?1:2),track_id:x.id}))},session:{launch:{id:id(n+1),stage:'racing'}},started_at:new Date(Date.now()-60000).toISOString()};
   await db.query("insert into public.polycup_ranked_matches(id,host_id,status,roster,rules,track_pool,draft,session,started_at,model_version,deadline) values($1,$2,'racing',$3,$4,$5,$6,$7,$8,'btf-6.2.0-t025-softplus-v1',now()+interval '6 hours')",[match.id,id(1),match.roster,rules,pool,match.draft,match.session,match.started_at]);
   for(let p=1;p<=2;p++)await db.query('insert into public.polycup_ranked_members(match_id,player_id,instance_id,accepted,seen_at) values($1,$2,$3,true,now())',[match.id,id(p),id(100+p)]);
   const order=pool.slice(4).map(x=>x.id);
   const transcript={schema:1,match:match.id,launch:id(n+1),order,rounds:Array.from({length:15},(_,i)=>({round:i+1,track:order[Math.floor(i/3)%4],finishes:[{player:id(1),frames:1000},{player:id(2),frames:1500}]}))};
   return {match,transcript};
  };
  const submit=(who,value,instance=id(100+who))=>as(who,'select public.polycup_ranked_submit($1,$2,$3)',[value.match,instance,JSON.stringify(value)]);

 const claim=async(who,owner=id(800),match=null)=>(await as(who,'select public.polycup_ranked_claim_result($1,$2) r',[owner,match])).rows[0].r;
 const seen=(who,match)=>as(who,'select public.polycup_ranked_seen_result($1)',[match]);
 const x=await create(200);
 await t.test('pending results cannot be claimed or acknowledged',async()=>{
  await submit(1,x.transcript);assert.equal(await claim(1),null);await assert.rejects(seen(1,x.match.id),/No settled result/);
  await submit(2,x.transcript);assert.equal(await claim(2),null);
 });
 await settleLocalRanked(db,x.match.id);
 const baseline=(await db.query('select * from public.polycup_rating_events order by player_id')).rows;
 await t.test('only the player receives their own completed result; other accounts cannot consume it',async()=>{
  assert.equal(await claim(3,id(803),x.match.id),null);await assert.rejects(seen(3,x.match.id),/No settled result/);
  assert.equal(await claim(1),x.match.id);assert.equal(await claim(2,id(802)),x.match.id);
  await assert.rejects(as(1,'select * from public.polycup_ranked_result_receipts'),/permission denied/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select public.polycup_ranked_claim_result($1)',[id(899)]);}),/permission denied/);
 });
 await t.test('two instances cannot deliver simultaneously; reopening same installation resumes unshown result',async()=>{
  assert.equal(await claim(1,id(801)),null);assert.equal(await claim(1),x.match.id);
  await db.query("update public.polycup_ranked_result_receipts set delivery_until=now()-interval '1 second' where player_id=$1",[id(1)]);
  assert.equal(await claim(1,id(801)),x.match.id);
 });
 await t.test('acknowledgement survives repeated calls and does not affect ratings or another player',async()=>{
  await seen(1,x.match.id);await seen(1,x.match.id);assert.equal(await claim(1,id(800)),null);assert.equal(await claim(1,id(801),x.match.id),null);
  assert.equal(await claim(2,id(802)),x.match.id);assert.deepEqual((await db.query('select * from public.polycup_rating_events order by player_id')).rows,baseline);
  await seen(2,x.match.id);
 });
 await t.test('multiple new results are delivered oldest first without changing history',async()=>{
  for(const n of [300,400]){const next=await create(n);await submit(1,next.transcript);await submit(2,next.transcript);await settleLocalRanked(db,next.match.id);}
  assert.equal(await claim(1),id(300));await seen(1,id(300));assert.equal(await claim(1),id(400));await seen(1,id(400));assert.equal(await claim(1),null);
  assert.equal((await db.query('select * from public.polycup_ranked_history($1)',[id(1)])).rows.length,3);
 });

 await t.test('migration marks existing history seen but leaves future results unread',async()=>{
  await db.exec('drop function public.polycup_ranked_claim_result(uuid,uuid);drop function public.polycup_ranked_seen_result(uuid);drop table public.polycup_ranked_result_receipts;');
  await db.exec(await readFile('supabase/migrations/20261023000000_ranked_result_notifications.sql','utf8'));
  assert.equal(await claim(1),null);assert.equal(await claim(2,id(802)),null);
  const fresh=await create(500);await submit(1,fresh.transcript);await submit(2,fresh.transcript);await settleLocalRanked(db,fresh.match.id);assert.equal(await claim(1),fresh.match.id);
 });
 }finally{await db.close();}
});
