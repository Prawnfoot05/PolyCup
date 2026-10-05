// src/cup.mjs
var VERSION = "0.2.10";
var RULES = Object.freeze({ points: [10, 8, 6, 5, 4, 3, 2, 1], target: 140, trackDrivingMs: 24e4, fallbackRounds: 4, warmupMs: 15e3, finishTimeoutMs: 1e4 });
var copy = (value) => structuredClone(value);
var requireThat = (ok, message) => {
  if (!ok) throw new Error(message);
};
var safeName = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64);
function newCup(name = "Simple Cup") {
  return {
    schema: 2,
    version: VERSION,
    id: crypto.randomUUID(),
    name: safeName(name) || "Simple Cup",
    revision: 0,
    phase: "registration",
    roster: [],
    tracks: [],
    picks: {},
    records: {},
    matches: [],
    matchIndex: -1,
    runtime: null,
    history: [],
    audit: [],
    results: [],
    disconnectPolicy: "dnf"
  };
}
function currentMatch(state) {
  return state.matches[state.matchIndex] ?? null;
}
function activeIds(state) {
  const m = currentMatch(state);
  return m ? m.players.filter((id) => !m.winners.includes(id)) : [];
}
function player(state, id) {
  return state.roster.find((p) => p.id === id);
}
function roundDone(state, id) {
  return state?.phase === "racing" && !!state.runtime && (id in state.runtime.finishes || state.runtime.dnfs.includes(id));
}
function mayWatch(state, id) {
  return !!state && state.phase !== "complete" && (!activeIds(state).includes(id) || roundDone(state, id));
}
function rematch(state, newTracks = false) {
  requireThat(state.phase === "complete", "Finish the Cup before starting a rematch.");
  const next = newCup(state.name);
  next.roster = copy(state.roster);
  next.disconnectPolicy = state.disconnectPolicy;
  if (!newTracks) {
    next.tracks = copy(state.tracks);
    next.picks = copy(state.picks);
  }
  return next;
}
function note(state, message) {
  state.audit.push({ at: (/* @__PURE__ */ new Date()).toISOString(), message: safeName(message) });
  state.audit = state.audit.slice(-500);
}
function touch(state) {
  state.revision++;
}
function addPlayer(state, id, name) {
  requireThat(state.phase === "registration", "Registration is closed.");
  requireThat(Number.isSafeInteger(id) && id > 0, "Invalid lobby player.");
  requireThat(state.roster.length < 8, "All eight racer places are filled.");
  requireThat(!player(state, id), "This player is already registered.");
  state.roster.push({ id, name: safeName(name) });
  touch(state);
}
function removePlayer(state, id) {
  requireThat(state.phase === "registration", "Registration is closed.");
  state.roster = state.roster.filter((p) => p.id !== id);
  delete state.picks[id];
  for (const r of Object.values(state.records)) delete r.pbs[id];
  pruneTracks(state);
  touch(state);
}
function pruneTracks(state) {
  state.tracks = state.tracks.filter((t) => Object.values(state.picks).includes(t.id));
  for (const id of Object.keys(state.records)) if (!state.tracks.some((t) => t.id === id)) delete state.records[id];
}
function chooseTrack(state, actor, track) {
  requireThat(state.phase === "registration", "Track picks are closed.");
  requireThat(player(state, actor), "Join as a racer before choosing a track.");
  requireThat(typeof track.id === "string" && /^[a-f0-9]{64}$/i.test(track.id), "Invalid track ID.");
  if (!state.tracks.some((t) => t.id === track.id)) state.tracks.push({ id: track.id, name: safeName(track.name) });
  state.picks[actor] = track.id;
  pruneTracks(state);
  touch(state);
}
function lockRegistration(state, random = Math.random) {
  requireThat(state.phase === "registration", "The Cup has already started.");
  requireThat(state.roster.length >= 2 && state.roster.length <= 8, "Two to eight racers can start a Cup.");
  requireThat(state.roster.every((p) => state.tracks.some((t) => t.id === state.picks[p.id])), "Each racer needs to choose one track.");
  const order = state.tracks.map((t) => t.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const players = state.roster.map((p) => p.id);
  const trackRounds = Object.fromEntries(order.map((id) => [id, roundsForRecord(state.records[id]?.wr)]));
  const trackWarmups = Object.fromEntries(order.map((id) => [id, practiceForRecord(state.records[id]?.wr)]));
  state.matches = [{
    name: "Simple Cup",
    players,
    target: RULES.target,
    winnerCount: 1,
    order,
    trackRounds,
    trackWarmups,
    rounds: 0,
    winners: [],
    scores: Object.fromEntries(players.map((id) => [id, 0])),
    finalists: {},
    roundsLog: [],
    ranking: []
  }];
  state.matchIndex = 0;
  state.phase = "between-rounds";
  touch(state);
}
function roundsForRecord(wr) {
  return wr?.status === "ready" && Number.isSafeInteger(wr.frames) && wr.frames > 0 && wr.frames <= 36e5 ? Math.max(1, Math.round(RULES.trackDrivingMs / wr.frames)) : RULES.fallbackRounds;
}
function practiceForRecord(wr) {
  const duration = wr?.status === "ready" && Number.isSafeInteger(wr.frames) && wr.frames > 0 && wr.frames <= 36e5 ? wr.frames : RULES.trackDrivingMs / RULES.fallbackRounds;
  return Math.max(3e4, Math.ceil(duration * 1.5));
}
function practiceReady(state, id, roundId) {
  if (state.phase !== "warmup" || state.runtime?.id !== roundId || !activeIds(state).includes(id)) return false;
  const ready = state.runtime.practiceReady ??= [];
  if (ready.includes(id)) return false;
  ready.push(id);
  touch(state);
  return true;
}
function trackProgress(state, completedRounds = currentMatch(state)?.rounds ?? 0) {
  const m = currentMatch(state);
  if (!m?.order.length) return null;
  const count = (id) => m.trackRounds?.[id] ?? RULES.fallbackRounds;
  const cycle = m.order.reduce((sum, id) => sum + count(id), 0);
  let offset = completedRounds % cycle;
  for (const trackId of m.order) {
    const rounds = count(trackId);
    if (offset < rounds) return { trackId, round: offset + 1, rounds };
    offset -= rounds;
  }
}
function nextTrack(state) {
  return trackProgress(state)?.trackId ?? null;
}
function beginRound(state) {
  requireThat(state.phase === "between-rounds", "Finish setup or the current round first.");
  const m = currentMatch(state);
  const visit = trackProgress(state);
  const firstVisit = !m.roundsLog.some((r) => r.trackId === visit.trackId);
  state.runtime = {
    id: crypto.randomUUID(),
    round: m.rounds + 1,
    trackId: visit.trackId,
    warmup: visit.round === 1 && (m.trackWarmups === void 0 || firstVisit),
    sessionId: null,
    ready: [],
    practiceReady: [],
    startsAt: null,
    deadline: null,
    finishes: {},
    dnfs: [],
    checkpoints: {}
  };
  state.phase = "loading";
  touch(state);
}
function startRace(state, now) {
  requireThat(state.phase === "countdown", "A countdown is required before racing.");
  state.runtime.startsAt = now;
  state.phase = "racing";
  touch(state);
}
function recordFinish(state, id, frames, now) {
  if (state.phase !== "racing" || !activeIds(state).includes(id)) return false;
  const run = state.runtime;
  if (id in run.finishes || run.dnfs.includes(id)) return false;
  if (!Number.isSafeInteger(frames) || frames <= 0 || frames > 36e5) return false;
  if (frames > now - run.startsAt + 2e3) return false;
  if (run.deadline !== null && (now > run.deadline + 1500 || frames > run.deadline - run.startsAt)) return false;
  run.finishes[id] = frames;
  const finishAt = run.startsAt + frames;
  run.deadline = Math.min(run.deadline ?? Infinity, finishAt + RULES.finishTimeoutMs);
  touch(state);
  return true;
}
function markDNF(state, id) {
  requireThat(state.phase === "racing", "There is no live round.");
  requireThat(activeIds(state).includes(id), "This player is not racing.");
  requireThat(!(id in state.runtime.finishes), "A finished run cannot be changed to DNF.");
  if (!state.runtime.dnfs.includes(id)) {
    state.runtime.dnfs.push(id);
    touch(state);
  }
}
function allFinished(state) {
  return activeIds(state).every((id) => id in state.runtime.finishes || state.runtime.dnfs.includes(id));
}
function completeRound(state) {
  requireThat(state.phase === "racing", "There is no live round.");
  const m = currentMatch(state), run = state.runtime;
  const before = copy(m), beforeRanking = rankMatch(state, m), ids = activeIds(state);
  const order = ids.filter((id) => id in run.finishes).sort((a, b) => run.finishes[a] - run.finishes[b]);
  const placements = {};
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    placements[id] = i > 0 && run.finishes[id] === run.finishes[order[i - 1]] ? placements[order[i - 1]] : i + 1;
  }
  const first = order[0], firstIsTied = order.length > 1 && run.finishes[first] === run.finishes[order[1]];
  if (first !== void 0 && !firstIsTied && first in m.finalists) m.winners.push(first);
  const points = {};
  for (const id of order) {
    points[id] = id in m.finalists ? 0 : Math.min(m.target - m.scores[id], RULES.points[placements[id] - 1]);
    if (!(id in m.finalists)) {
      m.scores[id] = Math.min(m.target, m.scores[id] + points[id]);
      if (m.scores[id] === m.target) m.finalists[id] = {
        round: run.round,
        position: placements[id],
        checkpoint: run.checkpoints[id] ?? null
      };
    }
  }
  m.rounds++;
  m.roundsLog.push({
    beforeRanking,
    round: run.round,
    trackId: run.trackId,
    finishes: copy(run.finishes),
    points,
    dnfs: ids.filter((id) => !(id in run.finishes)),
    winners: [...m.winners],
    tiedFirst: firstIsTied
  });
  state.history.push({ matchIndex: state.matchIndex, before });
  state.runtime = null;
  if (m.winners.length) {
    m.ranking = rankMatch(state, m);
    state.results = m.ranking.map((id, i) => ({ id, place: i + 1 }));
    state.phase = "complete";
  } else state.phase = "between-rounds";
  refreshSessionRecords(state);
  touch(state);
}
function rankMatch(state, m) {
  return [...m.winners, ...m.players.filter((id) => !m.winners.includes(id)).sort((a, b) => {
    if (m.scores[a] !== m.scores[b]) return m.scores[b] - m.scores[a];
    const x = m.finalists[a], y = m.finalists[b];
    if (x && y) {
      if (x.round !== y.round) return x.round - y.round;
      if (x.position !== y.position) return x.position - y.position;
      if (x.checkpoint !== null && y.checkpoint !== null && x.checkpoint !== y.checkpoint) return x.checkpoint - y.checkpoint;
    }
    return 0;
  })];
}
function refreshSessionRecords(state) {
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
function voidRound(state) {
  requireThat(["loading", "warmup", "countdown", "racing"].includes(state.phase), "There is no round to void.");
  state.runtime = null;
  state.phase = "between-rounds";
  note(state, "Organizer voided the current round.");
  touch(state);
}
function undoRound(state) {
  requireThat(["between-rounds", "match-complete", "complete"].includes(state.phase), "Void the live round first.");
  const last = state.history.at(-1);
  requireThat(last && last.matchIndex === state.matchIndex, "No round in this match can be undone.");
  state.matches[state.matchIndex] = state.history.pop().before;
  refreshSessionRecords(state);
  state.results = [];
  state.phase = "between-rounds";
  note(state, "Organizer undid the last scored round.");
  touch(state);
}
function rebindPlayer(state, oldId, newId, name) {
  requireThat(
    ["registration", "between-rounds", "complete"].includes(state.phase),
    "Void the round before reconnecting a racer."
  );
  requireThat(player(state, oldId) && !player(state, newId) && Number.isSafeInteger(newId) && newId > 0, "Choose a new lobby identity.");
  remapIdentities(state, /* @__PURE__ */ new Map([[oldId, newId]]));
  player(state, newId).name = safeName(name);
  note(state, "Organizer reassigned a disconnected racer.");
  touch(state);
}
function detachIdentities(state) {
  requireThat(!state.runtime, "Void the round before detaching saved identities.");
  remapIdentities(state, new Map(state.roster.map((p, i) => [p.id, -i - 1])));
}
function remapIdentities(state, mapping) {
  const idFor = (id) => mapping.get(Number(id)) ?? Number(id);
  const replace = (values) => values.map(idFor);
  const keys = (value) => Object.fromEntries(Object.entries(value).map(([id, v]) => [idFor(id), v]));
  const updateMatch = (m) => {
    m.players = replace(m.players);
    m.winners = replace(m.winners);
    m.ranking = replace(m.ranking);
    for (const key of ["scores", "finalists"]) m[key] = keys(m[key]);
    for (const round of m.roundsLog) {
      round.finishes = keys(round.finishes);
      round.points = keys(round.points);
      round.beforeRanking = replace(round.beforeRanking);
      round.dnfs = replace(round.dnfs);
      round.winners = replace(round.winners);
    }
  };
  state.roster.forEach((p) => {
    p.id = idFor(p.id);
  });
  state.picks = keys(state.picks);
  for (const r of Object.values(state.records)) {
    r.pbs = keys(r.pbs);
    if (r.tr) r.tr.ids = replace(r.tr.ids);
  }
  state.matches.forEach(updateMatch);
  state.history.forEach((h2) => updateMatch(h2.before));
  state.results.forEach((r) => {
    r.id = idFor(r.id);
  });
}
function publicState(state) {
  const { history, ...rest } = state;
  return copy(rest);
}

// src/spectator.mjs
var VIEW_DELAY_MS = 250;
var vector = (p) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7);
var rotation = (p) => Array.isArray(p) && p.length === 4 && p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) && Math.abs(Math.hypot(...p) - 1) < 0.02;
function validPose(p) {
  return !!p && Number.isSafeInteger(p.sessionId) && Number.isFinite(p.at) && Array.isArray(p.position) && p.position.length === 3 && p.position.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7) && Array.isArray(p.quaternion) && p.quaternion.length === 4 && p.quaternion.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) && Math.abs(Math.hypot(...p.quaternion) - 1) < 0.02 && Number.isFinite(p.fov) && p.fov >= 5 && p.fov <= 175 && Number.isSafeInteger(p.frames) && p.frames >= 0 && p.frames <= 36e5 && Number.isFinite(p.speed) && Math.abs(p.speed) < 1e5 && vector(p.carPosition) && rotation(p.carQuaternion) && [0, 1].includes(p.view);
}
function mixRotation(a, b, t) {
  let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  const angle = Math.acos(dot), sine = Math.sin(angle);
  const x = dot > 0.9995 ? 1 - t : Math.sin((1 - t) * angle) / sine;
  const y = dot > 0.9995 ? t : Math.sin(t * angle) / sine;
  const q = a.map((v, i) => x * v + y * b[i] * sign), length = Math.hypot(...q);
  return q.map((v) => v / length);
}
var mixPosition = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function rotateVector(v, q) {
  const norm = Math.hypot(...q), [x, y, z, w] = q.map((n) => n / norm), [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}
function cameraOffset(p) {
  const delta = p.position.map((v, i) => v - p.carPosition[i]);
  return rotateVector(delta, p.quaternion.map((v, i) => i === 3 ? v : -v));
}
function mixCameraPosition(a, b, t, carPosition, quaternion) {
  const start = cameraOffset(a), end = cameraOffset(b), local = mixPosition(start, end, t);
  const distance = Math.hypot(...start) * (1 - t) + Math.hypot(...end) * t, length = Math.hypot(...local);
  const direction = length > 1e-8 ? local : t < 0.5 ? start : end, magnitude = Math.hypot(...direction);
  const offset = rotateVector(magnitude > 1e-8 ? direction.map((v) => v * distance / magnitude) : direction, quaternion);
  return carPosition.map((v, i) => v + offset[i]);
}
function renderCarPose(car, pose) {
  if (!car || !pose?.carPosition) return;
  const position = car.getPosition().fromArray(pose.carPosition);
  const quaternion = car.getQuaternion().fromArray(pose.carQuaternion);
  const saved = ["getPosition", "getQuaternion"].map((key) => [key, Object.getOwnPropertyDescriptor(car, key)]);
  try {
    car.getPosition = () => position.clone();
    car.getQuaternion = () => quaternion.clone();
    car.update(0);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(car, key, descriptor);
      else delete car[key];
    }
  }
}
var CameraBuffer = class {
  constructor() {
    this.frames = [];
    this.playhead = null;
    this.lastTick = null;
  }
  push(p) {
    if (!validPose(p)) return false;
    const last = this.frames.at(-1);
    if (last && last.sessionId === p.sessionId && last.at >= p.at) return false;
    if (last && (last.sessionId !== p.sessionId || p.frames < last.frames)) {
      this.frames = [];
      this.playhead = null;
      this.lastTick = null;
    }
    this.frames.push(p);
    this.frames = this.frames.slice(-40);
    return true;
  }
  sample(at, sessionId) {
    const frames = this.frames.filter((p) => p.sessionId === sessionId);
    if (!frames.length || at - frames.at(-1).at > 1500) return null;
    const bIndex = frames.findIndex((p) => p.at >= at);
    if (bIndex < 1) return bIndex === 0 ? frames[0] : frames.at(-1);
    const a = frames[bIndex - 1], b = frames[bIndex], t = Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at)));
    if (a.view !== b.view || Math.hypot(...a.carPosition.map((v, i) => b.carPosition[i] - v)) > 40 || Math.hypot(...a.position.map((v, i) => b.position[i] - v)) > 40) return t < 1 ? a : b;
    const carPosition = mixPosition(a.carPosition, b.carPosition, t), quaternion = mixRotation(a.quaternion, b.quaternion, t);
    return {
      ...a,
      at,
      position: mixCameraPosition(a, b, t, carPosition, quaternion),
      quaternion,
      fov: a.fov + (b.fov - a.fov) * t,
      carPosition,
      carQuaternion: mixRotation(a.carQuaternion, b.carQuaternion, t),
      frames: Math.round(a.frames + (b.frames - a.frames) * t),
      speed: a.speed + (b.speed - a.speed) * t
    };
  }
  playback(now, sessionId, tick) {
    const frames = this.frames.filter((p) => p.sessionId === sessionId);
    if (!frames.length || now - frames.at(-1).at > 1500) {
      this.playhead = null;
      this.lastTick = null;
      return null;
    }
    const desired = now - VIEW_DELAY_MS;
    if (this.playhead === null || this.lastTick === null || tick - this.lastTick > 1e3) this.playhead = desired;
    else {
      const dt = Math.max(0, Math.min(100, tick - this.lastTick));
      const drift = desired - (this.playhead + dt);
      const rate = Math.max(0.9, Math.min(1.1, 1 + drift / 1e3));
      this.playhead += dt * rate;
    }
    this.lastTick = tick;
    this.playhead = Math.min(frames.at(-1).at, this.playhead);
    return this.sample(this.playhead, sessionId);
  }
};

// src/native.mjs
function registerCarVisibility(pml, insertType) {
  pml.registerGlobalMixin({
    type: insertType,
    token: '(0, l.gn)(this, me, "f").visible = e;',
    func: "if (!e && Ae.get(this)) Ae.get(this).visible = false;"
  });
}
function beforeGameRender(renderer, prepare, update) {
  const descriptor = Object.getOwnPropertyDescriptor(renderer, "update"), original = renderer.update;
  renderer.update = function(...args) {
    prepare();
    return original.apply(this, args);
  };
  try {
    return update();
  } finally {
    if (descriptor) Object.defineProperty(renderer, "update", descriptor);
    else delete renderer.update;
  }
}
function connectNative(pml, controller) {
  if (pml.polyVersion !== "0.6.3") throw new Error("PolyCup requires PolyTrack 0.6.3.");
  const api = pml.getFromPolyTrack(`({
    Host: ii, Client: vc, Game: Is, TrackLibrary: du,
    renderer: g => la.get(g),
    presentation: (g, cup, watching) => {
      const ended=!!ss.get(g), ui=_a.get(g)?.element, backdrop=Hr.get(Oa.get(g));
      ui?.classList.toggle('polycup-watching', !!cup && !!watching && !ended);
      ui?.classList.toggle('polycup-session-ended', !!cup && ended);
      backdrop?.classList.toggle('polycup-session-ended', !!cup && ended);
    },
    records: g => ({ server: jd.get(da.get(g)), profiles: ha.get(g), store: da.get(g) }),
    carThumbnail: style => kr.F(style, new Sr.A()),
    clearInput: g => { const c=qa.get(g); if(c) for(const key of ['up','right','down','left','reset']) c[key]=false;
      const s=fs.get(g); if(s) for(const field of [ft,pt,gt,mt,vt,At,yt]) field.set(s,false); },
    read: g => ({ connection: Za.get(g)?.multiplayerConnection, sessionId: Za.get(g)?.sessionId,
      trackData: Ta.get(g), metadata: Sa.get(g), car: Xa.get(g), spectator: fs.get(g),
      disposed: ss.get(g), checkpointCount: ra.get(g).getTotalNumberOfCheckpointIndices() }),
    camera: g => { const c=la.get(g).camera, car=Xa.get(g); return {
      sessionId: Za.get(g).sessionId, position:c.position.toArray(), quaternion:c.quaternion.toArray(),
      fov:c.fov, frames:car.getTime().numberOfFrames, speed:car.getSpeedKmh(),
      carPosition:car.getPosition().toArray(), carQuaternion:car.getQuaternion().toArray(),
      view:c===car.cameraCockpit?1:0 }; },
    remoteCar: (g,id) => as.get(g).get(id)?.car,
    ghostKeys: g => ua.get(g).getKeyBindings(ge.A.PolyCupToggleGhosts).map(key=>key ? ve(key) : '').filter(Boolean),
    autoSpectate: g => ua.get(g).getSettingBoolean(P.A.PolyCupAutoSpectate),
    visibility: (g,ids,self) => { Cs.call(g); Xa.get(g).setVisible(ids===null||ids.includes(self));
      for(const [id,r] of as.get(g)) if(ids!==null&&!ids.includes(id)) r.car.setVisible(false); },
    release: g => { const car=Xa.get(g); fs.get(g).isEnabled=false;
      la.get(g).setCamera(car.hasFinished() || ua.get(g).getSettingBoolean(P.A.DefaultCameraMode) ? car.cameraOrbit : car.cameraCockpit);
      car.audioVolume=1; for(const r of as.get(g).values()) r.car.audioVolume=vs.get(g); },
    follow: (g,p,id) => { const camera=fs.get(g).camera; camera.position.fromArray(p.position);
      camera.quaternion.fromArray(p.quaternion); camera.fov=p.fov; camera.updateProjectionMatrix();
      la.get(g).setCamera(camera); Xa.get(g).audioVolume=0;
      for(const [peer,r] of as.get(g)) { r.car.audioVolume=peer===id?1:0.15;
        if(peer===id) {r.car.setVisible(true);r.car.setOpacity(1);} } },
    peers: c => c instanceof ii ? _n.get(c).map(p => ({id:p.id,pc:p.peerConnection})) :
      (Vl.get(c) ? [{id:0,pc:Vl.get(c)}] : []),
    parse: code => Ul.A.fromExportString(code),
    reset: g => { hs.set(g,null); Ts.call(g); Ms.call(g); },
    clearRecords: c => { if(c instanceof ii) { En.get(c).record=null; for(const p of _n.get(c)) p.record=null; }
      else { nc.get(c).record=null; for(const p of ic.get(c)) p.record=null; } },
    guard: fn => { const original=bs; bs=function(){ return fn(this) || original.call(this); }; },
    guardRestart: fn => { const original=Ss; Ss=function(){ if(!fn(this)) return original.call(this); }; }
  })`);
  for (const key of ["Host", "Client", "Game", "read", "peers", "parse", "reset", "guard"]) {
    if (typeof api[key] !== "function") throw new Error(`Unsupported game build: ${key} is unavailable.`);
  }
  const onlinePB = /* @__PURE__ */ new Map();
  const verified = (id) => !!(api.trackLibrary?.isOfficialTrack(id) || api.trackLibrary?.isCommunityTrack(id));
  api.personalBest = async (game, id) => {
    const { server, profiles, store } = api.records(game);
    const profile = profiles.getCurrentUserProfile(), slot = profiles.profileSlot;
    const key = `${slot}:${profile.tokenHash}:${id}`, cached = onlinePB.get(key);
    if (!cached || cached.until < Date.now()) {
      onlinePB.set(key, { until: Date.now() + 6e4, value: server.getLeaderboardUserEntry(profile.tokenHash, id, verified(id)).then((record) => ({ ok: true, frames: record?.time?.numberOfFrames ?? null })).catch(() => ({ ok: false, frames: null })) });
    }
    const online = await onlinePB.get(key).value;
    const local = store.getRecordTime(slot, id)?.numberOfFrames ?? null;
    if (online.frames !== null && (local === null || online.frames <= local)) return { status: "ready", frames: online.frames, source: "online" };
    if (local !== null) return { status: "ready", frames: local, source: "profile" };
    return { status: online.ok ? "missing" : "unavailable" };
  };
  api.worldRecord = async (game, id) => {
    const { server, profiles } = api.records(game);
    try {
      const data = await server.getLeaderboard(profiles.getCurrentUserProfile().tokenHash, id, 0, 1, verified(id));
      const best = data.entries[0];
      return best ? { status: "ready", frames: best.frames.numberOfFrames, name: String(best.nickname).slice(0, 64) } : { status: "missing" };
    } catch {
      return { status: "unavailable" };
    }
  };
  const follow = api.follow;
  api.follow = (game, pose, id) => {
    follow(game, pose, id);
    renderCarPose(api.remoteCar(game, id), pose);
  };
  for (const method of [
    "getFirstSessionTrack",
    "getRandomOfficialTrack",
    "forEachTrack",
    "forEachOfficialTrack",
    "forEachCommunityTrack",
    "forEachCustomTrack"
  ]) {
    const original2 = api.TrackLibrary.prototype[method];
    api.TrackLibrary.prototype[method] = function(...args) {
      api.trackLibrary = this;
      return original2.apply(this, args);
    };
  }
  const original = api.Game.prototype.update;
  api.Game.prototype.update = function(...args) {
    controller.observeGame(this);
    return beforeGameRender(api.renderer(this), () => controller.beforeRender(this), () => original.apply(this, args));
  };
  const dispose = api.Game.prototype.dispose;
  api.Game.prototype.dispose = function(...args) {
    const result = dispose.apply(this, args);
    controller.gameDisposed(this);
    return result;
  };
  api.guard((game) => controller.shouldBlock(game));
  api.guardRestart((game) => controller.shouldBlockRestart(game));
  return api;
}
var CupTransport = class {
  constructor(onMessage, onChange, { channelId = 42, realtime = false } = {}) {
    this.onMessage = onMessage;
    this.onChange = onChange;
    this.channels = /* @__PURE__ */ new Map();
    this.peers = /* @__PURE__ */ new Map();
    this.channelId = channelId;
    this.realtime = realtime;
  }
  sync(peers) {
    const pcs = new Set(peers.map((p) => p.pc));
    for (const [pc, entry] of this.peers) if (!pcs.has(pc)) {
      entry.channel.close();
      this.peers.delete(pc);
      this.channels.delete(entry.id);
      this.onChange();
    }
    for (const { id, pc } of peers) if (!this.peers.has(pc) && pc.connectionState !== "closed") {
      const channel = pc.createDataChannel(`polytrack-world-cup-${this.channelId}`, this.realtime ? { negotiated: true, id: this.channelId, ordered: false, maxRetransmits: 0 } : { negotiated: true, id: this.channelId, ordered: true });
      const entry = { id, channel, windowAt: performance.now(), count: 0 };
      this.peers.set(pc, entry);
      this.channels.set(id, channel);
      channel.onopen = () => this.onChange();
      channel.onclose = () => this.onChange();
      channel.onerror = () => this.onChange();
      channel.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data.length > (this.realtime ? 2e3 : 6e4)) return;
        const now = performance.now();
        if (now - entry.windowAt > 1e3) {
          entry.windowAt = now;
          entry.count = 0;
        }
        if (++entry.count > (this.realtime ? 30 : 35)) return;
        try {
          const message = JSON.parse(event.data);
          if (!message || message.protocol !== 1 || typeof message.type !== "string") return;
          this.onMessage(id, message);
        } catch (error) {
          console.warn("[PolyCup] Rejected peer message:", error.message);
        }
      };
    }
  }
  send(id, message) {
    const channel = this.channels.get(id);
    if (channel?.readyState !== "open" || channel.bufferedAmount > 256e3) return false;
    const text = JSON.stringify({ ...message, protocol: 1 });
    if (text.length > 6e4) throw new Error("Tournament update exceeds the network message limit.");
    try {
      channel.send(text);
      return true;
    } catch {
      return false;
    }
  }
  broadcast(message) {
    for (const id of this.channels.keys()) this.send(id, message);
  }
  has(id) {
    return this.channels.get(id)?.readyState === "open";
  }
  dispose() {
    for (const entry of this.peers.values()) entry.channel.close();
    this.peers.clear();
    this.channels.clear();
  }
};

// src/controller.mjs
var Controller = class {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = null;
    this.game = null;
    this.connection = null;
    this.isHost = false;
    this.selfId = null;
    this.lobby = [];
    this.tracks = /* @__PURE__ */ new Map();
    this.hello = /* @__PURE__ */ new Set();
    this.offset = 0;
    this.bestRtt = Infinity;
    this.error = "";
    this.resetKey = "";
    this.startKey = "";
    this.readyKey = "";
    this.lastBroadcast = 0;
    this.transport = new CupTransport((id, m) => this.receive(id, m), () => {
      this.lastBroadcast = 0;
    });
    this.trackUploads = /* @__PURE__ */ new Map();
    this.pendingUpload = null;
    this.transferProgress = "";
    this.recordRequests = /* @__PURE__ */ new Map();
    this.lastRecordPoll = 0;
    this.startingCup = null;
    this.lastTick = 0;
    this.lastHello = 0;
    this.lastSaved = -1;
    this.auto = false;
    this.cameraTransport = new CupTransport((id, m) => this.receiveCamera(id, m), () => {
    }, { channelId: 43, realtime: true });
    this.cameraBuffers = /* @__PURE__ */ new Map();
    this.subscriptions = /* @__PURE__ */ new Map();
    this.watchId = null;
    this.lastPose = 0;
    this.lastSubscribe = 0;
    this.watchStatus = "";
    this.watchedPose = null;
    this.hideOtherGhosts = false;
    this.syncSequence = 0;
    this.receivedSequence = -1;
    this.panelRequest = { revision: 0, open: false, message: "" };
    this.roundViewKey = "";
  }
  init(pml) {
    this.native = connectNative(pml, this);
    this.timer = setInterval(() => this.tick(), 100);
  }
  now() {
    return Date.now() + (this.isHost ? 0 : this.offset);
  }
  gameDisposed(game) {
    setTimeout(() => {
      if (this.game !== game) return;
      this.transport.dispose();
      this.cameraTransport.dispose();
      this.connection = null;
      this.game = null;
      this.info = null;
      this.state = null;
      this.lobby = [];
      this.selfId = null;
      this.auto = false;
      this.isHost = false;
      this.cameraBuffers.clear();
      this.onChange();
    }, 500);
  }
  fail(error) {
    this.error = error?.message ?? String(error);
    console.error("[PolyCup]", error);
    this.onChange();
  }
  observeGame(game) {
    if (!this.native) return;
    const info = this.native.read(game);
    if (!info.connection) return;
    this.game = game;
    this.info = info;
    if (this.connection !== info.connection) {
      this.transport.dispose();
      this.cameraTransport.dispose();
      this.cameraBuffers.clear();
      this.subscriptions.clear();
      this.hello.clear();
      this.connection = info.connection;
      this.trackUploads.clear();
      this.recordRequests.clear();
      this.isHost = this.connection instanceof this.native.Host;
      this.state = null;
      this.startingCup = null;
      this.resetKey = "";
      this.readyKey = "";
      this.lastSaved = -1;
      this.offset = 0;
      this.bestRtt = Infinity;
      this.watchId = null;
      this.needsRebind = /* @__PURE__ */ new Set();
      this.syncSequence = 0;
      this.receivedSequence = -1;
      this.roundViewKey = "";
      this.viewCupId = null;
      this.onChange();
    }
    if (!this.state) return;
    const racing = activeIds(this.state).includes(this.selfId);
    const phase = this.state.phase;
    if (!racing && info.spectator) info.spectator.isEnabled = true;
    const run = this.state.runtime;
    if (run && ["warmup", "countdown", "racing"].includes(phase) && info.sessionId === run.sessionId) {
      const resetKey = `${run.id}:${phase === "warmup" ? "warmup" : "race"}`;
      if (this.resetKey !== resetKey) {
        this.resetKey = resetKey;
        this.startKey = "";
        this.native.reset(game);
        this.native.clearRecords(this.connection);
        if (racing) info.spectator.isEnabled = false;
        this.info = this.native.read(game);
        if (phase !== "warmup" && racing) this.hookFinish(this.info.car, run);
      }
      const startDue = (phase === "countdown" || phase === "racing") && this.now() >= run.startsAt;
      if (racing && startDue && this.startKey !== run.id) {
        this.startKey = run.id;
        this.info.car.start();
      }
    }
  }
  shouldBlock(game) {
    if (!this.state || game !== this.game) return false;
    if (!activeIds(this.state).includes(this.selfId)) return true;
    if (this.info.sessionId !== this.state.runtime?.sessionId) return true;
    if (this.state.phase === "warmup") return false;
    return !(["racing", "countdown"].includes(this.state.phase) && this.state.runtime?.startsAt !== null && this.now() >= this.state.runtime.startsAt && !(this.selfId in this.state.runtime.finishes) && !this.state.runtime.dnfs.includes(this.selfId));
  }
  shouldBlockRestart(game) {
    return !!this.state && game === this.game && this.state.phase !== "warmup";
  }
  hookFinish(car, run) {
    let checkpoint = null;
    const checkpointIndex = this.info.checkpointCount - 2;
    car.addCheckpointCallback((index) => {
      if (index === checkpointIndex && checkpointIndex >= 0) checkpoint = car.getTime().numberOfFrames;
    });
    car.addFinishCallback(() => {
      if (this.state?.phase !== "racing" || this.state.runtime?.id !== run.id) return;
      const message = {
        type: "finish",
        roundId: run.id,
        sessionId: run.sessionId,
        frames: car.getTime().numberOfFrames,
        checkpoint
      };
      if (this.isHost) this.receiveFinish(this.selfId, message);
      else this.transport.send(0, message);
    });
  }
  receiveFinish(id, m) {
    const run = this.state?.runtime;
    if (!run || m.roundId !== run.id || m.sessionId !== run.sessionId) return;
    if (recordFinish(this.state, id, m.frames, this.now())) {
      if (Number.isSafeInteger(m.checkpoint) && m.checkpoint >= 0 && m.checkpoint <= m.frames) run.checkpoints[id] = m.checkpoint;
      this.broadcast();
    }
  }
  canSpectate() {
    if (!mayWatch(this.state, this.selfId)) return false;
    if (!activeIds(this.state).includes(this.selfId)) return true;
    return this.manualWatchRound === this.state.runtime?.id || this.game && (this.native?.autoSpectate?.(this.game) ?? true);
  }
  watchRemaining() {
    if (!roundDone(this.state, this.selfId)) return;
    this.manualWatchRound = this.state.runtime.id;
    this.onChange();
  }
  toggleGhosts() {
    if (!this.state) return;
    this.hideOtherGhosts = !this.hideOtherGhosts;
    this.onChange();
  }
  watchable() {
    return this.state && this.state.phase !== "complete" ? activeIds(this.state).filter((id) => !roundDone(this.state, id) && this.lobby.some((p) => p.id === id)) : [];
  }
  cycleWatch(delta) {
    const ids = this.watchable();
    if (!this.canSpectate() || !ids.length) return;
    const i = ids.indexOf(this.watchId);
    this.selectWatch(ids[(i + delta + ids.length) % ids.length]);
  }
  selectWatch(id) {
    if (!this.canSpectate() || !this.watchable().includes(id)) return;
    this.watchId = id;
    this.lastSubscribe = 0;
    this.watchedPose = null;
    this.lastWatchPose = null;
    this.onChange();
  }
  beforeRender(game) {
    if (game !== this.game) return;
    const spectating = !this.info?.disposed && this.canSpectate() && this.watchable().length > 0;
    this.native.presentation?.(game, !!this.state, spectating);
    if (this.info?.disposed) return;
    if (!this.state) {
      if (this.filteredCars) this.native.visibility(game, null, this.selfId);
      this.filteredCars = false;
      return;
    }
    const now = this.now(), active = activeIds(this.state);
    if (this.canSpectate() && !this.watchable().includes(this.watchId)) this.selectWatch(this.watchable()[0]);
    if (!spectating && this.followingGame === game) {
      this.native.release(game);
      this.followingGame = null;
      this.lastWatchPose = null;
    }
    const viewed = spectating ? this.watchId : this.selfId;
    this.native.visibility(game, this.hideOtherGhosts ? active.filter((id) => id === viewed) : active, this.selfId);
    this.filteredCars = true;
    if (active.includes(this.selfId) && !roundDone(this.state, this.selfId) && now - this.lastPose >= 50 && !this.info.spectator.isEnabled) {
      this.lastPose = now;
      const pose2 = { ...this.native.camera(game), at: now };
      if (this.isHost) this.relayCamera(this.selfId, pose2);
      else this.cameraTransport.send(0, { type: "camera", pose: pose2 });
    }
    if (!spectating) {
      this.watchedPose = null;
      return;
    }
    if (!this.isHost && Date.now() - this.lastSubscribe > 1e3) {
      if (this.transport.send(0, { type: "watch", value: this.watchId })) this.lastSubscribe = Date.now();
    }
    const buffer = this.cameraBuffers.get(this.watchId);
    const pose = buffer?.playback(now, this.info.sessionId, performance.now());
    this.watchedPose = pose ?? null;
    this.watchStatus = pose ? "Buffered POV" : "Waiting for racer camera";
    if (pose) this.lastWatchPose = pose;
    else if (!this.lastWatchPose || this.lastWatchPose.sessionId !== this.info.sessionId)
      this.lastWatchPose = { ...this.native.camera(game), carPosition: void 0, carQuaternion: void 0 };
    this.native.follow(game, this.lastWatchPose, this.watchId);
    this.followingGame = game;
  }
  receiveCamera(id, message) {
    if (message.type !== "camera" || !validPose(message.pose) || !this.state || Math.abs(message.pose.at - this.now()) > 5e3 || message.pose.sessionId !== this.info?.sessionId) return;
    if (this.isHost) {
      if (this.hello.has(id) && activeIds(this.state).includes(id) && !roundDone(this.state, id)) this.relayCamera(id, message.pose);
    } else if (id === 0 && message.racerId === this.watchId) this.bufferCamera(message.racerId, message.pose);
  }
  bufferCamera(id, pose) {
    if (!this.cameraBuffers.has(id)) this.cameraBuffers.set(id, new CameraBuffer());
    this.cameraBuffers.get(id).push(pose);
  }
  relayCamera(id, pose) {
    this.bufferCamera(id, pose);
    for (const [spectator, watched] of this.subscriptions) if (watched === id && mayWatch(this.state, spectator))
      this.cameraTransport.send(spectator, { type: "camera", racerId: id, pose });
  }
  tick() {
    try {
      if (!this.connection || !this.native || !this.game) return;
      this.info = this.native.read(this.game);
      if (this.info.disposed) return;
      this.lobby = this.connection.getPlayers();
      this.selfId = this.lobby.find((p) => p.isSelf)?.id ?? null;
      this.transport.sync(this.native.peers(this.connection));
      this.cameraTransport.sync(this.native.peers(this.connection));
      if (Date.now() - this.lastHello > 2e3) {
        this.lastHello = Date.now();
        if (!this.isHost) this.transport.send(0, { type: "hello", version: VERSION, sentAt: Date.now() });
      }
      if (!this.state) {
        if (this.isHost && Date.now() - this.lastBroadcast > 1e3) this.broadcast();
        this.onChange();
        return;
      }
      this.sendReady();
      this.refreshRecords();
      for (const [id, upload] of this.trackUploads) if (upload.until < Date.now()) this.trackUploads.delete(id);
      if (this.isHost) {
        this.checkDisconnects();
        this.advanceClock();
        if (this.state.phase === "racing" && this.info.sessionId === this.state.runtime.sessionId) {
          const run = this.state.runtime;
          if (allFinished(this.state) || run.deadline !== null && this.now() >= run.deadline + 1500) this.finishRound();
        }
        if (this.auto && this.state.phase === "between-rounds" && this.nextAuto && Date.now() >= this.nextAuto) {
          this.nextAuto = null;
          this.runRound();
        }
        if (Date.now() - this.lastBroadcast > 1e3 || this.sentRevision !== this.state.revision) this.broadcast();
        this.save();
      }
      this.onChange();
    } catch (error) {
      this.auto = false;
      this.fail(error);
    }
  }
  create(name) {
    this.requireHost();
    this.state = newCup(name);
    this.startingCup = null;
    this.tracks.clear();
    this.error = "";
    this.needsRebind = /* @__PURE__ */ new Set();
    this.trackUploads.clear();
    this.recordRequests.clear();
    this.auto = true;
    this.lastSaved = -1;
    this.broadcast();
    this.onChange();
  }
  requireHost() {
    if (!this.isHost || !this.connection) throw new Error("Host a PolyTrack multiplayer lobby first.");
  }
  requestPanel(open, message = "") {
    this.panelRequest = { revision: this.panelRequest.revision + 1, open, message };
  }
  async rematch(newTracks = false) {
    this.requireHost();
    if (this.state?.phase !== "complete") throw new Error("Finish the Cup before starting a rematch.");
    if (!newTracks) {
      this.requireStartRacers();
      if (this.state.tracks.some((t) => !this.tracks.has(t.id))) throw new Error("A rematch track is missing. Choose new tracks instead.");
    }
    this.save();
    this.state = rematch(this.state, newTracks);
    this.startingCup = null;
    if (newTracks) this.tracks.clear();
    this.trackUploads.clear();
    this.recordRequests.clear();
    this.cameraBuffers.clear();
    this.subscriptions.clear();
    this.watchId = null;
    this.lastWatchPose = null;
    this.manualWatchRound = null;
    this.auto = true;
    this.nextAuto = null;
    this.loadingSession = void 0;
    this.lastSaved = -1;
    this.error = "";
    this.broadcast();
    this.onChange();
    if (!newTracks) await this.startCup();
  }
  syncRoundPanel() {
    const s = this.state, run = s?.runtime;
    const key = JSON.stringify([s?.id, s?.phase, run?.id, run?.sessionId]);
    if (key === this.roundViewKey) return;
    this.roundViewKey = key;
    if (run && ["loading", "warmup", "countdown", "racing"].includes(s.phase)) {
      this.requestPanel(false);
    } else if (s && this.viewCupId !== s.id) {
      this.requestPanel(true);
    }
    this.viewCupId = s?.id ?? null;
  }
  releaseCup(message) {
    this.state = null;
    this.startingCup = null;
    this.auto = false;
    this.nextAuto = null;
    this.loadingSession = void 0;
    this.resetKey = "";
    this.startKey = "";
    this.readyKey = "";
    this.error = "";
    this.cameraBuffers.clear();
    this.subscriptions.clear();
    this.recordRequests.clear();
    this.trackUploads.clear();
    this.watchId = null;
    this.watchedPose = null;
    this.lastWatchPose = null;
    this.watchStatus = "";
    this.followingGame = null;
    this.manualWatchRound = null;
    if (this.pendingUpload) this.pendingUpload.error = "The Cup ended.";
    this.transferProgress = "";
    this.roundViewKey = "";
    this.viewCupId = null;
    if (this.game) this.native?.presentation?.(this.game, false, false);
    if (this.game && !this.info?.disposed) {
      this.native?.release?.(this.game);
      if (this.info?.spectator) this.info.spectator.isEnabled = false;
      this.native?.visibility?.(this.game, null, this.selfId);
      this.filteredCars = false;
    }
    this.requestPanel(false, message);
  }
  endCup() {
    this.requireHost();
    if (!this.state) return;
    this.save();
    this.releaseCup("Cup ended \xB7 Normal multiplayer");
    this.broadcast();
    this.onChange();
  }
  acceptTrack(actor, code) {
    if (typeof code !== "string" || code.length > 2e6) throw new Error("The track code is too large.");
    const track = this.native.parse(code.trim());
    if (!track?.trackData?.hasStartingPoint()) throw new Error("The code must contain a valid PolyTrack track with a start.");
    const id = track.trackData.getId();
    chooseTrack(this.state, actor, { id, name: track.trackMetadata.name });
    this.tracks.set(id, { ...track, code: code.trim() });
    this.pruneTrackData();
    this.broadcast();
  }
  pruneTrackData() {
    for (const id of this.tracks.keys()) if (!this.state.tracks.some((t) => t.id === id)) this.tracks.delete(id);
  }
  async importTrack(code) {
    if (this.state?.phase !== "registration" || !player(this.state, this.selfId)) throw new Error("Join as a racer before choosing a track.");
    if (typeof code !== "string" || !code.trim() || code.length > 2e6) throw new Error("Choose a valid track of up to 2 MB.");
    if (this.isHost) {
      this.acceptTrack(this.selfId, code);
      return;
    }
    if (this.pendingUpload) throw new Error("Your previous track is still uploading.");
    const cupId = this.state.id, connection = this.connection, transferId = crypto.randomUUID();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pending = { transferId, done: false, error: null };
    this.pendingUpload = pending;
    const send = async (message) => {
      const deadline = Date.now() + 5e3;
      while (true) {
        if (this.connection !== connection || this.state?.id !== cupId || this.state.phase !== "registration") throw new Error("The Cup changed during track upload.");
        if (pending.error) throw new Error(pending.error);
        if (this.transport.send(0, { ...message, cupId, transferId })) return;
        if (Date.now() > deadline) throw new Error("Track upload lost its connection. Try again.");
        await sleep(100);
      }
    };
    try {
      await send({ type: "track-begin", length: code.length });
      for (let offset = 0, seq = 0; offset < code.length; offset += 24e3, seq++) {
        await sleep(100);
        await send({ type: "track-chunk", seq, data: code.slice(offset, offset + 24e3) });
        this.transferProgress = `Sending track \xB7 ${Math.min(100, Math.round((offset + 24e3) / code.length * 100))}%`;
        this.onChange();
      }
      await send({ type: "track-end" });
      const deadline = Date.now() + 15e3;
      while (!pending.done && !pending.error && Date.now() < deadline) await sleep(100);
      if (pending.error) throw new Error(pending.error);
      if (!pending.done) throw new Error("The organizer did not confirm the track. Try again.");
    } finally {
      this.pendingUpload = null;
      this.transferProgress = "";
      this.onChange();
    }
  }
  receiveTrack(id, m) {
    if (!this.hello.has(id) || this.state?.phase !== "registration" || m.cupId !== this.state.id || !player(this.state, id)) return;
    if (typeof m.transferId !== "string" || m.transferId.length > 64) return;
    try {
      if (m.type === "track-begin") {
        if (!Number.isSafeInteger(m.length) || m.length < 1 || m.length > 2e6) throw new Error("Invalid track size.");
        this.trackUploads.set(id, { transferId: m.transferId, cupId: m.cupId, length: m.length, data: "", seq: 0, until: Date.now() + 3e4 });
        return;
      }
      const u = this.trackUploads.get(id);
      if (!u || u.transferId !== m.transferId || u.cupId !== m.cupId || u.until < Date.now()) throw new Error("Track transfer expired. Select the track again.");
      if (m.type === "track-chunk") {
        if (m.seq !== u.seq || typeof m.data !== "string" || !m.data.length || m.data.length > 24e3 || u.data.length + m.data.length > u.length) throw new Error("Invalid track chunk.");
        u.data += m.data;
        u.seq++;
        return;
      }
      if (m.type === "track-end") {
        if (u.data.length !== u.length) throw new Error("Incomplete track upload. Try again.");
        this.trackUploads.delete(id);
        this.acceptTrack(id, u.data);
        this.transport.send(id, { type: "track-ack", transferId: m.transferId });
      }
    } catch (e) {
      this.trackUploads.delete(id);
      this.transport.send(id, { type: "track-ack", transferId: m.transferId, error: e.message });
    }
  }
  availableTracks() {
    if (!this.native?.trackLibrary) throw new Error("The game track library is not ready. Open the normal track selector once, then try again.");
    const tracks = [];
    this.native.trackLibrary.forEachTrack((id, metadata, category, environment, load, thumbnail) => {
      tracks.push({ id, name: metadata.name, author: metadata.author, category, thumbnail, load });
    });
    return tracks;
  }
  async addLibraryTrack(entry) {
    const state = this.state, connection = this.connection;
    if (state?.phase !== "registration") throw new Error("Tracks can only be selected during registration.");
    const track = await entry.load();
    if (this.state !== state || this.connection !== connection || state.phase !== "registration")
      throw new Error("The tournament changed while the track was loading. Select it again.");
    await this.importTrack(track.trackData.toExportString(track.trackMetadata));
    this.error = "";
    this.onChange();
  }
  change(fn) {
    this.requireHost();
    fn(this.state);
    this.error = "";
    this.broadcast();
    this.onChange();
  }
  action(type, value) {
    if (this.isHost) this.handleAction(this.selfId, { type, value, cupId: this.state?.id });
    else this.transport.send(0, { type, value, cupId: this.state?.id });
  }
  handleAction(actor, m) {
    if (!this.state || !this.hello.has(actor) && actor !== this.selfId) return;
    if (m.cupId !== this.state.id) return;
    if (m.type === "join") {
      const p = this.lobby.find((p2) => p2.id === actor);
      if (!p) return;
      addPlayer(this.state, actor, p.nickname);
    } else if (m.type === "leave") {
      removePlayer(this.state, actor);
      this.pruneTrackData();
    } else if (m.type === "dnf" && m.value === this.state.runtime?.id) markDNF(this.state, actor);
    else if (m.type === "practice-ready") {
      if (!practiceReady(this.state, actor, m.value)) return;
      this.advanceClock();
    } else return;
    this.broadcast();
  }
  receive(id, m) {
    if (this.isHost) {
      if (m.type === "hello" && m.version === VERSION && Number.isFinite(m.sentAt)) {
        this.hello.add(id);
        this.transport.send(id, { type: "hello-ack", version: VERSION, sentAt: m.sentAt, hostAt: Date.now() });
        this.transport.send(id, this.syncMessage());
      } else if (m.type === "ready" && this.hello.has(id)) this.markReady(id, m);
      else if (m.type === "finish" && this.hello.has(id)) this.receiveFinish(id, m);
      else if (m.type === "watch" && this.hello.has(id)) {
        if (mayWatch(this.state, id) && this.watchable().includes(m.value)) this.subscriptions.set(id, m.value);
        else this.subscriptions.delete(id);
      } else if (m.type === "pb" && this.hello.has(id)) this.receivePB(id, m);
      else if (["track-begin", "track-chunk", "track-end"].includes(m.type)) this.receiveTrack(id, m);
      else if (["join", "leave", "dnf", "practice-ready"].includes(m.type)) {
        try {
          this.handleAction(id, m);
        } catch (e) {
          this.transport.send(id, { type: "error", message: e.message });
        }
      }
    } else if (id === 0) {
      if (m.type === "track-ack" && this.pendingUpload?.transferId === m.transferId) {
        this.pendingUpload.done = !m.error;
        this.pendingUpload.error = m.error ? String(m.error).slice(0, 200) : null;
      } else if (m.type === "hello-ack" && Number.isFinite(m.sentAt) && Number.isFinite(m.hostAt)) {
        const rtt = Date.now() - m.sentAt;
        if (rtt >= 0 && rtt < this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = m.hostAt + rtt / 2 - Date.now();
        }
      } else if (m.type === "state" && Number.isSafeInteger(m.sequence) && m.sequence > this.receivedSequence && (m.state === null || validSnapshot(m.state))) {
        this.receivedSequence = m.sequence;
        if (m.state === null) {
          if (this.state) this.releaseCup("Organizer ended the Cup \xB7 Normal multiplayer");
        } else {
          this.state = m.state;
          this.error = "";
        }
        this.syncRoundPanel();
      } else if (m.type === "error") this.error = String(m.message).slice(0, 200);
    }
    this.onChange();
  }
  refreshRecords() {
    if (Date.now() - this.lastRecordPoll < 5e3 || !this.native?.personalBest || !this.state) return;
    this.lastRecordPoll = Date.now();
    const state = this.state, cupId = state.id, connection = this.connection;
    const trackId = state.runtime?.trackId ?? nextTrack(state);
    if (!trackId) return;
    const stillCurrent = () => this.state?.id === cupId && this.connection === connection;
    const launch = (key, interval, fn) => {
      const old = this.recordRequests.get(key);
      if (old && (old.pending || old.until > Date.now())) return;
      const request = { pending: true, until: Date.now() + interval };
      this.recordRequests.set(key, request);
      Promise.resolve().then(fn).catch(() => {
      }).finally(() => {
        request.pending = false;
      });
    };
    if (player(state, this.selfId)) {
      const actor = this.selfId;
      launch(`${cupId}:pb:${trackId}:${actor}`, 5e3, async () => {
        const pb = await this.native.personalBest(this.game, trackId);
        if (!stillCurrent() || this.selfId !== actor || !validPB(pb)) return;
        const message = { type: "pb", cupId, trackId, pb };
        if (this.isHost) this.receivePB(actor, message);
        else this.transport.send(0, message);
      });
    }
    if (this.isHost) launch(`${cupId}:wr:${trackId}`, 12e4, async () => {
      const wr = await this.native.worldRecord(this.game, trackId);
      if (!stillCurrent() || !this.state.tracks.some((t) => t.id === trackId)) return;
      const records = this.state.records[trackId] ??= { pbs: {} };
      if (JSON.stringify(records.wr) !== JSON.stringify(wr)) {
        records.wr = wr;
        touch(this.state);
        this.broadcast();
      }
    });
  }
  receivePB(actor, m) {
    const s = this.state;
    if (!s || m.cupId !== s.id || !player(s, actor) || !s.tracks.some((t) => t.id === m.trackId) || !validPB(m.pb)) return;
    const pb = m.pb.status === "ready" ? { status: "ready", frames: m.pb.frames, source: m.pb.source } : { status: m.pb.status };
    const r = s.records[m.trackId] ??= { pbs: {} };
    if (JSON.stringify(r.pbs[actor]) !== JSON.stringify(pb)) {
      r.pbs[actor] = pb;
      touch(s);
      this.broadcast();
    }
  }
  async worldRecordForStart(trackId, game = this.game, timeoutMs = 5e3) {
    let timer;
    try {
      const wr = await Promise.race([
        Promise.resolve().then(() => this.native.worldRecord(game, trackId)),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ status: "unavailable" }), timeoutMs);
        })
      ]);
      return validWR(wr) ? wr : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }
  async startCup() {
    this.requireHost();
    if (this.startingCup) return;
    if (this.state?.phase !== "registration") throw new Error("The Cup has already started.");
    const state = this.state, connection = this.connection, game = this.game;
    const setup = () => JSON.stringify([state.roster, state.picks]);
    const before = setup();
    lockRegistration(structuredClone(state));
    this.requireStartRacers();
    const request = {};
    this.startingCup = request;
    this.error = "";
    this.onChange();
    try {
      const records = await Promise.all(state.tracks.map(async (t) => [t.id, await this.worldRecordForStart(t.id, game)]));
      if (this.startingCup !== request || this.state !== state || this.connection !== connection || state.phase !== "registration") return;
      if (setup() !== before) throw new Error("Racers or track picks changed. Start the Cup again.");
      this.requireStartRacers();
      for (const [id, wr] of records) (state.records[id] ??= { pbs: {} }).wr = wr;
      lockRegistration(state);
      this.trackUploads.clear();
      this.broadcast();
      this.runRound();
    } finally {
      if (this.startingCup === request) {
        this.startingCup = null;
        this.onChange();
      }
    }
  }
  requireStartRacers() {
    if (this.state.roster.some((p) => this.needsRebind?.has(p.id) || !this.lobby.some((l) => l.id === p.id) || p.id !== this.selfId && (!this.hello.has(p.id) || !this.transport.has(p.id))))
      throw new Error("Every racer must be connected with the current mod before starting.");
  }
  networkState() {
    const state = publicState(this.state);
    state.audit = state.audit.slice(-8);
    state.matches.forEach((m) => {
      m.roundsLog = m.roundsLog.slice(-1);
    });
    return state;
  }
  broadcast() {
    this.transport.broadcast(this.syncMessage());
    this.sentRevision = this.state?.revision;
    this.lastBroadcast = Date.now();
  }
  syncMessage() {
    this.syncRoundPanel();
    return { type: "state", sequence: ++this.syncSequence, state: this.state ? this.networkState() : null };
  }
  runRound() {
    this.requireHost();
    if (!["dnf", "void"].includes(this.state.disconnectPolicy)) throw new Error("Choose a disconnect rule in Tournament before starting.");
    if (this.state.roster.some((p) => this.needsRebind?.has(p.id))) throw new Error("Confirm every saved racer\u2019s lobby identity in Racers before resuming.");
    for (const id of activeIds(this.state)) {
      if (!this.lobby.some((p) => p.id === id)) throw new Error(`${player(this.state, id).name} is disconnected. Reconnect or replace their lobby identity.`);
      if (id !== this.selfId && (!this.hello.has(id) || !this.transport.has(id))) throw new Error(`${player(this.state, id).name} must load PolyCup ${VERSION}.`);
    }
    const track = this.tracks.get(nextTrack(this.state));
    if (!track) throw new Error("The selected track is missing from this organizer\u2019s saved pack.");
    beginRound(this.state);
    this.readyKey = "";
    this.nextAuto = null;
    this.loadingSession = this.info.sessionId;
    this.broadcast();
    this.connection.startNewSession(1, track.trackMetadata, track.trackData);
  }
  checkDisconnects() {
    const s = this.state;
    if (!s?.runtime) return;
    const missing = activeIds(s).filter((id) => !this.lobby.some((p) => p.id === id) && !(id in s.runtime.finishes) && !s.runtime.dnfs.includes(id));
    if (!missing.length) return;
    this.auto = false;
    if (s.disconnectPolicy === "dnf" && s.phase === "racing") {
      for (const id of missing) markDNF(s, id);
      note(s, "Disconnected racers received DNF. Automatic rounds stopped.");
    } else {
      voidRound(s);
      this.loadingSession = void 0;
      this.nextAuto = null;
      this.error = "Round voided after a racer disconnected. Reconnect their identity before restarting.";
    }
  }
  sendReady() {
    const s = this.state, run = s.runtime;
    if (s.phase !== "loading" || !run || this.info.trackData.getId() !== run.trackId) return;
    if (this.isHost && run.sessionId === null) {
      if (this.loadingSession === void 0) {
        this.loadingSession = this.info.sessionId;
        return;
      }
      if (this.info.sessionId === this.loadingSession) return;
      run.sessionId = this.info.sessionId;
      touch(s);
      this.broadcast();
    }
    if (this.info.sessionId !== run.sessionId || !activeIds(s).includes(this.selfId)) return;
    const key = `${run.id}:${run.sessionId}`;
    if (this.readyKey === key) return;
    const m = { type: "ready", roundId: run.id, sessionId: run.sessionId, trackId: run.trackId };
    if (this.isHost) this.markReady(this.selfId, m);
    else if (!this.transport.send(0, m)) return;
    this.readyKey = key;
  }
  markReady(id, m) {
    const run = this.state?.runtime;
    if (this.state?.phase !== "loading" || !run || m.roundId !== run.id || m.sessionId !== run.sessionId || m.trackId !== run.trackId || !activeIds(this.state).includes(id) || run.ready.includes(id)) return;
    run.ready.push(id);
    touch(this.state);
  }
  advanceClock() {
    const s = this.state, run = s.runtime;
    if (!run) return;
    if (s.phase === "loading" && run.sessionId !== null && activeIds(s).every((id) => run.ready.includes(id))) {
      s.phase = run.warmup ? "warmup" : "countdown";
      run.startsAt = this.now() + (run.warmup ? currentMatch(s).trackWarmups?.[run.trackId] ?? RULES.warmupMs : 3e3);
      touch(s);
      this.broadcast();
    } else if (s.phase === "warmup" && (this.now() >= run.startsAt || activeIds(s).every((id) => run.practiceReady?.includes(id)))) {
      s.phase = "countdown";
      run.startsAt = this.now() + 3e3;
      touch(s);
      this.broadcast();
    } else if (s.phase === "countdown" && this.now() >= run.startsAt) {
      startRace(s, run.startsAt);
      this.broadcast();
    }
  }
  finishRound() {
    this.change(completeRound);
    this.loadingSession = void 0;
    this.nextAuto = this.auto && this.state.phase === "between-rounds" ? Date.now() + 5e3 : null;
  }
  voidRound() {
    this.change(voidRound);
    this.loadingSession = void 0;
    this.nextAuto = null;
    this.auto = false;
  }
  exportData() {
    return {
      format: "polytrack-world-cup",
      schema: 1,
      state: this.state,
      tracks: [...this.tracks].map(([id, t]) => ({ id, code: t.code }))
    };
  }
  restore(text) {
    this.requireHost();
    if (text.length > 18e6) throw new Error("The save is too large.");
    const data = JSON.parse(text);
    if (data.format !== "polytrack-world-cup" || !validSnapshot(data.state) || !Array.isArray(data.tracks) || data.tracks.length > 8 || !Array.isArray(data.state.history)) throw new Error("This is not a Simple Cup save. Older PolyCup exports remain readable as JSON but cannot be resumed in this format.");
    const tracks = /* @__PURE__ */ new Map();
    for (const entry of data.tracks) {
      if (typeof entry.code !== "string" || entry.code.length > 2e6) throw new Error("Invalid saved track.");
      const track = this.native.parse(entry.code);
      if (!track || track.trackData.getId() !== entry.id || !track.trackData.hasStartingPoint()) throw new Error("Saved track checksum failed.");
      tracks.set(entry.id, { ...track, code: entry.code });
    }
    for (const track of data.state.tracks) if (!tracks.has(track.id)) throw new Error("A saved track is missing.");
    const s = data.state;
    if (s.runtime) {
      s.runtime = null;
      s.phase = "between-rounds";
    }
    detachIdentities(s);
    this.state = s;
    this.startingCup = null;
    this.tracks = tracks;
    this.auto = false;
    this.nextAuto = null;
    this.needsRebind = new Set(s.roster.map((p) => p.id));
    this.loadingSession = void 0;
    this.lastSaved = -1;
    note(s, "Restored save. Organizer must reconnect saved racer identities.");
    touch(s);
    this.broadcast();
    this.onChange();
  }
  save() {
    if (this.lastSaved === this.state.revision) return;
    try {
      localStorage.setItem("pwc-save-v2", JSON.stringify(this.exportData()));
      this.lastSaved = this.state.revision;
    } catch {
      this.error = "Autosave is full or unavailable. Export the tournament to keep results.";
    }
  }
};
function validSnapshot(s) {
  const obj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const text = (t) => typeof t === "string" && t.length <= 128;
  const num = (n) => Number.isSafeInteger(n) && n >= 0;
  const frames = (n) => Number.isSafeInteger(n) && n > 0 && n <= 36e5;
  if (!obj(s) || s.schema !== 2 || !text(s.id) || !text(s.name) || !num(s.revision) || !["registration", "loading", "warmup", "countdown", "racing", "between-rounds", "complete"].includes(s.phase) || !["dnf", "void"].includes(s.disconnectPolicy) || !Array.isArray(s.roster) || s.roster.length > 8 || !s.roster.every((p) => obj(p) && Number.isSafeInteger(p.id) && p.id !== 0 && text(p.name)) || new Set(s.roster.map((p) => p.id)).size !== s.roster.length || !Array.isArray(s.tracks) || s.tracks.length > 8 || !s.tracks.every((t) => obj(t) && typeof t.id === "string" && /^[a-f0-9]{64}$/i.test(t.id) && text(t.name)) || new Set(s.tracks.map((t) => t.id)).size !== s.tracks.length) return false;
  const ids = (values) => Array.isArray(values) && values.length <= 8 && values.every((id) => s.roster.some((p) => p.id === id)) && new Set(values).size === values.length;
  const times = (o) => obj(o) && Object.keys(o).length <= 8 && Object.entries(o).every(([id, n]) => s.roster.some((p) => p.id === Number(id)) && num(n));
  const trackId = (id) => s.tracks.some((t) => t.id === id);
  if (!obj(s.picks) || Object.entries(s.picks).some(([id, t]) => !ids([Number(id)]) || !trackId(t)) || !obj(s.records) || Object.keys(s.records).length > 8) return false;
  for (const [id, r2] of Object.entries(s.records)) {
    if (!trackId(id) || !obj(r2) || !obj(r2.pbs) || Object.keys(r2.pbs).length > 8) return false;
    for (const [id2, p] of Object.entries(r2.pbs)) if (!ids([Number(id2)]) || !validPB(p)) return false;
    if (r2.wr && !validWR(r2.wr)) return false;
    if (r2.tr && (!obj(r2.tr) || !frames(r2.tr.frames) || !ids(r2.tr.ids))) return false;
  }
  const round = (r2) => obj(r2) && num(r2.round) && trackId(r2.trackId) && times(r2.finishes) && times(r2.points) && ids(r2.dnfs) && ids(r2.winners) && ids(r2.beforeRanking);
  const match = (m) => obj(m) && text(m.name) && ids(m.players) && m.players.length >= 2 && ids(m.winners) && ids(m.ranking) && (m.target === 100 && m.trackRounds === void 0 || m.target === RULES.target && obj(m.trackRounds)) && m.winnerCount === 1 && m.winners.length <= 1 && num(m.rounds) && Array.isArray(m.order) && m.order.length >= 1 && m.order.length <= 8 && m.order.every(trackId) && new Set(m.order).size === m.order.length && (m.trackRounds === void 0 || Object.keys(m.trackRounds).length === m.order.length && m.order.every((id) => num(m.trackRounds[id]) && m.trackRounds[id] >= 1 && m.trackRounds[id] <= RULES.trackDrivingMs)) && (m.trackWarmups === void 0 || obj(m.trackWarmups) && Object.keys(m.trackWarmups).length === m.order.length && m.order.every((id) => num(m.trackWarmups[id]) && m.trackWarmups[id] >= 3e4 && m.trackWarmups[id] <= 54e5)) && times(m.scores) && m.players.every((id) => num(m.scores[id]) && m.scores[id] <= m.target) && obj(m.finalists) && Object.entries(m.finalists).every(([id, f]) => m.players.includes(Number(id)) && obj(f) && num(f.round) && num(f.position) && (f.checkpoint === null || num(f.checkpoint))) && Array.isArray(m.roundsLog) && m.roundsLog.every(round);
  if (!Array.isArray(s.matches) || s.matches.length > 1 || !s.matches.every(match) || s.matchIndex !== (s.matches.length ? 0 : -1) || s.phase !== "registration" && !s.matches.length || !Array.isArray(s.audit) || !s.audit.every((a) => obj(a) && text(a.message) && text(a.at)) || !Array.isArray(s.results) || s.results.length > 8 || !s.results.every((r2) => obj(r2) && ids([r2.id]) && Number.isInteger(r2.place) && r2.place >= 1 && r2.place <= 8) || s.history !== void 0 && (!Array.isArray(s.history) || !s.history.every((h2) => obj(h2) && h2.matchIndex === 0 && match(h2.before)))) return false;
  const r = s.runtime;
  if (!["loading", "warmup", "countdown", "racing"].includes(s.phase)) return r === null;
  return obj(r) && text(r.id) && num(r.round) && trackId(r.trackId) && (r.sessionId === null || num(r.sessionId)) && typeof r.warmup === "boolean" && ids(r.ready) && (r.practiceReady === void 0 || ids(r.practiceReady)) && ids(r.dnfs) && times(r.finishes) && times(r.checkpoints) && (r.startsAt === null || Number.isFinite(r.startsAt)) && (r.deadline === null || Number.isFinite(r.deadline));
}
function validWR(wr) {
  return !!wr && !Array.isArray(wr) && ["ready", "missing", "unavailable"].includes(wr.status) && (wr.status !== "ready" || Number.isSafeInteger(wr.frames) && wr.frames > 0 && wr.frames <= 36e5 && typeof wr.name === "string" && wr.name.length <= 128);
}
function validPB(p) {
  return !!p && ["ready", "missing", "unavailable"].includes(p.status) && (p.status !== "ready" || Number.isSafeInteger(p.frames) && p.frames > 0 && p.frames <= 36e5 && ["profile", "online"].includes(p.source));
}

// src/standings.mjs
function standings(s) {
  const m = currentMatch(s);
  if (!m) return [];
  const ranking = rankMatch(s, m), live = s.phase === "racing";
  const last = m.roundsLog.at(-1), scored = !s.runtime && !!last;
  const finishes = live ? s.runtime.finishes : scored ? last.finishes : {};
  const finishOrder = m.players.filter((id) => id in finishes).sort((a, b) => finishes[a] - finishes[b]);
  const order = live ? [...finishOrder, ...ranking.filter((id) => !finishOrder.includes(id))] : ranking;
  const best = finishOrder.length ? finishes[finishOrder[0]] : null;
  return order.map((id) => {
    const finishPlace = finishOrder.findIndex((other) => finishes[other] === finishes[id]) + 1;
    const gain = live && finishPlace > 0 && !(id in m.finalists) ? Math.min(m.target - m.scores[id], RULES.points[finishPlace - 1]) : scored ? last.points[id] ?? 0 : 0;
    return {
      id,
      position: live && finishPlace ? finishPlace : order.indexOf(id) + 1,
      score: m.scores[id],
      finalist: id in m.finalists,
      winner: m.winners.includes(id),
      gain,
      provisional: live,
      movement: scored ? last.beforeRanking.indexOf(id) - ranking.indexOf(id) : 0,
      frames: finishes[id],
      delta: finishes[id] === void 0 || best === null ? null : finishes[id] - best,
      dnf: (live ? s.runtime.dnfs : scored ? last.dnfs : []).includes(id)
    };
  });
}
function recordTrack(s) {
  const m = currentMatch(s);
  return s.runtime?.trackId ?? m?.roundsLog.at(-1)?.trackId ?? nextTrack(s);
}
function sessionRecord(s, trackId) {
  const existing = s.records[trackId]?.tr;
  const values = s.runtime?.trackId === trackId && s.phase === "racing" ? Object.entries(s.runtime.finishes) : [];
  let record = existing ? structuredClone(existing) : null;
  for (const [id, frames] of values) {
    if (!record || frames < record.frames) record = { frames, ids: [Number(id)], provisional: true };
    else if (frames === record.frames && !record.ids.includes(Number(id))) record.ids.push(Number(id));
  }
  return record;
}

// src/toolbar.css
var toolbar_default = "/* Only the toolbar containing our button receives the wrapping layout. All\n   button visuals and UI scaling remain owned by PolyTrack's native stylesheet. */\n.game-toolbar-ui.polycup-toolbar {\n  max-width:calc(100% - 2 * var(--safe-area-horizontal,0px) - 8px);\n}\n.game-toolbar-ui.polycup-toolbar > .button-container {\n  display:flex;\n  flex-wrap:wrap;\n  row-gap:4px;\n}\n.game-toolbar-ui.polycup-toolbar > .button-container > .button { white-space:nowrap; }\n.game-toolbar-ui .polycup-toolbar-button { pointer-events:inherit; }\n.game-toolbar-ui .polycup-toolbar-button > .polycup-trophy { filter:brightness(0) invert(1); }\n.game-ui.polycup-watching > :is(.time-announcer-ui, .hint-ui, .timer-ui, .checkpoint-ui, .speedometer-ui),\n.game-ui.polycup-session-ended > .player-list-ui,\n.session-end-ui.polycup-session-ended {\n  /* Keep native results and callbacks intact; suppress only their presentation.\n     The ordinary Players panel stays available during an active session. */\n  display: none !important;\n}\n";

// assets/toolbar-trophy.svg
var toolbar_trophy_default = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 1c0 9.803-5.094 13.053-5.592 17h-2.805c-.498-3.947-5.603-7.197-5.603-17h14zm-7.305 13.053c-1.886-3.26-2.635-7.432-2.646-11.053h-1.699c.205 4.648 1.99 8.333 4.345 11.053zm1.743 4.947h-2.866c-.202 1.187-.63 2.619-2.571 2.619v1.381h8v-1.381c-1.999 0-2.371-1.432-2.563-2.619zm7.08-1.596c-1.402-.634-2.609-.19-3.354.293.745-.484 1.603-1.464 1.595-3.003-2.591 1.038-2.295 2.496-2.765 3.345-.315.571-1.007.274-1.007.274l-.213.352c.365.193.989.319 1.716.319 1.307 0 2.949-.409 4.028-1.58zm2.444-4.022c-1.382.097-2.118 1.061-2.501 1.763.383-.702.614-1.942-.05-3.158-1.61 1.929-.752 2.958-.762 3.831-.004.427-.49.417-.49.417l.007.404c.314-.041 3.154-.717 3.796-3.257zm1.036-3.87c-1.171.426-1.56 1.473-1.718 2.175.158-.702.041-1.863-.835-2.75-.915 2.068.082 2.745.29 3.503.102.371-.325.606-.325.606l.29.179c.061-.029 2.385-1.332 2.298-3.713zm-.2-3.792c-.903.666-1.017 1.688-.974 2.335-.042-.646-.395-1.639-1.376-2.182-.264 2.018.769 2.349 1.142 2.95.182.294.023.658.023.658l.284-.019s.026-.127.169-.442c.291-.644 1.255-1.334.732-3.3zm-1.901-2.72s-.273.984-.045 1.732c.244.798.873 1.361.873 1.361s.34-.873.099-1.733c-.222-.792-.927-1.36-.927-1.36zm-12.67 15.665l-.213-.352s-.691.297-1.007-.274c-.47-.849-.174-2.307-2.765-3.345-.008 1.539.85 2.52 1.595 3.003-.745-.484-1.952-.927-3.354-.293 1.078 1.171 2.721 1.581 4.028 1.581.727-.001 1.35-.127 1.716-.32zm-4.393-2.027l.007-.404s-.486.01-.49-.417c-.009-.873.848-1.901-.762-3.831-.664 1.216-.433 2.457-.05 3.158-.383-.702-1.12-1.666-2.501-1.763.642 2.541 3.482 3.217 3.796 3.257zm-2.533-3.413l.29-.179s-.427-.236-.325-.606c.208-.758 1.205-1.435.29-3.503-.876.887-.994 2.048-.835 2.75-.158-.702-.546-1.749-1.718-2.175-.088 2.381 2.236 3.684 2.298 3.713zm-1.366-4.204c.143.315.169.442.169.442l.284.019s-.159-.364.023-.658c.373-.601 1.405-.933 1.142-2.95-.983.542-1.335 1.534-1.377 2.181.042-.647-.072-1.67-.974-2.335-.523 1.966.441 2.656.733 3.301zm.241-4.661c-.24.86.099 1.733.099 1.733s.629-.563.873-1.361c.228-.748-.045-1.732-.045-1.732s-.705.568-.927 1.36z"/></svg>';

// src/toolbar.mjs
var CupToolbar = class {
  constructor({ fallback, hud, toggle }) {
    this.fallback = fallback;
    this.hud = hud;
    this.toolbar = null;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "button polycup-toolbar-button";
    this.button.title = "PolyCup (F8)";
    this.button.setAttribute("aria-keyshortcuts", "F8");
    const icon = document.createElement("img");
    icon.className = "button-icon polycup-trophy";
    icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toolbar_trophy_default)}`;
    icon.alt = "";
    icon.draggable = false;
    this.button.append(icon, document.createTextNode(" PolyCup"));
    this.button.addEventListener("click", toggle);
    for (const type of ["keydown", "keyup"]) window.addEventListener(type, (e) => {
      if (document.activeElement !== this.button || !["Space", "Enter"].includes(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (type === "keydown" && !e.repeat) this.button.click();
    }, { capture: true });
    const style = document.createElement("style");
    style.textContent = toolbar_default;
    document.head.append(style);
    this.schedule = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.sync();
      });
    };
    this.observer = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList" || r.target === this.toolbar)) this.schedule();
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    this.resize = new ResizeObserver(this.schedule);
    window.addEventListener("resize", this.schedule);
    this.sync();
  }
  sync(open) {
    if (open !== void 0) this.open = open;
    const toolbar = document.querySelector(".game-toolbar-ui");
    if (toolbar !== this.toolbar) {
      this.resize.disconnect();
      this.toolbar?.removeEventListener("transitionend", this.schedule);
      this.toolbar?.classList.remove("polycup-toolbar");
      this.toolbar = toolbar;
      if (toolbar) {
        toolbar.classList.add("polycup-toolbar");
        this.resize.observe(toolbar);
        toolbar.addEventListener("transitionend", this.schedule);
      }
    }
    const container = toolbar?.querySelector(":scope > .button-container");
    if (container && this.button.parentElement !== container) container.append(this.button);
    if (!container) this.button.remove();
    this.fallback.hidden = !!container;
    this.button.setAttribute("aria-expanded", String(!!this.open));
    this.fallback.setAttribute("aria-expanded", String(!!this.open));
    this.button.tabIndex = toolbar?.classList.contains("visible") ? 0 : -1;
    const rect = toolbar?.getBoundingClientRect();
    const visible = toolbar && (toolbar.classList.contains("visible") || Number(getComputedStyle(toolbar).opacity) > 0.01);
    const top = visible && rect.height > 0 && rect.top < innerHeight / 2 ? Math.max(0, Math.ceil(rect.bottom) + 8) : 0;
    if (top !== this.lastTop) {
      this.hud.classList.toggle("settling", top < this.lastTop);
      this.hud.style.setProperty("--pwc-hud-top", `${top}px`);
      this.lastTop = top;
    }
  }
};

// src/invite.mjs
function inviteState(connection, now = Date.now()) {
  if (!connection?.isInviteAllowed?.()) return { status: "hidden" };
  if (connection.getInviteIsLoading()) return { status: "loading" };
  const invite = connection.getInvite();
  if (invite == null) return { status: "empty" };
  if (typeof invite.inviteCode !== "string" || !invite.inviteCode) return { status: "error" };
  const expires = invite.timeoutMilliseconds === null ? Infinity : invite.timeoutMilliseconds <= 0 ? 0 : Number(invite.timeoutStart) + invite.timeoutMilliseconds;
  if (!Number.isFinite(expires) && expires !== Infinity) return { status: "error" };
  return { status: expires <= now ? "expired" : "ready", code: invite.inviteCode, expires };
}
var CupInvite = class {
  constructor() {
    this.element = document.createElement("div");
    this.element.className = "lobby-invite";
    const label = document.createElement("label");
    label.className = "invite-label";
    label.textContent = "Lobby code";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.readOnly = true;
    this.input.setAttribute("aria-label", "Lobby invite code");
    this.input.spellcheck = false;
    this.input.addEventListener("click", () => this.input.select());
    label.append(this.input);
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "quiet invite-copy";
    this.icon = document.createElement("img");
    this.icon.alt = "";
    this.icon.draggable = false;
    this.text = document.createElement("span");
    this.text.setAttribute("aria-live", "polite");
    this.button.append(this.icon, this.text);
    this.button.addEventListener("click", () => this.act());
    const row = document.createElement("div");
    row.className = "invite-actions";
    row.append(label, this.button);
    this.status = document.createElement("small");
    this.status.className = "invite-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.element.append(row, this.status);
  }
  update(connection, open) {
    if (connection !== this.connection) {
      this.connection = connection;
      this.requested = false;
      this.requestFailed = false;
      this.feedback = "";
      this.feedbackUntil = 0;
      this.lastCode = null;
    }
    let state = inviteState(connection);
    if (open && !this.requested && state.status !== "hidden") {
      this.requested = true;
      if (["empty", "expired"].includes(state.status)) {
        this.renew();
        state = inviteState(connection);
      }
    }
    if (state.status === "loading") this.requested = true;
    if (this.requestFailed && state.status === "empty") state = { status: "error" };
    if (state.code !== this.lastCode) {
      this.feedback = "";
      this.lastCode = state.code;
    }
    this.element.hidden = state.status === "hidden";
    const ready = state.status === "ready";
    const value = ready ? state.code : "";
    if (this.input.value !== value) this.input.value = value;
    this.input.placeholder = state.status === "loading" ? "Creating\u2026" : state.status === "expired" ? "Expired" : "Unavailable";
    this.input.disabled = !ready;
    this.button.disabled = ["hidden", "loading"].includes(state.status) || this.copying === connection;
    const feedback = ready && this.feedbackUntil > Date.now() ? this.feedback : "";
    this.text.textContent = feedback === "copied" ? "Copied!" : ready ? "Copy" : state.status === "expired" ? "Renew" : state.status === "loading" ? "Copy" : "Retry";
    this.button.setAttribute("aria-label", ready ? "Copy lobby invite code" : state.status === "expired" ? "Renew lobby invite code" : "Create lobby invite code");
    const icon = ready || state.status === "loading" ? "copy" : "refresh";
    const src = new URL(`images/${icon}.svg`, document.baseURI).href;
    if (this.icon.src !== src) this.icon.src = src;
    const message = feedback === "manual" ? "Select code and press Ctrl+C" : ready && state.expires !== Infinity ? `Expires in ${Math.max(1, Math.ceil((state.expires - Date.now()) / 6e4))} min` : "";
    if (this.status.textContent !== message) this.status.textContent = message;
  }
  renew() {
    this.requested = true;
    this.requestFailed = false;
    try {
      this.connection.renewInvite();
    } catch {
      this.requestFailed = true;
    }
  }
  async act() {
    const connection = this.connection, state = inviteState(connection);
    if (state.status === "hidden" || state.status === "loading" || this.copying === connection) return;
    if (state.status !== "ready") {
      this.renew();
      this.update(connection, false);
      return;
    }
    this.copying = connection;
    this.update(connection, false);
    let copied = false;
    try {
      await navigator.clipboard.writeText(state.code);
      copied = true;
    } catch {
      if (this.connection === connection && inviteState(connection).code === state.code) {
        this.input.focus();
        this.input.select();
        try {
          copied = document.execCommand("copy");
        } catch {
        }
      }
    } finally {
      if (this.copying === connection) this.copying = null;
    }
    if (this.connection !== connection || inviteState(connection).code !== state.code) return;
    this.feedback = copied ? "copied" : "manual";
    this.feedbackUntil = Date.now() + (copied ? 2e3 : 8e3);
    this.update(connection, false);
  }
};

// src/time.mjs
function formatTime(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "\u2014";
  const ms = Math.floor(frames);
  return `${Math.floor(ms / 6e4)}:${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")}.${String(ms % 1e3).padStart(3, "0")}`;
}
function formatGap(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "\u2014";
  return `+${frames < 6e4 ? (Math.floor(frames) / 1e3).toFixed(3) : formatTime(frames)}`;
}

// src/countdown.mjs
function roundStartCue(state, sessionId, now) {
  const run = state?.runtime;
  if (!run || run.sessionId === null || run.sessionId !== sessionId || !Number.isFinite(run.startsAt) || !["countdown", "racing"].includes(state.phase)) return "";
  const remaining = run.startsAt - now;
  if (remaining > 3e3 || remaining <= -600) return "";
  return remaining > 0 ? String(Math.ceil(remaining / 1e3)) : "GO";
}

// src/results.mjs
function resultRows(state) {
  const match = currentMatch(state);
  if (state.phase !== "complete" || !match?.winners.length) return [];
  return state.results.map(({ id, place }) => ({
    id,
    place,
    name: player(state, id)?.name ?? "Racer",
    score: match.scores[id],
    winner: match.winners.includes(id)
  }));
}
async function resultsImage(state, thumbnail) {
  const rows = resultRows(state);
  if (!rows.length) throw new Error("Finish the Cup before saving a results image.");
  await document.fonts.load("italic 32px ForcedSquare");
  const images = await Promise.all(rows.map(async (r) => {
    try {
      const url = await thumbnail(r.id);
      if (!url) return null;
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } catch {
      return null;
    }
  }));
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 286 + rows.length * 82;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#192042";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const shape = (x, y, w, height, color, cut = 12) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - cut, y + height);
    ctx.lineTo(x, y + height);
    ctx.closePath();
    ctx.fill();
  };
  const text = (value, x, y, size, color = "#ffffff", align = "left", max = 1e3) => {
    ctx.font = `italic ${size}px ForcedSquare`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    let label = String(value);
    while (label.length > 1 && ctx.measureText(label).width > max) label = label.slice(0, -2) + "\u2026";
    ctx.fillText(label, x, y);
  };
  shape(0, 0, 1200, 10, "#ffd26b", 0);
  text("PolyCup", 52, 80, 52);
  text(state.name, 52, 127, 30, "#b3c7df", "left", 1080);
  text("FINAL STANDINGS", 600, 186, 34, "#ffffff", "center");
  rows.forEach((r, i) => {
    const y = 212 + i * 82, ink = r.winner ? "#192042" : "#ffffff";
    shape(44, y, 1112, 68, r.winner ? "#ffd26b" : "#28346a");
    text(r.place, 82, y + 44, 30, ink);
    if (images[i]) {
      const image = images[i], scale = Math.min(90 / image.width, 60 / image.height);
      const w = image.width * scale, h2 = image.height * scale;
      ctx.drawImage(image, 118 + (90 - w) / 2, y + 4 + (60 - h2) / 2, w, h2);
    }
    text(r.name, 225, y + 44, 32, ink, "left", 610);
    if (r.winner) text("WINNER", 840, y + 44, 25, ink);
    shape(992, y + 8, 146, 52, "#e9f1f8", 10);
    text(r.score, 1065, y + 43, 32, "#192042", "center");
  });
  const maps = state.tracks.map((t) => t.name).join(" / ");
  text(maps, 52, canvas.height - 28, 24, "#b3c7df", "left", 1090);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not save the results image.")), "image/png"));
}

// src/world-cup.css
var world_cup_default = ":host { --deep:#192042; --blue:#28346a; --ice:#fff; --muted:#b3c7df; --gold:#ffd26b; --red:#ff9c9c; --cut:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%); color:var(--ice); font:italic 22px/1 ForcedSquare,Arial,sans-serif; }\r\n* { box-sizing:border-box; font-style:italic; font-kerning:auto; letter-spacing:normal; word-spacing:normal; } [hidden] { display:none!important; }\r\n.panel,.hud,.pov-hud { font:italic 22px/1 ForcedSquare,Arial,sans-serif; }\r\nbutton,input,textarea,select { font:inherit; }\r\nbutton { --button-bg:#112052; --button-hover:#334b77; --button-active:#151f41; cursor:pointer; position:relative; isolation:isolate; color:var(--ice); background:var(--button-bg); border:0; border-radius:0; padding:10px 18px; clip-path:var(--cut); }\r\nbutton::after { content:''; position:absolute; inset:0 auto 0 0; width:0; z-index:-1; background:var(--button-hover); border-bottom:2px solid currentColor; transition:width .1s ease-in-out; }\r\nbutton:enabled:hover::after,button:enabled:active::after { width:100%; }\r\nbutton:enabled:active::after { background:var(--button-active); }\r\nbutton:focus-visible { outline:none; background:var(--button-hover); text-decoration:underline; text-underline-offset:3px; }\r\ninput:focus-visible,textarea:focus-visible,select:focus-visible { outline:none; box-shadow:inset 0 -3px var(--gold); }\r\nbutton.primary { --button-bg:var(--gold); --button-hover:#ffe09a; --button-active:#efbd50; color:var(--deep); font-weight:700; }\r\nbutton.quiet { --button-bg:#212b58; padding:8px 16px; }\r\nbutton:disabled,button.primary:disabled { cursor:default; opacity:1; background:#313d53; color:#b3c7df; }\r\nbutton:disabled::after { content:none; }\r\n/* Selected controls already own a gold edge; don't stack a second hover stripe. */\r\nbutton.selected::after,button.track-card.added::after { border-bottom:0; }\r\n.launcher { position:fixed; right:18px; top:16px; z-index:100100; border-bottom:3px solid var(--gold); font-size:27px; }\r\n.panel { position:fixed; z-index:100101; left:50%; top:50%; transform:translate(-50%,-50%); width:min(880px,calc(100vw - 36px)); max-height:calc(100dvh - 32px); display:flex; flex-direction:column; background:var(--deep); border-top:4px solid var(--gold); clip-path:var(--cut); }\r\nheader { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:18px 24px 14px; background:var(--blue); }\r\n.header-title { flex:1; min-width:0; } .header-title p { overflow-wrap:anywhere; }\r\n.header-hide { flex:none; }\r\n.lobby-invite { flex:none; max-width:100%; }\r\n.invite-actions { display:flex; align-items:flex-end; gap:4px; }\r\n.invite-label { margin:0; color:var(--muted); font-size:18px; }\r\n.invite-label input { width:142px; margin-top:5px; padding:8px 14px; font-size:22px; border:0; user-select:text; }\r\n.invite-copy { display:flex; align-items:center; justify-content:center; gap:6px; min-width:104px; min-height:38px; font-size:18px; }\r\n.invite-copy img { width:18px; height:18px; } .invite-copy:disabled img { opacity:.5; }\r\n.invite-status { display:block; font-size:18px; color:var(--muted); margin:5px 8px 0; min-height:18px; }\r\n@media(max-width:760px) { header { flex-wrap:wrap; } .header-title { flex-basis:calc(100% - 100px); } .header-hide { order:1; } .lobby-invite { order:2; flex-basis:100%; } }\r\nh1 { font:italic 36px/1 ForcedSquare,Arial,sans-serif; margin:0 0 6px; } h2 { font:italic 27px/1 ForcedSquare,Arial,sans-serif; margin:0 0 14px; } h3 { font-size:23px; margin:18px 0 8px; }\r\np { margin:8px 0 16px; max-width:74ch; } header p { margin:0; color:var(--muted); }\r\nnav { display:flex; gap:2px; padding:12px 24px 0; } nav button { flex:1; } nav .selected { border-bottom:3px solid var(--gold); --button-bg:var(--blue); }\r\n.body { overflow-y:auto; padding:22px 24px 26px; min-height:180px; } .body > button { margin:8px 8px 8px 0; }\r\nfooter { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:12px 24px; color:var(--muted); font-size:18px; border-top:1px solid #3a5075; }\r\nlabel { display:block; margin:15px 0; } input,textarea,select { background:#112052; color:var(--ice); border:0; border-bottom:2px solid #61789c; border-radius:0; padding:10px 16px; clip-path:var(--cut); }\r\nlabel input,label textarea { display:block; width:100%; margin-top:7px; } textarea { resize:vertical; }\r\n.disconnect-rule { display:flex; align-items:center; flex-wrap:wrap; gap:10px 18px; margin:0 0 22px; }\r\n.disconnect-rule select { max-width:100%; }\r\n.racer-name { display:flex; align-items:center; gap:10px; min-width:140px; }\r\n.racer-name > span { overflow-wrap:anywhere; }\r\n.car-skin { flex:0 0 56px; width:56px; height:48px; object-fit:contain; }\r\n.track-tabs { display:flex; flex-wrap:wrap; gap:8px; margin:22px 0 14px; }\r\n.track-tabs .selected { border-bottom:3px solid var(--gold); --button-bg:var(--blue); }\r\n.track-search { width:100%; margin-bottom:14px; }\r\n.track-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:9px; max-height:340px; overflow-y:auto; padding:4px; }\r\n.track-card { display:flex; align-items:center; gap:12px; min-height:86px; padding:10px 16px; text-align:left; --button-bg:#212b58; }\r\n.track-card img { width:76px; height:64px; object-fit:cover; clip-path:var(--cut); }\r\n.track-card > span { min-width:0; } .track-card strong,.track-card small { display:block; overflow-wrap:anywhere; }\r\n.track-card.added { border-bottom:3px solid var(--gold); opacity:1; } .track-card.added small { color:var(--gold); }\r\n.track-code { margin-top:22px; } .track-code summary { cursor:pointer; color:var(--muted); }\r\n.muted { color:var(--muted); font-size:18px; } .error { margin:12px 24px; color:#ffe6e6; background:#723e4e; padding:10px 18px; border-left:3px solid var(--red); clip-path:var(--cut); }\r\n.row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #344c75; flex-wrap:wrap; } .grow { flex:1; min-width:90px; overflow-wrap:anywhere; }\r\n.roster-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }\r\n.roster-heading h2 { margin:0; } .roster-heading button { font-size:18px; }\r\n.notice { position:fixed; z-index:100102; bottom:120px; left:50%; transform:translateX(-50%); padding:10px 20px; background:#112052; clip-path:var(--cut); font-size:22px; pointer-events:none; max-width:calc(100vw - 32px); text-align:center; }\n.start-countdown { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:100103; pointer-events:none; user-select:none; }\n.start-signal { width:clamp(160px,19vw,230px); padding:14px 32px 17px; text-align:center; color:var(--gold); background:#112052f2; clip-path:polygon(24px 0,100% 0,calc(100% - 24px) 100%,0 100%); animation:start-pulse .18s ease-out; }\n.start-number { display:block; font:italic clamp(76px,8vw,104px)/1 ForcedSquare,Arial,sans-serif; }\n.start-lights { display:flex; gap:7px; margin-top:5px; }\n.start-lights i { flex:1; height:6px; background:#3a5075; transform:skewX(-12deg); }\n.start-lights .lit { background:currentColor; }\n.start-signal.go { background:#78e1b6; color:#112052; animation:start-go .6s ease-out both; }\n@keyframes start-pulse { from { transform:scale(1.12); opacity:.5; } to { transform:scale(1); opacity:1; } }\n@keyframes start-go { 0% { transform:scale(1.12); } 25% { transform:scale(1); opacity:1; } 100% { transform:scale(1.04); opacity:0; } }\n@media(prefers-reduced-motion:reduce) { .start-signal,.start-signal.go { animation:none; } }\n.badge { padding:4px 12px; background:var(--blue); clip-path:var(--cut); font-size:18px; }\r\n.controls { display:flex; gap:9px; flex-wrap:wrap; margin-top:18px; } .setup-stats { display:flex; gap:25px; font:italic 25px/1 ForcedSquare,Arial,sans-serif; color:var(--gold); margin:25px 0; }\r\n.ready-list { margin:18px 0; } .ready-pick { color:#78e1b6; font-size:18px; max-width:45%; overflow-wrap:anywhere; }\r\n.cup-rules { margin-top:22px; color:var(--muted); font-size:18px; } .cup-rules p { margin:12px 0; }\r\n.organizer-settings { margin-top:24px; color:var(--muted); font-size:18px; } summary { cursor:pointer; } .organizer-settings label { margin:16px 0 4px; }\r\n.upload-status { color:var(--gold); }\r\n.scoreboard { margin:14px 0 8px; }\r\n.ranking-heading { display:flex; align-items:center; justify-content:center; text-align:center; padding:9px 10px; background:#112052; }\n.ranking-heading > strong { font:italic 700 27px/1 ForcedSquare,Arial,sans-serif; }\n.score-row { display:grid; grid-template-columns:24px minmax(0,1fr) 28px 72px 110px; align-items:center; gap:5px; min-height:40px; background:#212b58; margin-top:3px; padding:3px 0 3px 12px; clip-path:var(--cut); }\r\n.score-row .racer-name { min-width:0; gap:6px; font-weight:400; }\r\n.score-row .racer-name > span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; overflow-wrap:normal; padding-right:4px; }\r\n.score-row .car-skin { width:32px; height:28px; flex-basis:32px; background:transparent; border-radius:0; }\r\n.score-row .position { font-size:20px; color:#aec2d9; }\r\n.score-row.leader { background:#ed7833; color:#111e34; }\r\n.score-row.leader .position { color:#111e34; }\r\n.score-row.self .racer-name > span { text-decoration:underline; text-underline-offset:3px; }\r\n.points { display:flex; justify-content:flex-end; align-items:center; gap:5px; padding-right:5px; }\r\n.points > strong { font-size:24px; font-weight:400; } .finalist .points > strong { color:#ffd26b; font-size:22px; font-style:italic; }\r\n.leader.finalist .points > strong { color:#172642; }\r\n.point-gain { color:#76e8ba; font-size:18px; font-weight:700; background:#0d302d; padding:2px 5px; clip-path:polygon(3px 0,100% 0,calc(100% - 3px) 100%,0 100%); }\r\n.point-gain:empty { display:none; } .projected { opacity:.76; font-weight:400; }\r\n.movement { font-size:18px; text-align:right; } .movement.up { color:#76e8ba; } .movement.down { color:#ff9d9d; }\r\n.leader .movement.up { color:#153e32; } .leader .movement.down { color:#6e1024; }\r\n.score-row .time { align-self:stretch; display:flex; justify-content:center; align-items:center; background:#e9f1f8; color:#152238; font-size:20px; font-weight:400; clip-path:var(--cut); margin:2px 10px 2px 0; padding:0 10px; white-space:nowrap; }\r\n.winner-strip { padding:10px 14px; border-top:2px solid var(--gold); background:#273c3b; margin-bottom:5px; clip-path:var(--cut); }\r\n.winner-strip > small { display:block; color:var(--gold); font-size:18px; margin-bottom:5px; }\r\n.winner-strip .car-skin { height:30px; width:36px; flex-basis:36px; background:transparent; }\r\n.hud { --hud-strip-cut:polygon(0 0,100% 0,calc(100% - 8px) 100%,0 100%); position:fixed; left:0; top:var(--pwc-hud-top,0px); width:min(420px,calc(100vw - 8px)); max-height:calc(100dvh - var(--pwc-hud-top,0px) - 60px); overflow-y:auto; scrollbar-width:thin; z-index:100099; pointer-events:none; }\n.hud-summary { display:grid; grid-template-columns:minmax(0,1fr); gap:3px; }\n.hud-track { background:var(--deep); padding:9px 18px 9px; clip-path:polygon(0 0,100% 0,calc(100% - 16px) 100%,0 100%); } .hud-track > strong { display:block; font:italic 30px/1 ForcedSquare,Arial,sans-serif; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding-right:5px; }\n.hud-meta { display:flex; gap:10px; justify-content:space-between; font-size:18px; margin-top:5px; text-transform:uppercase; }\r\n.hud-meta > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); } .hud-meta > strong { white-space:nowrap; }\r\n.hud-phase { display:flex; justify-content:space-between; font-size:18px; color:var(--gold); margin-top:5px; }\r\n.record-strip { display:grid; grid-template-columns:30px minmax(0,1fr) 100px; gap:7px; align-items:center; padding:7px 4px; border-top:1px solid #63768b; font-size:18px; background:#212b58; }\r\n.record-strip > strong:first-child { color:#ff9150; font-style:italic; } .record-tr > strong:first-child { color:#ffd26b; } .record-pb > strong:first-child { color:#78e1b6; }\r\n.record-holder { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding-right:4px; } .record-time { text-align:right; font-size:24px; font-weight:400; }\r\n.hud .record-strip { border:0; padding:6px 18px; clip-path:var(--hud-strip-cut); }\n.hud .scoreboard { margin:26px 0 0; }\n.hud .score-row { grid-template-columns:20px minmax(0,1fr) 24px 72px 110px; gap:4px; font-size:18px; min-height:34px; margin-top:4px; padding-left:18px; clip-path:var(--hud-strip-cut); }\n.hud .ranking-heading > strong { font-size:26px; } .hud .ranking-heading { padding:10px 18px; clip-path:var(--hud-strip-cut); }\n.hud .winner-strip { margin-bottom:8px; padding-left:18px; clip-path:var(--hud-strip-cut); }\n.pov { display:grid; grid-template-columns:44px minmax(0,1fr) 44px; gap:6px; width:min(420px,100%); margin:18px auto 0; }\n.pov-main { min-width:0; height:44px; padding:6px 12px; text-align:center; background:#112052; clip-path:polygon(8px 0,calc(100% - 8px) 0,100% 100%,0 100%); }\n.pov-name { position:relative; background:#e9f1f8; color:#152238; clip-path:polygon(6px 0,calc(100% - 6px) 0,100% 100%,0 100%); }\n.pov-name::after { content:''; position:absolute; right:10px; top:50%; border:4px solid transparent; border-top-color:#152238; pointer-events:none; }\n.pov select { display:block; width:100%; height:32px; min-width:0; appearance:none; text-align:center; text-align-last:center; padding:0 24px; border:0; clip-path:none; background:transparent; color:#152238; font-size:26px; line-height:32px; pointer-events:auto; text-overflow:ellipsis; cursor:pointer; }\n.pov select option { background:#112052; color:var(--ice); }\n.pov select:disabled { color:#52647d; opacity:1; cursor:default; }\n.pov-pb { display:grid; grid-template-columns:30px minmax(0,1fr); align-items:center; gap:6px; width:196px; height:34px; margin:8px auto 0; padding-left:14px; background:#212b58; clip-path:var(--cut); font:italic 20px/1 ForcedSquare,Arial,sans-serif; white-space:nowrap; pointer-events:auto; }\n.pov-pb > span { color:#78e1b6; }\n.pov-pb > strong { display:flex; align-items:center; justify-content:center; align-self:stretch; margin:3px 8px 3px 0; padding:0 8px; background:#e9f1f8; color:#152238; clip-path:var(--cut); font-size:22px; font-weight:400; }\nbutton.pov-cycle { display:flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; pointer-events:auto; }\nbutton.pov-cycle.previous { clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%); }\nbutton.pov-cycle.next { clip-path:polygon(0 0,calc(100% - 8px) 0,100% 100%,8px 100%); }\n.pov-arrow { width:10px; height:10px; border-top:3px solid currentColor; border-right:3px solid currentColor; transform:rotate(45deg); }\n.previous .pov-arrow { transform:rotate(-135deg); }\n.history { font-size:18px; border-bottom:1px solid #344c75; padding-bottom:10px; }\r\n.result { font:italic 26px/1 ForcedSquare,Arial,sans-serif; } [data-clock] { color:var(--gold); }\r\n@media(max-width:650px) { .panel { width:calc(100vw - 16px); max-height:calc(100dvh - 16px); } header,.body { padding:16px; } nav { padding:10px 12px 0; } .row { gap:8px; } h1 { font-size:30px; } .score-row { grid-template-columns:24px minmax(0,1fr) 28px 72px 110px; gap:3px; } }\n@media(max-height:680px) { .hud .score-row { min-height:27px; } .hud .car-skin { height:23px; } }\n\r\n.pov-hud { position:fixed; bottom:0; left:50%; transform:translateX(-50%); width:min(420px,calc(100vw - 24px)); z-index:100099; color:var(--ice); pointer-events:none; }\n.pov-hud .pov { margin:0; }\n.pov-record-hud { position:fixed; right:8px; bottom:8px; z-index:100099; pointer-events:none; }\n.pov-record-hud .pov-pb { margin:0; }\n@media(max-height:850px) { .hud .score-row { min-height:30px; padding-top:1px; padding-bottom:1px; } .hud .car-skin { height:24px; } .hud .record-strip { padding-top:5px; padding-bottom:5px; } .hud-track { padding-top:7px; padding-bottom:7px; } }\n@media(max-width:850px) { .pov-record-hud { bottom:52px; } .hud.spectating { max-height:calc(100dvh - var(--pwc-hud-top,0px) - 100px); } }\n@media(max-width:450px) { .pov { gap:4px; } .pov select { font-size:24px; } }\n\r\n.record-strip,.score-row .time,.score-row .racer-name,.points,.movement { pointer-events:auto; }\r\n\r\n.ready-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 20px; }\r\n.ready-list .row { gap:8px; padding:8px 0; }\r\n.ready-list .car-skin { width:40px; height:34px; flex-basis:40px; }\r\n.ready-list .racer-name { min-width:100px; } .ready-list .ready-pick { max-width:100%; font-size:18px; }\r\n@media(max-width:650px) { .ready-list { grid-template-columns:1fr; } }\r\n.hud.settling { transition:top .18s ease-out; }\r\n@media(prefers-reduced-motion:reduce) { .hud.settling,button::after { transition:none; } }\n.practice-hud { position:fixed; right:18px; bottom:112px; z-index:100099; max-width:calc(100vw - 36px); }\n.practice-controls { display:flex; align-items:center; justify-content:flex-end; gap:12px; padding:6px 8px 6px 18px; background:var(--deep); clip-path:var(--cut); font-size:22px; }\n.practice-controls > span { color:var(--muted); } .practice-controls > strong { min-width:42px; text-align:right; font-weight:400; }\n.practice-controls button { min-width:112px; }\n.finish-cue { position:fixed; z-index:100104; inset:0; display:grid; place-items:center; background:#19204266; }\n.champion-card { width:min(540px,calc(100vw - 40px)); padding:28px 32px; text-align:center; background:var(--deep); border-top:5px solid var(--gold); clip-path:polygon(16px 0,100% 0,calc(100% - 16px) 100%,0 100%); animation:start-pulse .25s ease-out; }\n.champion-card h2 { color:var(--gold); text-transform:uppercase; font-size:30px; }\n.champion-card .racer-name { display:flex; flex-direction:column; gap:4px; font-size:38px; margin-bottom:24px; }\n.champion-card .racer-name > span { max-width:100%; }\n.champion-card .car-skin { width:168px; height:120px; flex-basis:120px; image-rendering:auto; }\n.final-standings h2 { text-align:center; text-transform:uppercase; font-weight:700; }\n.final-row { display:flex; align-items:center; gap:14px; margin-top:4px; min-height:40px; padding:4px 10px 4px 18px; background:#212b58; clip-path:var(--cut); }\n.final-row > strong { width:24px; font-weight:400; }\n.final-row .car-skin { width:44px; height:32px; flex-basis:44px; }\n.final-row.champion { background:var(--gold); color:var(--deep); }\n.winner-label { font-size:18px; text-transform:uppercase; }\n.final-score { display:flex; align-items:center; justify-content:center; align-self:stretch; min-width:76px; background:#e9f1f8; color:#152238; clip-path:var(--cut); padding:4px 16px; margin-right:4px; font-size:26px; }\n.result-controls { flex-shrink:0; justify-content:center; margin:0; padding:12px 24px; border-top:1px solid #3a5075; } .race-history { margin-top:24px; color:var(--muted); font-size:18px; }\n@media(max-width:650px) { .final-row { gap:8px; } .winner-label { display:none; } .final-score { min-width:62px; } }\n@media(prefers-reduced-motion:reduce) { .champion-card { animation:none; } }\n";

// src/ui.mjs
var h = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== void 0) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
var names = {
  registration: "Registration",
  loading: "Loading track",
  warmup: "Warmup",
  countdown: "Get ready",
  racing: "Live round",
  "between-rounds": "Round results",
  complete: "Cup results"
};
var CupUI = class {
  constructor(controller) {
    this.c = controller;
    this.open = false;
    this.tab = "Tournament";
    this.signature = "";
    this.trackCategory = "official";
    this.trackQuery = "";
    this.carThumbnails = /* @__PURE__ */ new Map();
    this.playerThumbnails = /* @__PURE__ */ new Map();
    const root = h("div");
    root.id = "polytrack-world-cup";
    document.body.append(root);
    this.shadow = root.attachShadow({ mode: "open" });
    const style = h("style", world_cup_default);
    this.shadow.append(style);
    this.toggle = this.button("PolyCup \xB7 F8", () => {
      this.open = !this.open;
      this.signature = "";
      this.render();
    }, "launcher");
    this.panel = h("section", void 0, "panel");
    this.panel.setAttribute("aria-label", "Simple Cup");
    this.hud = h("aside", void 0, "hud");
    this.povHud = h("aside", void 0, "pov-hud");
    this.povRecordHud = h("aside", void 0, "pov-record-hud");
    this.shadow.append(this.toggle, this.panel, this.hud, this.povHud, this.povRecordHud);
    this.toolbar = new CupToolbar({ fallback: this.toggle, hud: this.hud, toggle: () => this.toggle.click() });
    this.invite = new CupInvite();
    this.notice = h("div", void 0, "notice");
    this.notice.hidden = true;
    this.notice.setAttribute("role", "status");
    this.shadow.append(this.notice);
    this.startCue = h("div", void 0, "start-countdown");
    this.startCue.hidden = true;
    this.startCue.setAttribute("role", "status");
    this.startCue.setAttribute("aria-live", "assertive");
    this.shadow.append(this.startCue);
    this.practiceHud = h("aside", void 0, "practice-hud");
    this.practiceHud.hidden = true;
    this.finishCue = h("section", void 0, "finish-cue");
    this.finishCue.hidden = true;
    this.finishCue.setAttribute("aria-label", "Cup winner");
    this.finishCue.setAttribute("role", "dialog");
    this.shadow.append(this.practiceHud, this.finishCue);
    for (const type of ["keydown", "keyup", "keypress"]) this.panel.addEventListener(type, (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) e.stopPropagation();
    });
    for (const type of ["keydown", "keyup", "keypress"]) window.addEventListener(type, (e) => {
      const active = this.shadow.activeElement;
      if ((!this.panel.hidden || this.povHud.contains(active) || this.practiceHud.contains(active) || this.finishCue.contains(active)) && (["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName) || active?.tagName === "BUTTON" && ["Space", "Enter"].includes(e.code)))
        e.stopImmediatePropagation();
    }, { capture: true });
    for (const panel of [this.panel, this.povHud, this.practiceHud, this.finishCue]) panel.addEventListener("focusin", (e) => {
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName) && this.c.game)
        this.c.native?.clearInput(this.c.game);
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "F8") {
        e.preventDefault();
        this.toggle.click();
      }
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(this.shadow.activeElement?.tagName) && this.c.canSpectate() && ["BracketLeft", "BracketRight"].includes(e.code)) {
        e.preventDefault();
        this.c.cycleWatch(e.code === "BracketLeft" ? -1 : 1);
      }
    });
  }
  button(text, fn, cls = "") {
    const b = h("button", text, cls);
    b.type = "button";
    b.addEventListener("click", async () => {
      try {
        await fn();
        this.signature = "";
        this.render();
      } catch (e) {
        this.c.fail(e);
      }
    });
    return b;
  }
  ghostHotkey(event) {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !this.c.game || this.c.info?.disposed || !this.c.state || document.querySelector("dialog[open],.settings-menu-ui") || event.composedPath().some((e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName) || e.isContentEditable)) return;
    this.toggleGhosts();
    event.preventDefault();
  }
  toggleGhosts() {
    this.c.toggleGhosts();
    this.ghostHintCup = this.c.state?.id;
    this.showNotice(this.c.hideOtherGhosts ? "Other ghosts hidden" : "Other ghosts shown", 1600);
    this.signature = "";
    this.render();
  }
  showNotice(text, duration) {
    this.notice.textContent = text;
    this.notice.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice.hidden = true;
    }, duration);
  }
  name(id) {
    return player(this.c.state, id)?.name ?? `Player ${id}`;
  }
  render() {
    const c = this.c, s = c.state;
    if (c.panelRequest.revision !== this.seenPanelRequest) {
      this.seenPanelRequest = c.panelRequest.revision;
      if (c.panelRequest.revision > 0) {
        this.open = c.panelRequest.open;
        if (this.open) {
          this.tab = s?.phase === "complete" ? "Results" : "Tournament";
          if (c.game && !c.info?.disposed) c.native?.clearInput?.(c.game);
        } else this.shadow.activeElement?.blur();
        if (c.panelRequest.message) this.showNotice(c.panelRequest.message, 6500);
      }
    }
    this.renderCompletion();
    this.toolbar.sync(this.open);
    this.invite.update(c.connection, this.open);
    this.panel.hidden = !this.open;
    this.renderStartCue();
    if (!this.open && s?.runtime && ["warmup", "countdown", "racing"].includes(s.phase) && activeIds(s).includes(c.selfId) && this.ghostHintCup !== s.id) {
      const keys = c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) ?? [] : [];
      if (keys.length) {
        this.ghostHintCup = s.id;
        this.showNotice(`${keys.join(" / ")} \xB7 Toggle other ghosts`, 6e3);
      }
    }
    const key = JSON.stringify([
      this.open,
      this.tab,
      s?.id,
      s?.revision,
      c.isHost,
      c.selfId,
      c.lobby.map((p) => [p.id, p.nickname, c.hello.has(p.id), p.carStyle?.serialize()]),
      c.error,
      !!c.connection,
      c.auto,
      c.watchId,
      c.watchStatus,
      c.transferProgress,
      c.hideOtherGhosts,
      c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) : null,
      !!c.startingCup,
      c.canSpectate()
    ]);
    if (key !== this.signature) {
      const focus = this.shadow.activeElement?.dataset?.field;
      const inviteSelection = this.shadow.activeElement === this.invite.input ? [this.invite.input.selectionStart, this.invite.input.selectionEnd] : null;
      const drafts = Object.fromEntries([...this.shadow.querySelectorAll("[data-field]")].map((e) => [e.dataset.field, e.value]));
      this.signature = key;
      this.panel.replaceChildren();
      this.resultControls = null;
      const header = h("header");
      const title = h("div", void 0, "header-title");
      title.append(h("h1", "PolyCup"));
      if (s) title.append(h("p", `${s.name} / ${names[s.phase]}`));
      const hide = this.button("Hide", () => {
        this.open = false;
      }, "quiet header-hide");
      header.append(title, this.invite.element, hide);
      this.panel.append(header);
      if (c.error) {
        const error = h("p", c.error, "error");
        error.setAttribute("role", "alert");
        this.panel.append(error);
      }
      if (!c.connection) this.welcome();
      else if (!s) this.setup();
      else {
        const nav = h("nav");
        for (const tab of ["Tournament", "Racers", "Tracks", "Results"]) {
          const b = this.button(tab, () => {
            this.tab = tab;
          }, tab === this.tab ? "selected" : "quiet");
          b.setAttribute("aria-current", tab === this.tab ? "page" : "false");
          nav.append(b);
        }
        this.panel.append(nav);
        this.body = h("div", void 0, "body");
        this.panel.append(this.body);
        if (this.tab === "Racers") this.roster();
        else if (this.tab === "Tracks") this.trackPack();
        else if (this.tab === "Results") this.results();
        else this.tournament();
        if (this.resultControls) this.panel.append(this.resultControls);
        if (c.isHost) {
          const footer = h("footer");
          const exportButton = this.button("Export tournament", () => this.download(), "quiet");
          exportButton.title = "Download all results and race history. Autosaves stay on this device.";
          footer.append(exportButton);
          footer.append(this.button("End Cup for everyone", () => {
            if (!confirm("End this Cup for everyone and return to normal multiplayer? You can restore the autosave later.")) return;
            c.endCup();
          }, "quiet"));
          this.panel.append(footer);
        }
      }
      for (const e of this.shadow.querySelectorAll("[data-field]")) if (e.dataset.field in drafts) e.value = drafts[e.dataset.field];
      if (focus && this.open) this.shadow.querySelector(`[data-field="${focus}"]`)?.focus();
      if (inviteSelection && this.open && !this.invite.input.disabled) {
        this.invite.input.focus();
        this.invite.input.setSelectionRange(...inviteSelection);
      }
      this.renderHud();
    }
    for (const e of this.shadow.querySelectorAll("[data-clock]")) {
      const run = s?.runtime;
      const target = s?.phase === "racing" ? run?.deadline : run?.startsAt;
      e.textContent = target ? `${Math.max(0, Math.ceil((target - c.now()) / 1e3))}s` : "";
    }
  }
  welcome() {
    const content = h("div", void 0, "body");
    content.append(h("h2", "Multiplayer required"), h("p", "Host or join a multiplayer lobby."));
    this.panel.append(content);
  }
  renderStartCue() {
    const c = this.c, value = roundStartCue(c.state, c.info?.disposed ? null : c.info?.sessionId, c.now());
    if (value === this.startCueValue) return;
    this.startCueValue = value;
    this.startCue.hidden = !value;
    this.startCue.replaceChildren();
    if (!value) return;
    const signal = h("div", void 0, `start-signal${value === "GO" ? " go" : ""}`);
    signal.append(h("span", value, "start-number"));
    const lights = h("div", void 0, "start-lights");
    lights.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) lights.append(h("i", void 0, value === "GO" || i < 4 - Number(value) ? "lit" : ""));
    signal.append(lights);
    this.startCue.append(signal);
  }
  setup() {
    const body = h("div", void 0, "body");
    body.append(h("h2", this.c.isHost ? "Create a Simple Cup" : "Waiting for the organizer"));
    if (this.c.isHost) {
      const label = h("label", "Competition name");
      const input = h("input");
      input.value = "Simple Cup";
      input.dataset.field = "cup-name";
      input.maxLength = 64;
      label.append(input);
      body.append(label);
      body.append(this.button("Create Cup", () => this.c.create(input.value), "primary"));
      const saved = localStorage.getItem("pwc-save-v2");
      if (saved) body.append(this.button("Restore autosave", () => this.c.restore(saved), "quiet"));
      const file = h("input");
      file.type = "file";
      file.accept = ".json";
      file.hidden = true;
      file.addEventListener("change", async () => {
        try {
          if (file.files[0]) this.c.restore(await file.files[0].text());
        } catch (e) {
          this.c.fail(e);
        }
      });
      body.append(file, this.button("Import saved tournament", () => file.click(), "quiet"));
    }
    this.panel.append(body);
  }
  roster() {
    const s = this.c.state, c = this.c;
    const heading = h("div", void 0, "roster-heading");
    const keys = c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) ?? [] : [];
    const ghosts = this.button(`${c.hideOtherGhosts ? "Show" : "Hide"} other ghosts${keys.length ? ` \xB7 ${keys.join(" / ")}` : ""}`, () => this.toggleGhosts(), "quiet");
    ghosts.title = "Local visibility only. Rebind in Settings \u2192 PolyCup. The watched racer stays visible.";
    ghosts.setAttribute("aria-pressed", String(c.hideOtherGhosts));
    heading.append(h("h2", `${s.roster.length} / 8 racers`), ghosts);
    this.body.append(heading);
    const list = h("div", void 0, "rows");
    for (const p of s.roster) {
      const row = h("div", void 0, "row");
      row.append(this.racerName(p.id, p.name));
      const pick = s.tracks.find((t) => t.id === s.picks[p.id]);
      row.append(h("span", pick?.name ?? "Choosing a track\u2026", pick ? "badge" : "muted"));
      const online = c.lobby.some((l) => l.id === p.id);
      if (!online || c.needsRebind?.has(p.id)) row.append(h("small", c.needsRebind?.has(p.id) ? "Confirm identity" : "Disconnected", "muted"));
      if (c.isHost && s.phase === "registration") {
        row.append(this.button("Remove", () => c.change((s2) => {
          removePlayer(s2, p.id);
          c.pruneTrackData();
        }), "quiet"));
      }
      if (c.isHost && (!online || c.needsRebind?.has(p.id)) && !s.runtime) {
        const select = h("select");
        select.setAttribute("aria-label", `Reconnect ${p.name}`);
        for (const l of c.lobby.filter((l2) => !s.roster.some((p2) => p2.id === l2.id) || l2.id === p.id)) {
          const option = h("option", l.nickname);
          option.value = l.id;
          select.append(option);
        }
        row.append(select, this.button("Reconnect", () => {
          const id = Number(select.value), found = c.lobby.find((l) => l.id === id);
          if (!found) throw new Error("Choose a connected player.");
          const oldId = p.id;
          c.change((s2) => {
            if (id !== oldId) rebindPlayer(s2, oldId, id, found.nickname);
            else touch(s2);
          });
          c.needsRebind?.delete(oldId);
        }, "quiet"));
      }
      list.append(row);
    }
    this.body.append(list);
    if (s.phase === "registration") this.body.append(this.joinControls());
    this.body.append(h("h3", "Lobby & spectators"));
    for (const l of c.lobby) {
      const row = h("div", void 0, "row");
      row.append(this.racerName(l.id, l.nickname));
      if (c.isHost && !l.isSelf && !c.hello.has(l.id)) row.append(h("small", "Awaiting mod", "muted"));
      if (s.roster.some((p) => p.id === l.id)) row.append(h("span", "Racer", "badge"));
      else if (c.isHost && s.phase === "registration" && s.roster.length < 8)
        row.append(this.button("Register racer", () => c.change((s2) => addPlayer(s2, l.id, l.nickname)), "quiet"));
      else row.append(h("span", "Spectator", "badge"));
      this.body.append(row);
    }
  }
  racerName(id, name) {
    const group = h("span", void 0, "racer-name grow"), image = h("img", void 0, "car-skin");
    image.alt = "";
    image.title = `${name}'s car`;
    image.draggable = false;
    image.src = new URL("images/car_thumbnail_placeholder.png", document.baseURI).href;
    this.thumbnail(id).then((url) => {
      if (url && image.isConnected) image.src = url;
    });
    group.append(image, h("span", name));
    return group;
  }
  async thumbnail(id) {
    const style = this.c.lobby.find((p) => p.id === id)?.carStyle;
    if (style) {
      const key = style.serialize();
      if (!this.carThumbnails.has(key)) {
        if (this.carThumbnails.size >= 64) this.carThumbnails.delete(this.carThumbnails.keys().next().value);
        this.carThumbnails.set(key, this.c.native.carThumbnail(style).catch(() => null));
      }
      this.playerThumbnails.set(id, this.carThumbnails.get(key));
    }
    return this.playerThumbnails.get(id) ?? null;
  }
  joinControls() {
    const box = h("div", void 0, "controls"), joined = !!player(this.c.state, this.c.selfId);
    const full = !joined && this.c.state.roster.length >= 8;
    const join = this.button(joined ? "Switch to spectator" : full ? "Grid full \xB7 spectating" : "Join as racer", () => this.c.action(joined ? "leave" : "join"), joined || full ? "quiet" : "primary");
    join.disabled = full;
    box.append(join);
    if (joined) box.append(this.button("Choose my track", () => {
      this.tab = "Tracks";
    }));
    return box;
  }
  trackPack() {
    const s = this.c.state, c = this.c, joined = !!player(s, c.selfId);
    this.body.append(h("h2", s.phase === "registration" ? "Track picks" : "Track order"));
    for (const t of s.tracks) {
      const row = h("div", void 0, "row");
      row.append(
        h("strong", t.name, "grow"),
        h("small", s.roster.filter((p) => s.picks[p.id] === t.id).map((p) => p.name).join(", "), "muted")
      );
      this.body.append(row);
    }
    if (s.phase === "registration" && !joined) this.body.append(this.joinControls());
    if (s.phase === "registration" && joined) {
      if (c.transferProgress) this.body.append(h("p", c.transferProgress, "upload-status"));
      const tabs = h("div", void 0, "track-tabs");
      tabs.setAttribute("aria-label", "Track collections");
      for (const [category, text] of [["official", "Official tracks"], ["community", "Community tracks"], ["custom", "Custom tracks"]]) {
        const button = this.button(text, () => {
          this.trackCategory = category;
        }, category === this.trackCategory ? "selected" : "quiet");
        button.setAttribute("aria-pressed", String(category === this.trackCategory));
        tabs.append(button);
      }
      this.body.append(tabs);
      const search = h("input");
      search.type = "search";
      search.placeholder = "Search tracks";
      search.value = this.trackQuery;
      search.setAttribute("aria-label", "Search tracks");
      search.dataset.field = "track-search";
      search.className = "track-search";
      const grid = h("div", void 0, "track-grid");
      let entries;
      try {
        entries = c.availableTracks();
      } catch (error) {
        grid.append(h("p", error.message, "muted"));
      }
      const draw = () => {
        if (!entries) return;
        grid.replaceChildren();
        const tracks = entries.filter((t) => t.category === this.trackCategory && `${t.name} ${t.author ?? ""}`.toLocaleLowerCase().includes(this.trackQuery.toLocaleLowerCase()));
        if (!tracks.length) grid.append(h("p", this.trackCategory === "custom" && !this.trackQuery ? "No saved custom tracks." : "No matching tracks.", "muted"));
        for (const track of tracks) {
          const selected = s.picks[c.selfId] === track.id;
          const button = this.button("", async () => {
            button.disabled = true;
            try {
              await c.addLibraryTrack(track);
            } finally {
              if (button.isConnected) button.disabled = false;
            }
          }, `track-card${selected ? " added" : ""}`);
          button.disabled = selected || !!c.pendingUpload;
          button.setAttribute("aria-label", `${selected ? "Selected" : "Choose"} ${track.name}`);
          const image = h("img");
          image.alt = "";
          image.loading = "lazy";
          image.draggable = false;
          Promise.resolve(track.thumbnail).then((src) => {
            if (src && image.isConnected) image.src = src;
          }).catch(() => {
          });
          image.addEventListener("error", () => {
            image.hidden = true;
          });
          const text = h("span");
          text.append(h("strong", track.name));
          if (selected || track.author) text.append(h("small", selected ? "Your pick" : track.author, "muted"));
          button.append(image, text);
          grid.append(button);
        }
      };
      search.addEventListener("input", () => {
        this.trackQuery = search.value;
        draw();
      });
      this.body.append(search, grid);
      draw();
      const advanced = h("details", void 0, "track-code");
      advanced.append(h("summary", "Paste a share code instead"));
      const label = h("label", "PolyTrack share code"), code = h("textarea");
      code.rows = 4;
      code.dataset.field = "track-code";
      code.spellcheck = false;
      label.append(code);
      advanced.append(
        label,
        this.button("Choose this track", async () => {
          await c.importTrack(code.value);
          code.value = "";
        }, "primary")
      );
      this.body.append(advanced);
    }
  }
  tournament() {
    const c = this.c, s = c.state, m = currentMatch(s);
    if (s.phase === "complete") {
      this.results();
      return;
    }
    if (s.phase === "registration") {
      const ready = s.roster.filter((p) => s.picks[p.id]).length;
      const stats = h("div", void 0, "setup-stats");
      stats.append(h("span", `${s.roster.length}/8 racers`), h("span", `${ready}/${s.roster.length} tracks chosen`));
      this.body.append(stats);
      this.body.append(this.joinControls());
      if (c.isHost) {
        const start = this.button(c.startingCup ? "Preparing tracks\u2026" : "Shuffle tracks & start Cup", () => c.startCup(), "primary");
        start.disabled = !!c.startingCup || s.roster.length < 2 || ready !== s.roster.length;
        this.body.append(start);
        if (s.roster.length < 2) this.body.append(h("p", "At least 2 racers required.", "muted"));
        else if (ready !== s.roster.length) this.body.append(h("p", "Waiting for track picks.", "muted"));
      } else this.body.append(h("p", "Waiting for organizer.", "muted"));
      const list = h("div", void 0, "ready-list");
      for (const p of s.roster) {
        const row = h("div", void 0, "row"), picked = s.tracks.find((t) => t.id === s.picks[p.id]);
        row.append(this.racerName(p.id, p.name), h("span", picked ? `\u2713 ${picked.name}` : "Choosing a track\u2026", picked ? "ready-pick" : "muted"));
        list.append(row);
      }
      this.body.append(list);
      const rules = h("details", void 0, "cup-rules");
      rules.append(h("summary", "Rules"));
      rules.append(
        h("p", `2\u20138 racers \xB7 ${RULES.target} points to become a finalist. Win a later round outright to win the Cup.`),
        h("p", "Points: 10 / 8 / 6 / 5 / 4 / 3 / 2 / 1. Duplicate picks count once."),
        h("p", "Rounds per track: about 4 minutes \xF7 WR time, fixed at Cup start. No WR: 4 rounds. Tracks repeat until a finalist wins."),
        h("p", "First visit practice: 1.5\xD7 WR, at least 30 seconds; 90 seconds without a WR. Everyone Ready ends practice early. Repeat visits skip practice."),
        h("p", "The organizer must stay connected. Use 16 lobby slots for spectator space.")
      );
      this.body.append(rules);
    } else {
      this.body.append(this.scoreboard());
      if (s.runtime) {
        const status = h("p", `Round ${s.runtime.round} / ${s.tracks.find((t) => t.id === s.runtime.trackId)?.name} `);
        const clock = h("strong");
        clock.dataset.clock = "";
        status.append(clock);
        this.body.append(status);
        if (s.phase === "loading") this.body.append(h("p", `Loaded: ${s.runtime.ready.length}/${activeIds(s).length}`, "muted"));
        if (s.phase === "warmup") this.body.append(this.practiceControls());
        if (s.phase === "racing" && activeIds(s).includes(c.selfId) && !roundDone(s, c.selfId))
          this.body.append(this.button("Retire this round (DNF)", () => {
            c.action("dnf", s.runtime.id);
            this.open = false;
          }, "quiet"));
        if (roundDone(s, c.selfId) && !c.canSpectate() && c.watchable().length)
          this.body.append(this.button("Watch remaining racers", () => {
            c.watchRemaining();
            this.open = false;
          }));
      }
      if (c.isHost) {
        const controls = h("div", void 0, "controls");
        if (s.phase === "between-rounds") controls.append(this.button("Start next round", () => {
          c.runRound();
          this.open = false;
        }, "primary"));
        if (s.phase === "racing") controls.append(this.button("End round \xB7 unfinished DNF", () => {
          if (confirm("Score the current finishes and give every unfinished racer a DNF?")) c.finishRound();
        }, "quiet"));
        if (s.runtime) controls.append(this.button("Void & stop round", () => c.voidRound(), "quiet"));
        if (["between-rounds", "complete"].includes(s.phase)) controls.append(this.button("Undo last scored round", () => {
          if (confirm("Undo the last scored round in this match?")) c.change(undoRound);
        }, "quiet"));
        controls.append(this.button(c.auto ? "Automatic rounds: on" : "Automatic rounds: off", () => {
          c.auto = !c.auto;
        }, "quiet"));
        this.body.append(controls);
      }
    }
    if (c.isHost && !s.runtime) {
      const advanced = h("details", void 0, "organizer-settings");
      advanced.append(h("summary", "Organizer settings"));
      const label = h("label", void 0, "disconnect-rule");
      label.append(h("span", "If a racer disconnects during a race"));
      const select = h("select");
      select.setAttribute("aria-label", "Disconnect rule");
      for (const [value, text] of [["dnf", "DNF; organizer may void the round"], ["void", "Void round and wait for reconnect"]]) {
        const option = h("option", text);
        option.value = value;
        option.selected = value === s.disconnectPolicy;
        select.append(option);
      }
      select.addEventListener("change", () => c.change((s2) => {
        s2.disconnectPolicy = select.value;
        touch(s2);
      }));
      label.append(select);
      advanced.append(label);
      this.body.append(advanced);
    }
    if (c.canSpectate() && c.watchable().length) this.body.append(this.spectatorControls(), this.spectatorRecord());
  }
  scoreboard() {
    const s = this.c.state, board = h("div", void 0, "scoreboard"), rows = standings(s);
    const winners = rows.filter((r) => r.winner), racers = rows.filter((r) => !r.winner);
    if (winners.length) {
      const podium = h("div", void 0, "winner-strip");
      podium.append(h("small", "CUP WINNER"));
      for (const r of winners) podium.append(this.racerName(r.id, this.name(r.id)));
      board.append(podium);
    }
    const heading = h("div", void 0, "ranking-heading");
    heading.append(h("strong", s.phase === "racing" ? "ROUND RANKING" : "CUP STANDINGS"));
    board.append(heading);
    for (const [i, r] of racers.entries()) {
      const row = h("div", void 0, `score-row${i === 0 ? " leader" : ""}${r.finalist ? " finalist" : ""}${r.id === this.c.selfId ? " self" : ""}`);
      const name = this.racerName(r.id, this.name(r.id));
      name.title = this.name(r.id);
      const movement = h("small", r.movement > 0 ? `\u25B2${r.movement}` : r.movement < 0 ? `\u25BC${-r.movement}` : "", r.movement < 0 ? "movement down" : "movement up");
      movement.title = "Places gained or lost in Cup standings this round";
      const points = h("span", void 0, "points");
      const total = h("strong", r.finalist ? "F" : String(r.score));
      total.title = r.finalist ? "Finalist: win an outright round to take the Cup" : `${r.score} of ${currentMatch(s).target} points`;
      const gain = h("small", r.gain ? `+${r.gain}` : "", `point-gain${r.provisional ? " projected" : ""}`);
      gain.title = r.provisional ? "Provisional points if these finish positions hold" : "Points gained this round";
      points.append(total, gain);
      const result = r.dnf ? "DNF" : r.frames === void 0 ? "\u2014" : r.delta > 0 ? formatGap(r.delta) : formatTime(r.frames);
      const timing = h("span", result, "time");
      timing.title = r.frames === void 0 ? "No finish recorded" : `Finish: ${formatTime(r.frames)}`;
      row.append(h("strong", r.position, "position"), name, movement, points, timing);
      board.append(row);
    }
    return board;
  }
  recordStrip(label, record, name, tooltip) {
    const strip = h("div", void 0, `record-strip record-${label.toLowerCase()}`);
    strip.title = tooltip;
    const status = !record ? "Loading\u2026" : record.status === "missing" ? "No record" : record.status === "unavailable" ? "Unavailable" : name;
    strip.append(h("strong", label), h("span", status, "record-holder"), h("strong", record?.frames ? formatTime(record.frames) : "\u2014", "record-time"));
    return strip;
  }
  renderHud() {
    this.hud.replaceChildren();
    this.povHud.replaceChildren();
    this.povRecordHud.replaceChildren();
    this.practiceHud.replaceChildren();
    this.practiceHud.hidden = true;
    this.povHud.hidden = true;
    this.povRecordHud.hidden = true;
    this.hud.hidden = !this.c.state || !currentMatch(this.c.state) || this.open;
    this.hud.classList.toggle("spectating", this.c.canSpectate());
    if (this.hud.hidden) return;
    const s = this.c.state, m = currentMatch(s), id = recordTrack(s), track = s.tracks.find((t) => t.id === id);
    const title = h("div", void 0, "hud-track");
    title.append(h("strong", track?.name ?? s.name));
    const sub = h("div", void 0, "hud-meta"), round = s.runtime?.round ?? Math.max(1, m.rounds);
    const visit = trackProgress(s, round - 1);
    const picked = s.roster.filter((p) => s.picks[p.id] === id).map((p) => p.name).join(", ");
    const picker = h("span", `Picked by ${picked}`);
    picker.title = picked;
    sub.append(picker, h("strong", `ROUND ${visit.round}/${visit.rounds}`));
    title.append(sub);
    const status = h("div", void 0, "hud-phase");
    status.append(h("span", names[s.phase]));
    const clock = h("strong");
    clock.dataset.clock = "";
    status.append(clock);
    title.append(status);
    const records = s.records[id], tr = sessionRecord(s, id);
    const summary = h("div", void 0, "hud-summary");
    summary.append(
      title,
      this.recordStrip("WR", records?.wr, records?.wr?.name, "Overall leaderboard record. Official/community tracks use verified records; custom tracks use their public leaderboard."),
      this.recordStrip("TR", tr ?? { status: "missing" }, tr?.ids.map((id2) => this.name(id2)).join(" / "), "Fastest scored run on this track in this Cup, including current round provisionally. Voided rounds are excluded.")
    );
    this.hud.append(summary, this.scoreboard());
    if (s.phase === "warmup") {
      this.practiceHud.hidden = false;
      this.practiceHud.append(this.practiceControls());
    } else if (roundDone(s, this.c.selfId) && !this.c.canSpectate() && this.c.watchable().length) {
      this.practiceHud.hidden = false;
      this.practiceHud.append(this.button("Watch remaining racers", () => this.c.watchRemaining()));
    }
    if (this.c.canSpectate() && this.c.watchable().length) {
      this.povHud.hidden = false;
      this.povHud.append(this.spectatorControls());
      this.povRecordHud.hidden = false;
      this.povRecordHud.append(this.spectatorRecord());
    }
  }
  spectatorControls() {
    const c = this.c, box = h("section", void 0, "pov"), racers = c.watchable();
    box.setAttribute("aria-label", "Spectator controls");
    const previous = this.button("", () => c.cycleWatch(-1), "pov-cycle previous");
    const next = this.button("", () => c.cycleWatch(1), "pov-cycle next");
    for (const [button, label, key] of [[previous, "Previous racer", "["], [next, "Next racer", "]"]]) {
      button.setAttribute("aria-label", `${label} (${key})`);
      button.setAttribute("aria-keyshortcuts", key);
      button.title = `${label} (${key})`;
      button.disabled = racers.length < 2;
      const icon = h("span", void 0, "pov-arrow");
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
    }
    const main = h("div", void 0, "pov-main"), name = h("div", void 0, "pov-name");
    const select = h("select");
    select.setAttribute("aria-label", "Spectate racer");
    select.disabled = !racers.length;
    if (!racers.length) select.append(h("option", "Waiting for racer"));
    for (const id of racers) {
      const option = h("option", this.name(id));
      option.value = id;
      option.selected = id === c.watchId;
      select.append(option);
    }
    select.title = racers.includes(c.watchId) ? this.name(c.watchId) : "Choose racer";
    select.addEventListener("change", () => {
      c.selectWatch(Number(select.value));
      this.signature = "";
      this.render();
    });
    name.append(select);
    main.append(name);
    box.append(previous, main, next);
    return box;
  }
  spectatorRecord() {
    const c = this.c, id = recordTrack(c.state), watching = c.watchable().includes(c.watchId);
    const pb = watching ? c.state.records[id]?.pbs[c.watchId] : null;
    const record = h("div", void 0, "pov-pb");
    const best = !watching ? "\u2014" : !pb ? "Loading\u2026" : pb.frames ? formatTime(pb.frames) : pb.status === "unavailable" ? "Unavailable" : "No record";
    record.title = `${watching ? `${this.name(c.watchId)} \u2014 ` : ""}Overall personal best for this track${pb?.source ? ` (${pb.source === "online" ? "online leaderboard" : "saved profile"})` : ""}`;
    record.append(h("span", "PB"), h("strong", best));
    return record;
  }
  results() {
    const s = this.c.state;
    if (s.phase === "complete") {
      const board = h("div", void 0, "final-standings");
      board.append(h("h2", "Final standings"));
      for (const r of resultRows(s)) {
        const row = h("div", void 0, `final-row${r.winner ? " champion" : ""}`);
        const score = h("span", r.score, "final-score");
        score.title = "Cup points";
        row.append(h("strong", r.place), this.racerName(r.id, r.name));
        if (r.winner) row.append(h("span", "Winner", "winner-label"));
        row.append(score);
        board.append(row);
      }
      this.body.append(board);
      const controls = h("div", void 0, "controls result-controls");
      if (this.c.isHost) controls.append(
        this.button("Race again", () => this.c.rematch(), "primary"),
        this.button("Choose new tracks", () => this.c.rematch(true))
      );
      controls.append(this.button("Save results image", () => this.downloadImage(), "quiet"));
      this.resultControls = controls;
    }
    const history = h("details", void 0, "race-history");
    history.append(h("summary", this.c.isHost ? "Race history" : "Latest round"));
    const parent = this.body;
    this.body.append(history);
    this.body = history;
    if (!s.matches.length) this.body.append(h("p", "No scored rounds yet.", "muted"));
    for (const m of s.matches) {
      this.body.append(h("h3", m.name));
      if (!m.roundsLog.length) this.body.append(h("p", "No scored rounds yet.", "muted"));
      for (const r of m.roundsLog.slice(-20).reverse()) {
        this.body.append(h("p", `Round ${r.round}: ${m.players.map((id) => `${this.name(id)} ${r.finishes[id] === void 0 ? "DNF" : formatTime(r.finishes[id])}`).join(" / ")}${r.tiedFirst ? " \xB7 Tied first: no finalist win" : ""}`, "history"));
      }
    }
    this.body = parent;
  }
  practiceControls() {
    const c = this.c, s = c.state, run = s.runtime, box = h("div", void 0, "practice-controls");
    const ready = run.practiceReady ?? [], ids = activeIds(s);
    const count = h("span", `${ready.length}/${ids.length} ready`), clock = h("strong");
    clock.dataset.clock = "";
    box.append(count, clock);
    if (ids.includes(c.selfId)) {
      const button = this.button(ready.includes(c.selfId) ? "Ready \u2713" : "Ready", () => c.action("practice-ready", run.id), "primary");
      button.disabled = ready.includes(c.selfId);
      box.append(button);
    }
    return box;
  }
  renderCompletion() {
    const s = this.c.state, winner = s?.phase === "complete" ? resultRows(s).find((r) => r.winner) : null;
    if (!winner) {
      clearTimeout(this.finishTimer);
      this.finishCue.hidden = true;
      this.finishKey = null;
      return;
    }
    const key = `${s.id}:${currentMatch(s).rounds}:${winner.id}`;
    if (this.finishKey === key) return;
    this.finishKey = key;
    this.open = false;
    this.finishCue.hidden = false;
    this.finishCue.replaceChildren();
    const card = h("div", void 0, "champion-card");
    card.append(
      h("h2", "Cup winner"),
      this.racerName(winner.id, winner.name),
      this.button("View results", () => this.showResults(key), "primary")
    );
    this.finishCue.append(card);
    clearTimeout(this.finishTimer);
    this.finishTimer = setTimeout(() => this.showResults(key), 4e3);
  }
  showResults(key) {
    if (this.finishKey !== key || this.c.state?.phase !== "complete") return;
    clearTimeout(this.finishTimer);
    this.finishCue.hidden = true;
    this.open = true;
    this.tab = "Results";
    this.signature = "";
    this.render();
  }
  async downloadImage() {
    const state = structuredClone(this.c.state), blob = await resultsImage(state, (id) => this.thumbnail(id));
    const url = URL.createObjectURL(blob), a = h("a");
    a.href = url;
    a.download = "polycup-results.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  download() {
    const data = JSON.stringify(this.c.exportData(), null, 2), url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = h("a");
    a.href = url;
    a.download = "polytrack-world-cup-results.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
};

// src/main.mjs
var { PolyMod, MixinType } = await import(new URL("PolyTypes.js", document.baseURI).href);
var PolyCup = class extends PolyMod {
  preInit = (pml) => registerCarVisibility(pml, MixinType.INSERT);
  init = (pml) => {
    this.controller = new Controller(() => this.ui?.render());
    try {
      this.controller.init(pml);
      pml.registerSettingCategory("PolyCup");
      pml.registerSetting("Spectate after finishing", "PolyCupAutoSpectate", "boolean", true);
      pml.registerBindCategory("PolyCup");
      pml.registerKeybind(
        "Toggle other players' ghosts",
        "PolyCupToggleGhosts",
        "keydown",
        "KeyG",
        null,
        (event) => this.ui?.ghostHotkey(event)
      );
    } catch (error) {
      this.controller.fail(error);
    }
  };
  postInit = () => {
    if (!this.ui) this.ui = new CupUI(this.controller);
    this.ui.render();
  };
  onGameLoad = () => this.postInit();
};
var polyMod = new PolyCup();
export {
  polyMod
};
