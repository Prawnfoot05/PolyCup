import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import { ReviewLog, compareRuns, evidenceStatus, REVIEW_LIMITS } from '../.research/test-src/review.ts';
import { InputCapture, InputTimeline, inputMask, inputControls } from '../.research/test-src/inputs.ts';
import { Controller } from '../.research/test-src/controller.ts';
const track={id:'a'.repeat(64),name:'Circuit'};
const events=Array.from({length:17},(_,i)=>[i*800,[1,3,1,9][i%4]]);
function race() {
  const s=Cup.newCup();for(const id of [1,2]) {Cup.addPlayer(s,id,`P${id}`);Cup.chooseTrack(s,id,track);}
  Cup.lockRegistration(s);Cup.beginRound(s);s.runtime.sessionId=9;s.phase='countdown';Cup.startRace(s,0);return s;
}
function record(log,s,input=events,finish=15000) {
  log.begin(s,5);
  for(let i=0;i<4;i++) log.checkpoint(s.runtime.id,1,i,(i+1)*2500);
  if(input) log.inputs(s.runtime.id,1,{seq:0,through:finish,events:input,gap:false});
  s.runtime.finishes[1]=finish;log.close(s);
  const result=log.current(s.runtime.id,1);Cup.completeRound(s);Cup.beginRound(s);s.runtime.sessionId=9;s.phase='countdown';Cup.startRace(s,0);return result;
}
test('complex whole-run repeats flag only same racer and track; simple runs and human variation do not', () => {
  const s=race(),log=new ReviewLog(s.id),a=record(log,s),b=record(log,s);
  assert.equal(a.flag,null);assert.equal(b.flag.kind,'inputs');assert.equal(b.flag.transitions,16);
  assert.equal(compareRuns(b,{...a,racerKey:'different'}),null);assert.equal(compareRuns(b,{...a,trackId:'b'.repeat(64)}),null);
  assert.equal(compareRuns({...b,finish:9000},a),null);
  const varied=events.map(([f,m],i)=>[f+(i%3)*40,m]);
  assert.equal(record(log,s,varied,15120).flag,null);
  const simpleLog=new ReviewLog(s.id);for(let i=0;i<4;i++)assert.equal(record(simpleLog,s,[[0,1]]).flag,null);
});
test('checkpoint-only flags require three exact whole runs and keep missing input evidence explicit', () => {
  const s=race(),log=new ReviewLog(s.id);
  assert.equal(record(log,s,null).flag,null);assert.equal(record(log,s,null).flag,null);
  const r=record(log,s,null);assert.equal(r.flag.kind,'checkpoints');assert.equal(r.flag.repeats,3);assert.equal(evidenceStatus(r),'No input data');
  log.undo(r.round,r.trackId);assert.equal(r.flag,null);assert.equal(r.outcome,'undone');
});
test('voided, undone and interrupted rounds stay in private evidence but cannot contribute to repeat flags', () => {
  const s=race(),log=new ReviewLog(s.id),a=record(log,s);
  const b=record(log,s);assert.ok(b.flag);log.undo(a.round,a.trackId);assert.equal(b.flag,null);
  log.begin(s,5);const run=log.current(s.runtime.id,1);log.close(s,'void');assert.equal(run.outcome,'void');
  assert.equal(compareRuns({...a,outcome:'interrupted'},b),null);
});
test('review restore validates bounded evidence, recalculates flags and preserves identity across rebind', () => {
  const s=race(),log=new ReviewLog(s.id);record(log,s);const b=record(log,s);log.markReviewed(b.id,true);
  const data=structuredClone(log.data());data.runs[0].flag={kind:'invented'};const restored=ReviewLog.restore(data,s);
  assert.equal(restored.runs[0].flag,null);assert.equal(restored.runs.find(r=>r.id===b.id).reviewed,true);
  const key=restored.identities[1];restored.rebind(1,10);assert.equal(restored.identities[10],key);assert.equal(restored.identities[1],undefined);
  for(const alter of [d=>d.runs[0].inputs.push([100,99]),d=>d.runs[0].trackId='b'.repeat(64),d=>d.runs[0].racerKey='fake',
    d=>d.runs[0].checkpoints[1]=[0,5000],d=>d.identities[3]=d.identities[1]]) {
    const d=structuredClone(data);alter(d);assert.throws(()=>ReviewLog.restore(d,s));
  }
});
test('missing sequence coverage and truncation label evidence partial; retention is bounded', () => {
  const s=race(),log=new ReviewLog(s.id);log.begin(s,5);
  log.inputs(s.runtime.id,1,{seq:1,through:15000,events,gap:false});s.runtime.finishes[1]=15000;log.close(s);
  assert.equal(evidenceStatus(log.current(s.runtime.id,1)),'Partial input data');
  const template=log.runs[0];log.runs=Array.from({length:270},(_,i)=>({...structuredClone(template),id:String(i)}));
  log.trim();assert.equal(log.runs.length,REVIEW_LIMITS.runs);assert.equal(log.dropped,14);
  assert.ok(JSON.stringify(log.data()).length<=REVIEW_LIMITS.bytes);
});
test('capture records only driving changes, retains unsent data, and starts a new warmup attempt after reset', () => {
  assert.equal(inputMask({up:true,left:true,text:'private'}),9);assert.deepEqual(inputControls(9),{up:true,left:true,down:false,right:false,reset:false});
  const c=new InputCapture({stage:'warmup'});c.capture(0,1);c.capture(20,1);c.capture(40,3);
  assert.equal(c.flush(()=>false),false);assert.deepEqual(c.events,[[0,1],[40,3]]);
  let packet;c.flush(m=>{packet=structuredClone(m);return true;});assert.equal(packet.seq,0);assert.equal(packet.through,40);
  c.capture(0,9);c.flush(m=>{packet=m;return true;});assert.equal(packet.attempt,1);assert.deepEqual(packet.events,[[0,9]]);
  const r=new InputCapture({stage:'race'});r.capture(50,1);r.capture(0,9);assert.equal(r.gap,true);assert.equal(r.attempt,0);
});
test('spectator keys use buffered car time and clear when telemetry is stale or not available yet', () => {
  const t=new InputTimeline();t.push([[0,1],[100,3],[200,9]],300,1000);
  assert.equal(t.sample(150,1100),3);assert.equal(t.sample(250,1100),9);assert.equal(t.sample(350,1100),null);
  assert.equal(t.sample(150,2600),null);assert.equal(t.push([[400,99]],400,1200),false);
});
function host() {
  const c=new Controller(()=>{});c.state=race();c.isHost=true;c.selfId=1;c.connection={};c.game={};
  c.info={sessionId:9,checkpointCount:5};c.hello.add(2);c.now=()=>15000;c.broadcast=()=>{};c.transport.send=()=>true;
  c.lobby=[1,2,3].map(id=>({id,nickname:`P${id}`}));return c;
}
function packet(c,extra={}) {return {type:'inputs',...c.inputContext(),seq:0,attempt:0,through:15000,events,gap:false,...extra};}
test('input relay binds sender, Cup, round, session and sequence; archives never enter public snapshots', () => {
  const c=host(),sent=[];c.subscriptions.set(3,2);c.subscriptions.set(1,2);c.transport.send=(id,m)=>{sent.push([id,m]);return true;};
  for(const m of [packet(c,{cupId:'old'}),packet(c,{sessionId:8}),packet(c,{through:999999}),packet(c,{events:[[0,99]]}),packet(c,{attempt:1})])
    assert.equal(c.receiveInputs(2,m),false);
  assert.equal(c.receiveInputs(3,packet(c)),false);
  assert.equal(c.receiveInputs(2,packet(c)),true);assert.equal(c.receiveInputs(2,packet(c)),false);
  assert.deepEqual(sent.map(([id])=>id),[3]);assert.equal(sent[0][1].type,'input-view');assert.equal('review' in sent[0][1],false);
  assert.equal(c.receiveInputs(2,packet(c,{seq:1,through:14000})),false);
  assert.equal('review' in c.networkState(),false);assert.equal('inputs' in c.networkState(),false);
  assert.ok(c.saveData().review);c.isHost=false;assert.equal('review' in c.saveData(),false);
});
test('warmup resets recover the selected input stream and practice is never added to the review log', () => {
  const c=host();c.state.phase='warmup';assert.ok(c.receiveInputs(2,packet(c)));
  assert.ok(c.receiveInputs(2,packet(c,{seq:1,attempt:1,through:10,events:[[0,9]]})));
  assert.equal(c.liveInputs.get(2).sample(5,c.now()),9);assert.equal(c.review.runs.length,0);
  assert.equal(c.receiveInputs(2,packet(c,{seq:2,attempt:0})),false);
});
test('a guest spectator receives live selected inputs only, and switching racers cannot reuse old keys', () => {
  const c=host(),guest=new Controller(()=>{});guest.selfId=3;guest.state=structuredClone(c.state);guest.info=c.info;
  guest.now=c.now;guest.lobby=c.lobby;guest.watchId=2;guest.watchedPose={frames:10000};
  c.subscriptions.set(3,2);c.transport.send=(id,m)=>{assert.equal(id,3);guest.receive(0,m);return true;};
  assert.ok(c.receiveInputs(2,packet(c)));assert.equal(guest.watchedInputs(),events.filter(e=>e[0]<=10000).at(-1)[1]);
  assert.equal(guest.review.runs.length,0);assert.equal(guest.review.identities[2],undefined);
  guest.selectWatch(1);guest.watchedPose={frames:10000};assert.equal(guest.watchedInputs(),null);
  guest.receiveInputView(4,{...packet(c),type:'input-view',racerId:1});assert.equal(guest.watchedInputs(),null);
  guest.receiveInputView(0,{...packet(c),type:'input-view',racerId:2});assert.equal(guest.watchedInputs(),null);
  guest.receiveInputView(0,{...packet(c),type:'input-view',racerId:1});assert.notEqual(guest.watchedInputs(),null);
});
test('native finish flushes final input coverage before scoring and a reviewed Cup saves/restores without public leakage', () => {
  const c=host();let finish;c.native={readInputs:()=>({frames:0,controls:{up:true}})};
  c.captureInputs();c.native.readInputs=()=>({frames:15000,controls:{up:true,right:true}});
  c.hookFinish({addCheckpointCallback(){},addFinishCallback(fn){finish=fn;},getTime:()=>({numberOfFrames:15000})},c.state.runtime);
  finish();assert.equal(c.review.current(c.state.runtime.id,1).through,15000);assert.equal(c.state.runtime.finishes[1],15000);
  c.change(Cup.completeRound);assert.equal(c.review.runs[0].outcome,'finished');assert.equal(c.review.runs[0].gap,false);
  const save=JSON.stringify(c.saveData());c.native.parse=()=>({trackData:{getId:()=>track.id,hasStartingPoint:()=>true}});
  const data=JSON.parse(save);data.tracks=[{id:track.id,code:'native fixture'}];c.restore(JSON.stringify(data));
  assert.equal(c.review.runs[0].outcome,'finished');assert.ok(c.review.identities[-1]);assert.equal('review' in c.networkState(),false);
});
