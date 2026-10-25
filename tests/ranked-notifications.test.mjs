import test from 'node:test';
import assert from 'node:assert/strict';
import {RankedNotifications} from '../src/ranked-notifications.ts';
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
const drain=()=>new Promise(r=>setTimeout(r,0));
test('loading does not acknowledge; a rendered result survives a lost acknowledgement and restart',async()=>{
 const store=storage();let reject=true,acks=0,shows=0;
 const api={claimResult:async()=> 'match',seenResult:async()=>{acks++;if(reject)throw Error('offline');}};
 const first=new RankedNotifications(api,()=> 'alice',store,()=>true,()=>shows++);
 await first.tick();assert.equal(shows,1);assert.equal(acks,0);
 first.seen('match','alice');await drain();assert.equal(acks,1);
 const second=new RankedNotifications(api,()=> 'alice',store,()=>true,()=>shows++);
 assert.equal(second.owner,first.owner);assert.equal(await second.claim('match','alice'),false);
 await second.tick();assert.equal(shows,1);assert.equal(acks,2);
 reject=false;api.claimResult=async()=>null;second.wake();await drain();assert.equal(acks,3);assert.equal(shows,1);
});
test('a lost response after committed acknowledgement retries idempotently without redisplaying',async()=>{
 let seen=false,fail=true,shows=0;const store=storage();
 const api={claimResult:async()=>seen?null:'match',seenResult:async()=>{seen=true;if(fail){fail=false;throw Error('response lost');}}};
 const n=new RankedNotifications(api,()=> 'alice',store,()=>true,()=>shows++);
 await n.tick();n.seen('match','alice');await drain();
 const restarted=new RankedNotifications(api,()=> 'alice',store,()=>true,()=>shows++);await restarted.tick();assert.equal(shows,1);
});
test('account changes fence delayed delivery and do not acknowledge another account receipt',async()=>{
 let user='alice',resolve;const claims=new Promise(r=>resolve=r),acked=[],shown=[];const store=storage();
 store.setItem('polycup.ranked.seen-pending.v1',JSON.stringify([{player:'alice',match:'old'}]));
 const n=new RankedNotifications({claimResult:()=>claims,seenResult:async m=>acked.push([user,m])},()=>user,store,()=>true,(m,p)=>shown.push([m,p]));
 user='bob';const pending=n.tick();user='charlie';resolve('bob-match');await pending;assert.deepEqual(shown,[]);assert.deepEqual(acked,[]);
 n.seen('bob-match','bob');assert.equal(JSON.parse(store.getItem('polycup.ranked.seen-pending.v1')).length,1);
});
test('inbox reads are bounded and wait until safe to show; saved before-profile is account-bound',async()=>{
 let safe=false,calls=0,shown;const store=storage(),profile={player_id:'alice',rating:19900};
 const n=new RankedNotifications({claimResult:async()=>{calls++;return 'match';},seenResult:async()=>{}},()=> 'alice',store,()=>safe,(...args)=>shown=args);
 n.rememberBefore('match','alice',profile);await n.tick();assert.equal(calls,0);
 safe=true;n.wake();await drain();assert.equal(calls,1);assert.deepEqual(shown,['match','alice',profile]);
 await n.tick();await n.tick();assert.equal(calls,1);
});

test('dismissing an unread or unavailable popup defers it until the next explicit wake',async()=>{
 let shown=0;const n=new RankedNotifications({claimResult:async()=> 'match',seenResult:async()=>{}},()=> 'alice',storage(),()=>true,()=>shown++);
 await n.tick();assert.equal(shown,1);n.snooze();await n.tick();assert.equal(shown,1);n.wake();await drain();assert.equal(shown,2);
});
