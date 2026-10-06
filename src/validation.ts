import type { ScoredRound, Match } from './types.ts';
import * as Cup from './cup.ts';
import { validDraft } from './draft.ts';
import type { CupState, PublicCupState, RaceRecord } from './types.ts';
export function validSnapshot(value: unknown): value is PublicCupState {
  const s = value as CupState;
  const obj = (o: unknown) => !!o && typeof o === 'object' && !Array.isArray(o);
  const text = (t: unknown) => typeof t === 'string' && t.length <= 128;
  const num = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const frames = (n: unknown) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 3600000;
  if (
    !obj(s) ||
    s.schema !== 2 ||
    !text(s.id) ||
    !text(s.name) ||
    !num(s.revision) ||
    ![
      'registration',
      'loading',
      'warmup',
      'countdown',
      'racing',
      'between-rounds',
      'complete',
    ].includes(s.phase) ||
    !['dnf', 'void'].includes(s.disconnectPolicy) ||
    !Array.isArray(s.roster) ||
    s.roster.length > 8 ||
    !s.roster.every(
      (p) =>
        obj(p) &&
        Number.isSafeInteger(p.id) &&
        p.id !== 0 &&
        text(p.name) &&
        (p.countryCode == null ||
          (typeof p.countryCode === 'string' && /^[a-z]{2}$/i.test(p.countryCode))),
    ) ||
    new Set(s.roster.map((p) => p.id)).size !== s.roster.length ||
    !Array.isArray(s.tracks) ||
    s.tracks.length > 8 ||
    !s.tracks.every(
      (t) => obj(t) && typeof t.id === 'string' && /^[a-f0-9]{64}$/i.test(t.id) && text(t.name),
    ) ||
    new Set(s.tracks.map((t) => t.id)).size !== s.tracks.length
  )
    return false;
  const ids = (values: unknown) =>
    Array.isArray(values) &&
    values.length <= 8 &&
    values.every((id) => s.roster.some((p) => p.id === id)) &&
    new Set(values).size === values.length;
  const times = (o: Record<string, number>) =>
    obj(o) &&
    Object.keys(o).length <= 8 &&
    Object.entries(o).every(([id, n]) => s.roster.some((p) => p.id === Number(id)) && num(n));
  const trackId = (id: string) => s.tracks.some((t) => t.id === id);
  if (
    !obj(s.picks) ||
    Object.entries(s.picks).some(([id, t]) => !ids([Number(id)]) || !trackId(t)) ||
    !obj(s.records) ||
    Object.keys(s.records).length > 8 ||
    !validDraft(s)
  )
    return false;
  for (const [id, r] of Object.entries(s.records)) {
    if (!trackId(id) || !obj(r) || !obj(r.pbs) || Object.keys(r.pbs).length > 8) return false;
    for (const [id, p] of Object.entries(r.pbs))
      if (!ids([Number(id)]) || !validPB(p)) return false;
    if (r.wr && !validWR(r.wr)) return false;
    if (r.tr && (!obj(r.tr) || !frames(r.tr.frames) || !ids(r.tr.ids))) return false;
  }
  const round = (r: ScoredRound) =>
    obj(r) &&
    num(r.round) &&
    trackId(r.trackId) &&
    times(r.finishes) &&
    times(r.points) &&
    ids(r.dnfs) &&
    ids(r.winners) &&
    ids(r.beforeRanking);
  const match = (m: Match) =>
    obj(m) &&
    text(m.name) &&
    ids(m.players) &&
    m.players.length >= 2 &&
    ids(m.winners) &&
    ids(m.ranking) &&
    ((m.target === 100 && m.trackRounds === undefined) ||
      (m.target === Cup.RULES.target && obj(m.trackRounds))) &&
    m.winnerCount === 1 &&
    m.winners.length <= 1 &&
    num(m.rounds) &&
    Array.isArray(m.order) &&
    m.order.length >= 1 &&
    m.order.length <= 8 &&
    m.order.every(trackId) &&
    new Set(m.order).size === m.order.length &&
    (m.trackRounds === undefined ||
      (Object.keys(m.trackRounds).length === m.order.length &&
        m.order.every(
          (id) =>
            num(m.trackRounds![id]) &&
            m.trackRounds![id] >= 1 &&
            m.trackRounds![id] <= Cup.RULES.trackDrivingMs,
        ))) &&
    (m.trackWarmups === undefined ||
      (obj(m.trackWarmups) &&
        Object.keys(m.trackWarmups).length === m.order.length &&
        m.order.every(
          (id) =>
            num(m.trackWarmups![id]) &&
            m.trackWarmups![id] >= 30000 &&
            m.trackWarmups![id] <= 5400000,
        ))) &&
    times(m.scores) &&
    m.players.every((id) => num(m.scores[id]) && m.scores[id] <= m.target) &&
    obj(m.finalists) &&
    Object.entries(m.finalists).every(
      ([id, f]) =>
        m.players.includes(Number(id)) &&
        obj(f) &&
        num(f.round) &&
        num(f.position) &&
        (f.checkpoint === null || num(f.checkpoint)),
    ) &&
    Array.isArray(m.roundsLog) &&
    m.roundsLog.every(round);
  if (
    !Array.isArray(s.matches) ||
    s.matches.length > 1 ||
    !s.matches.every(match) ||
    s.matchIndex !== (s.matches.length ? 0 : -1) ||
    (s.phase !== 'registration' && !s.matches.length) ||
    !Array.isArray(s.audit) ||
    !s.audit.every((a) => obj(a) && text(a.message) && text(a.at)) ||
    !Array.isArray(s.results) ||
    s.results.length > 8 ||
    !s.results.every(
      (r) => obj(r) && ids([r.id]) && Number.isInteger(r.place) && r.place >= 1 && r.place <= 8,
    ) ||
    (s.history !== undefined &&
      (!Array.isArray(s.history) ||
        !s.history.every((h) => obj(h) && h.matchIndex === 0 && match(h.before))))
  )
    return false;
  const r = s.runtime;
  if (!['loading', 'warmup', 'countdown', 'racing'].includes(s.phase)) return r === null;
  return (
    !!r &&
    obj(r) &&
    text(r.id) &&
    num(r.round) &&
    trackId(r.trackId) &&
    (r.sessionId === null || num(r.sessionId)) &&
    typeof r.warmup === 'boolean' &&
    ids(r.ready) &&
    (r.practiceReady === undefined || ids(r.practiceReady)) &&
    ids(r.dnfs) &&
    times(r.finishes) &&
    times(r.checkpoints) &&
    (r.splits === undefined ||
      (obj(r.splits) &&
        Object.keys(r.splits).length <= 8 &&
        Object.entries(r.splits).every(
          ([id, p]) =>
            ids([Number(id)]) &&
            obj(p) &&
            num(p.index) &&
            num(p.frames) &&
            p.frames! > 0 &&
            p.frames! <= 3600000 &&
            num(p.bestFrames) &&
            p.bestFrames > 0 &&
            p.bestFrames <= p.frames,
        ))) &&
    (r.liveMovement === undefined ||
      (obj(r.liveMovement) &&
        Object.keys(r.liveMovement).length <= 8 &&
        Object.entries(r.liveMovement).every(
          ([id, n]) => ids([Number(id)]) && Number.isInteger(n) && Math.abs(n) <= 7,
        ))) &&
    (r.startsAt === null || Number.isFinite(r.startsAt)) &&
    (r.deadline === null || Number.isFinite(r.deadline))
  );
}
export function validWR(value: unknown): value is RaceRecord {
  const wr = value as RaceRecord;
  return (
    !!wr &&
    !Array.isArray(wr) &&
    ['ready', 'missing', 'unavailable'].includes(wr.status) &&
    (wr.status !== 'ready' ||
      (Number.isSafeInteger(wr.frames) &&
        wr.frames! > 0 &&
        wr.frames! <= 3600000 &&
        typeof wr.name === 'string' &&
        wr.name.length <= 128))
  );
}
export function validPB(value: unknown): value is RaceRecord {
  const p = value as RaceRecord;
  return (
    !!p &&
    ['ready', 'missing', 'unavailable'].includes(p.status) &&
    (p.status !== 'ready' ||
      (Number.isSafeInteger(p.frames) &&
        p.frames! > 0 &&
        p.frames! <= 3600000 &&
        ['profile', 'online'].includes(p.source ?? '')))
  );
}
