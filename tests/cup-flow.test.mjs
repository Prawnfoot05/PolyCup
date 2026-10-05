import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../src/cup.mjs';
import { Controller, validSnapshot } from '../src/controller.mjs';
import { resultRows } from '../src/results.mjs';

const trackId = 'a'.repeat(64);
function setup() {
  const s = Cup.newCup('Evening Cup');
  for (const id of [1,2,3]) { Cup.addPlayer(s, id, `Racer ${id}`); Cup.chooseTrack(s, id, { id: trackId, name: 'Track' }); }
  s.records[trackId] = { pbs: {}, wr: { status: 'ready', frames: 25000, name: 'Record' } };
  Cup.lockRegistration(s); return s;
}
function race(s = setup()) { Cup.beginRound(s); s.runtime.sessionId = 9; s.phase = 'countdown'; Cup.startRace(s, 0); return s; }
function complete() {
  const s = setup(); s.matches[0].scores[1] = 140; s.matches[0].finalists[1] = { round: 1, position: 1, checkpoint: null };
  race(s); Cup.recordFinish(s, 1, 25000, 25000); Cup.recordFinish(s, 2, 26000, 26000); Cup.completeRound(s); return s;
}
function room(state = race()) {
  const c = new Controller(() => {}); c.state = state; c.selfId = 1; c.isHost = true; c.game = {};
  c.lobby = [1,2,3,4].map(id => ({ id })); c.hello = new Set([2,3,4]); c.connection = {};
  c.info = { sessionId: 9, spectator: { isEnabled: false } }; c.now = () => 30000;
  c.native = { autoSpectate: () => true, visibility: () => {}, camera: () => pose(), follow: () => {}, release: () => {} };
  c.broadcast = () => {}; c.save = () => {}; c.transport.has = () => true;
  return c;
}
const pose = () => ({ sessionId: 9, at: 30000, position: [0,2,6], quaternion: [0,0,0,1], fov: 75,
  carPosition: [0,0,0], carQuaternion: [0,0,0,1], frames: 25000, speed: 120, view: 0 });

test('practice uses a frozen 1.5 WR, minimum 30s and 90s offline fallback', () => {
  for (const [frames, expected] of [[10000,30000],[25000,37500],[60000,90000],[3600000,5400000]])
    assert.equal(Cup.practiceForRecord({ status: 'ready', frames }), expected);
  for (const wr of [null, { status:'missing' }, { status:'unavailable' }, {status:'ready',frames:NaN}])
    assert.equal(Cup.practiceForRecord(wr), 90000);
  const c = room(setup()); c.state.records[trackId].wr.frames = 5000;
  Cup.beginRound(c.state); c.state.runtime.sessionId = 9; c.state.runtime.ready = [1,2,3]; c.advanceClock();
  assert.equal(c.state.phase, 'warmup'); assert.equal(c.state.runtime.startsAt, 67500);
  assert.ok(validSnapshot(c.state));
});

test('only current racers can Ready the current practice; all Ready gives everyone a full countdown', () => {
  const c = room(setup()); Cup.beginRound(c.state); c.state.phase = 'warmup';
  c.state.runtime.sessionId = 9; c.state.runtime.startsAt = 90000;
  const vote = (id, value = c.state.runtime.id, cupId = c.state.id) => c.handleAction(id, { type:'practice-ready', value, cupId });
  vote(4); vote(2, 'old-round'); vote(3, c.state.runtime.id, 'old-cup');
  assert.deepEqual(c.state.runtime.practiceReady, []);
  vote(1); vote(1); vote(2); assert.equal(c.state.phase, 'warmup');
  vote(3); assert.equal(c.state.phase, 'countdown'); assert.equal(c.state.runtime.startsAt, 33000);
  c.now = () => 32999; c.advanceClock(); assert.equal(c.state.phase, 'countdown');
  c.now = () => 33000; c.advanceClock(); assert.equal(c.state.phase, 'racing');
  vote(2); assert.equal(c.state.phase, 'racing');
});

test('practice times out without Ready, void/undo reset votes, completed track visits skip practice', () => {
  const c = room(setup()); Cup.beginRound(c.state); c.state.phase = 'warmup';
  c.state.runtime.startsAt = 30000; c.advanceClock(); assert.equal(c.state.phase, 'countdown');
  Cup.voidRound(c.state); Cup.beginRound(c.state); assert.equal(c.state.runtime.warmup, true);
  c.state.phase = 'warmup'; Cup.practiceReady(c.state, 1, c.state.runtime.id);
  c.state.phase = 'countdown'; Cup.startRace(c.state, 0); Cup.completeRound(c.state); Cup.undoRound(c.state);
  Cup.beginRound(c.state); assert.equal(c.state.runtime.warmup, true); assert.deepEqual(c.state.runtime.practiceReady, []);
  c.state.phase = 'countdown'; Cup.startRace(c.state, 0); Cup.completeRound(c.state);
  c.state.matches[0].rounds = 10; Cup.beginRound(c.state); assert.equal(c.state.runtime.warmup, false);
  const bad = structuredClone(c.state); bad.runtime.practiceReady = [4]; assert.equal(validSnapshot(bad), false);
  const badTime = structuredClone(c.state); badTime.matches[0].trackWarmups[trackId] = -1; assert.equal(validSnapshot(badTime), false);
});

test('fresh rematches retain only players and optional picks, leaving previous scores and results intact', () => {
  const s = complete(), original = JSON.stringify(s);
  for (const newTracks of [false,true]) {
    const next = Cup.rematch(s, newTracks); assert.notEqual(next.id, s.id);
    assert.deepEqual(next.roster, s.roster); assert.notEqual(next.roster, s.roster);
    assert.equal(next.phase, 'registration'); assert.deepEqual(next.records, {});
    assert.deepEqual(next.matches, []); assert.deepEqual(next.results, []); assert.deepEqual(next.history, []);
    assert.deepEqual(next.picks, newTracks ? {} : s.picks); assert.equal(next.tracks.length, newTracks ? 0 : 1);
    assert.ok(validSnapshot(next));
    if (!newTracks) { Cup.lockRegistration(next); assert.deepEqual(next.matches[0].scores, {1:0,2:0,3:0}); }
  }
  assert.equal(JSON.stringify(s), original); assert.throws(() => Cup.rematch(setup()), /Finish/);
});

test('quick rematch starts one new native session, rejects missing racers, and new picks retain the lobby', async () => {
  const c = room(complete()); let starts = 0;
  c.connection.startNewSession = () => starts++;
  c.tracks.set(trackId, { trackMetadata: {}, trackData: {} }); c.native.worldRecord = async () => ({status:'missing'});
  const old = c.state.id;
  await c.rematch(); assert.equal(starts, 1); assert.equal(c.state.phase, 'loading'); assert.notEqual(c.state.id, old);
  assert.deepEqual(c.state.matches[0].scores, {1:0,2:0,3:0});
  c.state = complete(); c.lobby = [{id:1},{id:2}]; const completed = c.state;
  await assert.rejects(c.rematch(), /connected/); assert.equal(c.state, completed);
  await c.rematch(true); assert.equal(c.state.phase,'registration'); assert.equal(c.state.roster.length,3);
  assert.deepEqual(c.state.picks,{}); assert.equal(c.tracks.size,0); assert.equal(starts,1);
});

test('finished and retired racers receive POV; racers still driving cannot subscribe or relay a spectator camera', () => {
  const c = room(), sent = []; c.cameraTransport.send = (id,m) => sent.push([id,m]);
  c.receive(2,{type:'watch',value:3}); assert.equal(c.subscriptions.has(2),false);
  Cup.recordFinish(c.state,2,25000,30000); c.receive(2,{type:'watch',value:3});
  Cup.markDNF(c.state,1); assert.equal(c.canSpectate(),true); assert.deepEqual(c.watchable(),[3]);
  c.relayCamera(3,pose()); assert.equal(sent[0][0],2);
  c.receiveCamera(2,{type:'camera',pose:pose()}); assert.equal(c.cameraBuffers.has(2),false);
  Cup.completeRound(c.state); c.relayCamera(3,pose()); assert.equal(sent.length,1);
});

test('automatic finish POV honors the setting, supports manual watching, and releases the camera on the next countdown', () => {
  const c = room(), events = [];
  c.native.follow = () => events.push('follow'); c.native.release = () => events.push('release');
  c.native.camera = () => { events.push('publish'); return pose(); };
  Cup.recordFinish(c.state,1,25000,30000); c.native.autoSpectate = () => false;
  assert.equal(c.canSpectate(),false); c.watchRemaining(); assert.equal(c.canSpectate(),true);
  c.bufferCamera(2,pose()); c.beforeRender(c.game); assert.equal(c.watchId,2);
  assert.ok(events.includes('follow')); assert.equal(events.includes('publish'),false);
  Cup.markDNF(c.state,2); c.beforeRender(c.game); assert.equal(c.watchId,3);
  Cup.completeRound(c.state); Cup.beginRound(c.state); c.state.phase = 'countdown';
  c.beforeRender(c.game); assert.equal(c.canSpectate(),false); assert.equal(c.watchedPose,null);
  assert.equal(events.filter(e=>e==='release').length,1);
  c.beforeRender(c.game); assert.equal(events.filter(e=>e==='release').length,1);
});

test('final result data includes every racer, winner and actual points and matches the client snapshot', () => {
  const c = room(complete()); const rows = resultRows(c.state);
  assert.equal(rows.length,3); assert.deepEqual(rows[0],{id:1,place:1,name:'Racer 1',score:140,winner:true});
  assert.equal(rows[1].score,8); assert.equal(rows[2].score,0);
  assert.deepEqual(resultRows(c.networkState()),rows);
  assert.deepEqual(resultRows(setup()),[]);
});
