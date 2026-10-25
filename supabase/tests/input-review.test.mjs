import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
import {loadCorpus,processInputReviews} from '../input-review/processor.ts';
import {digest} from '../input-review/matcher.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('local input-review pipeline and public observer permissions',async t=>{
 const db=await PGlite.create();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&!/^202610230[2346]0000_/.test(f)).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  for(let n=1;n<=3;n++)await db.query('insert into auth.users values($1,$2,false)',[id(n),{full_name:['Alice','Bob','Observer'][n-1]}]);
  const as=(n,query,args=[])=>db.transaction(async tx=>{await tx.exec('set local role '+(n?'authenticated':'anon'));await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[n?id(n):'']);return tx.query(query,args);});
  const corpus=await loadCorpus();const reference=corpus.references.find(r=>r.events.length>100&&r.finish>15000);
  const file=JSON.parse(await readFile('output/input-review/references/'+reference.track+'.json','utf8')),ref=file.entries.find(e=>e.id===reference.id);
  await db.query(`insert into public.polycup_ranked_matches(id,host_id,status,roster,rules,track_pool,model_version,started_at,finished_at,result) values($1,$2,'completed',$3,'{}',$4,'pilot',now()-interval '5 minutes',now(),$5)`,[id(10),id(1),[id(1),id(2)],[{id:reference.track,digest:file.trackDigest}],{rounds:2,standings:[{player_id:id(1),place:1},{player_id:id(2),place:2}]}]);
  for(let n=1;n<=2;n++)await db.query('insert into public.polycup_ranked_members(match_id,player_id,instance_id) values($1,$2,$3)',[id(10),id(n),id(100+n)]);
  const run={gameVersion:'0.6.3',round:1,track:reference.track,finish:ref.frames,nativeFinish:ref.frames,timeOffset:0,recording:ref.recording};
  const transcript={rounds:[{round:1,track:reference.track,finishes:[{player:id(1),frames:ref.frames},{player:id(2),frames:ref.frames+1000}]},{round:2,track:reference.track,finishes:[{player:id(1),frames:ref.frames+1000},{player:id(2),frames:null}]}]};
  await db.query('insert into public.polycup_ranked_transcripts(match_id,player_id,transcript) values($1,$2,$3)',[id(10),id(1),transcript]);
  // JSONB ordering is canonicalized by the database before the real validator hashes it.
  const stored=(await db.query('select transcript from public.polycup_ranked_transcripts where match_id=$1',[id(10)])).rows[0].transcript;
  await db.query("insert into public.polycup_ranked_validations values($1,$2,'local-peer-transcript-v1',now())",[id(10),digest(JSON.stringify(stored))]);
  const submit=(actor,value=run,instance=id(100+actor))=>as(actor,'select public.polycup_submit_input_run($1,$2,$3) r',[id(10),instance,JSON.stringify(value)]);
  await t.test('disabled by default; owner and instance checks; immutable retry',async()=>{
   assert.equal((await submit(1)).rows[0].r,false);await db.exec('update public.polycup_input_review_config set enabled=true');
   await assert.rejects(submit(3),/another match window/);await assert.rejects(submit(1,run,id(999)),/another match window/);
   await submit(1);await submit(1);assert.equal((await db.query('select count(*) n from public.polycup_input_runs')).rows[0].n,1);
   await assert.rejects(submit(1,{...run,recording:'abc'}),/Conflicting/);
   await assert.rejects(as(2,'select * from public.polycup_input_runs'),/permission denied/);
   await assert.rejects(as(1,"update public.polycup_input_checks set status='flagged'"),/permission denied/);
   await assert.rejects(submit(1,{...run,round:3,track:'not-in-pool'}),/Invalid input/);
  });
  await t.test('local worker finds exact copy once, no rating side effects',async()=>{
   const before=(await db.query('select * from public.player_ratings order by player_id')).rows;
   assert.equal(await processInputReviews(db,corpus),1);assert.equal(await processInputReviews(db,corpus),0);
   const c=(await db.query('select * from public.polycup_input_checks')).rows[0];assert.equal(c.status,'flagged');assert.equal(c.findings[0].kind,'whole');
   assert.deepEqual((await db.query('select * from public.player_ratings order by player_id')).rows,before);assert.equal((await db.query('select count(*) n from public.polycup_rating_events')).rows[0].n,0);
  });
  await t.test('outsider and anonymous viewer see same flags; missing evidence stays unavailable',async()=>{
   const read=n=>as(n,'select public.polycup_input_review($1,$2) r',[[id(10)],null]);const owner=(await read(1)).rows[0].r,observer=(await read(3)).rows[0].r,anonymous=(await read(0)).rows[0].r;
   assert.deepEqual(owner,observer);assert.deepEqual(owner,anonymous);assert.equal(owner.filter(r=>r.status==='flagged').length,1);assert.equal(owner.filter(r=>r.status==='unavailable').length,2);
   assert.ok(!JSON.stringify(owner).includes(ref.recording));await mkdir('output/input-review',{recursive:true});await writeFile('output/input-review/public-fixture.json',JSON.stringify({match:id(10),player:id(1),checks:owner},null,2));
   await assert.rejects(as(0,'select public.polycup_input_review($1)',[Array(26).fill(id(10))]),/Too many/);
   await db.query("update public.polycup_ranked_matches set status='racing' where id=$1",[id(10)]);assert.deepEqual((await read(3)).rows[0].r,[]);await db.query("update public.polycup_ranked_matches set status='completed' where id=$1",[id(10)]);
  });
  await t.test('adjusted native clocks retain segment evidence without claiming whole-Cup-run coverage',async()=>{
   await submit(1,{...run,round:2,timeOffset:1000,finish:run.finish+1000});await processInputReviews(db,corpus);const c=(await db.query('select * from public.polycup_input_checks where round=2')).rows[0];assert.equal(c.status,'flagged');assert.equal(c.findings[0].kind,'segment');assert.equal(c.findings[0].start,1000);assert.ok(c.findings[0].coverage<1);
  });
  await t.test('host-forfeit results never expose unvalidated transcript runs',async()=>{
   await db.query("update public.polycup_ranked_validations set method='server-abandonment-v1' where match_id=$1",[id(10)]);
   assert.deepEqual((await as(3,'select public.polycup_input_review($1) r',[[id(10)]])).rows[0].r,[]);
   assert.equal(await processInputReviews(db,{...corpus,digest:'new-policy-test'}),0);
  });
  await t.test('public profile pictures are bounded and guest identities are excluded',async()=>{
   await db.query('update public.profiles set avatar_url=$1 where id=$2',['https://cdn.discordapp.com/embed/avatars/0.png',id(1)]);
   const pictures=(await as(0,'select public.polycup_profile_pictures($1) r',[[id(1),id(2)]])).rows[0].r;assert.equal(pictures[id(1)],'https://cdn.discordapp.com/embed/avatars/0.png');assert.deepEqual(Object.keys(pictures).sort(),[id(1),id(2)]);
   await assert.rejects(as(0,'select public.polycup_profile_pictures($1)',[Array(101).fill(id(1))]),/Too many/);
   await db.query('update auth.users set is_anonymous=true where id=$1',[id(2)]);assert.equal((await as(0,'select public.polycup_profile_pictures($1) r',[[id(2)]])).rows[0].r[id(2)],undefined);
  });
  await t.test('database evidence quota cannot be bypassed by direct RPC calls; retries remain allowed',async()=>{
   await db.query(`insert into public.polycup_input_runs(match_id,player_id,round,track,finish,recording,native_finish,time_offset,game_version)
     select $1,$2,n,$3,$4,$5,$4,0,'0.6.3' from generate_series(3,200)n`,[id(10),id(1),run.track,run.finish,run.recording]);
   await assert.rejects(submit(1,{...run,round:201}),e=>e.code==='PC001');await submit(1);
  });
 await t.test('exhausted processor retries expire honestly and logical storage counters remain accurate',async()=>{
 await db.query('update public.polycup_input_runs set attempts=6 where round=3');await db.query('select public.polycup_input_prune()');
 const c=(await db.query('select * from public.polycup_input_checks where round=3')).rows[0];assert.equal(c.status,'unsupported');assert.equal((await db.query('select recording from public.polycup_input_runs where round=3')).rows[0].recording,null);
 const cfg=(await db.query('select raw_bytes,retained_runs from public.polycup_input_review_config')).rows[0];const actual=(await db.query('select coalesce(sum(octet_length(recording)),0) bytes,count(*) n from public.polycup_input_runs')).rows[0];assert.equal(Number(cfg.raw_bytes),Number(actual.bytes));assert.equal(Number(cfg.retained_runs),Number(actual.n));
 await db.query('delete from public.polycup_input_runs where round=3');assert.equal(Number((await db.query('select retained_runs from public.polycup_input_review_config')).rows[0].retained_runs),Number(actual.n)-1);
 });
 }finally{await db.close();}
});
