import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../matcher.ts';
test('maximum-length repetitive inputs complete without a quadratic candidate scan', () => {
  const run = {
    finish: 81920,
    events: Array.from({ length: 8192 }, (_, i) => [i * 10, i % 2 ? 3 : 1]),
  };
  assert.equal(
    compare(run, { ...run, id: 'repeat', rank: 1, track: 'test', gameVersion: '0.6.3' }),
    null,
  );
});

test('linear matcher agrees with exhaustive exact-span search on varied and repeated segments', () => {
  let seed = 17;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  const oracle = (run, ref) => {
    let best = 0;
    for (let i = 0; i < run.events.length - 24; i++)
      for (let j = 0; j < ref.events.length - 24; j++) {
        let n = 0;
        while (
          i + n + 1 < run.events.length &&
          j + n + 1 < ref.events.length &&
          run.events[i + n][1] === ref.events[j + n][1] &&
          run.events[i + n + 1][1] === ref.events[j + n + 1][1] &&
          run.events[i + n + 1][0] - run.events[i + n][0] ===
            ref.events[j + n + 1][0] - ref.events[j + n][0]
        )
          n++;
        if (n < 24) continue;
        const e = run.events.slice(i, i + n + 1),
          durations = e.slice(1).map((x, k) => x[0] - e[k][0]);
        if (
          e.at(-1)[0] - e[0][0] < 8000 ||
          new Set(e.map((x) => x[1])).size < 3 ||
          new Set(durations).size < 8 ||
          e.slice(1).filter((x, k) => (x[1] & 10) !== (e[k][1] & 10)).length < 8
        )
          continue;
        const whole =
          i === 0 &&
          j === 0 &&
          n === run.events.length - 1 &&
          n === ref.events.length - 1 &&
          run.finish === ref.finish;
        best = Math.max(best, (whole ? run.finish : e.at(-1)[0]) - e[0][0]);
      }
    return best;
  };
  for (let sample = 0; sample < 150; sample++) {
    let at = 0;
    const events = Array.from({ length: 80 }, (_, i) => {
      if (i) at += 200 + (random() % 700);
      return [at, [1, 3, 9, 5][i % 4]];
    });
    const ref = { events, finish: at + 100, id: 'r', rank: 1, track: 't', gameVersion: '0.6.3' };
    const first = random() % 40,
      count = 25 + (random() % 30),
      segment = events.slice(first, first + count);
    const run = {
      events: [[0, 0], ...segment.map(([time, mask]) => [time - segment[0][0] + 100, mask])],
      finish: segment.at(-1)[0] - segment[0][0] + 500,
    };
    const found = compare(run, ref);
    assert.equal(found ? found.end - found.start : 0, oracle(run, ref));
  }
});
