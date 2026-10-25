import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('ranked queue admission, formation and lifecycle',async t=>{
 const db=await PGlite.create();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const file of ['20261021000000_account_friends_foundation.sql','20261021040000_waiting_rooms.sql','20261021050000_single_cup_membership.sql','20261021070000_ranked_foundation.sql','20261022000000_ranked_rating_history.sql','20261022010000_ranked_queue.sql'])await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  for(let n=1;n<=10;n++)await db.query('insert into auth.users values($1,$2,$3)',[id(n),{name:'Player '+n},n===10]);
  const as=(who,sql,args=[],role='authenticated')=>db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[who?id(who):'']);return tx.query(sql,args);});
  const queue=async(p,action='poll',instance=100+p,version='0.4.0-dev.1')=>(await as(p,'select public.polycup_queue($1,$2,$3) r',[action,id(instance),version])).rows[0].r;
  const count=async table=>(await db.query('select count(*)::int n from public.'+table)).rows[0].n;
  const clear=async()=>{await db.exec("delete from public.polycup_ranked_queue;delete from public.polycup_ranked_claims;update public.polycup_ranked_matches set status='cancelled' where status in ('reserved','drafting');delete from public.polycup_rooms;");};
  const age=seconds=>db.query('update public.polycup_ranked_queue set joined_at=now()-make_interval(secs=>$1)',[seconds]);
  await t.test('off by default, no guest play, no caller-specified rosters or catalog',async()=>{
   const info=(await as(null,'select public.polycup_queue_info() r',[],'anon')).rows[0].r;assert.equal(info.enabled,false);
   await assert.rejects(queue(1,'join'),/not available/);
   await assert.rejects(queue(10,'join'),/Sign in with Discord/);
   await assert.rejects(as(1,'select public.polycup_queue_tick()'),/permission denied/);
   await assert.rejects(as(1,'select * from public.polycup_ranked_queue'),/permission denied/);
   const pool=Array.from({length:16},(_,i)=>({id:'track-'+i,category:'official',digest:'a'.repeat(64)}));
   await db.exec('update public.polycup_ranked_config set enabled=true,provisional_matches=3,tier_floors=array[0,5000,10000,15000,20000,25000]');
   await db.query('update public.polycup_queue_config set enabled=true,catalog=$1',[pool]);
   await assert.rejects(queue(1,'join',101,'old'),/Update/);
  });
  await t.test('idempotent joins, instance fencing, cancellation and both directions of Cup exclusion',async()=>{
   const first=await queue(1,'join');await queue(1,'join');assert.equal(await count('polycup_ranked_queue'),1);
   assert.equal((await queue(1)).joined_at,first.joined_at);
   await assert.rejects(queue(1,'cancel',999),/another window/);
   await assert.rejects(as(1,"select public.polycup_room('create',$1,$2,'{}')",[id(900),id(901)]),/Leave the ranked queue/);
   await queue(1,'cancel');assert.equal(await count('polycup_ranked_queue'),0);
   const data={cup:{id:id(900),name:'Custom',phase:'registration',draft:{stage:'roster'},roster:[]},public:false,launch:null};
   await as(1,"select public.polycup_room('create',$1,$2,$3)",[id(900),id(901),{name:'Host',version:'test',data}]);
   await assert.rejects(queue(1,'join'),/Leave your current Cup/);
   await clear();
  });
  await t.test('four clients form exactly one fixed match and all must accept',async()=>{
   await Promise.all([1,2,3,4].map(p=>queue(p,'join')));
   const states=await Promise.all([1,2,3,4].map(p=>queue(p)));
   assert.equal(new Set(states.map(s=>s.match.id)).size,1);assert.equal(await count('polycup_ranked_queue'),0);
   assert.equal(states[0].match.players.length,4);assert.equal(states[0].match.rules.picksPerRacer,2);
   for(const p of [1,2,3])assert.equal((await queue(p,'accept')).match.status,'reserved');
   assert.equal((await queue(4,'accept')).match.status,'drafting');
   assert.equal((await queue(4,'accept')).match.status,'drafting');
   await assert.rejects(queue(1,'poll',999),/another window/);
   await db.query("update public.polycup_ranked_members set seen_at=now()-interval '36 seconds' where player_id=$1 and match_id=$2",[id(1),states[0].match.id]);
   assert.equal((await queue(1,'poll',999)).match.id,states[0].match.id);
   await assert.rejects(queue(1,'accept',101),/another window/);
   await queue(1,'leave-match',999);assert.equal((await queue(2)).state,'idle');
   await clear();
  });
  await t.test('three/duel fallback requires every selected player to wait',async()=>{
   await queue(1,'join');await queue(2,'join');await queue(3,'join');
   await age(59);assert.equal((await queue(1)).state,'queued');
   await age(61);assert.equal((await queue(1)).match.players.length,3);await queue(2,'decline');
   await queue(1,'join');await age(121);await queue(2,'join');
   assert.equal((await queue(1)).state,'queued'); // fresh second racer isn't pulled into a duel
   await age(119);assert.equal((await queue(1)).state,'queued');
   await age(121);assert.equal((await queue(1)).match.players.length,2);
   await clear();
  });
  await t.test('rating tolerance widens mutually; version mismatch and expired clients never fill seats',async()=>{
   await db.query('insert into public.polycup_rating_state(player_id,state) values($1,$2)',[id(2),{mu:45,sigma:3,model:'btf-6.2.0-t025-softplus-v1'}]);
   await queue(1,'join');await queue(2,'join');await age(121);assert.equal((await queue(1)).state,'queued');
   await age(141);assert.equal((await queue(1)).match.players.length,2);await clear();
   await db.exec('delete from public.polycup_rating_state');
   await queue(1,'join');await queue(2,'join');await queue(3,'join');
   await db.query("update public.polycup_ranked_queue set seen_at=now()-interval '36 seconds' where player_id=$1",[id(3)]);
   await queue(4,'join');assert.equal((await queue(1)).state,'queued');assert.equal(await count('polycup_ranked_queue'),3);
   assert.equal((await queue(3)).state,'idle');await clear();
  });
  await t.test('late cancellation, acceptance expiry, recovery and disabled queue release safely',async()=>{
   for(const p of [1,2,3,4])await queue(p,'join');
   assert.equal((await queue(1,'cancel')).state,'idle');assert.equal((await queue(2)).state,'idle');
   assert.equal(await count('polycup_ranked_claims'),0);
   for(const p of [1,2,3,4])await queue(p,'join');
   await queue(1,'accept');
   await db.exec("update public.polycup_ranked_matches set deadline=now()-interval '1 second' where status='reserved'");
   assert.equal((await queue(2,'accept')).state,'idle');assert.equal(await count('polycup_ranked_claims'),0);
   await queue(1,'join');await db.exec('update public.polycup_queue_config set enabled=false');
   assert.equal((await queue(1)).state,'idle');assert.equal(await count('polycup_ranked_queue'),0);
  });
 }finally{await db.close();}
});
