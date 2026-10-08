import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingActions } from '../.research/test-src/pending-actions.ts';
import { Controller } from '../.research/test-src/controller.ts';
import * as Cup from '../.research/test-src/cup.ts';
import { registerVersionCheck } from '../.research/test-src/version-check.ts';

test('remote actions wait for their own acknowledgement and coalesce repeated clicks', async () => {
  const pending = new PendingActions(), sent = [];
  const first = pending.run('join', id => { sent.push(id); return true; });
  assert.equal(pending.run('join', () => assert.fail('duplicate send')), first);
  let done = false; first.then(() => { done = true; });
  pending.acknowledge('unrelated'); await Promise.resolve(); assert.equal(done, false);
  assert.equal(pending.acknowledge(sent[0]), true); await first; assert.equal(done, true);
  const second = pending.run('join', id => { sent.push(id); return true; });
  assert.notEqual(sent[0], sent[1]); pending.acknowledge(sent[0]);
  pending.acknowledge(sent[1], 'Roster is full'); await assert.rejects(second, /Roster is full/);
});

test('failed sends, disconnected sessions and missing acknowledgements settle pending actions', async () => {
  const pending = new PendingActions();
  await assert.rejects(pending.run('join', () => false), /not ready/);
  const a = pending.run('join', () => true), b = pending.run('ban', () => true);
  pending.cancel('Disconnected'); await assert.rejects(a, /Disconnected/); await assert.rejects(b, /Disconnected/);
  await assert.rejects(pending.run('join', () => true, 5), /No reply/);
  await assert.rejects(pending.run('join', () => { throw new Error('closed'); }), /closed/);
});

test('host rejects stale actions, acknowledges accepted actions, and peers cannot forge a reply', async () => {
  const host = new Controller(() => {}), guest = new Controller(() => {});
  host.isHost = true; host.selfId = 1; guest.selfId = 2;
  host.state = Cup.newCup(); guest.state = structuredClone(host.state);
  host.hello.add(2); host.lobby = [{ id: 2, nickname: 'Racer' }];
  host.broadcast = () => {}; const requests = [], replies = [];
  guest.transport.send = (id, message) => { requests.push(message); return true; };
  host.transport.send = (id, message) => { replies.push(message); return true; };
  const join = guest.action('join'); assert.equal(guest.action('join'), join);
  host.receive(2, requests[0]); assert.equal(host.state.roster[0].id, 2);
  let done = false; join.then(() => { done = true; });
  guest.receive(3, replies[0]); await Promise.resolve(); assert.equal(done, false);
  guest.receive(0, replies[0]); await join;
  const leave = guest.action('leave'); host.receive(2, { ...requests[1], cupId: 'stale' });
  guest.receive(0, replies[1]); await assert.rejects(leave, /no longer available/);
  assert.equal(host.state.roster.length, 1);
});

test('racer camera choice survives native session replacement independently of defaults', () => {
  for (const view of [0, 1]) {
    const c = new Controller(() => {}); c.state = Cup.newCup();
    Cup.addPlayer(c.state, 1, 'Driver'); c.selfId = 1; c.connection = { getPlayers: () => [{ id: 1, isSelf: true }] };
    Cup.addPlayer(c.state, 2, 'Other');
    for(const id of [1,2]) Cup.chooseTrack(c.state,id,{id:'a'.repeat(64),name:'Track'});
    Cup.lockRegistration(c.state);
    c.game = {}; c.info = { connection: c.connection, spectator: { isEnabled: false } };
    const old = c.game, restored = [], info = c.info;
    let currentView = view;
    c.native = { drivingView: () => currentView, read: () => info, release: (g, mode) => restored.push(mode) };
    c.rememberDrivingView(old);
    currentView = 0; c.state.phase = 'loading'; c.state.runtime = { sessionId: 99 };
    c.rememberDrivingView(old); c.gameDisposed(old);
    c.observeGame({}); assert.deepEqual(restored, [view]);
    c.observeGame(c.game); assert.equal(restored.length, 1, 'restoration must not override later camera changes');
    info.spectator.isEnabled = true; c.rememberDrivingView(c.game);
    assert.equal(c.drivingView, 0, 'manual freecam between rounds falls back to chase');
    c.followingGame = c.game; c.drivingView = 1; c.rememberDrivingView(c.game);
    assert.equal(c.drivingView, 1, 'Cup POV must not replace the saved driver camera');
  }
});

test('late previous-round state cannot turn a newly loaded session into spectator POV', () => {
  const c = new Controller(() => {}); c.state = Cup.newCup(); c.state.phase = 'between-rounds';
  c.state.runtime = { sessionId: 10 }; c.selfId = 3; c.game = {}; c.info = { sessionId: 11 };
  assert.equal(c.canSpectate(), false);
  c.state.runtime.sessionId = 11; assert.equal(c.canSpectate(), true);
});

test('version handshake rejects missing/mismatched guests before allocating a peer and leaves vanilla hosts usable', () => {
  const hooks = [];
  registerVersionCheck({ registerClassMixin: (path, method, hook) => hooks.push({ path, method, ...hook }),
    registerFuncMixin: (path, hook) => hooks.push({ path, ...hook }) }, 1);
  const host = Function('o', 'e', 't', `${hooks[0].func}; return 'accepted';`);
  for (const mods of [[], ['polytrack-world-cup:0.2.23'], ['polytrack-world-cup:0.3.1'],
    ['polytrack-world-cup:0.3.0','polytrack-world-cup:0.2.23']]) {
    const declined = [];
    assert.equal(host({ mods }, { send: text => declined.push(JSON.parse(text)) }, 'session'), undefined);
    assert.equal(declined[0].reason, 'IncompatibleMods'); assert.equal(declined[0].polyCupVersion, Cup.VERSION);
  }
  assert.equal(host({ mods: [`polytrack-world-cup:${Cup.VERSION}`, 'another-mod:1'] }, { send: () => assert.fail() }), 'accepted');
  class JoinError extends Error { constructor(type) { super(); this.errorType = type; } }
  const guest = Function('t', 'o', 'u', 'Dl', `${hooks[1].func}; return 'accepted';`);
  for (const mods of [[], [`polytrack-world-cup:${Cup.VERSION}`]])
    assert.equal(guest({ mods }, () => assert.fail(), { close: () => assert.fail() }, JoinError), 'accepted');
  let error, closed = false;
  guest({ mods: ['polytrack-world-cup:0.2.23'] }, e => { error = e; }, { close: () => { closed = true; } }, JoinError);
  assert.equal(closed, true); assert.equal(error.errorType, 'polycup-version');
  assert.match(error.message, /Host: 0.2.23.*Installed: 0.3.0/);
});
