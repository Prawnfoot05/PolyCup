// Competition state is owned by the native multiplayer host. No game internals here.
export const VERSION = '0.2.8';
export const RULES = Object.freeze({ points: [10, 8, 6, 5, 4, 3, 2, 1], target: 140, trackDrivingMs: 240000, fallbackRounds: 4, warmupMs: 15000, finishTimeoutMs: 10000 });
const copy = value => structuredClone(value);
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const safeName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);

export function newCup(name = 'Simple Cup') {
  return { schema: 2, version: VERSION, id: crypto.randomUUID(), name: safeName(name) || 'Simple Cup',
    revision: 0, phase: 'registration', roster: [], tracks: [], picks: {}, records: {},
    matches: [], matchIndex: -1, runtime: null, history: [], audit: [], results: [], disconnectPolicy: 'dnf' };
}
export function currentMatch(state) { return state.matches[state.matchIndex] ?? null; }
export function activeIds(state) {
  const m = currentMatch(state);
  return m ? m.players.filter(id => !m.winners.includes(id)) : [];
}
export function player(state, id) { return state.roster.find(p => p.id === id); }
export function note(state, message) {
  state.audit.push({ at: new Date().toISOString(), message: safeName(message) });
  state.audit = state.audit.slice(-500);
}
export function touch(state) { state.revision++; }
export function addPlayer(state, id, name) {
  requireThat(state.phase === 'registration', 'Registration is closed.');
  requireThat(Number.isSafeInteger(id) && id > 0, 'Invalid lobby player.');
  requireThat(state.roster.length < 8, 'All eight racer places are filled.');
  requireThat(!player(state, id), 'This player is already registered.');
  state.roster.push({ id, name: safeName(name) }); touch(state);
}
export function removePlayer(state, id) {
  requireThat(state.phase === 'registration', 'Registration is closed.');
  state.roster = state.roster.filter(p => p.id !== id);
  delete state.picks[id]; for (const r of Object.values(state.records)) delete r.pbs[id]; pruneTracks(state); touch(state);
}
function pruneTracks(state) {
  state.tracks = state.tracks.filter(t => Object.values(state.picks).includes(t.id));
  for (const id of Object.keys(state.records)) if (!state.tracks.some(t => t.id === id)) delete state.records[id];
}
export function chooseTrack(state, actor, track) {
  requireThat(state.phase === 'registration', 'Track picks are closed.');
  requireThat(player(state, actor), 'Join as a racer before choosing a track.');
  requireThat(typeof track.id === 'string' && /^[a-f0-9]{64}$/i.test(track.id), 'Invalid track ID.');
  if (!state.tracks.some(t => t.id === track.id)) state.tracks.push({ id: track.id, name: safeName(track.name) });
  state.picks[actor] = track.id; pruneTracks(state); touch(state);
}
export function lockRegistration(state, random = Math.random) {
  requireThat(state.phase === 'registration', 'The Cup has already started.');
  requireThat(state.roster.length >= 2 && state.roster.length <= 8, 'Two to eight racers can start a Cup.');
  requireThat(state.roster.every(p => state.tracks.some(t => t.id === state.picks[p.id])), 'Each racer needs to choose one track.');
  const order = state.tracks.map(t => t.id);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const players = state.roster.map(p => p.id);
  // Freeze the host's schedule before racing. Live WR updates cannot alter it.
  const trackRounds = Object.fromEntries(order.map(id => [id, roundsForRecord(state.records[id]?.wr)]));
  state.matches = [{ name: 'Simple Cup', players, target: RULES.target, winnerCount: 1, order,
    trackRounds, rounds: 0, winners: [], scores: Object.fromEntries(players.map(id => [id, 0])), finalists: {}, roundsLog: [], ranking: [] }];
  state.matchIndex = 0; state.phase = 'between-rounds'; touch(state);
}
export function roundsForRecord(wr) {
  // Native record frames are milliseconds. Use at least one complete race.
  return wr?.status === 'ready' && Number.isSafeInteger(wr.frames) && wr.frames > 0 && wr.frames <= 3600000
    ? Math.max(1, Math.round(RULES.trackDrivingMs / wr.frames)) : RULES.fallbackRounds;
}
export function trackProgress(state, completedRounds = currentMatch(state)?.rounds ?? 0) {
  const m = currentMatch(state);
  if (!m?.order.length) return null;
  // Saves created before 0.2.8 retain their original four-round rotation.
  const count = id => m.trackRounds?.[id] ?? RULES.fallbackRounds;
  const cycle = m.order.reduce((sum, id) => sum + count(id), 0);
  let offset = completedRounds % cycle;
  for (const trackId of m.order) {
    const rounds = count(trackId);
    if (offset < rounds) return { trackId, round: offset + 1, rounds };
    offset -= rounds;
  }
}
export function nextTrack(state) { return trackProgress(state)?.trackId ?? null; }
export function beginRound(state) {
  requireThat(state.phase === 'between-rounds', 'Finish setup or the current round first.');
  const m = currentMatch(state);
  const visit = trackProgress(state);
  state.runtime = { id: crypto.randomUUID(), round: m.rounds + 1, trackId: visit.trackId,
    warmup: visit.round === 1, sessionId: null, ready: [],
    startsAt: null, deadline: null, finishes: {}, dnfs: [], checkpoints: {} };
  state.phase = 'loading'; touch(state);
}
export function startRace(state, now) {
  requireThat(state.phase === 'countdown', 'A countdown is required before racing.');
  state.runtime.startsAt = now; state.phase = 'racing'; touch(state);
}
export function recordFinish(state, id, frames, now) {
  if (state.phase !== 'racing' || !activeIds(state).includes(id)) return false;
  const run = state.runtime;
  if (id in run.finishes || run.dnfs.includes(id)) return false;
  if (!Number.isSafeInteger(frames) || frames <= 0 || frames > 3600000) return false;
  // PolyTrack uses 1000 physics frames per second. Do not accept a finish from a prior run.
  if (frames > now - run.startsAt + 2000) return false;
  if (run.deadline !== null && (now > run.deadline + 1500 || frames > run.deadline - run.startsAt)) return false;
  run.finishes[id] = frames;
  const finishAt = run.startsAt + frames;
  run.deadline = Math.min(run.deadline ?? Infinity, finishAt + RULES.finishTimeoutMs);
  touch(state); return true;
}
export function markDNF(state, id) {
  requireThat(state.phase === 'racing', 'There is no live round.');
  requireThat(activeIds(state).includes(id), 'This player is not racing.');
  requireThat(!(id in state.runtime.finishes), 'A finished run cannot be changed to DNF.');
  if (!state.runtime.dnfs.includes(id)) { state.runtime.dnfs.push(id); touch(state); }
}
export function allFinished(state) {
  return activeIds(state).every(id => id in state.runtime.finishes || state.runtime.dnfs.includes(id));
}
export function completeRound(state) {
  requireThat(state.phase === 'racing', 'There is no live round.');
  const m = currentMatch(state), run = state.runtime;
  const before = copy(m), beforeRanking = rankMatch(state, m), ids = activeIds(state);
  const order = ids.filter(id => id in run.finishes).sort((a, b) => run.finishes[a] - run.finishes[b]);
  const placements = {};
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    placements[id] = i > 0 && run.finishes[id] === run.finishes[order[i - 1]] ? placements[order[i - 1]] : i + 1;
  }
  // Exact ties share points. A tied first never awards a finalist win: another round resolves it.
  const first = order[0], firstIsTied = order.length > 1 && run.finishes[first] === run.finishes[order[1]];
  if (first !== undefined && !firstIsTied && first in m.finalists) m.winners.push(first);
  const points = {};
  for (const id of order) {
    points[id] = id in m.finalists ? 0 : Math.min(m.target - m.scores[id], RULES.points[placements[id] - 1]);
    if (!(id in m.finalists)) {
      m.scores[id] = Math.min(m.target, m.scores[id] + points[id]);
      if (m.scores[id] === m.target) m.finalists[id] = { round: run.round,
        position: placements[id], checkpoint: run.checkpoints[id] ?? null };
    }
  }
  m.rounds++;
  m.roundsLog.push({ beforeRanking, round: run.round, trackId: run.trackId, finishes: copy(run.finishes), points,
    dnfs: ids.filter(id => !(id in run.finishes)), winners: [...m.winners], tiedFirst: firstIsTied });
  state.history.push({ matchIndex: state.matchIndex, before });
  state.runtime = null;
  if (m.winners.length) {
    m.ranking = rankMatch(state, m);
    state.results = m.ranking.map((id, i) => ({ id, place: i + 1 }));
    state.phase = 'complete';
  } else state.phase = 'between-rounds';
  refreshSessionRecords(state);
  touch(state);
}
export function rankMatch(state, m) {
  return [...m.winners, ...m.players.filter(id => !m.winners.includes(id)).sort((a, b) => {
    if (m.scores[a] !== m.scores[b]) return m.scores[b] - m.scores[a];
    const x = m.finalists[a], y = m.finalists[b];
    if (x && y) {
      if (x.round !== y.round) return x.round - y.round;
      if (x.position !== y.position) return x.position - y.position;
      if (x.checkpoint !== null && y.checkpoint !== null && x.checkpoint !== y.checkpoint) return x.checkpoint - y.checkpoint;
    }
    return 0; // Stable join order for display only; exact race ties always share points.
  })];
}
export function refreshSessionRecords(state) {
  for (const t of state.tracks) {
    const records = state.records[t.id] ??= { pbs: {} };
    records.tr = null;
    for (const m of state.matches) for (const r of m.roundsLog) if (r.trackId === t.id) {
      for (const [id, frames] of Object.entries(r.finishes)) {
        if (!records.tr || frames < records.tr.frames) records.tr = { frames, ids: [Number(id)] };
        else if (frames === records.tr.frames && !records.tr.ids.includes(Number(id))) records.tr.ids.push(Number(id));
      }
    }
  }
}
export function voidRound(state) {
  requireThat(['loading', 'warmup', 'countdown', 'racing'].includes(state.phase), 'There is no round to void.');
  state.runtime = null; state.phase = 'between-rounds'; note(state, 'Organizer voided the current round.'); touch(state);
}
export function undoRound(state) {
  requireThat(['between-rounds', 'match-complete', 'complete'].includes(state.phase), 'Void the live round first.');
  const last = state.history.at(-1);
  requireThat(last && last.matchIndex === state.matchIndex, 'No round in this match can be undone.');
  state.matches[state.matchIndex] = state.history.pop().before;
  refreshSessionRecords(state);
  state.results = []; state.phase = 'between-rounds'; note(state, 'Organizer undid the last scored round.'); touch(state);
}
export function rebindPlayer(state, oldId, newId, name) {
  requireThat(['registration', 'between-rounds', 'complete'].includes(state.phase),
    'Void the round before reconnecting a racer.');
  requireThat(player(state, oldId) && !player(state, newId) && Number.isSafeInteger(newId) && newId > 0, 'Choose a new lobby identity.');
  remapIdentities(state, new Map([[oldId, newId]]));
  player(state, newId).name = safeName(name);
  note(state, 'Organizer reassigned a disconnected racer.'); touch(state);
}
export function detachIdentities(state) {
  requireThat(!state.runtime, 'Void the round before detaching saved identities.');
  // A separate negative namespace avoids collisions with newly issued native peer IDs.
  remapIdentities(state, new Map(state.roster.map((p, i) => [p.id, -i - 1])));
}
function remapIdentities(state, mapping) {
  const idFor = id => mapping.get(Number(id)) ?? Number(id);
  const replace = values => values.map(idFor);
  const keys = value => Object.fromEntries(Object.entries(value).map(([id, v]) => [idFor(id), v]));
  const updateMatch = m => {
    m.players = replace(m.players); m.winners = replace(m.winners); m.ranking = replace(m.ranking);
    for (const key of ['scores', 'finalists']) m[key] = keys(m[key]);
    for (const round of m.roundsLog) {
      round.finishes = keys(round.finishes); round.points = keys(round.points);
      round.beforeRanking = replace(round.beforeRanking);
      round.dnfs = replace(round.dnfs); round.winners = replace(round.winners);
    }
  };
  state.roster.forEach(p => { p.id = idFor(p.id); });
  state.picks = keys(state.picks);
  for (const r of Object.values(state.records)) { r.pbs = keys(r.pbs); if (r.tr) r.tr.ids = replace(r.tr.ids); }
  state.matches.forEach(updateMatch);
  state.history.forEach(h => updateMatch(h.before));
  state.results.forEach(r => { r.id = idFor(r.id); });
}
export function publicState(state) { const { history, ...rest } = state; return copy(rest); }
