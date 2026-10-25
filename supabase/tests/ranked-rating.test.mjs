import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {PGlite} from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('selected rating model and public match histories',async t=>{
 const db=await PGlite.create();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create table auth.users(id uuid primary key,raw_user_meta_data jsonb,is_anonymous boolean default false);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const f of ['20261021000000_account_friends_foundation.sql','20261021010000_friends_presence.sql','20261021040000_waiting_rooms.sql','20261021050000_single_cup_membership.sql','20261021060000_friend_cup_invites.sql','20261021070000_ranked_foundation.sql','20261022000000_ranked_rating_history.sql','20261022020000_ranked_profile_stats.sql'])
   await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
  const as=(role,who,sql,args=[])=>db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[who?id(who):'']);return tx.query(sql,args);});
  const service=(sql,args)=>as('service_role',null,sql,args);
  const publicRead=(sql,args)=>as('anon',null,sql,args);
  await t.test('243 pinned OpenSkill reference cases, including ties and unequal confidence',async()=>{
   const {cases}=JSON.parse(await readFile('supabase/tests/fixtures/ranked-btf.json','utf8'));
   for(const [k,example] of cases.entries()){
    const result=(await db.query('select public.polycup_rating_calculate($1) r',[example.input])).rows[0].r;
    for(let i=0;i<result.length;i++){
     assert.ok(Math.abs(result[i].mu-example.expected[i].mu)<1e-10,`mu ${k}/${i}`);
     assert.ok(Math.abs(result[i].sigma-example.expected[i].sigma)<1e-10,`sigma ${k}/${i}`);
     assert.equal(result[i].rating,example.expected[i].rating,`display ${k}/${i}`);
    }
   }
   assert.equal((await db.query('select public.polycup_rating_display(25) r')).rows[0].r,12500);
   for(const bad of [null,[],[{}],[{mu:25,sigma:0,place:1},{mu:25,sigma:3,place:2}]])
    await assert.rejects(db.query('select public.polycup_rating_calculate($1)',[bad]));
  });
  await t.test('model selected without enabling ranked or choosing badge thresholds',async()=>{
   const c=(await db.query('select * from public.polycup_ranked_config')).rows[0];
   assert.equal(c.model_version,'btf-6.2.0-t025-softplus-v1');assert.equal(c.enabled,false);assert.equal(c.tier_floors,null);
   await assert.rejects(as('authenticated',1,'select public.polycup_ranked_rate($1)',[id(100)]),/permission denied/);
   await assert.rejects(service('select public.polycup_ranked_finalize($1,$2,$3)',[id(100),c.model_version,[]]),/permission denied/);
   await assert.rejects(publicRead('select public.polycup_rating_calculate($1)',[[]]),/permission denied/);
  });
  for(let n=1;n<=4;n++)await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id(n),{full_name:'Racer '+n}]);
  // Local-only eligibility thresholds for exercising the complete transaction.
  await db.exec('update public.polycup_ranked_config set enabled=true,provisional_matches=3,tier_floors=array[0,5000,10000,15000,20000,25000]');
  const pool=Array.from({length:16},(_,i)=>({id:'track-'+i,category:'official',digest:'a'.repeat(64)}));
  const evidence={digest:'b'.repeat(64),rounds:19,standings:[1,2,3,4].map((n,i)=>({player_id:id(n),place:i+1,points:i?120-i*10:140}))};
  const setup=async key=>{
   await service('select public.polycup_ranked_reserve($1,$2,$3)',[id(key),[1,2,3,4].map(id),pool]);
   for(let p=1;p<=4;p++)await as('authenticated',p,"select public.polycup_ranked_member($1,$2,'accept')",[id(key),id(100+p)]);
   await service("select public.polycup_ranked_advance($1,'draft')",[id(key)]);
   const draft={bans:[1,2,3,4].flatMap((p,i)=>[0,1].map(j=>({player_id:id(p),track_id:'track-'+(2*i+j)}))),
     picks:[1,2,3,4].flatMap((p,i)=>[0,1].map(j=>({player_id:id(p),track_id:'track-'+(8+2*i+j)})))};
   await service("select public.polycup_ranked_advance($1,'race',$2)",[id(key),draft]);
   for(let p=1;p<=4;p++)await as('authenticated',p,'select public.polycup_ranked_report($1,$2,$3)',[id(key),id(100+p),evidence]);
  };
  await t.test('rating the first Cup updates all players once and exposes only completed public results',async()=>{
   await setup(100);
   assert.equal((await publicRead('select public.polycup_ranked_match($1) r',[id(100)])).rows[0].r,null);
   await service('select public.polycup_ranked_rate($1)',[id(100)]);
   await service('select public.polycup_ranked_rate($1)',[id(100)]);
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,4);
   const history=(await publicRead('select * from public.polycup_ranked_history($1)',[id(1)])).rows;
   assert.equal(history.length,1);assert.equal(history[0].player_count,4);assert.equal(history[0].rounds,19);
   assert.equal(history[0].rating_before,null);assert.ok(history[0].rating_after>12500);
   const details=(await publicRead('select public.polycup_ranked_match($1) r',[id(100)])).rows[0].r;
   assert.deepEqual(Object.keys(details).sort(),['match_id','finished_at','rounds','players'].sort());
   assert.equal(details.players.length,4);assert.equal(details.players[0].display_name,'Racer 1');
   assert.deepEqual(Object.keys(details.players[0]).sort(),['player_id','display_name','place','rating_before','rating_after'].sort());
  });
  await t.test('later Cups reuse model state, stale state rolls back, and pages are ordered',async()=>{
   const prior=(await db.query('select * from public.player_ratings order by player_id')).rows;
   await setup(200);
   await db.query('update public.player_ratings set rating=rating+1 where player_id=$1',[id(4)]);
   await assert.rejects(service('select public.polycup_ranked_rate($1)',[id(200)]),/disagree/);
   assert.equal((await db.query('select * from public.polycup_rating_events')).rows.length,4);
   await db.query('update public.player_ratings set rating=$1 where player_id=$2',[prior[3].rating,id(4)]);
   await service('select public.polycup_ranked_rate($1)',[id(200)]);
   const page1=(await publicRead('select * from public.polycup_ranked_history($1,1,0)',[id(1)])).rows;
   const page2=(await publicRead('select * from public.polycup_ranked_history($1,1,1)',[id(1)])).rows;
   assert.equal(page1[0].match_id,id(200));assert.equal(page2[0].match_id,id(100));
   assert.equal(page1[0].rating_before,prior[0].rating);
   assert.equal((await db.query('select rated_matches from public.player_ratings where player_id=$1',[id(1)])).rows[0].rated_matches,2);
  });
  await t.test('public stats count completed rated Cups and first places only',async()=>{
   const stats=async n=>(await publicRead('select public.polycup_ranked_stats($1) s',[id(n)])).rows[0].s;
   assert.deepEqual(await stats(1),{matches:2,wins:2,win_rate:100});
   assert.deepEqual(await stats(2),{matches:2,wins:0,win_rate:0});
   assert.deepEqual(await stats(999),{matches:0,wins:0,win_rate:null});
   await setup(300); // Submitted reports awaiting settlement must not affect public stats.
   assert.deepEqual(await stats(1),{matches:2,wins:2,win_rate:100});
   await assert.rejects(publicRead('select * from public.polycup_rating_events'),/permission denied/);
   assert.equal((await as('authenticated',1,'select public.polycup_ranked_stats($1) s',[id(2)])).rows[0].s.win_rate,0);
  });
 }finally{await db.close();}
});
