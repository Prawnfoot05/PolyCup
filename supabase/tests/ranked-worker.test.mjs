import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { PGlite } from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
import { connectWorker } from '../worker/postgres.mjs';
import { discoverResults, processNextResult, runResultBatch } from '../worker/processor.ts';
import pg from '../worker/node_modules/pg/lib/index.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const address = process.env.POLYCUP_WORKER_TEST_DATABASE_URL;
const env = { POLYCUP_RESULT_WORKER_ENABLED: '1', POLYCUP_RESULT_LOCAL_TEST: '1',
  POLYCUP_RESULT_DATABASE_URL: address?.replace('postgres@', 'worker_login@') };

test(`result job: ${address ? 'real PostgreSQL / production adapter' : 'PGlite'}`, async t => {
  let db, worker, pool;
  if (address) {
    const url = new URL(address);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/polycup_worker_test', 'Only the disposable test database is allowed');
    pool = new pg.Pool({ connectionString: address });
    db = { query: (...a) => pool.query(...a), exec: sql => pool.query(sql),
      transaction: async fn => {
        const c = await pool.connect();
        try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
        catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
      }, close: () => pool.end() };
  } else db = await PGlite.create();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for (const f of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort())
      await db.exec(await readFile('supabase/migrations/' + f, 'utf8'));
    if (address) {
      await db.exec('create role worker_login login noinherit; grant polycup_result_worker to worker_login');
      worker = await connectWorker(env);
    } else worker = { transaction: fn => db.transaction(async tx => {
      await tx.query('set local role polycup_result_worker'); return fn(tx);
    }), close: async () => {} };
    for (let n = 1; n <= 4; n++) {
      await db.query('insert into auth.users values($1,$2,false)', [id(n), { full_name: 'QA ' + n }]);
      await db.query('update public.player_ratings set rating=12500,rated_matches=20 where player_id=$1', [id(n)]);
      await db.query('insert into public.polycup_rating_state values($1,$2)', [id(n), { model: 'btf-6.2.0-t025-softplus-v1', mu: 25, sigma: 3 }]);
    }
    const as = (who, sql, args = []) => db.transaction(async tx => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id(who)]);
      return tx.query(sql, args);
    });
    const make = async (n, ready = true) => {
      const rules = (await db.query('select public.polycup_ranked_rules() r')).rows[0].r;
      const tracks = Array.from({ length: 8 }, (_, i) => ({ id: String(i+1).padStart(64, '0'), category: 'official', digest: 'a'.repeat(64) }));
      const draft = { bans: tracks.slice(0,4).map((x,i) => ({ player_id: id(i%2+1), track_id: x.id })),
        picks: tracks.slice(4).map((x,i) => ({ player_id: id(i<2?1:2), track_id: x.id })) };
      await db.query(`insert into public.polycup_ranked_matches(id,host_id,status,roster,rules,track_pool,draft,session,started_at,model_version,deadline)
        values($1,$2,'racing',$3,$4,$5,$6,$7,now()-interval '2 minutes','btf-6.2.0-t025-softplus-v1',now()+interval '6 hours')`,
        [id(n),id(1),[id(1),id(2)],rules,JSON.stringify(tracks),draft,{launch:{id:id(n+1),stage:'racing'}}]);
      for (let p=1;p<=2;p++) await db.query(`insert into public.polycup_ranked_members(match_id,player_id,instance_id,accepted,seen_at,play_seen_at)
        values($1,$2,$3,true,now(),now())`,[id(n),id(p),id(100+p)]);
      const order=tracks.slice(4).map(x=>x.id);
      const transcript={schema:1,match:id(n),launch:id(n+1),order,rounds:Array.from({length:15},(_,i)=>({round:i+1,
        track:order[Math.floor(i/3)%4],finishes:[{player:id(1),frames:1000},{player:id(2),frames:1500}]}))};
      if(ready) for(let p=1;p<=2;p++) await submit(p,transcript);
      return transcript;
    };
    const submit = (p,v) => as(p,'select public.polycup_ranked_submit($1,$2,$3)',[v.match,id(100+p),JSON.stringify(v)]);
    const events = async n => (await db.query('select * from public.polycup_rating_events where match_id=$1 order by player_id',[id(n)])).rows;
    const job = async n => (await db.query('select * from public.polycup_ranked_result_jobs where match_id=$1',[id(n)])).rows[0];
    const due = n => db.query('update public.polycup_ranked_result_jobs set next_attempt_at=now() where match_id=$1',[id(n)]);
    const status = async n => (await db.query('select status from public.polycup_ranked_matches where id=$1',[id(n)])).rows[0].status;
    // Faults are injected only by the test database owner, never by the worker.
    const fault = async (n, table='polycup_rating_events') => {
      await db.exec(`create or replace function public.qa_fail_result() returns trigger language plpgsql as $$begin
        if new.match_id='${id(n)}' then raise exception 'QA injected database failure' using errcode='40001'; end if; return new; end$$;
        create trigger qa_result_failure after insert on public.${table} for each row execute function public.qa_fail_result()`);
      return () => db.exec(`drop trigger qa_result_failure on public.${table}`);
    };

    await t.test('bounded batch and overlapping runs settle each Cup once using only worker privileges', async()=>{
      await make(200); await make(210);
      const first=await runResultBatch(worker,{limit:1}); assert.equal(first.completed,1);
      await Promise.all([runResultBatch(worker),runResultBatch(worker),runResultBatch(worker)]);
      for(const n of [200,210]){assert.equal((await events(n)).length,2);assert.equal((await job(n)).attempts,1);}
      await runResultBatch(worker);assert.equal((await events(200)).length,2);
    });
    await t.test('complete evidence survives a day of downtime; missing peer evidence still expires', async()=>{
      await make(220);const partial=await make(230,false);await submit(1,partial);
      await db.query("update public.polycup_ranked_matches set deadline=now()-interval '1 day' where id=any($1)",[[id(220),id(230)]]);
      await runResultBatch(worker);assert.equal(await status(220),'completed');assert.equal(await status(230),'unrated');
      assert.equal((await events(230)).length,0);
    });
    await t.test('transcript budget stops before the next job, permits one oversized job, and preserves retries',async()=>{
      for(const n of [700,710,720,730])await make(n);
      // Each fixture has 15 rounds x 2 racers = 30 finish observations.
      const first=await runResultBatch(worker,{limit:4,finishBudget:60});assert.equal(first.completed,2);assert.equal(first.backlog,2);
      const second=await runResultBatch(worker,{limit:4,finishBudget:1});assert.equal(second.completed,1);assert.equal(second.backlog,1);
      const clear=await fault(730);const retry=await runResultBatch(worker,{limit:4,finishBudget:2000});assert.equal(retry.retry,1);assert.equal((await events(730)).length,0);
      await clear();await due(730);assert.equal((await runResultBatch(worker,{limit:4,finishBudget:2000})).completed,1);
      for(const n of [700,710,720,730])assert.equal((await events(n)).length,2);
      await assert.rejects(runResultBatch(worker,{finishBudget:0}),/finish budget/);
      for(const n of [740,750,760,770])await make(n);
      const clearMixed=await fault(740);const mixed=await runResultBatch(worker,{limit:4,finishBudget:2000});
      assert.equal(mixed.retry,1);assert.equal(mixed.completed,3);assert.equal((await events(740)).length,0);
      for(const n of [750,760,770])assert.equal((await events(n)).length,2);
      await clearMixed();await due(740);assert.equal((await runResultBatch(worker,{limit:4,finishBudget:2000})).completed,1);
    });
    await t.test('database failure rolls settlement back; durable backoff does not block other Cups', async()=>{
      await make(240);await make(250);
      const before=(await db.query('select * from public.player_ratings order by player_id')).rows;
      const clear=await fault(240,'polycup_ranked_validations');
      // Failure here is before ratings on normal completion; the job update fault
      // below separately proves rollback after every rating has been written.
      const failed=await runResultBatch(worker,{limit:1});assert.equal(failed.retry,1);
      assert.deepEqual((await db.query('select * from public.player_ratings order by player_id')).rows,before);
      assert.equal((await job(240)).attempts,1);assert.equal((await job(240)).last_error_code,'40001');
      assert.ok(new Date((await job(240)).next_attempt_at)>new Date());assert.equal((await events(240)).length,0);
      await clear();await runResultBatch(worker);assert.equal((await job(240)).attempts,1);assert.equal(await status(250),'completed');
      await due(240);await runResultBatch(worker);assert.equal((await events(240)).length,2);assert.equal((await job(240)).attempts,2);
    });
    await t.test('failure writing job completion rolls back already-written ratings and retry commits once',async()=>{
      await make(260);
      await db.exec(`create function public.qa_fail_receipt() returns trigger language plpgsql as $$begin
        if new.match_id='${id(260)}' and new.finished_at is not null then raise exception 'QA' using errcode='40001'; end if; return new; end$$;
        create trigger qa_job_failure after update on public.polycup_ranked_result_jobs for each row execute function public.qa_fail_receipt()`);
      const before=(await db.query('select * from public.player_ratings order by player_id')).rows;
      assert.equal((await runResultBatch(worker)).retry,1);assert.equal((await events(260)).length,0);
      assert.deepEqual((await db.query('select * from public.player_ratings order by player_id')).rows,before);
      assert.equal(await status(260),'review');
      await db.exec('drop trigger qa_job_failure on public.polycup_ranked_result_jobs');
      await due(260);assert.equal((await runResultBatch(worker)).completed,1);
      assert.equal((await events(260)).length,2);
    });
    await t.test('unknown COMMIT response can be retried without duplicate awards',async()=>{
      await make(270);await discoverResults(worker);
      const uncertain={transaction: async fn=>{await worker.transaction(fn);throw Object.assign(new Error('simulated lost COMMIT reply'),{code:'08006'});}};
      await assert.rejects(processNextResult(uncertain));
      await runResultBatch(worker);assert.equal((await events(270)).length,2);assert.equal((await job(270)).attempts,1);
    });
    await t.test('host abandonment is discovered without client polling, retried and penalized once; guest unchanged',async()=>{
      await make(280,false);
      await db.query(`update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds',
        seen_at=now()-interval '3 minutes',play_seen_at=now()-interval '3 minutes' where match_id=$1 and player_id=$2`,[id(280),id(1)]);
      const before=(await db.query('select * from public.player_ratings where player_id=$1',[id(2)])).rows[0];
      const clear=await fault(280,'polycup_ranked_validations');
      assert.equal((await runResultBatch(worker)).retry,1);assert.equal((await events(280)).length,0);
      await clear();await due(280);await runResultBatch(worker);await runResultBatch(worker);
      const loss=await events(280);assert.equal(loss.length,1);assert.equal(loss[0].player_id,id(1));assert.ok(loss[0].rating_after<loss[0].rating_before);
      assert.deepEqual((await db.query('select * from public.player_ratings where player_id=$1',[id(2)])).rows[0],before);
      assert.equal((await as(1,'select public.polycup_ranked_claim_result($1,$2) r',[id(999),id(280)])).rows[0].r,id(280));
    });
    await t.test('nonhost abandonment settles with surviving evidence and cannot receive a win',async()=>{
      const v=await make(290,false);
      await db.query(`update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds',
        seen_at=now()-interval '3 minutes',play_seen_at=now()-interval '3 minutes' where match_id=$1 and player_id=$2`,[id(290),id(2)]);
      await runResultBatch(worker);assert.equal((await events(290)).length,0);await submit(1,v);
      await runResultBatch(worker);const result=await events(290);assert.equal(result.length,2);
      assert.ok(result[1].rating_after<result[1].rating_before);
    });
    await t.test('host loss with inconsistent rating state is preserved for repair rather than calculated incorrectly',async()=>{
      await make(380,false);
      await db.query(`update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds',
        seen_at=now()-interval '3 minutes',play_seen_at=now()-interval '3 minutes' where match_id=$1 and player_id=$2`,[id(380),id(1)]);
      const prior=(await db.query('select rating from public.player_ratings where player_id=$1',[id(1)])).rows[0].rating;
      await db.query('update public.player_ratings set rating=rating+100 where player_id=$1',[id(1)]);
      assert.equal((await runResultBatch(worker)).retry,1);assert.equal((await events(380)).length,0);
      await db.query('update public.player_ratings set rating=$2 where player_id=$1',[id(1),prior]);
      await due(380);assert.equal((await runResultBatch(worker)).completed,1);assert.equal((await events(380)).length,1);
    });
    await t.test('shared outage and reconnect within grace never create abandonment losses',async()=>{
      await make(300,false);await make(310,false);
      await db.query("update public.polycup_ranked_members set seen_at=now()-interval '5 minutes',play_seen_at=now()-interval '5 minutes' where match_id=$1",[id(300)]);
      await db.query("update public.polycup_ranked_members set disconnected_since=now()-interval '119 seconds' where match_id=$1 and player_id=$2",[id(310),id(2)]);
      await as(2,'select public.polycup_ranked_session($1,$2,$3)',[id(310),id(102),'rejoin']);
      await runResultBatch(worker);assert.equal((await events(300)).length,0);assert.equal((await events(310)).length,0);
      assert.equal((await db.query('select * from public.polycup_ranked_members where match_id=any($1) and abandoned_at is not null',[[id(300),id(310)]])).rows.length,0);
    });
    await t.test('conflicting evidence resolves unrated rather than retrying forever',async()=>{
      const v=await make(320,false);await submit(1,v);v.rounds[0].finishes[1].frames=1600;await submit(2,v);
      assert.equal((await runResultBatch(worker)).unrated,1);assert.equal(await status(320),'unrated');assert.equal((await events(320)).length,0);
      assert.ok((await job(320)).finished_at);
    });
    await t.test('persistent errors back off to fifteen minutes, flag attention, and remain recoverable after restart',async()=>{
      await make(360);const clear=await fault(360);
      for(let n=1;n<=7;n++){
        await due(360);const result=await runResultBatch(worker);assert.equal(result.retry,1);
        const row=await job(360);assert.equal(row.attempts,n);
        const delay=(await db.query('select extract(epoch from next_attempt_at-now())::float seconds from public.polycup_ranked_result_jobs where match_id=$1',[id(360)])).rows[0].seconds;
        const expected=Math.min(900,15*2**(n-1));assert.ok(delay>expected-3 && delay<=expected);
        if(n>=5)assert.equal(result.attention,1);
      }
      assert.equal((await events(360)).length,0);await clear();await due(360);
      if(address){await worker.close();worker=await connectWorker(env);}
      assert.equal((await runResultBatch(worker)).completed,1);assert.equal((await events(360)).length,2);
    });
    await t.test('clients cannot access worker jobs or role; worker cannot access auth records',async()=>{
      await assert.rejects(as(1,'select * from public.polycup_ranked_result_jobs'),/permission denied/);
      assert.equal((await db.query("select pg_has_role('authenticated','polycup_result_worker','MEMBER') allowed")).rows[0].allowed,false);
      if(address) await assert.rejects(worker.transaction(tx=>tx.query('set local role postgres')),/permission denied/);
      await assert.rejects(worker.transaction(tx=>tx.query('select * from auth.users')),/permission denied/);
      await assert.rejects(worker.transaction(tx=>tx.query('update public.polycup_ranked_config set enabled=true')),/permission denied/);
    });
    await t.test('real concurrent row claims skip a locked job and recover when its connection dies',{skip:!address},async()=>{
      await make(330);await make(340);await discoverResults(worker);
      const c=await pool.connect();
      try {
        await c.query('begin');await c.query('select * from public.polycup_ranked_result_jobs where match_id=$1 for update',[id(330)]);
        assert.equal(await processNextResult(worker),'completed');assert.equal(await status(340),'completed');assert.equal(await status(330),'review');
        await c.query('select pg_terminate_backend(pg_backend_pid())').catch(()=>{});
      } finally {c.release(true);}
      assert.equal(await processNextResult(worker),'completed');assert.equal((await events(330)).length,2);
    });
    await t.test('built executable runs against real PostgreSQL and exits cleanly',{skip:!address},async()=>{
      await make(350);
      const result=await new Promise(resolve=>{
        const child=spawn(process.execPath,['supabase/worker/dist/main.mjs'],{env:{...process.env,...env},windowsHide:true});
        let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
        child.on('exit',code=>resolve({code,output}));
      });
      assert.equal(result.code,0,result.output);assert.match(result.output,/"completed":1/);assert.equal((await events(350)).length,2);
      assert.ok(!result.output.includes(address));
    });
    await t.test('connection death inside settlement rolls back partial writes, then a fresh executable recovers',{skip:!address},async()=>{
      await make(370);
      await db.exec(`create function public.qa_pause_result() returns trigger language plpgsql as $$begin
        if new.match_id='${id(370)}' then perform pg_sleep(30); end if; return new; end$$;
        create trigger qa_pause after insert on public.polycup_rating_events for each row execute function public.qa_pause_result()`);
      const before=(await db.query('select * from public.player_ratings order by player_id')).rows;
      const run=()=>new Promise(resolve=>{
        const child=spawn(process.execPath,['supabase/worker/dist/main.mjs'],{env:{...process.env,...env},windowsHide:true});
        let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('exit',code=>resolve({code,output}));
      });
      const interrupted=run();let pid;
      for(let n=0;n<100;n++){
        pid=(await db.query("select pid from pg_stat_activity where application_name='polycup-result-worker' and wait_event='PgSleep'")).rows[0]?.pid;
        if(pid)break;await new Promise(r=>setTimeout(r,50));
      }
      assert.ok(pid,'Executable reached the injected pause after a rating insert');
      await db.query('select pg_terminate_backend($1)',[pid]);assert.equal((await interrupted).code,1);
      assert.equal((await events(370)).length,0);assert.equal((await job(370)).finished_at,null);
      assert.deepEqual((await db.query('select * from public.player_ratings order by player_id')).rows,before);
      await db.exec('drop trigger qa_pause on public.polycup_rating_events');
      const recovered=await run();assert.equal(recovered.code,0,recovered.output);assert.equal((await events(370)).length,2);
      await run();assert.equal((await events(370)).length,2);
    });
  } finally {await worker?.close();await db.close();}
});
