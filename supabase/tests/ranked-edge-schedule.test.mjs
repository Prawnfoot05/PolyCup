import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('conditional Edge dispatch and recovery (SQL, mocked pg_net transport)',async t=>{
 const db=await PGlite.create();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const tick=async()=>(await db.query('select public.polycup_ranked_dispatch_tick() result')).rows[0].result;
  const config=async()=>(await db.query('select * from public.polycup_ranked_dispatch')).rows[0];
  await t.test('migration is inert; idle checks make no request and need no token',async()=>{
   assert.equal(await tick(),'disabled');
   await db.exec('update public.polycup_ranked_dispatch set enabled=true');
   assert.equal(await tick(),'idle');assert.equal((await config()).last_request_id,null);
  });
  for(const n of [1,2])await db.query('insert into auth.users values($1,$2,false)',[id(n),{full_name:'QA '+n}]);
  await db.query(`insert into public.polycup_ranked_matches(id,host_id,status,roster,rules,track_pool,model_version,started_at,deadline)
    values($1,$2,'racing',$3,public.polycup_ranked_rules(),'[]','btf-6.2.0-t025-softplus-v1',now(),now()+interval '1 hour')`,[id(50),id(1),[id(1),id(2)]]);
  for(const n of [1,2])await db.query('insert into public.polycup_ranked_members(match_id,player_id,seen_at,play_seen_at) values($1,$2,now(),now())',[id(50),id(n)]);
  await t.test('a racing Cup with no final evidence does not invoke Edge',async()=>{assert.equal(await tick(),'idle');});
  await t.test('maintenance discovers a confirmed host loss even without a client poll',async()=>{
   await db.query("update public.polycup_ranked_members set disconnected_since=now()-interval '121 seconds',seen_at=now()-interval '3 minutes',play_seen_at=now()-interval '3 minutes' where player_id=$1",[id(1)]);
   assert.equal(await tick(),'not_configured');
   assert.equal((await db.query('select * from public.polycup_ranked_result_jobs')).rows.length,1);
   assert.equal((await db.query('select terminal_reason from public.polycup_ranked_matches')).rows[0].terminal_reason,'abandonment_interrupted');
  });
  // Test doubles for extension-owned tables and HTTP queue. Not production code.
  await db.exec(`create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);
    create schema if not exists extensions;create function extensions.hmac(text,text,text) returns bytea language sql as $$select decode(repeat('ab',32),'hex')$$;
    create schema net;create table net._http_response(id bigint,status_code integer,timed_out boolean default false);
    create table net.requests(id bigserial,url text,headers jsonb,body jsonb,timeout integer);
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$
    declare result bigint;begin insert into net.requests(url,headers,body,timeout) values(url,headers,body,timeout_milliseconds) returning id into result;return result;end$$;`);
  await db.exec("update public.polycup_ranked_dispatch set function_url='https://qa.supabase.co/functions/v1/polycup-results',next_dispatch_at=now()");
  await t.test('missing secret fails closed and retries configuration later',async()=>{assert.equal(await tick(),'missing_token');});
  const token='a'.repeat(64);await db.query('insert into vault.decrypted_secrets values($1,$2)',['polycup_result_cron_token',token]);
  const due=()=>db.exec('update public.polycup_ranked_dispatch set next_dispatch_at=now()');
  await due();
  await t.test('only due work dispatches, secret stays out of job/status payloads, overlap suppressed',async()=>{
   assert.equal(await tick(),'dispatched');const request=(await db.query('select * from net.requests')).rows[0];
   assert.equal(request.headers['x-polycup-signature'],'ab'.repeat(32));assert.match(request.headers['x-polycup-time'],/^\d{10}$/);assert.ok(!JSON.stringify(request).includes(token));assert.deepEqual(request.body,{});assert.equal(request.timeout,45000);
   assert.ok(!JSON.stringify(await config()).includes(token));
   assert.equal(await tick(),'in_flight');assert.equal((await db.query('select * from net.requests')).rows.length,1);
  });
  await t.test('HTTP authorization failure backs off instead of making a request every tick',async()=>{
   await db.query('insert into net._http_response values($1,401,false)',[(await config()).last_request_id]);
   assert.equal(await tick(),'backoff');assert.equal((await config()).failures,1);assert.equal((await config()).last_http_status,401);
   await due();assert.equal(await tick(),'dispatched');
  });
  await t.test('lost response expires its in-flight hold and retries without touching ratings',async()=>{
   await db.exec("update public.polycup_ranked_dispatch set dispatched_at=now()-interval '91 seconds'");
   assert.equal(await tick(),'backoff');assert.equal((await config()).failures,2);
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,0);
   await due();assert.equal(await tick(),'dispatched');
  });
  await t.test('successful call honors per-result retry time and stops when work is done',async()=>{
   await db.query('insert into net._http_response values($1,200,false)',[(await config()).last_request_id]);
   await db.exec("update public.polycup_ranked_result_jobs set next_attempt_at=now()+interval '15 minutes'");
   assert.equal(await tick(),'idle');assert.equal((await config()).failures,0);
   await db.exec('update public.polycup_ranked_result_jobs set next_attempt_at=now()');assert.equal(await tick(),'dispatched');
   await db.query('insert into net._http_response values($1,200,false)',[(await config()).last_request_id]);
   await db.exec("update public.polycup_ranked_result_jobs set finished_at=now(),outcome='completed'");assert.equal(await tick(),'idle');
  });
  await t.test('client and worker roles cannot change the destination, read scheduler state or dispatch',async()=>{
   for(const role of ['anon','authenticated','service_role','polycup_result_worker']){
    const as=sql=>db.transaction(async tx=>{await tx.exec('set local role '+role);return tx.query(sql);});
    await assert.rejects(as('select public.polycup_ranked_dispatch_tick()'),/permission denied/);
    await assert.rejects(as('select * from public.polycup_ranked_dispatch'),/permission denied/);
   }
   await assert.rejects(db.query('update public.polycup_ranked_dispatch set function_url=$1',['http://attacker.invalid/']),/check constraint/);
  });
  await t.test('commit wakes ready results; acknowledgement drains backlog; rollback and stale callbacks cannot dispatch',async()=>{
   const make=async n=>db.query(`insert into public.polycup_ranked_matches(id,host_id,status,roster,rules,track_pool,model_version,started_at,deadline)
    values($1,$2,'review',$3,public.polycup_ranked_rules(),'[]','btf-6.2.0-t025-softplus-v1',now(),now()+interval '1 hour')`,[id(n),id(1),[id(1),id(2)]]);
   const insert=(tx,n,p)=>tx.query('insert into public.polycup_ranked_transcripts(match_id,player_id,transcript) values($1,$2,$3)',[id(n),id(p),{}]);
   const count=async()=>(await db.query('select count(*)::int n from net.requests')).rows[0].n;
   await make(60);await make(70);await make(80);const before=await count();
   await insert(db,60,1);assert.equal(await count(),before);
   await db.transaction(async tx=>{await insert(tx,60,2);assert.equal((await tx.query('select count(*)::int n from net.requests')).rows[0].n,before);});
   assert.equal(await count(),before+1);const first=(await config()).last_request_nonce;
   await insert(db,70,1);await insert(db,70,2);assert.equal(await count(),before+1);
   await assert.rejects(db.transaction(async tx=>{await insert(tx,80,1);await insert(tx,80,2);throw Error('rollback fixture');}),/rollback fixture/);assert.equal(await count(),before+1);
   const complete=nonce=>db.transaction(async tx=>{await tx.exec('set local role polycup_result_worker');return (await tx.query('select public.polycup_ranked_dispatch_complete($1) result',[nonce])).rows[0].result;});
   await db.query('update public.polycup_ranked_result_jobs set finished_at=now() where match_id=$1',[id(60)]);
   assert.equal(await complete(first),'dispatched');assert.equal(await count(),before+2);const second=(await config()).last_request_nonce;
   assert.equal(await complete(first),'stale');assert.equal((await config()).last_request_nonce,second);
   await db.query('update public.polycup_ranked_result_jobs set finished_at=now() where match_id=$1',[id(70)]);
   assert.equal(await complete(second),'idle');assert.equal(await count(),before+2);
   for(const role of ['anon','authenticated','service_role'])await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query('select public.polycup_ranked_dispatch_complete($1)',[second]);}),/permission denied/);
  });
 }finally{await db.close();}
});
