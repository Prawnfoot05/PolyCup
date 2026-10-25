import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitingRoomChatLines } from '../src/waiting-room-countdown.ts';
const start = { seq: 1, at: 10000, speaker: 0, color: 0, name: '', system: true, text: 'Match starting in 5…' };
const numbers = lines => lines.filter(l => /^Match starting/.test(l.text)).map(l => Number(l.text.match(/\d/)[0]));

test('all five countdown numbers appear from one snapshot, without per-second polls', () => {
  for (let elapsed = 0; elapsed <= 4; elapsed++)
    assert.deepEqual(numbers(waitingRoomChatLines([start], 10000 + elapsed * 1000)), [5, 4, 3, 2, 1].slice(0, elapsed + 1));
  assert.deepEqual(numbers(waitingRoomChatLines([start], 16000)), [5, 4, 3, 2, 1]);
  assert.equal(waitingRoomChatLines([start], 10999).length, 1);
});
test('cancellation stops the old countdown and retries have a separate timeline', () => {
  const cancelled = { ...start, seq: 2, at: 12500, text: 'Match start cancelled.' };
  const retry = { ...start, seq: 3, at: 15000 };
  assert.deepEqual(numbers(waitingRoomChatLines([start, cancelled], 19000)), [5, 4, 3]);
  assert.deepEqual(numbers(waitingRoomChatLines([start, cancelled, retry], 16000)), [5, 4, 3, 5, 4]);
});
test('late snapshots and legacy countdown lines do not duplicate numbers or reorder chat', () => {
  const message = { ...start, system: undefined, speaker: 2, name: 'Racer', seq: 2, at: 11500, text: 'Ready!' };
  const legacy = { ...start, seq: 3, at: 12200, text: 'Match starting in 3…' };
  const lines = waitingRoomChatLines([start, message, legacy], 15000);
  assert.deepEqual(numbers(lines), [5, 4, 3, 2, 1]);
  assert.equal(lines[2].text, 'Ready!');
  assert.deepEqual(lines.map(l => l.seq), [1, 2, 3, 4, 5, 6]);
});
