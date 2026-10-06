import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../.research/test-src/controller.ts';
import * as Cup from '../.research/test-src/cup.ts';
import { beginBans, banTrack, banTurn } from '../.research/test-src/draft.ts';
import { formatTime, formatGap } from '../.research/test-src/time.ts';
import { roundStartCue } from '../.research/test-src/countdown.ts';

test('center start cue uses the shared round timestamp, tolerates a late phase update, and clears on cancellation', () => {
  const state={phase:'countdown',runtime:{sessionId:7,startsAt:10000}};
  for(const [now,expected] of [[6999,''],[7000,'3'],[7999,'3'],[8000,'2'],[9000,'1'],[9999,'1'],[10000,'GO'],[10599,'GO'],[10600,'']])
    assert.equal(roundStartCue(state,7,now),expected);
  assert.equal(roundStartCue(state,6,9000),'');
  state.phase='racing';assert.equal(roundStartCue(state,7,10100),'GO');assert.equal(roundStartCue(state,7,12000),'');
  for(const phase of ['loading','warmup','between-rounds','complete']){state.phase=phase;assert.equal(roundStartCue(state,7,9000),'');}
  state.phase='countdown';state.runtime.startsAt=null;assert.equal(roundStartCue(state,7,0),'');
  state.runtime=null;assert.equal(roundStartCue(state,7,9000),'');assert.equal(roundStartCue(null,7,9000),'');
});

function room() {
  const people = [1, 2, 3].map(id => ({ id, nickname: `Player ${id}` }));
  const clients = [1, 2, 3].map(id => {
    const c = new Controller(() => {});
    c.selfId = id; c.isHost = id === 1; c.game = {};
    c.connection = { getPlayers: () => people.map(p => ({ ...p, isSelf: p.id === id })) };
    c.lobby = c.connection.getPlayers(); c.hello = new Set([2, 3]);
    c.info = { disposed: false, spectator: { isEnabled: true } };
    c.native = { read: () => c.info, peers: () => [], release: () => { c.released = (c.released ?? 0) + 1; },
      visibility: (game, ids, self) => { c.visibility = { game, ids, self }; } };
    return c;
  });
  const [host, ...guests] = clients;
  let drop = false;
  host.transport.broadcast = m => { if (!drop) for (const c of guests) c.receive(0, structuredClone(m)); };
  host.transport.send = (id, m) => { clients[id - 1].receive(0, structuredClone(m)); return true; };
  return { host, guests, clients, drop: value => { drop = value; } };
}

test('Cup creation opens every panel once; personal panel changes are never shared', () => {
  const { host, clients } = room();
  host.create('Evening Cup');
  const initial = clients.map(c => c.panelRequest.revision);
  assert.ok(clients.every(c => c.state.name === 'Evening Cup' && c.panelRequest.open));
  host.broadcast();
  assert.deepEqual(clients.map(c => c.panelRequest.revision), initial);
  // A local view can hide without another snapshot reopening it, or opening anyone else's view.
  host.requestPanel(false); host.broadcast();
  assert.equal(host.panelRequest.open, false);
  assert.deepEqual(clients.slice(1).map(c => c.panelRequest.revision), initial.slice(1));
  host.requestPanel(true); host.broadcast();
  assert.deepEqual(clients.slice(1).map(c => c.panelRequest.revision), initial.slice(1));
});

test('each loading and start transition closes all panels; a manual reopen lasts until the next transition', () => {
  const { host, clients } = room(); host.create();
  for (const id of [1, 2]) Cup.addPlayer(host.state, id, `P${id}`);
  beginBans(host.state);
  for (const hash of ['b','c']) banTrack(host.state, banTurn(host.state), { id: hash.repeat(64), name: hash, category: 'official' });
  for (const id of [1, 2]) Cup.chooseTrack(host.state, id, { id: 'a'.repeat(64), name: 'Track' });
  Cup.lockRegistration(host.state); Cup.beginRound(host.state);
  for (const phase of ['loading', 'warmup', 'countdown', 'racing']) {
    host.state.phase = phase; host.state.runtime.sessionId = 7; host.state.runtime.startsAt = Date.now() + 3000;
    host.broadcast();
    assert.ok(clients.every(c => !c.panelRequest.open), phase);
    const seen = clients.map(c => c.panelRequest.revision);
    host.broadcast();
    assert.deepEqual(clients.map(c => c.panelRequest.revision), seen);
    clients.forEach(c => c.requestPanel(true));
    host.broadcast();
    assert.ok(clients.every(c => c.panelRequest.open), 'heartbeat must not dismiss a manually reopened panel');
  }
});

test('a missed end message heals on the idle heartbeat, releases racers and spectators, and retains the autosave', t => {
  const saved = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (key, value) => saved.set(key, value) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  const { host, clients, guests, drop } = room(); host.create('Saved Cup');
  const stale = host.syncMessage();
  for (const c of clients) {
    c.cameraBuffers.set(2, {}); c.subscriptions.set(3, 2); c.watchId = 2; c.filteredCars = true;
    c.pendingUpload = { error: null }; c.recordRequests.set('old', {}); c.trackUploads.set(2, {});
  }
  drop(true); host.endCup();
  assert.equal(host.state, null); assert.ok(guests.every(c => c.state));
  assert.equal(JSON.parse(saved.get('pwc-save-v2')).state.name, 'Saved Cup');
  drop(false); host.lastBroadcast = 0; host.tick();
  for (const c of clients) {
    assert.equal(c.state, null); assert.equal(c.shouldBlock(c.game), false); assert.equal(c.shouldBlockRestart(c.game), false);
    assert.equal(c.info.spectator.isEnabled, false); assert.equal(c.released, 1);
    assert.equal(c.visibility.ids, null); assert.equal(c.visibility.self, c.selfId);
    assert.equal(c.watchId, null); assert.equal(c.cameraBuffers.size, 0); assert.equal(c.recordRequests.size, 0);
    assert.equal(c.trackUploads.size, 0); assert.match(c.pendingUpload.error, /ended/);
    assert.equal(c.panelRequest.open, false); assert.match(c.panelRequest.message, /ended/);
  }
  const notices = guests.map(c => c.panelRequest.revision);
  host.broadcast();
  assert.deepEqual(guests.map(c => c.panelRequest.revision), notices, 'idle state must not repeat the notice');
  guests.forEach(c => c.receive(0, stale));
  assert.ok(guests.every(c => c.state === null), 'late active snapshots must not resurrect an ended Cup');
});

test('hello recovers a missed end, and stale empty snapshots cannot end a replacement Cup', () => {
  const { host, guests, drop } = room(); host.create(); host.save = () => {};
  drop(true); host.endCup(); const ended = host.syncMessage();
  for (const c of guests) {
    host.receive(c.selfId, { type: 'hello', version: Cup.VERSION, sentAt: Date.now() });
    assert.equal(c.state, null); assert.equal(c.released, 1);
  }
  drop(false); host.create('Replacement Cup');
  for (const c of guests) {
    c.receive(0, ended); assert.equal(c.state.name, 'Replacement Cup'); assert.equal(c.panelRequest.open, true);
  }
});

test('only valid ordered host snapshots can replace or end a client Cup', () => {
  const { host, guests } = room(); host.create(); const c = guests[0], id = c.state.id, next = c.receivedSequence + 1;
  for (const [sender, message] of [[2, { state: null, sequence: next }], [0, { state: null }],
    [0, { state: null, sequence: NaN }], [0, { state: {}, sequence: next + 100 }]]) {
    c.receive(sender, { type: 'state', ...message }); assert.equal(c.state.id, id);
  }
  c.receive(0, { type: 'state', sequence: next, state: null }); assert.equal(c.state, null);
});

test('race times preserve milliseconds across minute boundaries and gaps remain compact', () => {
  for (const [input, expected] of [[0, '0:00.000'], [22131, '0:22.131'], [59999, '0:59.999'],
    [60000, '1:00.000'], [101631, '1:41.631'], [3600000, '60:00.000'], [1234.9, '0:01.234']]) {
    assert.equal(formatTime(input), expected);
  }
  for (const input of [undefined, null, NaN, Infinity, -1]) assert.equal(formatTime(input), '—');
  assert.equal(formatGap(123), '+0.123'); assert.equal(formatGap(101631), '+1:41.631');
});
