import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import { validSnapshot } from '../.research/test-src/validation.ts';
import { Controller } from '../.research/test-src/controller.ts';
import { playerRecord } from '../.research/test-src/standings.ts';
const track='a'.repeat(64);
function race(){const s=Cup.newCup();for(const id of [1,2,3]){Cup.addPlayer(s,id,`P${id}`);Cup.chooseTrack(s,id,{id:track,name:'Track'});}Cup.lockRegistration(s);Cup.beginRound(s);s.phase='countdown';s.runtime.sessionId=7;
 s.records[track]={pbs:{1:{status:'ready',frames:13000,source:'online'},2:{status:'unavailable'},3:{status:'missing'}},wr:{status:'ready',frames:10000,name:'Holder'},tr:{frames:11000,ids:[1]}};Cup.startRace(s,0);return s;}
test('record badges use pre-race PBs and select WR over TR over PB',()=>{
 const s=race();s.records[track].pbs[1]={status:'ready',frames:12000,source:'online'};
 assert.ok(Cup.recordFinish(s,1,12000,12000));assert.equal(s.runtime.recordAwards[1],'PB');
 assert.ok(Cup.recordFinish(s,2,10500,12500));assert.equal(s.runtime.recordAwards[2],'TR');
 assert.ok(Cup.recordFinish(s,3,9000,12600));assert.equal(s.runtime.recordAwards[3],'WR');
 assert.ok(validSnapshot(Cup.publicState(s)));
 Cup.completeRound(s);assert.deepEqual(s.matches[0].roundsLog[0].recordAwards,{1:'PB',3:'WR'});
 Cup.rebindPlayer(s,1,10,'Returned');assert.equal(s.matches[0].roundsLog[0].recordAwards[10],'PB');assert.ok(validSnapshot(Cup.publicState(s)));
});
test('ties, unknown records, late invalid finishes and slower subsequent records do not claim improvements',()=>{
 const s=race();assert.ok(Cup.recordFinish(s,1,10000,10000));assert.equal(s.runtime.recordAwards[1],'TR');
 assert.ok(Cup.recordFinish(s,2,10000,11000));assert.equal(s.runtime.recordAwards[2],undefined);
 assert.equal(Cup.recordFinish(s,3,999999,12000),false);assert.equal(s.runtime.recordAwards[3],undefined);
 s.runtime.recordAwards[2]='FAKE';assert.equal(validSnapshot(Cup.publicState(s)),false);
});

test('the first track record follows the fastest finish and replaces provisional record badges',()=>{
 const s=race();delete s.runtime.recordBaselines.tr;
 Cup.recordFinish(s,1,12000,12000);assert.equal(s.runtime.recordAwards[1],'TR');
 Cup.recordFinish(s,2,11000,12500);
 assert.deepEqual(s.runtime.recordAwards,{1:'PB',2:'TR'});
 Cup.recordFinish(s,3,9000,13000);
 assert.deepEqual(s.runtime.recordAwards,{1:'PB',3:'WR'},'only the fastest report keeps a global record badge; unknown PBs stay unknown');
 assert.ok(validSnapshot(Cup.publicState(s)));
 Cup.completeRound(s);assert.deepEqual(s.matches[0].roundsLog[0].recordAwards,{1:'PB',3:'WR'});
});

test('a delayed faster world record supersedes an earlier WR, while a tie does not duplicate it',()=>{
 const s=race();s.runtime.recordBaselines.pbs[2]=12000;
 Cup.recordFinish(s,1,9500,10000);assert.equal(s.runtime.recordAwards[1],'WR');
 Cup.recordFinish(s,2,9000,11000);assert.deepEqual(s.runtime.recordAwards,{1:'PB',2:'WR'});
 Cup.recordFinish(s,3,9000,12000);assert.deepEqual(s.runtime.recordAwards,{1:'PB',2:'WR',3:'PB'});
 assert.equal(Cup.recordFinish(s,1,8500,12000),false);
 assert.deepEqual(s.runtime.recordAwards,{1:'PB',2:'WR',3:'PB'});
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


test('Cup PB survives slower rounds, stale native PB polls, compact snapshots, and reconnect',()=>{
 const s=race();s.records[track].pbs[1]={status:'ready',frames:70431,source:'profile'};s.records[track].tr={frames:26000,ids:[2]};s.phase='countdown';Cup.startRace(s,0);
 Cup.recordFinish(s,1,27346,30000);assert.equal(s.runtime.recordAwards[1],'PB');assert.equal(playerRecord(s,track,1).frames,27346,'Tab updates on the live finish');Cup.completeRound(s);
 const c=new Controller(()=>{});c.state=s;c.isHost=true;c.broadcast=()=>{};
 c.receivePB(1,{type:'pb',cupId:s.id,trackId:track,pb:{status:'ready',frames:70431,source:'profile'}});
 Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);assert.equal(s.runtime.recordBaselines.pbs[1],27346);
 Cup.recordFinish(s,1,27393,30000);assert.equal(s.runtime.recordAwards?.[1],undefined);assert.equal(playerRecord(s,track,1).frames,27346);Cup.completeRound(s);
 const compact=c.networkState();assert.equal(compact.matches[0].roundsLog.length,1);assert.equal(compact.records[track].cupPbs[1],27346);assert.equal(playerRecord(compact,track,1).frames,27346);assert.ok(validSnapshot(compact));
 Cup.rebindPlayer(s,1,10,'Returned');assert.equal(playerRecord(s,track,10).frames,27346);assert.equal(s.records[track].cupPbs[1],undefined);
 Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);Cup.recordFinish(s,10,27200,30000);assert.ok(s.runtime.recordAwards[10]);assert.equal(playerRecord(s,track,10).frames,27200);
 Cup.voidRound(s);assert.equal(playerRecord(s,track,10).frames,27346,'voided live finish is not retained');
 Cup.undoRound(s);assert.equal(playerRecord(s,track,10).frames,27346);Cup.undoRound(s);assert.equal(playerRecord(s,track,10).frames,70431,'undo restores pre-Cup best');
});

test('PBs remain track-specific on return visits and a faster online PB still wins',()=>{
 const other='b'.repeat(64),s=Cup.newCup();for(const [id,t]of [[1,track],[2,other]]){Cup.addPlayer(s,id,'P'+id);Cup.chooseTrack(s,id,{id:t,name:t===track?'A':'B'});}Cup.lockRegistration(s,()=>.999);
 s.records[track]={pbs:{1:{status:'missing'}}};s.records[other]={pbs:{1:{status:'ready',frames:50000,source:'online'}}};
 for(let i=0;i<8;i++){Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);const time=i<4?27000+i:40000+i;Cup.recordFinish(s,1,time,60000);Cup.completeRound(s);}
 Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);assert.equal(s.runtime.trackId,track);assert.equal(s.runtime.recordBaselines.pbs[1],27000);assert.equal(playerRecord(s,other,1).frames,40004);
 Cup.recordFinish(s,1,28000,60000);assert.equal(s.runtime.recordAwards?.[1],undefined);s.records[track].pbs[1]={status:'ready',frames:26000,source:'online'};assert.equal(playerRecord(s,track,1).frames,26000);
 const snapshot=Cup.publicState(s);snapshot.records[track].cupPbs[1]=-1;assert.equal(validSnapshot(snapshot),false);
});
