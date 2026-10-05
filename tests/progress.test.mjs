import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../src/cup.mjs';
import { CheckpointProgress } from '../src/progress.mjs';
import { standings, updateLiveMovement, sessionRecord } from '../src/standings.mjs';
import { Controller, validSnapshot } from '../src/controller.mjs';

const trackId = 'a'.repeat(64);
function race() {
  const s = Cup.newCup();
  for (const id of [1,2,3]) { Cup.addPlayer(s,id,`Racer ${id}`); Cup.chooseTrack(s,id,{id:trackId,name:'Track'}); }
  Cup.lockRegistration(s); Cup.beginRound(s); s.runtime.sessionId=9; s.phase='countdown'; Cup.startRace(s,0); return s;
}
const order = s => standings(s).map(r=>r.id);
const row = (s,id) => standings(s).find(r=>r.id===id);

test('checkpoint ranking uses cumulative times and compares gaps only at matching checkpoints', () => {
  const s=race(), p=new CheckpointProgress();
  const pass=(id,index,frames)=>assert.equal(p.record(s,id,index,frames,60000,5),true);
  pass(2,0,10000); assert.deepEqual(order(s),[2,1,3]);
  assert.equal(row(s,2).movement,1); assert.equal(row(s,1).movement,-1);
  pass(1,0,10320); assert.equal(row(s,1).delta,320); assert.equal(row(s,2).splitFrames,10000);
  pass(2,1,24500); assert.equal(row(s,2).splitFrames,24500,'cumulative, not 14500 segment time');
  assert.equal(row(s,1).delta,320,'do not compare a first checkpoint to the leader second checkpoint');
  pass(3,0,11000); assert.equal(row(s,3).delta,1000,'older checkpoint reference survives the leader advancing');
  pass(1,1,24300); assert.deepEqual(order(s),[1,2,3]);
  assert.equal(row(s,1).delta,0); assert.equal(row(s,2).delta,200);
  assert.equal(row(s,1).movement,1); assert.equal(row(s,2).movement,-1);
  pass(3,2,30000); assert.deepEqual(order(s),[3,1,2],'further progress beats faster earlier times');
  assert.equal(row(s,3).movement,2);
  assert.deepEqual(s.matches[0].scores,{1:0,2:0,3:0});
  assert.equal(standings(s).some(r=>r.gain),false); assert.equal(sessionRecord(s,trackId),null);
});

test('a delayed faster cumulative reading corrects gaps and equal times keep a stable display order', () => {
  const s=race(), p=new CheckpointProgress();
  p.record(s,2,0,10320,30000,5); p.record(s,3,0,10500,30000,5); p.record(s,1,0,10000,30000,5);
  assert.deepEqual(order(s),[1,2,3]); assert.equal(row(s,2).delta,320); assert.equal(row(s,3).delta,500);
  p.record(s,3,1,24500,30000,5); p.record(s,2,1,24500,30000,5);
  assert.deepEqual(order(s),[2,3,1]); assert.equal(row(s,3).delta,0);
  assert.deepEqual(order(structuredClone(s)),order(s));
});

test('finishes replace checkpoint readings, DNF goes last, and only finish results award points', () => {
  const s=race(),p=new CheckpointProgress();
  p.record(s,1,2,20000,60000,5); p.record(s,2,1,21000,60000,5);
  let before=order(s); Cup.recordFinish(s,3,25000,30000); updateLiveMovement(s,before);
  assert.deepEqual(order(s),[3,1,2]); assert.equal(row(s,3).frames,25000); assert.equal(row(s,3).movement,2);
  before=order(s); Cup.markDNF(s,1); updateLiveMovement(s,before);
  assert.deepEqual(order(s),[3,2,1]); assert.equal(row(s,1).dnf,true); assert.equal(row(s,1).gain,0);
  Cup.recordFinish(s,2,25320,30000); assert.equal(row(s,2).delta,320);
  Cup.completeRound(s); assert.deepEqual(s.matches[0].scores,{1:0,2:8,3:10});
  assert.equal(sessionRecord(s,trackId).frames,25000);
  Cup.beginRound(s); assert.deepEqual(s.runtime.splits,{}); assert.deepEqual(s.runtime.liveMovement,{});
  s.phase='countdown'; Cup.startRace(s,0); p.record(s,2,0,12000,30000,5);
  assert.equal(row(s,2).delta,0,'previous round references cleared');
  Cup.voidRound(s); assert.equal(s.runtime,null);
});

test('reject malformed, duplicate, regressive, future, expired and non-racer checkpoint reports', () => {
  const s=race(),p=new CheckpointProgress();
  for(const [id,index,frames,count] of [[4,0,1000,5],[1,-1,1000,5],[1,4,1000,5],[1,0.5,1000,5],
    [1,0,0,5],[1,0,-1,5],[1,0,1.5,5],[1,0,NaN,5],[1,0,Infinity,5],[1,0,3600001,5],
    [1,0,33000,5],[1,0,1000,undefined],[1,0,1000,1]]) assert.equal(p.record(s,id,index,frames,30000,count),false);
  for(const phase of ['loading','warmup','countdown','between-rounds','complete']) {
    s.phase=phase; assert.equal(p.record(s,1,0,1000,30000,5),false);
  }
  s.phase='racing'; assert.equal(p.record(s,1,1,15000,30000,5),true);
  for(const [index,frames] of [[0,10000],[1,15001],[2,14999]]) assert.equal(p.record(s,1,index,frames,30000,5),false);
  Cup.markDNF(s,1); assert.equal(p.record(s,1,2,20000,30000,5),false);
  Cup.recordFinish(s,2,20000,30000); assert.equal(p.record(s,2,2,21000,30000,5),false);
  assert.equal(p.record(s,3,2,s.runtime.deadline+1,s.runtime.deadline+1,5),false);
  assert.equal(p.record(s,3,2,22000,s.runtime.deadline+1501,5),false);
});

test('snapshots bound live data to the roster and validate cumulative readings and movement', () => {
  const s=race(),p=new CheckpointProgress(); p.record(s,2,0,10320,30000,5);
  assert.equal(validSnapshot(Cup.publicState(s)),true);
  const older=structuredClone(s); delete older.runtime.splits; delete older.runtime.liveMovement; assert.equal(validSnapshot(older),true);
  for(const bad of [null,[],{4:{index:0,frames:1,bestFrames:1}},{1:{index:-1,frames:1,bestFrames:1}},
    {1:{index:0,frames:3600001,bestFrames:1}},{1:{index:0,frames:1,bestFrames:2}},
    {1:{index:0,frames:1,bestFrames:0}},{1:{index:0.5,frames:1,bestFrames:1}}]) {
    const copy=structuredClone(s); copy.runtime.splits=bad; assert.equal(validSnapshot(copy),false);
  }
  for(const bad of [null,[],{4:1},{1:8},{1:0.5},{1:NaN}]) {
    const copy=structuredClone(s); copy.runtime.liveMovement=bad; assert.equal(validSnapshot(copy),false);
  }
  for(let cp=1;cp<200;cp++) for(const id of [1,2,3]) p.record(s,id,cp,11000+cp*100+id,60000,201);
  assert.equal(Object.keys(s.runtime.splits).length,3);
  assert.ok(JSON.stringify(s.runtime.splits).length<200,'only latest readings travel on the wire');
  assert.equal(validSnapshot(s),true);
});

test('native checkpoint events travel guest to organizer to spectators with round and actor identity checks', () => {
  const host=new Controller(()=>{}),guest=new Controller(()=>{}),observer=new Controller(()=>{});
  host.state=race();host.isHost=true;host.selfId=1;host.info={sessionId:9,checkpointCount:5};host.now=()=>30000;host.hello=new Set([2,3,4]);
  for(const c of [guest,observer]) {c.state=structuredClone(host.state);c.info={sessionId:9,checkpointCount:5};}
  guest.selfId=2;observer.selfId=4;let message;
  guest.transport.send=(id,m)=>{assert.equal(id,0);message=structuredClone(m);host.receive(2,m);return true;};
  host.transport.broadcast=m=>{for(const c of [guest,observer])c.receive(0,structuredClone(m));};
  let cpCallback,finishCallback,index=1,frames=10000;
  const car={addCheckpointCallback:f=>cpCallback=f,addFinishCallback:f=>finishCallback=f,
    getNextCheckpointIndex:()=>index,getTime:()=>({numberOfFrames:frames})};
  guest.hookFinish(car,guest.state.runtime); cpCallback(0);
  for(const c of [host,guest,observer]) {assert.deepEqual(order(c.state),[2,1,3]);assert.equal(row(c.state,2).splitFrames,10000);}
  const late=new Controller(()=>{});late.receive(0,host.syncMessage());assert.deepEqual(order(late.state),[2,1,3]);
  const unchanged=JSON.stringify(host.state);
  for(const patch of [{cupId:'old'},{roundId:'old'},{sessionId:8}]) host.receive(3,{...message,...patch});
  host.receive(99,{...message,id:1}); assert.equal(JSON.stringify(host.state),unchanged);
  host.receive(3,{...message,id:1,frames:10320}); assert.equal(row(host.state,3).delta,320);assert.equal(row(host.state,1).splitFrames,undefined);
  index=3;frames=24300;cpCallback(1);assert.equal(row(host.state,2).checkpoint,2,'current native index handles multi-checkpoint frames');
  index=5;frames=25000;cpCallback(3);assert.equal(row(host.state,2).checkpoint,2,'finish checkpoint is not a split');
  finishCallback();assert.equal(row(host.state,2).frames,25000);
  Cup.voidRound(host.state);Cup.beginRound(host.state);host.state.phase='countdown';Cup.startRace(host.state,0);
  host.transport.broadcast(host.syncMessage());const fresh=JSON.stringify(host.state);index=2;frames=15000;cpCallback(1);
  assert.equal(JSON.stringify(host.state),fresh,'old native car callback cannot leak into new round');
});
