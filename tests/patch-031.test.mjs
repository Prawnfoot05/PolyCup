import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../.research/test-src/cup.ts';
import { Controller } from '../.research/test-src/controller.ts';
import { standardPreset, quickplayPreset, validPreset, parsePreset } from '../.research/test-src/presets.ts';
import { resetDraft, beginBans } from '../.research/test-src/draft.ts';
import { validSnapshot } from '../.research/test-src/validation.ts';
import { inspectPhysics, STOCK_PHYSICS, PhysicsIntegrity } from '../.research/test-src/physics-integrity.ts';

const tracks = ['a','b','c'].map((n) => ({id:n.repeat(64), name:n}));
function setup(random=false) {
  const preset = random ? quickplayPreset() : standardPreset();
  preset.rules.bansPerRacer=0; preset.rules.pointsToWin=1000; preset.rules.roundsPerTrack=2;
  const state = Cup.newCup('Test',preset);
  for(const id of [1,2,3]) Cup.addPlayer(state,id,`P${id}`);
  if(random)state.tracks=[tracks[0]];
  else for(const id of [1,2,3]) Cup.chooseTrack(state,id,tracks[id-1]);
  Cup.lockRegistration(state,()=>0.999); return state;
}
function score(s,winner=1) {
  Cup.beginRound(s);s.runtime.sessionId=1;s.phase='countdown';Cup.startRace(s,0);
  Cup.recordFinish(s,winner,1000,1000);Cup.completeRound(s);
}
function controller(state) {
  const c = new Controller(()=>{});c.state=state;c.selfId=1;c.isHost=true;
  c.lobby=[1,2,3].map(id=>({id,nickname:`P${id}`,isSelf:id===1}));
  c.broadcast=()=>{};c.save=()=>{};return c;
}

test('setup departure frees the slot in roster, ban and pick phases',()=>{
 for(const stage of ['roster','bans','picks']) {
  const s=Cup.newCup();resetDraft(s);for(const id of [1,2,3])Cup.addPlayer(s,id,`P${id}`);
  if(stage!=='roster'){beginBans(s);s.draft.stage=stage;}
  const c=controller(s);c.lobby=c.lobby.filter(p=>p.id!==2);
  c.checkDisconnects();assert.deepEqual(s.roster.map(p=>p.id),[1,3]);assert.equal(s.draft.stage,'roster');
  assert.equal(validSnapshot(Cup.publicState(s)),true);
 }
});
test('verified setup return automatically rejoins once; a different profile cannot reclaim it',()=>{
 const s=Cup.newCup();resetDraft(s);for(const id of [1,2])Cup.addPlayer(s,id,`P${id}`);
 const c=controller(s), key='a'.repeat(43);c.reconnect.owners.set(key,2);
 c.lobby=[{id:1}];c.checkDisconnects();assert.equal(s.roster.length,1);
 c.lobby.push({id:4,nickname:'P2'});c.reconnect.peers.set(4,'b'.repeat(43));c.restoreRacer(4);assert.equal(s.roster.length,1);
 c.reconnect.peers.set(4,key);c.restoreRacer(4);c.restoreRacer(4);assert.deepEqual(s.roster.map(p=>p.id),[1,4]);
});
test('setup enrollment rejects another live connection of the same verified profile',async()=>{
 const s=Cup.newCup();Cup.addPlayer(s,1,'P1');const c=controller(s);c.hello.add(2);
 c.reconnect.peers.set(2,'a'.repeat(43));c.reconnect.owners.set('a'.repeat(43),1);
 await assert.rejects(c.enrollRacer(2,{type:'join',cupId:s.id}),/already connected/);
 assert.equal(s.roster.length,1);
});
test('track removal rolls back just the current visit and keeps it out of later rotations and undo',()=>{
 const s=setup();for(let i=0;i<7;i++)score(s);
 // A,A,B,B,C,C,A: the second visit to A has scored once.
 assert.equal(Cup.currentMatch(s).scores[1],70);Cup.beginRound(s);
 Cup.removeCurrentTrack(s);assert.equal(Cup.currentMatch(s).scores[1],60);
 assert.equal(Cup.currentMatch(s).roundsLog.filter(r=>r.trackId===tracks[0].id).length,2);
 assert.equal(Cup.nextTrack(s),tracks[1].id);assert.equal(Cup.trackProgress(s).round,1);
 assert.equal(validSnapshot(s),true);assert.equal(validSnapshot(Cup.publicState(s)),true);
 score(s);score(s);assert.equal(Cup.nextTrack(s),tracks[2].id);
 Cup.undoRound(s);Cup.undoRound(s);Cup.undoRound(s);
 assert.ok(!Cup.currentMatch(s).order.includes(tracks[0].id));assert.equal(validSnapshot(s),true);
});
test('removal between rounds targets the track just played, even at its block boundary',()=>{
 const s=setup();score(s);score(s);assert.equal(Cup.nextTrack(s),tracks[1].id);
 Cup.removeCurrentTrack(s);assert.equal(Cup.currentMatch(s).rounds,0);assert.equal(Cup.nextTrack(s),tracks[1].id);
 assert.deepEqual(Cup.currentMatch(s).scores,{1:0,2:0,3:0});
});
test('removing a track restores finalist status and preserves entrants added during its visit',()=>{
 const s=setup();s.preset.rules.allowRacerChanges=true;s.preset.rules.pointsToWin=10;Cup.currentMatch(s).target=10;
 score(s);Cup.enterRunningCup(s,4,'Late');assert.ok(Cup.currentMatch(s).finalists[1]);
 Cup.removeCurrentTrack(s);assert.deepEqual(Cup.currentMatch(s).finalists,{});
 assert.equal(Cup.currentMatch(s).scores[4],0);assert.equal(validSnapshot(s),true);
});
test('last-track removal requires a replacement atomically and random rotation excludes removed maps',()=>{
 for(const random of [false,true]) {
  const s=setup(random);if(!random){const m=Cup.currentMatch(s);m.order=[tracks[0].id];m.trackRounds={[tracks[0].id]:2};m.trackWarmups={[tracks[0].id]:30000};}
  score(s);const before=JSON.stringify(s);assert.throws(()=>Cup.removeCurrentTrack(s),/replacement/);assert.equal(JSON.stringify(s),before);
  Cup.removeCurrentTrack(s,tracks[1],{status:'missing'});assert.equal(Cup.nextTrack(s),tracks[1].id);
  assert.equal(Cup.currentMatch(s).rounds,0);assert.equal(validSnapshot(s),true);
 }
});
test('freecam defaults are backward compatible and malformed flags are rejected',()=>{
 for(const p of [standardPreset(),quickplayPreset()]) {
  assert.equal(p.rules.allowSpectatorFreecam,true);delete p.rules.allowSpectatorFreecam;
  assert.equal(validPreset(p),true);assert.equal(parsePreset(JSON.stringify(p)).rules.allowSpectatorFreecam,true);
  p.rules.allowSpectatorFreecam='yes';assert.equal(validPreset(p),false);
 }
});
test('spectator freecam uses the native binding, obeys the preset and stops following',()=>{
 const c=controller(setup());Cup.beginRound(c.state);c.state.runtime.sessionId=1;c.selfId=4;c.game={};c.info={sessionId:1};
 c.native={freecamPressed:(_,e)=>e.code==='Slash'};
 const key={code:'Slash',composedPath:()=>[]};assert.equal(c.freecamHotkey(key),true);assert.equal(c.canSpectate(),false);
 assert.equal(c.freecamHotkey(key),true);assert.equal(c.canSpectate(),true);
 c.state.preset.rules.allowSpectatorFreecam=false;assert.equal(c.freecamHotkey(key),true);assert.equal(c.freecam,false);
});
test('viewer count excludes departed peers and racers, and ignores forged client counts',()=>{
 const c=controller(setup());Cup.beginRound(c.state);c.state.runtime.sessionId=1;c.state.phase='racing';c.info={sessionId:1};
 c.lobby.push({id:4},{id:5});c.subscriptions.set(4,1);c.subscriptions.set(5,1);c.subscriptions.set(6,1);c.subscriptions.set(2,1);
 c.transport.send=()=>true;c.syncDiagnostics();assert.equal(c.viewerCount,2);
 c.receive(4,{type:'viewers',cupId:c.state.id,roundId:c.state.runtime.id,count:99});assert.equal(c.viewerCount,2);
 c.lobby=c.lobby.filter(p=>p.id!==5);c.lastViewers=0;c.syncDiagnostics();assert.equal(c.viewerCount,1);
});
test('physics warning is host only, current Cup only, and does not block any racer',()=>{
 const c=controller(setup());c.hello.add(2);const report={hash:'f'.repeat(64),driveForce:400000};
 c.receive(2,{type:'physics',cupId:'old',report});assert.equal(c.physicsWarnings.length,0);
 c.receive(2,{type:'physics',cupId:c.state.id,report});assert.deepEqual(c.physicsWarnings,[{id:2,driveForce:400000}]);
 assert.deepEqual(Cup.activeIds(c.state),[1,2,3]);c.isHost=false;assert.equal(c.physicsWarnings.length,0);
});
test('physics fingerprint detects changed force but is stable when a patch leaves the operand unchanged',async()=>{
 const bytes=new ArrayBuffer(0x2f845),view=new DataView(bytes);view.setUint8(0x2f840,0x43);view.setFloat32(0x2f841,4000,true);
 const report=await inspectPhysics(bytes);assert.equal(report.driveForce,4000);
 view.setFloat32(0x2f841,4000,true);assert.equal((await inspectPhysics(bytes)).hash,report.hash);
 view.setFloat32(0x2f841,400000,true);const changed=await inspectPhysics(bytes);
 assert.notEqual(changed.hash,report.hash);assert.equal(changed.driveForce,400000);
});
test('removing a newly loaded then voided track does not undo the previous track',()=>{
 const s=setup();score(s);score(s);Cup.beginRound(s);Cup.voidRound(s);Cup.removeCurrentTrack(s);
 assert.equal(Cup.currentMatch(s).scores[1],20);assert.equal(Cup.nextTrack(s),tracks[2].id);assert.equal(validSnapshot(s),true);
});
