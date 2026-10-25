// Run only against the disposable Supabase Postgres + Edge Runtime QA containers.
import assert from 'node:assert/strict';
import { readFile,readdir,writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHmac,randomUUID } from 'node:crypto';
import pg from '../node_modules/pg/lib/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pool=new pg.Pool({connectionString:'postgresql://postgres@127.0.0.1:55439/polycup_worker_test',allowExitOnIdle:true,connectionTimeoutMillis:5000});
const config=await readFile('output/edge-runtime-qa/qa.env','utf8');
const token=config.split('\n').find(s=>s.startsWith('POLYCUP_RESULT_CRON_TOKEN=')).split('=')[1];
const endpoint='http://127.0.0.1:8831/polycup-results';
const waitFor=async(fn,label)=>{for(let n=0;n<150;n++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw Error('Timed out: '+label);};
const signed=()=>{const stamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID();return {'x-polycup-time':stamp,'x-polycup-nonce':nonce,'x-polycup-signature':createHmac('sha256',token).update('polycup-results:v1:'+stamp+':'+nonce).digest('hex')};};
const invoke=async(headers=signed())=>{
 const response=await fetch(endpoint,{method:'POST',headers});return {status:response.status,body:await response.json()};
};
test('Supabase Edge user-worker + actual Cron/pg_net/Vault',async t=>{
 const timings={};
 try{
  assert.equal((await pool.query('select current_database() db')).rows[0].db,'polycup_worker_test');
  // These are synthetic accounts in a new local DB, not Supabase hosted auth.
  await pool.query(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
    end$$;
    create schema if not exists auth;
    create table if not exists auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
    create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await pool.query(await readFile('supabase/migrations/'+f,'utf8'));
  await pool.query('create role worker_login login noinherit;grant polycup_result_worker to worker_login;grant connect on database polycup_worker_test to worker_login');
  for(let n=1;n<=4;n++){
   await pool.query('insert into auth.users(id,raw_user_meta_data,is_anonymous) values($1,$2,false)',[id(n),{full_name:'Edge QA '+n}]);
   await pool.query('update public.player_ratings set rating=12500,rated_matches=20 where player_id=$1',[id(n)]);
   await pool.query('insert into public.polycup_rating_state values($1,$2)',[id(n),{model:'btf-6.2.0-t025-softplus-v1',mu:25,sigma:3}]);
  }
  await t.test('hosted safeupdate permits disabled queue polling without weakening safeguards',async()=>{
   const c=new pg.Client({connectionString:'postgresql://supabase_admin@127.0.0.1:55439/polycup_worker_test'});await c.connect();
   try{
    await c.query("load 'safeupdate'");
    await assert.rejects(c.query('delete from public.polycup_ranked_queue'),/requires a WHERE clause/);
    await c.query('begin');await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id(1)]);
    const r=await c.query("select public.polycup_queue('poll',$1,'0.4.0-dev.1') q",[id(101)]);
    assert.equal(r.rows[0].q.state,'idle');assert.equal(r.rows[0].q.enabled,false);
    await c.query('rollback');
   }finally{await c.end();}
  });
  const make=async(n,{ready=true,rounds=15,players=2}={})=>{
   const tracks=Array.from({length:players*4},(_,i)=>({id:String(i+1).padStart(64,'0'),category:'official',digest:'a'.repeat(64)}));
   const draft={bans:tracks.slice(0,players*2).map((x,i)=>({player_id:id(i%players+1),track_id:x.id})),picks:tracks.slice(players*2).map((x,i)=>({player_id:id(Math.floor(i/2)+1),track_id:x.id}))};
   await pool.query(`insert into public.polycup_ranked_matches(id,host_id,status,roster,rules,track_pool,draft,session,started_at,model_version,deadline)
     values($1,$2,'racing',$3,public.polycup_ranked_rules(),$4,$5,$6,now()-interval '2 minutes','btf-6.2.0-t025-softplus-v1',now()+interval '6 hours')`,
     [id(n),id(1),Array.from({length:players},(_,i)=>id(i+1)),JSON.stringify(tracks),draft,{launch:{id:id(n+1),stage:'racing'}}]);
   for(let p=1;p<=players;p++)await pool.query('insert into public.polycup_ranked_members(match_id,player_id,instance_id,accepted,seen_at,play_seen_at) values($1,$2,$3,true,now(),now())',[id(n),id(p),id(100+p)]);
   const order=tracks.slice(players*2).map(x=>x.id);
   const transcript={schema:1,match:id(n),launch:id(n+1),order,rounds:Array.from({length:rounds},(_,i)=>({round:i+1,track:order[Math.floor(i/3)%order.length],
     finishes:Array.from({length:players},(_,p)=>({player:id(p+1),frames:i<rounds-15?null:1000+p*500}))}))};
   if(ready)for(let p=1;p<=players;p++)await submit(p,transcript);
   return transcript;
  };
  const submit=async(p,v)=>{const c=new pg.Client({connectionString:'postgresql://supabase_admin@127.0.0.1:55439/polycup_worker_test'});await c.connect();try{
    // PostgREST sessions enable safeupdate on the hosted project.
    await c.query("load 'safeupdate'");
    await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id(p)]);
    await c.query('select public.polycup_ranked_submit($1,$2,$3)',[v.match,id(100+p),JSON.stringify(v)]);await c.query('commit');
   }catch(e){await c.query('rollback');throw e;}finally{await c.end();}};
  const events=async(n)=>(await pool.query('select * from public.polycup_rating_events where match_id=$1 order by player_id',[id(n)])).rows;
  await t.test('actual Edge runtime denies anonymous/public credentials and accepts only internal token',async()=>{
   for(const headers of [{},{apikey:'public'},{Authorization:'Bearer user'}])assert.equal((await invoke(headers)).status,401);
   const response=await invoke();assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.completed,0);
  });
  await t.test('normal and 1,000-round transcripts settle inside enforced Free-plan resource limits',async()=>{
   for(const [n,rounds] of [[500,15],[510,1000]]){
    await make(n,{rounds});const start=performance.now();const r=await invoke();timings[rounds]=Math.round(performance.now()-start);
    assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.completed,1,JSON.stringify(r));assert.equal((await events(n)).length,2);
    await invoke();assert.equal((await events(n)).length,2);
   }
  });
  await t.test('failed job completion rolls back rating writes, backs off, then settles once',async()=>{
   await make(520);
   await pool.query(`create function public.qa_fail_job() returns trigger language plpgsql as $$begin
    if new.match_id='${id(520)}' and new.finished_at is not null then raise exception 'QA' using errcode='40001';end if;return new;end$$;
    create trigger qa_fail after update on public.polycup_ranked_result_jobs for each row execute function public.qa_fail_job()`);
   const before=(await pool.query('select * from public.player_ratings order by player_id')).rows;
   const r=await invoke();assert.equal(r.status,200);assert.equal(r.body.retry,1);assert.equal((await events(520)).length,0);
   assert.deepEqual((await pool.query('select * from public.player_ratings order by player_id')).rows,before);
   await pool.query('drop trigger qa_fail on public.polycup_ranked_result_jobs');
   assert.equal((await invoke()).body.completed,0);
   await pool.query('update public.polycup_ranked_result_jobs set next_attempt_at=now() where match_id=$1',[id(520)]);
   assert.equal((await invoke()).body.completed,1);await invoke();assert.equal((await events(520)).length,2);
  });
  await t.test('host abandonment applies one loss and leaves innocent guest unchanged',async()=>{
   await make(530,{ready:false});
   await pool.query("update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds',play_seen_at=now()-interval '3 minutes',seen_at=now()-interval '3 minutes' where match_id=$1 and player_id=$2",[id(530),id(1)]);
   const guest=(await pool.query('select * from public.player_ratings where player_id=$1',[id(2)])).rows[0];
   const r=await invoke();assert.equal(r.status,200);assert.equal(r.body.completed,1);
   const e=await events(530);assert.equal(e.length,1);assert.equal(e[0].player_id,id(1));assert.ok(e[0].rating_after<e[0].rating_before);
   await invoke();assert.equal((await events(530)).length,1);assert.deepEqual((await pool.query('select * from public.player_ratings where player_id=$1',[id(2)])).rows[0],guest);
  });
  await t.test('nonhost loss settles with surviving evidence; overlapping Edge calls do not award twice',async()=>{
   const v=await make(535,{ready:false});
   await pool.query("update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds',play_seen_at=now()-interval '3 minutes',seen_at=now()-interval '3 minutes' where match_id=$1 and player_id=$2",[id(535),id(2)]);
   await invoke();await submit(1,v);
   const replies=await Promise.all([invoke(),invoke(),invoke()]);assert.ok(replies.every(r=>r.status===200));
   const e=await events(535);assert.equal(e.length,2);assert.ok(e[1].rating_after<e[1].rating_before);
  });
  await t.test('four ordinary Cups share one invocation; maximum transcripts run alone within the CPU limit',async()=>{
   for(const n of [600,610,620,630,640])await make(n);
   await pool.query('insert into public.polycup_ranked_result_jobs(match_id) select id from public.polycup_ranked_matches where id=any($1) on conflict do nothing',[[600,610,620,630,640].map(id)]);
   const start=performance.now();const r=await invoke();timings.fourOrdinaryCupsMs=Math.round(performance.now()-start);
   assert.equal(r.status,200);assert.equal(r.body.completed,4);assert.equal(r.body.backlog,1);
   const again=await invoke();assert.equal(again.status,200);assert.equal(again.body.completed,1);
   for(const n of [600,610,620,630,640])assert.equal((await events(n)).length,2);
   for(const n of [650,660,670,680])await make(n,{rounds:1000});
   const largeStart=performance.now();
   for(let i=0;i<4;i++){const reply=await invoke();assert.equal(reply.status,200);assert.equal(reply.body.completed,1);assert.equal(reply.body.backlog,3-i);}
   timings.fourMaximumCupsSeparateMs=Math.round(performance.now()-largeStart);
   for(const n of [650,660,670,680])assert.equal((await events(n)).length,2);
   // Four-player evidence reaches the 250 KB transport cap before 1,000 rounds.
   await make(690,{rounds:600,players:4});const maximum=await invoke();assert.equal(maximum.status,200);assert.equal(maximum.body.completed,1);assert.equal((await events(690)).length,4);
  });
  await t.test('actual extensions install idempotently and disabled/idle Cron makes no HTTP request',async()=>{
   await pool.query(await readFile('supabase/worker/install-edge-cron.sql','utf8'));
   await pool.query(await readFile('supabase/worker/install-edge-cron.sql','utf8'));
   assert.equal((await pool.query("select * from cron.job where jobname like 'polycup-result-%'")).rows.length,2);
   for(const role of ['anon','authenticated','polycup_result_worker']){
    const access=(await pool.query("select has_table_privilege($1,'vault.decrypted_secrets','select') vault_read",[role])).rows[0];
    assert.equal(access.vault_read,false);
   }
   assert.equal((await pool.query('select public.polycup_ranked_dispatch_tick() result')).rows[0].result,'disabled');
   // Test-only endpoint override: business logic is unchanged. The deployed
   // constraint only permits HTTPS project URLs, not this loopback fixture.
   await pool.query('alter table public.polycup_ranked_dispatch drop constraint polycup_ranked_dispatch_function_url_check');
   await pool.query('select vault.create_secret($1,$2)',[token,'polycup_result_cron_token']);
   await pool.query('update public.polycup_ranked_dispatch set enabled=true,function_url=$1',[endpoint.replace('8831','9000')]);
   await pool.query("select cron.schedule('polycup-result-dispatch','1 second',(select command from cron.job where jobname='polycup-result-dispatch'))");
   await waitFor(async()=>(await pool.query('select last_outcome from public.polycup_ranked_dispatch')).rows[0].last_outcome==='idle','real Cron idle tick');
   assert.equal((await pool.query('select count(*)::int n from net._http_response')).rows[0].n,0);
  });
  await t.test('Cron discovers new results, pg_net invokes Edge using Vault, and idle invocation count stops growing',async()=>{
   await pool.query('alter table public.polycup_ranked_transcripts disable trigger polycup_ranked_wake_result');
   try{await make(540);}finally{await pool.query('alter table public.polycup_ranked_transcripts enable trigger polycup_ranked_wake_result');}
   await waitFor(async()=>(await events(540)).length===2,'Cron -> HTTP -> Edge -> settlement');
   await waitFor(async()=>(await pool.query('select last_outcome from public.polycup_ranked_dispatch')).rows[0].last_outcome==='idle','scheduler acknowledgement');
   const state=(await pool.query('select * from public.polycup_ranked_dispatch')).rows[0];assert.equal(state.last_http_status,200);assert.ok(state.last_success_at);
   const before=(await pool.query('select count(*)::int n from net._http_response')).rows[0].n;
   for(let i=0;i<4;i++)await pool.query('select public.polycup_ranked_dispatch_tick()');
   assert.equal((await pool.query('select count(*)::int n from net._http_response')).rows[0].n,before);
   assert.ok(!JSON.stringify((await pool.query('select command from cron.job')).rows).includes(token));
  });
  await t.test('real HTTP authorization failure backs off and recovers after Vault token correction',async()=>{
   await pool.query("select vault.update_secret(id,$1) from vault.secrets where name='polycup_result_cron_token'",['c'.repeat(64)]);
   await make(550);
   await waitFor(async()=>(await pool.query('select last_http_status from public.polycup_ranked_dispatch')).rows[0].last_http_status===401,'recorded unauthorized response');
   const failed=(await pool.query('select * from public.polycup_ranked_dispatch')).rows[0];assert.ok(failed.failures>=1);assert.ok(new Date(failed.next_dispatch_at)>new Date());
   assert.equal((await events(550)).length,0);
   await pool.query("select vault.update_secret(id,$1) from vault.secrets where name='polycup_result_cron_token'",[token]);
   await pool.query('update public.polycup_ranked_dispatch set next_dispatch_at=now()');
   await waitFor(async()=>(await events(550)).length===2,'settlement after auth recovery');
   await invoke();assert.equal((await events(550)).length,2);
  });
  await t.test('complete evidence wakes Edge immediately and drains simultaneous Cups with Cron paused',async()=>{
   await pool.query("select cron.alter_job(jobid,active:=false) from cron.job where jobname='polycup-result-dispatch'");
   await waitFor(async()=>(await pool.query('select last_request_id from public.polycup_ranked_dispatch')).rows[0].last_request_id===null,'prior invocation acknowledged');
   const a=await make(560,{ready:false}),b=await make(570,{ready:false});
   const count=async()=>(await pool.query('select count(*)::int n from net._http_response')).rows[0].n;
   const before=await count();await submit(1,a);assert.equal(await count(),before,'Incomplete evidence must not wake Edge');
   const start=performance.now();await submit(2,a);await submit(1,b);await submit(2,b);
   await waitFor(async()=>(await events(560)).length===2&&(await events(570)).length===2,'immediate dispatch and continuation');
   timings.parallelImmediateMs=Math.round(performance.now()-start);assert.ok(timings.parallelImmediateMs<10000);
   await waitFor(async()=>(await pool.query('select last_request_id from public.polycup_ranked_dispatch')).rows[0].last_request_id===null,'continuation drains to idle');
   assert.equal((await pool.query('select public.polycup_ranked_dispatch_complete($1) result',[id(999)])).rows[0].result,'stale');
   for(const role of ['anon','authenticated','service_role'])assert.equal((await pool.query("select has_function_privilege($1,'public.polycup_ranked_dispatch_complete(uuid)','execute') allowed",[role])).rows[0].allowed,false);
   const v=await make(580,{ready:false});await submit(1,v);const countBefore=await count();
   const c=await pool.connect();try{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id(2)]);await c.query('select public.polycup_ranked_submit($1,$2,$3)',[v.match,id(102),JSON.stringify(v)]);await c.query('rollback');}finally{c.release();}
   await new Promise(r=>setTimeout(r,400));assert.equal(await count(),countBefore,'Rolled-back evidence cannot dispatch');assert.equal((await events(580)).length,0);
  });
  await t.test('participant status polling recovers a wake lost to queue contention without Cron',async()=>{
   const v=await make(590,{ready:false});await submit(1,v);
   const lock=await pool.connect();try{
    await lock.query('begin');await lock.query('select pg_advisory_xact_lock(777,1)');
    await submit(2,v);assert.equal((await events(590)).length,0);
   }finally{await lock.query('rollback');lock.release();}
   const status=async(player)=>{const c=new pg.Client({connectionString:'postgresql://supabase_admin@127.0.0.1:55439/polycup_worker_test'});await c.connect();try{
    await c.query("load 'safeupdate'");await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id(player)]);
    await c.query('select public.polycup_ranked_result_status($1)',[id(590)]);await c.query('commit');
   }catch(e){await c.query('rollback');throw e;}finally{await c.end();}};
   await assert.rejects(status(4),/Match member required/);
   const start=performance.now();await Promise.all([status(1),status(2)]);
   await waitFor(async()=>(await events(590)).length===2,'participant retry wakes settlement');timings.contendedWakeRecoveryMs=Math.round(performance.now()-start);assert.ok(timings.contendedWakeRecoveryMs<10000);
   await Promise.all([status(1),status(2)]);await invoke();assert.equal((await events(590)).length,2);
  });
  await writeFile('output/edge-runtime-verification.json',JSON.stringify({passed:true,edgeRuntime:'v1.77.4',postgres:'17.6.1.136',cpuHardLimitMs:2000,memoryLimitMb:256,wallLimitMs:150000,requestWallMs:timings,actualCron:true,actualPgNet:true,actualVault:true,scope:'Local Supabase containers; TLS/project gateway and hosted deployment not tested.'},null,2));
 }finally{
  await pool.query('update public.polycup_ranked_dispatch set enabled=false').catch(()=>{});
  await pool.query("select cron.unschedule(jobid) from cron.job where jobname like 'polycup-result-%'").catch(()=>{});
  await pool.end();
 }
});
