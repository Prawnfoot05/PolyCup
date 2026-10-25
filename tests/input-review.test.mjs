import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {decodeRecording,normalize,compare,inspect,POLICY} from '../supabase/input-review/matcher.ts';
import {RankedInputOutbox} from '../src/ranked-inputs.ts';
export function encode(events){
 const bytes=[];const u24=n=>bytes.push(n&255,(n>>>8)&255,(n>>>16)&255);
 for(let bit=0;bit<5;bit++){const toggles=[];let mask=0;for(const [at,next] of events){if((mask&(1<<bit))!==(next&(1<<bit)))toggles.push(at);mask=next;}u24(toggles.length);toggles.forEach((at,i)=>u24(at-(toggles[i-1]??0)));}return deflateSync(Buffer.from(bytes)).toString('base64url');
}
export function varied(){let at=0;return Array.from({length:70},(_,i)=>{if(i)at+=180+(i*71)%391;return [at,[1,3,1,9,5,1,3,9][i%8]];});}
const events=varied(),run={events,finish:events.at(-1)[0]+700},ref={...run,id:'123',rank:1,track:'track',gameVersion:'0.6.3'};
test('native five-channel decoder preserves exact event times, including simultaneous changes',()=>{assert.deepEqual(decodeRecording(encode(events),run.finish),run);assert.throws(()=>decodeRecording('eA',run.finish));assert.throws(()=>decodeRecording('x'.repeat(131073),run.finish));assert.deepEqual(decodeRecording(encode([[0,1],[10,11],[20,16]]),30).events,[[0,1],[10,11],[20,16]]);});
test('whole runs and shifted exact segments match, simple throttle and repetitive input do not',()=>{
 assert.equal(compare(run,ref).kind,'whole');
 const sliced=events.slice(12,55).map(([at,mask])=>[at-events[12][0]+1200,mask]);const input={finish:sliced.at(-1)[0]+800,events:[[0,0],...sliced]};const found=compare(input,ref);assert.equal(found.kind,'segment');assert.equal(found.start,1200);assert.equal(found.referenceStart,events[12][0]);assert.equal(found.transitions,42);
 assert.equal(compare({events:[[0,1]],finish:30000},{...ref,events:[[0,1]],finish:30000}),null);
 const repetitive=events.map((e,i)=>[i*500,i%2?3:1]);assert.equal(compare({events:repetitive,finish:40000},{...ref,events:repetitive,finish:40000}),null);
});
test('comparison is exact, rejects incomplete/malformed evidence and binds track and version',()=>{
 const changed={...run,events:events.map(([at,mask],i)=>[at+i,mask])};assert.equal(compare(changed,ref),null);
 assert.deepEqual(inspect(run,'other','0.6.3',[ref]),[]);assert.deepEqual(inspect(run,'track','0.6.4',[ref]),[]);
 assert.throws(()=>normalize({events:[[1,1]],finish:100}));assert.throws(()=>normalize({events:[[0,32]],finish:100}));
 const redundant={...run,events:events.flatMap((e,i)=>i===events.length-1?[e]:[e,[e[0]+1,e[1]]])};assert.equal(compare(redundant,ref).kind,'whole');
 assert.equal(POLICY.transitions,24);
});
test('input outbox retries exact evidence after restart and isolates account changes',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let user='self',fail=true,calls=[];
 const api={inputReviewEnabled:async()=>true,submitInputRun:async(...args)=>{calls.push(args);if(fail)throw Error('Lost response');return true;}};
 const item={match:'match',player:'self',instance:'instance',run:{round:1,recording:'abc'}};
 new RankedInputOutbox(api,()=>user,storage).enqueue(item);await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
 user='other';const resumed=new RankedInputOutbox(api,()=>user,storage);await resumed.flush();assert.equal(calls.length,1);
 user='self';fail=false;await resumed.flush();assert.deepEqual(calls[0],calls[1]);await resumed.flush();assert.equal(calls.length,2);
});
test('one permanently rejected upload does not starve later evidence and false is not an acknowledgement',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},calls=[];
 let accept=false;const api={inputReviewEnabled:async()=>true,submitInputRun:async(m)=>{calls.push(m);if(m==='closed')throw Object.assign(Error('Window closed'),{code:'PC001'});return accept;}};
 const outbox=new RankedInputOutbox(api,()=> 'self',storage);
 outbox.enqueue({match:'closed',player:'self',instance:'one',run:{round:1}});await new Promise(r=>setImmediate(r));
 outbox.enqueue({match:'open',player:'self',instance:'two',run:{round:1}});await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,['closed','open']);assert.ok(values.get('polycup.ranked.inputs.pilot.v1').includes('open'));
 accept=true;await new RankedInputOutbox(api,()=> 'self',storage).flush();assert.equal(values.get('polycup.ranked.inputs.pilot.v1'),'[]');
});
test('account change during capability request cannot send the previous account evidence',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let player='self',release,calls=0;
 const api={inputReviewEnabled:()=>new Promise(r=>release=r),submitInputRun:async()=>{calls++;return true;}};
 new RankedInputOutbox(api,()=>player,storage).enqueue({match:'one',player:'self',instance:'one',run:{round:1}});player='other';release(true);await new Promise(r=>setImmediate(r));assert.equal(calls,0);
});

test('temporary capacity holds all uploads for five minutes and retains evidence across restart',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let full=true,calls=0;
 const api={inputReviewEnabled:async()=>true,submitInputRun:async()=>{calls++;if(full)throw Object.assign(Error('Capacity'),{code:'PC002'});return true;}};
 const outbox=new RankedInputOutbox(api,()=> 'self',storage);
 outbox.enqueue({match:'one',player:'self',instance:'one',run:{round:1}});await new Promise(r=>setImmediate(r));
 outbox.enqueue({match:'one',player:'self',instance:'one',run:{round:2}});await new Promise(r=>setImmediate(r));await outbox.flush();assert.equal(calls,1);assert.equal(JSON.parse(values.get('polycup.ranked.inputs.pilot.v1')).length,2);
 full=false;const restarted=new RankedInputOutbox(api,()=> 'self',storage);await restarted.flush();await restarted.flush();assert.equal(values.get('polycup.ranked.inputs.pilot.v1'),'[]');
});
