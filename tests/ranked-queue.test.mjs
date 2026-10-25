import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RankedQueue} from '../src/ranked-queue.ts';
const info={enabled:true,version:'0.4.0-dev.1',waiting:1,three_after:60,two_after:120};
const snapshot=state=>({...info,state,joined_at:new Date().toISOString()});
test('explicit abandonment waits for a poll, is bound to its match and cannot double submit',async()=>{
 let finishPoll,finishAbandon,calls=0,hold=false;
 const value={...snapshot('matched'),match:{id:'cup',status:'racing',players:[]}};
 const api={queue:async()=>hold?new Promise(r=>finishPoll=()=>r(value)):value,abandon:async(match)=>{assert.equal(match,'cup');calls++;await new Promise(r=>finishAbandon=r);}};
 const q=new RankedQueue(api,storage());q.setUser('player');
 try{await q.refresh();hold=true;const poll=q.refresh(),abandon=q.abandonMatch('cup');assert.equal(q.busy,true);await q.abandonMatch('cup');assert.equal(calls,0);hold=false;finishPoll();await poll;await new Promise(r=>setImmediate(r));assert.equal(calls,1);finishAbandon();await abandon;assert.equal(q.busy,false);await q.abandonMatch('stale-cup');assert.equal(calls,1);}finally{q.dispose();}
});
test('changing accounts while abandonment waits cannot abandon the previous account',async()=>{
 let finishPoll,hold=false,calls=0;const value={...snapshot('matched'),match:{id:'cup',status:'racing',players:[]}};
 const q=new RankedQueue({queue:async()=>hold?new Promise(r=>finishPoll=()=>r(value)):value,abandon:async()=>calls++},storage());q.setUser('old');
 try{await q.refresh();hold=true;const poll=q.refresh(),abandon=q.abandonMatch('cup');q.setUser(null);finishPoll();await Promise.all([poll,abandon]);assert.equal(calls,0);assert.equal(q.busy,false);}finally{q.dispose();}
});
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('queue preserves uncertain joins and failed cancellation until the server confirms',async()=>{
 let mode='lost-join';const calls=[];
 const api={queue:async(action,instance,version)=>{calls.push({action,instance,version});if(mode==='lost-join'||mode==='failed-cancel')throw new Error('Network lost');return snapshot(mode);},queueInfo:async()=>info};
 const store=storage(),q=new RankedQueue(api,store);q.setUser('player');
 try{
  await q.act('join');assert.equal(q.active,true);assert.equal(store.getItem('polycup.ranked.active'),'player');
  mode='queued';await q.refresh();assert.equal(q.snapshot.state,'queued');
  mode='failed-cancel';await q.act('cancel');assert.equal(q.active,true);
  mode='idle';await q.refresh();assert.equal(calls.at(-1).action,'cancel');assert.equal(q.active,false);assert.equal(store.getItem('polycup.ranked.active'),null);
  assert.equal(new Set(calls.map(c=>c.instance)).size,1);
 }finally{q.dispose();}
});
test('definitive rejection does not trap this window in a nonexistent queue',async()=>{
 const q=new RankedQueue({queue:async()=>{throw Object.assign(new Error('Ranked is open in another window.'),{code:'P0001'});}},storage());
 q.setUser('player');try{await q.act('join');assert.equal(q.active,false);assert.match(q.error,/another window/);}finally{q.dispose();}
});
test('late responses from a previous account cannot resurrect queue state',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);
 const q=new RankedQueue({queue:()=>pending},storage());q.setUser('old');
 try{const join=q.act('join');q.setUser('new');resolve(snapshot('queued'));await join;assert.equal(q.active,false);assert.equal(q.snapshot,null);assert.equal(q.busy,false);}finally{q.dispose();}
});
test('a session reload recovers the existing instance; expiry clears its saved intent',async()=>{
 const store=storage();store.setItem('polycup.ranked.instance','same-instance');store.setItem('polycup.ranked.active','player');
 const calls=[];const q=new RankedQueue({queue:async(action,instance)=>{calls.push({action,instance});return snapshot('idle');}},store);
 try{q.setUser('player');await new Promise(r=>setTimeout(r,0));assert.equal(calls[0].instance,'same-instance');assert.equal(calls[0].action,'poll');assert.equal(q.active,false);assert.equal(store.getItem('polycup.ranked.active'),null);}finally{q.dispose();}
});

test('a new attempt fences a delayed cancellation from the previous attempt', async () => {
 const calls=[];const q=new RankedQueue({queue:async(action,instance)=>{calls.push({action,instance});return snapshot(action==='cancel'?'idle':'queued');}},storage());
 q.setUser('player');
 try { await q.act('join');await q.act('cancel');await q.act('join');assert.equal(calls[0].instance,calls[1].instance);assert.notEqual(calls[1].instance,calls[2].instance); }
 finally { q.dispose(); }
});
test('rank reads are cached and an old account response cannot replace the current badge', async () => {
 let resolve;let calls=0;const old=new Promise(r=>resolve=r);
 const q=new RankedQueue({stats:async()=>({matches:20,wins:9,win_rate:45}),profile:async id=>{calls++;return id==='old'?old:{player_id:id,rating:20000};},queue:async()=>snapshot('idle')},storage());
 q.setUser('old');q.setVisible(true);q.setUser('new');
 try { await new Promise(r=>setTimeout(r,0));resolve({player_id:'old',rating:30000});await new Promise(r=>setTimeout(r,0));assert.equal(q.profile.player_id,'new');await q.refreshProfile();assert.equal(calls,2); }
 finally { q.dispose(); }
});

test('missing stats endpoint leaves the real rank intact without inventing a win rate', async () => {
 const q=new RankedQueue({profile:async()=>({player_id:'player',rating:20000,rated_matches:12}),stats:async()=>{throw Object.assign(new Error('Not migrated'),{code:'PGRST202'});},queue:async()=>snapshot('idle')},storage());
 q.setUser('player');q.setVisible(true);
 try { await new Promise(r=>setTimeout(r,0));assert.equal(q.profile.rating,20000);assert.equal(q.profileState,'ready');assert.equal(q.stats,null); }
 finally {q.dispose();}
});

test('completed matches return to the finder without a cancellation notice', async () => {
 let state='matched',lookups=0;
 const api={queue:async()=>({...snapshot(state),match:state==='matched'?{id:'finished-match'}:undefined}),resultStatus:async match=>{assert.equal(match,'finished-match');lookups++;return {status:'completed'};}};
 const q=new RankedQueue(api,storage());q.setUser('player');
 try{await q.act('join');state='idle';await q.act('poll');assert.equal(q.notice,'');assert.equal(q.active,false);await q.act('poll');assert.equal(lookups,1);}finally{q.dispose();}
});

test('all accepted remains observable before entering the draft; stale account timers are cancelled',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let status='reserved';const api={queue:async()=>({...info,state:'matched',match:{id:'match',status,self:'self',players:[{id:'self',accepted:true},{id:'other',accepted:status==='drafting'}]}})};
 const q=new RankedQueue(api,storage());q.setUser('self');
 try{await q.act('poll');assert.equal(q.confirmingAcceptance,false);status='drafting';await q.act('poll');assert.equal(q.confirmingAcceptance,true);assert.ok(q.snapshot.match.players.every(p=>p.accepted));t.mock.timers.tick(649);assert.equal(q.confirmingAcceptance,true);t.mock.timers.tick(1);assert.equal(q.confirmingAcceptance,false);
 status='reserved';await q.act('poll');status='drafting';await q.act('poll');q.setUser('new');assert.equal(q.confirmingAcceptance,false);t.mock.timers.tick(1000);assert.equal(q.snapshot,null);
 }finally{q.dispose();t.mock.timers.reset();}
});

test('a click during background polling is queued once instead of discarded',async()=>{
 let finish;const calls=[];const q=new RankedQueue({queue:async action=>{calls.push(action);if(action==='poll')return new Promise(r=>finish=r);return snapshot('queued');}},storage());q.setUser('player');
 try{const poll=q.refresh();assert.equal(q.busy,false);const join=q.act('join');assert.equal(q.busy,true);await q.act('join');finish(snapshot('idle'));await poll;await join;assert.deepEqual(calls,['poll','join']);assert.equal(q.active,true);}finally{q.dispose();}
});
test('account change cancels a click queued behind a background poll',async()=>{
 let finish;const calls=[];const q=new RankedQueue({queue:async action=>{calls.push(action);return new Promise(r=>finish=r);}},storage());q.setUser('old');
 try{const poll=q.refresh(),join=q.act('join');q.setUser('new');finish(snapshot('idle'));await poll;await join;assert.deepEqual(calls,['poll']);assert.equal(q.active,false);}finally{q.dispose();}
});
