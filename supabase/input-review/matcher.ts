import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export type Event = [number, number];
export const POLICY = Object.freeze({
  version: 'exact-inputs-pilot-v1',
  transitions: 24,
  duration: 8000,
  states: 3,
  steeringChanges: 8,
  durations: 8,
});
export interface Run {
  events: Event[];
  finish: number;
}
export interface Reference extends Run {
  id: string;
  track: string;
  gameVersion: string;
  rank: number;
}
export interface Finding {
  reference: string;
  referenceRank: number;
  kind: 'whole' | 'segment';
  start: number;
  end: number;
  referenceStart: number;
  referenceEnd: number;
  transitions: number;
  coverage: number;
}
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 5999999;
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/** PolyTrack 0.6.3: five delta-coded little-endian uint24 toggle lists,
 * zlib + base64url. Timestamps are native 1 ms simulation steps, not render frames.
 * Bound decompression before inspecting attacker-controlled counts. */
export function decodeRecording(recording: string, finish: number): Run {
  if (
    !integer(finish) ||
    !finish ||
    typeof recording !== 'string' ||
    recording.length > 131072 ||
    !/^[A-Za-z0-9_-]+$/.test(recording)
  )
    throw Error('Invalid recording envelope');
  const bytes = inflateSync(Buffer.from(recording, 'base64url'), { maxOutputLength: 131072 });
  let offset = 0,
    count = 0;
  const toggles = new Map<number, number>();
  const read = () => {
    if (offset + 3 > bytes.length) throw Error('Truncated recording');
    const n = bytes.readUIntLE(offset, 3);
    offset += 3;
    return n;
  };
  for (let bit = 0; bit < 5; bit++) {
    const length = read();
    count += length;
    if (count > 8192 || offset + length * 3 > bytes.length) throw Error('Recording event limit');
    let at = 0;
    for (let i = 0; i < length; i++) {
      const delta = read();
      if (i && !delta) throw Error('Duplicate toggle');
      at += delta;
      if (!integer(at)) throw Error('Recording time limit');
      if (at <= finish) toggles.set(at, (toggles.get(at) ?? 0) ^ (1 << bit));
    }
  }
  if (offset !== bytes.length) throw Error('Trailing recording bytes');
  const events: Event[] = [];
  let mask = 0;
  if (!toggles.has(0)) events.push([0, 0]);
  for (const [at, toggle] of [...toggles].sort((a, b) => a[0] - b[0])) {
    mask ^= toggle;
    if (events.at(-1)?.[1] !== mask) events.push([at, mask]);
  }
  return { events, finish };
}

export function normalize(run: Run): Run {
  if (
    !integer(run.finish) ||
    !run.finish ||
    !Array.isArray(run.events) ||
    !run.events.length ||
    run.events.length > 8192
  )
    throw Error('Invalid input run');
  const events: Event[] = [];
  for (const event of run.events) {
    if (!Array.isArray(event) || event.length !== 2) throw Error('Invalid input event');
    const [at, mask] = event;
    if (
      !integer(at) ||
      at > run.finish ||
      !Number.isInteger(mask) ||
      mask < 0 ||
      mask > 31 ||
      at < (events.at(-1)?.[0] ?? 0)
    )
      throw Error('Invalid input event');
    if (events.at(-1)?.[0] === at) events[events.length - 1] = [at, mask];
    else events.push([at, mask]);
  }
  if (events[0][0] !== 0) throw Error('Missing initial state');
  return { finish: run.finish, events: events.filter((e, i) => !i || e[1] !== events[i - 1][1]) };
}
const tokens = (r: Run) =>
  r.events.slice(0, -1).map((e, i) => `${e[1]}:${r.events[i + 1][0] - e[0]}:${r.events[i + 1][1]}`);
/** A suffix automaton finds exact token spans in linear time. Identical tokens
 * contain the original state, duration and next state; there is no hash collision
 * or timing tolerance. Longest suffixes dominate shorter suffixes for every
 * complexity threshold, so no qualifying shorter candidate is discarded. */
export function compare(runValue: Run, referenceValue: Reference): Finding | null {
  const run = normalize(runValue),
    ref = normalize(referenceValue),
    a = tokens(run),
    b = tokens(ref);
  if (a.length < POLICY.transitions || b.length < POLICY.transitions) return null;
  type State = { next: Map<string, number>; link: number; length: number; end: number };
  const states: State[] = [{ next: new Map(), link: -1, length: 0, end: -1 }];
  let last = 0;
  for (let j = 0; j < b.length; j++) {
    const current = states.length;
    states.push({ next: new Map(), link: 0, length: states[last].length + 1, end: j });
    let p = last;
    while (p >= 0 && !states[p].next.has(b[j])) {
      states[p].next.set(b[j], current);
      p = states[p].link;
    }
    if (p >= 0) {
      const q = states[p].next.get(b[j])!;
      if (states[p].length + 1 === states[q].length) states[current].link = q;
      else {
        const clone = states.length;
        states.push({
          next: new Map(states[q].next),
          link: states[q].link,
          length: states[p].length + 1,
          end: states[q].end,
        });
        while (p >= 0 && states[p].next.get(b[j]) === q) {
          states[p].next.set(b[j], clone);
          p = states[p].link;
        }
        states[q].link = states[current].link = clone;
      }
    }
    last = current;
  }
  let state = 0,
    length = 0,
    best: Finding | null = null;
  const lastMask = new Int32Array(32).fill(-1),
    durations = new Map<number, number>(),
    steering = [0];
  lastMask[run.events[0][1]] = 0;
  for (let i = 0; i < a.length; i++) {
    const duration = run.events[i + 1][0] - run.events[i][0];
    durations.delete(duration);
    durations.set(duration, i);
    if (durations.size > POLICY.durations) durations.delete(durations.keys().next().value!);
    lastMask[run.events[i + 1][1]] = i + 1;
    steering.push(steering[i] + Number((run.events[i][1] & 10) !== (run.events[i + 1][1] & 10)));
    while (state && !states[state].next.has(a[i])) {
      state = states[state].link;
      length = Math.min(length, states[state].length);
    }
    const next = states[state].next.get(a[i]);
    if (next === undefined) {
      state = 0;
      length = 0;
      continue;
    }
    state = next;
    length++;
    const start = i - length + 1,
      endIndex = i + 1,
      referenceStart = states[state].end - length + 1;
    if (
      length < POLICY.transitions ||
      run.events[endIndex][0] - run.events[start][0] < POLICY.duration ||
      steering[endIndex] - steering[start] < POLICY.steeringChanges ||
      [...lastMask].filter((at) => at >= start).length < POLICY.states ||
      durations.size < POLICY.durations ||
      [...durations.values()].some((at) => at < start)
    )
      continue;
    const whole =
      start === 0 &&
      referenceStart === 0 &&
      length === a.length &&
      length === b.length &&
      run.finish === ref.finish;
    const end = whole ? run.finish : run.events[endIndex][0];
    if (best && end - run.events[start][0] <= best.end - best.start) continue;
    best = {
      reference: referenceValue.id,
      referenceRank: referenceValue.rank,
      kind: whole ? 'whole' : 'segment',
      start: run.events[start][0],
      end,
      referenceStart: ref.events[referenceStart][0],
      referenceEnd: whole ? ref.finish : ref.events[states[state].end + 1][0],
      transitions: length,
      coverage: (end - run.events[start][0]) / run.finish,
    };
  }
  return best;
}
export function inspect(run: Run, track: string, gameVersion: string, references: Reference[]) {
  return references
    .filter((r) => r.track === track && r.gameVersion === gameVersion)
    .map((r) => compare(run, r))
    .filter((f): f is Finding => !!f)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 3);
}
