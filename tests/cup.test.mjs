import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cup from '../src/cup.mjs';
function grid() {
  const s = Cup.newCup('Test cup');
  for (let i = 1; i <= 8; i++) Cup.addPlayer(s, i, `Racer ${i}`);
  for (let i = 1; i <= 3; i++) Cup.addTrack(s, { id: String(i).repeat(64), name: `Track ${i}` });
  Cup.lockRegistration(s);
  for (const id of [3, 4, 5, 6, 7, 8]) Cup.pickOpponent(s, Cup.groupPicker(s), id);
  return s;
}
function pickTracks(s) { for (const t of s.tracks) Cup.pickTrack(s, Cup.trackPicker(s), t.id); }
function race(s, order = Cup.activeIds(s), times) {
  if (s.phase === 'track-picks') pickTracks(s);
  Cup.beginRound(s); s.phase = 'countdown'; Cup.startRace(s, 100000);
  order.forEach((id, i) => assert.equal(Cup.recordFinish(s, id, times?.[i] ?? 30000 + i * 1000, 100000 + (times?.[i] ?? 30000 + i * 1000)), true));
  Cup.completeRound(s);
}
test('registration, captain draft, and seed-order track picks enforce turns', () => {
  const s = grid(); assert.deepEqual(s.groups, [[1, 3, 5, 7], [2, 4, 6, 8]]);
  assert.equal(Cup.trackPicker(s), 1);
  assert.throws(() => Cup.pickTrack(s, 3, s.tracks[0].id));
  assert.throws(() => Cup.addPlayer(s, 9, 'Late entrant'));
  pickTracks(s); assert.equal(s.phase, 'between-rounds');
});
test('reaching target makes a finalist; only a later outright win qualifies', () => {
  const s = grid(); for (let i = 0; i < 12; i++) race(s, [1, 3, 5, 7]);
  assert.equal(Cup.currentMatch(s).scores[1], 120); assert.deepEqual(Cup.currentMatch(s).winners, []);
  race(s, [1, 3, 5, 7]); assert.deepEqual(Cup.currentMatch(s).winners, [1]);
  assert.ok(!Cup.activeIds(s).includes(1)); assert.equal(Cup.currentMatch(s).scores[1], 120);
});
test('whole 8-player World Cup advances two from each semifinal and resolves three podium places', () => {
  const s = grid(); let guard = 0;
  while (s.phase !== 'complete' && guard++ < 150) {
    if (s.phase === 'match-complete') { Cup.advanceMatch(s); continue; }
    race(s);
  }
  assert.equal(s.phase, 'complete'); assert.equal(s.matches[2].target, 140);
  assert.equal(s.matches[2].winners.length, 3); assert.equal(s.results.length, 8);
  assert.equal(new Set(s.results.map(r => r.id)).size, 8);
  assert.equal(s.results.filter(r => r.place === '5–8').length, 4);
});
test('track rotates after four scored rounds and cycles with a fresh warmup', () => {
  const s = grid(); pickTracks(s);
  for (let i = 0; i < 13; i++) {
    Cup.beginRound(s); assert.equal(s.runtime.trackId, s.tracks[Math.floor(i / 4) % 3].id);
    assert.equal(s.runtime.warmup, i % 4 === 0);
    s.phase = 'countdown'; Cup.startRace(s, 0); Cup.completeRound(s);
  }
});
test('DNF gives no points and late, duplicate, future, and spectator finishes are rejected', () => {
  const s = grid(); pickTracks(s); Cup.beginRound(s); s.phase = 'countdown'; Cup.startRace(s, 100000);
  assert.equal(Cup.recordFinish(s, 2, 30000, 130000), false);
  assert.equal(Cup.recordFinish(s, 1, 999999, 130000), false);
  assert.equal(Cup.recordFinish(s, 1, 30000, 130000), true);
  assert.equal(Cup.recordFinish(s, 1, 29000, 130100), false);
  assert.equal(Cup.recordFinish(s, 3, 40001, 140001), false);
  assert.equal(Cup.recordFinish(s, 3, 40000, 140500), true);
  Cup.markDNF(s, 5); assert.equal(Cup.recordFinish(s, 5, 31000, 131000), false);
  Cup.completeRound(s); assert.deepEqual(Cup.currentMatch(s).scores, { 1: 10, 3: 6, 5: 0, 7: 0 });
});
test('exact tied first shares points but never gives a finalist win', () => {
  const s = grid(); for (let i = 0; i < 12; i++) race(s, [1, 3, 5, 7], [30000, 30000, 31000, 32000]);
  assert.equal(Cup.currentMatch(s).scores[1], 120); assert.equal(Cup.currentMatch(s).scores[3], 120);
  race(s, [1, 3, 5, 7], [30000, 30000, 31000, 32000]); assert.deepEqual(Cup.currentMatch(s).winners, []);
  race(s, [3, 1, 5, 7]); assert.deepEqual(Cup.currentMatch(s).winners, [3]);
});
test('void preserves scores; undo restores finalist transitions and finished match', () => {
  const s = grid(); race(s); const scores = structuredClone(Cup.currentMatch(s).scores);
  Cup.beginRound(s); Cup.voidRound(s); assert.deepEqual(Cup.currentMatch(s).scores, scores);
  Cup.undoRound(s); assert.equal(Cup.currentMatch(s).rounds, 0);
  assert.deepEqual(Cup.currentMatch(s).scores, { 1: 0, 3: 0, 5: 0, 7: 0 });
  for (let i = 0; i < 12; i++) race(s); Cup.undoRound(s);
  assert.equal(Cup.currentMatch(s).scores[1], 110); assert.deepEqual(Cup.currentMatch(s).finalists, {});
});
test('round snapshots never expose undo history to clients', () => {
  const s = grid(); race(s); const snapshot = Cup.publicState(s);
  assert.equal('history' in snapshot, false); snapshot.roster[0].name = 'Changed';
  assert.equal(s.roster[0].name, 'Racer 1');
});
test('reconnect identity is explicit and cannot replace an active round', () => {
  const s = grid(); pickTracks(s); Cup.beginRound(s);
  assert.throws(() => Cup.rebindPlayer(s, 1, 9, 'Back'));
  Cup.voidRound(s); Cup.rebindPlayer(s, 1, 9, 'Back');
  assert.deepEqual(s.groups[0], [9, 3, 5, 7]); assert.equal(Cup.currentMatch(s).scores[9], 0);
  assert.throws(() => Cup.rebindPlayer(s, 9, 3, 'Duplicate'));
});
