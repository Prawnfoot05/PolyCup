import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Ranked, rankedPreset, rankBadgeText, rankedLobbyControls } from '../src/ranked.ts';

test('ranked preview agrees with the complete server rules snapshot', async () => {
  const sql = await readFile('supabase/migrations/20261021070000_ranked_foundation.sql', 'utf8');
  const snapshot = JSON.parse(sql.match(/select '(\{"version":1,[\s\S]*?\})'::jsonb/)[1]);
  const { version, minPlayers, maxPlayers, targetPlayers, ...rules } = snapshot;
  assert.deepEqual(rankedPreset().rules, rules);
  assert.equal(version, 1);
  assert.deepEqual([minPlayers, maxPlayers, targetPlayers], [2, 4, 4]);
});

test('GM presentation prioritizes position, with rating on the second line', () => {
  assert.deepEqual(rankBadgeText({ tier: 'grandmaster', gm_position: 1, rating: 3124 }),
    { primary: 'RANK 1', secondary: '3124' });
  assert.deepEqual(rankBadgeText({ tier: 'master', gm_position: null, rating: 3124 }),
    { primary: '3124', secondary: null });
});

test('ranked controls never expose custom Cup host privileges or invitations', () => {
  for (const status of ['reserved','drafting','racing','review','disputed','completed','cancelled','unrated']) {
    const controls = rankedLobbyControls(status);
    for (const key of ['invite','roomCode','visibility','editPreset','manageRacers','returnToLobby','changeTrack','editScores','hostStart','hostEnd'])
      assert.equal(controls[key], false, `${status}: ${key}`);
    assert.equal(controls.decline, status === 'reserved');
    assert.equal(controls.draft, status === 'drafting');
    assert.equal(controls.friends, true);
  }
});

test('ranked client is idle until used and propagates errors without fake success', async () => {
  const calls = [];
  let reply = { data: [], error: null };
  const ranked = new Ranked({ rpc(name, args) {
    calls.push({ name, args });
    return { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return Promise.resolve(reply); } };
  } });
  assert.equal(calls.length, 0);
  assert.equal(await ranked.profile('player'), null);
  await ranked.leaderboard(10, 20);
  assert.deepEqual(calls.at(-1), { name: 'polycup_leaderboard', args: { page_size: 10, page_offset: 20 } });
  reply = { data: null, error: { message: 'This player is active in another window.' } };
  await assert.rejects(ranked.member('match', 'instance'), /another window/);
  assert.equal(typeof ranked.finalize, 'undefined');
});
