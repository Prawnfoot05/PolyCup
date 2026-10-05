import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../src/cup.mjs';
import { Controller, validSnapshot } from '../src/controller.mjs';

const id = n => String(n).repeat(64);
const wr = frames => ({ status: 'ready', frames, name: 'Record holder' });
function registration() {
  const s = Cup.newCup();
  for (const n of [1, 2, 3]) {
    Cup.addPlayer(s, n, `Racer ${n}`);
    Cup.chooseTrack(s, n, { id: id(n), name: `Track ${n}` });
  }
  return s;
}
function dnfRound(s) {
  Cup.beginRound(s); s.phase = 'countdown'; Cup.startRace(s, 0); Cup.completeRound(s);
}

test('WR pacing rounds to four minutes and permits short and long track lengths', () => {
  for (const [frames, rounds] of [[25000, 10], [30000, 8], [45000, 5], [60000, 4],
    [90000, 3], [120000, 2], [300000, 1], [3600000, 1], [1000, 240]]) {
    assert.equal(Cup.roundsForRecord(wr(frames)), rounds);
  }
  for (const record of [null, {}, { status: 'missing' }, { status: 'unavailable' },
    ...[0, -1, NaN, Infinity, 1.5, '30000', 3600001].map(wr)]) {
    assert.equal(Cup.roundsForRecord(record), 4);
  }
});

test('unequal track visits repeat without a Cup cap, preserve points and only warm up on the first visit', () => {
  const s = registration();
  for (const [n, frames] of [[1, 25000], [2, 30000], [3, 60000]]) s.records[id(n)] = { pbs: {}, wr: wr(frames) };
  Cup.lockRegistration(s, () => .999);
  assert.equal(s.matches[0].target, 140);
  s.matches[0].scores[1] = 80;
  // A newer live WR must not move the schedule after it has been frozen.
  s.records[id(1)].wr = wr(120000);
  for (let i = 0; i < 45; i++) {
    const offset = i % 22, track = offset < 10 ? 1 : offset < 18 ? 2 : 3;
    const visitRound = offset < 10 ? offset + 1 : offset < 18 ? offset - 9 : offset - 17;
    const expected = { trackId: id(track), round: visitRound, rounds: [10, 8, 4][track - 1] };
    assert.deepEqual(Cup.trackProgress(s), expected);
    Cup.beginRound(s); assert.equal(s.runtime.trackId, expected.trackId);
    assert.equal(s.runtime.warmup, visitRound === 1 && i < 22);
    assert.deepEqual(Cup.trackProgress(s, s.runtime.round - 1), expected);
    s.phase = 'countdown'; Cup.startRace(s, 0); Cup.completeRound(s);
    assert.equal(s.phase, 'between-rounds'); assert.equal(s.matches[0].scores[1], 80);
    assert.deepEqual(Cup.trackProgress(s, s.matches[0].rounds - 1), expected);
  }
  assert.ok(validSnapshot(s));
});

test('void, undo and JSON restoration retain the frozen schedule at a track boundary', () => {
  const s = registration(); s.records[id(1)] = { pbs: {}, wr: wr(120000) };
  Cup.lockRegistration(s, () => .999); dnfRound(s);
  Cup.beginRound(s); Cup.voidRound(s);
  assert.deepEqual(Cup.trackProgress(s), { trackId: id(1), round: 2, rounds: 2 });
  dnfRound(s); assert.equal(Cup.nextTrack(s), id(2));
  Cup.undoRound(s); assert.equal(Cup.nextTrack(s), id(1));
  const restored = JSON.parse(JSON.stringify(s)); Cup.detachIdentities(restored);
  assert.ok(validSnapshot(restored)); assert.deepEqual(Cup.trackProgress(restored), Cup.trackProgress(s));
  dnfRound(restored); assert.equal(Cup.nextTrack(restored), id(2));
});

test('snapshots require a complete bounded schedule; existing 100-point saves retain their original rules', () => {
  const s = registration(); Cup.lockRegistration(s); assert.ok(validSnapshot(s));
  for (const bad of [undefined, null, {}, { [id(1)]: 4 },
    ...[0, -1, 1.5, Infinity, '4', 240001].map(n => ({ ...s.matches[0].trackRounds, [id(1)]: n })),
    { ...s.matches[0].trackRounds, [id(4)]: 4 }]) {
    const copy = structuredClone(s); copy.matches[0].trackRounds = bad; assert.equal(validSnapshot(copy), false);
  }
  s.matches[0].target = 100; delete s.matches[0].trackRounds;
  assert.ok(validSnapshot(s)); s.matches[0].rounds = 4;
  assert.deepEqual(Cup.trackProgress(s), { trackId: s.matches[0].order[1], round: 1, rounds: 4 });
});

function hostRoom() {
  const host = new Controller(() => {}), client = new Controller(() => {}), sessions = [];
  host.isHost = true; host.selfId = 1; host.state = registration(); host.game = {};
  host.info = { sessionId: 1 }; host.lobby = host.state.roster.map(p => ({ ...p }));
  host.hello = new Set([2, 3]); host.transport.has = () => true;
  host.connection = { startNewSession: (...args) => sessions.push(args) };
  host.tracks = new Map(host.state.tracks.map(t => [t.id, { trackMetadata: { name: t.name }, trackData: t.id }]));
  host.transport.broadcast = message => client.receive(0, structuredClone(message));
  return { host, client, sessions };
}

test('host fetches every unique track before starting and shares frozen counts with joining clients', async () => {
  const { host, client, sessions } = hostRoom(), requested = [], done = new Map();
  host.native = { worldRecord: (game, track) => {
    assert.equal(game, host.game); requested.push(track); return new Promise(resolve => done.set(track, resolve));
  } };
  const pending = host.startCup(); await Promise.resolve();
  assert.ok(host.startingCup); assert.equal(host.state.phase, 'registration'); assert.equal(sessions.length, 0);
  await host.startCup(); assert.equal(requested.length, 3);
  done.get(id(1))(wr(25000)); done.get(id(2))(wr(60000)); done.get(id(3))({ status: 'missing' });
  await pending;
  assert.equal(host.startingCup, null); assert.equal(sessions.length, 1); assert.equal(host.state.phase, 'loading');
  const match = host.state.matches[0];
  assert.deepEqual(match.trackRounds, { [id(1)]: 10, [id(2)]: 4, [id(3)]: 4 });
  assert.equal(match.target, 140); assert.deepEqual(client.state.matches[0], match);
  assert.deepEqual(Cup.trackProgress(client.state), Cup.trackProgress(host.state));
  assert.ok(validSnapshot(client.state));
});

test('failed, malformed and stalled WR requests use fallback without waiting indefinitely', async () => {
  const { host } = hostRoom();
  const original = host.worldRecordForStart;
  host.worldRecordForStart = (track, game) => original.call(host, track, game, 15);
  let late;
  host.native = { worldRecord: async (game, track) => {
    if (track === id(1)) throw new Error('Offline');
    if (track === id(2)) return wr(NaN);
    return new Promise(resolve => { late = resolve; });
  } };
  await host.startCup(); assert.deepEqual(Object.values(host.state.matches[0].trackRounds), [4, 4, 4]);
  late(wr(10000)); await Promise.resolve();
  assert.deepEqual(Object.values(host.state.matches[0].trackRounds), [4, 4, 4]);
});

test('a cancelled Cup cannot be restarted by a late WR response', async () => {
  const { host, sessions } = hostRoom();
  let resolve; const waiting = new Promise(r => { resolve = r; });
  host.native = { worldRecord: () => waiting };
  const pending = host.startCup(); host.releaseCup('Ended');
  host.state = registration(); resolve(wr(30000)); await pending;
  assert.equal(host.state.phase, 'registration'); assert.equal(sessions.length, 0);
});

test('changed picks or disconnected racers abort preparation without launching a race', async () => {
  for (const change of [host => Cup.chooseTrack(host.state, 1, { id: id(4), name: 'Replacement' }),
    host => { host.lobby = host.lobby.filter(p => p.id !== 2); }]) {
    const { host, sessions } = hostRoom();
    let resolve; const waiting = new Promise(r => { resolve = r; });
    host.native = { worldRecord: () => waiting };
    const pending = host.startCup(); change(host); resolve(wr(30000));
    await assert.rejects(pending, /changed|connected/);
    assert.equal(host.state.phase, 'registration'); assert.equal(host.startingCup, null); assert.equal(sessions.length, 0);
  }
});
