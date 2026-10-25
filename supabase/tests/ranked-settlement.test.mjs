import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {settleLocalRanked,validateRankedTranscript} from '../ranked-validator.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('ranked transcript validation and exactly-once settlement',async t=>{
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
  const original=await create(200);
  await t.test('recompute 140-point finalist scoring, reject incomplete/extra rounds and changed tracks',()=>{
   const result=validateRankedTranscript(original.match,original.transcript);
   assert.deepEqual(result.standings,[{player_id:id(1),place:1,points:140},{player_id:id(2),place:2,points:120}]);
   const altered=structuredClone(original.transcript);altered.rounds.pop();assert.throws(()=>validateRankedTranscript(original.match,altered),/No finalist/);
   altered.rounds.push(...original.transcript.rounds.slice(-1));altered.rounds[0].track=pool[0].id;assert.throws(()=>validateRankedTranscript(original.match,altered),/rotation/);
   altered.rounds[0].track=original.transcript.rounds[0].track;altered.rounds.push({...altered.rounds[14],round:16});assert.throws(()=>validateRankedTranscript(original.match,altered),/Round order/);
   assert.throws(()=>validateRankedTranscript({...original.match,started_at:new Date().toISOString()},original.transcript),/elapsed/);
  });
  await t.test('nonmembers, stale instances and direct client rating writes are rejected',async()=>{
   await assert.rejects(submit(3,original.transcript),/Rejoin/);
   await assert.rejects(submit(1,original.transcript,id(999)),/Rejoin/);
   await assert.rejects(as(1,'select public.polycup_ranked_rate($1)',[original.match.id]),/permission denied/);
   await assert.rejects(as(1,'select public.polycup_ranked_report($1,$2,$3)',[original.match.id,id(101),{}]),/permission denied/);
   await assert.rejects(as(1,'select * from public.polycup_ranked_transcripts'),/permission denied/);
   await assert.rejects(db.query('select public.polycup_ranked_rate($1)',[original.match.id]),/validation required/);
  });
  await t.test('missing peer evidence never awards points; retries cannot replace evidence',async()=>{
   await submit(1,original.transcript);await submit(1,original.transcript);
   assert.equal(await settleLocalRanked(db,original.match.id),'pending');
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,0);
   const changed=structuredClone(original.transcript);changed.rounds[0].finishes[0].frames=999;
   await assert.rejects(submit(1,changed),/cannot be replaced/);
  });
  await t.test('host disconnect after durable receipt does not destroy the result; concurrent retries award once',async()=>{
   await submit(2,original.transcript);
   await db.exec("update public.polycup_ranked_members set seen_at=now()-interval '5 minutes'");
   await Promise.all(Array.from({length:8},()=>settleLocalRanked(db,original.match.id)));
   await submit(1,original.transcript);await submit(2,original.transcript);
   // An identical receipt can be acknowledged after a different instance reclaimed the seat.
   await db.query('update public.polycup_ranked_members set instance_id=$1 where match_id=$2 and player_id=$3',[id(999),original.match.id,id(1)]);
   await submit(1,original.transcript);
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,2);
   assert.deepEqual((await db.query('select rated_matches from public.player_ratings where player_id=any($1) order by player_id',[[id(1),id(2)]])).rows.map(r=>r.rated_matches),[1,1]);
   assert.equal((await db.query('select public.polycup_ranked_match($1) r',[original.match.id])).rows[0].r.players.length,2);
  });
  await t.test('conflicting results and forged finalist wins stay unrated',async()=>{
   for(const kind of ['conflict','incomplete']) {
    const x=await create(kind==='conflict'?300:400),a=structuredClone(x.transcript),b=structuredClone(x.transcript);
    if(kind==='conflict')b.rounds[0].finishes[1].frames=1600;else {a.rounds.pop();b.rounds.pop();}
    await submit(1,a);await submit(2,b);assert.equal(await settleLocalRanked(db,x.match.id),'unrated');
   }
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,2);
  });
  await t.test('unobserved host outage stays recoverable; final deadline cannot be revived',async()=>{
   const x=await create(500);await submit(2,x.transcript);
   await db.query("update public.polycup_ranked_members set seen_at=now()-interval '121 seconds' where match_id=$1 and player_id=$2",[x.match.id,id(1)]);
   assert.equal((await as(2,'select public.polycup_ranked_result_status($1) r',[x.match.id])).rows[0].r.status,'racing');
   await db.query("update public.polycup_ranked_matches set deadline=now()-interval '1 second' where id=$1",[x.match.id]);
   const status=(await as(2,'select public.polycup_ranked_result_status($1) r',[x.match.id])).rows[0].r;
   assert.equal(status.status,'unrated');await submit(1,x.transcript);
   assert.equal(await settleLocalRanked(db,x.match.id),'unrated');
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,2);
  });
  await t.test('a racer can flag its own mismatched finish, but cannot undo an already settled result',async()=>{
   const x=await create(600);
   await assert.rejects(as(3,'select public.polycup_ranked_reject_result($1,$2)',[x.match.id,id(103)]),/Rejoin/);
   await as(2,'select public.polycup_ranked_reject_result($1,$2)',[x.match.id,id(102)]);
   assert.equal(await settleLocalRanked(db,x.match.id),'unrated');
   await as(2,'select public.polycup_ranked_reject_result($1,$2)',[original.match.id,id(102)]);
   assert.equal((await db.query('select status from public.polycup_ranked_matches where id=$1',[original.match.id])).rows[0].status,'completed');
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,2);
  });
 } finally {await db.close();}
});
