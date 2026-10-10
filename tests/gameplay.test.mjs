import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import { Controller } from '../.research/test-src/controller.ts';
import { HeldDrivingInputs } from '../.research/test-src/held-inputs.ts';
import { CameraBuffer } from '../.research/test-src/spectator.ts';
import { connectNative } from '../.research/test-src/native.ts';

const bindings={up:['ArrowUp','KeyW'],right:['ArrowRight','KeyD'],down:['ArrowDown','KeyS'],left:['ArrowLeft','KeyA']};
const key=(code,extra={})=>({code,composedPath:()=>[],...extra});
const trackId='a'.repeat(64);
function race() {
  const state=Cup.newCup();
  for(const id of [1,2,3]){Cup.addPlayer(state,id,`P${id}`);Cup.chooseTrack(state,id,{id:trackId,name:'Track'});}
  Cup.lockRegistration(state);Cup.beginRound(state);state.runtime.sessionId=9;state.phase='countdown';Cup.startRace(state,0);
  return state;
}
function car() {return {frames:0,checkpoint:0,starts:0,start(){this.starts++;},getTime(){return {numberOfFrames:this.frames};},
  getFinishTime:()=>null,getNextCheckpointIndex(){return this.checkpoint;},
  addCheckpointCallback(fn){this.onCheckpoint=fn;},addFinishCallback(fn){this.onFinish=fn;}};}
function racer() {
  const c=new Controller(()=>{});c.state=race();c.selfId=1;c.isHost=true;c.game={};
  c.lobby=[1,2,3].map(id=>({id,isSelf:id===1}));c.connection={getPlayers:()=>c.lobby};
  c.info={connection:c.connection,sessionId:9,spectator:{isEnabled:false},car:car(),checkpointCount:3};
  c.now=()=>0;c.broadcast=()=>{};c.save=()=>{};c.controls={up:false,right:false,down:false,left:false,reset:false};
  c.native={read:()=>c.info,reset:()=>{c.info.car=car();},clearRecords(){},release:()=>{c.info.spectator.isEnabled=false;},
    drivingBindings:()=>bindings,applyDrivingInput:(g,input)=>{c.controls={...input};},clearInput:()=>{c.controls={up:false,right:false,down:false,left:false,reset:false};},
    readInputs:()=>({frames:c.info.car.frames,controls:c.controls}),
    startRespawnPressed:(g,e)=>e.code==='KeyR'&&c.info.car.checkpoint===0&&!c.info.spectator.isEnabled};
  c.observeGame(c.game);
  c.now=()=>1000;
  return c;
}
const pose=(at,x=0)=>({sessionId:9,at,frames:at,position:[x,2,6],quaternion:[0,0,0,1],fov:75,speed:100,
  carPosition:[x,0,0],carQuaternion:[0,0,0,1],view:0});

test('held driving keys survive rebinding reads and release independently across two bindings',()=>{
  const held=new HeldDrivingInputs();held.bind(bindings);held.press(key('ArrowUp'));held.press(key('KeyW'));held.press(key('ArrowLeft'));
  held.bind(bindings);held.release('ArrowUp');assert.deepEqual(held.controls(),{up:true,right:false,down:false,left:true,reset:false});
  held.release('KeyW');assert.equal(held.controls().up,false);
  held.press(key('KeyR'));assert.equal(held.controls().reset,false,'reset actions are never replayed');
  for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true},{composedPath:()=>[{tagName:'INPUT'}]},
    {composedPath:()=>[{tagName:'BUTTON'}]},{composedPath:()=>[{isContentEditable:true}]}]) held.press(key('ArrowUp',extra));
  assert.equal(held.controls().up,false);
  held.bind({...bindings,left:['KeyJ']});assert.equal(held.controls().left,false);
  held.press(key('KeyJ'));assert.equal(held.controls().left,true);held.clear();assert.equal(held.controls().left,false);
});

test('car replacement carries held inputs, respects keyup during loading, and exits freecam at GO',()=>{
  for(const released of [false,true]) {
    const c=racer();c.heldDrivingInputs.bind(bindings);c.heldDrivingInputs.press(key('ArrowUp'));c.heldDrivingInputs.press(key('ArrowRight'));
    const old=c.game;c.gameDisposed(old);if(released)c.heldDrivingInputs.release('ArrowUp');
    const next={};c.info={connection:c.connection,sessionId:10,spectator:{isEnabled:true},car:car(),checkpointCount:3};
    c.state.phase='countdown';c.state.runtime={...c.state.runtime,id:'next-round',sessionId:10,startsAt:5000};
    c.now=()=>4000;c.observeGame(next);assert.equal(c.controls.up,!released);assert.equal(c.controls.right,true);assert.equal(c.shouldBlock(next),true);
    c.info.spectator.isEnabled=true;c.now=()=>5000;c.observeGame(next);
    assert.equal(c.info.spectator.isEnabled,false);assert.equal(c.info.car.starts,1);assert.equal(c.controls.up,!released);
    assert.equal(c.shouldBlock(next),false);
    c.observeGame(next);assert.equal(c.info.car.starts,1,'GO recovery happens once');
    c.clearDrivingInput();assert.equal(c.heldDrivingInputs.controls().up,false);assert.equal(c.controls.right,false);
  }
});

test('start respawns preserve cumulative Cup time through repeated attempts, checkpoints, inputs and finish',()=>{
  const c=racer();c.info.car.frames=1200;c.now=()=>1500;
  const first=c.info.car;assert.equal(c.checkpointHotkey(key('KeyR')),true);
  assert.notEqual(c.info.car,first);assert.deepEqual(c.state.runtime.dnfs,[]);assert.equal(c.lapFrames(0),1500);assert.equal(c.info.car.starts,1);
  c.info.car.frames=500;c.now=()=>2100;c.captureInputs();assert.equal(c.inputCapture.through,2000);assert.equal(c.inputCapture.gap,false);
  assert.equal(c.checkpointHotkey(key('KeyR')),true);assert.equal(c.lapFrames(0),2100);
  c.info.car.frames=700;c.info.car.checkpoint=1;c.now=()=>2800;c.info.car.onCheckpoint(0);
  assert.equal(c.state.runtime.splits[1].frames,2800);assert.equal(c.checkpointHotkey(key('KeyR')),false,'ordinary checkpoints use native respawn');
  c.info.car.frames=4000;c.now=()=>6100;c.info.car.onFinish();assert.equal(c.state.runtime.finishes[1],6100);
  assert.equal(c.info.car.getTime().numberOfFrames,4000,'native replay/leaderboard time is never rewritten');
  Cup.completeRound(c.state);Cup.beginRound(c.state);c.state.runtime.sessionId=9;c.state.phase='countdown';
  c.state.runtime.startsAt=10000;c.observeGame(c.game);assert.equal(c.lapFrames(0),0);
});

test('start respawn rejects menus, countdown, spectators, completed runs and stale sessions',()=>{
  const c=racer();const initial=c.info.car;
  for(const event of [key('KeyT'),key('KeyR',{ctrlKey:true}),key('KeyR',{composedPath:()=>[{tagName:'INPUT'}]})])
    assert.equal(c.checkpointHotkey(event),false);
  for(const phase of ['warmup','countdown','between-rounds']) {c.state.phase=phase;assert.equal(c.checkpointHotkey(key('KeyR')),false);}
  c.state.phase='racing';c.info.sessionId=8;assert.equal(c.checkpointHotkey(key('KeyR')),false);c.info.sessionId=9;
  c.selfId=9;assert.equal(c.checkpointHotkey(key('KeyR')),false);c.selfId=1;
  Cup.markDNF(c.state,1);assert.equal(c.checkpointHotkey(key('KeyR')),false);assert.equal(c.info.car,initial);
});

test('spectator handoff keeps the old stream moving, then switches name, car and inputs together',(t)=>{
  const c=new Controller(()=>{});c.state=race();c.selfId=4;c.game={};c.info={sessionId:9};c.lobby=[1,2,3,4].map(id=>({id}));
  const sent=[],shown=[];let now=1000;
  t.mock.method(performance,'now',()=>now);
  c.now=()=>now;c.native={visibility(){},follow(g,p,id){shown.push({id,x:p.carPosition?.[0]});},camera:()=>pose(now)};
  c.transport.send=(id,m)=>{sent.push(m);return true;};
  c.bufferCamera(1,pose(1000,0));c.beforeRender(c.game);assert.equal(c.watchId,1);
  c.selectWatch(2);c.beforeRender(c.game);assert.equal(c.watchId,1);assert.deepEqual(sent.at(-1),{type:'watch',value:2,previous:1});
  for(now=1050;now<=2000;now+=50){c.receiveCamera(0,{type:'camera',racerId:1,pose:pose(now,(now-1000)/100)});c.beforeRender(c.game);}now=2000;
  assert.equal(shown.at(-1).id,1);assert.ok(shown.at(-1).x>0,'old target continues moving while requested stream is absent');
  c.receiveCamera(0,{type:'camera',racerId:3,pose:pose(now,99)});assert.equal(c.cameraBuffers.has(3),false);
  c.receiveCamera(0,{type:'camera',racerId:2,pose:pose(now,20)});c.beforeRender(c.game);
  assert.equal(c.watchId,2);assert.equal(shown.at(-1).id,2);assert.equal(shown.at(-1).x,20);
  c.beforeRender(c.game);assert.deepEqual(sent.at(-1),{type:'watch',value:2,previous:null});
  c.selectWatch(3);c.selectWatch(1);assert.equal(c.watchId,2,'rapid selection does not label the displayed car incorrectly');
});

test('host handoff relays only the old and requested streams until acknowledgement',()=>{
  const c=racer();c.selfId=4;c.hello=new Set([4]);c.lobby.push({id:4});const sent=[];
  c.cameraTransport.send=(id,m)=>{sent.push([id,m.racerId]);return true;};
  c.receive(4,{type:'watch',value:1});c.receive(4,{type:'watch',value:2,previous:1});
  for(const id of [1,2,3])c.relayCamera(id,pose(1000));assert.deepEqual(sent,[[4,1],[4,2]]);
  sent.length=0;c.receive(4,{type:'watch',value:2,previous:null});
  for(const id of [1,2,3])c.relayCamera(id,pose(1100));assert.deepEqual(sent,[[4,2]]);
  c.receive(4,{type:'watch',value:3,previous:1});assert.equal(c.handoffSubscriptions.has(4),false,'cannot request an unrelated extra stream');
});

test('native car replacement cuts the camera buffer even when cumulative Cup time continues',()=>{
  const b=new CameraBuffer();b.push({...pose(1000,10),resetCounter:1});b.push({...pose(1100,15),resetCounter:1});
  b.push({...pose(1200,0),resetCounter:2});
  assert.equal(b.playback(1250,9,1250).carPosition[0],0,'do not interpolate the respawn through scenery');
});

test('cumulative finish display replaces attempt-only time without rewriting a native record',()=>{
  class Game {update(){}dispose(){}}class Library{}
  const time={textContent:'00:04.000'}, classes=new Set(['record']),difference=new Set(['difference']);
  const current={classList:{remove:value=>assert.equal(value,'show-position')}};
  const banner={querySelector:selector=>selector==='.current .time'?time:current,
    querySelectorAll:()=>[classes,difference].map(values=>({classList:{add:value=>values.add(value)}}))};
  const g={},_a=new WeakMap([[g,{element:{querySelector:()=>banner}}]]);
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','_a','He','xt',
    `let bs=()=>{},Ss=()=>{};return ${code}`)(class{},class{},Game,Library,_a,{A:{formatTimeString:t=>String(t.numberOfFrames)}},{A:class{constructor(n){this.numberOfFrames=n;}}})};
  const api=connectNative(pml,{});api.showRoundFinish(g,6100);
  assert.equal(time.textContent,'6100');assert.ok(classes.has('hidden'));assert.ok(difference.has('hidden'));
  api.showRoundFinish({},6100);
});


test('late GO counts missed countdown time in checkpoints, input evidence and finish for host and guest',()=>{
  for(const host of [true,false]) {
    const c=racer();c.isHost=host;
    const messages=[];c.transport.send=(id,m)=>{messages.push(m);return true;};
    c.state.runtime={...c.state.runtime,id:'background-round',startsAt:5000};
    c.now=()=>15000;c.observeGame(c.game);
    assert.equal(c.lapFrames(0),10000,'returning ten seconds late cannot start a fresh Cup clock');
    assert.equal(c.info.car.starts,1);c.observeGame(c.game);assert.equal(c.info.car.starts,1);
    c.info.car.frames=2000;c.now=()=>17000;c.captureInputs();
    assert.equal(c.inputCapture.through,12000);
    c.info.car.checkpoint=1;c.info.car.onCheckpoint(0);
    assert.equal(host?c.state.runtime.splits[1].frames:messages.find(m=>m.type==='checkpoint').frames,12000);
    c.info.car.frames=5000;c.now=()=>20000;
    if(host)c.receiveFinish(2,{type:'finish',roundId:c.state.runtime.id,sessionId:9,frames:14000,checkpoint:null});
    c.info.car.onFinish();
    assert.equal(host?c.state.runtime.finishes[1]:messages.find(m=>m.type==='finish').frames,15000);
    assert.equal(c.info.car.getTime().numberOfFrames,5000,'native recordings keep their own simulation time');
    if(host)assert.ok(c.state.runtime.finishes[1]>c.state.runtime.finishes[2],'late starter cannot beat the 14-second leader using a five-second native attempt');
    c.state.runtime={...c.state.runtime,id:'fresh-round',startsAt:25000,finishes:{},splits:{}};
    c.state.phase='countdown';c.now=()=>24000;c.observeGame(c.game);assert.equal(c.lapFrames(0),0);
    c.now=()=>25000;c.observeGame(c.game);assert.equal(c.lapFrames(0),0,'on-time next round has no old penalty');
  }
});

test('late start plus repeated start respawns never drops or double counts earlier time',()=>{
  const c=racer();c.state.runtime={...c.state.runtime,id:'late',startsAt:5000};
  c.now=()=>15000;c.observeGame(c.game);
  c.info.car.frames=2000;c.now=()=>17000;
  assert.equal(c.checkpointHotkey(key('KeyR')),true);assert.equal(c.lapFrames(0),12000);
  c.info.car.frames=300;c.now=()=>17300;
  assert.equal(c.checkpointHotkey(key('KeyR')),true);assert.equal(c.lapFrames(0),12300);
  c.info.car.frames=4000;c.now=()=>21300;c.info.car.onFinish();
  assert.equal(c.state.runtime.finishes[1],16300);
});


test('open chat blocks restart hotkeys even if a new game takes keyboard focus',()=>{
  const c=racer();c.heldDrivingInputs.bind(bindings);c.heldDrivingInputs.press(key('ArrowUp'));
  c.setChatTyping(true);assert.equal(c.heldDrivingInputs.controls().up,false);
  assert.equal(c.checkpointHotkey(key('KeyR')),false);assert.equal(c.restartHotkey(key('KeyT')),false);
  const first=c.info.car;c.state.phase='warmup';c.handleRestart(c.game);assert.equal(c.info.car,first);
  c.state.phase='racing';c.setChatTyping(false);assert.equal(c.checkpointHotkey(key('KeyR')),true);
});

test('held checkpoint reset is consumed without resetting or leaking to another Enter action',()=>{
 const c=racer(), initial=c.info.car;
 assert.equal(c.checkpointHotkey(key('KeyR',{repeat:true})),true);
 assert.equal(c.info.car,initial);assert.deepEqual(c.state.runtime.dnfs,[]);
});
