import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {settleLocalRanked,validateRankedTranscript} from '../ranked-validator.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('ranked abandonment grace and losses',async t=>{
 const db=await PGlite.create();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  // pg_cron/pg_net scheduling has separate real-Postgres/Edge tests.
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&!/^202610230[2346]0000_/.test(f)).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
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
  const expire=()=>db.query('select public.polycup_ranked_expire()');
  const stale=async(match,who,seconds)=>db.query("update public.polycup_ranked_members set disconnected_since=now()-make_interval(secs=>$3::int),play_seen_at=now()-interval '3 minutes',seen_at=now()-interval '3 minutes' where match_id=$1 and player_id=$2",[match,id(who),seconds]);
  const member=async(match,who)=>(await db.query('select * from public.polycup_ranked_members where match_id=$1 and player_id=$2',[match,id(who)])).rows[0];
  await t.test('120-second boundary and rejoin before expiry clear the grace',async()=>{
   const x=await create(700);await stale(x.match.id,2,119);await expire();assert.equal((await member(x.match.id,2)).abandoned_at,null);
   await as(2,'select public.polycup_ranked_session($1,$2,$3)',[x.match.id,id(102),'rejoin']);
   assert.equal((await member(x.match.id,2)).disconnected_since,null);
   await stale(x.match.id,2,121);await expire();assert.ok((await member(x.match.id,2)).abandoned_at);
   const late=(await as(2,'select public.polycup_ranked_session($1,$2,$3) r',[x.match.id,id(102),'rejoin'])).rows[0].r;assert.equal(late,null);
   await submit(1,x.transcript);assert.equal(await settleLocalRanked(db,x.match.id),'completed');
   const events=(await db.query('select * from public.polycup_rating_events where match_id=$1',[x.match.id])).rows;
   assert.equal(events.length,2);assert.ok(events.find(e=>e.player_id===id(2)).state_after.mu<25);
   await Promise.all(Array.from({length:5},()=>settleLocalRanked(db,x.match.id)));assert.equal((await db.query('select * from public.polycup_rating_events where match_id=$1',[x.match.id])).rows.length,2);
  });
  await t.test('explicit abandonment is owner-only, instance-fenced, immediate and settles once',async()=>{
   const x=await create(760),abandon=(who,instance=id(100+who))=>as(who,'select public.polycup_ranked_abandon($1,$2)',[x.match.id,instance]);
   await assert.rejects(abandon(3),/original window/);await assert.rejects(abandon(2,id(999)),/original window/);
   assert.equal((await member(x.match.id,2)).abandoned_at,null);
   await abandon(2);const stamp=(await member(x.match.id,2)).abandoned_at;assert.ok(stamp);
   await abandon(2);assert.deepEqual((await member(x.match.id,2)).abandoned_at,stamp);
   assert.equal((await as(2,'select public.polycup_ranked_session($1,$2,$3) r',[x.match.id,id(102),'rejoin'])).rows[0].r,null);
   await submit(1,x.transcript);assert.equal(await settleLocalRanked(db,x.match.id),'completed');
   const events=(await db.query('select * from public.polycup_rating_events where match_id=$1',[x.match.id])).rows;
   assert.equal(events.length,2);await abandon(2);assert.equal(await settleLocalRanked(db,x.match.id),'completed');
   assert.deepEqual((await db.query('select * from public.polycup_rating_events where match_id=$1',[x.match.id])).rows,events);
   assert.ok(events.find(e=>e.player_id===id(2)).rating_after<events.find(e=>e.player_id===id(2)).rating_before);
  });
  await t.test('a submitted result cannot become an explicit abandonment',async()=>{
   const x=await create(780);await submit(2,x.transcript);
   await assert.rejects(as(2,'select public.polycup_ranked_abandon($1,$2)',[x.match.id,id(102)]),/already submitted/);
   assert.equal((await member(x.match.id,2)).abandoned_at,null);
   await submit(1,x.transcript);assert.equal(await settleLocalRanked(db,x.match.id),'completed');
  });
  await t.test('voluntary leave starts grace; queue polls cannot reset it',async()=>{
   const x=await create(800);await db.query('insert into public.polycup_ranked_claims(player_id,match_id) values($1,$2)',[id(2),x.match.id]);
   await as(2,'select public.polycup_ranked_session($1,$2,$3)',[x.match.id,id(102),'leave']);
   const start=(await member(x.match.id,2)).disconnected_since;
   await as(2,'select public.polycup_queue($1,$2,$3)',['poll',id(102),'0.4.0-dev.1']);
   assert.deepEqual((await member(x.match.id,2)).disconnected_since,start);
   await as(2,'select public.polycup_ranked_session($1,$2,$3)',[x.match.id,id(102),'rejoin']);assert.equal((await member(x.match.id,2)).left_at,null);
   await db.query('delete from public.polycup_ranked_claims where match_id=$1',[x.match.id]);
  });
  await t.test('shared outage is not backdated into mass abandonment',async()=>{
   const x=await create(900);await db.query("update public.polycup_ranked_members set seen_at=now()-interval '5 minutes' where match_id=$1",[x.match.id]);
   await expire();assert.equal((await member(x.match.id,1)).disconnected_since,null);assert.equal((await member(x.match.id,2)).abandoned_at,null);
   await as(2,'select public.polycup_ranked_session($1,$2,$3)',[x.match.id,id(102),'rejoin']);await expire();
   const host=await member(x.match.id,1);assert.ok(host.disconnected_since);assert.equal(host.abandoned_at,null);
  });
  await t.test('host forfeit penalizes only host, preserves guest rating and appears as a loss',async()=>{
   const x=await create(1000);const before=(await db.query('select * from public.player_ratings where player_id=$1',[id(2)])).rows[0];
   await stale(x.match.id,1,121);await expire();assert.equal(await settleLocalRanked(db,x.match.id),'completed');
   const events=(await db.query('select * from public.polycup_rating_events where match_id=$1',[x.match.id])).rows;assert.equal(events.length,1);assert.equal(events[0].player_id,id(1));assert.ok(events[0].rating_after<events[0].rating_before);
   assert.deepEqual((await db.query('select * from public.player_ratings where player_id=$1',[id(2)])).rows[0],before);
   await Promise.all(Array.from({length:5},()=>settleLocalRanked(db,x.match.id)));assert.equal((await db.query('select * from public.polycup_rating_events where match_id=$1',[x.match.id])).rows.length,1);
   const history=(await db.query('select * from public.polycup_ranked_history($1)',[id(1)])).rows.find(r=>r.match_id===x.match.id);assert.equal(history.place,2);assert.equal(history.rounds,0);
  });
  await t.test('native host loss keeps guests present and never forfeits them',async()=>{
   const x=await create(1050);
   await as(2,'select public.polycup_ranked_session($1,$2,$3)',[x.match.id,id(102),'connection-lost']);
   await stale(x.match.id,1,121);
   await db.query("update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds' where match_id=$1 and player_id=$2",[x.match.id,id(2)]);
   await as(2,'select public.polycup_ranked_session($1,$2,$3)',[x.match.id,id(102),'poll']);
   assert.equal((await member(x.match.id,2)).abandoned_at,null);
   assert.equal(await settleLocalRanked(db,x.match.id),'completed');
   const events=(await db.query('select player_id from public.polycup_rating_events where match_id=$1',[x.match.id])).rows;assert.deepEqual(events,[{player_id:id(1)}]);
  });
  await t.test('late native tickets and result vetoes cannot erase confirmed abandonment',async()=>{
   const x=await create(1070);await stale(x.match.id,2,121);await expire();
   const guest=await member(x.match.id,2);
   await assert.rejects(as(1,'select public.polycup_ranked_session($1,$2,$3,$4)',[x.match.id,id(101),'bind',{ticket:guest.ticket,native:3,attempt:x.transcript.launch}]),/unavailable/);
   await assert.rejects(as(2,'select public.polycup_ranked_reject_result($1,$2)',[x.match.id,id(102)]),/Rejoin/);
   await submit(2,x.transcript);assert.equal((await db.query('select * from public.polycup_ranked_transcripts where match_id=$1',[x.match.id])).rows.length,0);
   await submit(1,x.transcript);assert.equal(await settleLocalRanked(db,x.match.id),'completed');
  });
  await t.test('four-player settlement ranks an absent racer last without their final approval',async()=>{
   await db.query('insert into auth.users values($1,$2,false)',[id(4),{full_name:'Player 4'}]);
   const x=await create(1080),roster=[id(1),id(2),id(3),id(4)];
   const large=Array.from({length:16},(_,i)=>({id:String(i+1).padStart(64,'0'),category:'official',digest:'a'.repeat(64)}));
   const draft={bans:large.slice(0,8).map((t,i)=>({player_id:roster[i%4],track_id:t.id})),picks:large.slice(8).map((t,i)=>({player_id:roster[Math.floor(i/2)],track_id:t.id}))};
   await db.query('update public.polycup_ranked_matches set roster=$2,track_pool=$3,draft=$4 where id=$1',[x.match.id,roster,large,draft]);
   for(const n of [3,4])await db.query('insert into public.polycup_ranked_members(match_id,player_id,instance_id,accepted,seen_at) values($1,$2,$3,true,now())',[x.match.id,id(n),id(100+n)]);
   const order=large.slice(8).map(t=>t.id),transcript={...x.transcript,order,rounds:Array.from({length:15},(_,i)=>({round:i+1,track:order[Math.floor(i/3)%8],finishes:roster.map((player,n)=>({player,frames:n===2?null:1000+n*100}))}))};
   await stale(x.match.id,3,121);await expire();for(const n of [1,2,4])await submit(n,transcript);
   assert.equal(await settleLocalRanked(db,x.match.id),'completed');const result=(await db.query('select public.polycup_ranked_match($1) r',[x.match.id])).rows[0].r;
   assert.equal(result.players.find(p=>p.player_id===id(3)).place,4);assert.equal(result.players.find(p=>p.player_id===id(3)).abandoned,true);
   assert.equal((await db.query('select * from public.polycup_rating_events where match_id=$1',[x.match.id])).rows.length,4);
  });
  await t.test('finished durable submissions cannot turn into later forfeits',async()=>{
   const x=await create(1100);await submit(2,x.transcript);await stale(x.match.id,2,121);await expire();assert.equal((await member(x.match.id,2)).abandoned_at,null);
   await submit(1,x.transcript);assert.equal(await settleLocalRanked(db,x.match.id),'completed');
  });
  await t.test('players cannot mark opponents abandoned or invoke internal settlement',async()=>{
   const x=await create(1200);
   await assert.rejects(as(1,"update public.polycup_ranked_members set abandoned_at=now() where match_id=$1",[x.match.id]),/permission denied/);
   await assert.rejects(as(1,'select public.polycup_ranked_rate_internal($1)',[x.match.id]),/permission denied/);
   await assert.rejects(as(1,'select public.polycup_ranked_session_internal($1,$2,$3)',[x.match.id,id(101),'leave']),/permission denied/);
  });
 }finally{await db.close();}
});
