import test from 'node:test';
import assert from 'node:assert/strict';
import {RankedSettlement} from '../src/ranked-settlement.ts';
import {verifyOwnFinishes} from '../src/ranked-transcript.ts';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
const transcript={schema:1,match:'match',launch:'launch',order:['track'],rounds:[{round:1,track:'track',finishes:[{player:'self',frames:1000},{player:'peer',frames:1200}]}]};
test('host cannot replace a local finish or invent a finish for an absent player',()=>{
 verifyOwnFinishes(transcript,'self',{'1:track':1000});
 assert.throws(()=>verifyOwnFinishes(transcript,'self',{}),/recorded finish/);
 assert.throws(()=>verifyOwnFinishes(transcript,'self',{'1:track':999}),/recorded finish/);
 const changed=structuredClone(transcript);changed.rounds[0].finishes[0].frames=null;
 assert.throws(()=>verifyOwnFinishes(changed,'self',{'1:track':1000}),/omitted/);
 verifyOwnFinishes(changed,'self',{});
});
test('lost responses survive restart and retry identical evidence without duplicate effects',async()=>{
 const disk=storage(),seen=[],rows=new Set();let lost=true,refreshed=0;
 const api={submitResult:async(match,instance,evidence)=>{seen.push(structuredClone(evidence));rows.add(match);if(lost){lost=false;throw Error('Response lost');}return 'completed';}};
 const first=new RankedSettlement(api,()=> 'self',disk,()=>refreshed++);
 first.enqueue({player:'self',instance:'instance',transcript});await new Promise(r=>setImmediate(r));
 assert.ok(disk.getItem('polycup.ranked.outbox.v1').includes('match'));assert.equal(rows.size,1);
 const resumed=new RankedSettlement(api,()=> 'self',disk,()=>refreshed++);await resumed.flush();
 assert.deepEqual(seen,[transcript,transcript]);assert.equal(rows.size,1);assert.equal(refreshed,1);assert.equal(disk.getItem('polycup.ranked.outbox.v1'),'[]');
});
test('account changes cannot send or remove another player’s queued evidence',async()=>{
 const disk=storage();let calls=0;
 disk.setItem('polycup.ranked.outbox.v1',JSON.stringify([{player:'self',instance:'instance',transcript}]));
 await new RankedSettlement({submitResult:async()=>{calls++;return 'completed';}},()=> 'other',disk,()=>{}).flush();
 assert.equal(calls,0);assert.ok(disk.getItem('polycup.ranked.outbox.v1').includes('match'));
});
