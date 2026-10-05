// Competition state is owned by the native multiplayer host. No game internals here.
export const VERSION = '0.1.1';
export const RULES = Object.freeze({ points: [10, 6, 4, 3], semiTarget: 120,
  finalTarget: 140, roundsPerTrack: 4, warmupMs: 15000, finishTimeoutMs: 10000 });
const copy = value => structuredClone(value);
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const safeName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);

export function newCup(name = 'World Cup') {
  return { schema: 1, version: VERSION, id: crypto.randomUUID(), name: safeName(name) || 'World Cup',
    revision: 0, phase: 'registration', roster: [], tracks: [], groups: [[], []],
    draft: [], matches: [], matchIndex: -1, runtime: null, history: [], audit: [], results: [], disconnectPolicy: null };
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
  state.roster.push({ id, name: safeName(name), seed: state.roster.length + 1 }); touch(state);
}
export function removePlayer(state, id) {
  requireThat(state.phase === 'registration', 'Registration is closed.');
  state.roster = state.roster.filter(p => p.id !== id);
  state.roster.forEach((p, i) => { p.seed = i + 1; }); touch(state);
}
export function moveSeed(state, id, delta) {
  requireThat(state.phase === 'registration', 'Seeding is locked.');
  const i = state.roster.findIndex(p => p.id === id), j = i + delta;
  requireThat(i >= 0 && j >= 0 && j < state.roster.length && Math.abs(delta) === 1, 'Invalid seed move.');
  [state.roster[i], state.roster[j]] = [state.roster[j], state.roster[i]];
  state.roster.forEach((p, k) => { p.seed = k + 1; }); touch(state);
}
export function addTrack(state, track) {
  requireThat(state.phase === 'registration', 'The track pack is locked.');
  requireThat(state.tracks.length < 5, 'The pack can contain up to five tracks.');
  requireThat(typeof track.id === 'string' && /^[a-f0-9]{64}$/i.test(track.id), 'Invalid track ID.');
  requireThat(!state.tracks.some(t => t.id === track.id), 'This track is already in the pack.');
  state.tracks.push({ id: track.id, name: safeName(track.name) }); touch(state);
}
export function lockRegistration(state) {
  requireThat(state.phase === 'registration', 'Registration is already closed.');
  requireThat(state.roster.length === 8, 'Register exactly eight racers.');
  requireThat(state.tracks.length >= 3 && state.tracks.length <= 5, 'Import three to five tracks.');
  state.groups = [[state.roster[0].id], [state.roster[1].id]];
  state.phase = 'group-picks'; touch(state);
}
export function groupPicker(state) {
  return state.phase === 'group-picks' ? state.groups[state.draft.length % 2][0] : null;
}
export function pickOpponent(state, actor, id) {
  requireThat(actor === groupPicker(state), 'It is the other captain’s turn.');
  requireThat(player(state, id) && !state.groups.flat().includes(id), 'Choose an unassigned racer.');
  state.groups[state.draft.length % 2].push(id); state.draft.push({ actor, id });
  if (state.draft.length === 6) {
    state.matches = [makeMatch('Semifinal A', state.groups[0], 120, 2),
      makeMatch('Semifinal B', state.groups[1], 120, 2)];
    state.matchIndex = 0; state.phase = 'track-picks';
  }
  touch(state);
}
function makeMatch(name, players, target, winnerCount) {
  return { name, players: [...players], target, winnerCount, order: [], rounds: 0, winners: [],
    scores: Object.fromEntries(players.map(id => [id, 0])), finalists: {}, roundsLog: [], ranking: [] };
}
export function trackPicker(state) {
  if (state.phase !== 'track-picks') return null;
  const m = currentMatch(state), seeds = [...m.players].sort((a, b) => player(state, a).seed - player(state, b).seed);
  return seeds[m.order.length % seeds.length];
}
export function pickTrack(state, actor, trackId) {
  requireThat(actor === trackPicker(state), 'It is another racer’s track pick.');
  const m = currentMatch(state);
  requireThat(state.tracks.some(t => t.id === trackId) && !m.order.includes(trackId), 'Choose an unpicked track.');
  m.order.push(trackId);
  if (m.order.length === state.tracks.length) state.phase = 'between-rounds';
  touch(state);
}
export function nextTrack(state) {
  const m = currentMatch(state);
  return m?.order[Math.floor(m.rounds / RULES.roundsPerTrack) % m.order.length] ?? null;
}
export function beginRound(state) {
  requireThat(state.phase === 'between-rounds', 'Finish picks or the current round first.');
  const m = currentMatch(state);
  state.runtime = { id: crypto.randomUUID(), round: m.rounds + 1, trackId: nextTrack(state),
    warmup: m.rounds % RULES.roundsPerTrack === 0, sessionId: null, ready: [],
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
  const before = copy(m), ids = activeIds(state);
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
    points[id] = id in m.finalists ? 0 : RULES.points[placements[id] - 1];
    if (!(id in m.finalists)) {
      m.scores[id] = Math.min(m.target, m.scores[id] + points[id]);
      if (m.scores[id] === m.target) m.finalists[id] = { round: run.round,
        position: placements[id], checkpoint: run.checkpoints[id] ?? null };
    }
  }
  m.rounds++;
  m.roundsLog.push({ round: run.round, trackId: run.trackId, finishes: copy(run.finishes), points,
    dnfs: ids.filter(id => !(id in run.finishes)), winners: [...m.winners], tiedFirst: firstIsTied });
  state.history.push({ matchIndex: state.matchIndex, before });
  state.runtime = null;
  if (m.winners.length >= m.winnerCount) {
    m.ranking = rankMatch(state, m); state.phase = 'match-complete';
    if (state.matchIndex === 2) {
      state.results = m.ranking.map((id, i) => ({ id, place: i + 1 }));
      for (const semi of state.matches.slice(0, 2)) {
        for (const id of semi.players.filter(id => !semi.winners.includes(id))) state.results.push({ id, place: '5–8' });
      }
      state.phase = 'complete';
    }
  } else state.phase = 'between-rounds';
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
    return player(state, a).seed - player(state, b).seed;
  })];
}
export function advanceMatch(state) {
  requireThat(state.phase === 'match-complete', 'Complete this match first.');
  if (state.matchIndex === 1) {
    state.matches.push(makeMatch('Grand final', state.matches.slice(0, 2).flatMap(m => m.winners), 140, 3));
  }
  state.matchIndex++; state.phase = 'track-picks'; state.runtime = null; touch(state);
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
  state.results = []; state.phase = 'between-rounds'; note(state, 'Organizer undid the last scored round.'); touch(state);
}
export function rebindPlayer(state, oldId, newId, name) {
  requireThat(['registration', 'group-picks', 'track-picks', 'between-rounds', 'match-complete', 'complete'].includes(state.phase),
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
      round.dnfs = replace(round.dnfs); round.winners = replace(round.winners);
    }
  };
  state.roster.forEach(p => { p.id = idFor(p.id); });
  state.draft.forEach(p => { p.actor = idFor(p.actor); p.id = idFor(p.id); });
  state.groups = state.groups.map(replace); state.matches.forEach(updateMatch);
  state.history.forEach(h => updateMatch(h.before));
  state.results.forEach(r => { r.id = idFor(r.id); });
}
export function publicState(state) { const { history, ...rest } = state; return copy(rest); }
