import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import { validSnapshot } from '../.research/test-src/validation.ts';
import { Controller } from '../.research/test-src/controller.ts';
const track='a'.repeat(64);
function race(){const s=Cup.newCup();for(const id of [1,2,3]){Cup.addPlayer(s,id,`P${id}`);Cup.chooseTrack(s,id,{id:track,name:'Track'});}Cup.lockRegistration(s);Cup.beginRound(s);s.phase='countdown';s.runtime.sessionId=7;
 s.records[track]={pbs:{1:{status:'ready',frames:13000,source:'online'},2:{status:'unavailable'},3:{status:'missing'}},wr:{status:'ready',frames:10000,name:'Holder'},tr:{frames:11000,ids:[1]}};Cup.startRace(s,0);return s;}
test('record badges use pre-race PBs and select WR over TR over PB',()=>{
 const s=race();s.records[track].pbs[1]={status:'ready',frames:12000,source:'online'};
 assert.ok(Cup.recordFinish(s,1,12000,12000));assert.equal(s.runtime.recordAwards[1],'PB');
 assert.ok(Cup.recordFinish(s,2,10500,12500));assert.equal(s.runtime.recordAwards[2],'TR');
 assert.ok(Cup.recordFinish(s,3,9000,12600));assert.equal(s.runtime.recordAwards[3],'WR');
 assert.ok(validSnapshot(Cup.publicState(s)));
 Cup.completeRound(s);assert.deepEqual(s.matches[0].roundsLog[0].recordAwards,{1:'PB',2:'TR',3:'WR'});
 Cup.rebindPlayer(s,1,10,'Returned');assert.equal(s.matches[0].roundsLog[0].recordAwards[10],'PB');assert.ok(validSnapshot(Cup.publicState(s)));
});
test('ties, unknown records, late invalid finishes and slower subsequent records do not claim improvements',()=>{
 const s=race();assert.ok(Cup.recordFinish(s,1,10000,10000));assert.equal(s.runtime.recordAwards[1],'TR');
 assert.ok(Cup.recordFinish(s,2,10000,11000));assert.equal(s.runtime.recordAwards[2],undefined);
 assert.equal(Cup.recordFinish(s,3,999999,12000),false);assert.equal(s.runtime.recordAwards[3],undefined);
 s.runtime.recordAwards[2]='FAKE';assert.equal(validSnapshot(Cup.publicState(s)),false);
});
test('a missing PB can become a first PB, while an unavailable PB is not guessed',()=>{
 const s=race();s.runtime.recordBaselines.tr=5000;s.runtime.recordBaselines.wr=4000;
 Cup.recordFinish(s,2,6000,10000);assert.equal(s.runtime.recordAwards?.[2],undefined);
 Cup.recordFinish(s,3,7000,11000);assert.equal(s.runtime.recordAwards[3],'PB');
 Cup.voidRound(s);assert.equal(s.runtime,null);
});
test('host kicking uses native disconnect, removes the slot immediately, and cannot be invoked by a guest or against self',()=>{
 const c=new Controller(()=>{}),kicked=[];c.state=race();c.isHost=true;c.selfId=1;c.lobby=[1,2,3].map(id=>({id,nickname:`P${id}`,isSelf:id===1}));
 c.connection={kickPlayer:id=>kicked.push(id),getPing:id=>id===1?0:id===2?205.7:null};c.broadcast=()=>{};
 assert.equal(c.ping(2),206);assert.equal(c.ping(8),null);assert.equal(c.ping(3),null);
 assert.throws(()=>c.kickPlayer(1),/another/);c.isHost=false;assert.throws(()=>c.kickPlayer(2));c.isHost=true;
 c.kickPlayer(2);assert.deepEqual(kicked,[2]);assert.ok(c.state.withdrawn.includes(2));assert.ok(c.state.runtime.dnfs.includes(2));assert.ok(!Cup.activeIds(c.state).includes(2));
});
