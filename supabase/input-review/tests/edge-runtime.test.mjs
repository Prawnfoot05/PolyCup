import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createHmac,randomUUID,createHash} from 'node:crypto';
import pg from '../../worker/node_modules/pg/lib/index.js';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const hash=s=>createHash('sha256').update(s).digest('hex');
const pool=new pg.Pool({connectionString:'postgresql://postgres@127.0.0.1:55439/polycup_worker_test',max:8});
const config=await readFile('output/input-edge-runtime-qa/qa.env','utf8');
const token=config.split('\n').find(s=>s.startsWith('POLYCUP_INPUT_CRON_TOKEN=')).split('=')[1];
const signed=(domain='polycup-input-review:v1')=>{const stamp=String(Math.floor(Date.now()/1000)),nonce=randomUUID();return {'x-polycup-time':stamp,'x-polycup-nonce':nonce,'x-polycup-signature':createHmac('sha256',token).update(domain+':'+stamp+':'+nonce).digest('hex')};};
const timings=[];let calls=0;
const reserve=async()=>{const headers=signed();await pool.query('update public.polycup_input_dispatch set enabled=true,last_request_id=-1,last_request_nonce=$1,dispatched_at=now(),claimed_at=null where singleton',[headers['x-polycup-nonce']]);return headers;};
const invoke=async(headers)=>{if(!headers)headers=await reserve();const start=performance.now();calls++;const r=await fetch('http://127.0.0.1:8831/polycup-input-review',{method:'POST',headers});const body=await r.json();if(!headers.__automatic)await pool.query('update public.polycup_input_dispatch set enabled=false where singleton');timings.push(Math.round(performance.now()-start));return {status:r.status,body};};
const waitFor=async(fn)=>{for(let n=0;n<100;n++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw Error('Timed out waiting for local dispatch');};
test('Input-review Edge user workers with actual Postgres, Vault, pg_net and Cron',async t=>{
try{
 await pool.query(`create schema if not exists auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await pool.query(await readFile('supabase/migrations/'+f,'utf8'));
 await pool.query('create role worker_login login noinherit;grant polycup_input_worker to worker_login;grant connect on database polycup_worker_test to worker_login');
 for(let n=1;n<=40;n++)await pool.query('insert into auth.users values($1,$2,false)',[id(n),{full_name:'Input QA '+n}]);
 const manifest=JSON.parse(await readFile('output/input-review/references/manifest.json','utf8'));
 const files=await Promise.all(manifest.tracks.map(t=>readFile('output/input-review/references/'+t.track+'.json','utf8').then(JSON.parse)));
 const selected=files.flatMap(f=>f.entries.filter(e=>e.available&&e.rank<=10).map(e=>({file:f,ref:e}))).sort((a,b)=>b.ref.events.length-a.ref.events.length)[0];
 const {file,ref}=selected;
 const make=async(n,{rounds=1,players=[1],reference=ref,completed=true}={})=>{
 const match=id(n);await pool.query(`insert into public.polycup_ranked_matches(id,host_id,status,roster,rules,track_pool,model_version,started_at,finished_at,result) values($1,$2,$3,$4,'{}',$5,'pilot',now()-interval '5 minutes',now(),$6)`,[match,id(players[0]),completed?'completed':'review',players.map(id),JSON.stringify(files.map(f=>({id:f.track,digest:f.trackDigest}))),{rounds,standings:players.map((p,i)=>({player_id:id(p),place:i+1}))}]);
 for(const p of players)await pool.query('insert into public.polycup_ranked_members(match_id,player_id,instance_id) values($1,$2,$3)',[match,id(p),id(100+p)]);
 const transcript={rounds:Array.from({length:rounds},(_,i)=>({round:i+1,track:file.track,finishes:players.map(p=>({player:id(p),frames:reference.frames}))}))};
 await pool.query('insert into public.polycup_ranked_transcripts(match_id,player_id,transcript) values($1,$2,$3)',[match,id(players[0]),transcript]);
 const stored=(await pool.query('select transcript from public.polycup_ranked_transcripts where match_id=$1',[match])).rows[0].transcript;
 await pool.query("insert into public.polycup_ranked_validations values($1,$2,'local-peer-transcript-v1',now())",[match,hash(JSON.stringify(stored))]);
 return {match,players,rounds,reference};};
 const submit=async(f,p=f.players[0],round=1,recording=f.reference.recording)=>{const c=await pool.connect();try{await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[id(p)]);const r=await c.query('select public.polycup_submit_input_run($1,$2,$3) ok',[f.match,id(100+p),{gameVersion:'0.6.3',round,track:file.track,finish:f.reference.frames,nativeFinish:f.reference.frames,timeOffset:0,recording}]);await c.query('commit');return r.rows[0].ok;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
 const checks=async(f)=>(await pool.query('select * from public.polycup_input_checks where match_id=$1',[f.match])).rows;
 const read=async(f,role='anon')=>{const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+role);const r=await c.query('select public.polycup_input_review($1) r',[[f.match]]);await c.query('rollback');return r.rows[0].r;}finally{c.release();}};
 await t.test('disabled by default; auth domain separated; no player or rating write privileges',async()=>{
 const f=await make(1000);assert.equal(await submit(f),false);
 for(const h of [{},{apikey:'public'},signed('polycup-results:v1')])assert.equal((await invoke(h)).status,401);
 assert.equal((await invoke()).status,200);
 const c=new pg.Client({connectionString:'postgresql://worker_login@127.0.0.1:55439/polycup_worker_test'});await c.connect();try{await c.query('begin');await c.query('set local role polycup_input_worker');await assert.rejects(c.query('update public.player_ratings set rating=0'),/permission denied/);}finally{await c.query('rollback');await c.end();}
 await pool.query('update public.polycup_input_review_config set enabled=true where singleton');
 await pool.query('update public.polycup_input_dispatch set enabled=false where singleton');
 });
 await t.test('cold longest-reference review, public history after disposal, immutable retries',async()=>{
 const f=await make(1010);await submit(f);const response=await invoke();assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.body.flagged,1,JSON.stringify({response,runs:(await pool.query('select attempts,last_error_code from public.polycup_input_runs where match_id=$1',[f.match])).rows}));
 const rows=await checks(f);assert.equal(rows[0].findings[0].kind,'whole');
 const raw=(await pool.query('select recording,recording_digest from public.polycup_input_runs where match_id=$1',[f.match])).rows[0];assert.equal(raw.recording,null);assert.equal(raw.recording_digest,hash(ref.recording));
 assert.equal(await submit(f),true);await assert.rejects(submit(f,1,1,'abc'),/Conflicting/);assert.equal((await invoke()).body.processed,0);
 const publicRows=await read(f);assert.equal(publicRows[0].status,'flagged');assert.deepEqual(publicRows,await read(f,'authenticated'));assert.ok(!JSON.stringify(publicRows).includes(ref.recording));
 });
 await t.test('overlapping signed replays claim one batch; stale receipt does no work',async()=>{
 const f=await make(1015,{rounds:8});for(let round=1;round<=8;round++)await submit(f,1,round);
 const h=await reserve();const results=await Promise.all([invoke(h),invoke(h),invoke(h)]);assert.ok(results.every(r=>r.status===200));assert.equal(results.reduce((n,r)=>n+r.body.processed,0),8);assert.equal((await checks(f)).length,8);assert.equal((await invoke(h)).body.duplicate,true);
 });
 await t.test('held-out replay, bad evidence, and unvalidated transcript do not become flags',async()=>{
 const control=file.entries.find(e=>e.available&&e.rank===11);const f=await make(1020,{reference:control});await submit(f);assert.equal((await invoke()).body.flagged,0);assert.equal((await checks(f))[0].status,'no_match');
 const bad=await make(1030);await submit(bad,1,1,'abc');await invoke();assert.equal((await checks(bad))[0].status,'invalid');
 const mismatch=await make(1040);await submit(mismatch);await pool.query("update public.polycup_ranked_validations set digest='mismatch' where match_id=$1",[mismatch.match]);await invoke();assert.equal((await checks(mismatch))[0].status,'invalid');
 });
 await t.test('failure rolls findings and disposal back; retry and lost success response are safe',async()=>{
 const f=await make(1050);await submit(f);
 await pool.query(`create function public.qa_input_fail() returns trigger language plpgsql as $$begin if new.match_id='${f.match}' and new.recording is null then raise exception 'retry' using errcode='40001';end if;return new;end$$;create trigger qa_input_fail before update on public.polycup_input_runs for each row execute function public.qa_input_fail();`);
 assert.equal((await invoke()).body.retry,1);assert.equal((await checks(f)).length,0);assert.notEqual((await pool.query('select recording from public.polycup_input_runs where match_id=$1',[f.match])).rows[0].recording,null);
 assert.equal((await invoke()).body.processed,0);await pool.query('drop trigger qa_input_fail on public.polycup_input_runs');await pool.query('update public.polycup_input_runs set next_attempt_at=now() where match_id=$1',[f.match]);assert.equal((await invoke()).body.processed,1);await invoke();assert.equal((await checks(f)).length,1);
 });
 await t.test('maximum-event recordings and a 1000-round settled context remain inside Edge limits',async()=>{
 const bytes=[];const u24=n=>bytes.push(n&255,(n>>>8)&255,(n>>>16)&255);u24(1);u24(0);u24(8190);for(let i=0;i<8190;i++)u24(1);for(let i=0;i<3;i++)u24(0);
 const recording=deflateSync(Buffer.from(bytes)).toString('base64url');
 const f=await make(1060,{rounds:1000});for(let round=1;round<=8;round++)await submit(f,1,round,recording);
 const r=await invoke();assert.equal(r.status,200);assert.equal(r.body.processed,8);assert.equal(r.body.flagged,0);assert.ok((await checks(f)).every(c=>c.status==='no_match'));
 });
 await t.test('40 players / ten simultaneous Cups / 600 runs drain through bounded batches',async()=>{
 const fixtures=[];for(let cup=0;cup<10;cup++){const f=await make(2000+cup,{rounds:15,players:Array.from({length:4},(_,i)=>cup*4+i+1)});fixtures.push(f);for(const p of f.players)for(let round=1;round<=15;round++)await submit(f,p,round);}
 const before=await pool.query('select * from public.player_ratings order by player_id');let processed=0,flagged=0;const start=performance.now();
 for(let wave=0;wave<80&&processed<600;wave++){const results=[await invoke()];for(const r of results){assert.equal(r.status,200,JSON.stringify(r));assert.ok(r.body.processed<=8);processed+=r.body.processed;flagged+=r.body.flagged;}}
 assert.equal(processed,600);assert.equal(flagged,600);for(const f of fixtures)assert.equal((await checks(f)).length,60);
 assert.deepEqual((await pool.query('select * from public.player_ratings order by player_id')).rows,before.rows);
 const contextBytes=Buffer.byteLength(JSON.stringify((await pool.query('select track_pool from public.polycup_ranked_matches where id=$1',[fixtures[0].match])).rows[0].track_pool))+Buffer.byteLength(JSON.stringify((await pool.query('select transcript from public.polycup_ranked_transcripts where match_id=$1',[fixtures[0].match])).rows[0].transcript));
 const checkBytes=Number((await pool.query('select sum(pg_column_size(c))::bigint bytes from public.polycup_input_checks c where match_id=any($1)',[fixtures.map(f=>f.match)])).rows[0].bytes);
 const bytes=(await pool.query('select sum(pg_column_size(u))::bigint bytes from public.polycup_input_runs u where match_id=any($1)',[fixtures.map(f=>f.match)])).rows[0].bytes;
 await writeFile('output/input-edge-load.json',JSON.stringify({players:40,cups:10,runs:600,elapsedMs:Math.round(performance.now()-start),retainedInputMetadataBytes:Number(bytes),retainedFindingBytes:checkBytes,contextBytesPerMatch:contextBytes,estimatedDatabasePayloadBytes:contextBytes*80+600*Buffer.byteLength(ref.recording),referenceEvents:ref.events.length,referenceFinish:ref.frames,recordingBytes:Buffer.byteLength(ref.recording)}));
 });
 await t.test('global storage/daily caps, expiry, and repeated failure remain explicitly unavailable',async()=>{
 const f=await make(3000,{completed:false});await pool.query('update public.polycup_input_review_config set max_raw_bytes=1 where singleton');await assert.rejects(submit(f),e=>e.code==='PC002');await pool.query('update public.polycup_input_review_config set max_raw_bytes=25165824,max_daily_bytes=1 where singleton');await assert.rejects(submit(f),e=>e.code==='PC002');await pool.query('update public.polycup_input_review_config set max_daily_bytes=16777216 where singleton');await pool.query('update public.polycup_input_review_config set max_daily_runs=0 where singleton');await assert.rejects(submit(f),e=>e.code==='PC002');await pool.query('update public.polycup_input_review_config set max_daily_runs=4000,max_retained_runs=1 where singleton');await assert.rejects(submit(f),e=>e.code==='PC002');await pool.query('update public.polycup_input_review_config set max_retained_runs=24000 where singleton');await submit(f);await pool.query("update public.polycup_input_runs set created_at=now()-interval '49 hours' where match_id=$1",[f.match]);await pool.query('select public.polycup_input_prune()');assert.equal((await checks(f))[0].status,'unsupported');
 assert.equal(Number((await pool.query('select raw_bytes from public.polycup_input_review_config')).rows[0].raw_bytes),0);
 });
 await t.test('real conditional Cron/pg_net/Vault wakes late evidence and stays idle afterward',async()=>{
 await pool.query(await readFile('supabase/input-review/install-edge-cron.sql','utf8'));
 await pool.query("select vault.create_secret($1,'polycup_input_cron_token')",[token]);
 // Only the disposable fixture permits its loopback HTTP endpoint.
 await pool.query('alter table public.polycup_input_dispatch drop constraint polycup_input_dispatch_function_url_check');
 await pool.query("update public.polycup_input_dispatch set last_request_id=null,last_request_nonce=null,claimed_at=null,enabled=true,function_url='http://127.0.0.1:9000/polycup-input-review',next_dispatch_at=now() where singleton");
 const f=await make(3010);await submit(f);await waitFor(async()=>(await checks(f)).length===1);
 await waitFor(async()=>!(await pool.query('select last_request_id from public.polycup_input_dispatch')).rows[0].last_request_id);
 assert.equal((await pool.query('select public.polycup_input_dispatch_tick() r')).rows[0].r,'idle');
 const callsBefore=(await pool.query("select count(*)::int n from net._http_response")).rows[0].n;await pool.query('select public.polycup_input_dispatch_tick()');assert.equal((await pool.query('select count(*)::int n from net._http_response')).rows[0].n,callsBefore);
 const before=await make(3020,{completed:false});await submit(before);assert.equal((await checks(before)).length,0);assert.equal((await pool.query('select public.polycup_input_dispatch_tick() r')).rows[0].r,'idle');await pool.query("update public.polycup_ranked_matches set status='completed' where id=$1",[before.match]);await waitFor(async()=>(await checks(before)).length===1);
 await pool.query('alter table public.polycup_input_runs disable trigger polycup_input_wake');const missed=await make(3030);await submit(missed);await pool.query('alter table public.polycup_input_runs enable trigger polycup_input_wake');
 await pool.query("select cron.schedule('polycup-input-dispatch','1 second','select public.polycup_input_dispatch_tick()')");await waitFor(async()=>(await checks(missed)).length===1);
 await pool.query("select cron.unschedule('polycup-input-dispatch')");
 await waitFor(async()=>!(await pool.query('select last_request_id from public.polycup_input_dispatch')).rows[0].last_request_id);
 await pool.query('alter table public.polycup_input_runs disable trigger polycup_input_wake');const stale=await make(3040);await submit(stale);await pool.query('alter table public.polycup_input_runs enable trigger polycup_input_wake');
 await pool.query("update public.polycup_input_dispatch set last_request_id=-500,last_request_nonce=gen_random_uuid(),claimed_at=now()-interval '91 seconds',dispatched_at=now()-interval '91 seconds' where singleton");assert.equal((await pool.query('select public.polycup_input_dispatch_tick() r')).rows[0].r,'backoff');
 await pool.query('update public.polycup_input_dispatch set next_dispatch_at=now(),max_daily_requests=0 where singleton');assert.equal((await pool.query('select public.polycup_input_dispatch_tick() r')).rows[0].r,'daily_limit');
 await pool.query('update public.polycup_input_dispatch set max_daily_requests=5000 where singleton');assert.equal((await pool.query('select public.polycup_input_dispatch_tick() r')).rows[0].r,'dispatched');await waitFor(async()=>(await checks(stale)).length===1);
await pool.query("select cron.unschedule('polycup-input-cleanup')");
 });
 await writeFile('output/input-edge-runtime-verification.json',JSON.stringify({passed:true,scope:'Local Supabase user-worker under 2000ms CPU / 256MB limits; no deployment',calls,timings,referenceTrack:file.track}));
}finally{await pool.end();}
});
