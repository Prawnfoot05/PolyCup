// src/cup.mjs
var VERSION = "0.1.1";
var RULES = Object.freeze({
  points: [10, 6, 4, 3],
  semiTarget: 120,
  finalTarget: 140,
  roundsPerTrack: 4,
  warmupMs: 15e3,
  finishTimeoutMs: 1e4
});
var copy = (value) => structuredClone(value);
var requireThat = (ok, message) => {
  if (!ok) throw new Error(message);
};
var safeName = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64);
function newCup(name = "World Cup") {
  return {
    schema: 1,
    version: VERSION,
    id: crypto.randomUUID(),
    name: safeName(name) || "World Cup",
    revision: 0,
    phase: "registration",
    roster: [],
    tracks: [],
    groups: [[], []],
    draft: [],
    matches: [],
    matchIndex: -1,
    runtime: null,
    history: [],
    audit: [],
    results: [],
    disconnectPolicy: null
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
  state.roster.push({ id, name: safeName(name), seed: state.roster.length + 1 });
  touch(state);
}
function removePlayer(state, id) {
  requireThat(state.phase === "registration", "Registration is closed.");
  state.roster = state.roster.filter((p) => p.id !== id);
  state.roster.forEach((p, i) => {
    p.seed = i + 1;
  });
  touch(state);
}
function moveSeed(state, id, delta) {
  requireThat(state.phase === "registration", "Seeding is locked.");
  const i = state.roster.findIndex((p) => p.id === id), j = i + delta;
  requireThat(i >= 0 && j >= 0 && j < state.roster.length && Math.abs(delta) === 1, "Invalid seed move.");
  [state.roster[i], state.roster[j]] = [state.roster[j], state.roster[i]];
  state.roster.forEach((p, k) => {
    p.seed = k + 1;
  });
  touch(state);
}
function addTrack(state, track) {
  requireThat(state.phase === "registration", "The track pack is locked.");
  requireThat(state.tracks.length < 5, "The pack can contain up to five tracks.");
  requireThat(typeof track.id === "string" && /^[a-f0-9]{64}$/i.test(track.id), "Invalid track ID.");
  requireThat(!state.tracks.some((t) => t.id === track.id), "This track is already in the pack.");
  state.tracks.push({ id: track.id, name: safeName(track.name) });
  touch(state);
}
function lockRegistration(state) {
  requireThat(state.phase === "registration", "Registration is already closed.");
  requireThat(state.roster.length === 8, "Register exactly eight racers.");
  requireThat(state.tracks.length >= 3 && state.tracks.length <= 5, "Import three to five tracks.");
  state.groups = [[state.roster[0].id], [state.roster[1].id]];
  state.phase = "group-picks";
  touch(state);
}
function groupPicker(state) {
  return state.phase === "group-picks" ? state.groups[state.draft.length % 2][0] : null;
}
function pickOpponent(state, actor, id) {
  requireThat(actor === groupPicker(state), "It is the other captain\u2019s turn.");
  requireThat(player(state, id) && !state.groups.flat().includes(id), "Choose an unassigned racer.");
  state.groups[state.draft.length % 2].push(id);
  state.draft.push({ actor, id });
  if (state.draft.length === 6) {
    state.matches = [
      makeMatch("Semifinal A", state.groups[0], 120, 2),
      makeMatch("Semifinal B", state.groups[1], 120, 2)
    ];
    state.matchIndex = 0;
    state.phase = "track-picks";
  }
  touch(state);
}
function makeMatch(name, players, target, winnerCount) {
  return {
    name,
    players: [...players],
    target,
    winnerCount,
    order: [],
    rounds: 0,
    winners: [],
    scores: Object.fromEntries(players.map((id) => [id, 0])),
    finalists: {},
    roundsLog: [],
    ranking: []
  };
}
function trackPicker(state) {
  if (state.phase !== "track-picks") return null;
  const m = currentMatch(state), seeds = [...m.players].sort((a, b) => player(state, a).seed - player(state, b).seed);
  return seeds[m.order.length % seeds.length];
}
function pickTrack(state, actor, trackId) {
  requireThat(actor === trackPicker(state), "It is another racer\u2019s track pick.");
  const m = currentMatch(state);
  requireThat(state.tracks.some((t) => t.id === trackId) && !m.order.includes(trackId), "Choose an unpicked track.");
  m.order.push(trackId);
  if (m.order.length === state.tracks.length) state.phase = "between-rounds";
  touch(state);
}
function nextTrack(state) {
  const m = currentMatch(state);
  return m?.order[Math.floor(m.rounds / RULES.roundsPerTrack) % m.order.length] ?? null;
}
function beginRound(state) {
  requireThat(state.phase === "between-rounds", "Finish picks or the current round first.");
  const m = currentMatch(state);
  state.runtime = {
    id: crypto.randomUUID(),
    round: m.rounds + 1,
    trackId: nextTrack(state),
    warmup: m.rounds % RULES.roundsPerTrack === 0,
    sessionId: null,
    ready: [],
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
  const before = copy(m), ids = activeIds(state);
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
    points[id] = id in m.finalists ? 0 : RULES.points[placements[id] - 1];
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
  if (m.winners.length >= m.winnerCount) {
    m.ranking = rankMatch(state, m);
    state.phase = "match-complete";
    if (state.matchIndex === 2) {
      state.results = m.ranking.map((id, i) => ({ id, place: i + 1 }));
      for (const semi of state.matches.slice(0, 2)) {
        for (const id of semi.players.filter((id2) => !semi.winners.includes(id2))) state.results.push({ id, place: "5\u20138" });
      }
      state.phase = "complete";
    }
  } else state.phase = "between-rounds";
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
    return player(state, a).seed - player(state, b).seed;
  })];
}
function advanceMatch(state) {
  requireThat(state.phase === "match-complete", "Complete this match first.");
  if (state.matchIndex === 1) {
    state.matches.push(makeMatch("Grand final", state.matches.slice(0, 2).flatMap((m) => m.winners), 140, 3));
  }
  state.matchIndex++;
  state.phase = "track-picks";
  state.runtime = null;
  touch(state);
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
  state.results = [];
  state.phase = "between-rounds";
  note(state, "Organizer undid the last scored round.");
  touch(state);
}
function rebindPlayer(state, oldId, newId, name) {
  requireThat(
    ["registration", "group-picks", "track-picks", "between-rounds", "match-complete", "complete"].includes(state.phase),
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
      round.dnfs = replace(round.dnfs);
      round.winners = replace(round.winners);
    }
  };
  state.roster.forEach((p) => {
    p.id = idFor(p.id);
  });
  state.draft.forEach((p) => {
    p.actor = idFor(p.actor);
    p.id = idFor(p.id);
  });
  state.groups = state.groups.map(replace);
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

// src/native.mjs
function connectNative(pml, controller) {
  if (pml.polyVersion !== "0.6.3") throw new Error("World Cup requires PolyTrack 0.6.3.");
  const api = pml.getFromPolyTrack(`({
    Host: ii, Client: vc, Game: Is, TrackLibrary: du,
    carThumbnail: style => kr.F(style, new Sr.A()),
    clearInput: g => { const c=qa.get(g); if(c) for(const key of ['up','right','down','left','reset']) c[key]=false;
      const s=fs.get(g); if(s) for(const field of [ft,pt,gt,mt,vt,At,yt]) field.set(s,false); },
    read: g => ({ connection: Za.get(g)?.multiplayerConnection, sessionId: Za.get(g)?.sessionId,
      trackData: Ta.get(g), metadata: Sa.get(g), car: Xa.get(g), spectator: fs.get(g),
      disposed: ss.get(g), checkpointCount: ra.get(g).getTotalNumberOfCheckpointIndices() }),
    camera: g => { const c=la.get(g).camera, car=Xa.get(g); return {
      sessionId: Za.get(g).sessionId, position:c.position.toArray(), quaternion:c.quaternion.toArray(),
      fov:c.fov, frames:car.getTime().numberOfFrames, speed:car.getSpeedKmh() }; },
    remoteFrame: (g,id) => as.get(g).get(id)?.car.getCarState().frames,
    visibility: (g,ids,self) => { Xa.get(g).setVisible(ids===null||ids.includes(self));
      for(const [id,r] of as.get(g)) if(ids!==null) r.car.setVisible(ids.includes(id)); },
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
    const result = original.apply(this, args);
    controller.afterGame(this);
    return result;
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
          console.warn("[World Cup] Rejected peer message:", error.message);
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

// src/spectator.mjs
function validPose(p) {
  return !!p && Number.isSafeInteger(p.sessionId) && Number.isFinite(p.at) && Array.isArray(p.position) && p.position.length === 3 && p.position.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7) && Array.isArray(p.quaternion) && p.quaternion.length === 4 && p.quaternion.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) && Math.abs(Math.hypot(...p.quaternion) - 1) < 0.02 && Number.isFinite(p.fov) && p.fov >= 5 && p.fov <= 175 && Number.isSafeInteger(p.frames) && p.frames >= 0 && p.frames <= 36e5 && Number.isFinite(p.speed) && Math.abs(p.speed) < 1e5;
}
var CameraBuffer = class {
  constructor() {
    this.frames = [];
  }
  push(p) {
    if (!validPose(p)) return false;
    const last = this.frames.at(-1);
    if (last && last.sessionId === p.sessionId && last.at >= p.at) return false;
    if (last && (last.sessionId !== p.sessionId || p.frames < last.frames)) this.frames = [];
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
    if (Math.hypot(...a.position.map((v, i) => b.position[i] - v)) > 40) return b;
    const sign = a.quaternion.reduce((sum, v, i) => sum + v * b.quaternion[i], 0) < 0 ? -1 : 1;
    const q = a.quaternion.map((v, i) => v + (b.quaternion[i] * sign - v) * t), length = Math.hypot(...q);
    return {
      ...a,
      at,
      position: a.position.map((v, i) => v + (b.position[i] - v) * t),
      quaternion: q.map((v) => v / length),
      fov: a.fov + (b.fov - a.fov) * t,
      frames: Math.round(a.frames + (b.frames - a.frames) * t),
      speed: a.speed + (b.speed - a.speed) * t
    };
  }
  sampleFrame(frame, sessionId, now) {
    const frames = this.frames.filter((p) => p.sessionId === sessionId);
    if (!frames.length || now - frames.at(-1).at > 1500) return null;
    const i = frames.findIndex((p) => p.frames >= frame);
    if (i < 1 || frames.at(-1).frames === frames[0].frames) return this.sample(now - 150, sessionId);
    const a = frames[i - 1], b = frames[i], t = (frame - a.frames) / (b.frames - a.frames);
    return this.sample(a.at + (b.at - a.at) * t, sessionId);
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
    console.error("[World Cup]", error);
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
      this.isHost = this.connection instanceof this.native.Host;
      this.state = null;
      this.resetKey = "";
      this.readyKey = "";
      this.lastSaved = -1;
      this.offset = 0;
      this.bestRtt = Infinity;
      this.watchId = null;
      this.needsRebind = /* @__PURE__ */ new Set();
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
    return !!this.state && !activeIds(this.state).includes(this.selfId);
  }
  watchable() {
    return this.state ? activeIds(this.state).filter((id) => this.lobby.some((p) => p.id === id)) : [];
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
  afterGame(game) {
    if (game !== this.game || this.info?.disposed) return;
    if (!this.state) {
      if (this.filteredCars) this.native.visibility(game, null, this.selfId);
      this.filteredCars = false;
      return;
    }
    const now = this.now(), active = activeIds(this.state);
    this.native.visibility(game, active, this.selfId);
    this.filteredCars = true;
    if (active.includes(this.selfId) && now - this.lastPose >= 50 && !this.info.spectator.isEnabled) {
      this.lastPose = now;
      const pose2 = { ...this.native.camera(game), at: now };
      if (this.isHost) this.relayCamera(this.selfId, pose2);
      else this.cameraTransport.send(0, { type: "camera", pose: pose2 });
    }
    if (!this.canSpectate()) {
      this.watchedPose = null;
      return;
    }
    if (!this.watchable().includes(this.watchId)) this.selectWatch(this.watchable()[0]);
    if (!this.isHost && Date.now() - this.lastSubscribe > 1e3) {
      if (this.transport.send(0, { type: "watch", value: this.watchId })) this.lastSubscribe = Date.now();
    }
    const buffer = this.cameraBuffers.get(this.watchId), frame = this.native.remoteFrame(game, this.watchId);
    const pose = Number.isFinite(frame) ? buffer?.sampleFrame(frame, this.info.sessionId, now) : buffer?.sample(now - 150, this.info.sessionId);
    this.watchedPose = pose ?? null;
    this.watchStatus = pose ? "Live POV" : "Waiting for racer camera";
    if (pose) this.lastWatchPose = pose;
    else if (!this.lastWatchPose || this.lastWatchPose.sessionId !== this.info.sessionId) this.lastWatchPose = this.native.camera(game);
    this.native.follow(game, this.lastWatchPose, this.watchId);
  }
  receiveCamera(id, message) {
    if (message.type !== "camera" || !validPose(message.pose) || !this.state || Math.abs(message.pose.at - this.now()) > 5e3 || message.pose.sessionId !== this.info?.sessionId) return;
    if (this.isHost) {
      if (this.hello.has(id) && activeIds(this.state).includes(id)) this.relayCamera(id, message.pose);
    } else if (id === 0 && message.racerId === this.watchId) this.bufferCamera(message.racerId, message.pose);
  }
  bufferCamera(id, pose) {
    if (!this.cameraBuffers.has(id)) this.cameraBuffers.set(id, new CameraBuffer());
    this.cameraBuffers.get(id).push(pose);
  }
  relayCamera(id, pose) {
    this.bufferCamera(id, pose);
    for (const [spectator, watched] of this.subscriptions) if (watched === id && !activeIds(this.state).includes(spectator))
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
        this.onChange();
        return;
      }
      this.sendReady();
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
    this.tracks.clear();
    this.error = "";
    this.needsRebind = /* @__PURE__ */ new Set();
    this.lastSaved = -1;
    this.broadcast();
    this.onChange();
  }
  requireHost() {
    if (!this.isHost || !this.connection) throw new Error("Host a PolyTrack multiplayer lobby first.");
  }
  importTrack(code) {
    this.requireHost();
    if (typeof code !== "string" || code.length > 2e6) throw new Error("The track code is too large.");
    const track = this.native.parse(code.trim());
    if (!track?.trackData?.hasStartingPoint()) throw new Error("The code must contain a valid PolyTrack track with a start.");
    const id = track.trackData.getId();
    addTrack(this.state, { id, name: track.trackMetadata.name });
    this.tracks.set(id, { ...track, code: code.trim() });
    this.broadcast();
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
    this.requireHost();
    const state = this.state, connection = this.connection;
    if (state?.phase !== "registration") throw new Error("Tracks can only be selected during registration.");
    const track = await entry.load();
    if (this.state !== state || this.connection !== connection || state.phase !== "registration")
      throw new Error("The tournament changed while the track was loading. Select it again.");
    this.importTrack(track.trackData.toExportString(track.trackMetadata));
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
    if (this.isHost) this.handleAction(this.selfId, { type, value, revision: this.state?.revision });
    else this.transport.send(0, { type, value, revision: this.state?.revision });
  }
  handleAction(actor, m) {
    if (!this.state || !this.hello.has(actor) && actor !== this.selfId) return;
    if (m.type === "pick-opponent") pickOpponent(this.state, actor, m.value);
    else if (m.type === "pick-track") pickTrack(this.state, actor, m.value);
    else if (m.type === "dnf" && m.value === this.state.runtime?.id) markDNF(this.state, actor);
    else return;
    this.broadcast();
  }
  receive(id, m) {
    if (this.isHost) {
      if (m.type === "hello" && m.version === VERSION && Number.isFinite(m.sentAt)) {
        this.hello.add(id);
        this.transport.send(id, { type: "hello-ack", version: VERSION, sentAt: m.sentAt, hostAt: Date.now() });
        if (this.state) this.transport.send(id, { type: "state", state: this.networkState() });
      } else if (m.type === "ready" && this.hello.has(id)) this.markReady(id, m);
      else if (m.type === "finish" && this.hello.has(id)) this.receiveFinish(id, m);
      else if (m.type === "watch" && this.hello.has(id)) {
        if (this.state && !activeIds(this.state).includes(id) && activeIds(this.state).includes(m.value)) this.subscriptions.set(id, m.value);
        else this.subscriptions.delete(id);
      } else if (["pick-opponent", "pick-track", "dnf"].includes(m.type)) {
        try {
          this.handleAction(id, m);
        } catch (e) {
          this.transport.send(id, { type: "error", message: e.message });
        }
      }
    } else if (id === 0) {
      if (m.type === "hello-ack" && Number.isFinite(m.sentAt) && Number.isFinite(m.hostAt)) {
        const rtt = Date.now() - m.sentAt;
        if (rtt >= 0 && rtt < this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = m.hostAt + rtt / 2 - Date.now();
        }
      } else if (m.type === "state" && validSnapshot(m.state)) {
        if (!this.state || m.state.id !== this.state.id || m.state.revision >= this.state.revision) {
          this.state = m.state;
          this.error = "";
        }
      } else if (m.type === "end-cup") {
        this.state = null;
        if (this.info?.spectator) this.info.spectator.isEnabled = false;
      } else if (m.type === "error") this.error = String(m.message).slice(0, 200);
    }
    this.onChange();
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
    if (!this.state) return;
    this.transport.broadcast({ type: "state", state: this.networkState() });
    this.sentRevision = this.state.revision;
    this.lastBroadcast = Date.now();
  }
  runRound() {
    this.requireHost();
    if (!["dnf", "void"].includes(this.state.disconnectPolicy)) throw new Error("Choose a disconnect rule in Tournament before starting.");
    if (this.state.roster.some((p) => this.needsRebind?.has(p.id))) throw new Error("Confirm every saved racer\u2019s lobby identity in Racers before resuming.");
    for (const id of activeIds(this.state)) {
      if (!this.lobby.some((p) => p.id === id)) throw new Error(`${player(this.state, id).name} is disconnected. Reconnect or replace their lobby identity.`);
      if (id !== this.selfId && (!this.hello.has(id) || !this.transport.has(id))) throw new Error(`${player(this.state, id).name} must load World Cup ${VERSION}.`);
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
      run.startsAt = this.now() + (run.warmup ? RULES.warmupMs : 3e3);
      touch(s);
      this.broadcast();
    } else if (s.phase === "warmup" && this.now() >= run.startsAt) {
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
    if (text.length > 12e6) throw new Error("The save is too large.");
    const data = JSON.parse(text);
    if (data.format !== "polytrack-world-cup" || !validSnapshot(data.state) || !Array.isArray(data.tracks) || data.tracks.length > 5 || !Array.isArray(data.state.history)) throw new Error("This is not a supported World Cup save.");
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
      localStorage.setItem("pwc-save-v1", JSON.stringify(this.exportData()));
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
  if (!obj(s) || s.schema !== 1 || !text(s.id) || !text(s.name) || !num(s.revision) || !["registration", "group-picks", "track-picks", "loading", "warmup", "countdown", "racing", "between-rounds", "match-complete", "complete"].includes(s.phase) || !Array.isArray(s.roster) || s.roster.length > 8 || !s.roster.every((p) => obj(p) && Number.isSafeInteger(p.id) && p.id !== 0 && text(p.name) && num(p.seed)) || new Set(s.roster.map((p) => p.id)).size !== s.roster.length || !Array.isArray(s.tracks) || s.tracks.length > 5 || !s.tracks.every((t) => obj(t) && typeof t.id === "string" && /^[a-f0-9]{64}$/i.test(t.id) && text(t.name))) return false;
  const ids = (values) => Array.isArray(values) && values.length <= 8 && values.every((id) => s.roster.some((p) => p.id === id));
  const times = (o) => obj(o) && Object.keys(o).length <= 8 && Object.entries(o).every(([id, n]) => s.roster.some((p) => p.id === Number(id)) && num(n));
  const round = (r2) => obj(r2) && num(r2.round) && text(r2.trackId) && times(r2.finishes) && times(r2.points) && ids(r2.dnfs) && ids(r2.winners);
  const match = (m) => obj(m) && text(m.name) && ids(m.players) && ids(m.winners) && ids(m.ranking) && [120, 140].includes(m.target) && [2, 3].includes(m.winnerCount) && num(m.rounds) && Array.isArray(m.order) && m.order.length <= 5 && m.order.every((id) => s.tracks.some((t) => t.id === id)) && times(m.scores) && m.players.every((id) => num(m.scores[id])) && obj(m.finalists) && Object.entries(m.finalists).every(([id, f]) => m.players.includes(Number(id)) && obj(f) && num(f.round) && num(f.position) && (f.checkpoint === null || num(f.checkpoint))) && Array.isArray(m.roundsLog) && m.roundsLog.every(round);
  if (!Array.isArray(s.matches) || s.matches.length > 3 || !s.matches.every(match) || !Number.isSafeInteger(s.matchIndex) || s.matchIndex < -1 || s.matchIndex >= s.matches.length || !Array.isArray(s.groups) || s.groups.length !== 2 || !s.groups.every(ids) || !Array.isArray(s.draft) || s.draft.length > 6 || !s.draft.every((d) => obj(d) && ids([d.actor, d.id])) || !Array.isArray(s.audit) || !s.audit.every((a) => obj(a) && text(a.message) && text(a.at)) || !Array.isArray(s.results) || s.results.length > 8 || !s.results.every((r2) => obj(r2) && ids([r2.id]) && [1, 2, 3, 4, "5\u20138"].includes(r2.place)) || s.history !== void 0 && (!Array.isArray(s.history) || !s.history.every((h2) => obj(h2) && num(h2.matchIndex) && h2.matchIndex < s.matches.length && match(h2.before)))) return false;
  const r = s.runtime;
  const live = ["loading", "warmup", "countdown", "racing"].includes(s.phase);
  if (!live) return r === null;
  return obj(r) && text(r.id) && num(r.round) && s.tracks.some((t) => t.id === r.trackId) && (r.sessionId === null || num(r.sessionId)) && typeof r.warmup === "boolean" && ids(r.ready) && ids(r.dnfs) && times(r.finishes) && times(r.checkpoints) && (r.startsAt === null || Number.isFinite(r.startsAt)) && (r.deadline === null || Number.isFinite(r.deadline));
}

// src/world-cup.css
var world_cup_default = ":host { --deep:#18264d; --blue:#304b83; --ice:#e5f3fa; --muted:#b3c7df; --gold:#ffd26b; --red:#ff9c9c; color:var(--ice); font:15px/1.45 'Segoe UI',sans-serif; }\n* { box-sizing:border-box; } [hidden] { display:none!important; }\n.panel,.hud { font:normal 15px/1.45 'Segoe UI',sans-serif; }\nbutton,input,textarea,select { font:inherit; }\nbutton { cursor:pointer; color:var(--ice); background:#3b5d94; border:1px solid #6682b0; border-radius:4px; padding:9px 13px; }\nbutton:hover { background:#5275ad; } button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible { outline:3px solid var(--gold); outline-offset:3px; }\nbutton:disabled { cursor:default; opacity:.55; } button:disabled:hover { background:inherit; }\nbutton.primary { background:var(--gold); color:var(--deep); border-color:var(--gold); font-weight:700; }\nbutton.quiet { background:transparent; border-color:#51658a; padding:6px 10px; }\n.launcher { position:fixed; right:18px; top:16px; z-index:100100; background:var(--deep); border-bottom:3px solid var(--gold); font-family:ForcedSquare,'Segoe UI',sans-serif; font-size:20px; }\n.panel { position:fixed; z-index:100101; right:18px; top:68px; width:min(880px,calc(100vw - 36px)); max-height:calc(100vh - 92px); display:flex; flex-direction:column; background:var(--deep); border:1px solid #61789c; border-top:5px solid var(--gold); border-radius:5px; box-shadow:0 16px 70px #0008; }\nheader { display:flex; justify-content:space-between; align-items:center; padding:18px 24px 14px; background:#223963; }\nh1 { font:36px/1 ForcedSquare,'Segoe UI',sans-serif; margin:0 0 6px; } h2 { font:27px/1.2 ForcedSquare,'Segoe UI',sans-serif; margin:0 0 14px; } h3 { font-size:17px; margin:18px 0 8px; }\np { margin:8px 0 16px; max-width:74ch; } header p { margin:0; color:var(--muted); }\nnav { display:flex; gap:5px; padding:12px 24px 0; } nav button { flex:1; } nav .selected { border-bottom:3px solid var(--gold); background:#304b83; }\n.body { overflow-y:auto; padding:22px 24px 26px; min-height:180px; } .body > button { margin:8px 8px 8px 0; }\nfooter { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:12px 24px; color:var(--muted); font-size:12px; border-top:1px solid #3a5075; }\nlabel { display:block; margin:15px 0; } input,textarea,select { background:#101e3e; color:var(--ice); border:1px solid #607ba4; border-radius:4px; padding:9px; }\nlabel input,label textarea { display:block; width:100%; margin-top:7px; } textarea { resize:vertical; }\n.disconnect-rule { display:flex; align-items:center; flex-wrap:wrap; gap:10px 18px; margin:0 0 22px; }\n.disconnect-rule select { max-width:100%; }\n.racer-name { display:flex; align-items:center; gap:10px; min-width:140px; }\n.racer-name > span { overflow-wrap:anywhere; }\n.car-skin { flex:0 0 56px; width:56px; height:48px; object-fit:contain; background:#23395c; border-radius:6px; }\n.track-tabs { display:flex; flex-wrap:wrap; gap:8px; margin:22px 0 14px; }\n.track-tabs .selected { border-color:var(--gold); border-bottom-width:3px; }\n.track-search { width:100%; margin-bottom:14px; }\n.track-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:9px; max-height:340px; overflow-y:auto; padding:4px; }\n.track-card { display:flex; align-items:center; gap:12px; min-height:86px; padding:8px; text-align:left; background:#23395c; }\n.track-card img { width:76px; height:64px; object-fit:cover; border-radius:3px; }\n.track-card > span { min-width:0; } .track-card strong,.track-card small { display:block; overflow-wrap:anywhere; }\n.track-card.added { border-color:var(--gold); opacity:1; } .track-card.added small { color:var(--gold); }\n.track-code { margin-top:22px; } .track-code summary { cursor:pointer; color:var(--muted); }\n.muted { color:var(--muted); font-size:13px; } .error { margin:12px 24px; color:#ffe6e6; background:#723e4e; padding:10px 14px; border-left:3px solid var(--red); }\n.row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #344c75; flex-wrap:wrap; } .grow { flex:1; min-width:90px; overflow-wrap:anywhere; }\n.badge { padding:3px 8px; background:#2b4166; border-radius:3px; font-size:12px; }\n.bracket { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:28px; }\n.match { border-left:3px solid #48658d; padding:0 14px; } .match.active { border-color:var(--gold); } .match h3 { margin-top:0; } .match p { margin:7px 0; } .qualified { color:var(--gold); }\n.scoreboard { margin:12px 0; } .score-row { display:flex; align-items:center; gap:12px; padding:12px; background:#263d65; margin:3px 0; border-radius:3px; }\n.position { width:30px; color:var(--muted); } .points { min-width:74px; text-align:right; font-variant-numeric:tabular-nums; } .time { font-variant-numeric:tabular-nums; color:var(--muted); }\n.finalist { border-left:4px solid var(--gold); padding-left:8px; } .finalist .points { color:var(--gold); } .won { background:#43513b; } .won .points { color:var(--gold); }\n.controls { display:flex; gap:9px; flex-wrap:wrap; margin-top:18px; } .setup-stats { display:flex; gap:25px; font:25px ForcedSquare,'Segoe UI',sans-serif; color:var(--gold); margin:25px 0; }\n.hud { position:fixed; left:18px; top:18px; width:min(420px,calc(100vw - 36px)); z-index:100099; background:#18264de8; padding:12px; border-left:4px solid var(--gold); border-radius:4px; pointer-events:none; }\n.hud-title { display:flex; gap:10px; justify-content:space-between; align-items:center; font-size:13px; } .hud-title > strong:first-child { font:22px ForcedSquare,'Segoe UI',sans-serif; }\n.hud .score-row { font-size:13px; padding:9px; gap:8px; } .hud p { margin:6px 0 0; font-size:11px; } .hud .time { min-width:42px; } .history { font-size:13px; border-bottom:1px solid #344c75; padding-bottom:10px; }\n.result { font:26px ForcedSquare,'Segoe UI',sans-serif; } [data-clock] { font-variant-numeric:tabular-nums; color:var(--gold); }\n@media(max-width:650px) { .panel { top:62px; right:8px; width:calc(100vw - 16px); max-height:calc(100dvh - 74px); } header,.body { padding:16px; } nav { padding:10px 12px 0; } .bracket { grid-template-columns:1fr; } .row { gap:8px; } h1 { font-size:30px; } .hud { top:64px; } }\n";

// src/ui.mjs
var h = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== void 0) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
var names = {
  registration: "Registration",
  "group-picks": "Captain picks",
  "track-picks": "Track picks",
  loading: "Loading track",
  warmup: "Warmup",
  countdown: "Get ready",
  racing: "Live round",
  "between-rounds": "Round results",
  "match-complete": "Match complete",
  complete: "World Cup results"
};
var time = (frames) => frames === void 0 ? "\u2014" : (frames / 1e3).toFixed(3);
var CupUI = class {
  constructor(controller) {
    this.c = controller;
    this.open = true;
    this.tab = "Tournament";
    this.signature = "";
    this.trackCategory = "official";
    this.trackQuery = "";
    this.carThumbnails = /* @__PURE__ */ new Map();
    const root = h("div");
    root.id = "polytrack-world-cup";
    document.body.append(root);
    this.shadow = root.attachShadow({ mode: "open" });
    const style = h("style", world_cup_default);
    this.shadow.append(style);
    this.toggle = this.button("World Cup \xB7 F8", () => {
      this.open = !this.open;
      this.signature = "";
      this.render();
    }, "launcher");
    this.panel = h("section", void 0, "panel");
    this.panel.setAttribute("aria-label", "World Cup tournament");
    this.hud = h("aside", void 0, "hud");
    this.shadow.append(this.toggle, this.panel, this.hud);
    for (const type of ["keydown", "keyup", "keypress"]) this.panel.addEventListener(type, (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) e.stopPropagation();
    });
    for (const type of ["keydown", "keyup", "keypress"]) window.addEventListener(type, (e) => {
      if (!this.panel.hidden && ["INPUT", "TEXTAREA", "SELECT"].includes(this.shadow.activeElement?.tagName))
        e.stopImmediatePropagation();
    }, { capture: true });
    this.panel.addEventListener("focusin", (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) && this.c.game)
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
  name(id) {
    return player(this.c.state, id)?.name ?? `Player ${id}`;
  }
  render() {
    const c = this.c, s = c.state;
    this.panel.hidden = !this.open;
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
      c.watchStatus
    ]);
    if (key !== this.signature) {
      const focus = this.shadow.activeElement?.dataset?.field;
      const drafts = Object.fromEntries([...this.shadow.querySelectorAll("[data-field]")].map((e) => [e.dataset.field, e.value]));
      this.signature = key;
      this.panel.replaceChildren();
      const header = h("header");
      const title = h("div");
      title.append(h("h1", "World Cup"), h("p", s ? `${s.name} / ${names[s.phase]}` : "PolyTrack 0.6.3 \xB7 Live competition"));
      header.append(title, this.button("Hide", () => {
        this.open = false;
      }, "quiet"));
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
        const footer = h("footer", c.isHost ? "Organizer \xB7 Scores save on this device" : "Connected to organizer");
        if (c.isHost) {
          footer.append(this.button("Export tournament", () => this.download(), "quiet"));
          footer.append(this.button("Leave Cup mode", () => {
            if (!confirm("End Cup mode for this lobby? Export first to keep a portable copy.")) return;
            c.transport.broadcast({ type: "end-cup" });
            c.state = null;
            c.auto = false;
            if (c.info?.spectator) c.info.spectator.isEnabled = false;
          }, "quiet"));
        }
        this.panel.append(footer);
      }
      for (const e of this.shadow.querySelectorAll("[data-field]")) if (e.dataset.field in drafts) e.value = drafts[e.dataset.field];
      if (focus) this.shadow.querySelector(`[data-field="${focus}"]`)?.focus();
      this.renderHud();
    }
    for (const e of this.shadow.querySelectorAll("[data-clock]")) {
      const run = s?.runtime;
      const target = s?.phase === "racing" ? run?.deadline : run?.startsAt;
      e.textContent = target ? `${Math.max(0, Math.ceil((target - c.now()) / 1e3))}s` : "";
    }
    for (const e of this.shadow.querySelectorAll("[data-pov-stats]")) e.textContent = c.watchedPose ? `${time(c.watchedPose.frames)} s \xB7 ${Math.round(c.watchedPose.speed)} km/h` : c.watchStatus;
  }
  welcome() {
    const content = h("div", void 0, "body");
    content.append(
      h("h2", "Eight racers. One World Cup."),
      h("p", "Host or join a normal multiplayer lobby to begin. Set Maximum Players to 16 to leave room for spectators."),
      h("p", "Everyone joins with the game\u2019s invite code and loads this mod. The organizer stays connected for semifinal A, semifinal B, and the final."),
      h("p", "F8 opens this panel. Spectators follow a racer\u2019s driving camera. Press [ or ] to cycle racers.", "muted")
    );
    this.panel.append(content);
  }
  setup() {
    const body = h("div", void 0, "body");
    body.append(h("h2", this.c.isHost ? "Create a World Cup" : "Waiting for the organizer"));
    if (this.c.isHost) {
      const label = h("label", "Competition name");
      const input = h("input");
      input.value = "World Cup";
      input.dataset.field = "cup-name";
      input.maxLength = 64;
      label.append(input);
      body.append(label);
      body.append(this.button("Create tournament", () => this.c.create(input.value), "primary"));
      const saved = localStorage.getItem("pwc-save-v1");
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
    } else body.append(h("p", "Your lobby host can create the event. You can race or spectate from the same lobby."));
    this.panel.append(body);
  }
  roster() {
    const s = this.c.state, c = this.c;
    this.body.append(
      h("h2", `${s.roster.length} / 8 racers`),
      h("p", "Seed 1 is captain A; seed 2 is captain B. They alternate opponent picks. Seed order also decides track-pick turns.", "muted")
    );
    const list = h("div", void 0, "rows");
    for (const p of s.roster) {
      const row = h("div", void 0, "row");
      row.append(h("strong", `#${p.seed}`), this.racerName(p.id, p.name));
      const online = c.lobby.some((l) => l.id === p.id);
      row.append(h("small", c.needsRebind?.has(p.id) ? "Confirm identity" : online ? "In lobby" : "Disconnected", "muted"));
      if (c.isHost && s.phase === "registration") {
        if (p.seed > 1) row.append(this.button("\u2191", () => c.change((s2) => moveSeed(s2, p.id, -1)), "quiet"));
        if (p.seed < s.roster.length) row.append(this.button("\u2193", () => c.change((s2) => moveSeed(s2, p.id, 1)), "quiet"));
        row.append(this.button("Remove", () => c.change((s2) => removePlayer(s2, p.id)), "quiet"));
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
    this.body.append(list, h("h3", "Lobby & spectators"));
    for (const l of c.lobby) {
      const row = h("div", void 0, "row");
      row.append(this.racerName(l.id, l.nickname), h("small", l.isSelf || c.hello.has(l.id) ? "Mod connected" : c.isHost ? "Awaiting mod" : "In lobby", "muted"));
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
    const style = this.c.lobby.find((p) => p.id === id)?.carStyle;
    if (style) {
      const key = style.serialize();
      if (!this.carThumbnails.has(key)) {
        if (this.carThumbnails.size >= 64) this.carThumbnails.delete(this.carThumbnails.keys().next().value);
        this.carThumbnails.set(key, this.c.native.carThumbnail(style).catch(() => null));
      }
      this.carThumbnails.get(key).then((url) => {
        if (url && image.isConnected) image.src = url;
      });
    }
    group.append(image, h("span", name));
    return group;
  }
  trackPack() {
    const s = this.c.state, c = this.c;
    this.body.append(h("h2", `Track pack \xB7 ${s.tracks.length} / 5`), h("p", "Choose three to five tracks from your game. Joined players receive the selected track automatically. Each track visit has a 15-second warmup and four scored rounds.", "muted"));
    for (const t of s.tracks) {
      const row = h("div", void 0, "row");
      row.append(h("span", t.name, "grow"));
      if (c.isHost && s.phase === "registration") row.append(this.button("Remove", () => c.change((s2) => {
        s2.tracks = s2.tracks.filter((track) => track.id !== t.id);
        c.tracks.delete(t.id);
        touch(s2);
      }), "quiet"));
      this.body.append(row);
    }
    if (c.isHost && s.phase === "registration") {
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
        if (!tracks.length) grid.append(h("p", this.trackCategory === "custom" && !this.trackQuery ? "No custom tracks saved in this game profile yet." : "No matching tracks.", "muted"));
        for (const track of tracks) {
          const selected = s.tracks.some((t) => t.id === track.id);
          const button = this.button("", async () => {
            button.disabled = true;
            try {
              await c.addLibraryTrack(track);
            } finally {
              if (button.isConnected) button.disabled = false;
            }
          }, `track-card${selected ? " added" : ""}`);
          button.disabled = selected || s.tracks.length >= 5;
          button.setAttribute("aria-label", `${selected ? "Added" : "Add"} ${track.name}`);
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
          text.append(h("strong", track.name), h("small", selected ? "Added to cup" : track.author || "Custom track", "muted"));
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
        this.button("Import track", () => {
          c.importTrack(code.value);
          code.value = "";
        }, "primary")
      );
      this.body.append(advanced);
    }
  }
  tournament() {
    const c = this.c, s = c.state, m = currentMatch(s);
    if (c.isHost && !s.runtime) {
      const label = h("label", void 0, "disconnect-rule");
      label.append(h("span", "If a racer disconnects during a race"));
      const select = h("select");
      select.setAttribute("aria-label", "Disconnect rule");
      for (const [value, text] of [["", "Choose a rule before starting"], ["dnf", "DNF; organizer may void the round"], ["void", "Void round and wait for reconnect"]]) {
        const option = h("option", text);
        option.value = value;
        option.selected = value === (s.disconnectPolicy ?? "");
        select.append(option);
      }
      select.addEventListener("change", () => c.change((s2) => {
        s2.disconnectPolicy = select.value || null;
        touch(s2);
      }));
      label.append(select);
      this.body.append(label);
    }
    if (c.canSpectate() && c.watchable().length) this.body.append(this.spectatorControls());
    if (s.phase === "registration") {
      this.body.append(h("h2", "Build the starting grid"), h("p", "Register eight lobby players and import a track pack, then confirm seeding. Everyone else stays a spectator."));
      const stats = h("div", void 0, "setup-stats");
      stats.append(h("span", `${s.roster.length}/8 racers`), h("span", `${s.tracks.length}/3\u20135 tracks`));
      this.body.append(stats);
      if (c.isHost) this.body.append(
        this.button("Racers & seeds", () => {
          this.tab = "Racers";
        }),
        this.button("Import tracks", () => {
          this.tab = "Tracks";
        }),
        this.button("Lock grid & begin captain picks", () => c.change(lockRegistration), "primary")
      );
    } else if (s.phase === "group-picks") {
      const actor = groupPicker(s);
      this.body.append(h("h2", `${this.name(actor)} chooses an opponent`), h("p", "Captains alternate until each semifinal has four racers.", "muted"));
      for (const p of s.roster.filter((p2) => !s.groups.flat().includes(p2.id))) {
        const row = h("div", void 0, "row");
        row.append(h("span", `#${p.seed} ${p.name}`, "grow"));
        if (actor === c.selfId) row.append(this.button("Pick opponent", () => c.action("pick-opponent", p.id)));
        else if (c.isHost) row.append(this.button("Record captain\u2019s pick", () => c.change((s2) => {
          note(s2, "Organizer recorded a captain pick.");
          pickOpponent(s2, actor, p.id);
        }), "quiet"));
        this.body.append(row);
      }
    } else if (s.phase === "track-picks") {
      const actor = trackPicker(s);
      this.body.append(h("h2", `${m.name} \xB7 Track picks`), h("p", `${this.name(actor)} picks next. Order: ${m.order.map((id) => s.tracks.find((t) => t.id === id).name).join(" / ") || "No picks yet"}`));
      for (const t of s.tracks.filter((t2) => !m.order.includes(t2.id))) {
        const row = h("div", void 0, "row");
        row.append(h("span", t.name, "grow"));
        if (actor === c.selfId) row.append(this.button("Pick track", () => c.action("pick-track", t.id)));
        else if (c.isHost) row.append(this.button("Record racer\u2019s pick", () => c.change((s2) => {
          note(s2, "Organizer recorded a track pick.");
          pickTrack(s2, actor, t.id);
        }), "quiet"));
        this.body.append(row);
      }
    } else {
      this.body.append(h("h2", s.phase === "complete" ? `${this.name(s.results[0].id)} wins the World Cup` : `${m.name} \xB7 ${names[s.phase]}`));
      this.body.append(this.scoreboard());
      if (s.runtime) {
        const status = h("p", `Round ${s.runtime.round} / ${s.tracks.find((t) => t.id === s.runtime.trackId)?.name} `);
        const clock = h("strong");
        clock.dataset.clock = "";
        status.append(clock);
        this.body.append(status);
        if (s.phase === "loading") this.body.append(h("p", `Ready: ${s.runtime.ready.length}/${activeIds(s).length}. Waiting for each racer to load the track.`, "muted"));
        if (s.phase === "racing" && activeIds(s).includes(c.selfId)) this.body.append(this.button("Retire this round (DNF)", () => c.action("dnf", s.runtime.id), "quiet"));
      }
      if (c.isHost) {
        const controls = h("div", void 0, "controls");
        if (s.phase === "between-rounds") controls.append(this.button("Start next round", () => {
          c.runRound();
          this.open = false;
        }, "primary"));
        if (s.phase === "match-complete") controls.append(this.button("Continue to next match", () => c.change(advanceMatch), "primary"));
        if (s.phase === "racing") controls.append(this.button("End round \xB7 unfinished DNF", () => {
          if (confirm("Score the current finishes and give every unfinished racer a DNF?")) c.finishRound();
        }, "quiet"));
        if (s.runtime) controls.append(this.button("Void & stop round", () => c.voidRound(), "quiet"));
        if (["between-rounds", "match-complete", "complete"].includes(s.phase)) controls.append(this.button("Undo last scored round", () => {
          if (confirm("Undo the last scored round in this match?")) c.change(undoRound);
        }, "quiet"));
        controls.append(this.button(c.auto ? "Automatic rounds: on" : "Automatic rounds: off", () => {
          c.auto = !c.auto;
        }, "quiet"));
        this.body.append(controls);
      }
    }
    if (s.phase !== "registration") this.bracket();
  }
  bracket() {
    const s = this.c.state, bracket = h("div", void 0, "bracket");
    for (let i = 0; i < 3; i++) {
      const match = s.matches[i], box = h("section", void 0, i === s.matchIndex ? "match active" : "match");
      box.append(h("h3", ["Semifinal A", "Semifinal B", "Grand final"][i]));
      const ids = match?.players ?? s.groups[i] ?? [];
      for (const id of ids) box.append(h("p", this.name(id), match?.winners.includes(id) ? "qualified" : ""));
      if (!ids.length) box.append(h("p", "Awaiting qualifiers", "muted"));
      bracket.append(box);
    }
    this.body.append(bracket);
  }
  scoreboard() {
    const s = this.c.state, m = currentMatch(s), board = h("div", void 0, "scoreboard");
    if (!m) return board;
    const ranking = rankMatch(s, m);
    for (const id of ranking) {
      const won = m.winners.indexOf(id), finalist = id in m.finalists;
      const row = h("div", void 0, `score-row${won >= 0 ? " won" : finalist ? " finalist" : ""}`);
      const position = h("strong", `#${ranking.indexOf(id) + 1}`, "position");
      row.append(
        position,
        h("span", this.name(id), "grow"),
        h("small", s.runtime?.dnfs.includes(id) ? "DNF" : time(s.runtime?.finishes[id]), "time"),
        h("strong", won >= 0 ? s.matchIndex === 2 ? "Podium" : "Qualified" : finalist ? "Finalist" : `${m.scores[id]} / ${m.target}`, "points")
      );
      board.append(row);
    }
    return board;
  }
  renderHud() {
    this.hud.replaceChildren();
    this.hud.hidden = !this.c.state || !currentMatch(this.c.state) || this.open;
    if (this.hud.hidden) return;
    const s = this.c.state, m = currentMatch(s), title = h("div", void 0, "hud-title");
    title.append(h("strong", m.name), h("span", names[s.phase]));
    const clock = h("strong");
    clock.dataset.clock = "";
    title.append(clock);
    this.hud.append(title, this.scoreboard());
    if (this.c.canSpectate()) this.hud.append(this.spectatorControls());
    this.hud.append(h("p", "F8 \xB7 Tournament controls", "muted"));
  }
  spectatorControls() {
    const c = this.c, box = h("section", void 0, "pov");
    box.append(h("strong", `Watching ${c.watchId === null ? "\u2014" : this.name(c.watchId)}`));
    const controls = h("div", void 0, "controls");
    controls.append(this.button("\u2190 Previous [", () => c.cycleWatch(-1), "quiet"));
    const select = h("select");
    select.setAttribute("aria-label", "Spectate racer");
    for (const id of c.watchable()) {
      const option = h("option", this.name(id));
      option.value = id;
      option.selected = id === c.watchId;
      select.append(option);
    }
    select.addEventListener("change", () => c.selectWatch(Number(select.value)));
    controls.append(select, this.button("Next ] \u2192", () => c.cycleWatch(1), "quiet"));
    const stats = h("p", c.watchStatus, "muted");
    stats.dataset.povStats = "";
    box.append(controls, stats);
    return box;
  }
  results() {
    const s = this.c.state;
    this.body.append(h("h2", "Results & race history"));
    if (s.results.length) for (const r of s.results) this.body.append(h("p", `${r.place}. ${this.name(r.id)}`, "result"));
    for (const m of s.matches) {
      this.body.append(h("h3", m.name));
      if (!m.roundsLog.length) this.body.append(h("p", "No scored rounds yet.", "muted"));
      for (const r of m.roundsLog.slice(-20).reverse()) {
        this.body.append(h("p", `Round ${r.round}: ${m.players.map((id) => `${this.name(id)} ${r.finishes[id] === void 0 ? "DNF / already qualified" : time(r.finishes[id])}`).join(" / ")}${r.tiedFirst ? " \xB7 Tied first: no finalist win" : ""}`, "history"));
      }
    }
    this.body.append(h("p", "The organizer\u2019s export contains the full round history. Live clients show the latest round per match.", "muted"));
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
var { PolyMod } = await import(new URL("PolyTypes.js", document.baseURI).href);
var WorldCup = class extends PolyMod {
  init = (pml) => {
    this.controller = new Controller(() => this.ui?.render());
    try {
      this.controller.init(pml);
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
var polyMod = new WorldCup();
export {
  polyMod
};
