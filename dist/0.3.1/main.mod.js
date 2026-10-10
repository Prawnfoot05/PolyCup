// src/physics-integrity.ts
var STOCK_PHYSICS = "d4ef02676973d41afc34b23b5248f6950b35dc4cc7e3047e3a9c6bd88e4c180e";
function validPhysicsReport(value) {
  if (!value || typeof value !== "object") return false;
  const r = value;
  return (r.hash === null || typeof r.hash === "string" && /^[a-f0-9]{64}$/.test(r.hash)) && (r.driveForce === null || typeof r.driveForce === "number" && Number.isFinite(r.driveForce));
}
async function inspectPhysics(bytes2) {
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes2)),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
  const view = new DataView(bytes2), offset = 194624;
  const force = bytes2.byteLength >= offset + 5 && view.getUint8(offset) === 67 ? view.getFloat32(offset + 1, true) : null;
  return { hash, driveForce: force !== null && Number.isFinite(force) ? force : null };
}
var PhysicsIntegrity = class {
  #report = { hash: null, driveForce: null };
  #generation = 0;
  get report() {
    return { ...this.#report };
  }
  install(pml) {
    if (!pml.getPhysicsWasmURL) return;
    const original = pml.getPhysicsWasmURL;
    pml.getPhysicsWasmURL = (...args) => {
      const url = original.apply(pml, args);
      const generation = ++this.#generation;
      this.#report = { hash: null, driveForce: null };
      void fetch(url, { signal: AbortSignal.timeout(15e3) }).then((r) => {
        if (!r.ok) throw new Error("Physics unavailable");
        return r.arrayBuffer();
      }).then(inspectPhysics).then((report) => {
        if (generation === this.#generation) this.#report = report;
      }).catch(() => {
      });
      return url;
    };
  }
};

// src/record-awards.ts
function recordBaselines(records) {
  return {
    ...records?.wr?.status === "ready" ? { wr: records.wr.frames } : {},
    ...records?.tr ? { tr: records.tr.frames } : {},
    pbs: Object.fromEntries(
      Object.entries(records?.pbs ?? {}).flatMap(
        ([id, pb]) => pb.status === "ready" ? [[id, pb.frames]] : pb.status === "missing" ? [[id, null]] : []
      )
    )
  };
}
function recordAward(run, id, frames) {
  const baseline = run.recordBaselines;
  const fastest = Math.min(...Object.values(run.finishes));
  if (baseline?.wr !== void 0 && frames < Math.min(baseline.wr, fastest)) return "WR";
  if (frames < Math.min(baseline?.tr ?? Infinity, fastest)) return "TR";
  const pb = baseline?.pbs[id];
  return pb === null || pb !== void 0 && frames < pb ? "PB" : null;
}

// src/presets.ts
var standard = {
  allowRacerChanges: false,
  allowSpectatorFreecam: true,
  uploadLeaderboardTimes: false,
  roundsPerTrack: 4,
  pointsToWin: 140,
  finalist: true,
  points: [10, 8, 6, 5, 4, 3, 2, 1],
  selection: "draft",
  bansPerRacer: 1,
  picksPerRacer: 1,
  pool: ["official", "community"],
  warmup: "first-visit",
  warmupTiming: "wr",
  warmupSeconds: 90,
  warmupMultiplier: 1.5,
  warmupMinimumSeconds: 30,
  readyEndsWarmup: true,
  finishTimeoutSeconds: 10,
  roundBreakSeconds: 5
};
function standardPreset() {
  return {
    format: "polycup-preset",
    schema: 1,
    name: "Standard",
    rules: structuredClone(standard)
  };
}
function quickplayPreset() {
  const preset = standardPreset();
  preset.name = "Quickplay";
  Object.assign(preset.rules, {
    allowRacerChanges: true,
    roundsPerTrack: 3,
    pointsToWin: 100,
    finalist: false,
    selection: "random",
    bansPerRacer: 0,
    picksPerRacer: 0,
    warmup: "off"
  });
  return preset;
}
function rulesFor(state) {
  return state?.preset?.rules ?? {
    ...standard,
    bansPerRacer: state?.draft ? 1 : 0,
    pool: state?.draft ? ["official", "community"] : ["official", "community", "custom"]
  };
}
function validPreset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value, r = p.rules;
  const integer = (n, min, max) => Number.isSafeInteger(n) && Number(n) >= min && Number(n) <= max;
  return p.format === "polycup-preset" && p.schema === 1 && typeof p.name === "string" && p.name.trim().length > 0 && p.name.length <= 64 && !/[\u0000-\u001f\u007f]/.test(p.name) && !!r && typeof r === "object" && !Array.isArray(r) && Object.keys(p).every((k) => ["format", "schema", "name", "rules"].includes(k)) && Object.keys(r).length === Object.keys(standard).length - (r.uploadLeaderboardTimes === void 0 ? 1 : 0) - (r.allowSpectatorFreecam === void 0 ? 1 : 0) && Object.keys(r).every((k) => k in standard) && integer(r.roundsPerTrack, 1, 30) && integer(r.pointsToWin, 1, 1e4) && typeof r.finalist === "boolean" && typeof r.allowRacerChanges === "boolean" && (r.allowSpectatorFreecam === void 0 || typeof r.allowSpectatorFreecam === "boolean") && (r.uploadLeaderboardTimes === void 0 || typeof r.uploadLeaderboardTimes === "boolean") && Array.isArray(r.points) && r.points.length === 8 && r.points[0] > 0 && r.points.every((n, i) => integer(n, 0, 1e3) && (!i || n <= r.points[i - 1])) && ["draft", "random"].includes(r.selection) && integer(r.bansPerRacer, 0, 3) && integer(r.picksPerRacer, 0, 3) && Array.isArray(r.pool) && r.pool.length > 0 && new Set(r.pool).size === r.pool.length && r.pool.every((k) => ["official", "community", "custom"].includes(k)) && (r.bansPerRacer === 0 || !r.pool.includes("custom")) && (r.selection === "random" ? r.bansPerRacer === 0 && r.picksPerRacer === 0 : r.picksPerRacer >= 1 && (!r.bansPerRacer || r.pool.some((k) => k !== "custom"))) && ["off", "first-visit", "every-visit"].includes(r.warmup) && ["wr", "fixed"].includes(r.warmupTiming) && integer(r.warmupSeconds, 10, 600) && integer(r.warmupMinimumSeconds, 10, 300) && typeof r.warmupMultiplier === "number" && Number.isFinite(r.warmupMultiplier) && r.warmupMultiplier >= 0.5 && r.warmupMultiplier <= 5 && typeof r.readyEndsWarmup === "boolean" && integer(r.finishTimeoutSeconds, 5, 120) && integer(r.roundBreakSeconds, 3, 60);
}
function parsePreset(text) {
  if (text.length > 32e3) throw new Error("Preset files must be smaller than 32 KB.");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid preset JSON file.");
  }
  const rules = value?.rules;
  if (typeof rules?.bansPerRacer === "number" && rules.bansPerRacer > 0 && Array.isArray(rules.pool) && rules.pool.includes("custom"))
    throw new Error(
      "Custom tracks require zero bans per racer. Update the preset before importing it."
    );
  if (!validPreset(value))
    throw new Error("Unsupported or invalid preset. Check its rules and preset format.");
  return {
    ...structuredClone(value),
    rules: { allowSpectatorFreecam: true, uploadLeaderboardTimes: false, ...value.rules }
  };
}
function presetText(preset) {
  if (!validPreset(preset)) throw new Error("Fix the preset rules before exporting.");
  return JSON.stringify(preset, null, 2) + "\n";
}
function presetKey(preset) {
  const rules = {
    ...preset.rules,
    allowSpectatorFreecam: preset.rules.allowSpectatorFreecam !== false,
    uploadLeaderboardTimes: preset.rules.uploadLeaderboardTimes === true
  };
  return JSON.stringify({
    name: preset.name,
    rules: Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)))
  });
}
var PresetLibrary = class {
  #storage;
  constructor(storage = localStorage) {
    this.#storage = storage;
  }
  list() {
    try {
      const values = JSON.parse(this.#storage.getItem("polycup-presets-v1") ?? "[]");
      return Array.isArray(values) ? values.filter(validPreset).slice(0, 30).map((preset) => ({
        ...preset,
        rules: {
          allowSpectatorFreecam: true,
          uploadLeaderboardTimes: false,
          ...preset.rules
        }
      })) : [];
    } catch {
      return [];
    }
  }
  save(preset) {
    if (!validPreset(preset)) throw new Error("Fix the preset rules before saving.");
    if (["standard", "quickplay"].includes(preset.name.trim().toLowerCase()))
      throw new Error(
        "Choose a new name for your custom preset. Bundled presets are kept unchanged."
      );
    const values = this.list().filter((p) => p.name.toLowerCase() !== preset.name.toLowerCase());
    if (values.length >= 30)
      throw new Error("Remove a saved preset before adding another (limit 30).");
    this.#storage.setItem("polycup-presets-v1", JSON.stringify([...values, preset]));
  }
  remove(name) {
    this.#storage.setItem(
      "polycup-presets-v1",
      JSON.stringify(this.list().filter((p) => p.name !== name))
    );
  }
};

// src/draft.ts
function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}
var rosterOpen = (s) => s.phase === "registration" && (!s.draft || s.draft.stage === "roster");
var picksOpen = (s) => rulesFor(s).selection === "draft" && s.phase === "registration" && (!s.draft || s.draft.stage === "picks");
var banEntries = (s) => s.draft?.banHistory ?? Object.entries(s.draft?.bans ?? {}).map(([id, track]) => ({ racerId: Number(id), track }));
var banTurn = (s) => s.draft?.stage === "bans" ? s.draft.order[banEntries(s).length % s.draft.order.length] : null;
var isBanned = (s, id) => banEntries(s).some((b) => b.track.id === id);
function resetDraft(s) {
  requireThat(s.phase === "registration", "The Cup has already started.");
  s.draft = { stage: "roster", order: [], bans: {} };
  s.picks = {};
  s.selections = {};
  s.tracks = [];
  s.records = {};
  s.revision++;
}
function beginBans(s, random = Math.random) {
  requireThat(rulesFor(s).selection === "draft", "Random Cups do not have a draft.");
  requireThat(rosterOpen(s), "Bans have already started.");
  requireThat(s.roster.length >= 2, "At least two racers are required.");
  const order = s.roster.map((p) => p.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  s.draft = { stage: rulesFor(s).bansPerRacer ? "bans" : "picks", order, bans: {} };
  s.picks = {};
  s.selections = {};
  s.tracks = [];
  s.records = {};
  s.revision++;
}
function banTrack(s, actor, track) {
  requireThat(
    s.draft && s.phase === "registration" && banTurn(s) === actor,
    "Wait for your ban turn."
  );
  requireThat(
    track && ["official", "community"].includes(track.category) && /^[a-f0-9]{64}$/i.test(track.id),
    "Bans must come from the main or community track pool."
  );
  requireThat(
    rulesFor(s).pool.includes(track.category),
    "That track category is not allowed by this preset."
  );
  requireThat(!isBanned(s, track.id), "That track is already banned.");
  const history = banEntries(s);
  s.draft.bans[actor] = {
    id: track.id,
    name: String(track.name).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64)
  };
  s.draft.banHistory = [...history, { racerId: actor, track: s.draft.bans[actor] }];
  if (s.draft.banHistory.length === s.draft.order.length * rulesFor(s).bansPerRacer)
    s.draft.stage = "picks";
  s.revision++;
}
function validDraft(s) {
  const d = s.draft;
  if (d === void 0) return true;
  if (!d || !["roster", "bans", "picks"].includes(d.stage) || !Array.isArray(d.order) || !d.bans || typeof d.bans !== "object" || Array.isArray(d.bans) || d.banHistory !== void 0 && (!Array.isArray(d.banHistory) || d.banHistory.some((b) => !b || !b.track || typeof b.track.id !== "string")))
    return false;
  const keys = Object.keys(d.bans), bans = Object.values(d.bans);
  if (d.stage === "roster")
    return (s.phase === "registration" || rulesFor(s).selection === "random") && !d.order.length && !keys.length && (!s.tracks.length || rulesFor(s).selection === "random") && !Object.keys(s.picks).length;
  if (d.order.length < 2 || d.order.length !== s.roster.length && (s.phase === "registration" || !rulesFor(s).allowRacerChanges) || new Set(d.order).size !== d.order.length || !d.order.every((id) => s.roster.some((p) => p.id === id)) || keys.length > d.order.length || !keys.every((id) => d.order.includes(Number(id))) || !bans.every(
    (t) => t && typeof t.id === "string" && /^[a-f0-9]{64}$/i.test(t.id) && typeof t.name === "string" && t.name.length <= 64
  ) || new Set(bans.map((t) => t.id)).size !== bans.length || s.tracks.some((t) => isBanned(s, t.id)))
    return false;
  const entries = banEntries(s), total = d.order.length * rulesFor(s).bansPerRacer;
  if (d.banHistory !== void 0 && (!Array.isArray(d.banHistory) || entries.length > 24))
    return false;
  if (entries.length > total || entries.some(
    (b, i) => !b || b.racerId !== d.order[i % d.order.length] || !b.track || typeof b.track.id !== "string" || !/^[a-f0-9]{64}$/i.test(b.track.id) || typeof b.track.name !== "string" || b.track.name.length > 64
  ) || new Set(entries.map((b) => b.track.id)).size !== entries.length || keys.some(
    (id) => entries.filter((b) => b.racerId === Number(id)).at(-1)?.track.id !== d.bans[Number(id)].id
  ))
    return false;
  return d.stage === "bans" ? s.phase === "registration" && entries.length < total && !s.tracks.length && !Object.keys(s.picks).length : entries.length === total;
}

// src/cup.ts
var VERSION = "0.3.1";
var RULES = Object.freeze({
  points: [10, 8, 6, 5, 4, 3, 2, 1],
  target: 140,
  fallbackRounds: 4,
  warmupMs: 15e3,
  finishTimeoutMs: 1e4
});
var copy = (value) => structuredClone(value);
function requireThat2(ok, message) {
  if (!ok) throw new Error(message);
}
var safeName = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64);
function newCup(name = "Simple Cup", preset = standardPreset()) {
  requireThat2(validPreset(preset), "Invalid Cup preset.");
  return {
    preset: copy(preset),
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
  const m = state && currentMatch(state);
  return m ? m.players.filter(
    (id) => !m.winners.includes(id) && !state?.withdrawn?.includes(id) && !state?.pendingRacers?.includes(id)
  ) : [];
}
function occupiedSlots(state) {
  return state.phase === "registration" ? state.roster.length : activeIds(state).length + (state.pendingRacers?.length ?? 0);
}
function enterRunningCup(state, id, name) {
  requireThat2(
    rulesFor(state).allowRacerChanges && state.phase !== "registration" && state.phase !== "complete",
    "This preset locks the racer roster during the Cup."
  );
  requireThat2(Number.isSafeInteger(id) && id > 0, "Invalid lobby player.");
  requireThat2(
    !activeIds(state).includes(id) && !state.pendingRacers?.includes(id),
    "You already have a racer slot."
  );
  requireThat2(occupiedSlots(state) < 8, "All eight racer places are filled.");
  const match = currentMatch(state);
  if (!player(state, id)) {
    requireThat2(
      state.roster.length < 128,
      "This Cup has reached its participant limit. Start a new Cup."
    );
    state.roster.push({ id, name: safeName(name) });
    match.players.push(id);
    match.scores[id] = 0;
  }
  state.withdrawn = (state.withdrawn ?? []).filter((other) => other !== id);
  if (state.runtime) (state.pendingRacers ??= []).push(id);
  touch(state);
}
function leaveRunningCup(state, id) {
  requireThat2(
    rulesFor(state).allowRacerChanges && state.phase !== "registration" && state.phase !== "complete",
    "This preset locks the racer roster during the Cup."
  );
  requireThat2(player(state, id), "You are not registered in this Cup.");
  const run = state.runtime;
  if (run && activeIds(state).includes(id) && !(id in run.finishes) && !run.dnfs.includes(id))
    run.dnfs.push(id);
  state.pendingRacers = (state.pendingRacers ?? []).filter((other) => other !== id);
  if (!state.withdrawn?.includes(id)) (state.withdrawn ??= []).push(id);
  touch(state);
}
function admitPendingRacers(state, online) {
  if (state.runtime || state.phase !== "between-rounds") return;
  for (const id of state.pendingRacers ?? [])
    if (!online.includes(id)) {
      if (!state.withdrawn?.includes(id)) (state.withdrawn ??= []).push(id);
    }
  if (state.pendingRacers?.length) {
    state.pendingRacers = [];
    touch(state);
  }
}
function player(state, id) {
  return state?.roster.find((p) => p.id === id);
}
function racingIds(state) {
  return activeIds(state).filter((id) => !state?.runtime?.sittingOut?.includes(id));
}
function sitOut(state, id) {
  const run = state.runtime;
  if (!run || !activeIds(state).includes(id) || id in run.finishes) return;
  const excluded = run.sittingOut ??= [];
  if (excluded.includes(id)) return;
  excluded.push(id);
  if (!run.dnfs.includes(id)) run.dnfs.push(id);
  touch(state);
}
function roundDone(state, id) {
  return state?.phase === "racing" && !!state.runtime && (id !== null && id in state.runtime.finishes || state.runtime.dnfs.includes(id));
}
function mayWatch(state, id) {
  return !!state && state.phase !== "complete" && (!racingIds(state).includes(id) || roundDone(state, id));
}
function rematch(state, newTracks = false) {
  requireThat2(state.phase === "complete", "Finish the Cup before starting a rematch.");
  const next = newCup(state.name, state.preset ?? standardPreset());
  next.roster = copy(state.roster.filter((p) => !state.withdrawn?.includes(p.id)));
  next.disconnectPolicy = state.disconnectPolicy;
  if (!newTracks) {
    next.tracks = copy(state.tracks);
    next.picks = copy(state.picks);
    next.selections = copy(state.selections ?? {});
    for (const id of state.withdrawn ?? []) {
      delete next.picks[id];
      delete next.selections[id];
    }
    if (state.draft && !state.withdrawn?.length) next.draft = copy(state.draft);
    if (rulesFor(next).selection === "draft" && next.roster.some((p) => !picksComplete(next, p.id)))
      resetDraft(next);
  } else resetDraft(next);
  return next;
}
function applyPreset(state, preset) {
  requireThat2(rosterOpen(state), "Reopen setup before changing the preset.");
  requireThat2(validPreset(preset), "Invalid Cup preset.");
  resetDraft(state);
  state.preset = copy(preset);
  touch(state);
}
function chosenTracks(state, id) {
  return state.selections?.[id] ?? (state.picks[id] ? [state.picks[id]] : []);
}
function picksComplete(state, id) {
  return chosenTracks(state, id).length === rulesFor(state).picksPerRacer;
}
function removePick(state, actor, trackId) {
  requireThat2(picksOpen(state) && player(state, actor), "Picks can only be changed during setup.");
  const picks = chosenTracks(state, actor).filter((id) => id !== trackId);
  (state.selections ??= {})[actor] = picks;
  if (picks.length) state.picks[actor] = picks[0];
  else delete state.picks[actor];
  pruneTracks(state);
  touch(state);
}
function note(state, message) {
  state.audit.push({ at: (/* @__PURE__ */ new Date()).toISOString(), message: safeName(message) });
  state.audit = state.audit.slice(-500);
}
function touch(state) {
  state.revision++;
}
function addPlayer(state, id, name) {
  requireThat2(rosterOpen(state), "Roster is locked for the draft. Ask the organizer to reopen it.");
  requireThat2(Number.isSafeInteger(id) && id > 0, "Invalid lobby player.");
  requireThat2(state.roster.length < 8, "All eight racer places are filled.");
  requireThat2(!player(state, id), "This player is already registered.");
  state.roster.push({ id, name: safeName(name) });
  touch(state);
}
function removePlayer(state, id) {
  requireThat2(rosterOpen(state), "Roster is locked for the draft. Ask the organizer to reopen it.");
  state.roster = state.roster.filter((p) => p.id !== id);
  delete state.picks[id];
  if (state.selections) delete state.selections[id];
  for (const r of Object.values(state.records)) delete r.pbs[id];
  pruneTracks(state);
  touch(state);
}
function pruneTracks(state) {
  state.tracks = state.tracks.filter(
    (t) => state.roster.some((p) => chosenTracks(state, p.id).includes(t.id))
  );
  for (const id of Object.keys(state.records))
    if (!state.tracks.some((t) => t.id === id)) delete state.records[id];
}
function chooseTrack(state, actor, track) {
  requireThat2(picksOpen(state), "Finish all bans before picking tracks.");
  requireThat2(player(state, actor), "Join as a racer before choosing a track.");
  requireThat2(
    typeof track.id === "string" && /^[a-f0-9]{64}$/i.test(track.id),
    "Invalid track ID."
  );
  requireThat2(!isBanned(state, track.id), "That track was banned.");
  const rules = rulesFor(state), selected = chosenTracks(state, actor);
  requireThat2(rules.selection === "draft", "This Cup chooses tracks randomly.");
  requireThat2(!selected.includes(track.id), "You already picked that track.");
  requireThat2(
    rules.picksPerRacer === 1 || selected.length < rules.picksPerRacer,
    "Remove a pick before choosing another track."
  );
  if (!state.tracks.some((t) => t.id === track.id))
    state.tracks.push({ id: track.id, name: safeName(track.name) });
  (state.selections ??= {})[actor] = rules.picksPerRacer === 1 ? [track.id] : [...selected, track.id];
  state.picks[actor] = state.selections[actor][0];
  pruneTracks(state);
  touch(state);
}
function lockRegistration(state, random = Math.random) {
  const rules = rulesFor(state);
  requireThat2(state.phase === "registration", "The Cup has already started.");
  requireThat2(
    rules.selection === "random" || picksOpen(state),
    "Finish the bans before starting the Cup."
  );
  requireThat2(
    state.roster.length >= 2 && state.roster.length <= 8,
    "Two to eight racers can start a Cup."
  );
  requireThat2(
    rules.selection === "random" ? state.tracks.length > 0 : state.roster.every(
      (p) => picksComplete(state, p.id) && chosenTracks(state, p.id).every((id) => state.tracks.some((t) => t.id === id))
    ),
    `Each racer needs ${rules.picksPerRacer} track pick${rules.picksPerRacer === 1 ? "" : "s"}.`
  );
  const order = state.tracks.map((t) => t.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const players = state.roster.map((p) => p.id);
  const trackRounds = Object.fromEntries(order.map((id) => [id, rules.roundsPerTrack]));
  const trackWarmups = Object.fromEntries(
    order.map((id) => [id, practiceForRecord(state.records[id]?.wr, rules)])
  );
  state.matches = [
    {
      name: "Simple Cup",
      players,
      target: rules.pointsToWin,
      winnerCount: 1,
      order,
      trackRounds,
      trackWarmups,
      rounds: 0,
      winners: [],
      scores: Object.fromEntries(players.map((id) => [id, 0])),
      finalists: {},
      roundsLog: [],
      ranking: [],
      ...rules.selection === "random" ? { randomTrack: { id: order[0], fromRound: 0, rounds: rules.roundsPerTrack } } : {}
    }
  ];
  state.matchIndex = 0;
  state.phase = "between-rounds";
  touch(state);
}
function practiceForRecord(wr, rules = rulesFor(null)) {
  if (rules.warmup === "off") return 0;
  if (rules.warmupTiming === "fixed") return rules.warmupSeconds * 1e3;
  const duration = typeof wr?.frames === "number" && wr?.status === "ready" && Number.isSafeInteger(wr.frames) && wr.frames > 0 && wr.frames <= 36e5 ? wr.frames : null;
  return duration === null ? rules.warmupSeconds * 1e3 : Math.max(rules.warmupMinimumSeconds * 1e3, Math.ceil(duration * rules.warmupMultiplier));
}
function practiceReady(state, id, roundId) {
  if (!rulesFor(state).readyEndsWarmup) return false;
  if (state.phase !== "warmup" || state.runtime?.id !== roundId || !racingIds(state).includes(id))
    return false;
  const ready = state.runtime.practiceReady ??= [];
  if (ready.includes(id)) return false;
  ready.push(id);
  touch(state);
  return true;
}
function trackProgress(state, completedRounds = currentMatch(state)?.rounds ?? 0) {
  const m = state && currentMatch(state);
  if (!m?.order.length) return null;
  if (rulesFor(state).selection === "random") {
    const block = m.randomTrack;
    if (!block || completedRounds < block.fromRound || completedRounds >= block.fromRound + block.rounds)
      return null;
    return {
      trackId: block.id,
      round: completedRounds - block.fromRound + 1,
      rounds: block.rounds
    };
  }
  const count = (id) => m.trackRounds?.[id] ?? RULES.fallbackRounds;
  const cycle = m.order.reduce((sum, id) => sum + count(id), 0);
  let offset = (completedRounds + (m.rotationOffset ?? 0)) % cycle;
  for (const trackId of m.order) {
    const rounds = count(trackId);
    if (offset < rounds) return { trackId, round: offset + 1, rounds };
    offset -= rounds;
  }
}
function nextTrack(state) {
  return trackProgress(state)?.trackId ?? null;
}
function scheduleRandomTrack(state, track, wr) {
  requireThat2(
    state.phase === "between-rounds" && rulesFor(state).selection === "random",
    "Random tracks can only change between rounds."
  );
  const m = currentMatch(state), rules = rulesFor(state);
  if (!state.tracks.some((t) => t.id === track.id))
    state.tracks.push({ ...track, name: safeName(track.name) });
  if (!m.order.includes(track.id)) m.order.push(track.id);
  (state.records[track.id] ??= { pbs: {} }).wr = wr;
  (m.trackRounds ??= {})[track.id] = rules.roundsPerTrack;
  (m.trackWarmups ??= {})[track.id] = practiceForRecord(wr, rules);
  m.randomTrack = { id: track.id, fromRound: m.rounds, rounds: rules.roundsPerTrack };
  touch(state);
}
function beginRound(state) {
  requireThat2(state.phase === "between-rounds", "Finish setup or the current round first.");
  const m = state && currentMatch(state);
  const visit = trackProgress(state);
  requireThat2(visit, "No track scheduled.");
  m.currentVisit = { trackId: visit.trackId, fromRound: m.rounds - visit.round + 1 };
  const firstVisit = !m.roundsLog.some((r) => r.trackId === visit.trackId);
  state.runtime = {
    racers: activeIds(state),
    id: crypto.randomUUID(),
    round: m.rounds + 1,
    trackId: visit.trackId,
    warmup: rulesFor(state).warmup !== "off" && visit.round === 1 && (rulesFor(state).warmup === "every-visit" || m.trackWarmups === void 0 || firstVisit),
    sessionId: null,
    ready: [],
    practiceReady: [],
    startsAt: null,
    deadline: null,
    finishes: {},
    dnfs: [],
    checkpoints: {},
    splits: {},
    liveMovement: {}
  };
  state.phase = "loading";
  touch(state);
}
function startRace(state, now) {
  requireThat2(state.phase === "countdown", "A countdown is required before racing.");
  requireThat2(state.runtime, "No active round.");
  state.runtime.recordBaselines = recordBaselines(state.records[state.runtime.trackId]);
  state.runtime.startsAt = now;
  state.phase = "racing";
  touch(state);
}
function recordFinish(state, id, frames, now) {
  if (state.phase !== "racing" || !activeIds(state).includes(id)) return false;
  const run = state.runtime;
  if (!run || run.startsAt === null) return false;
  if (id in run.finishes || run.dnfs.includes(id)) return false;
  if (!Number.isSafeInteger(frames) || frames <= 0 || frames > 36e5) return false;
  if (frames > now - run.startsAt + 2e3) return false;
  if (run.deadline !== null && (now > run.deadline + 1500 || frames > run.deadline - run.startsAt))
    return false;
  const award = recordAward(run, id, frames);
  if (award) (run.recordAwards ??= {})[id] = award;
  run.finishes[id] = frames;
  const finishAt = run.startsAt + frames;
  run.deadline = Math.min(
    run.deadline ?? Infinity,
    finishAt + rulesFor(state).finishTimeoutSeconds * 1e3
  );
  touch(state);
  return true;
}
function markDNF(state, id) {
  requireThat2(state.phase === "racing", "There is no live round.");
  requireThat2(state.runtime && activeIds(state).includes(id), "This player is not racing.");
  requireThat2(!(id in state.runtime.finishes), "A finished run cannot be changed to DNF.");
  if (!state.runtime.dnfs.includes(id)) {
    state.runtime.dnfs.push(id);
    touch(state);
  }
}
function allFinished(state) {
  if (!state.runtime) return false;
  const run = state.runtime;
  return activeIds(state).every((id) => id in run.finishes || run.dnfs.includes(id));
}
function completeRound(state) {
  const rules = rulesFor(state);
  requireThat2(state.phase === "racing", "There is no live round.");
  const m = currentMatch(state), run = state.runtime;
  requireThat2(run, "No active round.");
  const before = copy(m), beforeRanking = rankMatch(state, m).filter(
    (id) => !state.withdrawn?.includes(id) && !state.pendingRacers?.includes(id)
  ), ids = run.racers ?? activeIds(state);
  const order = ids.filter((id) => id in run.finishes).sort((a, b) => run.finishes[a] - run.finishes[b]);
  const placements = {};
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    placements[id] = i > 0 && run.finishes[id] === run.finishes[order[i - 1]] ? placements[order[i - 1]] : i + 1;
  }
  const first = order[0], firstIsTied = order.length > 1 && run.finishes[first] === run.finishes[order[1]];
  if (rules.finalist && first !== void 0 && !firstIsTied && first in m.finalists)
    m.winners.push(first);
  const points = {};
  for (const id of order) {
    points[id] = id in m.finalists ? 0 : rules.finalist ? Math.min(m.target - m.scores[id], rules.points[placements[id] - 1]) : rules.points[placements[id] - 1];
    if (!(id in m.finalists)) {
      m.scores[id] = rules.finalist ? Math.min(m.target, m.scores[id] + points[id]) : m.scores[id] + points[id];
      if (rules.finalist && m.scores[id] === m.target)
        m.finalists[id] = {
          round: run.round,
          position: placements[id],
          checkpoint: run.checkpoints[id] ?? null
        };
    }
  }
  if (!rules.finalist) {
    const eligible2 = m.players.filter((id) => !state.withdrawn?.includes(id) || id in run.finishes), best = Math.max(...eligible2.map((id) => m.scores[id])), leaders = eligible2.filter((id) => m.scores[id] === best);
    if (best >= m.target && leaders.length === 1) m.winners.push(leaders[0]);
  }
  m.rounds++;
  m.roundsLog.push({
    beforeRanking,
    round: run.round,
    trackId: run.trackId,
    finishes: copy(run.finishes),
    ...run.recordAwards ? { recordAwards: copy(run.recordAwards) } : {},
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
function rankMatch(_state, m) {
  return [
    ...m.winners,
    ...m.players.filter((id) => !m.winners.includes(id)).sort((a, b) => {
      if (m.scores[a] !== m.scores[b]) return m.scores[b] - m.scores[a];
      const x = m.finalists[a], y = m.finalists[b];
      if (x && y) {
        if (x.round !== y.round) return x.round - y.round;
        if (x.position !== y.position) return x.position - y.position;
        if (x.checkpoint !== null && y.checkpoint !== null && x.checkpoint !== y.checkpoint)
          return x.checkpoint - y.checkpoint;
      }
      return 0;
    })
  ];
}
function refreshSessionRecords(state) {
  for (const t of state.tracks) {
    const records = state.records[t.id] ??= { pbs: {} };
    records.tr = null;
    for (const m of state.matches)
      for (const r of m.roundsLog)
        if (r.trackId === t.id) {
          for (const [id, frames] of Object.entries(r.finishes)) {
            if (!records.tr || frames < records.tr.frames)
              records.tr = { frames, ids: [Number(id)] };
            else if (frames === records.tr.frames && !records.tr.ids.includes(Number(id)))
              records.tr.ids.push(Number(id));
          }
        }
  }
}
function voidRound(state) {
  requireThat2(
    ["loading", "warmup", "countdown", "racing"].includes(state.phase),
    "There is no round to void."
  );
  state.runtime = null;
  state.phase = "between-rounds";
  note(state, "Organizer voided the current round.");
  touch(state);
}
function undoRound(state) {
  requireThat2(
    ["between-rounds", "match-complete", "complete"].includes(state.phase),
    "Void the live round first."
  );
  const last = state.history.at(-1);
  requireThat2(
    last && last.matchIndex === state.matchIndex,
    "No round in this match can be undone."
  );
  const current = currentMatch(state), restored = copy(last.before);
  for (const id of current.players)
    if (!restored.players.includes(id)) {
      restored.players.push(id);
      restored.scores[id] = 0;
    }
  state.matches[state.matchIndex] = restored;
  state.history.pop();
  refreshSessionRecords(state);
  state.results = [];
  state.phase = "between-rounds";
  note(state, "Organizer undid the last scored round.");
  touch(state);
}
function currentTrackVisit(state) {
  const m = currentMatch(state);
  if (!m || ["registration", "complete"].includes(state.phase)) return null;
  if (m.currentVisit)
    return {
      ...m.currentVisit,
      round: m.rounds - m.currentVisit.fromRound + 1,
      rounds: m.trackRounds?.[m.currentVisit.trackId] ?? RULES.fallbackRounds
    };
  const completed = state.runtime ? m.rounds : Math.max(0, m.rounds - 1);
  const visit = trackProgress(state, completed);
  return visit ? { ...visit, fromRound: completed - visit.round + 1 } : null;
}
function redirectRotation(state, m, nextId) {
  const original = [...m.order];
  const progress = trackProgress({ ...state, matches: [m], matchIndex: 0 }, m.rounds);
  m.order = original.filter((id) => !state.removedTracks?.includes(id));
  requireThat2(m.order.length, "No tracks remain in the rotation.");
  const count = (id) => m.trackRounds?.[id] ?? RULES.fallbackRounds;
  for (const id of original.filter((id2) => !m.order.includes(id2))) {
    if (m.trackRounds) delete m.trackRounds[id];
    if (m.trackWarmups) delete m.trackWarmups[id];
  }
  const oldIndex = original.indexOf(progress?.trackId ?? original[0]);
  const following = [...original.slice(oldIndex), ...original.slice(0, oldIndex)].find(
    (id) => m.order.includes(id)
  );
  const desired = nextId && m.order.includes(nextId) ? nextId : following;
  const round = !nextId && progress?.trackId === desired ? progress.round : 1;
  const cycle = m.order.reduce((sum, id) => sum + count(id), 0);
  const offset = m.order.slice(0, m.order.indexOf(desired)).reduce((sum, id) => sum + count(id), 0) + round - 1;
  m.rotationOffset = ((offset - m.rounds) % cycle + cycle) % cycle;
}
function removeCurrentTrack(state, replacement, wr) {
  const visit = currentTrackVisit(state);
  requireThat2(visit, "There is no current track to remove.");
  const next = copy(state), current = currentMatch(next), rules = rulesFor(next);
  const originalOrder = [...current.order];
  const index = originalOrder.indexOf(visit.trackId);
  const nextId = [...originalOrder.slice(index + 1), ...originalOrder.slice(0, index)].find(
    (id) => !next.removedTracks?.includes(id)
  );
  if (rules.selection === "random" || !nextId) {
    requireThat2(
      replacement && replacement.id !== visit.trackId && !next.removedTracks?.includes(replacement.id),
      "No replacement track is available. Add another track to the pool before removing this one."
    );
  }
  next.runtime = null;
  next.phase = "between-rounds";
  while (currentMatch(next).rounds > visit.fromRound) undoRound(next);
  const restored = currentMatch(next);
  delete restored.currentVisit;
  next.removedTracks = [...next.removedTracks ?? [], visit.trackId];
  next.results = [];
  if (replacement && !next.tracks.some((t) => t.id === replacement.id))
    next.tracks.push(copy(replacement));
  const target = rules.selection === "random" || !nextId ? replacement.id : nextId;
  for (const m of [restored, ...next.history.map((h) => h.before)]) {
    if (rules.selection === "random") {
      if (m === restored || m.randomTrack && next.removedTracks.includes(m.randomTrack.id)) {
        if (!m.order.includes(target)) m.order.push(target);
        (m.trackRounds ??= {})[target] = rules.roundsPerTrack;
        (m.trackWarmups ??= {})[target] = practiceForRecord(wr, rules);
        m.randomTrack = { id: target, fromRound: m.rounds, rounds: rules.roundsPerTrack };
        m.currentVisit = { trackId: target, fromRound: m.rounds };
      }
    } else {
      if (!m.order.some((id) => !next.removedTracks.includes(id))) {
        m.order.push(target);
        (m.trackRounds ??= {})[target] = rules.roundsPerTrack;
        (m.trackWarmups ??= {})[target] = practiceForRecord(wr, rules);
      }
      redirectRotation(next, m, m === restored ? target : void 0);
    }
  }
  if (wr) (next.records[target] ??= { pbs: {} }).wr = wr;
  refreshSessionRecords(next);
  note(
    next,
    `Removed ${next.tracks.find((t) => t.id === visit.trackId)?.name ?? "track"} from this Cup; undid ${current.rounds - visit.fromRound} scored rounds from this visit.`
  );
  touch(next);
  Object.assign(state, next);
}
function rebindPlayer(state, oldId, newId, name) {
  requireThat2(
    ["registration", "between-rounds", "complete"].includes(state.phase),
    "Void the round before reconnecting a racer."
  );
  requireThat2(
    player(state, oldId) && !player(state, newId) && Number.isSafeInteger(newId) && newId > 0,
    "Choose a new lobby identity."
  );
  remapIdentities(state, /* @__PURE__ */ new Map([[oldId, newId]]));
  player(state, newId).name = safeName(name);
  note(state, "Organizer reassigned a disconnected racer.");
  touch(state);
}
function detachIdentities(state) {
  requireThat2(!state.runtime, "Void the round before detaching saved identities.");
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
    m.scores = keys(m.scores);
    m.finalists = keys(m.finalists);
    for (const round of m.roundsLog) {
      round.finishes = keys(round.finishes);
      if (round.recordAwards) round.recordAwards = keys(round.recordAwards);
      round.points = keys(round.points);
      round.beforeRanking = replace(round.beforeRanking);
      round.dnfs = replace(round.dnfs);
      round.winners = replace(round.winners);
    }
  };
  state.roster.forEach((p) => {
    p.id = idFor(p.id);
  });
  if (state.withdrawn) state.withdrawn = replace(state.withdrawn);
  if (state.pendingRacers) state.pendingRacers = replace(state.pendingRacers);
  state.picks = keys(state.picks);
  if (state.selections) state.selections = keys(state.selections);
  if (state.draft) {
    state.draft.order = replace(state.draft.order);
    state.draft.bans = keys(state.draft.bans);
    state.draft.banHistory?.forEach((b) => {
      b.racerId = idFor(b.racerId);
    });
  }
  for (const r of Object.values(state.records)) {
    r.pbs = keys(r.pbs);
    if (r.tr) r.tr.ids = replace(r.tr.ids);
  }
  state.matches.forEach(updateMatch);
  state.history.forEach((h) => updateMatch(h.before));
  state.results.forEach((r) => {
    r.id = idFor(r.id);
  });
}
function publicState(state) {
  const { history, ...rest } = state;
  return copy(rest);
}

// src/inputs.ts
var inputMask = (c) => (c.up ? 1 : 0) | (c.right ? 2 : 0) | (c.down ? 4 : 0) | (c.left ? 8 : 0) | (c.reset ? 16 : 0);
var inputControls = (mask) => ({
  up: !!(mask & 1),
  right: !!(mask & 2),
  down: !!(mask & 4),
  left: !!(mask & 8),
  reset: !!(mask & 16)
});
var frameNumber = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 36e5;
function validInputEvents(events, through, limit = 128) {
  return Array.isArray(events) && events.length <= limit && events.every(
    (e, i) => Array.isArray(e) && e.length === 2 && frameNumber(e[0]) && e[0] <= through && Number.isInteger(e[1]) && e[1] >= 0 && e[1] <= 31 && (!i || e[0] >= events[i - 1][0])
  );
}
var InputCapture = class {
  get gap() {
    return this.#gap;
  }
  #context;
  #events = [];
  #seq = 0;
  #attempt = 0;
  #mask = null;
  #through = 0;
  #gap = false;
  constructor(context) {
    this.#context = context;
  }
  markGap() {
    this.#gap = true;
  }
  capture(frames, mask) {
    if (frameNumber(frames) && frames < this.#through && this.#context.stage === "warmup") {
      this.#events = [];
      this.#through = 0;
      this.#mask = null;
      this.#attempt++;
    }
    if (!frameNumber(frames) || frames < this.#through) {
      this.#gap = true;
      return;
    }
    this.#through = frames;
    if (mask === this.#mask) return;
    this.#mask = mask;
    this.#events.push([frames, mask]);
    if (this.#events.length > 128) {
      this.#events.shift();
      this.#gap = true;
    }
  }
  flush(send) {
    const message = {
      type: "inputs",
      ...this.#context,
      seq: this.#seq,
      attempt: this.#attempt,
      through: this.#through,
      events: this.#events,
      gap: this.#gap
    };
    if (!send(message)) return false;
    this.#seq++;
    this.#events = [];
    this.#gap = false;
    return true;
  }
};
var InputTimeline = class {
  get attempt() {
    return this.#attempt;
  }
  get through() {
    return this.#through;
  }
  get events() {
    return this.#events;
  }
  #events = [];
  #through = -1;
  #receivedAt = -Infinity;
  #attempt;
  constructor(attempt = 0) {
    this.#attempt = attempt;
  }
  push(events, through, now) {
    if (!frameNumber(through) || through < this.#through || !validInputEvents(events, through))
      return false;
    for (const e of events)
      if (!this.#events.length || e[0] >= this.#events.at(-1)[0]) this.#events.push([...e]);
    this.#events = this.#events.slice(-512);
    this.#through = through;
    this.#receivedAt = now;
    return true;
  }
  sample(frames, now) {
    if (now - this.#receivedAt > 1500 || frames > this.#through || frames < this.#events[0]?.[0])
      return null;
    for (let i = this.#events.length - 1; i >= 0; i--)
      if (this.#events[i][0] <= frames) return this.#events[i][1];
    return null;
  }
  snapshot() {
    return { events: this.#events.slice(-128), through: this.#through, attempt: this.#attempt };
  }
};

// src/spectator.ts
var VIEW_DELAY_MS = 250;
var vector = (p) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7);
var rotation = (p) => Array.isArray(p) && p.length === 4 && p.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) && Math.abs(Math.hypot(...p) - 1) < 0.02;
function validPose(p) {
  return !!p && Number.isSafeInteger(p.sessionId) && Number.isFinite(p.at) && Array.isArray(p.position) && p.position.length === 3 && p.position.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7) && Array.isArray(p.quaternion) && p.quaternion.length === 4 && p.quaternion.every((n) => Number.isFinite(n) && Math.abs(n) <= 1.01) && Math.abs(Math.hypot(...p.quaternion) - 1) < 0.02 && Number.isFinite(p.fov) && p.fov >= 5 && p.fov <= 175 && Number.isSafeInteger(p.frames) && p.frames >= 0 && p.frames <= 36e5 && Number.isFinite(p.speed) && Math.abs(p.speed) < 1e5 && vector(p.carPosition) && rotation(p.carQuaternion) && [0, 1].includes(p.view) && (p.resetCounter === void 0 || Number.isSafeInteger(p.resetCounter) && p.resetCounter >= 0);
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
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx
  ];
}
function cameraOffset(p) {
  const delta = p.position.map((v, i) => v - p.carPosition[i]);
  return rotateVector(
    delta,
    p.quaternion.map((v, i) => i === 3 ? v : -v)
  );
}
function mixCameraPosition(a, b, t, carPosition, quaternion) {
  const start = cameraOffset(a), end = cameraOffset(b), local = mixPosition(start, end, t);
  const distance = Math.hypot(...start) * (1 - t) + Math.hypot(...end) * t, length = Math.hypot(...local);
  const direction = length > 1e-8 ? local : t < 0.5 ? start : end, magnitude = Math.hypot(...direction);
  const offset = rotateVector(
    magnitude > 1e-8 ? direction.map((v) => v * distance / magnitude) : direction,
    quaternion
  );
  return carPosition.map((v, i) => v + offset[i]);
}
function renderCarPose(car, pose) {
  if (!car || !pose?.carPosition) return;
  const position = car.getPosition().fromArray(pose.carPosition);
  const quaternion = car.getQuaternion().fromArray(pose.carQuaternion);
  const saved = ["getPosition", "getQuaternion"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(car, key)]
  );
  try {
    car.getPosition = () => position.clone();
    car.getQuaternion = () => quaternion.clone();
    car.update(0);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(car, key, descriptor);
      else Reflect.deleteProperty(car, key);
    }
  }
}
var CameraBuffer = class {
  #frames = [];
  #playhead = null;
  #arrivalAges = [];
  #delay = VIEW_DELAY_MS;
  #lastTick = null;
  constructor() {
  }
  push(p, receivedAt = p.at) {
    if (!validPose(p)) return false;
    const last = this.#frames.at(-1);
    if (last && last.sessionId === p.sessionId && last.at >= p.at) return false;
    if (last && (last.sessionId !== p.sessionId || p.frames < last.frames || p.resetCounter !== last.resetCounter)) {
      this.#frames = [];
      this.#arrivalAges = [];
      this.#delay = VIEW_DELAY_MS;
      this.#playhead = null;
      this.#lastTick = null;
    }
    this.#arrivalAges.push(Math.max(0, receivedAt - p.at));
    this.#arrivalAges = this.#arrivalAges.slice(-40);
    const needed = Math.min(
      1200,
      Math.max(VIEW_DELAY_MS, ...this.#arrivalAges.map((age) => age + 150))
    );
    this.#delay = Math.max(needed, this.#delay - 1);
    this.#frames.push(p);
    this.#frames = this.#frames.slice(-40);
    return true;
  }
  sample(at, sessionId) {
    const frames = this.#frames.filter((p) => p.sessionId === sessionId);
    if (!frames.length || at - frames.at(-1).at > 1500) return null;
    const bIndex = frames.findIndex((p) => p.at >= at);
    if (bIndex < 1) return bIndex === 0 ? frames[0] : frames.at(-1);
    const a = frames[bIndex - 1], b = frames[bIndex], t = Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at)));
    if (a.view !== b.view || Math.hypot(...a.carPosition.map((v, i) => b.carPosition[i] - v)) > 40 || Math.hypot(...a.position.map((v, i) => b.position[i] - v)) > 40)
      return t < 1 ? a : b;
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
    const frames = this.#frames.filter((p) => p.sessionId === sessionId);
    if (!frames.length || now - frames.at(-1).at > 1500) {
      this.#playhead = null;
      this.#lastTick = null;
      return null;
    }
    const desired = now - this.#delay;
    if (this.#playhead === null || this.#lastTick === null || tick - this.#lastTick > 1e3)
      this.#playhead = desired;
    else {
      const dt = Math.max(0, Math.min(100, tick - this.#lastTick));
      const drift = desired - (this.#playhead + dt);
      const rate = Math.max(0.8, Math.min(1.1, 1 + drift / 1e3));
      this.#playhead += dt * rate;
    }
    this.#lastTick = tick;
    this.#playhead = Math.min(frames.at(-1).at, this.#playhead);
    return this.sample(this.#playhead, sessionId);
  }
};

// src/reconnect.ts
var encode = (s) => new TextEncoder().encode(s);
var hex = (bytes2) => Array.from(new Uint8Array(bytes2), (b) => b.toString(16).padStart(2, "0")).join("");
var bytes = (s) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));
var payload = (cupId, nonce) => encode("PolyCup reconnect proof v1\0" + cupId + "\0" + nonce);
var validPublicKey = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
async function profileIdentity(token, cupId) {
  if (typeof token !== "string" || !token || !cupId)
    throw new Error("Profile identity unavailable.");
  const seed = await crypto.subtle.digest(
    "SHA-256",
    encode("PolyCup reconnect key v1\0" + cupId + "\0" + token)
  );
  const pkcs8 = new Uint8Array(48);
  pkcs8.set(bytes("302e020100300506032b657004220420"));
  pkcs8.set(new Uint8Array(seed), 16);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return {
    publicKey: jwk.x,
    sign: async (nonce) => hex(await crypto.subtle.sign("Ed25519", key, payload(cupId, nonce)))
  };
}
var ReconnectRegistry = class {
  #cupId = "";
  #owners = /* @__PURE__ */ new Map();
  #peers = /* @__PURE__ */ new Map();
  #pending = /* @__PURE__ */ new Map();
  reset(cupId) {
    if (cupId === this.#cupId) return;
    this.#cupId = cupId;
    this.#owners.clear();
    this.#peers.clear();
    this.#pending.clear();
  }
  sync(online, roster) {
    for (const id of this.#peers.keys()) if (!online.includes(id)) this.#peers.delete(id);
    for (const id of this.#pending.keys()) if (!online.includes(id)) this.#pending.delete(id);
    for (const [key, id] of this.#owners) if (!roster.includes(id)) this.#owners.delete(key);
    for (const [id, key] of this.#peers) {
      if (roster.includes(id) && !this.#owners.has(key) && ![...this.#owners.values()].includes(id))
        this.#owners.set(key, id);
    }
  }
  verified(id, key) {
    return this.#peers.get(id) === key;
  }
  challenge(id, key) {
    if (!validPublicKey(key) || !this.#cupId) return null;
    const existing = this.#pending.get(id);
    if (existing && existing.key === key && existing.expires > Date.now()) return existing.nonce;
    const nonce = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    this.#pending.set(id, { key, nonce, expires: Date.now() + 15e3 });
    return nonce;
  }
  async prove(id, nonce, signature) {
    const pending = this.#pending.get(id), cupId = this.#cupId;
    if (!pending || pending.nonce !== nonce || pending.expires < Date.now() || !/^[a-f0-9]{128}$/.test(signature))
      return false;
    this.#pending.delete(id);
    try {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "OKP", crv: "Ed25519", x: pending.key },
        "Ed25519",
        false,
        ["verify"]
      );
      const valid = await crypto.subtle.verify(
        "Ed25519",
        key,
        bytes(signature),
        payload(cupId, nonce)
      );
      if (!valid || this.#cupId !== cupId) return false;
      this.#peers.set(id, pending.key);
      return true;
    } catch {
      return false;
    }
  }
  owner(id) {
    const key = this.#peers.get(id);
    return key ? this.#owners.get(key) ?? null : null;
  }
  key(id) {
    return this.#peers.get(id);
  }
  ownerKey(id) {
    return [...this.#owners].find(([, owner]) => owner === id)?.[0];
  }
  authenticated(id) {
    return this.#peers.has(id);
  }
  rebind(oldId, newId) {
    for (const [key2, id] of this.#owners) if (id === oldId) this.#owners.delete(key2);
    const key = this.#peers.get(newId);
    if (key) this.#owners.set(key, newId);
  }
};

// src/native.ts
function watchGameSessions(sessions, created) {
  const set = sessions.set;
  sessions.set = function(game, session) {
    const result = set.call(this, game, session);
    if (session) queueMicrotask(() => created(game));
    return result;
  };
}
function registerCarVisibility(pml, insertType) {
  pml.registerGlobalMixin({
    type: insertType,
    token: 'e.scene.add((0, d.gn)(this, a, "f")),',
    func: `Object.defineProperty(this, "setVisible", {
      value: visible => { a.get(this).visible = visible; }
    }),`
  });
  pml.registerGlobalMixin({
    type: insertType,
    token: '(0, l.gn)(this, me, "f").visible = e;',
    func: `if (!e) {
      if (Ae.get(this)) Ae.get(this).visible = false;
    }
    for (const trail of Pe.get(this) || []) E.get(trail).visible = e;
    Ue.get(this)?.setVisible(e);`
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
    else Reflect.deleteProperty(renderer, "update");
  }
}
function connectNative(pml, controller) {
  if (pml.polyVersion !== "0.6.3") throw new Error("PolyCup requires PolyTrack 0.6.3.");
  const api = pml.getFromPolyTrack(`({
    Host: ii, Client: vc, Game: Is, TrackLibrary: du,
    watchGames: callback => callback(Za),
    leaderboardUploads: (() => {
      const defaults = new WeakMap();
      return (game, enabled) => {
        if (enabled === undefined) {
          if (defaults.has(game)) { ya.set(game, defaults.get(game)); defaults.delete(game); }
          return;
        }
        if (!defaults.has(game)) defaults.set(game, ya.get(game));
        ya.set(game, defaults.get(game) && enabled);
      };
    })(),
    pruneClosedPeers: c => {
      if (!(c instanceof ii)) return;
      for (const peer of [...Mn.get(c), ..._n.get(c)]) {
        if (['closed', 'failed'].includes(peer.peerConnection.connectionState) || peer.dataChannel.readyState === 'closed') {
          // Reuse native departure cleanup, including player-list broadcasts and slot release.
          peer.peerConnection.close();
          peer.dataChannel.onclose?.(new Event('close'));
        }
      }
    },
    renderer: g => la.get(g),
    hudElement: g => _a.get(g)?.element,
    enableCupSpectator: g => {
      const spectator=fs.get(g);
      if (spectator.isEnabled) return;
      spectator.isEnabled=true;
      // Native free-camera mode hides the whole HUD, including the toolbar.
      // Restore it only on entry; dialogs and Toggle UI retain ownership afterward.
      _a.get(g).isVisible=Ma.get(g) !== false;
    },
    presentation: (g, cup, watching) => {
      const ended=!!ss.get(g), ui=_a.get(g)?.element, backdrop=Hr.get(Oa.get(g));
      ui?.classList.toggle('polycup-watching', !!cup && !!watching && !ended);
      ui?.classList.toggle('polycup-session-ended', !!cup && ended);
      backdrop?.classList.toggle('polycup-session-ended', !!cup && ended);
      if (cup && watching && !ended) {
        const toolbar=Na.get(g);
        if (!fa.get(g).isCursorHidden || toolbar.hasFocus() ||
          !!ui?.querySelector('.polycup-toolbar-button:focus')) toolbar.setVisible(true);
      }
    },
    records: g => ({ server: jd.get(da.get(g)), profiles: ha.get(g), store: da.get(g) }),
    carThumbnail: style => kr.F(style, new Sr.A()),
    readInputs: g => ({ frames: Xa.get(g).getTime().numberOfFrames, controls: qa.get(g).getControls() }),
    watchInputs: (g, callback) => { const c=qa.get(g); c.addChangeCallback(callback); return () => c.removeChangeCallback(callback); },
    createInputVisualizer: parent => { const view=new Df(parent); return { element: If.get(view),
      update: controls => view.update(controls), dispose: () => view.dispose() }; },
    clearInput: g => { const c=qa.get(g); if(c) for(const key of ['up','right','down','left','reset']) c[key]=false;
      const s=fs.get(g); if(s) for(const field of [ft,pt,gt,mt,vt,At,yt]) field.set(s,false); },
    drivingBindings: g => { const settings=ua.get(g); return {
      up:settings.getKeyBindings(ge.A.VehicleAccelerate), right:settings.getKeyBindings(ge.A.VehicleTurnRight),
      down:settings.getKeyBindings(ge.A.VehicleBrake), left:settings.getKeyBindings(ge.A.VehicleTurnLeft) }; },
    applyDrivingInput: (g, controls) => { const input=qa.get(g);
      for(const key of ['up','right','down','left']) input[key]=controls[key]; },
    read: g => ({ connection: Za.get(g)?.multiplayerConnection, sessionId: Za.get(g)?.sessionId,
      trackData: Ta.get(g), metadata: Sa.get(g), car: Xa.get(g), spectator: fs.get(g),
      disposed: ss.get(g), checkpointCount: ra.get(g).getTotalNumberOfCheckpointIndices() }),
    camera: g => { const c=la.get(g).camera, car=Xa.get(g); return {
      sessionId: Za.get(g).sessionId, position:c.position.toArray(), quaternion:c.quaternion.toArray(),
      fov:c.fov, frames:car.getTime().numberOfFrames, speed:car.getSpeedKmh(),
      carPosition:car.getPosition().toArray(), carQuaternion:car.getQuaternion().toArray(),
      resetCounter:os.get(g), view:c===car.cameraCockpit?1:0 }; },
    remoteCar: (g,id) => as.get(g).get(id)?.car,
    chatKeys: g => ua.get(g).getKeyBindings(ge.A.PolyCupChat).map(key=>key ? ve(key) : '').filter(Boolean),
    ghostKeys: g => ua.get(g).getKeyBindings(ge.A.PolyCupToggleGhosts).map(key=>key ? ve(key) : '').filter(Boolean),
    freecamPressed: (g,event) => !I.ip() && ua.get(g).checkKeyBinding(event,ge.A.ToggleSpectatorCamera),
    enterFreecam: g => {
      const camera=la.get(g).camera, spectator=fs.get(g);
      if (camera!==spectator.camera) {
        spectator.camera.position.copy(camera.position);
        spectator.camera.quaternion.copy(camera.quaternion);
        spectator.camera.fov=camera.fov;
        spectator.camera.updateProjectionMatrix();
      }
      spectator.isEnabled=true;
      la.get(g).setCamera(spectator.camera);
      _a.get(g).isVisible=Ma.get(g)!==false;
    },
    autoSpectate: g => ua.get(g).getSettingBoolean(P.A.PolyCupAutoSpectate),
    restartPressed: (g,event) => !fs.get(g).isEnabled && !bs.call(g) && Ps.call(g) &&
      Xa.get(g).hasStarted() && !Xa.get(g).hasFinished() &&
      ua.get(g).checkKeyBinding(event,ge.A.VehicleStartReset) &&
      !ua.get(g).checkKeyBinding(event,ge.A.VehicleCheckpointReset),
    startRespawnPressed: (g,event) => {
      const car=Xa.get(g);
      if (I.ip() || fs.get(g).isEnabled || bs.call(g) || !Ps.call(g) ||
          car.hasFinished() || car.getNextCheckpointIndex() !== 0 ||
          !ua.get(g).checkKeyBinding(event,ge.A.VehicleCheckpointReset)) return false;
      return true;
    },
    showRoundTime: (g,frames) => za.get(g).update({getTime:()=>new xt.A(frames),getFinishTime:()=>null}),
    showRoundCheckpoint: (g,frames) => za.get(g).showCheckpointTime(new xt.A(frames),null),
    showRoundFinish: (g,frames) => {
      const banner=_a.get(g)?.element.querySelector('.time-announcer-ui');
      const time=banner?.querySelector('.current .time');
      if(time) time.textContent=He.A.formatTimeString(new xt.A(frames));
      banner?.querySelectorAll('.record,.difference').forEach(node=>node.classList.add('hidden'));
      banner?.querySelector('.current')?.classList.remove('show-position');
    },
    visibility: (g,ids,self) => { Cs.call(g); Xa.get(g).setVisible(ids===null||ids.includes(self));
      for(const [id,r] of as.get(g)) if(ids!==null&&!ids.includes(id)) r.car.setVisible(false); },
    drivingView: g => !fs.get(g).isEnabled && la.get(g).camera === Xa.get(g).cameraCockpit ? 1 : 0,
    release: (g,view) => { const car=Xa.get(g), renderer=la.get(g);
      const cockpit=view === undefined ? !fs.get(g).isEnabled && renderer.camera === car.cameraCockpit : view === 1;
      fs.get(g).isEnabled=false;
      renderer.setCamera(cockpit ? car.cameraCockpit : car.cameraOrbit);
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
  api.reconnectIdentity = (game, cupId) => profileIdentity(api.records(game).profiles.getCurrentUserProfile().token, cupId);
  for (const key of [
    "Host",
    "Client",
    "Game",
    "read",
    "peers",
    "parse",
    "reset",
    "guard"
  ]) {
    if (typeof api[key] !== "function")
      throw new Error(`Unsupported game build: ${key} is unavailable.`);
  }
  const onlinePB = /* @__PURE__ */ new Map();
  const verified = (id) => !!(api.trackLibrary?.isOfficialTrack(id) || api.trackLibrary?.isCommunityTrack(id));
  api.personalBest = async (game, id) => {
    const { server, profiles, store } = api.records(game);
    const profile = profiles.getCurrentUserProfile(), slot = profiles.profileSlot;
    const key = `${slot}:${profile.tokenHash}:${id}`, cached = onlinePB.get(key);
    if (!cached || cached.until < Date.now()) {
      onlinePB.set(key, {
        until: Date.now() + 6e4,
        value: server.getLeaderboardUserEntry(profile.tokenHash, id, verified(id)).then((record) => ({ ok: true, frames: record?.time?.numberOfFrames ?? null })).catch(() => ({ ok: false, frames: null }))
      });
    }
    const online = await onlinePB.get(key).value;
    const local = store.getRecordTime(slot, id)?.numberOfFrames ?? null;
    if (online.frames !== null && (local === null || online.frames <= local))
      return { status: "ready", frames: online.frames, source: "online" };
    if (local !== null) return { status: "ready", frames: local, source: "profile" };
    return { status: online.ok ? "missing" : "unavailable" };
  };
  api.worldRecord = async (game, id) => {
    const { server, profiles } = api.records(game);
    try {
      const data = await server.getLeaderboard(
        profiles.getCurrentUserProfile().tokenHash,
        id,
        0,
        1,
        verified(id)
      );
      const best = data.entries[0];
      return best ? {
        status: "ready",
        frames: best.frames.numberOfFrames,
        name: String(best.nickname).slice(0, 64),
        ...best.countryCode ? { countryCode: best.countryCode } : {}
      } : { status: "missing" };
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
    return beforeGameRender(
      api.renderer(this),
      () => controller.beforeRender(this),
      () => original.apply(this, args)
    );
  };
  const dispose = api.Game.prototype.dispose;
  api.Game.prototype.dispose = function(...args) {
    controller.rememberDrivingView(this);
    const result = dispose.apply(this, args);
    controller.gameDisposed(this);
    return result;
  };
  for (const Connection of [api.Host, api.Client]) {
    const disposeConnection = Connection.prototype.dispose;
    if (!disposeConnection) continue;
    Connection.prototype.dispose = function() {
      controller.connectionDisposed(this);
      return disposeConnection.call(this);
    };
  }
  api.guard((game) => controller.shouldBlock(game));
  api.guardRestart((game) => controller.handleRestart(game));
  return api;
}
var CupTransport = class {
  #onMessage;
  #onChange;
  #channels = /* @__PURE__ */ new Map();
  #peers = /* @__PURE__ */ new Map();
  #channelId;
  #realtime;
  constructor(onMessage, onChange, { channelId = 42, realtime = false } = {}) {
    this.#onMessage = onMessage;
    this.#onChange = onChange;
    this.#channelId = channelId;
    this.#realtime = realtime;
  }
  sync(peers) {
    const pcs = new Set(peers.map((p) => p.pc));
    for (const [pc, entry] of this.#peers)
      if (!pcs.has(pc)) {
        entry.channel.close();
        this.#peers.delete(pc);
        this.#channels.delete(entry.id);
        this.#onChange();
      }
    for (const { id, pc } of peers)
      if (!this.#peers.has(pc) && pc.connectionState !== "closed") {
        const channel = pc.createDataChannel(
          `polytrack-world-cup-${this.#channelId}`,
          this.#realtime ? { negotiated: true, id: this.#channelId, ordered: false, maxRetransmits: 0 } : { negotiated: true, id: this.#channelId, ordered: true }
        );
        const entry = { id, channel, windowAt: performance.now(), count: 0 };
        this.#peers.set(pc, entry);
        this.#channels.set(id, channel);
        channel.onopen = () => this.#onChange();
        channel.onclose = () => this.#onChange();
        channel.onerror = () => this.#onChange();
        channel.onmessage = (event) => {
          if (typeof event.data !== "string" || event.data.length > (this.#realtime ? 2e3 : 6e4))
            return;
          const now = performance.now();
          if (now - entry.windowAt > 1e3) {
            entry.windowAt = now;
            entry.count = 0;
          }
          if (++entry.count > (this.#realtime ? 60 : 35)) return;
          try {
            const candidate = JSON.parse(event.data);
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
            const message = candidate;
            if (!message || message.protocol !== 1 || typeof message.type !== "string") return;
            this.#onMessage(id, message);
          } catch (error) {
            console.warn("[PolyCup] Rejected peer message:", String(error));
          }
        };
      }
  }
  send(id, message) {
    const channel = this.#channels.get(id);
    if (channel?.readyState !== "open" || channel.bufferedAmount > 256e3) return false;
    const text = JSON.stringify({ ...message, protocol: 1 });
    if (text.length > 6e4)
      throw new Error("Tournament update exceeds the network message limit.");
    try {
      channel.send(text);
      return true;
    } catch {
      return false;
    }
  }
  broadcast(message) {
    for (const id of this.#channels.keys()) this.send(id, message);
  }
  has(id) {
    return this.#channels.get(id)?.readyState === "open";
  }
  dispose() {
    for (const entry of this.#peers.values()) entry.channel.close();
    this.#peers.clear();
    this.#channels.clear();
  }
};

// src/standings.ts
function standings(s) {
  const m = currentMatch(s);
  if (!m) return [];
  const ranking = rankMatch(s, m).filter(
    (id) => s.phase === "complete" || !s.withdrawn?.includes(id) && !s.pendingRacers?.includes(id)
  ), live = s.phase === "racing";
  const last = m.roundsLog.at(-1), scored = !s.runtime && !!last;
  const finishes = live ? s.runtime.finishes : scored ? last.finishes : {};
  const finishOrder = ranking.filter((id) => id in finishes).sort((a, b) => finishes[a] - finishes[b]);
  const splits = live ? s.runtime.splits ?? {} : {};
  const pending = ranking.filter((id) => !finishOrder.includes(id));
  if (live)
    pending.sort(
      (a, b) => Number(s.runtime.dnfs.includes(a)) - Number(s.runtime.dnfs.includes(b)) || (splits[b]?.index ?? -1) - (splits[a]?.index ?? -1) || (splits[a]?.frames ?? Infinity) - (splits[b]?.frames ?? Infinity)
    );
  const order = live ? [...finishOrder, ...pending] : ranking;
  const best = finishOrder.length ? finishes[finishOrder[0]] : null;
  return order.map((id) => {
    const finishPlace = finishOrder.findIndex((other) => finishes[other] === finishes[id]) + 1;
    const gain = live && finishPlace > 0 && !(id in m.finalists) ? rulesFor(s).finalist ? Math.min(m.target - m.scores[id], rulesFor(s).points[finishPlace - 1]) : rulesFor(s).points[finishPlace - 1] : scored ? last.points[id] ?? 0 : 0;
    return {
      id,
      position: live && finishPlace ? finishPlace : order.indexOf(id) + 1,
      score: m.scores[id],
      finalist: id in m.finalists,
      winner: m.winners.includes(id),
      gain,
      provisional: live,
      movement: live ? s.runtime.liveMovement?.[id] ?? 0 : scored ? last.beforeRanking.indexOf(id) - ranking.indexOf(id) : 0,
      frames: finishes[id],
      checkpoint: splits[id]?.index,
      splitFrames: splits[id]?.frames,
      delta: finishes[id] !== void 0 && best !== null ? finishes[id] - best : splits[id] ? splits[id].frames - splits[id].bestFrames : null,
      dnf: (live ? s.runtime.dnfs : scored ? last.dnfs : []).includes(id)
    };
  });
}
function updateLiveMovement(s, before) {
  if (s.phase !== "racing") return;
  s.runtime.liveMovement = Object.fromEntries(
    standings(s).map((r, i) => [r.id, before.indexOf(r.id) - i])
  );
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
    if (!record || frames < record.frames)
      record = { frames, ids: [Number(id)], provisional: true };
    else if (frames === record.frames && !record.ids.includes(Number(id)))
      record.ids.push(Number(id));
  }
  return record;
}

// src/progress.ts
var CheckpointProgress = class {
  #round = null;
  #bests = /* @__PURE__ */ new Map();
  constructor() {
  }
  record(state, id, index, frames, now, checkpointCount) {
    const run = state?.runtime;
    if (state?.phase !== "racing" || !run || !activeIds(state).includes(id) || roundDone(state, id) || !Number.isSafeInteger(checkpointCount) || !Number.isSafeInteger(index) || index < 0 || index >= checkpointCount - 1 || !Number.isSafeInteger(frames) || frames <= 0 || frames > 36e5 || run.startsAt === null || frames > now - run.startsAt + 2e3 || run.deadline !== null && (now > run.deadline + 1500 || frames > run.deadline - run.startsAt))
      return false;
    const previous = run.splits?.[id];
    if (previous && (index <= previous.index || frames < previous.frames)) return false;
    const key = `${state.id}:${run.id}`;
    if (this.#round !== key) {
      this.#round = key;
      this.#bests.clear();
    }
    const before = standings(state).map((r) => r.id);
    const bestFrames = Math.min(this.#bests.get(index) ?? Infinity, frames);
    this.#bests.set(index, bestFrames);
    (run.splits ??= {})[id] = { index, frames, bestFrames };
    for (const split of Object.values(run.splits))
      if (split.index === index) split.bestFrames = bestFrames;
    updateLiveMovement(state, before);
    touch(state);
    return true;
  }
};

// src/review.ts
var REVIEW_LIMITS = Object.freeze({
  runs: 256,
  events: 2048,
  totalEvents: 32768,
  checkpoints: 256,
  bytes: 15e5
});
var eligible = (r) => r.outcome === "finished" && r.finish !== null && r.finish >= 1e4;
var completeInputs = (r) => !r.gap && r.inputs[0]?.[0] === 0 && r.finish !== null && r.through >= r.finish;
var complex = (r) => r.inputs.length >= 13 && new Set(r.inputs.map((e) => e[1])).size >= 3 && r.inputs.filter((e, i, a) => i && (e[1] & 10) !== (a[i - 1][1] & 10)).length >= 8;
var canonical = (events) => {
  const out = [];
  for (const e of events) {
    if (out.at(-1)?.[0] === e[0]) out[out.length - 1] = e;
    else out.push(e);
  }
  return out.filter((e, i) => !i || e[1] !== out[i - 1][1]);
};
function compareRuns(a, b) {
  if (!eligible(a) || !eligible(b) || a.racerKey !== b.racerKey || a.trackId !== b.trackId)
    return null;
  const exactCheckpoints = a.checkpoints.length >= 4 && a.checkpoints.length === a.expectedCheckpoints && b.checkpoints.length === b.expectedCheckpoints && a.finish === b.finish && JSON.stringify(a.checkpoints) === JSON.stringify(b.checkpoints);
  if (completeInputs(a) && completeInputs(b)) {
    const x = { ...a, inputs: canonical(a.inputs) }, y = { ...b, inputs: canonical(b.inputs) };
    if (!complex(x) || !complex(y)) return null;
    if (x.inputs.length === y.inputs.length && x.inputs.every((e, i) => e[1] === y.inputs[i][1])) {
      const delta = Math.max(
        Math.abs(a.finish - b.finish),
        ...x.inputs.map((e, i) => Math.abs(e[0] - y.inputs[i][0]))
      );
      if (delta <= 10)
        return {
          kind: "inputs",
          otherId: b.id,
          transitions: x.inputs.length - 1,
          maxDelta: delta,
          exactCheckpoints
        };
    }
  }
  return exactCheckpoints ? { kind: "checkpoints", otherId: b.id, checkpoints: a.checkpoints.length } : null;
}
var ReviewLog = class _ReviewLog {
  get cupId() {
    return this.#cupId;
  }
  get revision() {
    return this.#revision;
  }
  get runs() {
    return this.#runs;
  }
  get dropped() {
    return this.#dropped;
  }
  #cupId;
  #runs = [];
  #identities = {};
  #dropped = 0;
  #revision = 0;
  constructor(cupId = null) {
    this.#cupId = cupId;
  }
  actor(id) {
    return this.#identities[id] ??= crypto.randomUUID();
  }
  rebind(oldId, newId) {
    if (this.#identities[oldId]) {
      this.#identities[newId] = this.#identities[oldId];
      delete this.#identities[oldId];
    }
  }
  begin(state, checkpointCount) {
    if (!state?.runtime || state.runtime.sessionId === null) return;
    const run = state.runtime;
    for (const p of state.roster) {
      const racerKey = this.actor(p.id);
      if (this.#runs.some((r) => r.roundId === run.id && r.racerKey === racerKey)) continue;
      this.#runs.push({
        id: crypto.randomUUID(),
        roundId: run.id,
        round: run.round,
        trackId: run.trackId,
        racerKey,
        name: p.name,
        outcome: "pending",
        finish: null,
        expectedCheckpoints: Math.max(0, checkpointCount - 1),
        checkpoints: [],
        inputs: [],
        through: -1,
        nextSeq: 0,
        gap: false,
        flag: null,
        reviewed: false
      });
      this.#revision++;
    }
    this.trim();
  }
  current(roundId, actor) {
    return this.#runs.find((r) => r.roundId === roundId && r.racerKey === this.#identities[actor]);
  }
  inputs(roundId, actor, message) {
    const r = this.current(roundId, actor);
    if (!r || r.outcome !== "pending" || message.seq < r.nextSeq || message.through < r.through)
      return false;
    if (message.events.length && r.inputs.length && message.events[0][0] < r.inputs.at(-1)[0])
      return false;
    if (message.seq !== r.nextSeq || message.gap || !r.inputs.length && message.events[0]?.[0] !== 0)
      r.gap = true;
    r.nextSeq = message.seq + 1;
    r.through = message.through;
    const remaining = REVIEW_LIMITS.events - r.inputs.length;
    if (message.events.length > remaining) r.gap = true;
    r.inputs.push(...message.events.slice(0, remaining).map((e) => [...e]));
    this.#revision++;
    return true;
  }
  checkpoint(roundId, actor, index, frames) {
    const r = this.current(roundId, actor);
    if (!r || r.checkpoints.length >= REVIEW_LIMITS.checkpoints || r.checkpoints.some((e) => e[0] >= index))
      return;
    r.checkpoints.push([index, frames]);
    this.#revision++;
  }
  undoTrackVisit(trackId, fromRound) {
    for (const run of this.#runs)
      if (run.trackId === trackId && run.round > fromRound) run.outcome = "undone";
    this.analyze();
    this.#revision++;
  }
  close(state, outcome = "scored") {
    const run = state?.runtime;
    if (!run) return;
    for (const r of this.#runs.filter((r2) => r2.roundId === run.id && r2.outcome === "pending")) {
      const actor = Object.keys(this.#identities).find(
        (id) => this.#identities[Number(id)] === r.racerKey
      );
      r.finish = run.finishes[Number(actor)] ?? null;
      r.outcome = outcome === "scored" ? r.finish === null ? "dnf" : "finished" : outcome;
    }
    this.analyze();
    this.trim();
    this.#revision++;
  }
  undo(round, trackId) {
    const last = [...this.#runs].reverse().find(
      (r) => r.round === round && r.trackId === trackId && ["finished", "dnf"].includes(r.outcome)
    );
    if (!last) return;
    for (const r of this.#runs) if (r.roundId === last.roundId) r.outcome = "undone";
    this.analyze();
    this.#revision++;
  }
  analyze() {
    const seen = [];
    for (const r of this.#runs) {
      const old = JSON.stringify(r.flag);
      r.flag = null;
      if (eligible(r)) {
        const candidates = seen.filter((p) => p.racerKey === r.racerKey && p.trackId === r.trackId).map((p) => compareRuns(r, p)).filter((flag) => flag !== null);
        r.flag = candidates.find((f) => f.kind === "inputs") ?? null;
        if (!r.flag && candidates.filter((f) => f.kind === "checkpoints").length >= 2)
          r.flag = {
            ...candidates.find((f) => f.kind === "checkpoints"),
            repeats: candidates.filter((f) => f.kind === "checkpoints").length + 1
          };
        seen.push(r);
      }
      if (old !== JSON.stringify(r.flag)) r.reviewed = false;
    }
  }
  trim() {
    const before = this.#dropped;
    let events = this.#runs.reduce((n, r) => n + r.inputs.length, 0);
    while (this.#runs.length > REVIEW_LIMITS.runs || events > REVIEW_LIMITS.totalEvents) {
      const i = this.#runs.findIndex((r) => r.outcome !== "pending");
      if (i < 0) break;
      events -= this.#runs[i].inputs.length;
      this.#runs.splice(i, 1);
      this.#dropped++;
    }
    if (this.#dropped !== before) {
      this.analyze();
      this.#revision++;
    }
  }
  data() {
    this.trim();
    const before = this.#dropped;
    const data = {
      schema: 1,
      cupId: this.#cupId,
      identities: this.#identities,
      runs: this.#runs,
      dropped: this.#dropped
    };
    while (JSON.stringify(data).length > REVIEW_LIMITS.bytes) {
      const i = this.#runs.findIndex((r) => r.outcome !== "pending");
      if (i < 0) break;
      this.#runs.splice(i, 1);
      data.dropped = ++this.#dropped;
    }
    if (this.#dropped !== before) {
      this.analyze();
      this.#revision++;
    }
    return data;
  }
  markReviewed(id, value) {
    const r = this.#runs.find((r2) => r2.id === id);
    if (!r?.flag) return;
    r.reviewed = !!value;
    this.#revision++;
  }
  static restore(value, state) {
    const data = value;
    const log = new _ReviewLog(state.id);
    if (data === void 0) return log;
    const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 128;
    const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    if (!obj(data) || data.schema !== 1 || data.cupId !== state.id || JSON.stringify(data).length > REVIEW_LIMITS.bytes || !obj(data.identities) || Object.keys(data.identities).length > 128 || !Object.entries(data.identities).every(
      ([id, key]) => state.roster.some((p) => p.id === Number(id)) && text(key)
    ) || new Set(Object.values(data.identities)).size !== Object.keys(data.identities).length || !Array.isArray(data.runs) || data.runs.length > REVIEW_LIMITS.runs || !Number.isSafeInteger(data.dropped) || data.dropped < 0)
      throw new Error("Invalid organizer review log.");
    const runs = data.runs.map((r) => {
      if (!obj(r) || !text(r.id) || !text(r.roundId) || !Number.isSafeInteger(r.round) || r.round < 1 || !text(r.name) || !Object.values(data.identities).includes(r.racerKey) || !state.tracks.some((t) => t.id === r.trackId) || !["pending", "finished", "dnf", "void", "undone", "interrupted"].includes(r.outcome) || !(r.finish === null || frameNumber(r.finish) && r.finish > 0) || r.outcome === "finished" && r.finish === null || !Number.isSafeInteger(r.expectedCheckpoints) || r.expectedCheckpoints < 0 || r.expectedCheckpoints > 1e5 || !Array.isArray(r.checkpoints) || r.checkpoints.length > REVIEW_LIMITS.checkpoints || !r.checkpoints.every(
        (e, i) => Array.isArray(e) && e.length === 2 && Number.isSafeInteger(e[0]) && e[0] >= 0 && e[0] < r.expectedCheckpoints && frameNumber(e[1]) && e[1] > 0 && (!i || e[0] > r.checkpoints[i - 1][0] && e[1] >= r.checkpoints[i - 1][1])
      ) || !(r.through === -1 || frameNumber(r.through)) || !validInputEvents(r.inputs, r.through, REVIEW_LIMITS.events) || !Number.isSafeInteger(r.nextSeq) || r.nextSeq < 0 || typeof r.gap !== "boolean" || typeof r.reviewed !== "boolean")
        throw new Error("Invalid saved run evidence.");
      return {
        id: r.id,
        roundId: r.roundId,
        round: r.round,
        trackId: r.trackId,
        racerKey: r.racerKey,
        name: r.name,
        outcome: r.outcome === "pending" ? "interrupted" : r.outcome,
        finish: r.finish,
        expectedCheckpoints: r.expectedCheckpoints,
        checkpoints: r.checkpoints.map((e) => [...e]),
        inputs: r.inputs.map((e) => [...e]),
        through: r.through,
        nextSeq: r.nextSeq,
        gap: r.gap,
        reviewed: r.reviewed,
        flag: null
      };
    });
    if (new Set(runs.map((r) => r.id)).size !== runs.length || runs.reduce((n, r) => n + r.inputs.length, 0) > REVIEW_LIMITS.totalEvents)
      throw new Error("Invalid review history size.");
    log.#identities = { ...data.identities };
    log.#runs = runs;
    log.#dropped = data.dropped;
    log.analyze();
    runs.forEach((r, i) => {
      r.reviewed = data.runs[i].reviewed && !!r.flag;
    });
    return log;
  }
};
function evidenceStatus(r) {
  if (!r.inputs.length) return "No input data";
  if (r.outcome === "pending") return "Recording";
  if (r.finish !== null && completeInputs(r)) return "Inputs recorded";
  return "Partial input data";
}

// src/held-inputs.ts
function isEditing(event) {
  return event.composedPath().some((target) => {
    const element2 = target;
    return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(element2.tagName) || element2.isContentEditable;
  });
}
var HeldDrivingInputs = class {
  #bindings = /* @__PURE__ */ new Map();
  #held = /* @__PURE__ */ new Set();
  bind(bindings) {
    this.#bindings.clear();
    for (const direction of ["up", "right", "down", "left"])
      for (const code of bindings[direction])
        if (code && !this.#bindings.has(code)) this.#bindings.set(code, direction);
    for (const code of this.#held) if (!this.#bindings.has(code)) this.#held.delete(code);
  }
  press(event) {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || isEditing(event))
      return;
    if (this.#bindings.has(event.code)) this.#held.add(event.code);
  }
  release(code) {
    this.#held.delete(code);
  }
  clear() {
    this.#held.clear();
  }
  controls() {
    const controls = { up: false, right: false, down: false, left: false, reset: false };
    for (const code of this.#held) {
      const direction = this.#bindings.get(code);
      if (direction) controls[direction] = true;
    }
    return controls;
  }
};

// src/chat-filter.ts
var slurs = [
  "nigger",
  "niggers",
  "nigga",
  "niggas",
  "faggot",
  "faggots",
  "fag",
  "fags",
  "kike",
  "kikes",
  "spic",
  "spics",
  "chink",
  "chinks",
  "gook",
  "gooks",
  "wetback",
  "wetbacks",
  "raghead",
  "ragheads",
  "towelhead",
  "towelheads",
  "paki",
  "pakis",
  "tranny",
  "trannies",
  "retard",
  "retards",
  "retarded",
  "coon",
  "coons",
  "sandnigger",
  "sandniggers",
  "jigaboo",
  "jigaboos"
];
var groups = "(?:jews|jewish people|blacks|black people|muslims|gays|gay people|trans people|immigrants|women|romani|roma|asians|white people)";
var hate = [
  new RegExp(`\\b(?:kill|gas|exterminate|lynch)(?: all| the| all the)? ${groups}\\b`, "g"),
  /\b(?:heil hitler|sieg heil|white power)\b/g
];
var substitutions = {
  "0": "o",
  "1": "i",
  "!": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  \u0430: "a",
  \u0435: "e",
  \u0456: "i",
  \u043E: "o",
  \u0441: "c",
  \u0440: "p",
  \u0455: "s",
  \u0445: "x",
  \u0443: "y"
};
var patterns = slurs.map(
  (word) => new RegExp(`(?<![a-z])${[...word].map((c) => `${c}+`).join("[\\s._*\\-]*")}(?![a-z])`, "g")
);
function cleanChatText(text) {
  return text.replace(/[\r\n\t]+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
}
function filterChat(text) {
  const original = [...text], normalized = [], positions = [];
  original.forEach((character, index) => {
    for (const c of character.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")) {
      if (/\p{Cf}/u.test(c)) continue;
      const mapped = substitutions[c] ?? c;
      for (let unit = 0; unit < mapped.length; unit++) {
        normalized.push(mapped[unit]);
        positions.push(index);
      }
    }
  });
  const source = normalized.join(""), masked = /* @__PURE__ */ new Set();
  for (const pattern of [...patterns, ...hate]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const first = positions[match.index], last = positions[match.index + match[0].length - 1];
      for (let i = first; i <= last; i++) if (!/\s/u.test(original[i])) masked.add(i);
    }
  }
  return original.map((c, i) => masked.has(i) ? "*" : c).join("");
}

// src/pending-actions.ts
var PendingActions = class {
  #requests = /* @__PURE__ */ new Map();
  run(key, send, timeout = 15e3) {
    const existing = this.#requests.get(key);
    if (existing) return existing.promise;
    const id = crypto.randomUUID();
    let finish;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish("No reply from the organizer. Please try again."),
        timeout
      );
      finish = (error) => {
        clearTimeout(timer);
        this.#requests.delete(key);
        if (error) reject(new Error(error));
        else resolve();
      };
    });
    this.#requests.set(key, { id, promise, finish });
    void promise.catch(() => {
    });
    try {
      if (!send(id)) finish("Connection to the organizer is not ready. Please try again.");
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error));
    }
    return promise;
  }
  acknowledge(id, error) {
    for (const request of this.#requests.values())
      if (request.id === id) {
        request.finish(error);
        return true;
      }
    return false;
  }
  cancel(message) {
    for (const request of this.#requests.values()) request.finish(message);
  }
};

// src/chat.ts
var CHAT_LIMIT = 400;
function validLine(value) {
  if (!value || typeof value !== "object") return false;
  const l = value;
  return Number.isSafeInteger(l.seq) && l.seq > 0 && Number.isSafeInteger(l.at) && l.at >= 0 && Number.isSafeInteger(l.speaker) && l.speaker > 0 && Number.isInteger(l.color) && l.color >= 0 && l.color < 8 && typeof l.name === "string" && l.name.length <= 64 && typeof l.text === "string" && l.text.length > 0 && l.text.length <= CHAT_LIMIT;
}
var CupChat = class {
  #options;
  #cupId = "";
  #lines = [];
  #speakers = [];
  #requests = new PendingActions();
  #seen = /* @__PURE__ */ new Map();
  #rates = /* @__PURE__ */ new Map();
  #reads = /* @__PURE__ */ new Map();
  #nextRead = 0;
  #muted = false;
  #revision = 0;
  constructor(options) {
    this.#options = options;
  }
  get cupId() {
    return this.#cupId;
  }
  get lines() {
    return this.#lines;
  }
  get revision() {
    return this.#revision;
  }
  get muted() {
    return this.#muted;
  }
  get speakers() {
    return this.#speakers.map(({ id, name, color, muted, key }) => ({
      id,
      name,
      color,
      muted,
      canMute: key !== "host"
    }));
  }
  #context() {
    const context = this.#options.context();
    if (context && context.cupId !== this.#cupId) {
      this.#requests.cancel("The Cup changed.");
      this.#cupId = context.cupId;
      this.#lines = [];
      this.#speakers = [];
      this.#seen.clear();
      this.#rates.clear();
      this.#reads.clear();
      this.#nextRead = 0;
      this.#muted = false;
      this.#revision++;
    }
    return context;
  }
  tick() {
    const context = this.#context();
    if (!context || context.host || Date.now() < this.#nextRead) return;
    this.#nextRead = Date.now() + 2e3;
    this.#options.send(0, { type: "chat-read", cupId: context.cupId, after: this.#lines.length });
  }
  async post(text) {
    const context = this.#context();
    if (!context) throw new Error("Join a Cup to chat.");
    text = cleanChatText(text);
    if (!text || text.length > CHAT_LIMIT) throw new Error(`Use 1\u2013${CHAT_LIMIT} characters.`);
    await this.#requests.run("chat", (requestId) => {
      const message = { type: "chat-post", cupId: context.cupId, requestId, text };
      if (context.host) {
        this.receive(context.selfId, message);
        return true;
      }
      return this.#options.send(0, message);
    });
  }
  receive(id, message) {
    const context = this.#context();
    if (!context || message.cupId !== context.cupId) return;
    if (!context.host) {
      if (id !== 0) return;
      if (message.type === "chat-ack" && typeof message.requestId === "string") {
        this.#requests.acknowledge(
          message.requestId,
          typeof message.error === "string" ? message.error.slice(0, 200) : void 0
        );
      } else if (message.type === "chat-line") this.#append(message.line);
      else if (message.type === "chat-page" && Array.isArray(message.lines) && message.lines.length <= 32 && Number.isSafeInteger(message.total) && message.total >= this.#lines.length && typeof message.muted === "boolean") {
        if (message.muted !== this.#muted) {
          this.#muted = message.muted;
          this.#revision++;
        }
        for (const line of message.lines) this.#append(line);
        if (this.#lines.length < message.total) this.#nextRead = 0;
      }
      this.#options.changed();
      return;
    }
    const peer = context.peers.find((p) => p.id === id);
    if (!peer) return;
    if (message.type === "chat-read") {
      if (!Number.isSafeInteger(message.after) || message.after < 0 || message.after > this.#lines.length || Date.now() < (this.#reads.get(id) ?? 0))
        return;
      this.#reads.set(id, Date.now() + 200);
      this.#options.send(id, {
        type: "chat-page",
        cupId: context.cupId,
        lines: this.#lines.slice(message.after, message.after + 32),
        total: this.#lines.length,
        muted: !!this.#speakers.find((s) => s.key === peer.key)?.muted
      });
    } else if (message.type === "chat-post" && typeof message.requestId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(message.requestId)) {
      let error;
      try {
        if (!peer.key) throw new Error("Verifying your profile. Try again in a moment.");
        const nonce = `${peer.key}:${message.requestId}`;
        if (!this.#seen.has(nonce)) {
          if (typeof message.text !== "string" || message.text.length > CHAT_LIMIT)
            throw new Error("Message is too long.");
          if (this.#lines.length >= 1e5)
            throw new Error("This Cup has reached its chat limit. Export the log to keep it.");
          const text = filterChat(cleanChatText(message.text));
          if (!text) throw new Error("Enter a message.");
          let speaker = this.#speakers.find((s) => s.key === peer.key);
          if (!speaker) {
            speaker = {
              key: peer.key,
              id: this.#speakers.length + 1,
              color: Math.abs(id) % 8,
              name: "",
              muted: false
            };
            this.#speakers.push(speaker);
          }
          if (speaker.muted) throw new Error("The organizer muted you for this Cup.");
          const recent = (this.#rates.get(peer.key) ?? []).filter((at) => Date.now() - at < 5e3);
          if (recent.length >= 3) throw new Error("Slow down\u2014try again in a few seconds.");
          recent.push(Date.now());
          this.#rates.set(peer.key, recent);
          speaker.name = filterChat(cleanChatText(peer.name).slice(0, 64));
          const line = {
            seq: this.#lines.length + 1,
            at: Date.now(),
            speaker: speaker.id,
            color: speaker.color,
            name: speaker.name,
            text
          };
          this.#lines.push(line);
          this.#seen.set(nonce, line.seq);
          this.#revision++;
          for (const target of context.peers)
            if (target.id !== context.selfId)
              this.#options.send(target.id, { type: "chat-line", cupId: context.cupId, line });
        }
      } catch (e) {
        error = e instanceof Error ? e.message : "Could not send message.";
      }
      const ack = {
        type: "chat-ack",
        cupId: context.cupId,
        requestId: message.requestId,
        error
      };
      if (id === context.selfId) this.#requests.acknowledge(message.requestId, error);
      else this.#options.send(id, ack);
      this.#options.changed();
    }
  }
  #append(line) {
    if (!validLine(line) || line.seq !== this.#lines.length + 1) {
      this.#nextRead = 0;
      return;
    }
    this.#lines.push({
      ...line,
      name: filterChat(cleanChatText(line.name)),
      text: filterChat(cleanChatText(line.text))
    });
    this.#revision++;
  }
  mute(speakerId, muted) {
    const context = this.#context();
    if (!context?.host) throw new Error("Only the organizer can mute chat.");
    const speaker = this.#speakers.find((s) => s.id === speakerId);
    if (!speaker || speaker.key === "host") return;
    speaker.muted = muted;
    this.#revision++;
    this.#options.changed();
  }
  archive() {
    this.#context();
    return {
      cupId: this.#cupId,
      lines: structuredClone(this.#lines),
      speakers: structuredClone(this.#speakers)
    };
  }
  restore(value, cupId) {
    if (value === void 0) return;
    const data = value;
    if (!data || data.cupId !== cupId || !Array.isArray(data.lines) || !Array.isArray(data.speakers) || data.lines.length > 1e5 || data.speakers.length > 1e4 || !data.lines.every((line, i) => validLine(line) && line.seq === i + 1) || !data.speakers.every(
      (s, i) => s && s.id === i + 1 && typeof s.key === "string" && s.key.length <= 100 && typeof s.name === "string" && s.name.length <= 64 && typeof s.muted === "boolean" && Number.isInteger(s.color) && s.color >= 0 && s.color < 8
    ) || !data.lines.every((line) => data.speakers.some((s) => s.id === line.speaker)))
      throw new Error("Invalid saved chat.");
    this.#requests.cancel("Chat restored.");
    this.#cupId = cupId;
    this.#lines = data.lines.map((l) => ({
      ...l,
      text: filterChat(cleanChatText(l.text)),
      name: filterChat(cleanChatText(l.name))
    }));
    this.#speakers = structuredClone(data.speakers);
    this.#seen.clear();
    this.#rates.clear();
    this.#reads.clear();
    this.#nextRead = 0;
    this.#revision++;
  }
};

// src/validation.ts
function validSnapshot(value) {
  const s = value;
  const obj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const text = (t) => typeof t === "string" && t.length <= 128;
  const num = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const frames = (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 36e5;
  if (!obj(s) || s.schema !== 2 || s.preset !== void 0 && !validPreset(s.preset) || !text(s.id) || !text(s.name) || !num(s.revision) || ![
    "registration",
    "loading",
    "warmup",
    "countdown",
    "racing",
    "between-rounds",
    "complete"
  ].includes(s.phase) || !["dnf", "void"].includes(s.disconnectPolicy) || !Array.isArray(s.roster) || s.roster.length > (rulesFor(s).allowRacerChanges ? 128 : 8) || !s.roster.every(
    (p) => obj(p) && Number.isSafeInteger(p.id) && p.id !== 0 && text(p.name) && (p.countryCode == null || typeof p.countryCode === "string" && /^[a-z]{2}$/i.test(p.countryCode))
  ) || new Set(s.roster.map((p) => p.id)).size !== s.roster.length || !Array.isArray(s.tracks) || s.tracks.length > (s.preset ? 1e3 : 8) || !s.tracks.every(
    (t) => obj(t) && typeof t.id === "string" && /^[a-f0-9]{64}$/i.test(t.id) && text(t.name)
  ) || new Set(s.tracks.map((t) => t.id)).size !== s.tracks.length)
    return false;
  const ids = (values) => Array.isArray(values) && values.length <= 128 && values.every((id) => s.roster.some((p) => p.id === id)) && new Set(values).size === values.length;
  const times = (o) => obj(o) && Object.keys(o).length <= 128 && Object.entries(o).every(([id, n]) => s.roster.some((p) => p.id === Number(id)) && num(n));
  const trackId = (id) => s.tracks.some((t) => t.id === id);
  if (s.removedTracks !== void 0 && (!Array.isArray(s.removedTracks) || s.removedTracks.length > 1e3 || new Set(s.removedTracks).size !== s.removedTracks.length || !s.removedTracks.every((id) => typeof id === "string" && /^[a-f0-9]{64}$/i.test(id))))
    return false;
  if (s.withdrawn !== void 0 && !ids(s.withdrawn) || s.pendingRacers !== void 0 && !ids(s.pendingRacers) || s.pendingRacers?.some((id) => s.withdrawn?.includes(id)) || (!rulesFor(s).allowRacerChanges || s.phase === "registration") && (s.withdrawn?.length ?? 0) + (s.pendingRacers?.length ?? 0) > 0)
    return false;
  if (!obj(s.picks) || Object.entries(s.picks).some(([id, t]) => !ids([Number(id)]) || !trackId(t)) || !obj(s.records) || Object.keys(s.records).length > 1e3 || !validDraft(s))
    return false;
  if (s.selections !== void 0 && (!obj(s.selections) || Object.entries(s.selections).some(
    ([id, picks]) => !ids([Number(id)]) || !Array.isArray(picks) || picks.length > rulesFor(s).picksPerRacer || new Set(picks).size !== picks.length || !picks.every(trackId) || s.picks[Number(id)] !== picks[0]
  )))
    return false;
  if (s.preset && rulesFor(s).selection === "random" && Object.keys(s.picks).length) return false;
  for (const [id, r2] of Object.entries(s.records)) {
    if (!trackId(id) || !obj(r2) || !obj(r2.pbs) || Object.keys(r2.pbs).length > 128) return false;
    for (const [id2, p] of Object.entries(r2.pbs))
      if (!ids([Number(id2)]) || !validPB(p)) return false;
    if (r2.wr && !validWR(r2.wr)) return false;
    if (r2.tr && (!obj(r2.tr) || !frames(r2.tr.frames) || !ids(r2.tr.ids))) return false;
  }
  const awards = (value2, finishes) => value2 === void 0 || obj(value2) && Object.keys(value2).length <= 8 && Object.entries(value2).every(
    ([id, award]) => ids([Number(id)]) && id in finishes && ["PB", "TR", "WR"].includes(award)
  );
  const round = (r2) => obj(r2) && num(r2.round) && trackId(r2.trackId) && times(r2.finishes) && awards(r2.recordAwards, r2.finishes) && times(r2.points) && ids(r2.dnfs) && ids(r2.winners) && ids(r2.beforeRanking);
  const match = (m) => obj(m) && text(m.name) && ids(m.players) && m.players.length >= 2 && ids(m.winners) && ids(m.ranking) && (s.preset ? m.target === rulesFor(s).pointsToWin && obj(m.trackRounds) : m.target === 100 && m.trackRounds === void 0 || m.target === RULES.target && obj(m.trackRounds)) && m.winnerCount === 1 && m.winners.length <= 1 && num(m.rounds) && (m.currentVisit === void 0 || obj(m.currentVisit) && trackId(m.currentVisit.trackId) && num(m.currentVisit.fromRound) && m.currentVisit.fromRound <= m.rounds) && (m.rotationOffset === void 0 || num(m.rotationOffset) && m.rotationOffset <= 24e7) && Array.isArray(m.order) && m.order.length >= 1 && m.order.length <= (s.preset ? 1e3 : 8) && m.order.every(trackId) && new Set(m.order).size === m.order.length && (m.trackRounds === void 0 || Object.keys(m.trackRounds).length === m.order.length && m.order.every(
    (id) => num(m.trackRounds[id]) && m.trackRounds[id] >= 1 && m.trackRounds[id] <= (s.preset ? 30 : 24e4)
  )) && (m.trackWarmups === void 0 || obj(m.trackWarmups) && Object.keys(m.trackWarmups).length === m.order.length && m.order.every(
    (id) => num(m.trackWarmups[id]) && m.trackWarmups[id] >= (s.preset ? 0 : 3e4) && m.trackWarmups[id] <= 18e6
  )) && times(m.scores) && m.players.every(
    (id) => num(m.scores[id]) && (!rulesFor(s).finalist || m.scores[id] <= m.target)
  ) && obj(m.finalists) && (rulesFor(s).finalist || !Object.keys(m.finalists).length) && (rulesFor(s).selection !== "random" || obj(m.randomTrack) && trackId(m.randomTrack.id) && num(m.randomTrack.fromRound) && num(m.randomTrack.rounds) && m.randomTrack.rounds === rulesFor(s).roundsPerTrack && m.randomTrack.fromRound <= m.rounds && m.rounds <= m.randomTrack.fromRound + m.randomTrack.rounds) && Object.entries(m.finalists).every(
    ([id, f]) => m.players.includes(Number(id)) && obj(f) && num(f.round) && num(f.position) && (f.checkpoint === null || num(f.checkpoint))
  ) && Array.isArray(m.roundsLog) && m.roundsLog.every(round);
  if (!Array.isArray(s.matches) || s.matches.length > 1 || !s.matches.every(match) || s.matchIndex !== (s.matches.length ? 0 : -1) || s.phase !== "registration" && !s.matches.length || !Array.isArray(s.audit) || !s.audit.every((a) => obj(a) && text(a.message) && text(a.at)) || !Array.isArray(s.results) || s.results.length > 128 || !s.results.every(
    (r2) => obj(r2) && ids([r2.id]) && Number.isInteger(r2.place) && r2.place >= 1 && r2.place <= 128
  ) || s.history !== void 0 && (!Array.isArray(s.history) || !s.history.every((h) => obj(h) && h.matchIndex === 0 && match(h.before))))
    return false;
  if (occupiedSlots(s) > 8) return false;
  const r = s.runtime;
  if (!["loading", "warmup", "countdown", "racing"].includes(s.phase)) return r === null;
  return !!r && obj(r) && text(r.id) && num(r.round) && trackId(r.trackId) && (r.sessionId === null || num(r.sessionId)) && typeof r.warmup === "boolean" && (r.racers === void 0 || ids(r.racers) && r.racers.length <= 8) && ids(r.ready) && (r.practiceReady === void 0 || ids(r.practiceReady)) && ids(r.dnfs) && times(r.finishes) && (r.sittingOut === void 0 || ids(r.sittingOut) && r.sittingOut.every((id) => r.dnfs.includes(id) && !(id in r.finishes))) && times(r.checkpoints) && awards(r.recordAwards, r.finishes) && (r.recordBaselines === void 0 || obj(r.recordBaselines) && (r.recordBaselines.wr === void 0 || frames(r.recordBaselines.wr)) && (r.recordBaselines.tr === void 0 || frames(r.recordBaselines.tr)) && obj(r.recordBaselines.pbs) && Object.keys(r.recordBaselines.pbs).length <= 128 && Object.entries(r.recordBaselines.pbs).every(
    ([id, time]) => ids([Number(id)]) && (time === null || frames(time))
  )) && (r.splits === void 0 || obj(r.splits) && Object.keys(r.splits).length <= 8 && Object.entries(r.splits).every(
    ([id, p]) => ids([Number(id)]) && obj(p) && num(p.index) && num(p.frames) && p.frames > 0 && p.frames <= 36e5 && num(p.bestFrames) && p.bestFrames > 0 && p.bestFrames <= p.frames
  )) && (r.liveMovement === void 0 || obj(r.liveMovement) && Object.keys(r.liveMovement).length <= 8 && Object.entries(r.liveMovement).every(
    ([id, n]) => ids([Number(id)]) && Number.isInteger(n) && Math.abs(n) <= 7
  )) && (r.startsAt === null || Number.isFinite(r.startsAt)) && (r.deadline === null || Number.isFinite(r.deadline));
}
function validWR(value) {
  const wr = value;
  return !!wr && !Array.isArray(wr) && ["ready", "missing", "unavailable"].includes(wr.status) && (wr.status !== "ready" || Number.isSafeInteger(wr.frames) && wr.frames > 0 && wr.frames <= 36e5 && typeof wr.name === "string" && wr.name.length <= 128);
}
function validPB(value) {
  const p = value;
  return !!p && ["ready", "missing", "unavailable"].includes(p.status) && (p.status !== "ready" || Number.isSafeInteger(p.frames) && p.frames > 0 && p.frames <= 36e5 && ["profile", "online"].includes(p.source ?? ""));
}

// src/controller.ts
var RECONNECT_GRACE_MS = 15e3;
var LOAD_GRACE_MS = 3e4;
var Controller = class {
  #physicsSource = () => ({ hash: null, driveForce: null });
  #physicsReports = /* @__PURE__ */ new Map();
  #lastPhysics = 0;
  #freecam = false;
  #freecamGame = null;
  #viewerCount = 0;
  #viewerRound = "";
  #lastViewers = 0;
  setPhysicsSource(source) {
    this.#physicsSource = source;
  }
  get physicsWarnings() {
    if (!this.#isHost || !this.#state) return [];
    return this.#state.roster.flatMap((p) => {
      if (!this.#lobby.some((peer) => peer.id === p.id)) return [];
      const entry = this.#physicsReports.get(p.id);
      if (entry?.cupId !== this.#state.id || !entry.report.hash) return [];
      return entry.report.hash === STOCK_PHYSICS ? [] : [{ id: p.id, driveForce: entry.report.driveForce }];
    });
  }
  get viewerCount() {
    return this.#state?.runtime?.id === this.#viewerRound ? this.#viewerCount : 0;
  }
  syncDiagnostics() {
    const s = this.#state;
    if (!s || this.#selfId === null) return;
    const now = Date.now();
    if (now - this.#lastPhysics >= 3e3) {
      const report = this.#physicsSource();
      if (this.#isHost) this.#physicsReports.set(this.#selfId, { cupId: s.id, report });
      else this.#transport.send(0, { type: "physics", cupId: s.id, report });
      this.#lastPhysics = now;
    }
    if (!this.#isHost || !s.runtime || now - this.#lastViewers < 1e3) return;
    this.#lastViewers = now;
    const counts = /* @__PURE__ */ new Map();
    for (const [viewer, target] of this.#subscriptions) {
      if (this.#lobby.some((p) => p.id === viewer) && mayWatch(s, viewer) && this.watchable().includes(target))
        counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    if (this.canSpectate() && !this.#freecam && this.watchId !== null && this.watchable().includes(this.watchId))
      counts.set(this.watchId, (counts.get(this.watchId) ?? 0) + 1);
    for (const id of racingIds(s)) {
      const count = counts.get(id) ?? 0;
      if (id === this.#selfId) {
        this.#viewerCount = count;
        this.#viewerRound = s.runtime.id;
      } else
        this.#transport.send(id, { type: "viewers", cupId: s.id, roundId: s.runtime.id, count });
    }
  }
  #setupDepartures = /* @__PURE__ */ new Map();
  #enrolling = /* @__PURE__ */ new Set();
  #resumeRacers = /* @__PURE__ */ new Set();
  #removingTrack = false;
  #preparingRandom = null;
  get preparingRandom() {
    return !!this.#preparingRandom;
  }
  #actions = new PendingActions();
  #drivingView;
  #cameraRestoredGame = null;
  #unavailableSince = /* @__PURE__ */ new Map();
  #pendingReconnects = /* @__PURE__ */ new Map();
  #reconnectPending = false;
  #loadingSince = 0;
  #lastReady = 0;
  get reconnectPending() {
    return this.#reconnectPending;
  }
  #reconnect = new ReconnectRegistry();
  #identity = null;
  #identityCup = "";
  #lastIdentity = 0;
  get game() {
    return this.#game;
  }
  get info() {
    return this.#info;
  }
  get state() {
    return this.#state;
  }
  get panelRequest() {
    return this.#panelRequest;
  }
  get selfId() {
    return this.#selfId;
  }
  get connection() {
    return this.#connection;
  }
  get lobby() {
    return this.#lobby;
  }
  get watchId() {
    return this.#followingId ?? this.#watchId;
  }
  get startingCup() {
    return this.#startingCup;
  }
  get pendingUpload() {
    return this.#pendingUpload;
  }
  get review() {
    return this.#review;
  }
  get native() {
    return this.#native;
  }
  get hideOtherGhosts() {
    return this.#hideOtherGhosts;
  }
  get isHost() {
    return this.#isHost;
  }
  get hello() {
    return this.#hello;
  }
  get error() {
    return this.#error;
  }
  get auto() {
    return this.#auto;
  }
  get watchStatus() {
    return this.#watchStatus;
  }
  get transferProgress() {
    return this.#transferProgress;
  }
  get needsRebind() {
    return this.#needsRebind;
  }
  #onChange;
  #state = null;
  #game = null;
  #connection = null;
  #isHost = false;
  #selfId = null;
  #lobby = [];
  #tracks = /* @__PURE__ */ new Map();
  #hello = /* @__PURE__ */ new Set();
  #offset = 0;
  #bestRtt = Infinity;
  #error = "";
  #resetKey = "";
  #startKey = "";
  #hookedCar = null;
  #hookedRound = "";
  #startedCar = null;
  #raceTimeOffset = 0;
  #raceClockRound = null;
  #readyKey = "";
  #lastBroadcast = 0;
  #transport;
  #trackUploads = /* @__PURE__ */ new Map();
  #pendingUpload = null;
  #transferProgress = "";
  #recordRequests = /* @__PURE__ */ new Map();
  #lastRecordPoll = 0;
  #startingCup = null;
  #lastHello = 0;
  #lastSaved = -1;
  #auto = true;
  #cameraTransport;
  #cameraBuffers = /* @__PURE__ */ new Map();
  #subscriptions = /* @__PURE__ */ new Map();
  #handoffSubscriptions = /* @__PURE__ */ new Map();
  #watchId = null;
  #followingId = null;
  #lastPose = 0;
  #lastSubscribe = 0;
  #watchStatus = "";
  #watchedPose = null;
  #hideOtherGhosts = false;
  #checkpointProgress = new CheckpointProgress();
  #pendingCheckpoints = /* @__PURE__ */ new Map();
  #checkpointSender = null;
  #lastCheckpointSend = -Infinity;
  #syncSequence = 0;
  #receivedSequence = -1;
  #panelRequest = { revision: 0, open: false, message: "" };
  #roundViewKey = "";
  #review = new ReviewLog();
  #liveInputs = /* @__PURE__ */ new Map();
  #inputSequences = /* @__PURE__ */ new Map();
  #native;
  #timer;
  #inputGame = null;
  #heldDrivingInputs = new HeldDrivingInputs();
  #inputRestoredGame = null;
  #inputCapture = null;
  #info = null;
  #unwatchInputs;
  #needsRebind = /* @__PURE__ */ new Set();
  #viewCupId = null;
  #inputScope = "";
  #manualWatchRound = null;
  #lastWatchPose = null;
  #filteredCars = false;
  #followingGame = null;
  #nextAuto = null;
  #loadingSession;
  #sentRevision;
  #savedReview = 0;
  #savedChat = -1;
  #chatTyping = false;
  setChatTyping(value) {
    this.#chatTyping = value;
    if (value) this.clearDrivingInput();
  }
  #chat;
  get chat() {
    return this.#chat;
  }
  #savedAt = 0;
  #onSpectatorInputs;
  constructor(onChange) {
    this.#onChange = onChange;
    this.#chat = new CupChat({
      context: () => this.#state && this.#selfId !== null ? {
        cupId: this.#state.id,
        host: this.#isHost,
        selfId: this.#selfId,
        peers: this.#lobby.filter((p) => p.id === this.#selfId || this.#hello.has(p.id)).map((p) => ({
          id: p.id,
          name: p.nickname ?? `Player ${p.id}`,
          key: p.id === this.#selfId && this.#isHost ? "host" : this.#reconnect.key(p.id)
        }))
      } : null,
      send: (id, message) => this.#transport.send(id, message),
      changed: () => this.#onChange()
    });
    this.#transport = new CupTransport(
      (id, m) => this.receive(id, m),
      () => {
        this.#lastBroadcast = 0;
      }
    );
    this.#cameraTransport = new CupTransport(
      (id, m) => m.type === "camera" && this.receiveCamera(id, m),
      () => {
      },
      { channelId: 43, realtime: true }
    );
  }
  get cup() {
    if (!this.#state) throw new Error("No Cup is active.");
    return this.#state;
  }
  get round() {
    if (!this.cup.runtime) throw new Error("No round is active.");
    return this.cup.runtime;
  }
  get gameInfo() {
    if (!this.#info) throw new Error("No game session is active.");
    return this.#info;
  }
  get activeGame() {
    if (!this.#game) throw new Error("No game is active.");
    return this.#game;
  }
  get localPlayerId() {
    return this.#selfId;
  }
  ping(id) {
    if (!this.#lobby.some((p) => p.id === id)) return null;
    const ping = this.#connection?.getPing?.(id);
    return typeof ping === "number" && Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null;
  }
  moveToSpectators(id) {
    this.requireHost();
    this.change((state) => leaveRunningCup(state, id));
    this.#resumeRacers.delete(id);
  }
  kickPlayer(id) {
    this.requireHost();
    if (id === this.#selfId || !this.#lobby.some((p) => p.id === id))
      throw new Error("Choose another connected player.");
    if (!this.#connection?.kickPlayer) throw new Error("Lobby kicking is unavailable.");
    const state = this.#state;
    if (state && player(state, id)) {
      if (state.phase === "registration") {
        if (!rosterOpen(state)) resetDraft(state);
        removePlayer(state, id);
        this.pruneTrackData();
      } else if (state.phase !== "complete") {
        sitOut(state, id);
        state.pendingRacers = (state.pendingRacers ?? []).filter((player2) => player2 !== id);
        if (!state.withdrawn?.includes(id)) (state.withdrawn ??= []).push(id);
        touch(state);
      }
      this.#resumeRacers.delete(id);
      this.#needsRebind.delete(id);
      this.#pendingReconnects.delete(id);
    }
    this.#connection.kickPlayer(id);
    this.broadcast();
    this.#onChange();
  }
  toggleAutomaticRounds() {
    this.requireHost();
    this.#auto = !this.#auto;
    this.#nextAuto = this.#auto && this.#state?.phase === "between-rounds" ? Date.now() + rulesFor(this.#state).roundBreakSeconds * 1e3 : null;
  }
  onInputsChanged(callback) {
    this.#onSpectatorInputs = callback;
  }
  init(pml) {
    if (this.#timer !== void 0) return;
    this.#native = connectNative(pml, this);
    window.addEventListener(
      "keydown",
      (event) => {
        if (!this.#state || this.#chatTyping) return;
        if (this.#game) this.#heldDrivingInputs.bind(this.#native.drivingBindings(this.#game));
        this.#heldDrivingInputs.press(event);
        if (this.freecamHotkey(event) || this.checkpointHotkey(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      { capture: true }
    );
    window.addEventListener("keyup", (event) => this.#heldDrivingInputs.release(event.code), {
      capture: true
    });
    window.addEventListener("blur", () => this.clearDrivingInput());
    window.addEventListener(
      "focusin",
      (event) => {
        if (isEditing(event)) this.clearDrivingInput();
      },
      { capture: true }
    );
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.clearDrivingInput();
    });
    this.#native.watchGames(
      (sessions) => watchGameSessions(sessions, (game) => {
        try {
          this.observeGame(game);
        } catch (error) {
          this.fail(error);
        }
      })
    );
    this.#timer = setInterval(() => this.tick(), 100);
  }
  now() {
    return Date.now() + (this.#isHost ? 0 : this.#offset);
  }
  clearDrivingInput() {
    this.#heldDrivingInputs.clear();
    if (this.#state && this.#game) this.#native.clearInput?.(this.#game);
  }
  rememberDrivingView(game) {
    if (game !== this.#game || !this.#state || this.#info?.disposed || this.#followingGame === game || this.localPlayerId === null || !racingIds(this.#state).includes(this.localPlayerId))
      return;
    if (this.#info?.spectator.isEnabled) {
      this.#drivingView = 0;
      return;
    }
    const run = this.#state.runtime;
    if (run && (!["warmup", "countdown", "racing"].includes(this.#state.phase) || this.#info?.sessionId !== run.sessionId || roundDone(this.#state, this.localPlayerId)))
      return;
    this.#drivingView = this.#native.drivingView?.(game);
  }
  gameDisposed(game) {
    if (this.#game !== game) return;
    this.#unwatchInputs?.();
    this.#unwatchInputs = void 0;
    this.#inputGame = null;
    this.#game = null;
    this.#info = null;
  }
  connectionDisposed(connection) {
    if (this.#connection !== connection) return;
    this.#actions.cancel("Disconnected from the organizer.");
    this.#enrolling.clear();
    this.#resumeRacers.clear();
    if (this.#isHost && this.#state) {
      this.#review.close(this.cup, "interrupted");
      this.save(true);
    }
    this.#unwatchInputs?.();
    this.#inputGame = null;
    this.#inputCapture = null;
    this.#liveInputs.clear();
    this.#transport.dispose();
    this.#cameraTransport.dispose();
    this.#pendingCheckpoints.clear();
    this.#connection = null;
    this.#heldDrivingInputs.clear();
    this.#inputRestoredGame = null;
    this.#game = null;
    this.#info = null;
    this.#state = null;
    this.#lobby = [];
    this.#selfId = null;
    this.#auto = false;
    this.#isHost = false;
    this.#cameraBuffers.clear();
    this.#followingId = null;
    this.#handoffSubscriptions.clear();
    this.#unavailableSince.clear();
    this.#pendingReconnects.clear();
    this.#reconnectPending = false;
    this.#nextAuto = null;
    this.#startingCup = null;
    this.#hello.clear();
    this.requestPanel(false, "Left multiplayer lobby");
    this.#onChange();
  }
  fail(error) {
    this.#error = error instanceof Error ? error.message : String(error);
    console.error("[PolyCup]", error);
    this.#onChange();
  }
  observeGame(game) {
    if (!this.#native) return;
    const info = this.#native.read(game);
    if (!info.connection || info.disposed) return;
    this.rememberDrivingView(game);
    this.#game = game;
    this.#info = info;
    this.#lobby = info.connection.getPlayers();
    this.#selfId = this.#lobby.find((p) => p.isSelf)?.id ?? null;
    if (this.#inputGame !== game) {
      this.#unwatchInputs?.();
      this.#inputGame = game;
      this.#unwatchInputs = this.#native.watchInputs?.(game, () => this.captureInputs());
    }
    if (this.#connection !== info.connection) {
      this.#actions.cancel("The multiplayer connection changed.");
      this.#transport.dispose();
      this.#cameraTransport.dispose();
      this.#pendingCheckpoints.clear();
      this.#cameraBuffers.clear();
      this.#subscriptions.clear();
      this.#handoffSubscriptions.clear();
      this.#followingId = null;
      this.#hello.clear();
      this.#connection = info.connection;
      this.#drivingView = void 0;
      this.#cameraRestoredGame = null;
      this.#heldDrivingInputs.clear();
      this.#inputRestoredGame = null;
      this.#identity = null;
      this.#identityCup = "";
      this.#reconnectPending = false;
      this.#pendingReconnects.clear();
      this.#unavailableSince.clear();
      this.#trackUploads.clear();
      this.#recordRequests.clear();
      this.#isHost = this.#connection instanceof this.#native.Host;
      this.#state = null;
      this.#startingCup = null;
      this.#resetKey = "";
      this.#readyKey = "";
      this.#lastSaved = -1;
      this.#lastHello = 0;
      this.#offset = 0;
      this.#bestRtt = Infinity;
      this.#watchId = null;
      this.#needsRebind = /* @__PURE__ */ new Set();
      this.#syncSequence = 0;
      this.#receivedSequence = -1;
      this.#roundViewKey = "";
      this.#viewCupId = null;
      this.#onChange();
    }
    this.#native.leaderboardUploads?.(
      game,
      this.#state ? rulesFor(this.#state).uploadLeaderboardTimes === true : void 0
    );
    if (!this.#state || this.localPlayerId === null) return;
    const racing = racingIds(this.#state).includes(this.localPlayerId);
    if (racing && this.#cameraRestoredGame !== game) {
      this.#native.release?.(game, this.#drivingView);
      this.#cameraRestoredGame = game;
    }
    if (racing && this.#inputRestoredGame !== game) {
      const bindings = this.#native.drivingBindings?.(game);
      if (bindings) this.#heldDrivingInputs.bind(bindings);
      this.#native.applyDrivingInput?.(game, this.#heldDrivingInputs.controls());
      this.#inputRestoredGame = game;
    }
    const phase = this.cup.phase;
    if (!racing && info.spectator) this.#native.enableCupSpectator?.(game);
    const run = this.cup.runtime;
    if (run && ["warmup", "countdown", "racing"].includes(phase) && info.sessionId === run.sessionId) {
      const resetKey = `${run.id}:${phase === "warmup" ? "warmup" : "race"}`;
      if (this.#resetKey !== resetKey) {
        this.#resetKey = resetKey;
        this.#startKey = "";
        this.#raceTimeOffset = 0;
        this.#raceClockRound = run.id;
        const view = this.#followingGame === game ? this.#drivingView : this.#native.drivingView?.(game);
        this.#native.reset(game);
        this.#native.clearRecords(this.#connection);
        if (racing) {
          this.#native.release?.(game, view);
          info.spectator.isEnabled = false;
        }
        this.#info = this.#native.read(game);
      }
      if (phase !== "warmup" && racing && (this.#hookedCar !== this.gameInfo.car || this.#hookedRound !== run.id)) {
        this.#hookedCar = this.gameInfo.car;
        this.#hookedRound = run.id;
        this.hookFinish(this.gameInfo.car, run);
      }
      const startDue = (phase === "countdown" || phase === "racing") && run.startsAt !== null && this.now() >= run.startsAt;
      if (racing && startDue && (this.#startKey !== run.id || this.#startedCar !== this.gameInfo.car)) {
        this.#startKey = run.id;
        this.#startedCar = this.gameInfo.car;
        this.#native.release?.(game);
        this.gameInfo.spectator.isEnabled = false;
        this.#native.applyDrivingInput?.(game, this.#heldDrivingInputs.controls());
        this.#raceTimeOffset = Math.max(
          this.#raceTimeOffset,
          Math.floor(this.now() - run.startsAt) - this.gameInfo.car.getTime().numberOfFrames
        );
        this.gameInfo.car.start();
        this.captureInputs();
      }
    }
  }
  shouldBlock(game) {
    if (!this.#state || game !== this.#game) return false;
    if (this.localPlayerId === null) return true;
    if (!racingIds(this.#state).includes(this.localPlayerId)) return true;
    if (this.gameInfo.sessionId !== this.cup.runtime?.sessionId) return true;
    if (this.cup.phase === "warmup") return false;
    return !(["racing", "countdown"].includes(this.cup.phase) && this.cup.runtime?.startsAt !== null && this.now() >= this.round.startsAt && !(this.localPlayerId in this.round.finishes) && !this.round.dnfs.includes(this.localPlayerId));
  }
  handleRestart(game) {
    if (!this.#state || game !== this.#game) return false;
    if (this.cup.phase === "warmup" && !this.#chatTyping && !this.#info?.disposed && this.localPlayerId !== null && racingIds(this.cup).includes(this.localPlayerId) && this.gameInfo.sessionId === this.cup.runtime?.sessionId) {
      this.#native.reset(game);
      this.#info = this.#native.read(game);
    }
    return true;
  }
  shouldBlockRestart(game) {
    return !!this.#state && game === this.#game && this.cup.phase !== "warmup";
  }
  restartHotkey(event) {
    if (this.#chatTyping) return false;
    const s = this.#state, run = s?.runtime;
    if (this.localPlayerId === null || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.composedPath().some(
      (e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName) || e.isContentEditable
    ) || !this.#game || this.#info?.disposed || s?.phase !== "racing" || !run || this.#info?.sessionId !== run.sessionId || run.startsAt === null || this.now() < run.startsAt || !racingIds(s).includes(this.localPlayerId) || roundDone(s, this.localPlayerId) || !this.#native.restartPressed(this.#game, event))
      return false;
    this.action("dnf", run.id)?.catch((error) => this.fail(error));
    return true;
  }
  checkpointHotkey(event) {
    if (this.#chatTyping) return false;
    const state = this.#state, run = state?.runtime, id = this.localPlayerId;
    if (!this.#game || this.#info?.disposed || id === null || state?.phase !== "racing" || !run || this.#info?.sessionId !== run.sessionId || run.startsAt === null || this.now() < run.startsAt || !racingIds(state).includes(id) || roundDone(state, id) || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isEditing(event))
      return false;
    if (!this.#native.startRespawnPressed(this.#game, event)) return false;
    if (event.repeat) return true;
    this.captureInputs();
    this.#raceTimeOffset = Math.max(
      this.lapFrames(this.gameInfo.car.getTime().numberOfFrames),
      Math.floor(this.now() - run.startsAt)
    );
    this.#raceClockRound = run.id;
    this.#native.reset(this.#game);
    this.observeGame(this.#game);
    return true;
  }
  lapFrames(frames) {
    return frames + (this.#raceClockRound === this.#state?.runtime?.id ? this.#raceTimeOffset : 0);
  }
  hookFinish(car, run) {
    let checkpoint = null;
    const checkpointIndex = this.gameInfo.checkpointCount - 2;
    car.addCheckpointCallback((index) => {
      if (index === checkpointIndex && checkpointIndex >= 0)
        checkpoint = this.lapFrames(car.getTime().numberOfFrames);
      if (this.localPlayerId === null || this.#state?.phase !== "racing" || this.cup.runtime?.id !== run.id || this.#info?.sessionId !== run.sessionId || this.#info.car !== car)
        return;
      const reached = car.getNextCheckpointIndex() - 1;
      if (reached < 0 || reached > checkpointIndex) return;
      const message = {
        type: "checkpoint",
        cupId: this.cup.id,
        roundId: run.id,
        sessionId: run.sessionId,
        index: reached,
        frames: this.lapFrames(car.getTime().numberOfFrames)
      };
      if (this.#raceTimeOffset > 0)
        this.#native.showRoundCheckpoint?.(this.activeGame, message.frames);
      if (this.#isHost) this.receiveCheckpoint(this.localPlayerId, message);
      else {
        if (this.#checkpointSender !== this.localPlayerId) this.#pendingCheckpoints.clear();
        this.#checkpointSender = this.localPlayerId;
        const pending = this.#pendingCheckpoints.get(reached);
        if (!pending || pending.cupId !== message.cupId || pending.roundId !== message.roundId || pending.sessionId !== message.sessionId)
          this.#pendingCheckpoints.set(reached, message);
        this.flushCheckpoints();
      }
    });
    car.addFinishCallback(() => {
      if (this.localPlayerId === null || this.#state?.phase !== "racing" || this.cup.runtime?.id !== run.id)
        return;
      this.flushInputs();
      const message = {
        type: "finish",
        roundId: run.id,
        sessionId: run.sessionId,
        frames: this.lapFrames(car.getTime().numberOfFrames),
        checkpoint
      };
      if (this.#raceTimeOffset > 0) this.#native.showRoundFinish?.(this.activeGame, message.frames);
      if (this.#isHost) this.receiveFinish(this.localPlayerId, message);
      else this.#transport.send(0, message);
    });
  }
  receiveFinish(id, m) {
    const run = this.#state?.runtime;
    if (!run || m.roundId !== run.id || m.sessionId !== run.sessionId) return;
    const before = standings(this.cup).map((r) => r.id);
    if (recordFinish(this.cup, id, m.frames, this.now())) {
      if (typeof m.checkpoint === "number" && Number.isSafeInteger(m.checkpoint) && m.checkpoint >= 0 && m.checkpoint <= m.frames)
        run.checkpoints[id] = m.checkpoint;
      updateLiveMovement(this.cup, before);
      this.broadcast();
    }
  }
  flushCheckpoints() {
    if (!this.#pendingCheckpoints.size) return;
    const state = this.#state, run = state?.runtime, id = this.localPlayerId;
    if (this.#isHost || !state || state.phase !== "racing" || !run || id === null || id !== this.#checkpointSender || this.#info?.sessionId !== run.sessionId || !racingIds(state).includes(id) || roundDone(state, id)) {
      this.#pendingCheckpoints.clear();
      return;
    }
    for (const [index, message] of this.#pendingCheckpoints)
      if (message.cupId !== state.id || message.roundId !== run.id || message.sessionId !== run.sessionId || (run.splits?.[id]?.index ?? -1) >= index)
        this.#pendingCheckpoints.delete(index);
    const now = performance.now();
    if (now - this.#lastCheckpointSend < 500) return;
    this.#lastCheckpointSend = now;
    let sent = 0;
    for (const message of this.#pendingCheckpoints.values()) {
      if (!this.#transport.send(0, message) || ++sent >= 4) break;
    }
  }
  receiveCheckpoint(id, m) {
    const run = this.#state?.runtime;
    if (!this.#isHost || !run || m.cupId !== this.cup.id || m.roundId !== run.id || m.sessionId !== run.sessionId || this.#info?.sessionId !== run.sessionId)
      return;
    if (this.#checkpointProgress.record(
      this.cup,
      id,
      m.index,
      m.frames,
      this.now(),
      this.gameInfo.checkpointCount
    )) {
      this.ensureReview();
      this.#review.checkpoint(run.id, id, m.index, m.frames);
      this.broadcast();
    }
  }
  ensureReview() {
    if (!this.#isHost || !this.#state) return;
    if (this.#review.cupId !== this.cup.id) this.#review = new ReviewLog(this.cup.id);
    if (this.cup.phase === "racing" || this.cup.phase === "countdown" && this.now() >= (this.cup.runtime?.startsAt ?? Infinity))
      this.#review.begin(this.#state, this.#info?.checkpointCount ?? 0);
  }
  inputContext() {
    const s = this.#state, r = s?.runtime;
    if (!r || r.sessionId !== this.#info?.sessionId || this.#info?.disposed || !(s.phase === "warmup" || ["countdown", "racing"].includes(s.phase) && r.startsAt !== null && this.now() >= r.startsAt))
      return null;
    return {
      cupId: s.id,
      roundId: r.id,
      sessionId: r.sessionId,
      stage: s.phase === "warmup" ? "warmup" : "race"
    };
  }
  syncInputScope(context) {
    const scope = JSON.stringify(context);
    if (scope !== this.#inputScope) {
      this.#inputScope = scope;
      this.#inputCapture = null;
      this.#liveInputs.clear();
      this.#inputSequences.clear();
    }
  }
  captureInputs() {
    if (this.localPlayerId === null) return;
    const context = this.inputContext();
    this.syncInputScope(context);
    if (!context || !racingIds(this.#state).includes(this.localPlayerId) || roundDone(this.#state, this.localPlayerId) || !this.#native?.readInputs)
      return;
    this.#inputCapture ??= new InputCapture(context);
    try {
      const sample = this.#native.readInputs(this.activeGame);
      this.#inputCapture.capture(this.lapFrames(sample.frames), inputMask(sample.controls));
    } catch {
      this.#inputCapture.markGap();
    }
  }
  flushInputs() {
    if (this.localPlayerId === null) return;
    this.captureInputs();
    if (!this.#inputCapture || !this.inputContext() || roundDone(this.#state, this.localPlayerId))
      return;
    const actor = this.localPlayerId;
    return this.#inputCapture.flush(
      (message) => this.#isHost ? this.receiveInputs(actor, message) : this.#transport.send(0, message)
    );
  }
  receiveInputs(id, m) {
    const context = this.inputContext();
    if (!this.#isHost || !context || !Object.entries(context).every(([k, v]) => m[k] === v) || id !== this.#selfId && !this.#hello.has(id) || !racingIds(this.#state).includes(id) || roundDone(this.#state, id) || !Number.isSafeInteger(m.seq) || m.seq < 0 || !frameNumber(m.through) || typeof m.gap !== "boolean" || !Number.isSafeInteger(m.attempt) || m.attempt < 0 || context.stage === "race" && m.attempt !== 0 || !validInputEvents(m.events, m.through) || context.stage === "race" && m.through > this.now() - this.round.startsAt + 2e3)
      return false;
    this.syncInputScope(context);
    if (m.seq <= (this.#inputSequences.get(id) ?? -1)) return false;
    let timeline = this.#liveInputs.get(id) ?? new InputTimeline();
    if (m.attempt < timeline.attempt) return false;
    if (m.attempt > timeline.attempt) {
      timeline = new InputTimeline(m.attempt);
    }
    if (m.through < timeline.through || m.events.length && m.events[0][0] < (timeline.events.at(-1)?.[0] ?? 0))
      return false;
    if (context.stage === "race") {
      this.ensureReview();
      if (!this.#review.inputs(m.roundId, id, m)) return false;
    }
    this.#inputSequences.set(id, m.seq);
    timeline.push(m.events, m.through, this.now());
    this.#liveInputs.set(id, timeline);
    for (const [spectator, watched] of this.#subscriptions)
      if ((watched === id || this.#handoffSubscriptions.get(spectator) === id) && mayWatch(this.#state, spectator))
        this.#transport.send(spectator, {
          type: "input-view",
          ...context,
          racerId: id,
          attempt: m.attempt,
          through: m.through,
          events: m.events
        });
    return true;
  }
  receiveInputView(id, m) {
    const context = this.inputContext();
    if (this.#isHost || id !== 0 || !context || !this.canSpectate() || m.racerId !== this.#watchId && m.racerId !== this.#followingId || !Object.entries(context).every(([k, v]) => m[k] === v) || !Number.isSafeInteger(m.attempt) || m.attempt < 0 || context.stage === "race" && m.attempt !== 0 || !frameNumber(m.through) || !validInputEvents(m.events, m.through))
      return;
    this.syncInputScope(context);
    let timeline = this.#liveInputs.get(m.racerId) ?? new InputTimeline();
    if (m.attempt < timeline.attempt) return;
    if (m.attempt > timeline.attempt) {
      timeline = new InputTimeline(m.attempt);
    }
    if (timeline.push(m.events, m.through, this.now())) this.#liveInputs.set(m.racerId, timeline);
  }
  watchedInputs() {
    return this.canSpectate() && this.#watchedPose ? this.#liveInputs.get(this.watchId)?.sample(this.#watchedPose.frames, this.now()) ?? null : null;
  }
  freecamHotkey(event) {
    if (!this.#state || !this.#game || this.#chatTyping || isEditing(event) || event.ctrlKey || event.metaKey || event.altKey || !this.#native.freecamPressed?.(this.#game, event) || !mayWatch(this.#state, this.#selfId))
      return false;
    if (event.repeat) return true;
    if (rulesFor(this.#state).allowSpectatorFreecam === false) return true;
    this.#freecam = !this.#freecam;
    this.#freecamGame = null;
    this.#lastSubscribe = 0;
    if (this.#freecam) {
      this.#followingGame = null;
      this.#followingId = null;
      if (!this.#isHost) this.#transport.send(0, { type: "watch", value: null });
    }
    this.#onChange();
    return true;
  }
  canSpectate() {
    if (this.#freecam) return false;
    if (!this.#state?.runtime) return false;
    if (this.#info && this.#info.sessionId !== this.#state.runtime.sessionId) return false;
    if (this.localPlayerId === null) return false;
    if (!mayWatch(this.#state, this.#selfId)) return false;
    if (!racingIds(this.#state).includes(this.localPlayerId)) return true;
    return this.#manualWatchRound === this.cup.runtime?.id || !!this.#game && (this.#native?.autoSpectate?.(this.#game) ?? true);
  }
  watchRemaining() {
    if (this.localPlayerId === null) return;
    if (!roundDone(this.#state, this.localPlayerId)) return;
    this.#manualWatchRound = this.round.id;
    this.#onChange();
  }
  toggleGhosts() {
    if (!this.#state) return;
    this.#hideOtherGhosts = !this.#hideOtherGhosts;
    this.#onChange();
  }
  watchable() {
    return this.#state && this.cup.phase !== "complete" ? racingIds(this.#state).filter(
      (id) => !roundDone(this.#state, id) && this.#lobby.some((p) => p.id === id)
    ) : [];
  }
  cycleWatch(delta) {
    const ids = this.watchable();
    if (!this.canSpectate() || !ids.length) return;
    const i = ids.indexOf(this.#watchId);
    this.selectWatch(ids[(i + delta + ids.length) % ids.length]);
  }
  selectWatch(id) {
    if (!this.canSpectate() || !this.watchable().includes(id)) return;
    if (!this.#isHost) {
      for (const racer of this.#liveInputs.keys())
        if (racer !== id && racer !== this.#followingId) this.#liveInputs.delete(racer);
    }
    this.#watchId = id;
    this.#lastSubscribe = 0;
    if (this.#followingId === null) {
      this.#watchedPose = null;
      this.#lastWatchPose = null;
    }
    this.#onChange();
  }
  stopWatchSubscription() {
    if (!this.#isHost && Date.now() - this.#lastSubscribe > 1e3 && this.#transport.send(0, { type: "watch", value: null }))
      this.#lastSubscribe = Date.now();
  }
  beforeRender(game) {
    if (game !== this.#game) return;
    this.captureInputs();
    if (this.#freecam && (!mayWatch(this.#state, this.#selfId) || rulesFor(this.#state).allowSpectatorFreecam === false)) {
      this.#freecam = false;
      this.#freecamGame = null;
    }
    if (this.#freecam && this.#state && !this.#info?.disposed && this.#selfId !== null) {
      this.stopWatchSubscription();
      if (this.#freecamGame !== game) {
        this.#native.enterFreecam?.(game);
        this.#freecamGame = game;
      }
      this.#native.presentation?.(game, true, true);
      this.#native.visibility(
        game,
        this.#hideOtherGhosts ? [] : racingIds(this.#state),
        this.#selfId
      );
      this.#filteredCars = true;
      this.#onSpectatorInputs?.();
      return;
    }
    const spectating = !this.#info?.disposed && this.canSpectate() && this.watchable().length > 0;
    this.#native.presentation?.(game, !!this.#state, spectating);
    if (this.#info?.disposed || this.localPlayerId === null) return;
    if (!this.#state) {
      if (this.#filteredCars) this.#native.visibility(game, null, this.localPlayerId);
      this.#filteredCars = false;
      return;
    }
    const now = this.now(), active = racingIds(this.#state);
    if (this.canSpectate() && !this.watchable().includes(this.#watchId))
      this.selectWatch(this.watchable()[0]);
    if (!spectating && this.#followingGame === game) {
      this.#native.release(game, this.#drivingView);
      this.#followingGame = null;
      this.#lastWatchPose = null;
    }
    if (active.includes(this.localPlayerId) && !roundDone(this.#state, this.localPlayerId) && now - this.#lastPose >= 50 && !this.gameInfo.spectator.isEnabled) {
      this.#lastPose = now;
      const pose2 = { ...this.#native.camera(game), at: now };
      pose2.frames = this.lapFrames(pose2.frames);
      if (this.#isHost) this.relayCamera(this.localPlayerId, pose2);
      else this.#cameraTransport.send(0, { type: "camera", pose: pose2 });
    }
    if (!spectating) {
      this.stopWatchSubscription();
      if (this.#raceTimeOffset > 0 && this.#raceClockRound === this.#state.runtime?.id)
        this.#native.showRoundTime?.(
          game,
          this.lapFrames(
            (this.gameInfo.car.getFinishTime?.() ?? this.gameInfo.car.getTime()).numberOfFrames
          )
        );
      this.#followingId = null;
      this.#watchedPose = null;
      this.#native.visibility(
        game,
        this.#hideOtherGhosts ? [this.localPlayerId] : active,
        this.localPlayerId
      );
      this.#filteredCars = true;
      this.#onSpectatorInputs?.();
      return;
    }
    if (!this.#isHost && Date.now() - this.#lastSubscribe > 1e3) {
      if (this.#transport.send(0, {
        type: "watch",
        value: this.#watchId,
        previous: this.#followingId !== this.#watchId ? this.#followingId : null
      }))
        this.#lastSubscribe = Date.now();
    }
    const tick = performance.now();
    let pose = this.#cameraBuffers.get(this.#watchId)?.playback(now, this.gameInfo.sessionId, tick);
    if (pose && this.#followingId !== this.#watchId) {
      this.#followingId = this.#watchId;
      this.#lastSubscribe = 0;
      this.#onChange();
    } else if (!pose && this.#followingId !== null && this.#followingId !== this.#watchId) {
      pose = this.#cameraBuffers.get(this.#followingId)?.playback(now, this.gameInfo.sessionId, tick);
    }
    const viewed = this.watchId;
    this.#native.visibility(
      game,
      this.#hideOtherGhosts ? active.filter((id) => id === viewed) : active,
      this.localPlayerId
    );
    this.#filteredCars = true;
    this.#watchedPose = pose ?? null;
    this.#watchStatus = pose ? "Buffered POV" : "Waiting for racer camera";
    if (pose) this.#lastWatchPose = pose;
    else if (!this.#lastWatchPose || this.#lastWatchPose.sessionId !== this.gameInfo.sessionId)
      this.#lastWatchPose = {
        ...this.#native.camera(game),
        carPosition: void 0,
        carQuaternion: void 0
      };
    this.#native.follow(game, this.#lastWatchPose, viewed);
    this.#followingGame = game;
    this.#onSpectatorInputs?.();
  }
  receiveCamera(id, message) {
    if (message.type !== "camera" || !validPose(message.pose) || !this.#state || Math.abs(message.pose.at - this.now()) > 5e3 || message.pose.sessionId !== this.#info?.sessionId)
      return;
    if (this.#isHost) {
      if (this.#hello.has(id) && racingIds(this.#state).includes(id) && !roundDone(this.#state, id))
        this.relayCamera(id, message.pose);
    } else if (id === 0 && (message.racerId === this.#watchId || message.racerId === this.#followingId))
      this.bufferCamera(message.racerId, message.pose);
  }
  bufferCamera(id, pose) {
    if (!this.#cameraBuffers.has(id)) this.#cameraBuffers.set(id, new CameraBuffer());
    this.#cameraBuffers.get(id).push(pose, this.now());
  }
  relayCamera(id, pose) {
    this.bufferCamera(id, pose);
    for (const [spectator, watched] of this.#subscriptions)
      if ((watched === id || this.#handoffSubscriptions.get(spectator) === id) && mayWatch(this.#state, spectator))
        this.#cameraTransport.send(spectator, { type: "camera", racerId: id, pose });
  }
  tick() {
    try {
      if (!this.#connection || !this.#native) return;
      this.#native.pruneClosedPeers?.(this.#connection);
      if (this.#game) this.#info = this.#native.read(this.#game);
      this.#lobby = this.#connection.getPlayers();
      this.#selfId = this.#lobby.find((p) => p.isSelf)?.id ?? null;
      if (this.#selfId === null) {
        this.#onChange();
        return;
      }
      this.#transport.sync(this.#native.peers(this.#connection));
      this.#cameraTransport.sync(this.#native.peers(this.#connection));
      this.syncReconnect();
      this.syncDiagnostics();
      this.#chat.tick();
      if (Date.now() - this.#lastHello > 2e3) {
        this.#lastHello = Date.now();
        if (!this.#isHost)
          this.#transport.send(0, { type: "hello", version: VERSION, sentAt: Date.now() });
      }
      if (!this.#state) {
        if (this.#isHost && Date.now() - this.#lastBroadcast > 1e3) this.broadcast();
        this.#onChange();
        return;
      }
      if (this.#game && this.#info && !this.#info.disposed) {
        this.sendReady();
        this.flushCheckpoints();
        this.ensureReview();
        this.flushInputs();
        this.refreshRecords();
      }
      for (const [id, upload] of this.#trackUploads)
        if (upload.until < Date.now()) this.#trackUploads.delete(id);
      if (this.#isHost) {
        for (const racer of this.cup.roster) {
          const peer = this.#lobby.find((p) => p.id === racer.id);
          if (!peer) continue;
          const country = typeof peer.countryCode === "string" && /^[a-z]{2}$/i.test(peer.countryCode) ? peer.countryCode.toLowerCase() : null;
          if (racer.countryCode !== country) {
            racer.countryCode = country;
            touch(this.cup);
          }
        }
        this.checkDisconnects();
        this.applyReconnects();
        this.admitRacers();
        this.advanceClock();
        if (this.cup.phase === "racing" && !this.#removingTrack) {
          const run = this.round;
          if (allFinished(this.#state) || run.deadline !== null && this.now() >= run.deadline + 1500)
            this.finishRound();
        }
        if (this.#auto && this.cup.phase === "between-rounds" && this.#nextAuto && Date.now() >= this.#nextAuto) {
          if (this.canStartRound())
            this.runRound()?.catch((error) => {
              this.#auto = false;
              this.fail(error);
            });
          else this.#nextAuto = Date.now() + 1e3;
        }
        if (Date.now() - this.#lastBroadcast > 1e3 || this.#sentRevision !== this.cup.revision)
          this.broadcast();
        this.save();
      }
      this.#onChange();
    } catch (error) {
      this.#auto = false;
      this.fail(error);
    }
  }
  create(name) {
    this.#setupDepartures.clear();
    this.#physicsReports.clear();
    this.#lastPhysics = 0;
    this.#enrolling.clear();
    this.#resumeRacers.clear();
    this.#preparingRandom = null;
    this.requireHost();
    this.#state = newCup(name);
    this.#startingCup = null;
    this.#tracks.clear();
    this.#error = "";
    resetDraft(this.#state);
    this.#needsRebind = /* @__PURE__ */ new Set();
    this.#unavailableSince.clear();
    this.#pendingReconnects.clear();
    this.#trackUploads.clear();
    this.#recordRequests.clear();
    this.#auto = true;
    this.#lastSaved = -1;
    this.broadcast();
    this.#onChange();
    this.ensureReview();
  }
  requireHost() {
    if (!this.#isHost || !this.#connection)
      throw new Error("Host a PolyTrack multiplayer lobby first.");
  }
  beginBans() {
    this.requireHost();
    this.requireStartRacers();
    const rules = rulesFor(this.cup);
    const pool = this.allowedTracks().filter((t) => t.category !== "custom");
    const available = new Set(pool.map((t) => t.id)).size;
    const needed = this.cup.roster.length * rules.bansPerRacer + (rules.pool.includes("custom") ? 0 : rules.picksPerRacer);
    if (available < needed)
      throw new Error(
        "Not enough tracks for these bans and picks. Expand the pool or reduce the counts."
      );
    this.change((s) => beginBans(s));
    this.#tracks.clear();
    this.#trackUploads.clear();
  }
  reopenRoster() {
    this.#startingCup = null;
    this.change((s) => resetDraft(s));
    this.#tracks.clear();
    this.#trackUploads.clear();
  }
  setPreset(preset) {
    if (this.#startingCup) throw new Error("Wait for Cup preparation to finish.");
    this.change((s) => applyPreset(s, preset));
    this.#tracks.clear();
    this.#trackUploads.clear();
    this.save(true);
  }
  requestPanel(open, message = "") {
    this.#panelRequest = { revision: this.#panelRequest.revision + 1, open, message };
  }
  async rematch(newTracks = false) {
    this.#preparingRandom = null;
    this.requireHost();
    if (this.#state?.phase !== "complete")
      throw new Error("Finish the Cup before starting a rematch.");
    const next = rematch(this.#state, newTracks);
    const online = new Set(this.#lobby.map((p) => p.id));
    if (next.roster.some((p) => !online.has(p.id))) {
      resetDraft(next);
      for (const p of [...next.roster]) if (!online.has(p.id)) removePlayer(next, p.id);
    }
    const needsDraft = rulesFor(next).selection === "draft" && next.draft?.stage === "roster";
    const launch = !newTracks && !needsDraft && next.roster.length >= 2;
    if (launch) {
      this.requireStartRacers();
      if (this.cup.tracks.some((t) => !this.#tracks.has(t.id)))
        throw new Error("A rematch track is missing. Choose new tracks instead.");
    }
    this.save();
    this.#freecam = false;
    this.#freecamGame = null;
    this.#state = next;
    this.#setupDepartures.clear();
    this.#needsRebind.clear();
    this.#pendingReconnects.clear();
    this.#unavailableSince.clear();
    this.#startingCup = null;
    if (newTracks || needsDraft) this.#tracks.clear();
    this.#enrolling.clear();
    this.#resumeRacers.clear();
    this.#trackUploads.clear();
    this.#recordRequests.clear();
    this.#cameraBuffers.clear();
    this.#subscriptions.clear();
    this.#handoffSubscriptions.clear();
    this.#followingId = null;
    this.#watchId = null;
    this.#lastWatchPose = null;
    this.#manualWatchRound = null;
    this.#auto = true;
    this.#nextAuto = null;
    this.#loadingSession = void 0;
    this.#lastSaved = -1;
    this.#error = "";
    this.broadcast();
    this.#onChange();
    if (launch) await this.startCup();
    else if (!newTracks && needsDraft)
      this.requestPanel(true, "The racer roster changed. Set up bans and picks for the next Cup.");
  }
  syncRoundPanel() {
    const s = this.#state, run = s?.runtime;
    const key = JSON.stringify([s?.id, s?.phase, run?.id, run?.sessionId]);
    if (key === this.#roundViewKey) return;
    this.#roundViewKey = key;
    if (run && ["loading", "warmup", "countdown", "racing"].includes(s.phase)) {
      this.requestPanel(false);
    } else if (s && this.#viewCupId !== s.id) {
      this.requestPanel(true);
    }
    this.#viewCupId = s?.id ?? null;
  }
  releaseCup(message) {
    this.#freecam = false;
    this.#freecamGame = null;
    this.#enrolling.clear();
    this.#resumeRacers.clear();
    this.#preparingRandom = null;
    this.#heldDrivingInputs.clear();
    this.#inputRestoredGame = null;
    this.#reconnect.reset("");
    this.#reconnectPending = false;
    this.#pendingReconnects.clear();
    this.#unavailableSince.clear();
    this.#identity = null;
    this.#identityCup = "";
    this.#state = null;
    this.#startingCup = null;
    this.#auto = false;
    this.#nextAuto = null;
    this.#loadingSession = void 0;
    this.#resetKey = "";
    this.#startKey = "";
    this.#readyKey = "";
    this.#error = "";
    this.#cameraBuffers.clear();
    this.#subscriptions.clear();
    this.#handoffSubscriptions.clear();
    this.#followingId = null;
    this.#recordRequests.clear();
    this.#trackUploads.clear();
    this.#watchId = null;
    this.#watchedPose = null;
    this.#lastWatchPose = null;
    this.#watchStatus = "";
    this.#followingGame = null;
    this.#manualWatchRound = null;
    this.#actions.cancel("The Cup ended.");
    if (this.#pendingUpload) this.#pendingUpload.error = "The Cup ended.";
    this.#transferProgress = "";
    this.#roundViewKey = "";
    this.#viewCupId = null;
    if (this.#game) this.#native?.presentation?.(this.#game, false, false);
    if (this.#game) this.#native?.leaderboardUploads?.(this.#game);
    if (this.#game && !this.#info?.disposed && this.localPlayerId !== null) {
      this.#native?.release?.(this.#game);
      if (this.#info?.spectator) this.gameInfo.spectator.isEnabled = false;
      this.#native?.visibility?.(this.#game, null, this.localPlayerId);
      this.#filteredCars = false;
    }
    this.requestPanel(false, message);
    this.syncInputScope(null);
    this.#onSpectatorInputs?.();
  }
  endCup() {
    this.requireHost();
    if (!this.#state) return;
    this.#review.close(this.#state, "interrupted");
    this.save(true);
    this.releaseCup("Cup ended \xB7 Normal multiplayer");
    this.broadcast();
    this.#onChange();
  }
  acceptTrack(actor, code) {
    const state = this.cup;
    if (!picksOpen(state) || !player(state, actor))
      throw new Error("Join as a racer and wait for the picking phase.");
    if (typeof code !== "string" || code.length > 2e6)
      throw new Error("The track code is too large.");
    const track = this.#native.parse(code.trim());
    if (!track?.trackData?.hasStartingPoint())
      throw new Error("The code must contain a valid PolyTrack track with a start.");
    const id = track.trackData.getId();
    const category = this.#native.trackLibrary?.isOfficialTrack(id) ? "official" : this.#native.trackLibrary?.isCommunityTrack(id) ? "community" : "custom";
    if (category === "custom" && (rulesFor(state).bansPerRacer > 0 || banEntries(state).length))
      throw new Error("Custom tracks are disabled while bans are enabled.");
    if (state.preset && !rulesFor(state).pool.includes(category))
      throw new Error("That track category is not allowed by this preset.");
    chooseTrack(state, actor, { id, name: track.trackMetadata.name });
    this.#tracks.set(id, { ...track, code: code.trim() });
    this.pruneTrackData();
    this.broadcast();
  }
  pruneTrackData() {
    for (const id of this.#tracks.keys())
      if (!this.cup.tracks.some((t) => t.id === id)) this.#tracks.delete(id);
  }
  async importTrack(code) {
    if (this.localPlayerId === null || this.#state?.phase !== "registration" || !player(this.#state, this.localPlayerId))
      throw new Error("Join as a racer before choosing a track.");
    if (typeof code !== "string" || !code.trim() || code.length > 2e6)
      throw new Error("Choose a valid track of up to 2 MB.");
    if (this.#isHost) {
      this.acceptTrack(this.localPlayerId, code);
      return;
    }
    if (this.#pendingUpload) throw new Error("Your previous track is still uploading.");
    const cupId = this.cup.id, connection = this.#connection, transferId = crypto.randomUUID();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pending = { transferId, done: false, error: null };
    this.#pendingUpload = pending;
    this.#transferProgress = "Sending track\u2026";
    this.#onChange();
    const send = async (message) => {
      const deadline = Date.now() + 5e3;
      while (true) {
        if (this.#connection !== connection || this.#state?.id !== cupId || this.cup.phase !== "registration")
          throw new Error("The Cup changed during track upload.");
        if (pending.error) throw new Error(pending.error);
        if (this.#transport.send(0, { ...message, cupId, transferId })) return;
        if (Date.now() > deadline) throw new Error("Track upload lost its connection. Try again.");
        await sleep(100);
      }
    };
    try {
      await send({ type: "track-begin", length: code.length });
      for (let offset = 0, seq = 0; offset < code.length; offset += 24e3, seq++) {
        await sleep(100);
        await send({ type: "track-chunk", seq, data: code.slice(offset, offset + 24e3) });
        this.#transferProgress = `Sending track \xB7 ${Math.min(100, Math.round((offset + 24e3) / code.length * 100))}%`;
        this.#onChange();
      }
      await send({ type: "track-end" });
      this.#transferProgress = "Checking track with organizer\u2026";
      this.#onChange();
      const deadline = Date.now() + 15e3;
      while (!pending.done && !pending.error && Date.now() < deadline) await sleep(100);
      if (pending.error) throw new Error(pending.error);
      if (!pending.done) throw new Error("The organizer did not confirm the track. Try again.");
    } finally {
      this.#pendingUpload = null;
      this.#transferProgress = "";
      this.#onChange();
    }
  }
  receiveTrack(id, m) {
    if (!this.#hello.has(id) || !this.#state || !picksOpen(this.#state) || m.cupId !== this.cup.id || !player(this.#state, id))
      return;
    if (typeof m.transferId !== "string" || m.transferId.length > 64) return;
    try {
      if (m.type === "track-begin") {
        if (!Number.isSafeInteger(m.length) || m.length < 1 || m.length > 2e6)
          throw new Error("Invalid track size.");
        this.#trackUploads.set(id, {
          transferId: m.transferId,
          cupId: m.cupId,
          length: m.length,
          data: "",
          seq: 0,
          until: Date.now() + 3e4
        });
        return;
      }
      const u = this.#trackUploads.get(id);
      if (!u || u.transferId !== m.transferId || u.cupId !== m.cupId || u.until < Date.now())
        throw new Error("Track transfer expired. Select the track again.");
      if (m.type === "track-chunk") {
        if (m.seq !== u.seq || typeof m.data !== "string" || !m.data.length || m.data.length > 24e3 || u.data.length + m.data.length > u.length)
          throw new Error("Invalid track chunk.");
        u.data += m.data;
        u.seq++;
        return;
      }
      if (m.type === "track-end") {
        if (u.data.length !== u.length) throw new Error("Incomplete track upload. Try again.");
        this.#trackUploads.delete(id);
        this.acceptTrack(id, u.data);
        this.#transport.send(id, { type: "track-ack", transferId: m.transferId });
      }
    } catch (e) {
      this.#trackUploads.delete(id);
      this.#transport.send(id, {
        type: "track-ack",
        transferId: m.transferId,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  availableTracks() {
    if (!this.#native?.trackLibrary)
      throw new Error(
        "The game track library is not ready. Open the normal track selector once, then try again."
      );
    const tracks = [];
    this.#native.trackLibrary.forEachTrack(
      (id, metadata, category, _environment, load, thumbnail) => {
        tracks.push({
          id,
          name: metadata.name,
          author: metadata.author,
          category,
          thumbnail,
          load
        });
      }
    );
    return tracks;
  }
  allowedTracks() {
    return this.availableTracks().filter(
      (t) => rulesFor(this.cup).pool.includes(t.category) && !this.cup.removedTracks?.includes(t.id)
    );
  }
  async loadRandomTrack(state, timeoutMs = 2e4, excluded) {
    const pool = this.allowedTracks().filter((t) => t.id !== excluded);
    const previous = currentMatch(state)?.randomTrack?.id;
    const choices = pool.length > 1 ? pool.filter((t) => t.id !== previous) : pool;
    if (!choices.length) throw new Error("No tracks are available in the preset\u2019s track pool.");
    const entry = choices[Math.floor(Math.random() * choices.length)];
    let timer;
    const track = await Promise.race([
      entry.load(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(
            new Error("The random track took too long to load. Try starting the round again.")
          ),
          timeoutMs
        );
      })
    ]).finally(() => clearTimeout(timer));
    if (track.trackData.getId() !== entry.id || !track.trackData.hasStartingPoint())
      throw new Error("The selected random track could not be loaded. Try again.");
    const r = rulesFor(state);
    const wr = r.warmup !== "off" && r.warmupTiming === "wr" ? await this.worldRecordForStart(entry.id) : state.records[entry.id]?.wr ?? { status: "unavailable" };
    return {
      entry,
      track: { ...track, code: track.trackData.toExportString(track.trackMetadata) },
      wr
    };
  }
  async addLibraryTrack(entry) {
    const state = this.#state, connection = this.#connection;
    if (state?.phase !== "registration")
      throw new Error("Tracks can only be selected during registration.");
    const track = await entry.load();
    if (this.#state !== state || this.#connection !== connection || state.phase !== "registration")
      throw new Error("The tournament changed while the track was loading. Select it again.");
    await this.importTrack(track.trackData.toExportString(track.trackMetadata));
    this.#error = "";
    this.#onChange();
  }
  change(fn) {
    this.requireHost();
    const before = this.cup.runtime ? structuredClone(this.cup.runtime) : null;
    const undone = fn === undoRound ? currentMatch(this.cup)?.roundsLog.at(-1) : null;
    this.ensureReview();
    fn(this.cup);
    if (before && [completeRound, voidRound].includes(fn))
      this.#review.close({ runtime: before }, fn === completeRound ? "scored" : "void");
    if (undone) this.#review.undo(undone.round, undone.trackId);
    this.#error = "";
    this.broadcast();
    this.#onChange();
  }
  syncReconnect() {
    const state = this.#state, connection = this.#connection;
    this.#reconnect.reset(state?.id ?? "");
    if (!state || !connection) {
      return;
    }
    if (this.#isHost) {
      this.#reconnect.sync(
        this.#lobby.map((p) => p.id),
        state.roster.map((p) => p.id)
      );
      return;
    }
    if (player(state, this.#selfId)) {
      this.#reconnectPending = false;
    }
    if (!this.#native.reconnectIdentity || !this.#game || this.#selfId === null) return;
    if (this.#identityCup !== state.id) {
      this.#identityCup = state.id;
      this.#lastIdentity = 0;
      this.#identity = this.#native.reconnectIdentity(this.#game, state.id);
      void this.#identity.catch(() => {
      });
    }
    if (Date.now() - this.#lastIdentity < 2e3) return;
    this.#lastIdentity = Date.now();
    void this.#identity?.then((identity) => {
      if (this.#connection === connection && this.#state?.id === state.id)
        this.#transport.send(0, {
          type: "identity-open",
          cupId: state.id,
          publicKey: identity.publicKey
        });
    }).catch(() => {
    });
  }
  restoreRacer(id) {
    const s = this.#state, owner = this.#reconnect.owner(id);
    const key = this.#reconnect.key(id);
    if (s && rosterOpen(s) && key && this.#setupDepartures.get(key) === s.id && !player(s, id) && s.roster.length < 8 && !s.roster.some((p) => this.#reconnect.key(p.id) === key)) {
      const peer = this.#lobby.find((p) => p.id === id);
      if (peer) {
        addPlayer(s, id, peer.nickname);
        this.#setupDepartures.delete(key);
        this.broadcast();
      }
    }
    if (!s || s.phase === "complete" || owner === null || owner === id || !player(s, owner) || player(s, id) || this.#lobby.some((p) => p.id === owner))
      return;
    this.#pendingReconnects.set(id, owner);
    if (s.runtime)
      this.#transport.send(id, { type: "reconnect-queued", cupId: s.id, racerId: owner });
    else this.applyReconnects();
  }
  async receiveReconnect(id, message) {
    if (!("cupId" in message) || message.cupId !== this.#state?.id || !this.#state) return;
    const state = this.#state, connection = this.#connection;
    if (this.#isHost) {
      if (!this.#hello.has(id) || !this.#lobby.some((p) => p.id === id)) return;
      this.#reconnect.reset(state.id);
      if (message.type === "identity-open" && validPublicKey(message.publicKey)) {
        if (this.#reconnect.verified(id, message.publicKey)) {
          this.restoreRacer(id);
          return;
        }
        const nonce = this.#reconnect.challenge(id, message.publicKey);
        if (nonce) this.#transport.send(id, { type: "identity-challenge", cupId: state.id, nonce });
      } else if (message.type === "identity-proof" && typeof message.nonce === "string" && typeof message.signature === "string") {
        if (!await this.#reconnect.prove(id, message.nonce, message.signature)) return;
        if (this.#state !== state || this.#connection !== connection || !this.#lobby.some((p) => p.id === id))
          return;
        this.#reconnect.sync(
          this.#lobby.map((p) => p.id),
          state.roster.map((p) => p.id)
        );
        this.restoreRacer(id);
      }
    } else if (id === 0) {
      if (message.type === "reconnect-queued" && player(state, message.racerId) && !player(state, this.#selfId)) {
        if (this.#reconnectPending) return;
        this.#reconnectPending = true;
        this.requestPanel(false);
        this.#onChange();
        return;
      }
      if (message.type === "identity-challenge" && typeof message.nonce === "string" && /^[a-f0-9]{64}$/.test(message.nonce)) {
        if (this.#identityCup !== state.id || !this.#identity) return;
        const identity = await this.#identity, signature = await identity.sign(message.nonce);
        if (this.#state?.id === state.id && this.#connection === connection)
          this.#transport.send(0, {
            type: "identity-proof",
            cupId: state.id,
            nonce: message.nonce,
            signature
          });
      }
    }
  }
  recoveryRacers() {
    return this.#state?.roster.filter(
      (p) => !this.#state?.withdrawn?.includes(p.id) && (this.#needsRebind.has(p.id) || !this.#lobby.some((l) => l.id === p.id))
    ) ?? [];
  }
  applyReconnects() {
    if (!this.#state || this.#state.runtime || this.#state.phase === "complete") return;
    for (const [id, owner] of this.#pendingReconnects) {
      if (!this.#lobby.some((p) => p.id === id) || this.#reconnect.owner(id) !== owner || !player(this.#state, owner) || player(this.#state, id)) {
        this.#pendingReconnects.delete(id);
        continue;
      }
      if (this.#lobby.some((p) => p.id === owner) || !this.#transport.has(id)) continue;
      const name = this.#lobby.find((p) => p.id === id).nickname;
      this.rebindRacer(owner, id, name);
      if (this.#resumeRacers.delete(owner) && this.cup.withdrawn?.includes(id) && occupiedSlots(this.cup) < 8)
        enterRunningCup(this.cup, id, name);
      this.#pendingReconnects.delete(id);
    }
  }
  rebindRacer(oldId, newId, name) {
    this.requireHost();
    if (this.cup.runtime) throw new Error("Void the round before reconnecting a racer.");
    if (!this.#needsRebind.has(oldId) && this.#reconnect.owner(newId) !== oldId)
      throw new Error("The returning player has not proved ownership of this racer.");
    if (!this.#lobby.some((p) => p.id === newId)) throw new Error("Choose a connected player.");
    if (newId !== this.#selfId && (!this.#hello.has(newId) || !this.#transport.has(newId)))
      throw new Error("Wait for the returning player to load PolyCup.");
    if (oldId !== newId && this.#lobby.some((p) => p.id === oldId) && !this.#needsRebind.has(oldId))
      throw new Error("That racer is still connected.");
    if (oldId !== newId) rebindPlayer(this.cup, oldId, newId, name);
    else touch(this.cup);
    if (oldId !== newId) this.#review.rebind(oldId, newId);
    this.#reconnect.rebind(oldId, newId);
    this.#needsRebind.delete(oldId);
    this.#unavailableSince.delete(oldId);
    this.#error = "";
    this.save(true);
    this.broadcast();
    this.#onChange();
  }
  action(type, value) {
    if (this.localPlayerId === null) return;
    if (type === "dnf") this.flushInputs();
    if (this.#isHost)
      this.handleAction(this.localPlayerId, { type, value, cupId: this.#state?.id });
    else
      return this.#actions.run(
        type,
        (requestId) => this.#transport.send(0, { type, value, cupId: this.#state?.id, requestId })
      );
  }
  handleAction(actor, m) {
    if (!this.#state || !this.#hello.has(actor) && actor !== this.localPlayerId) return false;
    if (m.cupId !== this.cup.id) return false;
    if (m.type === "join") {
      const p = this.#lobby.find((p2) => p2.id === actor);
      if (!p) return false;
      if (this.#state.phase === "registration") {
        addPlayer(this.#state, actor, p.nickname);
        this.#reconnect.sync(
          this.#lobby.map((p2) => p2.id),
          this.#state.roster.map((p2) => p2.id)
        );
      } else enterRunningCup(this.#state, actor, p.nickname);
    } else if (m.type === "leave") {
      if (this.#state.phase === "registration") {
        removePlayer(this.#state, actor);
        this.pruneTrackData();
      } else {
        this.#resumeRacers.delete(actor);
        leaveRunningCup(this.#state, actor);
      }
    } else if (m.type === "remove-pick") {
      removePick(this.#state, actor, m.value ?? "");
      this.pruneTrackData();
    } else if (m.type === "ban") {
      const track = this.allowedTracks().find(
        (t) => t.id === m.value && ["official", "community"].includes(t.category)
      );
      banTrack(this.#state, actor, track);
    } else if (m.type === "dnf" && m.value === this.cup.runtime?.id) {
      const before = standings(this.cup).map((r) => r.id);
      markDNF(this.#state, actor);
      updateLiveMovement(this.cup, before);
    } else if (m.type === "practice-ready") {
      if (!practiceReady(this.#state, actor, m.value ?? "")) return false;
      this.advanceClock();
    } else return false;
    this.broadcast();
    if (this.#state.phase === "between-rounds" && this.#auto)
      this.#nextAuto = Date.now() + rulesFor(this.#state).roundBreakSeconds * 1e3;
    return true;
  }
  async enrollRacer(id, action) {
    const state = this.#state, connection = this.#connection;
    if (!this.#hello.has(id)) throw new Error("The multiplayer connection changed.");
    if (!state || action.cupId !== state.id || state.phase !== "registration" && !rulesFor(state).allowRacerChanges)
      throw new Error("This preset locks the racer roster during the Cup.");
    const deadline = Date.now() + 1e4;
    while (!this.#reconnect.authenticated(id) && !player(state, id)) {
      if (this.#state !== state || this.#connection !== connection || !this.#lobby.some((p) => p.id === id))
        throw new Error("The multiplayer connection changed.");
      if (Date.now() > deadline)
        throw new Error("Could not verify your profile. Rejoin the lobby and try again.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.#state !== state || this.#connection !== connection || !this.#hello.has(id))
      throw new Error("The Cup changed.");
    if (activeIds(state).includes(id) || state.pendingRacers?.includes(id)) return;
    const owner = this.#reconnect.owner(id);
    if (owner !== null && owner !== id && player(state, owner)) {
      if (this.#lobby.some((p) => p.id === owner))
        throw new Error("This profile is already connected to the Cup.");
      if (state.withdrawn?.includes(owner) && occupiedSlots(state) >= 8)
        throw new Error("All eight racer places are filled.");
      this.#resumeRacers.add(owner);
      this.restoreRacer(id);
    } else this.handleAction(id, action);
  }
  receive(id, m) {
    if (m.type === "physics") {
      if (this.#isHost && this.#hello.has(id) && m.cupId === this.#state?.id && validPhysicsReport(m.report))
        this.#physicsReports.set(id, { cupId: m.cupId, report: { ...m.report } });
      return;
    }
    if (m.type === "viewers") {
      if (!this.#isHost && id === 0 && m.cupId === this.#state?.id && m.roundId === this.#state?.runtime?.id && Number.isSafeInteger(m.count) && m.count >= 0 && m.count <= 128) {
        this.#viewerCount = m.count;
        this.#viewerRound = m.roundId;
      }
      return;
    }
    if (m.type.startsWith("chat-")) {
      if (this.#isHost ? this.#hello.has(id) : id === 0) this.#chat.receive(id, m);
      return;
    }
    if (["identity-open", "identity-challenge", "identity-proof", "reconnect-queued"].includes(m.type)) {
      void this.receiveReconnect(id, m).catch(() => {
      });
      return;
    }
    if (this.#isHost) {
      if (m.type === "hello" && m.version === VERSION && Number.isFinite(m.sentAt)) {
        this.#hello.add(id);
        this.#transport.send(id, {
          type: "hello-ack",
          version: VERSION,
          sentAt: m.sentAt,
          hostAt: Date.now()
        });
        this.#transport.send(id, this.syncMessage());
      } else if (m.type === "ready" && this.#hello.has(id)) this.markReady(id, m);
      else if (m.type === "finish" && this.#hello.has(id)) this.receiveFinish(id, m);
      else if (m.type === "checkpoint" && this.#hello.has(id)) this.receiveCheckpoint(id, m);
      else if (m.type === "inputs") this.receiveInputs(id, m);
      else if (m.type === "watch" && this.#hello.has(id)) {
        if (m.value !== null && mayWatch(this.#state, id) && this.watchable().includes(m.value)) {
          if (m.previous !== void 0 && m.previous !== null && m.previous !== m.value && (this.#subscriptions.get(id) === m.previous || this.#handoffSubscriptions.get(id) === m.previous) && this.watchable().includes(m.previous))
            this.#handoffSubscriptions.set(id, m.previous);
          else this.#handoffSubscriptions.delete(id);
          this.#subscriptions.set(id, m.value);
          const context = this.inputContext(), timeline = this.#liveInputs.get(m.value);
          if (context && timeline)
            this.#transport.send(id, {
              type: "input-view",
              ...context,
              racerId: m.value,
              ...timeline.snapshot()
            });
        } else {
          this.#subscriptions.delete(id);
          this.#handoffSubscriptions.delete(id);
        }
      } else if (m.type === "pb" && this.#hello.has(id)) this.receivePB(id, m);
      else if (["track-begin", "track-chunk", "track-end"].includes(m.type))
        this.receiveTrack(id, m);
      else if (["join", "leave", "dnf", "practice-ready", "ban", "remove-pick"].includes(m.type)) {
        const action = m;
        if (action.requestId !== void 0 && (typeof action.requestId !== "string" || action.requestId.length > 80))
          return;
        if (action.type === "join" && !player(this.#state, id)) {
          if (this.#enrolling.has(id)) return;
          this.#enrolling.add(id);
          void this.enrollRacer(id, action).then(() => {
            if (action.requestId)
              this.#transport.send(id, { type: "action-ack", requestId: action.requestId });
          }).catch((error2) => {
            const message = error2 instanceof Error ? error2.message : String(error2);
            this.#transport.send(
              id,
              action.requestId ? { type: "action-ack", requestId: action.requestId, error: message } : { type: "error", message }
            );
          }).finally(() => this.#enrolling.delete(id));
          return;
        }
        let error;
        try {
          if (!this.handleAction(id, action))
            error = "This action is no longer available. Please try again.";
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        if (action.requestId)
          this.#transport.send(id, { type: "action-ack", requestId: action.requestId, error });
        else if (error) this.#transport.send(id, { type: "error", message: error });
      }
    } else if (id === 0) {
      if (m.type === "action-ack") {
        const acknowledged = this.#actions.acknowledge(
          m.requestId,
          m.error ? String(m.error).slice(0, 200) : void 0
        );
        if (acknowledged && m.error) this.#error = String(m.error).slice(0, 200);
      } else if (m.type === "input-view") this.receiveInputView(id, m);
      else if (m.type === "track-ack" && this.#pendingUpload?.transferId === m.transferId) {
        this.#pendingUpload.done = !m.error;
        this.#pendingUpload.error = m.error ? String(m.error).slice(0, 200) : null;
      } else if (m.type === "hello-ack" && Number.isFinite(m.sentAt) && Number.isFinite(m.hostAt)) {
        const rtt = Date.now() - m.sentAt;
        if (rtt >= 0 && rtt < this.#bestRtt) {
          this.#bestRtt = rtt;
          this.#offset = m.hostAt + rtt / 2 - Date.now();
        }
      } else if (m.type === "state" && Number.isSafeInteger(m.sequence) && m.sequence > this.#receivedSequence && (m.state === null || validSnapshot(m.state))) {
        this.#receivedSequence = m.sequence;
        if (m.state === null) {
          if (this.#state) this.releaseCup("Organizer ended the Cup \xB7 Normal multiplayer");
        } else {
          this.#state = { ...m.state, history: [] };
          this.#error = "";
        }
        this.syncRoundPanel();
      } else if (m.type === "error") this.#error = String(m.message).slice(0, 200);
    }
    this.#onChange();
  }
  refreshRecords() {
    if (this.localPlayerId === null) return;
    if (Date.now() - this.#lastRecordPoll < 5e3 || !this.#native?.personalBest || !this.#state)
      return;
    this.#lastRecordPoll = Date.now();
    const state = this.#state, cupId = state.id, connection = this.#connection;
    const trackId = state.runtime?.trackId ?? nextTrack(state);
    if (!trackId) return;
    const stillCurrent = () => this.#state?.id === cupId && this.#connection === connection;
    const launch = (key, interval, fn) => {
      const old = this.#recordRequests.get(key);
      if (old && (old.pending || old.until > Date.now())) return;
      const request = { pending: true, until: Date.now() + interval };
      this.#recordRequests.set(key, request);
      Promise.resolve().then(fn).catch(() => {
      }).finally(() => {
        request.pending = false;
      });
    };
    if (player(state, this.localPlayerId)) {
      const actor = this.localPlayerId;
      launch(`${cupId}:pb:${trackId}:${actor}`, 5e3, async () => {
        const pb = await this.#native.personalBest(this.activeGame, trackId);
        if (!stillCurrent() || this.#selfId !== actor || !validPB(pb)) return;
        const message = { type: "pb", cupId, trackId, pb };
        if (this.#isHost) this.receivePB(actor, message);
        else this.#transport.send(0, message);
      });
    }
    if (this.#isHost)
      launch(`${cupId}:wr:${trackId}`, 12e4, async () => {
        const wr = await this.#native.worldRecord(this.activeGame, trackId);
        if (!stillCurrent() || !this.cup.tracks.some((t) => t.id === trackId)) return;
        const records = this.cup.records[trackId] ??= { pbs: {} };
        if (JSON.stringify(records.wr) !== JSON.stringify(wr)) {
          records.wr = wr;
          touch(this.cup);
          this.broadcast();
        }
      });
  }
  receivePB(actor, m) {
    const s = this.#state;
    if (!s || m.cupId !== s.id || !player(s, actor) || !s.tracks.some((t) => t.id === m.trackId) || !validPB(m.pb))
      return;
    const pb = m.pb.status === "ready" ? { status: "ready", frames: m.pb.frames, source: m.pb.source } : { status: m.pb.status };
    const r = s.records[m.trackId] ??= { pbs: {} };
    if (JSON.stringify(r.pbs[actor]) !== JSON.stringify(pb)) {
      r.pbs[actor] = pb;
      touch(s);
      this.broadcast();
    }
  }
  async worldRecordForStart(trackId, game = this.#game, timeoutMs = 5e3) {
    let timer;
    try {
      const wr = await Promise.race([
        Promise.resolve().then(() => this.#native.worldRecord(game, trackId)),
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
    if (this.#startingCup) return;
    if (this.#state?.phase !== "registration") throw new Error("The Cup has already started.");
    const state = this.#state, connection = this.#connection, game = this.#game;
    const setup = () => JSON.stringify([
      state.roster.map((p) => p.id),
      state.picks,
      state.selections,
      state.draft,
      state.preset
    ]);
    const before = setup();
    const random = rulesFor(state).selection === "random";
    if (!random) lockRegistration(structuredClone(state));
    else if (state.roster.length < 2) throw new Error("Two to eight racers can start a Cup.");
    this.requireStartRacers();
    const request = {};
    this.#startingCup = request;
    this.#error = "";
    this.#onChange();
    try {
      if (random) {
        const { entry, track, wr } = await this.loadRandomTrack(state);
        if (this.#state !== state || this.#connection !== connection || setup() !== before || this.#startingCup !== request)
          throw new Error("The lobby or preset changed. Start the Cup again.");
        state.tracks = [{ id: entry.id, name: entry.name }];
        state.records = { [entry.id]: { pbs: {}, wr } };
        this.#tracks.set(entry.id, track);
      }
      const records = await Promise.all(
        state.tracks.map(
          async (t) => [
            t.id,
            random ? state.records[t.id].wr : await this.worldRecordForStart(t.id, game)
          ]
        )
      );
      if (this.#startingCup !== request || this.#state !== state || this.#connection !== connection || state.phase !== "registration")
        return;
      if (setup() !== before)
        throw new Error("Racers or track picks changed. Start the Cup again.");
      this.requireStartRacers();
      for (const [id, wr] of records) (state.records[id] ??= { pbs: {} }).wr = wr;
      lockRegistration(state);
      this.#trackUploads.clear();
      this.broadcast();
      await this.runRound();
    } finally {
      if (this.#startingCup === request) {
        this.#startingCup = null;
        this.#onChange();
      }
    }
  }
  requireStartRacers() {
    if (this.cup.roster.filter((p) => !this.cup.withdrawn?.includes(p.id)).some(
      (p) => this.#needsRebind?.has(p.id) || !this.#lobby.some((l) => l.id === p.id) || p.id !== this.#selfId && (!this.#hello.has(p.id) || !this.#transport.has(p.id))
    ))
      throw new Error("Every racer must be connected with the current mod before starting.");
  }
  networkState() {
    const state = publicState(this.cup);
    const racers = /* @__PURE__ */ new Set([...activeIds(this.cup), ...state.pendingRacers ?? []]);
    for (const record of Object.values(state.records))
      record.pbs = Object.fromEntries(
        Object.entries(record.pbs).filter(([id]) => racers.has(Number(id)))
      );
    state.audit = state.audit.slice(-8);
    state.matches.forEach((m) => {
      m.roundsLog = m.roundsLog.slice(-1);
    });
    if (rulesFor(this.cup).selection === "random") {
      const keep = /* @__PURE__ */ new Set([
        state.runtime?.trackId,
        ...state.matches.flatMap((m) => [m.randomTrack?.id, ...m.roundsLog.map((r) => r.trackId)])
      ]);
      state.tracks = state.tracks.filter((t) => keep.has(t.id));
      state.records = Object.fromEntries(
        Object.entries(state.records).filter(([id]) => keep.has(id))
      );
      for (const m of state.matches) {
        m.order = m.order.filter((id) => keep.has(id));
        if (m.trackRounds)
          m.trackRounds = Object.fromEntries(
            Object.entries(m.trackRounds).filter(([id]) => keep.has(id))
          );
        if (m.trackWarmups)
          m.trackWarmups = Object.fromEntries(
            Object.entries(m.trackWarmups).filter(([id]) => keep.has(id))
          );
      }
    }
    return state;
  }
  broadcast() {
    this.#transport.broadcast(this.syncMessage());
    this.#sentRevision = this.#state?.revision;
    this.#lastBroadcast = Date.now();
  }
  syncMessage() {
    this.syncRoundPanel();
    return {
      type: "state",
      sequence: ++this.#syncSequence,
      state: this.#state ? this.networkState() : null
    };
  }
  async removeTrack() {
    this.requireHost();
    const state = this.cup, visit = currentTrackVisit(state), connection = this.#connection;
    if (!visit || this.#removingTrack) return;
    this.#removingTrack = true;
    this.#nextAuto = null;
    try {
      const match = currentMatch(state);
      const needsReplacement = rulesFor(state).selection === "random" || !match.order.some((id) => id !== visit.trackId && !state.removedTracks?.includes(id));
      const replacement = needsReplacement ? await this.loadRandomTrack(state, 2e4, visit.trackId) : null;
      if (state !== this.#state || connection !== this.#connection || currentTrackVisit(state)?.trackId !== visit.trackId)
        throw new Error("The Cup changed while preparing the next track.");
      this.#review.close(state, "void");
      if (replacement) this.#tracks.set(replacement.entry.id, replacement.track);
      removeCurrentTrack(
        state,
        replacement ? { id: replacement.entry.id, name: replacement.entry.name } : void 0,
        replacement?.wr
      );
      this.#review.undoTrackVisit(visit.trackId, visit.fromRound);
      this.#loadingSession = void 0;
      this.broadcast();
      this.save(true);
    } finally {
      this.#removingTrack = false;
      this.#onChange();
    }
    return this.runRound();
  }
  runRound() {
    if (this.#removingTrack) return;
    this.requireHost();
    if (this.#preparingRandom) return this.#preparingRandom;
    if (!["dnf", "void"].includes(this.cup.disconnectPolicy))
      throw new Error("Choose a disconnect rule in Tournament before starting.");
    if (this.cup.roster.some((p) => this.#needsRebind?.has(p.id)))
      throw new Error("Confirm every saved racer\u2019s lobby identity in Racers before resuming.");
    this.updateAvailability();
    this.applyReconnects();
    this.admitRacers();
    if (!this.canStartRound())
      throw new Error("Waiting for racers to reconnect or finish loading PolyCup.");
    if (rulesFor(this.cup).selection === "random" && !nextTrack(this.cup)) {
      const state = this.cup, connection = this.#connection;
      this.#nextAuto = null;
      const request = this.loadRandomTrack(state).then(({ entry, track: track2, wr }) => {
        if (this.#state !== state || this.#connection !== connection || state.phase !== "between-rounds")
          return;
        this.#tracks.set(entry.id, track2);
        scheduleRandomTrack(state, { id: entry.id, name: entry.name }, wr);
        this.#preparingRandom = null;
        return this.runRound();
      }).finally(() => {
        if (this.#preparingRandom === request) this.#preparingRandom = null;
        this.#onChange();
      });
      this.#preparingRandom = request;
      this.#onChange();
      return request;
    }
    const track = this.#tracks.get(nextTrack(this.cup));
    if (!track) throw new Error("The selected track is missing from this organizer\u2019s saved pack.");
    beginRound(this.cup);
    for (const id of activeIds(this.cup))
      if (!this.racerAvailable(id)) sitOut(this.cup, id);
    this.#readyKey = "";
    this.#lastReady = 0;
    this.#loadingSince = 0;
    this.#nextAuto = null;
    this.#loadingSession = this.gameInfo.sessionId;
    this.broadcast();
    const mode = rulesFor(this.cup).uploadLeaderboardTimes === true ? 0 : 1;
    this.#connection.startNewSession(mode, track.trackMetadata, track.trackData);
  }
  racerAvailable(id) {
    return !this.#needsRebind.has(id) && this.#lobby.some((p) => p.id === id) && (id === this.#selfId || this.#hello.has(id) && this.#transport.has(id));
  }
  admitRacers() {
    const s = this.cup;
    if (s.runtime || s.phase !== "between-rounds") return;
    for (const id of s.pendingRacers ?? [])
      if (!this.#lobby.some((p) => p.id === id)) this.#resumeRacers.add(id);
    admitPendingRacers(
      s,
      this.#lobby.map((p) => p.id)
    );
  }
  updateAvailability() {
    for (const id of activeIds(this.#state)) {
      if (this.racerAvailable(id)) this.#unavailableSince.delete(id);
      else if (!this.#unavailableSince.has(id)) this.#unavailableSince.set(id, this.now());
    }
  }
  canStartRound() {
    const ids = activeIds(this.#state);
    return !!this.#info && !this.#info.disposed && !this.#needsRebind.size && ids.some((id) => this.racerAvailable(id)) && ids.every(
      (id) => this.racerAvailable(id) || this.now() - (this.#unavailableSince.get(id) ?? this.now()) >= RECONNECT_GRACE_MS
    );
  }
  waitingForRacers() {
    return this.#state?.phase === "between-rounds" && (this.#needsRebind.size > 0 || !activeIds(this.#state).some((id) => this.#lobby.some((p) => p.id === id)));
  }
  checkDisconnects() {
    const s = this.#state;
    if (s?.phase === "registration") {
      const missing2 = s.roster.filter((p) => !this.#lobby.some((peer) => peer.id === p.id));
      if (missing2.length) {
        if (!rosterOpen(s)) resetDraft(s);
        for (const p of missing2) {
          const key = this.#reconnect.ownerKey(p.id);
          if (key) this.#setupDepartures.set(key, s.id);
          removePlayer(s, p.id);
          this.#needsRebind.delete(p.id);
          this.#unavailableSince.delete(p.id);
        }
        this.pruneTrackData();
        this.broadcast();
      }
      return;
    }
    this.updateAvailability();
    if (s && rulesFor(s).allowRacerChanges && !["registration", "complete"].includes(s.phase)) {
      for (const id of this.#resumeRacers) {
        if (s.withdrawn?.includes(id) && this.racerAvailable(id) && occupiedSlots(s) < 8) {
          enterRunningCup(s, id, player(s, id).name);
          this.#resumeRacers.delete(id);
        }
      }
    }
    if (s && rulesFor(s).allowRacerChanges && !["registration", "complete"].includes(s.phase) && (s.disconnectPolicy === "dnf" || s.phase !== "racing")) {
      for (const id of activeIds(s))
        if (this.#unavailableSince.has(id) && this.now() - this.#unavailableSince.get(id) >= RECONNECT_GRACE_MS) {
          this.#resumeRacers.add(id);
          leaveRunningCup(s, id);
        }
    }
    if (!s?.runtime) return;
    const missing = racingIds(s).filter(
      (id) => this.#unavailableSince.has(id) && this.now() - this.#unavailableSince.get(id) >= RECONNECT_GRACE_MS && !(id in s.runtime.finishes) && !s.runtime.dnfs.includes(id)
    );
    if (!missing.length) return;
    if (s.disconnectPolicy === "dnf" || s.phase !== "racing") {
      const before = standings(s).map((r) => r.id);
      for (const id of missing) sitOut(s, id);
      updateLiveMovement(s, before);
      note(s, "Disconnected racers sit out this round.");
    } else {
      this.#review.close(s, "void");
      voidRound(s);
      this.#loadingSession = void 0;
      this.#nextAuto = this.#auto ? Date.now() + rulesFor(this.#state).roundBreakSeconds * 1e3 : null;
      this.#error = "Round voided after a racer disconnected.";
    }
  }
  sendReady() {
    if (this.localPlayerId === null || !this.#info || this.#info.disposed) return;
    const s = this.cup, run = s.runtime;
    if (s.phase !== "loading" || !run || this.gameInfo.trackData.getId() !== run.trackId) return;
    if (this.#isHost && run.sessionId === null) {
      if (this.#loadingSession === void 0) {
        this.#loadingSession = this.gameInfo.sessionId;
        return;
      }
      if (this.gameInfo.sessionId === this.#loadingSession) return;
      run.sessionId = this.gameInfo.sessionId;
      this.#loadingSince = this.now();
      touch(s);
      this.broadcast();
    }
    if (this.gameInfo.sessionId !== run.sessionId || !racingIds(s).includes(this.localPlayerId))
      return;
    const key = `${run.id}:${run.sessionId}`;
    if (run.ready.includes(this.localPlayerId)) return;
    if (this.#readyKey === key && this.now() - this.#lastReady < 1e3) return;
    const m = {
      type: "ready",
      roundId: run.id,
      sessionId: run.sessionId,
      trackId: run.trackId
    };
    if (this.#isHost) this.markReady(this.localPlayerId, m);
    else if (!this.#transport.send(0, m)) return;
    this.#readyKey = key;
    this.#lastReady = this.now();
  }
  markReady(id, m) {
    const run = this.#state?.runtime;
    if (this.#state?.phase !== "loading" || !run || m.roundId !== run.id || m.sessionId !== run.sessionId || m.trackId !== run.trackId || !racingIds(this.#state).includes(id) || run.ready.includes(id))
      return;
    run.ready.push(id);
    touch(this.#state);
  }
  advanceClock() {
    if (this.#removingTrack) return;
    const s = this.#state, run = s?.runtime;
    if (!run) return;
    if (s.phase === "loading" && run.sessionId !== null) {
      if (!this.#loadingSince) this.#loadingSince = this.now();
      if (this.now() - this.#loadingSince >= LOAD_GRACE_MS) {
        for (const id of racingIds(s)) if (!run.ready.includes(id)) sitOut(s, id);
      }
    }
    if (["loading", "warmup", "countdown"].includes(s.phase) && !racingIds(s).length) {
      this.#review.close(s, "void");
      voidRound(s);
      this.#nextAuto = this.#auto ? Date.now() + rulesFor(this.#state).roundBreakSeconds * 1e3 : null;
      this.broadcast();
      return;
    }
    if (s.phase === "loading" && run.sessionId !== null && racingIds(s).every((id) => run.ready.includes(id))) {
      s.phase = run.warmup ? "warmup" : "countdown";
      run.startsAt = this.now() + (run.warmup ? currentMatch(s).trackWarmups?.[run.trackId] ?? RULES.warmupMs : 3e3);
      touch(s);
      this.broadcast();
    } else if (s.phase === "warmup" && (run.startsAt !== null && this.now() >= run.startsAt || rulesFor(s).readyEndsWarmup && racingIds(s).every((id) => run.practiceReady?.includes(id)))) {
      s.phase = "countdown";
      run.startsAt = this.now() + 3e3;
      touch(s);
      this.broadcast();
    } else if (s.phase === "countdown" && run.startsAt !== null && this.now() >= run.startsAt) {
      startRace(s, run.startsAt);
      this.broadcast();
    }
  }
  finishRound() {
    this.change(completeRound);
    this.#loadingSession = void 0;
    this.#nextAuto = this.#auto && this.cup.phase === "between-rounds" ? Date.now() + rulesFor(this.cup).roundBreakSeconds * 1e3 : null;
  }
  voidRound() {
    this.change(voidRound);
    this.#loadingSession = void 0;
    this.#nextAuto = null;
  }
  saveData() {
    return {
      format: "polytrack-world-cup",
      schema: 1,
      state: this.#state,
      ...this.#isHost && this.#state ? { chat: this.#chat.archive() } : {},
      ...this.#isHost && this.#review.cupId === this.#state?.id ? { review: this.#review.data() } : {},
      tracks: [...this.#tracks].map(([id, t]) => ({ id, code: t.code }))
    };
  }
  restore(text) {
    this.requireHost();
    if (text.length > 64e6) throw new Error("The save is too large.");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid Cup save.");
    const data = value;
    if (data.format !== "polytrack-world-cup" || !validSnapshot(data.state) || !Array.isArray(data.tracks) || data.tracks.length > 1e3 || !Array.isArray(data.state.history))
      throw new Error("This autosave cannot be restored by this version of PolyCup.");
    const tracks = /* @__PURE__ */ new Map();
    for (const value2 of data.tracks) {
      if (!value2 || typeof value2 !== "object") throw new Error("Invalid saved track.");
      const entry = value2;
      if (typeof entry.code !== "string" || entry.code.length > 2e6)
        throw new Error("Invalid saved track.");
      const track = this.#native.parse(entry.code);
      if (!track || track.trackData.getId() !== entry.id || !track.trackData.hasStartingPoint())
        throw new Error("Saved track checksum failed.");
      tracks.set(entry.id, { ...track, code: entry.code });
    }
    for (const track of data.state.tracks)
      if (!tracks.has(track.id)) throw new Error("A saved track is missing.");
    const s = { ...data.state, history: data.state.history };
    const review = ReviewLog.restore(data.review, s);
    this.#chat.restore(data.chat ?? { cupId: s.id, lines: [], speakers: [] }, s.id);
    if (s.runtime) {
      s.runtime = null;
      s.phase = "between-rounds";
    }
    s.roster.forEach((p, i) => review.rebind(p.id, -i - 1));
    this.#review = review;
    detachIdentities(s);
    this.#state = s;
    this.#startingCup = null;
    this.#tracks = tracks;
    this.#auto = true;
    this.#nextAuto = null;
    this.#needsRebind = new Set(
      s.roster.filter((p) => !s.withdrawn?.includes(p.id)).map((p) => p.id)
    );
    this.#loadingSession = void 0;
    this.#lastSaved = -1;
    note(s, "Restored save. Organizer must reconnect saved racer identities.");
    touch(s);
    this.broadcast();
    this.#onChange();
  }
  save(force = false) {
    if (!force && this.#lastSaved === this.cup.revision && this.#savedChat === this.#chat.revision && (this.#savedReview === this.#review.revision || Date.now() - (this.#savedAt ?? 0) < 5e3))
      return;
    try {
      localStorage.setItem("pwc-save-v2", JSON.stringify(this.saveData()));
      this.#lastSaved = this.cup.revision;
      this.#savedReview = this.#review.revision;
      this.#savedChat = this.#chat.revision;
      this.#savedAt = Date.now();
    } catch {
      this.#error = "Autosave is full or unavailable. Cup progress could not be saved on this device.";
    }
  }
};

// src/race-status.ts
function downtimeLabel(phase, recovering = false, sameTrack = false) {
  switch (phase) {
    case "loading":
      return sameTrack ? "Preparing next round..." : "Changing track...";
    case "warmup":
      return "Warmup";
    case "between-rounds":
      return recovering ? "Waiting for reconnect..." : "Waiting for next round...";
    case "registration":
      return "Waiting for Cup to start...";
    default:
      return "";
  }
}
function roundSeconds(state, now) {
  const deadline = state?.runtime?.deadline;
  return state?.phase === "racing" && deadline != null && Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1e3)) : null;
}

// src/countdown.ts
function roundStartCue(state, sessionId, now) {
  const run = state?.runtime;
  if (!run || run.sessionId === null || run.sessionId !== sessionId || run.startsAt === null || !Number.isFinite(run.startsAt) || !["countdown", "racing"].includes(state.phase))
    return "";
  const remaining = run.startsAt - now;
  if (remaining > 3e3 || remaining <= -600) return "";
  return remaining > 0 ? String(Math.ceil(remaining / 1e3)) : "GO";
}

// src/dom.ts
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== void 0) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

// src/preset-summary.ts
function presetSummary(rules) {
  const summary = element("div", void 0, "preset-overview");
  const group = (title, entries) => {
    const section = element("section", void 0, "rule-group");
    section.setAttribute("aria-label", `${title} rules`);
    section.append(element("h3", title));
    const list = element("dl");
    for (const [label, value] of entries) {
      const row = element("div", void 0, "rule-pair");
      row.append(element("dt", `${label}:`), element("dd", value));
      list.append(row);
    }
    section.append(list);
    summary.append(section);
  };
  group("Race", [
    ["Rounds per track", String(rules.roundsPerTrack)],
    [rules.finalist ? "Finalist target" : "Points to win", String(rules.pointsToWin)],
    ["Finalist", rules.finalist ? "Enabled" : "Disabled"],
    ["To win", rules.finalist ? "Win as a finalist" : "Lead at the target"],
    ["Leaderboard uploads", rules.uploadLeaderboardTimes ? "On \xB7 Casual" : "Off \xB7 Competitive"]
  ]);
  const tracks = [
    ["Selection", rules.selection === "random" ? "Random rotation" : "Racer draft"],
    [
      "Pool",
      rules.pool.filter((c) => c !== "custom").map((c) => c === "official" ? "Main" : "Community").join(" + ") || "Custom only"
    ],
    ["Custom tracks", rules.pool.includes("custom") ? "Allowed" : "Disabled"]
  ];
  if (rules.selection === "draft")
    tracks.push(
      ["Bans per racer", String(rules.bansPerRacer)],
      ["Picks per racer", String(rules.picksPerRacer)]
    );
  else tracks.push(["Bans / picks", "None"]);
  group("Tracks", tracks);
  const timing = [
    [
      "Warmup",
      rules.warmup === "off" ? "Disabled" : rules.warmup === "first-visit" ? "First visit only" : "Every visit"
    ]
  ];
  if (rules.warmup !== "off") {
    timing.push([
      "Duration",
      rules.warmupTiming === "fixed" ? `${rules.warmupSeconds}s` : `${rules.warmupMultiplier}\xD7 WR, min. ${rules.warmupMinimumSeconds}s`
    ]);
    if (rules.warmupTiming === "wr") timing.push(["Without a WR", `${rules.warmupSeconds}s`]);
    timing.push(["End warmup early", rules.readyEndsWarmup ? "All racers ready" : "Disabled"]);
  }
  timing.push(
    ["Finish window", `${rules.finishTimeoutSeconds}s`],
    ["Round break", `${rules.roundBreakSeconds}s`]
  );
  group("Timing", timing);
  const racers = [
    ["Mid-Cup changes", rules.allowRacerChanges ? "Allowed" : "Locked"]
  ];
  if (rules.allowRacerChanges)
    racers.push(["New racers", "0 points, next round"], ["Returning racers", "Score retained"]);
  else racers.push(["Reconnection", "Score retained"]);
  racers.push([
    "Spectator free camera",
    rules.allowSpectatorFreecam !== false ? "Allowed" : "Disabled"
  ]);
  group("Racers", racers);
  const scoring = element("table", void 0, "rule-points");
  scoring.append(element("caption", "Points by finishing position"));
  const head = element("thead"), places = element("tr"), body = element("tbody"), points = element("tr");
  rules.points.forEach((value, index) => {
    const place = element("th", `${index + 1}${["st", "nd", "rd"][index] ?? "th"}`);
    place.scope = "col";
    places.append(place);
    points.append(element("td", String(value)));
  });
  head.append(places);
  body.append(points);
  scoring.append(head, body);
  summary.append(scoring);
  return summary;
}

// src/ranking-motion.ts
function rankingPositions(root) {
  const positions = /* @__PURE__ */ new Map();
  for (const row of root.querySelectorAll("[data-ranking-row]")) {
    if (!row.getClientRects().length) continue;
    positions.set(row.dataset.rankingRow, {
      top: row.getBoundingClientRect().top,
      order: Number(row.dataset.rankingOrder),
      moving: row.getAnimations().some((animation) => animation.playState === "running")
    });
  }
  return positions;
}
function animateRanking(root, before) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const row of root.querySelectorAll("[data-ranking-row]")) {
    const old = before.get(row.dataset.rankingRow);
    if (!old || !row.getClientRects().length || old.order === Number(row.dataset.rankingOrder) && !old.moving)
      continue;
    const delta = old.top - row.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;
    row.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], {
      duration: 260,
      easing: "cubic-bezier(.2,.7,.25,1)"
    });
  }
}

// src/chat-ui.ts
var colors = [
  "#8edcf4",
  "#ffd26b",
  "#c8afff",
  "#9de4a2",
  "#ffb4c9",
  "#ffbf91",
  "#aebeff",
  "#9aebd5"
];
var ChatUI = class {
  #ui;
  #shadow;
  #root = element("aside", void 0, "cup-chat");
  #button = element("button", "Chat", "chat-toggle");
  #preview = element("div", void 0, "chat-preview");
  #panel = element("section", void 0, "chat-panel");
  #history = element("div", void 0, "chat-history");
  #input = element("input");
  #sendButton = element("button", "Send", "primary");
  #status = element("p", void 0, "chat-status");
  #older = element("button", "Earlier messages", "quiet chat-older");
  #bottom = element("button", "New messages \u2193", "quiet chat-bottom");
  #personMenu = element("div", void 0, "chat-person-menu");
  #selectedSpeaker = null;
  #hidePreview = element("input");
  #expanded = false;
  #persistent = false;
  #cupId = "";
  #shownRevision = -1;
  #known = 0;
  #read = 0;
  #limit = 60;
  #expires = 0;
  #sending = false;
  #stickBottom = true;
  #prepend = false;
  constructor(ui, shadow) {
    this.#ui = ui;
    this.#shadow = shadow;
    this.#root.setAttribute("aria-label", "Cup chat");
    this.#button.type = "button";
    this.#button.addEventListener("click", () => this.#expanded ? this.close() : this.open());
    this.#panel.id = "cup-chat-panel";
    this.#panel.setAttribute("aria-label", "Chat history");
    const heading = element("div", void 0, "chat-heading");
    heading.append(element("strong", "Cup chat"));
    const close = element("button", "Close", "quiet chat-close");
    close.type = "button";
    close.addEventListener("click", () => this.close());
    heading.append(close);
    this.#history.tabIndex = 0;
    this.#history.setAttribute("aria-label", "Messages");
    this.#history.addEventListener("scroll", () => {
      this.#stickBottom = this.#history.scrollHeight - this.#history.scrollTop - this.#history.clientHeight < 32;
      this.#bottom.hidden = this.#stickBottom;
    });
    this.#older.type = "button";
    this.#older.addEventListener("click", () => {
      this.#limit += 100;
      this.#prepend = true;
      this.#shownRevision = -1;
      this.render();
    });
    this.#bottom.type = "button";
    this.#bottom.hidden = true;
    this.#bottom.addEventListener("click", () => {
      this.#stickBottom = true;
      this.#history.scrollTop = this.#history.scrollHeight;
      this.#bottom.hidden = true;
    });
    const form = element("form", void 0, "chat-compose");
    this.#input.type = "text";
    this.#input.maxLength = CHAT_LIMIT;
    this.#input.placeholder = "Message the Cup\u2026";
    this.#input.setAttribute("aria-label", "Chat message");
    this.#input.autocomplete = "off";
    this.#input.addEventListener("input", () => {
      this.#sendButton.disabled = this.#sending || !this.#input.value.trim() || ui.c.chat.muted;
    });
    this.#sendButton.type = "submit";
    form.append(this.#input, this.#sendButton);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    this.#status.setAttribute("role", "status");
    const options = element("div", void 0, "chat-options"), label = element("label", "Hide message previews");
    this.#hidePreview.type = "checkbox";
    try {
      this.#hidePreview.checked = localStorage.getItem("pwc-hide-chat") === "true";
    } catch {
    }
    this.#hidePreview.addEventListener("change", () => {
      try {
        localStorage.setItem("pwc-hide-chat", String(this.#hidePreview.checked));
      } catch {
      }
      this.render();
    });
    label.prepend(this.#hidePreview);
    options.append(label);
    this.#personMenu.hidden = true;
    this.#personMenu.setAttribute("role", "group");
    this.#personMenu.setAttribute("aria-label", "Player chat controls");
    this.#panel.append(
      heading,
      this.#history,
      this.#personMenu,
      this.#bottom,
      form,
      this.#status,
      options
    );
    this.#root.append(this.#preview, this.#button, this.#panel);
    shadow.append(this.#root);
    this.#panel.hidden = true;
    this.#root.hidden = true;
    this.#panel.addEventListener("focusin", () => {
      ui.c.clearDrivingInput();
      if (this.#persistent) {
        this.#expanded = true;
        ui.c.setChatTyping(true);
      }
    });
    this.#panel.addEventListener("focusout", () => {
      queueMicrotask(() => {
        if (this.#persistent && !this.#panel.contains(shadow.activeElement)) {
          this.#expanded = false;
          ui.c.setChatTyping(false);
        }
      });
    });
    for (const type of ["keydown", "keyup", "keypress"])
      window.addEventListener(
        type,
        (event) => {
          if (!this.#expanded) return;
          if (!this.#panel.contains(shadow.activeElement)) this.#input.focus();
          event.stopImmediatePropagation();
          if (type === "keydown" && !event.isComposing) {
            if (event.code === "Tab") {
              if (this.#persistent) return;
              event.preventDefault();
              const focusable = [
                ...this.#panel.querySelectorAll(
                  'button:not(:disabled), input, summary, [tabindex="0"]'
                )
              ].filter((el) => !el.closest("[hidden]") && el.getClientRects().length);
              const index = focusable.indexOf(shadow.activeElement);
              focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
            } else if (event.code === "Escape") {
              event.preventDefault();
              if (this.#selectedSpeaker !== null) {
                this.#hidePersonMenu();
                this.#input.focus();
              } else this.close();
            } else if (event.code === "Enter" && shadow.activeElement === this.#input) {
              event.preventDefault();
              if (!event.repeat) void this.send();
            }
          }
        },
        { capture: true }
      );
    document.addEventListener(
      "pointerdown",
      (event) => {
        const path = event.composedPath();
        if (this.#expanded && !path.includes(this.#root)) this.close();
        else if (!path.includes(this.#personMenu) && !path.some((node) => node instanceof HTMLElement && node.classList.contains("chat-name")))
          this.#hidePersonMenu();
      },
      { capture: true }
    );
  }
  get unread() {
    return Math.max(0, this.#ui.c.chat.lines.length - this.#read);
  }
  get isOpen() {
    return this.#expanded;
  }
  mount(target, persistent = false) {
    this.#persistent = !!target && persistent;
    this.#root.classList.toggle("chat-docked", !!target);
    const parent = target ?? this.#shadow;
    if (this.#root.parentNode !== parent) parent.append(this.#root);
    this.#panel.querySelector(".chat-close").hidden = this.#persistent;
  }
  hotkey(event) {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isEditing(event) || !this.#ui.c.state || document.querySelector("dialog[open],.settings-menu-ui") || this.#shadow.querySelector("dialog[open]"))
      return;
    event.preventDefault();
    this.open();
  }
  open() {
    if (!this.#ui.c.state) return;
    this.#expanded = true;
    this.#read = this.#ui.c.chat.lines.length;
    this.#stickBottom = true;
    this.#shownRevision = -1;
    this.#ui.c.setChatTyping(true);
    this.render();
    this.#input.focus();
  }
  close() {
    this.#hidePersonMenu();
    this.#expanded = false;
    this.#ui.c.setChatTyping(false);
    this.#shadow.activeElement?.blur();
    this.render();
  }
  async send() {
    if (this.#sending || !this.#input.value.trim()) return;
    const text = this.#input.value, cupId = this.#ui.c.state?.id;
    this.#sending = true;
    this.#input.readOnly = true;
    this.#sendButton.disabled = true;
    this.#status.textContent = "Sending\u2026";
    try {
      await this.#ui.c.chat.post(text);
      if (cupId === this.#ui.c.state?.id) {
        if (this.#input.value === text) this.#input.value = "";
        this.#status.textContent = "";
        this.#stickBottom = true;
      }
    } catch (error) {
      if (cupId === this.#ui.c.state?.id)
        this.#status.textContent = error instanceof Error ? error.message : "Message not sent.";
    } finally {
      this.#sending = false;
      this.#input.readOnly = false;
      this.render();
    }
  }
  #line(line) {
    const row = element("div", void 0, "chat-line"), stamp = element(
      "time",
      new Date(line.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
    stamp.dateTime = new Date(line.at).toISOString();
    const speaker = this.#ui.c.chat.speakers.find((s) => s.id === line.speaker);
    const name = this.#ui.c.isHost && speaker?.canMute ? element("button", line.name, "chat-name") : element("strong", line.name, "chat-name");
    if (name instanceof HTMLButtonElement) {
      name.type = "button";
      name.dataset.speaker = String(line.speaker);
      name.setAttribute("aria-label", `Chat controls for ${line.name} (#${line.speaker})`);
      name.addEventListener("click", () => this.#showPersonMenu(line.speaker, name));
    }
    name.title = `Chat player #${line.speaker}`;
    name.style.color = colors[line.color];
    row.append(stamp, name, element("span", line.text, "chat-text"));
    return row;
  }
  render() {
    const c = this.#ui.c, state = c.state, chat = c.chat;
    this.#root.hidden = !state;
    if (!state) {
      this.#expanded = false;
      c.setChatTyping(false);
      return;
    }
    if (state.id !== this.#cupId) {
      this.#hidePersonMenu();
      this.#cupId = state.id;
      this.#known = 0;
      this.#read = 0;
      this.#limit = 60;
      this.#shownRevision = -1;
      this.#expanded = false;
      c.setChatTyping(false);
      this.#input.value = "";
      this.#status.textContent = "";
    }
    if (this.#expanded && !document.hidden && !this.#panel.contains(this.#shadow.activeElement))
      this.#input.focus();
    const lines = chat.cupId === state.id ? chat.lines : [];
    if (lines.length > this.#known) {
      this.#expires = Date.now() + 4e3;
      this.#known = lines.length;
    }
    if ((this.#expanded || this.#persistent) && this.#stickBottom) this.#read = lines.length;
    const unread = Math.max(0, lines.length - this.#read);
    const keys = c.game && !c.info?.disposed ? c.native.chatKeys?.(c.game) ?? [] : [];
    this.#button.textContent = `Chat${unread ? ` (${unread})` : ""}${keys.length ? ` \xB7 ${keys.join(" / ")}` : ""}`;
    this.#button.setAttribute("aria-expanded", String(this.#expanded));
    this.#root.classList.toggle("chat-open", this.#expanded || this.#persistent);
    this.#panel.hidden = !this.#expanded && !this.#persistent;
    this.#button.hidden = this.#expanded || this.#ui.panelOpen;
    this.#preview.hidden = this.#expanded || this.#ui.panelOpen || this.#hidePreview.checked || Date.now() > this.#expires;
    if (this.#shownRevision !== chat.revision) {
      const oldHeight = this.#history.scrollHeight, oldTop = this.#history.scrollTop;
      this.#shownRevision = chat.revision;
      this.#history.replaceChildren();
      this.#older.hidden = lines.length <= this.#limit;
      this.#history.append(this.#older);
      if (!lines.length) this.#history.append(element("p", "No messages yet. Say hello!", "chat-empty"));
      for (const line of lines.slice(-this.#limit)) this.#history.append(this.#line(line));
      this.#preview.replaceChildren(...lines.slice(-3).map((line) => this.#line(line)));
      this.#history.scrollTop = this.#stickBottom ? this.#history.scrollHeight : oldTop + (this.#prepend ? Math.max(0, this.#history.scrollHeight - oldHeight) : 0);
      this.#prepend = false;
    }
    this.#bottom.hidden = this.#stickBottom;
    this.#sendButton.disabled = this.#sending || chat.muted || !this.#input.value.trim();
    if (chat.muted) this.#status.textContent = "The organizer muted you for this Cup.";
    else if (this.#status.textContent === "The organizer muted you for this Cup.")
      this.#status.textContent = "";
  }
  #hidePersonMenu() {
    this.#selectedSpeaker = null;
    this.#personMenu.hidden = true;
  }
  #showPersonMenu(id, anchor) {
    const speaker = this.#ui.c.chat.speakers.find((s) => s.id === id);
    if (!this.#ui.c.isHost || !speaker?.canMute) return;
    if (this.#selectedSpeaker === id) {
      this.#hidePersonMenu();
      return;
    }
    if (!this.#expanded) {
      this.open();
      anchor = this.#history.querySelector(`[data-speaker="${id}"]`) ?? this.#history;
    }
    this.#selectedSpeaker = id;
    const name = element("strong", `${speaker.name} \xB7 #${speaker.id}`);
    name.style.color = colors[speaker.color];
    const button = element("button", speaker.muted ? "Unmute" : "Mute for this Cup", "quiet");
    button.type = "button";
    button.setAttribute(
      "aria-label",
      `${speaker.muted ? "Unmute" : "Mute"} ${speaker.name} (#${speaker.id})`
    );
    button.addEventListener("click", () => {
      this.#ui.c.chat.mute(id, !speaker.muted);
      this.#hidePersonMenu();
      this.#input.focus();
    });
    this.#personMenu.replaceChildren(name, button);
    this.#personMenu.hidden = false;
    const panel = this.#panel.getBoundingClientRect(), rect = anchor.getBoundingClientRect();
    this.#personMenu.style.top = `${Math.max(42, Math.min(rect.bottom - panel.top + 4, panel.height - this.#personMenu.offsetHeight - 12))}px`;
    button.focus();
  }
};

// src/preset-ui.ts
var PresetEditor = class {
  #ui;
  #library = new PresetLibrary();
  #draft = standardPreset();
  #cupId = "";
  #base = "";
  #renaming = false;
  #renameValue = "";
  #applyTimer;
  #panel;
  constructor(ui) {
    this.#ui = ui;
  }
  get dirty() {
    return presetKey(this.#draft) !== this.#base;
  }
  render() {
    const ui = this.#ui, c = ui.c, state = c.cup;
    const current = state.preset ?? {
      ...standardPreset(),
      name: "Imported rules",
      rules: rulesFor(state)
    };
    if (this.#cupId !== state.id) {
      this.#renaming = false;
      clearTimeout(this.#applyTimer);
    }
    if (this.#cupId !== state.id || !this.dirty) {
      this.#cupId = state.id;
      this.#draft = structuredClone(current);
      this.#base = presetKey(current);
    }
    const editable = c.isHost && rosterOpen(state), box = element("section", void 0, "preset-panel");
    this.#panel = box;
    box.setAttribute("aria-label", "Cup preset");
    const heading = element("div", void 0, "preset-heading");
    heading.append(element("h2", editable ? "Cup preset" : current.name));
    if (!editable) {
      const details = element("section", void 0, "preset-details");
      details.append(element("h3", `${current.name} \xB7 Cup rules`));
      details.append(presetSummary(rulesFor(state)));
      box.append(details);
      if (!rulesFor(state).finalist)
        details.append(element("p", "A tied lead at the target continues into another round.", "muted"));
      const footer = element("div", void 0, "preset-tools");
      details.append(ui.button("Export preset", () => this.download(current), "quiet"));
      if (c.isHost && state.phase === "registration")
        footer.append(
          ui.button(
            "Reopen setup",
            () => {
              if (confirm("Reopen setup and clear all bans and picks?")) c.reopenRoster();
            },
            "quiet"
          )
        );
      if (footer.childElementCount) box.append(footer);
      return box;
    }
    const r = this.#draft.rules;
    const select = element("select");
    select.setAttribute("aria-label", "Choose a preset");
    const presets = [standardPreset(), quickplayPreset(), ...this.#library.list()];
    const selected = presets.findIndex((p) => presetKey(p) === presetKey(this.#draft));
    {
      const option = element("option", selected < 0 ? this.#draft.name || "Custom" : "Custom");
      option.hidden = selected >= 0;
      option.value = "custom";
      option.disabled = true;
      option.selected = selected < 0;
      select.append(option);
    }
    presets.forEach((preset, i) => {
      const option = element("option", preset.name);
      option.value = String(i);
      option.selected = i === selected;
      select.append(option);
    });
    select.addEventListener("change", () => {
      if (select.value === "custom") return;
      this.#renaming = false;
      this.#draft = structuredClone(presets[Number(select.value)]);
      this.applyDraft();
    });
    const chooser = element("div", void 0, "preset-chooser");
    const nameControl = element("div", void 0, "preset-name-control");
    if (this.#renaming) {
      const name = element("input");
      name.value = this.#renameValue;
      name.maxLength = 64;
      name.setAttribute("aria-label", "Preset name");
      name.dataset.presetField = "name";
      name.addEventListener("input", () => {
        this.#renameValue = name.value;
      });
      nameControl.append(name);
    } else nameControl.append(select);
    chooser.append(nameControl);
    heading.append(chooser);
    box.append(heading);
    box.append(this.editableRules(r));
    const file = element("input");
    file.type = "file";
    file.accept = ".json,application/json";
    file.hidden = true;
    file.addEventListener("change", async () => {
      try {
        const selected2 = file.files?.[0];
        if (!selected2) return;
        if (selected2.size > 32e3) throw new Error("Preset files must be smaller than 32 KB.");
        const preset = parsePreset(await selected2.text());
        if (c.state !== state || !rosterOpen(state))
          throw new Error("The Cup changed. Import the preset again during setup.");
        this.#draft = preset;
        this.applyDraft();
      } catch (error) {
        c.fail(error);
      }
    });
    const icon = (kind, label, action) => {
      const button = ui.button(label, action, "quiet preset-icon");
      button.replaceChildren(presetIcon(kind));
      button.setAttribute("aria-label", label);
      button.title = label;
      return button;
    };
    const rename = icon(
      this.#renaming ? "check" : "edit",
      this.#renaming ? "Apply preset name" : "Rename preset",
      () => this.#renaming ? this.finishRename() : this.beginRename()
    );
    const save = icon("save", "Save preset", () => {
      if (this.#renaming) this.finishRename();
      if (["standard", "quickplay", "custom", ""].includes(this.#draft.name.trim().toLowerCase())) {
        this.beginRename();
        ui.showNotice("Name your preset, then save it.", 3500);
        const input = this.#panel?.querySelector('[data-preset-field="name"]');
        input?.focus();
        input?.select();
        return;
      }
      this.#draft.name = this.#draft.name.trim();
      this.#library.save(this.#draft);
      this.applyDraft();
      ui.showNotice(`Saved ${this.#draft.name}`, 2500);
    });
    const remove = icon("delete", "Delete saved preset", () => {
      if (!this.#library.list().some((p) => p.name === this.#draft.name)) return;
      this.#library.remove(this.#draft.name);
      this.#draft = standardPreset();
      this.applyDraft();
      ui.showNotice("Preset deleted. Standard rules applied.", 3e3);
    });
    remove.dataset.deletePreset = "";
    remove.disabled = !this.#library.list().some((p) => p.name === this.#draft.name);
    const exportButton = icon("export", "Export preset", () => this.download(this.#draft));
    save.dataset.validPreset = "";
    exportButton.dataset.validPreset = "";
    save.disabled = exportButton.disabled = !validPreset(this.#draft);
    chooser.append(
      rename,
      save,
      icon("import", "Import preset", () => file.click()),
      exportButton,
      remove,
      file
    );
    const status = element(
      "p",
      this.dirty ? validPreset(this.#draft) ? "Updating rules\u2026" : "Check the fields: select a valid pool, use the allowed ranges, and keep points in descending order." : "",
      "preset-status"
    );
    status.hidden = !this.dirty;
    status.setAttribute("role", "status");
    box.append(status);
    return box;
  }
  editableRules(r) {
    const overview = element("div", void 0, "preset-overview preset-editable");
    const group = (title) => {
      const section = element("section", void 0, "rule-group");
      section.setAttribute("aria-label", `${title} rules`);
      section.append(element("h3", title));
      return section;
    };
    const field = (section, label, input, hint) => {
      const row = element("label", void 0, "rule-edit");
      row.append(element("strong", `${label}:`), input);
      input.setAttribute("aria-label", label);
      if (hint) row.title = hint;
      section.append(row);
    };
    const checkbox = (key) => {
      const input = element("input");
      input.type = "checkbox";
      input.checked = key === "allowSpectatorFreecam" ? r[key] !== false : r[key] === true;
      input.dataset.presetField = key;
      input.addEventListener("change", () => {
        r[key] = input.checked;
        this.changed();
      });
      return input;
    };
    const race = group("Race");
    field(race, "Rounds per track", this.number("roundsPerTrack", 1, 30));
    field(
      race,
      r.finalist ? "Finalist target" : "Points to win",
      this.number("pointsToWin", 1, 1e4)
    );
    field(
      race,
      "Finalist",
      checkbox("finalist"),
      "Reach the target, then win a later round to win the Cup."
    );
    race.append(
      element(
        "p",
        r.finalist ? "Reach the target, then win a round." : "Lead at the point target to win. Tied leaders race on.",
        "rule-help"
      )
    );
    field(
      race,
      "Leaderboard uploads",
      checkbox("uploadLeaderboardTimes"),
      "Enabled: Casual mode, with native leaderboard uploads. Disabled: Competitive mode, with session-only times."
    );
    const tracks = group("Tracks");
    field(
      tracks,
      "Selection",
      this.select(
        [
          ["draft", "Racer draft"],
          ["random", "Random rotation"]
        ],
        r.selection,
        (value) => {
          r.selection = value;
          r.bansPerRacer = value === "random" ? 0 : 1;
          r.picksPerRacer = value === "random" ? 0 : 1;
        }
      )
    );
    for (const [category, label] of [
      ["official", "Main"],
      ["community", "Community"],
      ["custom", "Custom"]
    ]) {
      const input = element("input");
      input.type = "checkbox";
      input.checked = r.pool.includes(category);
      input.dataset.trackCategory = category;
      input.disabled = category === "custom" && r.bansPerRacer > 0;
      input.setAttribute("aria-label", `${label} tracks`);
      let hint;
      if (category === "custom")
        hint = r.bansPerRacer > 0 ? "Set bans per racer to 0 to allow custom tracks." : r.selection === "random" ? "Include the organizer\u2019s saved custom tracks." : "Allow saved custom tracks and track share codes during picks.";
      input.addEventListener("change", () => {
        r.pool = input.checked ? [...r.pool, category] : r.pool.filter((c) => c !== category);
        this.changed();
      });
      field(tracks, `${label} tracks`, input, hint);
    }
    if (r.selection === "draft") {
      field(tracks, "Bans per racer", this.number("bansPerRacer", 0, 3));
      field(tracks, "Picks per racer", this.number("picksPerRacer", 1, 3));
    }
    const banHint = element("small", "Custom tracks require zero bans.", "custom-ban-hint rule-help");
    banHint.hidden = r.bansPerRacer === 0;
    tracks.append(banHint);
    const timing = group("Timing");
    field(
      timing,
      "Warmup",
      this.select(
        [
          ["off", "Disabled"],
          ["first-visit", "First visit"],
          ["every-visit", "Every visit"]
        ],
        r.warmup,
        (value) => {
          r.warmup = value;
        }
      )
    );
    if (r.warmup !== "off") {
      field(
        timing,
        "Duration",
        this.select(
          [
            ["wr", "Based on WR"],
            ["fixed", "Fixed time"]
          ],
          r.warmupTiming,
          (value) => {
            r.warmupTiming = value;
          }
        )
      );
      if (r.warmupTiming === "wr") {
        field(timing, "WR multiplier", this.number("warmupMultiplier", 0.5, 5, 0.1));
        field(timing, "Minimum (s)", this.number("warmupMinimumSeconds", 10, 300));
      }
      field(
        timing,
        r.warmupTiming === "fixed" ? "Duration (s)" : "Without a WR (s)",
        this.number("warmupSeconds", 10, 600)
      );
      field(timing, "All ready ends warmup", checkbox("readyEndsWarmup"));
    }
    field(
      timing,
      "Finish window (s)",
      this.number("finishTimeoutSeconds", 5, 120),
      "Time for the remaining racers to finish after the leader."
    );
    field(
      timing,
      "Round break (s)",
      this.number("roundBreakSeconds", 3, 60),
      "Pause between scored rounds."
    );
    const racers = group("Racers");
    field(racers, "Mid-Cup joining / leaving", checkbox("allowRacerChanges"));
    if (r.allowRacerChanges)
      racers.append(
        element("p", "New racers: 0 points, next round. Returning racers keep their score.", "rule-help")
      );
    field(
      racers,
      "Spectator free camera",
      checkbox("allowSpectatorFreecam"),
      "Let spectators explore the track. Disable for puzzle or discovery maps."
    );
    const pair = (left, right) => {
      const row = element("div", void 0, "rule-pair");
      const groups2 = [left, right];
      const fieldCount = Math.max(
        ...groups2.map((group2) => group2.querySelectorAll(":scope > .rule-edit").length)
      );
      for (const group2 of groups2) {
        group2.style.gridRow = `span ${fieldCount + 2}`;
        const fields = group2.querySelectorAll(":scope > .rule-edit");
        fields.forEach((field2, i) => {
          field2.style.gridRow = String(i + 2);
        });
        for (const note2 of group2.querySelectorAll(":scope > .rule-help"))
          note2.style.gridRow = String(fieldCount + 2);
        row.append(group2);
      }
      overview.append(row);
    };
    pair(race, tracks);
    pair(timing, racers);
    const scoring = element("fieldset", void 0, "preset-scoring rule-points-editor");
    scoring.append(element("legend", "Points by finishing position"));
    r.points.forEach((points, i) => {
      const place = `${i + 1}${["st", "nd", "rd"][i] ?? "th"}`, row = element("label", place), input = element("input");
      input.type = "number";
      input.min = "0";
      input.max = "1000";
      input.step = "1";
      input.value = String(points);
      input.setAttribute("aria-label", `Points for ${place}`);
      input.dataset.presetField = `points-${i}`;
      input.addEventListener("input", () => {
        r.points[i] = input.valueAsNumber;
        this.changed(false);
      });
      row.append(input);
      scoring.append(row);
    });
    overview.append(scoring);
    return overview;
  }
  nameKey(event) {
    if (!this.#renaming || event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.finishRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.#renaming = false;
      this.#ui.redraw();
    }
  }
  beginRename() {
    this.#renameValue = this.#draft.name;
    this.#renaming = true;
    this.#ui.redraw();
    const input = this.#panel?.querySelector('[data-preset-field="name"]');
    input?.focus();
    input?.select();
  }
  finishRename() {
    this.#draft.name = this.#renameValue.trim() || "Custom";
    this.#renaming = false;
    this.applyDraft();
  }
  sync() {
    const panel = this.#panel;
    if (!panel) return;
    const valid = validPreset(this.#draft);
    for (const input of panel.querySelectorAll("[data-track-category]")) {
      input.checked = this.#draft.rules.pool.some(
        (category) => category === input.dataset.trackCategory
      );
      input.disabled = input.dataset.trackCategory === "custom" && this.#draft.rules.bansPerRacer > 0;
    }
    const banHint = panel.querySelector(".custom-ban-hint");
    if (banHint) banHint.hidden = this.#draft.rules.bansPerRacer === 0;
    for (const input of panel.querySelectorAll("input[type=number]"))
      input.setAttribute("aria-invalid", String(!input.validity.valid || input.value === ""));
    for (const button of panel.querySelectorAll("[data-valid-preset]"))
      button.disabled = !valid;
    const remove = panel.querySelector("[data-delete-preset]");
    if (remove) remove.disabled = !this.#library.list().some((p) => p.name === this.#draft.name);
    const status = panel.querySelector(".preset-status");
    if (status) {
      status.textContent = this.dirty ? valid ? "Updating rules\u2026" : "Check the fields: select a valid pool, use the allowed ranges, and keep points in descending order." : `${this.#draft.name} rules applied.`;
      status.hidden = !this.dirty;
    }
    const select = panel.querySelector('select[aria-label="Choose a preset"]');
    if (select && this.dirty) {
      select.value = "custom";
      select.options[0].textContent = this.#draft.name || "Custom";
      select.options[0].hidden = false;
    }
    const start = panel.getRootNode().querySelector(
      "[data-setup-start]"
    );
    if (start) {
      start.disabled = this.#ui.c.cup.roster.length < 2 || this.dirty || !!this.#ui.c.startingCup;
      const note2 = panel.getRootNode().querySelector(
        ".setup-start-note"
      );
      if (note2) {
        note2.textContent = this.#ui.c.cup.roster.length < 2 ? "At least two racers are needed." : this.dirty ? "Finish editing the rules to continue." : "";
        note2.hidden = !note2.textContent;
      }
    }
  }
  applyDraft() {
    clearTimeout(this.#applyTimer);
    if (!validPreset(this.#draft)) return;
    try {
      this.#ui.c.setPreset(this.#draft);
      this.#base = presetKey(this.#draft);
      this.#ui.redraw();
    } catch (error) {
      this.#ui.c.fail(error);
    }
  }
  scheduleApply() {
    clearTimeout(this.#applyTimer);
    if (!validPreset(this.#draft)) return;
    const cupId = this.#cupId;
    this.#applyTimer = setTimeout(() => {
      if (this.#ui.c.state?.id === cupId && rosterOpen(this.#ui.c.state)) this.applyDraft();
    }, 300);
  }
  changed(redraw = true) {
    clearTimeout(this.#applyTimer);
    this.#draft.name = "Custom";
    if (this.#draft.rules.bansPerRacer > 0) {
      this.#draft.rules.pool = this.#draft.rules.pool.filter((category) => category !== "custom");
      if (!this.#draft.rules.pool.length) this.#draft.rules.pool = ["official", "community"];
    }
    const name = this.#panel?.querySelector('[data-preset-field="name"]');
    if (name) name.value = "Custom";
    if (redraw && validPreset(this.#draft)) this.applyDraft();
    else {
      if (redraw) this.#ui.redraw();
      else this.sync();
      this.scheduleApply();
    }
  }
  number(key, min, max, step = 1) {
    const input = element("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.#draft.rules[key]);
    input.title = `${min}\u2013${max}`;
    input.dataset.presetField = key;
    input.addEventListener("input", () => {
      Object.assign(this.#draft.rules, { [key]: input.valueAsNumber });
      this.changed(false);
    });
    return input;
  }
  select(options, value, change) {
    const select = element("select");
    for (const [v, label] of options) {
      const option = element("option", label);
      option.value = v;
      option.selected = v === value;
      select.append(option);
    }
    select.addEventListener("change", () => {
      change(select.value);
      this.changed();
    });
    return select;
  }
  download(preset) {
    const url = URL.createObjectURL(new Blob([presetText(preset)], { type: "application/json" }));
    const a = element("a");
    a.href = url;
    a.download = `${preset.name.replace(/[^a-z0-9-]/gi, "-")}.polycup-preset.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
};
function presetIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute(
    "d",
    {
      edit: "M4 16l-1 5 5-1L21 7l-5-5z M13 5l6 6",
      check: "M4 12l5 5L20 6",
      delete: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
      save: "M4 3h13l3 3v15H4z M7 3v6h9V3 M7 21v-8h10v8",
      import: "M4 15v6h16v-6 M12 16V3 M7 8l5-5 5 5",
      export: "M4 15v6h16v-6 M12 3v13 M7 11l5 5 5-5"
    }[kind]
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

// src/invite.ts
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
  get input() {
    return this.#input;
  }
  get element() {
    return this.#element;
  }
  #element;
  #input;
  #button;
  #icon;
  #text;
  #status;
  #connection = null;
  #requested = false;
  #requestFailed = false;
  #feedback = "";
  #feedbackUntil = 0;
  #lastCode;
  #copying = null;
  constructor() {
    this.#element = document.createElement("div");
    this.#element.className = "lobby-invite";
    const label = document.createElement("label");
    label.className = "invite-label";
    label.textContent = "Lobby code";
    this.#input = document.createElement("input");
    this.#input.type = "text";
    this.#input.readOnly = true;
    this.#input.setAttribute("aria-label", "Lobby invite code");
    this.#input.spellcheck = false;
    this.#input.addEventListener("click", () => this.#input.select());
    label.append(this.#input);
    this.#button = document.createElement("button");
    this.#button.type = "button";
    this.#button.className = "quiet invite-copy";
    this.#icon = document.createElement("img");
    this.#icon.alt = "";
    this.#icon.draggable = false;
    this.#text = document.createElement("span");
    this.#text.setAttribute("aria-live", "polite");
    this.#button.append(this.#icon, this.#text);
    this.#button.addEventListener("click", () => this.act());
    const row = document.createElement("div");
    row.className = "invite-actions";
    row.append(label, this.#button);
    this.#status = document.createElement("small");
    this.#status.className = "invite-status";
    this.#status.setAttribute("role", "status");
    this.#status.setAttribute("aria-live", "polite");
    this.#element.append(row, this.#status);
  }
  update(connection, open) {
    if (connection !== this.#connection) {
      this.#connection = connection;
      this.#requested = false;
      this.#requestFailed = false;
      this.#feedback = "";
      this.#feedbackUntil = 0;
      this.#lastCode = null;
    }
    let state = inviteState(connection);
    if (open && !this.#requested && state.status !== "hidden") {
      this.#requested = true;
      if (["empty", "expired"].includes(state.status)) {
        this.renew();
        state = inviteState(connection);
      }
    }
    if (state.status === "loading") this.#requested = true;
    if (this.#requestFailed && state.status === "empty") state = { status: "error" };
    if (state.code !== this.#lastCode) {
      this.#feedback = "";
      this.#lastCode = state.code;
    }
    this.#element.hidden = state.status === "hidden";
    const ready = state.status === "ready";
    const value = state.status === "ready" ? state.code : "";
    if (this.#input.value !== value) this.#input.value = value;
    this.#input.placeholder = state.status === "loading" ? "Creating\u2026" : state.status === "expired" ? "Expired" : "Unavailable";
    this.#input.disabled = !ready;
    this.#button.disabled = ["hidden", "loading"].includes(state.status) || this.#copying === connection;
    const feedback = ready && this.#feedbackUntil > Date.now() ? this.#feedback : "";
    this.#text.textContent = this.#copying === connection && connection ? "Copying\u2026" : feedback === "copied" ? "Copied!" : ready ? "Copy" : state.status === "expired" ? "Renew" : state.status === "loading" ? "Creating\u2026" : "Retry";
    this.#button.setAttribute(
      "aria-label",
      ready ? "Copy lobby invite code" : state.status === "expired" ? "Renew lobby invite code" : "Create lobby invite code"
    );
    const icon = ready || state.status === "loading" ? "copy" : "refresh";
    const src = new URL(`images/${icon}.svg`, document.baseURI).href;
    if (this.#icon.src !== src) this.#icon.src = src;
    const message = feedback === "manual" ? "Select code and press Ctrl+C" : state.status === "ready" && state.expires !== Infinity ? `Expires in ${Math.max(1, Math.ceil((state.expires - Date.now()) / 6e4))} min` : "";
    if (this.#status.textContent !== message) this.#status.textContent = message;
  }
  renew() {
    this.#requested = true;
    this.#requestFailed = false;
    try {
      this.#connection.renewInvite();
    } catch {
      this.#requestFailed = true;
    }
  }
  async act() {
    const connection = this.#connection, state = inviteState(connection);
    if (state.status === "hidden" || state.status === "loading" || this.#copying === connection)
      return;
    if (state.status !== "ready") {
      this.renew();
      this.update(connection, false);
      return;
    }
    this.#copying = connection;
    this.update(connection, false);
    let copied = false;
    try {
      await navigator.clipboard.writeText(state.code);
      copied = true;
    } catch {
      if (this.#connection === connection && inviteState(connection).code === state.code) {
        this.#input.focus();
        this.#input.select();
        try {
          copied = document.execCommand("copy");
        } catch {
        }
      }
    } finally {
      if (this.#copying === connection) this.#copying = null;
    }
    if (this.#connection !== connection || inviteState(connection).code !== state.code) return;
    this.#feedback = copied ? "copied" : "manual";
    this.#feedbackUntil = Date.now() + (copied ? 2e3 : 8e3);
    this.update(connection, false);
  }
};

// src/lobby.ts
function countryFlag(code) {
  return typeof code === "string" && /^[a-z]{2}$/i.test(code) ? "images/countries/" + code.toLowerCase() + ".svg" : null;
}
function lobbyView(s, selfId, editing = false) {
  const stage = s.draft?.stage ?? "picks", joined = s.roster.some((p) => p.id === selfId);
  const turn = banTurn(s), pick = s.tracks.find((t) => t.id === s.picks[selfId]);
  const mode = stage === "roster" ? "join" : stage === "bans" ? "ban" : !joined ? "spectator" : pick && picksComplete(s, selfId) && !editing ? "selected" : "pick";
  return {
    stage,
    joined,
    turn,
    pick,
    mode,
    ready: s.roster.filter((p) => picksComplete(s, p.id)).length,
    title: mode === "join" ? joined ? "You\u2019re on the grid" : "Join the race" : mode === "ban" ? turn === selfId ? "Your ban" : `${s.roster.find((p) => p.id === turn)?.name ?? "Racer"}\u2019s ban` : mode === "selected" ? rulesFor(s).picksPerRacer > 1 ? "Your picks are ready" : "Your pick is ready" : mode === "pick" ? "Choose your track" : "Racers are picking"
  };
}
function lobbyPanel(ui) {
  const c = ui.c, s = c.state, view = lobbyView(s, c.selfId, ui.editingPick);
  const shell = element("section", void 0, "cup-lobby"), roster = element("aside", void 0, "lobby-roster"), action = element("section", void 0, "lobby-action");
  shell.classList.toggle("drafting", view.mode !== "join");
  roster.setAttribute("aria-label", "Racer roster");
  action.setAttribute("aria-label", "Current lobby action");
  const preset = ui.presetPanel(), rules = rulesFor(s);
  const heading = element("div", void 0, "lobby-roster-heading");
  heading.append(element("h2", `Racers \xB7 ${s.roster.length}/8`));
  roster.append(heading);
  const order = s.draft?.order.length ? s.draft.order : s.roster.map((p) => p.id);
  if (!order.length) roster.append(element("p", "No racers yet.", "muted"));
  for (const id of order) {
    const row = element(
      "div",
      void 0,
      `lobby-racer${view.turn === id ? " current-turn" : ""}${id === c.selfId ? " you" : ""}`
    );
    const identity = ui.racerName(id, ui.name(id), true, true);
    const car = identity.querySelector(".car-skin");
    const actions = identity.querySelector(".player-actions-toggle");
    if (actions) row.append(actions);
    if (car) row.append(car);
    row.append(identity, ui.playerTools(id));
    if (!c.lobby.some((p) => p.id === id) || c.needsRebind?.has(id))
      row.append(element("small", "Disconnected", "ban-label"));
    const bans = banEntries(s).filter((b) => b.racerId === id), picks = s.tracks.filter((t) => chosenTracks(s, id).includes(t.id));
    const choices = element("div", void 0, "lobby-choices");
    if (s.draft && rules.bansPerRacer && view.stage !== "roster") {
      for (const ban of bans) choices.append(element("span", `\xD7 ${ban.track.name}`, "draft-ban"));
      if (view.turn === id) choices.append(element("span", "Banning\u2026", "draft-ban"));
    }
    if (view.stage === "picks") {
      for (const pick of picks) choices.append(element("span", `\u2713 ${pick.name}`, "draft-pick"));
      if (!picksComplete(s, id))
        choices.append(element("span", `${picks.length}/${rules.picksPerRacer} picks`, "muted"));
    }
    row.append(choices);
    roster.append(row);
  }
  if (view.mode === "join") {
    const join = ui.button(view.joined ? "Joined" : "Join", () => c.action("join"), "primary");
    join.disabled = view.joined || s.roster.length >= 8;
    roster.append(join);
  }
  const spectators = c.lobby.filter((p) => !s.roster.some((r) => r.id === p.id));
  const more = element("section", void 0, "lobby-spectators");
  more.append(element("h2", `Spectators \xB7 ${spectators.length}`));
  if (!spectators.length) more.append(element("p", "No spectators.", "muted"));
  for (const p of spectators) {
    const row = element("div", void 0, `lobby-racer${p.id === c.selfId ? " you" : ""}`);
    const identity = ui.racerName(p.id, p.nickname, true, true), car = identity.querySelector(".car-skin");
    const actions = identity.querySelector(".player-actions-toggle");
    if (actions) row.append(actions);
    if (car) row.append(car);
    row.append(identity, ui.playerTools(p.id));
    more.append(row);
  }
  if (view.mode === "join") {
    const spectate = ui.button(
      view.joined ? "Spectate" : "Spectating",
      () => c.action("leave"),
      "primary"
    );
    spectate.disabled = !view.joined;
    more.append(spectate);
  }
  roster.append(more);
  const actionTitle = element("h2", view.title);
  if (view.mode === "ban" && view.turn !== c.selfId && view.turn !== null) {
    actionTitle.replaceChildren(ui.playerLabel(view.turn, ui.name(view.turn), true), "\u2019s ban");
  }
  if (view.mode !== "join") {
    const progress = element("ol", void 0, "draft-progress");
    progress.setAttribute("aria-label", "Cup setup progress");
    for (const [stage, label] of [
      ["roster", "Racers"],
      ...rules.bansPerRacer ? [["bans", "Bans"]] : [],
      ["picks", "Picks"]
    ]) {
      const item = element("li", label);
      if (stage === view.stage) item.setAttribute("aria-current", "step");
      progress.append(item);
    }
    action.append(progress, actionTitle);
  }
  if (!s.draft && !view.joined) action.append(ui.joinControls());
  if (view.mode === "join") {
    if (c.isHost) {
      const begin = ui.button(
        rules.selection === "random" ? c.startingCup ? "Preparing tracks\u2026" : "Start Cup" : rules.bansPerRacer ? "Begin bans" : "Begin picks",
        () => rules.selection === "random" ? c.startCup() : c.beginBans(),
        "primary"
      );
      begin.disabled = s.roster.length < 2 || ui.presetDirty || !!c.startingCup;
      begin.dataset.setupStart = "";
      begin.title = s.roster.length < 2 ? "At least two racers are needed." : ui.presetDirty ? "Finish editing the rules to continue." : "";
      ui.setLobbyStart(begin);
    } else
      roster.append(
        element(
          "p",
          `Waiting for the organizer to ${rules.selection === "random" ? "start the Cup" : rules.bansPerRacer ? "begin bans" : "begin picks"}.`,
          "muted"
        )
      );
  } else if (view.mode === "selected") {
    for (const picked of s.tracks.filter((t) => chosenTracks(s, c.selfId).includes(t.id))) {
      const card = element("div", void 0, "selected-track");
      card.append(element("strong", picked.name));
      try {
        const entry = c.availableTracks().find((t) => t.id === picked.id);
        if (entry) {
          const image = element("img");
          image.alt = "";
          Promise.resolve(entry.thumbnail).then((src) => {
            if (src && image.isConnected) image.src = src;
          }).catch(() => {
          });
          card.prepend(image);
        }
      } catch {
      }
      action.append(card);
    }
    action.append(
      ui.button(
        rules.picksPerRacer > 1 ? "Edit picks" : "Change pick",
        () => ui.editPick(true),
        "quiet"
      )
    );
    if (!c.isHost)
      action.append(
        element("p", "You\u2019re ready. The organizer starts the Cup once everyone has picked.", "muted")
      );
    action.append(element("p", `${view.ready}/${s.roster.length} racers have picked`, "muted"));
  } else if (view.mode === "ban" || view.mode === "pick") {
    if (view.mode === "ban")
      action.append(
        element(
          "p",
          `Ban ${banEntries(s).length + 1}/${s.roster.length * rules.bansPerRacer}`,
          "lobby-turn-count"
        )
      );
    if (view.pick && picksComplete(s, c.selfId))
      action.append(
        ui.button(
          rules.picksPerRacer > 1 ? "Done editing" : "Keep current pick",
          () => {
            ui.editPick(false);
          },
          "quiet"
        )
      );
    if (view.mode === "pick" && rules.picksPerRacer > 1) {
      for (const track of s.tracks.filter((t) => chosenTracks(s, c.selfId).includes(t.id))) {
        const row = element("div", void 0, "row");
        row.append(
          element("span", `\u2713 ${track.name}`, "grow"),
          ui.button(
            "Remove",
            () => c.action("remove-pick", track.id),
            "quiet",
            `remove-pick:${track.id}`
          )
        );
        action.append(row);
      }
      action.append(
        element("p", `${chosenTracks(s, c.selfId).length}/${rules.picksPerRacer} picks`, "muted")
      );
    }
    ui.renderTrackChoices(action);
  } else action.append(element("p", `${view.ready}/${s.roster.length} racers have picked`, "muted"));
  if (c.isHost && view.stage === "picks") {
    const start = ui.button(
      c.startingCup ? "Preparing tracks\u2026" : "Start Cup",
      () => c.startCup(),
      "primary lobby-start"
    );
    start.disabled = !!c.startingCup || s.roster.length < 2 || view.ready !== s.roster.length || ui.presetDirty;
    start.title = s.roster.length < 2 ? "At least two racers are needed." : view.ready !== s.roster.length ? `Waiting for ${s.roster.length - view.ready} racer(s) to pick.` : ui.presetDirty ? "Finish editing the rules to continue." : "";
    ui.setLobbyStart(start);
  }
  if (view.mode === "join") preset.classList.add("preset-at-top");
  action.append(preset);
  const people = element("div", void 0, "lobby-column");
  people.append(roster, element("div", void 0, "lobby-chat-slot"));
  shell.append(people, action);
  return shell;
}

// src/restart-hint.ts
var RestartHint = class {
  #changed = /* @__PURE__ */ new Map();
  constructor() {
  }
  update(root, retiring) {
    const original = " to start over.", replacement = " to retire from this round.";
    for (const [node, text] of this.#changed) {
      if (!retiring || !root?.contains(node)) {
        if (node.textContent === replacement) node.textContent = text;
        this.#changed.delete(node);
      }
    }
    if (!retiring) return;
    for (const line of root?.querySelectorAll(".hint-ui .title, .hint-ui .subtitle") ?? []) {
      for (const node of line.childNodes)
        if (node.nodeType === 3 && node.textContent === original) {
          this.#changed.set(node, original);
          node.textContent = replacement;
        }
    }
  }
};

// src/results.ts
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
  const images = await Promise.all(
    rows.map(async (r) => {
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
    })
  );
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
      const w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, 118 + (90 - w) / 2, y + 4 + (60 - h) / 2, w, h);
    }
    text(r.name, 225, y + 44, 32, ink, "left", 610);
    if (r.winner) text("WINNER", 840, y + 44, 25, ink);
    shape(992, y + 8, 146, 52, "#e9f1f8", 10);
    text(r.score, 1065, y + 43, 32, "#192042", "center");
  });
  const maps = state.tracks.map((t) => t.name).join(" / ");
  text(maps, 52, canvas.height - 28, 24, "#b3c7df", "left", 1090);
  return new Promise(
    (resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not save the results image.")),
      "image/png"
    )
  );
}

// src/time.ts
function formatTime(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "\u2014";
  const ms = Math.floor(frames);
  return `${Math.floor(ms / 6e4)}:${String(Math.floor(ms / 1e3) % 60).padStart(2, "0")}.${String(ms % 1e3).padStart(3, "0")}`;
}
function formatGap(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "\u2014";
  return `+${frames < 6e4 ? (Math.floor(frames) / 1e3).toFixed(3) : formatTime(frames)}`;
}

// src/review-ui.ts
function reviewPanel(ui) {
  const c = ui.c, log = c.review, box = element("section", void 0, "review-panel");
  box.append(
    element("h2", "Run review"),
    element(
      "p",
      "Inputs are client-reported. Flags prompt a review; they never apply penalties.",
      "review-disclaimer"
    )
  );
  const flags = log.runs.filter((r) => r.flag), controls = element("div", void 0, "controls");
  const pending = flags.filter((r) => !r.reviewed).length;
  controls.append(element("strong", pending ? `${pending} to review` : "No flags to review"));
  box.append(controls);
  const records = [...log.runs].reverse().sort((a, b) => Number(!!b.flag && !b.reviewed) - Number(!!a.flag && !a.reviewed));
  if (!records.length) box.append(element("p", "No scored runs yet.", "muted"));
  for (const r of records) {
    const detail = element("section", void 0, `review-run${r.flag ? " flagged" : " review-compact"}`);
    const summary = element("div", void 0, "review-heading"), title = element("span", void 0, "review-title");
    title.append(
      ui.playerLabel(
        Number(Object.entries(log.data().identities).find(([, key]) => key === r.racerKey)?.[0]),
        r.name
      ),
      element(
        "span",
        `Round ${r.round} \xB7 ${c.cup.tracks.find((t) => t.id === r.trackId)?.name ?? "Track"}`,
        "muted"
      )
    );
    summary.append(
      title,
      element(
        "span",
        r.finish ? formatTime(r.finish) : r.outcome === "pending" ? "In progress" : r.outcome.toUpperCase()
      ),
      element(
        "span",
        r.flag ? r.reviewed ? "Reviewed" : "Review" : evidenceStatus(r),
        r.flag ? "review-tag" : "muted"
      )
    );
    detail.append(summary);
    if (r.flag) {
      const prior = log.runs.find((p) => p.id === r.flag.otherId);
      detail.append(
        element(
          "p",
          r.flag.kind === "inputs" ? `${r.flag.transitions} control changes match round ${prior?.round ?? "\u2014"} within ${r.flag.maxDelta} ms.` : `${r.flag.repeats} runs share every checkpoint time and finish. Input evidence is incomplete or differs.`
        )
      );
      detail.append(
        ui.button(
          r.reviewed ? "Mark unreviewed" : "Mark reviewed",
          () => {
            log.markReviewed(r.id, !r.reviewed);
            c.save(true);
          },
          "quiet"
        )
      );
      if (prior) {
        const table = element("table", void 0, "review-splits"), heading = element("tr");
        for (const label of [
          "Checkpoint",
          `Round ${prior.round}`,
          `Round ${r.round}`,
          "Difference"
        ])
          heading.append(element("th", label));
        const head = element("thead");
        head.append(heading);
        table.append(head);
        const body = element("tbody");
        for (const [index, frames] of [...r.checkpoints, ["Finish", r.finish]]) {
          const other = index === "Finish" ? prior.finish : prior.checkpoints.find((e) => e[0] === index)?.[1];
          const row = element("tr");
          for (const value of [
            typeof index === "number" ? index + 1 : index,
            other ? formatTime(other) : "\u2014",
            frames ? formatTime(frames) : "\u2014",
            other && frames ? `${frames < other ? "\u2212" : ""}${formatGap(Math.abs(frames - other))}`.replace(
              "\u2212+",
              "\u2212"
            ) : "\u2014"
          ])
            row.append(element("td", value));
          body.append(row);
        }
        table.append(body);
        detail.append(table);
      }
    }
    if (r.flag)
      detail.append(
        element(
          "p",
          `${evidenceStatus(r)} \xB7 ${r.inputs.length} input samples \xB7 ${r.checkpoints.length}/${r.expectedCheckpoints} checkpoints \xB7 ${r.outcome}`,
          "muted"
        )
      );
    box.append(detail);
  }
  if (log.dropped)
    box.append(element("p", `${log.dropped} older runs removed by the log size limit.`, "muted"));
  return box;
}

// src/player-menu.ts
var PlayerMenu = class {
  #ui;
  #root;
  #element = element("div", void 0, "player-menu");
  #id = null;
  #cupId = "";
  #signature = "";
  #anchor = null;
  constructor(ui, root) {
    this.#ui = ui;
    this.#root = root;
    this.#element.id = "player-actions-menu";
    this.#element.popover = "auto";
    this.#element.setAttribute("role", "dialog");
    this.#element.tabIndex = -1;
    this.#element.addEventListener("toggle", () => {
      if (!this.#element.matches(":popover-open")) this.#id = null;
      this.updateTriggers();
    });
    root.append(this.#element);
  }
  get open() {
    return this.#id !== null && this.#element.matches(":popover-open");
  }
  close() {
    const id = this.#id;
    this.#id = null;
    this.#element.hidePopover();
    this.updateTriggers();
    if (id !== null && this.#ui.panelOpen)
      this.#root.querySelector(`[data-player-menu-id="${id}"]`)?.focus({ preventScroll: true });
  }
  updateTriggers() {
    for (const button of this.#root.querySelectorAll("[data-player-menu-id]"))
      button.setAttribute(
        "aria-expanded",
        String(this.open && Number(button.dataset.playerMenuId) === this.#id)
      );
  }
  show(id, anchor) {
    if (!this.#ui.c.isHost || !this.#ui.c.state) return;
    this.#id = id;
    this.#cupId = this.#ui.c.state.id;
    this.#signature = "";
    this.#anchor = anchor.getBoundingClientRect();
    this.#ui.c.clearDrivingInput();
    this.sync();
    if (this.#id === null) return;
    this.#element.showPopover();
    this.updateTriggers();
    (this.#element.querySelector("button:not(:disabled)") ?? this.#element).focus({
      preventScroll: true
    });
    this.position();
  }
  position() {
    if (!this.#anchor) return;
    const rect = this.#element.getBoundingClientRect();
    this.#element.style.left = `${Math.max(8, Math.min(this.#anchor.left, innerWidth - rect.width - 8))}px`;
    this.#element.style.top = `${Math.max(8, Math.min(this.#anchor.bottom + 8, innerHeight - rect.height - 8))}px`;
  }
  sync() {
    if (this.#id === null) return;
    const ui = this.#ui, c = ui.c, s = c.state, id = this.#id;
    const peer = c.lobby.find((p) => p.id === id), racer = player(s, id);
    if (!c.isHost || !s || s.id !== this.#cupId || !ui.panelOpen || !peer && !racer) {
      this.close();
      return;
    }
    const key = JSON.stringify([
      s.id,
      s.revision,
      peer?.nickname,
      c.hello.has(id),
      c.needsRebind.has(id),
      c.lobby.map((p) => p.id)
    ]);
    this.updateTriggers();
    if (key === this.#signature) return;
    const activeKey = this.#root.activeElement?.dataset.actionKey;
    this.#signature = key;
    const name = peer?.nickname ?? racer.name;
    this.#element.setAttribute("aria-label", `Player actions for ${name}`);
    const heading = element("div", void 0, "player-menu-heading");
    heading.append(ui.playerLabel(id, name, true));
    this.#element.replaceChildren(heading);
    const action = (label, run, dangerous = false) => {
      const button = ui.button(
        label,
        async () => {
          if (c.state !== s || !c.isHost) {
            this.close();
            return;
          }
          await run();
          this.close();
        },
        dangerous ? "quiet danger" : "primary",
        `player:${id}:${label}`
      );
      this.#element.append(button);
      return button;
    };
    if (rosterOpen(s)) {
      if (racer)
        action(
          "Move to spectators",
          () => c.change((state) => {
            removePlayer(state, id);
            c.pruneTrackData();
          })
        );
      else if (peer) {
        const add = action(
          "Move to racers",
          () => id === c.selfId ? c.action("join") : c.enrollRacer(id, { type: "join", cupId: s.id })
        );
        add.disabled = s.roster.length >= 8 || id !== c.selfId && !c.hello.has(id);
      }
    } else if (rulesFor(s).allowRacerChanges && !["registration", "complete"].includes(s.phase)) {
      if (racer && (!s.withdrawn?.includes(id) || s.pendingRacers?.includes(id)))
        action("Move to spectators", () => c.moveToSpectators(id));
      else if (peer) {
        const add = action(
          "Move to racers",
          () => id === c.selfId ? c.action("join") : c.enrollRacer(id, { type: "join", cupId: s.id })
        );
        add.title = "Joins the next round; returning racers keep their score.";
        add.disabled = occupiedSlots(s) >= 8 || id !== c.selfId && !c.hello.has(id);
      }
    }
    if (racer && c.needsRebind.has(id) && !s.runtime) {
      const label = element("label", "Confirm saved racer"), select = element("select");
      select.setAttribute("aria-label", `Reconnect ${name}`);
      const placeholder = element("option", "Choose connected player");
      placeholder.value = "";
      select.append(placeholder);
      for (const p of c.lobby.filter((p2) => !player(s, p2.id) || p2.id === id)) {
        const option = element("option", `${ui.optionName(p.id, p.nickname)} \xB7 #${p.id}`);
        option.value = String(p.id);
        option.disabled = p.id !== c.selfId && !c.hello.has(p.id);
        select.append(option);
      }
      label.append(select);
      this.#element.append(label);
      const confirm2 = action("Confirm identity", () => {
        const person = c.lobby.find((p) => p.id === Number(select.value));
        if (person) c.rebindRacer(id, person.id, person.nickname);
      });
      confirm2.disabled = true;
      select.addEventListener("change", () => {
        confirm2.disabled = !select.value;
      });
    }
    if (peer && id !== c.selfId)
      action(
        "Kick from lobby",
        () => {
          const draft = s.phase === "registration" && !rosterOpen(s);
          if (confirm(
            `Kick ${name} from the multiplayer lobby?${draft ? " This restarts the draft for the remaining racers." : ""}`
          ))
            c.kickPlayer(id);
        },
        true
      );
    if (this.#element.childElementCount === 1)
      this.#element.append(element("p", "No player actions available during this phase.", "muted"));
    if (this.open) {
      this.position();
      if (activeKey)
        [...this.#element.querySelectorAll("button")].find((b) => b.dataset.actionKey === activeKey)?.focus({ preventScroll: true });
    }
  }
};

// assets/toolbar-trophy.svg
var toolbar_trophy_default = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 1c0 9.803-5.094 13.053-5.592 17h-2.805c-.498-3.947-5.603-7.197-5.603-17h14zm-7.305 13.053c-1.886-3.26-2.635-7.432-2.646-11.053h-1.699c.205 4.648 1.99 8.333 4.345 11.053zm1.743 4.947h-2.866c-.202 1.187-.63 2.619-2.571 2.619v1.381h8v-1.381c-1.999 0-2.371-1.432-2.563-2.619zm7.08-1.596c-1.402-.634-2.609-.19-3.354.293.745-.484 1.603-1.464 1.595-3.003-2.591 1.038-2.295 2.496-2.765 3.345-.315.571-1.007.274-1.007.274l-.213.352c.365.193.989.319 1.716.319 1.307 0 2.949-.409 4.028-1.58zm2.444-4.022c-1.382.097-2.118 1.061-2.501 1.763.383-.702.614-1.942-.05-3.158-1.61 1.929-.752 2.958-.762 3.831-.004.427-.49.417-.49.417l.007.404c.314-.041 3.154-.717 3.796-3.257zm1.036-3.87c-1.171.426-1.56 1.473-1.718 2.175.158-.702.041-1.863-.835-2.75-.915 2.068.082 2.745.29 3.503.102.371-.325.606-.325.606l.29.179c.061-.029 2.385-1.332 2.298-3.713zm-.2-3.792c-.903.666-1.017 1.688-.974 2.335-.042-.646-.395-1.639-1.376-2.182-.264 2.018.769 2.349 1.142 2.95.182.294.023.658.023.658l.284-.019s.026-.127.169-.442c.291-.644 1.255-1.334.732-3.3zm-1.901-2.72s-.273.984-.045 1.732c.244.798.873 1.361.873 1.361s.34-.873.099-1.733c-.222-.792-.927-1.36-.927-1.36zm-12.67 15.665l-.213-.352s-.691.297-1.007-.274c-.47-.849-.174-2.307-2.765-3.345-.008 1.539.85 2.52 1.595 3.003-.745-.484-1.952-.927-3.354-.293 1.078 1.171 2.721 1.581 4.028 1.581.727-.001 1.35-.127 1.716-.32zm-4.393-2.027l.007-.404s-.486.01-.49-.417c-.009-.873.848-1.901-.762-3.831-.664 1.216-.433 2.457-.05 3.158-.383-.702-1.12-1.666-2.501-1.763.642 2.541 3.482 3.217 3.796 3.257zm-2.533-3.413l.29-.179s-.427-.236-.325-.606c.208-.758 1.205-1.435.29-3.503-.876.887-.994 2.048-.835 2.75-.158-.702-.546-1.749-1.718-2.175-.088 2.381 2.236 3.684 2.298 3.713zm-1.366-4.204c.143.315.169.442.169.442l.284.019s-.159-.364.023-.658c.373-.601 1.405-.933 1.142-2.95-.983.542-1.335 1.534-1.377 2.181.042-.647-.072-1.67-.974-2.335-.523 1.966.441 2.656.733 3.301zm.241-4.661c-.24.86.099 1.733.099 1.733s.629-.563.873-1.361c.228-.748-.045-1.732-.045-1.732s-.705.568-.927 1.36z"/></svg>';

// src/hud-layout.ts
var nativeParts = ".game-toolbar-ui > .button-container,.game-toolbar-ui > .info-container,.timer-ui > .left,.timer-ui > .center,.timer-ui > .right,.checkpoint-ui,.speedometer-ui";
function edgeClearance(lane, obstacles, height, gap = 8) {
  let top = 0, bottom = 0;
  if (lane.right <= lane.left) return { top, bottom };
  for (const rect of obstacles) {
    if (rect.right <= lane.left || rect.left >= lane.right || rect.bottom <= 0 || rect.top >= height)
      continue;
    if (rect.top < height / 2) top = Math.max(top, Math.ceil(rect.bottom + gap));
    else bottom = Math.max(bottom, Math.ceil(height - rect.top + gap));
  }
  return { top, bottom };
}
function visibleHudRect(element2, styleOf = getComputedStyle) {
  if (!element2) return null;
  for (let node = element2; node; node = node.parentElement ?? node.getRootNode?.()?.host ?? null) {
    const style = styleOf(node);
    if (node.hidden || style.display === "none" || ["hidden", "collapse"].includes(style.visibility))
      return null;
    if (Number(style.opacity) <= 0.01 && !node.classList.contains("visible")) return null;
  }
  const rect = element2.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}
function layoutCupHud({
  hud,
  povHud,
  povRecordHud,
  inputHud,
  practiceHud,
  notice,
  roundTimer
}) {
  const native = [...document.querySelectorAll(nativeParts)].map((e) => visibleHudRect(e)).filter((rect) => rect !== null);
  const set = (element2, property, value) => {
    if (element2.style.getPropertyValue(property) !== `${value}px`)
      element2.style.setProperty(property, `${value}px`);
  };
  const placed = [];
  for (const element2 of [povHud, povRecordHud, inputHud, practiceHud, notice, roundTimer]) {
    if (!element2) continue;
    const clearance2 = edgeClearance(
      element2.getBoundingClientRect(),
      [...native, ...placed],
      innerHeight
    );
    set(element2, "--pwc-bottom", clearance2.bottom);
    const rect = visibleHudRect(element2);
    if (rect) placed.push(rect);
  }
  const overlayRects = [povHud, povRecordHud, inputHud, practiceHud].map((e) => visibleHudRect(e)).filter((rect) => rect !== null);
  const clearance = edgeClearance(
    hud.getBoundingClientRect(),
    [...native, ...overlayRects],
    innerHeight
  );
  const oldTop = parseFloat(hud.style.getPropertyValue("--pwc-hud-top")) || 0;
  hud.classList.toggle("settling", clearance.top < oldTop);
  set(hud, "--pwc-hud-top", clearance.top);
  set(hud, "--pwc-hud-bottom", Math.max(60, clearance.bottom));
}

// src/toolbar.css
var toolbar_default = "/* Only the toolbar containing our button receives the wrapping layout. All\n   button visuals and UI scaling remain owned by PolyTrack's native stylesheet. */\n.game-toolbar-ui.polycup-toolbar {\n  max-width:calc(100% - 2 * var(--safe-area-horizontal,0px) - 8px);\n}\n.game-toolbar-ui.polycup-toolbar > .button-container {\n  display:flex;\n  flex-wrap:wrap;\n  row-gap:4px;\n}\n.game-toolbar-ui.polycup-toolbar > .button-container > .button { white-space:nowrap; }\n.game-toolbar-ui .polycup-toolbar-button { pointer-events:inherit; }\n.game-toolbar-ui .polycup-toolbar-button > .polycup-trophy { filter:brightness(0) invert(1); }\n.polycup-inputs { position:fixed; right:18px; bottom:max(50px,var(--pwc-bottom,0px)); z-index:100099; pointer-events:none; color:#b3c7df; font:italic 18px/1 ForcedSquare,Arial,sans-serif; }\n.polycup-inputs[hidden] { display:none !important; }\n.polycup-inputs .input-visualizer-ui { position:relative; left:auto; bottom:auto; margin:0; --size:38px; }\n.polycup-inputs .input-visualizer-ui > div > img { padding:8px; }\n.polycup-inputs .input-visualizer-ui > div.active > img { padding:10px; }\n.polycup-inputs .input-status { max-width:170px; margin-top:6px; text-align:center; }\n.polycup-inputs .input-status[hidden] { display:none; }\n.game-ui.polycup-watching > :is(.time-announcer-ui, .hint-ui, .timer-ui, .checkpoint-ui, .speedometer-ui),\n.game-ui.polycup-session-ended > .player-list-ui,\n.session-end-ui.polycup-session-ended {\n  /* Keep native results and callbacks intact; suppress only their presentation.\n     The ordinary Players panel stays available during an active session. */\n  display: none !important;\n}\n";

// src/toolbar.ts
var CupToolbar = class {
  #fallback;
  #toolbar = null;
  #overlays;
  #button;
  #schedule;
  #frame = null;
  #observer;
  #resize;
  #open = false;
  constructor({
    fallback,
    hud,
    povHud,
    povRecordHud,
    inputHud,
    practiceHud,
    notice,
    roundTimer,
    toggle
  }) {
    this.#fallback = fallback;
    this.#overlays = { hud, povHud, povRecordHud, inputHud, practiceHud, notice, roundTimer };
    this.#button = document.createElement("button");
    this.#button.type = "button";
    this.#button.className = "button polycup-toolbar-button";
    this.#button.title = "PolyCup (F8)";
    this.#button.setAttribute("aria-keyshortcuts", "F8");
    const icon = document.createElement("img");
    icon.className = "button-icon polycup-trophy";
    icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toolbar_trophy_default)}`;
    icon.alt = "";
    icon.draggable = false;
    this.#button.append(icon, document.createTextNode(" PolyCup"));
    this.#button.addEventListener("click", toggle);
    for (const type of ["keydown", "keyup"])
      window.addEventListener(
        type,
        (e) => {
          if (document.activeElement !== this.#button || !["Space", "Enter"].includes(e.code))
            return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (type === "keydown" && !e.repeat) this.#button.click();
        },
        { capture: true }
      );
    const style = document.createElement("style");
    style.textContent = toolbar_default;
    document.head.append(style);
    this.#schedule = () => {
      if (this.#frame) return;
      this.#frame = requestAnimationFrame(() => {
        this.#frame = 0;
        this.sync();
      });
    };
    this.#observer = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList" || r.target.closest?.(".game-ui")))
        this.#schedule();
    });
    this.#observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"]
    });
    this.#resize = new ResizeObserver(this.#schedule);
    window.addEventListener("resize", this.#schedule);
    this.sync();
  }
  sync(open) {
    if (open !== void 0) this.#open = open;
    const toolbar = document.querySelector(".game-toolbar-ui");
    if (toolbar !== this.#toolbar) {
      this.#resize.disconnect();
      this.#toolbar?.removeEventListener("transitionend", this.#schedule);
      this.#toolbar?.classList.remove("polycup-toolbar");
      this.#toolbar = toolbar;
      if (toolbar) {
        toolbar.classList.add("polycup-toolbar");
        this.#resize.observe(toolbar);
        toolbar.addEventListener("transitionend", this.#schedule);
      }
    }
    const container = toolbar?.querySelector(":scope > .button-container");
    if (container && this.#button.parentElement !== container) container.append(this.#button);
    if (!container) this.#button.remove();
    this.#fallback.hidden = !!container;
    this.#button.setAttribute("aria-expanded", String(!!this.#open));
    this.#button.tabIndex = toolbar?.classList.contains("visible") ? 0 : -1;
    layoutCupHud(this.#overlays);
  }
};

// src/world-cup.css
var world_cup_default = ":host { --deep:#192042; --blue:#28346a; --ice:#fff; --muted:#b3c7df; --gold:#ffd26b; --red:#ff9c9c; --cut:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%); color:var(--ice); font:italic 22px/1 ForcedSquare,Arial,sans-serif; }\r\n* { box-sizing:border-box; font-style:italic; font-kerning:auto; letter-spacing:normal; word-spacing:normal; } [hidden] { display:none!important; }\r\n.panel,.hud,.pov-hud { font:italic 22px/1 ForcedSquare,Arial,sans-serif; }\r\nbutton,input,textarea,select { font:inherit; }\r\nbutton { --button-bg:#112052; --button-hover:#334b77; --button-active:#151f41; cursor:pointer; position:relative; isolation:isolate; color:var(--ice); background:var(--button-bg); border:0; border-radius:0; padding:10px 18px; clip-path:var(--cut); }\r\nbutton::after { content:''; position:absolute; inset:0 auto 0 0; width:0; z-index:-1; background:var(--button-hover); border-bottom:2px solid currentColor; transition:width .1s ease-in-out; }\r\nbutton:enabled:hover::after,button:enabled:active::after { width:100%; }\r\nbutton:enabled:active::after { background:var(--button-active); }\r\nbutton:focus-visible { outline:none; background:var(--button-hover); text-decoration:underline; text-underline-offset:3px; }\r\ninput:focus-visible,textarea:focus-visible,select:focus-visible { outline:none; box-shadow:inset 0 -3px var(--gold); }\r\nbutton.primary { --button-bg:var(--gold); --button-hover:#ffe09a; --button-active:#efbd50; color:var(--deep); font-weight:700; }\r\nbutton.quiet { --button-bg:#212b58; padding:8px 16px; }\r\nbutton:disabled,button.primary:disabled { cursor:default; opacity:1; background:#313d53; color:#b3c7df; }\r\nbutton:disabled::after { content:none; }\r\n/* Selected controls already own a gold edge; don't stack a second hover stripe. */\r\nbutton.selected::after,button.track-card.added::after { border-bottom:0; }\r\n.menu-version { position:fixed; right:18px; top:16px; z-index:100100; color:var(--muted); font-size:18px; line-height:1.2; pointer-events:none; }\r\n.panel { position:fixed; z-index:100101; left:50%; top:50%; transform:translate(-50%,-50%); width:min(880px,calc(100vw - 36px)); height:min(900px,calc(100dvh - 32px)); max-height:calc(100dvh - 32px); display:flex; flex-direction:column; background:var(--deep); border-top:4px solid var(--gold); clip-path:var(--cut); }\r\nheader { flex-shrink:0; display:flex; justify-content:space-between; align-items:center; gap:16px; padding:18px 24px 14px; background:var(--blue); }\r\n.header-title { flex:1; min-width:0; } .header-title p { overflow-wrap:anywhere; }\r\n.header-hide { flex:none; }\r\n.lobby-invite { flex:none; max-width:100%; }\r\n.invite-actions { display:flex; align-items:flex-end; gap:4px; }\r\n.invite-label { margin:0; color:var(--muted); font-size:18px; }\r\n.invite-label input { width:142px; margin-top:5px; padding:8px 14px; font-size:22px; border:0; user-select:text; }\r\n.invite-copy { display:flex; align-items:center; justify-content:center; gap:6px; min-width:104px; min-height:38px; font-size:18px; }\r\n.invite-copy img { width:18px; height:18px; } .invite-copy:disabled img { opacity:.5; }\r\n.invite-status { display:block; font-size:18px; color:var(--muted); margin:5px 8px 0; min-height:18px; }\r\n@media(max-width:760px) { header { flex-wrap:wrap; } .header-title { flex-basis:calc(100% - 100px); } .header-hide { order:1; } .lobby-invite { order:2; flex-basis:100%; } }\r\nh1 { font:italic 36px/1 ForcedSquare,Arial,sans-serif; margin:0 0 6px; } h2 { font:italic 27px/1 ForcedSquare,Arial,sans-serif; margin:0 0 14px; } h3 { font-size:23px; margin:18px 0 8px; }\r\np { margin:8px 0 16px; max-width:74ch; } header p { margin:0; color:var(--muted); }\r\nnav { display:flex; gap:2px; padding:12px 24px 0; } nav button { flex:1; } nav .selected { border-bottom:3px solid var(--gold); --button-bg:var(--blue); }\r\n.body { flex:1; min-height:0; overflow-y:auto; padding:22px 24px 26px; } .body > button { margin:8px 8px 8px 0; }\r\nfooter { flex-shrink:0; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:12px 24px; color:var(--muted); font-size:18px; border-top:1px solid #3a5075; }\r\nlabel { display:block; margin:15px 0; } input,textarea,select { background:#112052; color:var(--ice); border:0; border-bottom:2px solid #61789c; border-radius:0; padding:10px 16px; clip-path:var(--cut); }\r\nlabel input,label textarea { display:block; width:100%; margin-top:7px; } textarea { resize:vertical; }\r\n.disconnect-rule { display:flex; align-items:center; flex-wrap:wrap; gap:10px 18px; margin:0 0 22px; }\r\n.disconnect-rule select { max-width:100%; }\r\n.racer-name { display:flex; align-items:center; gap:10px; min-width:140px; }\r\n.racer-name > span { overflow-wrap:anywhere; }\r\n.car-skin { flex:0 0 56px; width:56px; height:48px; object-fit:contain; }\r\n.track-tabs { display:flex; flex-wrap:wrap; gap:8px; margin:22px 0 14px; }\r\n.track-tabs .selected { border-bottom:3px solid var(--gold); --button-bg:var(--blue); }\r\n.track-search { width:100%; margin-bottom:14px; }\r\n.track-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:9px; max-height:340px; overflow-y:auto; padding:4px; }\r\n.track-card { display:flex; align-items:center; gap:12px; min-height:86px; padding:10px 16px; text-align:left; --button-bg:#212b58; }\r\n.track-card img { width:76px; height:64px; object-fit:cover; clip-path:var(--cut); }\r\n.track-card > span { min-width:0; } .track-card strong,.track-card small { display:block; overflow-wrap:anywhere; }\r\n.track-card.added { border-bottom:3px solid var(--gold); opacity:1; } .track-card.added small { color:var(--gold); }\r\n.track-code { margin-top:22px; } .track-code summary { cursor:pointer; color:var(--muted); }\r\n.muted { color:var(--muted); font-size:18px; } .error { margin:12px 24px; color:#ffe6e6; background:#723e4e; padding:10px 18px; border-left:3px solid var(--red); clip-path:var(--cut); }\r\n.row { display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #344c75; flex-wrap:wrap; } .grow { flex:1; min-width:90px; overflow-wrap:anywhere; }\r\n.roster-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }\r\n.roster-heading h2 { margin:0; } .roster-heading button { font-size:18px; }\r\n.notice { position:fixed; z-index:100102; bottom:max(120px,var(--pwc-bottom,0px)); left:50%; transform:translateX(-50%); padding:10px 20px; background:#112052; clip-path:var(--cut); font-size:22px; pointer-events:none; max-width:calc(100vw - 32px); text-align:center; }\r\n.start-countdown { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:100103; pointer-events:none; user-select:none; }\r\n.start-signal { display:grid; place-items:center; width:clamp(160px,19vw,230px); text-align:center; color:var(--gold); animation:start-pulse .18s ease-out; }\r\n.start-number { display:block; padding-right:.08em; font:italic clamp(88px,8vw,104px)/.8 ForcedSquare,Arial,sans-serif; text-shadow:0 2px 0 #112052,0 3px 8px #07122ba6; }\r\n.start-signal.go { color:#78e1b6; animation:start-go .6s ease-out both; }\r\n@keyframes start-pulse { from { transform:scale(1.12); opacity:.5; } to { transform:scale(1); opacity:1; } }\r\n@keyframes start-go { 0% { transform:scale(1.12); } 25% { transform:scale(1); opacity:1; } 100% { transform:scale(1.04); opacity:0; } }\r\n@media(prefers-reduced-motion:reduce) { .start-signal,.start-signal.go { animation:none; } }\r\n.badge { padding:4px 12px; background:var(--blue); clip-path:var(--cut); font-size:18px; }\r\n.controls { display:flex; gap:9px; flex-wrap:wrap; margin-top:18px; } .setup-stats { display:flex; gap:25px; font:italic 25px/1 ForcedSquare,Arial,sans-serif; color:var(--gold); margin:25px 0; }\r\n.ready-list { margin:18px 0; } .ready-pick { color:#78e1b6; font-size:18px; max-width:45%; overflow-wrap:anywhere; }\r\n.cup-rules { margin-top:22px; color:var(--muted); font-size:18px; } .cup-rules p { margin:12px 0; }\r\n.organizer-settings { margin-top:24px; color:var(--muted); font-size:18px; } summary { cursor:pointer; } .organizer-settings label { margin:16px 0 4px; }\r\n.upload-status { color:var(--gold); }\r\n.draft-stages { display:flex; gap:5px; margin-bottom:16px; font-size:20px; }\r\n.draft-stages span { flex:1; padding:8px 16px; background:#212b58; clip-path:var(--cut); color:var(--muted); text-align:center; }\r\n.draft-stages .current { background:var(--blue); color:var(--gold); border-bottom:3px solid var(--gold); }\r\n.draft-setup > button { margin-top:16px; }\r\n.draft-setup .controls:empty { display:none; }\r\n.draft-grid { margin:14px 0; }\r\n.draft-grid-heading,.draft-row { display:grid; grid-template-columns:minmax(140px,1.1fr) minmax(100px,1fr) minmax(100px,1fr); gap:16px; align-items:center; padding:7px 12px; }\r\n.draft-grid-heading { font-size:18px; color:var(--muted); }\r\n.draft-row { border-top:1px solid #344c75; min-height:46px; }\r\n.draft-row.current-turn { background:#28346a; clip-path:var(--cut); }\r\n.draft-row .racer-name { min-width:0; } .draft-row .car-skin { width:40px; height:34px; flex-basis:40px; }\r\n.draft-ban,.ban-label { color:#ffb0ac; } .draft-pick,.pick-label { color:var(--gold); }\r\n.draft-ban,.draft-pick { overflow-wrap:anywhere; font-size:20px; }\r\n.ban-list { display:flex; flex-wrap:wrap; gap:7px 18px; margin:14px 0; }\r\n.ban-button { --button-bg:#67384e; }\r\n.track-card.ban-choice:not(:disabled):hover { --button-bg:#67384e; }\r\n.track-card.banned { opacity:.65; }\r\n.review-disclaimer { font-size:18px; color:var(--muted); line-height:1.25; }\r\n.review-panel .controls { align-items:center; justify-content:space-between; margin-bottom:18px; }\r\n.review-run { background:#212b58; margin:7px 0; padding:12px 16px; clip-path:var(--cut); }\r\n.review-run.flagged { border-top:2px solid var(--gold); }\r\n.review-run .review-heading { display:flex; align-items:center; gap:18px; }\r\n.review-title { flex:1; display:grid; gap:6px; min-width:0; overflow-wrap:anywhere; }\r\n.review-tag { color:var(--gold); min-width:80px; text-align:right; }\r\n.review-run > p { margin-top:16px; }\r\n.review-run > button { margin-bottom:10px; }\r\n.review-splits { border-collapse:collapse; width:100%; font-size:20px; margin:12px 0; }\r\n.review-splits td,.review-splits th { padding:8px; border-bottom:1px solid #344c75; text-align:right; font-weight:400; }\r\n.review-splits th { color:var(--muted); font-size:18px; }\r\n.review-splits th:first-child,.review-splits td:first-child { text-align:left; }\r\n@media(max-width:650px) { .draft-grid-heading,.draft-row { gap:8px; grid-template-columns:minmax(100px,1fr) 1fr 1fr; padding:10px 4px; } .draft-row .car-skin { display:none; } .review-run .review-heading { flex-wrap:wrap; gap:10px; } }\r\n.scoreboard { margin:14px 0 8px; }\r\n.ranking-heading { display:flex; align-items:center; justify-content:center; text-align:center; padding:9px 10px; background:#112052; }\r\n.ranking-heading > strong { font:italic 700 27px/1 ForcedSquare,Arial,sans-serif; }\r\n.score-row { display:grid; grid-template-columns:24px minmax(0,1fr) 28px 72px 110px; align-items:center; gap:5px; min-height:40px; background:#212b58; margin-top:3px; padding:3px 0 3px 12px; clip-path:var(--cut); }\r\n.score-row .racer-name { min-width:0; gap:6px; font-weight:400; }\r\n.score-row .racer-name > span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; overflow-wrap:normal; padding-right:4px; }\r\n.score-row .car-skin { width:32px; height:28px; flex-basis:32px; background:transparent; border-radius:0; }\r\n.score-row .position { font-size:20px; color:#aec2d9; }\r\n.score-row.highlighted { background:#ed7833; color:#111e34; }\r\n.score-row.highlighted .position { color:#111e34; }\r\n.score-row.self .racer-name > span { text-decoration:underline; text-underline-offset:3px; }\r\n.points { display:flex; justify-content:flex-end; align-items:center; gap:5px; padding-right:5px; }\r\n.points > strong { font-size:24px; font-weight:400; } .finalist .points > strong { color:#ffd26b; font-size:22px; font-style:italic; }\r\n.highlighted.finalist .points > strong { color:#172642; }\r\n.point-gain { color:#76e8ba; font-size:18px; font-weight:700; background:#0d302d; padding:2px 5px; clip-path:polygon(3px 0,100% 0,calc(100% - 3px) 100%,0 100%); }\r\n.point-gain:empty { display:none; } .projected { opacity:.76; font-weight:400; }\r\n.movement { font-size:18px; text-align:right; } .movement.up { color:#76e8ba; } .movement.down { color:#ff9d9d; }\r\n.highlighted .movement.up { color:#153e32; } .highlighted .movement.down { color:#6e1024; }\r\n.score-row .time { align-self:stretch; display:flex; justify-content:center; align-items:center; background:#e9f1f8; color:#152238; font-size:20px; font-weight:400; clip-path:var(--cut); margin:2px 10px 2px 0; padding:0 10px; white-space:nowrap; }\r\n.winner-strip { padding:10px 14px; border-top:2px solid var(--gold); background:#273c3b; margin-bottom:5px; clip-path:var(--cut); }\r\n.winner-strip > small { display:block; color:var(--gold); font-size:18px; margin-bottom:5px; }\r\n.winner-strip .car-skin { height:30px; width:36px; flex-basis:36px; background:transparent; }\r\n.hud { --hud-strip-cut:polygon(0 0,100% 0,calc(100% - 8px) 100%,0 100%); position:fixed; left:0; top:var(--pwc-hud-top,0px); width:min(420px,calc(100vw - 8px)); max-height:calc(100dvh - var(--pwc-hud-top,0px) - var(--pwc-hud-bottom,60px)); overflow-y:auto; scrollbar-width:thin; z-index:100099; pointer-events:none; }\r\n.hud-summary { display:grid; grid-template-columns:minmax(0,1fr); gap:3px; }\r\n.hud-track { background:var(--deep); padding:9px 18px 9px; clip-path:polygon(0 0,100% 0,calc(100% - 16px) 100%,0 100%); } .hud-track > strong { display:block; font:italic 30px/1 ForcedSquare,Arial,sans-serif; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding-right:5px; }\r\n.hud-meta { display:flex; gap:10px; justify-content:space-between; font-size:18px; margin-top:5px; text-transform:uppercase; }\r\n.hud-meta > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); } .hud-meta > strong { white-space:nowrap; }\r\n.hud-phase { display:flex; justify-content:space-between; font-size:18px; color:var(--gold); margin-top:5px; }\r\n.record-strip { display:grid; grid-template-columns:30px minmax(0,1fr) 100px; gap:7px; align-items:center; padding:7px 4px; border-top:1px solid #63768b; font-size:18px; background:#212b58; }\r\n.record-strip > strong:first-child { color:#ff9150; font-style:italic; } .record-tr > strong:first-child { color:#ffd26b; } .record-pb > strong:first-child { color:#78e1b6; }\r\n.record-holder { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding-right:4px; } .record-time { text-align:right; font-size:24px; font-weight:400; }\r\n.hud .record-strip { border:0; padding:6px 18px; clip-path:var(--hud-strip-cut); }\r\n.hud .scoreboard { margin:26px 0 0; }\r\n.hud .score-row { grid-template-columns:20px minmax(0,1fr) 24px 72px 110px; gap:4px; font-size:18px; min-height:34px; margin-top:4px; padding-left:18px; clip-path:var(--hud-strip-cut); }\r\n.hud .ranking-heading > strong { font-size:26px; } .hud .ranking-heading { padding:10px 18px; clip-path:var(--hud-strip-cut); }\r\n.hud .winner-strip { margin-bottom:8px; padding-left:18px; clip-path:var(--hud-strip-cut); }\r\n.pov { display:grid; grid-template-columns:44px minmax(0,1fr) 44px; gap:6px; width:min(420px,100%); margin:18px auto 0; }\r\n.pov-main { min-width:0; height:44px; padding:6px 12px; text-align:center; background:#112052; clip-path:polygon(8px 0,calc(100% - 8px) 0,100% 100%,0 100%); }\r\n.pov-name { position:relative; background:#e9f1f8; color:#152238; clip-path:polygon(6px 0,calc(100% - 6px) 0,100% 100%,0 100%); }\r\n.pov-pb { display:grid; grid-template-columns:30px minmax(0,1fr); align-items:center; gap:6px; width:196px; height:34px; margin:8px auto 0; padding-left:14px; background:#212b58; clip-path:var(--cut); font:italic 20px/1 ForcedSquare,Arial,sans-serif; white-space:nowrap; pointer-events:auto; }\r\n.pov-pb > span { color:#78e1b6; }\r\n.pov-pb > strong { display:flex; align-items:center; justify-content:center; align-self:stretch; margin:3px 8px 3px 0; padding:0 8px; background:#e9f1f8; color:#152238; clip-path:var(--cut); font-size:22px; font-weight:400; }\r\nbutton.pov-cycle { display:flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; pointer-events:auto; }\r\nbutton.pov-cycle.previous { clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%); }\r\nbutton.pov-cycle.next { clip-path:polygon(0 0,calc(100% - 8px) 0,100% 100%,8px 100%); }\r\n.pov-arrow { width:10px; height:10px; border-top:3px solid currentColor; border-right:3px solid currentColor; transform:rotate(45deg); }\r\n.previous .pov-arrow { transform:rotate(-135deg); }\r\n.history { font-size:18px; border-bottom:1px solid #344c75; padding-bottom:10px; }\r\n.result { font:italic 26px/1 ForcedSquare,Arial,sans-serif; } [data-clock] { color:var(--gold); }\r\n@media(max-width:650px) { .panel { width:calc(100vw - 16px); max-height:calc(100dvh - 16px); } header,.body { padding:16px; } nav { padding:10px 12px 0; } .row { gap:8px; } h1 { font-size:30px; } .score-row { grid-template-columns:24px minmax(0,1fr) 28px 72px 110px; gap:3px; } }\r\n@media(max-height:680px) { .hud .score-row { min-height:27px; } .hud .car-skin { height:23px; } }\r\n\r\n.pov-hud { position:fixed; bottom:var(--pwc-bottom,0px); left:50%; transform:translateX(-50%); width:min(420px,calc(100vw - 24px)); z-index:100099; color:var(--ice); pointer-events:none; }\r\n.pov-hud .pov { margin:0; }\r\n.pov-record-hud { position:fixed; right:8px; bottom:max(8px,var(--pwc-bottom,0px)); z-index:100099; pointer-events:none; }\r\n.pov-record-hud .pov-pb { margin:0; }\r\n@media(max-height:850px) { .hud .score-row { min-height:30px; padding-top:1px; padding-bottom:1px; } .hud .car-skin { height:24px; } .hud .record-strip { padding-top:5px; padding-bottom:5px; } .hud-track { padding-top:7px; padding-bottom:7px; } }\r\n@media(max-width:850px) { .pov-record-hud { bottom:max(52px,var(--pwc-bottom,0px)); } .hud.spectating { max-height:calc(100dvh - var(--pwc-hud-top,0px) - max(100px,var(--pwc-hud-bottom,60px))); } }\r\n@media(max-width:450px) { .pov { gap:4px; } .pov-name { font-size:24px; } }\r\n\r\n.record-strip,.score-row .time,.score-row .racer-name,.points,.movement { pointer-events:auto; }\r\n\r\n.ready-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 20px; }\r\n.ready-list .row { gap:8px; padding:8px 0; }\r\n.ready-list .car-skin { width:40px; height:34px; flex-basis:40px; }\r\n.ready-list .racer-name { min-width:100px; } .ready-list .ready-pick { max-width:100%; font-size:18px; }\r\n@media(max-width:650px) { .ready-list { grid-template-columns:1fr; } }\r\n.hud.settling { transition:top .18s ease-out; }\r\n@media(prefers-reduced-motion:reduce) { .hud.settling,button::after { transition:none; } }\r\n.practice-hud { position:fixed; right:18px; bottom:max(112px,var(--pwc-bottom,0px)); z-index:100099; max-width:calc(100vw - 36px); }\r\n.practice-controls { display:flex; align-items:center; justify-content:flex-end; gap:12px; padding:6px 8px 6px 18px; background:var(--deep); clip-path:var(--cut); font-size:22px; }\r\n.practice-controls > span { color:var(--muted); } .practice-controls > strong { min-width:42px; text-align:right; font-weight:400; }\r\n.practice-controls button { min-width:112px; }\r\n.finish-cue { position:fixed; z-index:100104; inset:0; display:grid; place-items:center; background:#19204266; }\r\n.champion-card { width:min(540px,calc(100vw - 40px)); padding:28px 32px; text-align:center; background:var(--deep); border-top:5px solid var(--gold); clip-path:polygon(16px 0,100% 0,calc(100% - 16px) 100%,0 100%); animation:start-pulse .25s ease-out; }\r\n.champion-card h2 { color:var(--gold); text-transform:uppercase; font-size:30px; }\r\n.champion-card .racer-name { display:flex; flex-direction:column; gap:4px; font-size:38px; margin-bottom:24px; }\r\n.champion-card .racer-name > span { max-width:100%; }\r\n.champion-card .car-skin { width:168px; height:120px; flex-basis:120px; image-rendering:auto; }\r\n.final-standings h2 { text-align:center; text-transform:uppercase; font-weight:700; }\r\n.final-row { display:flex; align-items:center; gap:14px; margin-top:4px; min-height:40px; padding:4px 10px 4px 18px; background:#212b58; clip-path:var(--cut); }\r\n.final-row > strong { width:24px; font-weight:400; }\r\n.final-row .car-skin { width:44px; height:32px; flex-basis:44px; }\r\n.final-row.champion { background:var(--gold); color:var(--deep); }\r\n.winner-label { font-size:18px; text-transform:uppercase; }\r\n.final-score { display:flex; align-items:center; justify-content:center; align-self:stretch; min-width:76px; background:#e9f1f8; color:#152238; clip-path:var(--cut); padding:4px 16px; margin-right:4px; font-size:26px; }\r\n.result-controls { flex-shrink:0; justify-content:center; margin:0; padding:12px 24px; border-top:1px solid #3a5075; } .race-history { margin-top:24px; color:var(--muted); font-size:18px; }\r\n@media(max-width:650px) { .final-row { gap:8px; } .winner-label { display:none; } .final-score { min-width:62px; } }\r\n@media(prefers-reduced-motion:reduce) { .champion-card { animation:none; } }\r\n\r\n/* One lobby, with the current action beside a persistent roster. */\r\n.panel.lobby-panel { width:min(1180px,calc(100vw - 36px)); }\r\n.cup-lobby { display:grid; grid-template-columns:minmax(390px,1fr) minmax(0,1.45fr); gap:28px; }\r\n.lobby-roster { min-width:0; padding-right:22px; border-right:1px solid #344c75; }\r\n.lobby-racer { padding:7px 10px 9px; border-bottom:1px solid #344c75; }\r\n.lobby-racer.current-turn { background:var(--blue); border-left:3px solid var(--gold); }\r\n.lobby-racer.you .racer-name > span { text-decoration:underline; text-underline-offset:4px; }\r\n.lobby-racer .car-skin { width:40px; height:30px; flex-basis:40px; }\r\n.lobby-racer .racer-name { font-size:22px; }\r\n.lobby-choices { display:flex; flex-wrap:wrap; gap:6px 14px; padding:3px 0 0 50px; font-size:18px; line-height:1.1; }\r\n.lobby-choices span { overflow-wrap:anywhere; }\r\n.lobby-action { min-width:0; }\r\n.lobby-action > button { margin:4px 8px 12px 0; }\r\n.lobby-action .track-tabs { margin:12px 0; gap:4px; }\r\n.lobby-action .track-tabs button { font-size:18px; padding:10px 12px; flex:1; }\r\n.lobby-action .track-grid { max-height:285px; grid-template-columns:repeat(2,minmax(0,1fr)); }\r\n.lobby-action .track-card { font-size:22px; gap:8px; min-height:70px; padding:8px 12px; }\r\n.lobby-action .track-card img { width:56px; height:48px; }\r\n.lobby-action .track-card small { font-size:18px; }\r\n.lobby-turn-count { color:var(--muted); font-size:18px; margin-top:-7px; }\r\n\r\n.cup-rules summary { cursor:pointer; }\r\n\r\n.selected-track { display:flex; flex-wrap:wrap; gap:16px; align-items:center; padding:18px; background:#212b58; clip-path:var(--cut); margin-bottom:16px; }\r\n.selected-track img { width:104px; height:80px; object-fit:cover; clip-path:var(--cut); }\r\n.selected-track strong { flex:1; overflow-wrap:anywhere; }\r\n.selected-track button { flex-basis:100%; }\r\n.lobby-action .cup-rules { margin-top:20px; font-size:18px; color:var(--muted); line-height:1.2; }\r\n@media(max-width:950px) {\r\n  .cup-lobby { grid-template-columns:1fr; gap:20px; }\r\n  .lobby-roster { padding-right:0; border-right:0; }\r\n  .lobby-racer { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }\r\n  .lobby-choices { padding-left:0; margin-left:auto; }\r\n}\r\n.lobby-racer .draft-ban,.lobby-racer .draft-pick { font-size:18px; }\r\n.lobby-roster .lobby-racer { padding-top:4px; padding-bottom:6px; }\r\n.lobby-roster .lobby-choices { min-height:20px; }\r\n@media(min-width:701px) {\r\n  .lobby-panel .body { padding-top:18px; padding-bottom:18px; }\r\n}\r\n\r\n/* Car artwork is centered across the identity and draft-choice lines. */\r\n.lobby-roster .lobby-racer { display:grid; grid-template-columns:74px 64px minmax(0,1fr) 22px; column-gap:10px; align-items:center; min-height:66px; padding:6px 10px; }\r\n.lobby-racer > .car-skin { grid-column:2; grid-row:1 / span 3; align-self:center; justify-self:center; width:64px; height:54px; }\r\n.lobby-racer > .racer-name { grid-column:3; grid-row:1; min-width:0; gap:8px; }\r\n.lobby-roster .lobby-choices { grid-column:3; grid-row:2; padding:3px 0 0; margin-left:0; }\r\n.lobby-racer > small { grid-column:3; grid-row:3; }\r\n.lobby-racer:not(:has(.lobby-choices:not(:empty))):not(:has(> small)) > .racer-name { grid-row:1 / span 3; }\r\n.lobby-racer .country-flag { flex:none; width:24px; height:18px; object-fit:contain; filter:drop-shadow(1px 1px 1px #0006); }\r\n\r\n.round-timer {\r\n  z-index: 100098;\r\n  position: fixed;\r\n  right: 0;\r\n  bottom: max(12px, var(--pwc-bottom, 0px));\r\n  min-width: 106px;\r\n  padding: 9px 20px 9px 28px;\r\n  box-sizing: border-box;\r\n  background: var(--deep);\r\n  clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%);\r\n  color: #ff747c;\r\n  font-size: 36px;\r\n  line-height: 1;\r\n  text-align: center;\r\n  font-variant-numeric: tabular-nums;\r\n  pointer-events: none;\r\n  transform: translateX(100%);\r\n  opacity: 0;\r\n  transition: transform 220ms ease-out, opacity 150ms ease-out;\r\n}\r\n.round-timer.visible { transform: translateX(0); opacity: 1; }\r\n.downtime {\r\n  z-index: 100098;\r\n  position: fixed;\r\n  left: 50%;\r\n  top: 27%;\r\n  transform: translateX(-50%);\r\n  color: var(--ice);\r\n  font-size: clamp(24px, 2.5vw, 36px);\r\n  line-height: 1.2;\r\n  text-align: center;\r\n  text-shadow: 0 2px 3px #101a3c, 0 0 12px #101a3c;\r\n  pointer-events: none;\r\n}\r\n@media (prefers-reduced-motion: reduce) {\r\n  .round-timer { transition: none; }\r\n}\r\n\r\n.country-flag { flex:none; width:24px; height:18px; object-fit:contain; filter:drop-shadow(1px 1px 1px #0006); }\r\n.player-label { display:inline-flex; align-items:center; gap:6px; min-width:0; vertical-align:middle; }\r\n.player-label > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\r\n.track-pickers { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\r\n.track-pickers .country-flag,.record-holder .country-flag { width:18px; height:14px; margin-right:4px; }\r\n.record-holder { display:flex; align-items:center; gap:4px; }\r\n.pov-name { display:flex; align-items:center; justify-content:center; height:32px; padding:0 12px; font-size:26px; line-height:32px; cursor:default; }\r\n\r\n.pov-selected { min-width:0; max-width:100%; display:flex; align-items:center; justify-content:center; pointer-events:none; overflow:hidden; }\r\n.pov-selected .player-label { max-width:100%; }\r\n\r\n.champion-card .racer-name { flex-direction:row; flex-wrap:wrap; justify-content:center; gap:8px; }\r\n.champion-card .car-skin { flex-basis:100%; object-fit:contain; }\r\nbutton[aria-busy='true'] {\r\n  position: relative;\r\n  color: transparent !important;\r\n  opacity: 0.85;\r\n  cursor: progress;\r\n}\r\nbutton[aria-busy='true'] > * {\r\n  visibility: hidden;\r\n}\r\nbutton[aria-busy='true']::after {\r\n  content: attr(data-pending-label);\r\n  position: absolute;\r\n  inset: 0;\r\n  width: 100%;\r\n  z-index: 0;\r\n  background: transparent;\r\n  border: 0;\r\n  transition: none;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  color: #fff;\r\n  font: inherit;\r\n}\r\n.preset-panel { margin-top: 24px; padding-top: 18px; border-top: 1px solid #43517b; }\r\n.preset-heading { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }\r\n.preset-heading h2 { margin: 0; flex: 1; }\r\n.preset-panel > label { display: flex; flex-direction: column; gap: 7px; color: var(--muted); font-size: 18px; min-width: 0; }\r\n.preset-panel input:not([type='checkbox']), .preset-panel select { width: 100%; min-width: 0; padding: 9px 12px; font-size: 20px; }\r\n.preset-panel fieldset { min-width: 0; padding: 0; border: 0; margin: 0; }\r\n.preset-panel legend { padding: 0; margin-bottom: 8px; color: var(--muted); font-size: 18px; }\r\n.preset-pool { display: flex; flex-wrap: wrap; gap: 8px 16px; }\r\n.preset-pool label { flex-direction: row; align-items: center; color: var(--ice); }\r\n.preset-pool input[type='checkbox'] { width: 20px; height: 20px; margin: 0; padding: 0; accent-color: var(--gold); }\r\n.preset-scoring { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; }\r\n.preset-scoring legend { float: left; width: 100%; grid-column: 1 / -1; }\r\n.preset-scoring label { text-align: center; }\r\n.preset-scoring input { padding: 8px 4px; text-align: center; }\r\n.preset-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }\r\n.preset-tools button { font-size: 18px; }\r\n.preset-status { font-size: 18px; line-height: 1.3; color: var(--gold); margin: 12px 0 0; }\r\n@media (max-width: 700px) {\r\n  .preset-scoring { grid-template-columns: repeat(4, minmax(0, 1fr)); }\r\n  .preset-heading { flex-wrap: wrap; }\r\n  .preset-heading select { max-width: 100%; }\r\n}\r\n.preset-scoring label { margin:0; }\r\n.selected-track { padding:10px 14px; margin-bottom:8px; }\r\n.selected-track img { width:76px; height:58px; }\r\n.preset-status.muted { color:var(--muted); }\r\n.preset-panel input[aria-invalid='true'] { border-bottom-color:var(--red); }\r\n@media(max-width:700px) { .lobby-action { order:-1; } }\r\n.preset-panel { container-type:inline-size; }\r\n.preset-overview { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px 24px; margin:18px 0 20px; }\r\n.rule-group { min-width:0; }\r\n.rule-group h3 { margin:0 0 10px; font-size:21px; font-weight:700; color:var(--gold); }\r\n.rule-group dl { margin:0; }\r\n.rule-pair { margin:5px 0; font-size:18px; line-height:1.25; overflow-wrap:anywhere; }\r\n.rule-pair dt { display:inline; font-weight:700; color:var(--ice); }\r\n.rule-pair dd { display:inline; margin:0 0 0 .35em; font-weight:400; color:var(--muted); }\r\n.rule-points { grid-column:1 / -1; width:100%; table-layout:fixed; border-collapse:collapse; font-size:18px; }\r\n.rule-points caption { text-align:left; font-weight:700; color:var(--ice); margin-bottom:10px; }\r\n.rule-points th { color:var(--muted); font-weight:400; padding:6px 2px; border-top:1px solid #43517b; }\r\n.rule-points td { color:var(--ice); font-weight:400; padding:5px 2px; text-align:center; background:#212b58; }\r\n@container (max-width:420px) { .preset-overview { grid-template-columns:1fr; gap:18px; } }\r\n\r\n.preset-scoring label { font-weight:700; color:var(--ice); }\r\n.preset-panel input,.preset-panel select { font-weight:400; }\r\n.preset-at-top { margin-top:0; padding-top:0; border-top:0; }\r\n.preset-heading { flex-wrap:wrap; gap:10px; }\r\n.preset-heading h2 { flex-basis:100%; }\r\n.preset-chooser { display:flex; align-items:center; gap:6px; width:100%; min-width:0; }\r\n.preset-chooser select { flex:1; width:0; min-width:0; max-width:none; }\r\n.preset-chooser .preset-icon { display:grid; place-items:center; flex:0 0 40px; width:40px; height:40px; padding:8px; }\r\n.preset-icon svg { width:23px; height:23px; }\r\n.preset-pool input[type='checkbox'],.preset-editable .rule-edit > input[type='checkbox'] {\r\n  appearance:none; -webkit-appearance:none; flex:0 0 28px; width:28px; height:24px;\r\n  margin:0; padding:0; border:0; clip-path:none; border-radius:2px; background:#112052;\r\n  box-shadow:inset 0 0 0 2px #61789c; display:grid; place-content:center;\r\n}\r\n.preset-pool input[type='checkbox']:checked,.preset-editable .rule-edit > input[type='checkbox']:checked { background:var(--gold); box-shadow:none; }\r\n.preset-pool input[type='checkbox']::before,.preset-editable .rule-edit > input[type='checkbox']::before {\r\n  content:''; width:6px; height:11px; border:solid var(--deep); border-width:0 3px 3px 0;\r\n  transform:translateY(-2px) rotate(45deg); visibility:hidden;\r\n}\r\n.preset-pool input[type='checkbox']:checked::before,.preset-editable .rule-edit > input[type='checkbox']:checked::before { visibility:visible; }\r\n.preset-pool input[type='checkbox']:focus-visible,.preset-editable .rule-edit > input[type='checkbox']:focus-visible { outline:2px solid white; outline-offset:3px; }\r\n.lobby-roster > button,.lobby-spectators > button { margin:10px 0 16px; }\r\n.lobby-spectators { margin-top:22px; }\r\n.lobby-spectators h2 { margin-bottom:12px; }\r\nfooter > [data-setup-start],footer > .lobby-start { margin-left:auto; }\r\n.preset-name-control { display:flex; flex:1; min-width:0; background:#112052; clip-path:var(--cut); border-bottom:2px solid #61789c; }\r\n.preset-name-control input { flex:1; width:0!important; min-width:0; clip-path:none; border:0; background:transparent; }\r\n.preset-name-control select { flex:0 0 34px; width:34px; padding:8px 3px; clip-path:none; border:0; color:transparent; background-color:transparent; }\r\n.preset-name-control select option { color:var(--ice); background:#112052; }\r\n.lobby-spectators { color:var(--ice); }\r\n.preset-name-control { position:relative; }\r\n.preset-name-control::after { content:'\u25BE'; position:absolute; right:10px; top:50%; transform:translateY(-50%); color:var(--muted); pointer-events:none; }\r\n.preset-name-control select { appearance:none; -webkit-appearance:none; cursor:pointer; }\r\n.custom-ban-hint { flex-basis:100%; line-height:1.25; } .preset-pool input:disabled { opacity:.45; cursor:not-allowed; }\r\n\r\n.membership-controls { margin-left:auto; display:flex; align-items:center; gap:12px; }\r\n.score-identity { min-width:0; }\r\n.score-row.with-pb { min-height:46px; padding-top:2px; padding-bottom:2px; }\r\n.score-row.with-pb .car-skin { height:24px; }\r\n.scoreboard-panel .body { padding:14px 24px; }\r\n.scoreboard-panel .scoreboard { margin-top:0; }\r\n.scoreboard-round { margin:10px 0 0; font-size:18px; line-height:1.2; }\r\n.score-pb { display:flex; gap:8px; margin:1px 0 0 38px; font-size:14px; line-height:1.1; color:var(--muted); }\r\n.score-pb > :first-child { color:#80e6c3; }\r\n.score-row.highlighted .score-pb,.score-row.highlighted .score-pb > :first-child { color:var(--deep); }\r\n.rules-dialog { width:min(620px,calc(100vw - 32px)); max-height:calc(100vh - 48px); box-sizing:border-box; padding:0; border:0; border-top:4px solid var(--gold); background:var(--deep); color:var(--ice); font:inherit; box-shadow:0 16px 60px #0008; }\r\n.rules-dialog::backdrop { background:#080f26a8; }\r\n.rules-dialog-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 24px; background:#293565; }\r\n.rules-dialog-heading h2 { margin:0; min-width:0; overflow-wrap:anywhere; }\r\n.rules-dialog-body { padding:20px 24px; }\r\n.rules-dialog-body .preset-overview { margin:0; }\r\n.header-rules { white-space:nowrap; }\r\n@media(max-width:650px) { .panel > header { flex-wrap:wrap; gap:8px; } .panel > header .header-title { flex:1 1 100%; } .score-row.with-pb { grid-template-columns:20px minmax(0,1fr) 20px 48px 90px; } .score-row.with-pb .racer-name { font-size:18px; } .score-pb { font-size:14px; } .rules-dialog-body,.rules-dialog-heading { padding:16px; } }\r\n\r\n.rules-dialog[open] { display:flex; flex-direction:column; }\r\n.rules-dialog-heading { flex:none; }\r\n.rules-dialog-body { overflow-y:auto; min-height:0; container-type:inline-size; }\r\n.score-pb { white-space:nowrap; }\r\n.score-pb > :last-child { overflow:hidden; text-overflow:ellipsis; }\r\n@media(max-width:760px) {\r\n  .scoreboard-panel > header { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:12px 8px; }\r\n  .scoreboard-panel > header .header-title { grid-column:1 / -1; }\r\n  .scoreboard-panel > header .lobby-invite,.scoreboard-panel > header .header-hide { order:0; }\r\n  .scoreboard-panel > header .lobby-invite { min-width:0; }\r\n}\r\n@media(max-width:500px) {\r\n  .scoreboard-panel > header .invite-actions { flex-wrap:wrap; }\r\n  .scoreboard-panel > header { padding:14px 18px; }\r\n  .scoreboard-panel > header .header-rules,.scoreboard-panel > header .header-hide { padding:8px 12px; }\r\n}\r\n\r\n.notice.gameplay-notice.panel-open { display:none; }\r\n\r\n.cup-chat { position:fixed; left:16px; bottom:66px; z-index:100103; width:min(410px,calc(100vw - 32px)); pointer-events:none; }\r\n.cup-chat button,.chat-panel { pointer-events:auto; }\r\n.chat-toggle { font-size:18px; padding:8px 18px; background:#192042dd; }\r\n.chat-preview { margin-bottom:8px; padding:8px 12px; background:#192042c9; max-height:170px; overflow:hidden; }\r\n.chat-panel { background:#192042; border-top:3px solid var(--gold); box-shadow:0 8px 28px #0005; padding:0 14px 12px; }\r\n.chat-heading { display:flex; align-items:center; justify-content:space-between; padding:10px 0; font-size:22px; }\r\n.chat-heading button { font-size:16px; }\r\n.chat-history { height:min(200px,28vh); overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:5px 4px 8px 0; }\r\n.chat-line { font:400 15px/1.4 Arial,sans-serif; margin:0 0 8px; overflow-wrap:anywhere; }\r\n.chat-line * { font-style:normal; }\r\n.chat-line time { color:#a9b8d2; font-size:11px; margin-right:7px; }\r\n.chat-name { margin-right:6px; font-weight:700; }\r\n.chat-name::after { content:':'; }\r\n.chat-text { white-space:pre-wrap; }\r\n.chat-compose { display:flex; gap:6px; margin-top:8px; }\r\n.chat-compose input { width:0; flex:1; min-width:0; font:400 16px/1.3 Arial,sans-serif; padding:8px 12px; clip-path:none; }\r\n.chat-compose button { font-size:18px; padding:8px 14px; }\r\n.chat-status { font:400 13px/1.3 Arial,sans-serif; color:var(--gold); margin:6px 0; }\r\n.chat-status:empty { display:none; }\r\n.chat-empty,.chat-saved-note { font:400 12px/1.4 Arial,sans-serif; color:var(--muted); }\r\n.chat-options { display:flex; align-items:flex-start; gap:12px; justify-content:space-between; font:400 12px/1.3 Arial,sans-serif; margin:10px 0 6px; }\r\n.chat-options label { display:flex; align-items:center; gap:6px; margin:0; font-style:normal; }\r\n.chat-options input { width:14px; height:14px; margin:0; padding:0; accent-color:var(--gold); clip-path:none; }\r\n.chat-older,.chat-bottom { font-size:15px; width:100%; margin-bottom:8px; padding:6px!important; }\r\n.chat-open { width:min(460px,calc(100vw - 32px)); }\r\n@media(max-height:600px) { .cup-chat { bottom:12px; } .chat-history { height:23vh; } }\r\n\r\n.chat-panel { position:relative; }\r\n.chat-line button.chat-name { display:inline; background:none; padding:0; margin:0 6px 0 0; border:0; clip-path:none; font:700 15px/1.4 Arial,sans-serif; text-align:left; }\r\n.chat-line button.chat-name::after { position:static; content:':'; background:none; border:0; width:auto; z-index:auto; }\r\n.chat-line button.chat-name:hover,.chat-line button.chat-name:focus-visible { text-decoration:underline; text-underline-offset:3px; }\r\n.chat-person-menu { position:absolute; left:14px; z-index:2; max-width:calc(100% - 28px); min-width:190px; padding:12px; background:#2b3969; border-top:2px solid var(--gold); box-shadow:0 5px 18px #0008; font:400 14px/1.4 Arial,sans-serif; }\r\n.chat-person-menu strong { display:block; margin-bottom:8px; overflow-wrap:anywhere; }\r\n.chat-person-menu button { font-size:17px; width:100%; }\r\n\r\n.preset-name-control select { flex:1; width:100%; padding:8px 30px 8px 16px; color:var(--ice); }\r\n.preset-name-control:has(input)::after { display:none; }\r\n\r\n.player-tools { display:flex; align-items:center; gap:10px; }\r\n.lobby-racer .player-tools { display:contents; }\r\n.lobby-racer .player-ping { grid-column:1; grid-row:1 / span 3; justify-self:start; }\r\n.lobby-racer .lobby-kick { grid-column:4; grid-row:1 / span 3; }\r\n.player-ping { display:inline-flex; align-items:center; gap:6px; color:#aebbd0; white-space:nowrap; }\r\n.player-ping small { font:400 13px/1 Arial,sans-serif; }\r\n.connection-bars { display:inline-flex; align-items:flex-end; gap:2px; height:13px; width:15px; }\r\n.connection-bars i { display:block; width:3px; background:currentColor; }\r\n.connection-bars i:nth-child(1) { height:4px; }.connection-bars i:nth-child(2) { height:8px; }.connection-bars i:nth-child(3) { height:12px; }\r\n.player-ping[data-quality=good] { color:#8ae3ae; }.player-ping[data-quality=fair] { color:#ffd26b; }.player-ping[data-quality=poor] { color:#ffa0a0; }\r\n.player-ping[data-quality=fair] i:last-child,.player-ping[data-quality=poor] i:not(:first-child),.player-ping[data-quality=unknown] i { opacity:.3; }\r\nbutton.lobby-kick { width:22px; height:22px; padding:0; display:grid; place-items:center; font:400 23px/1 Arial,sans-serif; clip-path:none; background:transparent; color:#b3c7df; }\r\nbutton.lobby-kick:hover,button.lobby-kick:focus-visible { color:#ffaaaa; background:#543049; }\r\n.lobby-roster .lobby-choices:empty { display:none; }\r\n\r\n.score-entry { position:relative; isolation:isolate; }\r\n.score-entry .score-row { position:relative; z-index:2; }\r\n.full-scoreboard { margin-right:34px; }\r\n.record-badge { position:absolute; left:calc(100% - 8px); top:50%; z-index:1; padding:4px 8px 4px 13px; font:italic 700 14px/1 ForcedSquare,Arial,sans-serif; color:#13213a; background:#91e9c5; clip-path:polygon(0 0,100% 0,calc(100% - 5px) 100%,0 100%); transform:translateY(-50%); animation:record-pop 300ms cubic-bezier(.2,.7,.25,1) both; }\r\n.record-badge-tr { background:#8edcf4; }.record-badge-wr { background:#ffd26b; }\r\n@keyframes record-pop { from { transform:translate(-100%,-50%); } to { transform:translate(0,-50%); } }\r\n@media(prefers-reduced-motion:reduce) { .record-badge { animation:none; } }\r\n\r\n.hud { width:min(458px,calc(100vw - 8px)); padding-right:38px; }\r\n\r\n.organizer-settings,.track-code,.race-history { border-top:1px solid #3a5075; margin-top:24px; padding-top:12px; }\r\n\r\n.viewer-count { position:fixed; right:24px; top:110px; display:flex; align-items:center; gap:8px; padding:7px 12px; background:#192042bb; color:var(--ice); font-size:22px; pointer-events:none; }\r\n.viewer-count svg { width:25px; height:25px; fill:none; stroke:currentColor; stroke-width:1.8; }\r\n.physics-warnings { flex-shrink:0; max-height:100px; overflow:auto; padding:0 24px; color:var(--gold); font-size:18px; }\r\n.physics-warnings p { margin:8px 0; }\r\n\r\n\r\n.preset-editable { gap:18px 28px; }\r\n.preset-editable .rule-group { min-width:0; }\r\n.preset-editable .rule-group h3 { margin:0 0 12px; }\r\n.preset-editable .rule-edit { display:flex; flex-direction:row; align-items:center; justify-content:space-between; gap:10px; min-height:32px; margin:2px 0; color:var(--ice); font-size:18px; line-height:1.2; }\r\n.preset-editable .rule-edit > strong { min-width:0; font-weight:700; }\r\n.preset-editable .rule-edit > input[type='number'] { flex:0 0 76px; width:76px; margin:0; padding:5px 8px; font-size:18px; font-weight:400; }\r\n.preset-editable .rule-edit > select { flex:0 1 156px; width:156px; margin:0; padding:5px 8px; font-size:18px; font-weight:400; }\r\n.preset-editable .rule-help { display:block; margin:7px 0 12px; color:var(--muted); font-size:16px; line-height:1.3; }\r\n.preset-editable .rule-pool { margin:12px 0; gap:8px 12px; }\r\n.preset-editable .rule-pool legend { color:var(--ice); font-weight:700; font-size:18px; }\r\n.preset-editable .rule-pool label { display:flex; flex-direction:row; gap:6px; margin:0; font-size:17px; }\r\n.preset-editable .rule-points-editor { grid-column:1/-1; margin:0; padding-top:12px; border-top:1px solid #3a5075; }\r\n.preset-editable .rule-points-editor legend { color:var(--ice); font-weight:700; }\r\n.preset-editable .rule-points-editor label { margin:0; text-align:center; color:var(--muted); font-size:17px; }\r\n.preset-editable .rule-points-editor input { margin-top:6px; text-align:center; padding:6px 3px; font-size:18px; }\r\n@media(max-width:1050px) { .preset-editable { column-gap:18px; } }\r\n@media(max-width:560px) { .preset-editable { grid-template-columns:1fr; } .preset-editable .rule-points-editor { grid-template-columns:repeat(4,minmax(0,1fr)); row-gap:12px; } }\r\n\r\n@media(max-width:950px) { .cup-lobby:has(.preset-editable) > .lobby-action { order:-1; } }\r\n\r\n.cup-actions { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }\r\n.cup-actions button { font-size:16px; }\r\nbutton.danger { color:var(--red); }\r\n.host-round-controls,.cup-people,.review-panel { margin-top:24px; padding-top:14px; border-top:1px solid #3a5075; }\r\n.host-round-controls h3,.cup-people h3 { margin-top:0; color:var(--gold); }\r\n.host-round-controls .controls { margin:0; }\r\n.cup-people-list { display:flex; flex-wrap:wrap; gap:12px 24px; }\r\n.cup-person { display:flex; flex-direction:column; gap:6px; }\r\n.cup-person .racer-name { font-size:20px; }\r\n.cup-person .car-skin { width:36px; height:28px; }\r\n.player-actions-toggle { flex:0 0 26px; width:26px; height:26px; padding:3px; display:inline-grid; place-items:center; background:#415683; color:var(--ice); clip-path:none; border:1px solid #7087ac; }\n.player-actions-toggle::after { content:none; }\n.player-actions-toggle svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:2.5; }\n.player-actions-toggle:hover,.player-actions-toggle:focus-visible { background:var(--gold); color:var(--deep); border-color:var(--gold); }\n.racer-name:has(.player-actions-toggle) > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.player-menu { position:fixed; inset:auto; margin:0; width:310px; max-width:calc(100vw - 16px); max-height:calc(100dvh - 16px); overflow-y:auto; background:var(--deep); color:var(--ice); border:1px solid #43517b; border-top:3px solid var(--gold); padding:14px; box-shadow:0 8px 24px #0007; font:italic 20px/1.2 ForcedSquare,Arial,sans-serif; }\r\n.player-menu::backdrop { background:transparent; }\r\n.player-menu-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }\r\n.player-menu-heading .player-label { min-width:0; }\r\n.player-menu-heading button { font-size:16px; flex-shrink:0; }\r\n.player-menu > p { font-size:17px; margin:8px 0 12px; }\r\n.player-menu > button { display:block; width:100%; margin-top:7px; text-align:left; font-size:18px; }\r\n.player-menu label { font-size:17px; }\r\n.player-menu select { display:block; width:100%; margin-top:6px; font-size:18px; }\r\n.review-panel { scroll-margin-top:12px; }\r\n\n.full-scoreboard .score-row.with-pb { min-height:62px; padding-top:7px; padding-bottom:7px; column-gap:10px; }\n.full-scoreboard .score-identity { display:grid; grid-template-columns:40px minmax(0,1fr); column-gap:10px; row-gap:3px; align-items:center; }\n.full-scoreboard .score-identity > .car-skin { grid-column:1; grid-row:1 / span 2; width:40px; height:34px; }\n.full-scoreboard .score-identity > .racer-name { grid-column:2; grid-row:1; font-size:22px; gap:8px; line-height:1.15; }\n.full-scoreboard .score-pb { grid-column:2; grid-row:2; margin:0; font-size:14px; line-height:1.2; }\n\n.scoreboard-meta { display:flex; align-items:center; justify-content:space-between; gap:12px 20px; flex-wrap:wrap; margin:14px 34px 0 0; }\n.scoreboard-meta .scoreboard-round { margin:0; flex:1 1 220px; line-height:1.35; }\n.scoreboard-meta > button { font-size:18px; padding:8px 16px; flex:0 0 auto; }\n@media(max-width:650px) { .full-scoreboard .score-row.with-pb { column-gap:5px; } .full-scoreboard .score-identity { grid-template-columns:30px minmax(0,1fr); column-gap:5px; } .full-scoreboard .score-identity > .car-skin { width:30px; height:28px; } .full-scoreboard .score-identity > .racer-name { font-size:18px; gap:4px; } .scoreboard-meta { margin-right:0; } }\n\n.full-scoreboard .score-identity:has(> .player-actions-toggle) { grid-template-columns:26px 40px minmax(0,1fr); }\n.full-scoreboard .score-identity > .player-actions-toggle { grid-column:1; grid-row:1 / span 2; margin:0; }\n@media(max-width:650px) { .full-scoreboard .score-identity:has(> .player-actions-toggle) { grid-template-columns:26px 30px minmax(0,1fr); } }\n\n.full-scoreboard .score-identity:has(> .player-actions-toggle) > .car-skin { grid-column:2; }\n.full-scoreboard .score-identity:has(> .player-actions-toggle) > .racer-name,.full-scoreboard .score-identity:has(> .player-actions-toggle) > .score-pb { grid-column:3; }\n.lobby-roster .lobby-racer:has(> .player-actions-toggle) { grid-template-columns:74px 64px minmax(0,1fr) 26px; }\n.lobby-racer > .player-actions-toggle { grid-column:4; grid-row:1 / span 3; }\n.lobby-racer:has(> .player-actions-toggle) > .car-skin { grid-column:2; }\n.lobby-roster .lobby-racer:has(> .player-actions-toggle) > .racer-name,.lobby-roster .lobby-racer:has(> .player-actions-toggle) > .lobby-choices,.lobby-roster .lobby-racer:has(> .player-actions-toggle) > small { grid-column:3; }\n\n/* Shared spacing and navigation cues for the Cup panel. */\n.panel button:focus-visible,.player-menu button:focus-visible { box-shadow:inset 0 0 0 2px var(--gold); }\n.player-actions-toggle[aria-expanded='true'] { background:var(--gold); color:var(--deep); border-color:var(--gold); }\n.panel .section-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }\n.panel .section-heading h3 { margin:0; }\n.section-heading > button { font-size:16px; padding:7px 12px; }\n.host-round-controls .controls { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }\n.host-round-controls .controls > button { width:100%; min-height:40px; margin:0; font-size:19px; }\n.setup-start { margin-left:auto; display:flex; align-items:center; gap:14px; }\n.setup-start-note { max-width:230px; line-height:1.25; font-size:16px; color:var(--muted); }\n.draft-progress { display:flex; flex-wrap:wrap; gap:8px; list-style:none; padding:0; margin:0 0 18px; font-size:17px; color:var(--muted); }\n.draft-progress li + li::before { content:'\u203A'; padding-right:8px; color:var(--muted); }\n.draft-progress [aria-current='step'] { color:var(--gold); }\n.review-panel > h2 { font-size:24px; margin-bottom:8px; }\n.review-disclaimer { font-size:16px; max-width:65ch; }\n.review-panel .controls { margin:10px 0; font-size:18px; }\n.review-compact { background:transparent; border-bottom:1px solid #344c75; clip-path:none; padding:10px 2px; margin:0; }\n.review-compact .review-heading { display:grid; grid-template-columns:minmax(0,1fr) 100px 120px; gap:12px; font-size:18px; }\n.review-compact .review-heading > :not(:first-child) { text-align:right; }\n.review-compact .review-title { gap:4px; }\n.review-compact .review-title > .muted { font-size:15px; }\n.preset-editable .rule-edit > select { flex-basis:174px; width:174px; padding-right:22px; }\n.preset-editable input[aria-invalid='true'] { box-shadow:inset 0 -2px var(--red); }\n.track-tabs button { min-height:38px; }\n.cup-person,.player-menu-heading .player-label { overflow-wrap:anywhere; }\n@media(prefers-reduced-motion:reduce) { :host *, :host *::after { scroll-behavior:auto!important; animation-duration:0.01ms!important; transition-duration:0.01ms!important; } }\n@media(max-width:650px) { .host-round-controls .controls { grid-template-columns:1fr; } .setup-start { flex-wrap:wrap; justify-content:flex-end; } .setup-start-note { text-align:right; } .review-compact .review-heading { grid-template-columns:minmax(0,1fr) 92px; } .review-compact .review-heading > :last-child { grid-column:1 / -1; text-align:left; font-size:15px; } .panel .preset-heading { flex-wrap:wrap; } }\n\n.header-chat { flex:none; }\n@media(max-width:950px) { .panel > header { flex-wrap:wrap; gap:10px; } .panel > header .header-title { flex:1 1 100%; } .panel > header .lobby-invite { flex:1; order:0; } .panel > header .header-hide { order:0; } .panel > header .header-chat,.panel > header .header-rules,.panel > header .header-hide { padding:8px 12px; font-size:18px; } }\n\n.lobby-column { min-width:0; min-height:0; display:flex; flex-direction:column; gap:14px; padding-right:20px; border-right:1px solid #344c75; }\n.lobby-column .lobby-roster { border:0; padding-right:4px; min-height:0; flex:1; overflow-y:auto; scrollbar-gutter:stable; }\n.lobby-chat-slot { flex-shrink:0; min-width:0; }\n.panel-chat-slot { flex-shrink:0; min-height:0; padding:0 24px; }\n.panel-chat-slot:not(:has(.chat-open)) { display:none; }\n.cup-chat.chat-docked { position:static; width:100%; max-width:none; pointer-events:auto; }\n.chat-docked .chat-panel { border-top:1px solid #51658b; box-shadow:none; background:#1d274d; padding:0 12px 10px; }\n.chat-docked .chat-heading { font-size:21px; padding:9px 0; }\n.chat-docked .chat-history { height:105px; padding-bottom:4px; }\n.chat-docked .chat-line { font-size:14px; margin-bottom:6px; }\n.chat-docked .chat-compose { margin-top:4px; }\n.chat-docked .chat-options { margin:6px 0 0; }\n@media(min-width:951px) { .lobby-panel > .body { overflow:hidden; } .cup-lobby { height:100%; min-height:0; } .lobby-action { overflow-y:auto; padding-right:6px; scrollbar-gutter:stable; } }\n@media(max-width:950px) { .lobby-column { border:0; padding:0; } .lobby-column .lobby-roster { overflow:visible; padding:0; flex:auto; } .lobby-chat-slot { display:none; } .panel-chat-slot .chat-history { height:66px; } .panel-chat-slot .chat-heading { font-size:19px; padding:6px 0; } .panel-chat-slot .chat-options { display:none; } }\n@media(max-height:650px) { .chat-docked .chat-history { height:52px; } .chat-docked .chat-options { display:none; } }\n\n.lobby-racer > .racer-name > span { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n@media(max-width:950px) { .cup-lobby.drafting > .lobby-action { order:-1; } }\n\n.preset-overview.preset-editable { grid-template-columns:minmax(0,1fr); gap:24px; }\n.preset-editable .rule-pair { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:28px; row-gap:8px; }\n.preset-editable .rule-pair > .rule-group { display:grid; grid-template-rows:subgrid; align-items:center; }\n.preset-editable .rule-pair > .rule-group > h3 { grid-row:1; margin:0 0 4px; }\n.preset-editable .rule-pair .rule-edit { min-height:36px; margin:0; }\n.preset-editable .rule-pair .rule-help { align-self:start; margin:0; padding-top:2px; line-height:1.3; }\n.preset-editable .rule-pair .rule-edit > select { min-width:0; }\n@media(max-width:560px) { .preset-editable .rule-pair { grid-template-columns:1fr; row-gap:20px; } .preset-editable .rule-pair > .rule-group { display:flex; flex-direction:column; align-items:stretch; gap:8px; grid-row:auto!important; } }\n\n.preset-panel .rule-edit > strong,.rule-group h3,.rule-pair dt,.rule-points caption,.preset-scoring label,.preset-editable .rule-points-editor legend { font-weight:400; }\n.player-menu-heading { margin-bottom:10px; }\n";

// src/ui.ts
var names = {
  registration: "Registration",
  loading: "Preparing round",
  warmup: "Warmup",
  countdown: "Get ready",
  racing: "Live round",
  "between-rounds": "Round results",
  complete: "Cup results"
};
var CupUI = class {
  #chatUI;
  get panelOpen() {
    return this.#open;
  }
  chatHotkey(event) {
    this.#chatUI.hotkey(event);
  }
  #recordCueScope = "";
  #recordCues = /* @__PURE__ */ new Map();
  #presetEditor = new PresetEditor(this);
  #lobbyStart = null;
  setLobbyStart(button) {
    this.#lobbyStart = button;
  }
  #startControls() {
    const button = this.#lobbyStart;
    if (!button) return null;
    const start = element("div", void 0, "setup-start");
    const note2 = element("small", button.title, "setup-start-note");
    note2.id = "setup-start-note";
    note2.hidden = !button.disabled || !button.title;
    button.setAttribute("aria-describedby", note2.id);
    start.append(note2, button);
    return start;
  }
  get presetDirty() {
    return this.#presetEditor.dirty;
  }
  presetPanel() {
    return this.#presetEditor.render();
  }
  redraw() {
    this.#signature = "";
    this.render();
  }
  #pendingButtons = /* @__PURE__ */ new Map();
  get c() {
    return this.#c;
  }
  get editingPick() {
    return this.#editingPick;
  }
  #c;
  #open = false;
  #signature = "";
  #restartHint = new RestartHint();
  #trackCategory = "official";
  #trackQuery = "";
  #carThumbnails = /* @__PURE__ */ new Map();
  #playerThumbnails = /* @__PURE__ */ new Map();
  #shadow;
  #panel;
  #hud;
  #povHud;
  #povRecordHud;
  #invite;
  #notice;
  #startCue;
  #roundTimer;
  #downtime;
  #practiceHud;
  #finishCue;
  #viewerBadge = element("div", void 0, "viewer-count");
  #inputHud;
  #inputView;
  #inputStatus;
  #inputSignature = "";
  #lastInputMask;
  #toolbar;
  #ghostHintCup;
  #noticeTimer = 0;
  #noticeUntil = 0;
  #noticeCupId = null;
  #seenPanelRequest = 0;
  #lobbyKey = "";
  #editingPick = false;
  #renderedView = "";
  #playerMenu;
  #membershipControls = null;
  #peekCup = null;
  #rulesDialog = element("dialog", void 0, "rules-dialog");
  #resultControls = null;
  #body = element("div");
  #startCueValue = null;
  #finishKey = null;
  #finishTimer = 0;
  constructor(controller) {
    this.#c = controller;
    const root = element("div");
    root.id = "polytrack-world-cup";
    document.body.append(root);
    this.#shadow = root.attachShadow({ mode: "open" });
    const style = element("style", world_cup_default);
    this.#shadow.append(style, this.#viewerBadge);
    this.#playerMenu = new PlayerMenu(this, this.#shadow);
    this.#viewerBadge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><span></span>';
    this.#viewerBadge.hidden = true;
    const menuVersion = element("div", `PolyCup ${VERSION}`, "menu-version");
    this.#panel = element("section", void 0, "panel");
    this.#panel.setAttribute("aria-label", "Simple Cup");
    this.#hud = element("aside", void 0, "hud");
    this.#povHud = element("aside", void 0, "pov-hud");
    this.#povRecordHud = element("aside", void 0, "pov-record-hud");
    this.#shadow.append(menuVersion, this.#panel, this.#hud, this.#povHud, this.#povRecordHud);
    this.#shadow.append(this.#rulesDialog);
    this.#rulesDialog.setAttribute("aria-label", "Cup rules");
    this.#rulesDialog.addEventListener("click", (event) => {
      if (event.target !== this.#rulesDialog) return;
      const rect = this.#rulesDialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
        this.#rulesDialog.close();
    });
    this.#invite = new CupInvite();
    this.#notice = element("div", void 0, "notice");
    this.#notice.hidden = true;
    this.#notice.setAttribute("role", "status");
    this.#shadow.append(this.#notice);
    this.#startCue = element("div", void 0, "start-countdown");
    this.#startCue.hidden = true;
    this.#startCue.setAttribute("role", "status");
    this.#startCue.setAttribute("aria-live", "assertive");
    this.#shadow.append(this.#startCue);
    this.#roundTimer = element("aside", void 0, "round-timer");
    this.#roundTimer.setAttribute("aria-label", "Round time remaining");
    this.#downtime = element("div", void 0, "downtime");
    this.#downtime.hidden = true;
    this.#downtime.setAttribute("role", "status");
    this.#shadow.append(this.#roundTimer, this.#downtime);
    this.#practiceHud = element("aside", void 0, "practice-hud");
    this.#practiceHud.hidden = true;
    this.#finishCue = element("section", void 0, "finish-cue");
    this.#finishCue.hidden = true;
    this.#finishCue.setAttribute("aria-label", "Cup winner");
    this.#finishCue.setAttribute("role", "dialog");
    this.#shadow.append(this.#practiceHud, this.#finishCue);
    this.#inputHud = element("aside", void 0, "polycup-inputs");
    this.#inputHud.hidden = true;
    document.body.append(this.#inputHud);
    this.#inputView = this.#c.native?.createInputVisualizer?.(this.#inputHud);
    this.#inputStatus = element("div", "Waiting for inputs", "input-status");
    this.#inputHud.append(this.#inputStatus);
    this.#c.onInputsChanged(() => this.updateInputOverlay());
    this.#toolbar = new CupToolbar({
      fallback: menuVersion,
      hud: this.#hud,
      povHud: this.#povHud,
      povRecordHud: this.#povRecordHud,
      inputHud: this.#inputHud,
      practiceHud: this.#practiceHud,
      notice: this.#notice,
      roundTimer: this.#roundTimer,
      toggle: () => this.togglePanel()
    });
    this.#chatUI = new ChatUI(this, this.#shadow);
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.#playerMenu.open) {
          if (event.code === "Escape" || event.code === "F8") {
            event.preventDefault();
            this.#playerMenu.close();
          }
          event.stopImmediatePropagation();
          return;
        }
        if (this.#rulesDialog.open) {
          if (event.code === "F8") {
            event.preventDefault();
            this.#rulesDialog.close();
          }
          event.stopImmediatePropagation();
          return;
        }
        if (event.code !== "Tab") return;
        if (this.#peekCup) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const state = this.#c.state;
        if (this.#open || !state || state.phase === "registration" || isEditing(event) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || document.querySelector("dialog[open]"))
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.#peekCup = state.id;
        this.#open = true;
        this.redraw();
      },
      { capture: true }
    );
    window.addEventListener(
      "keyup",
      (event) => {
        if (event.code === "Tab" && this.#peekCup) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.endScoreboardPeek();
        } else if (this.#rulesDialog.open || this.#playerMenu.open)
          event.stopImmediatePropagation();
      },
      { capture: true }
    );
    window.addEventListener("blur", () => this.endScoreboardPeek());
    document.addEventListener("visibilitychange", () => {
      this.expireNotice();
      if (document.hidden) this.endScoreboardPeek();
    });
    window.addEventListener("focus", () => this.expireNotice());
    for (const type of ["keydown", "keyup", "keypress"])
      this.#panel.addEventListener(type, (e) => {
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
          e.stopPropagation();
      });
    for (const type of ["keydown", "keyup", "keypress"])
      window.addEventListener(
        type,
        (e) => {
          const active = this.#shadow.activeElement;
          if (type === "keydown" && active?.dataset.presetField === "name")
            this.#presetEditor.nameKey(e);
          if ((!this.#panel.hidden || this.#povHud.contains(active) || this.#practiceHud.contains(active) || this.#finishCue.contains(active)) && (["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName ?? "") || active?.tagName === "BUTTON" && ["Space", "Enter"].includes(e.code)))
            e.stopImmediatePropagation();
        },
        { capture: true }
      );
    for (const panel of [this.#panel, this.#povHud, this.#practiceHud, this.#finishCue])
      panel.addEventListener("focusin", (e) => {
        if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName) && this.#c.game)
          this.#c.clearDrivingInput();
      });
    window.addEventListener("keydown", (e) => {
      if (this.#c.restartHotkey(e)) e.preventDefault();
      if (e.code === "F8") {
        e.preventDefault();
        this.togglePanel();
      }
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(this.#shadow.activeElement?.tagName ?? "") && this.#c.canSpectate() && ["BracketLeft", "BracketRight"].includes(e.code)) {
        e.preventDefault();
        this.#c.cycleWatch(e.code === "BracketLeft" ? -1 : 1);
      }
    });
  }
  editPick(editing) {
    this.#editingPick = editing;
  }
  renderTrackChoices(parent) {
    const previous = this.#body;
    this.#body = parent;
    try {
      this.trackPack({ embedded: true });
    } finally {
      this.#body = previous;
    }
  }
  button(text, fn, cls = "", key = `${text}:${cls}`) {
    const b = element("button", text, cls);
    b.type = "button";
    if (text) b.setAttribute("aria-label", text);
    b.dataset.actionKey = key;
    b.addEventListener("click", async () => {
      if (this.#pendingButtons.has(key) || key.startsWith("track:") && [...this.#pendingButtons.keys()].some((k) => k.startsWith("track:")))
        return;
      try {
        const result = fn();
        if (result instanceof Promise) {
          const label = key.startsWith("track:") ? cls.includes("ban-choice") ? "Banning\u2026" : "Loading\u2026" : {
            "Join as racer": "Joining\u2026",
            "Switch to spectator": "Leaving\u2026",
            Ready: "Sending\u2026",
            "Start Cup": "Preparing\u2026",
            "Retire this round (DNF)": "Retiring\u2026"
          }[text] ?? "Please wait\u2026";
          this.#pendingButtons.set(key, label);
          this.refreshPendingButtons();
          await result;
        }
      } catch (e) {
        this.#c.fail(e);
      } finally {
        this.#pendingButtons.delete(key);
        this.#signature = "";
        this.render();
      }
    });
    return b;
  }
  refreshPendingButtons() {
    const choosingTrack = [...this.#pendingButtons.keys()].some((key) => key.startsWith("track:"));
    for (const button of this.#shadow.querySelectorAll(
      "button[data-action-key]"
    )) {
      const label = this.#pendingButtons.get(button.dataset.actionKey);
      if (label) {
        if (!button.hasAttribute("aria-busy")) button.dataset.wasDisabled = String(button.disabled);
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        button.dataset.pendingLabel = label;
      } else if (button.hasAttribute("aria-busy")) {
        button.disabled = button.dataset.wasDisabled === "true";
        button.removeAttribute("aria-busy");
        delete button.dataset.pendingLabel;
        delete button.dataset.wasDisabled;
      }
      if (choosingTrack && button.dataset.actionKey.startsWith("track:")) button.disabled = true;
    }
  }
  ghostHotkey(event) {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !this.#c.game || this.#c.info?.disposed || !this.#c.state || document.querySelector("dialog[open],.settings-menu-ui") || event.composedPath().some(
      (e) => e instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(e.tagName) || e.isContentEditable)
    ))
      return;
    this.toggleGhosts();
    event.preventDefault();
  }
  toggleGhosts() {
    this.#c.toggleGhosts();
    this.#ghostHintCup = this.#c.state?.id;
    this.showNotice(this.#c.hideOtherGhosts ? "Other ghosts hidden" : "Other ghosts shown", 1600);
    this.#signature = "";
    this.render();
  }
  togglePanel() {
    this.#peekCup = null;
    this.#open = !this.#open;
    this.#signature = "";
    this.render();
  }
  endScoreboardPeek() {
    if (!this.#peekCup) return;
    this.#peekCup = null;
    this.#open = false;
    this.redraw();
  }
  showRules() {
    const state = this.#c.state;
    if (!state) return;
    const header = element("div", void 0, "rules-dialog-heading");
    header.append(
      element("h2", `${state.preset?.name ?? "Cup"} rules`),
      this.button("Close", () => this.#rulesDialog.close(), "quiet")
    );
    const body = element("div", void 0, "rules-dialog-body");
    body.append(presetSummary(rulesFor(state)));
    if (!rulesFor(state).finalist)
      body.append(element("p", "A tied lead at the target continues into another round.", "muted"));
    this.#rulesDialog.replaceChildren(header, body);
    this.#rulesDialog.showModal();
  }
  dismissNotice() {
    clearTimeout(this.#noticeTimer);
    this.#noticeUntil = 0;
    this.#notice.hidden = true;
  }
  expireNotice() {
    if (this.#noticeUntil && (document.hidden || Date.now() >= this.#noticeUntil))
      this.dismissNotice();
  }
  showNotice(text, duration, gameplayOnly = false) {
    if (document.hidden) {
      this.dismissNotice();
      return;
    }
    if (!this.#notice.hidden && this.#notice.textContent === text && this.#noticeUntil > Date.now())
      return;
    this.dismissNotice();
    const lifetime = Math.min(3500, Math.max(800, duration));
    this.#noticeUntil = Date.now() + lifetime;
    this.#notice.classList.toggle("gameplay-notice", gameplayOnly);
    this.#notice.textContent = text;
    this.#notice.hidden = false;
    this.#noticeTimer = setTimeout(() => this.expireNotice(), lifetime);
  }
  name(id) {
    return player(this.#c.state, id)?.name ?? `Player ${id}`;
  }
  render() {
    const c = this.#c, s = c.state;
    if (this.#noticeCupId !== (s?.id ?? null)) {
      this.dismissNotice();
      this.#noticeCupId = s?.id ?? null;
    }
    this.expireNotice();
    this.#restartHint.update(
      c.game ? c.native.hudElement(c.game) : null,
      s?.phase === "racing" && c.localPlayerId !== null && activeIds(s).includes(c.localPlayerId) && !roundDone(s, c.localPlayerId)
    );
    if (c.panelRequest.revision !== this.#seenPanelRequest) {
      this.#seenPanelRequest = c.panelRequest.revision;
      if (c.panelRequest.revision > 0) {
        this.#peekCup = null;
        this.#open = c.panelRequest.open;
        if (this.#open) {
          if (c.game && !c.info?.disposed) c.native?.clearInput?.(c.game);
        } else this.#shadow.activeElement?.blur();
        if (c.panelRequest.message) this.showNotice(c.panelRequest.message, 2500);
      }
    }
    if (this.#peekCup && (!s || s.id !== this.#peekCup || s.phase === "registration")) {
      this.#peekCup = null;
      this.#open = false;
    }
    if (!this.#open && this.#rulesDialog.open) this.#rulesDialog.close();
    this.renderCompletion();
    const lobbyKey = JSON.stringify([s?.id, s?.draft?.stage, s?.picks?.[c.selfId ?? 0]]);
    if (lobbyKey !== this.#lobbyKey) {
      this.#lobbyKey = lobbyKey;
      this.#editingPick = false;
    }
    this.#panel.classList.toggle("lobby-panel", s?.phase === "registration");
    this.#panel.classList.toggle("scoreboard-panel", !!s && s.phase !== "registration");
    this.#invite.update(c.connection, this.#open);
    this.#panel.hidden = !this.#open;
    this.#notice.classList.toggle("panel-open", this.#open || this.#chatUI.isOpen);
    this.renderStartCue();
    if (!this.#open && s?.runtime && ["warmup", "countdown", "racing"].includes(s.phase) && c.localPlayerId !== null && activeIds(s).includes(c.localPlayerId) && this.#ghostHintCup !== s.id) {
      const keys = c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) ?? [] : [];
      if (keys.length) {
        this.#ghostHintCup = s.id;
        this.showNotice(`${keys.join(" / ")} \xB7 Toggle other ghosts`, 3e3, true);
      }
    }
    this.#viewerBadge.hidden = !c.viewerCount || this.#open || !s?.runtime || !racingIds(s).includes(c.selfId);
    this.#viewerBadge.querySelector("span").textContent = String(c.viewerCount);
    this.#viewerBadge.setAttribute("aria-label", `${c.viewerCount} spectators watching you`);
    this.#viewerBadge.title = `${c.viewerCount} spectators watching you`;
    const key = JSON.stringify([
      this.#open,
      s?.id,
      s?.revision,
      c.isHost,
      c.selfId,
      c.reconnectPending,
      c.lobby.map((p) => [
        p.id,
        p.nickname,
        p.countryCode,
        c.hello.has(p.id),
        p.carStyle?.serialize()
      ]),
      c.error,
      c.physicsWarnings,
      !!c.connection,
      c.auto,
      c.watchId,
      c.watchStatus,
      c.transferProgress,
      c.hideOtherGhosts,
      c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) : null,
      !!c.startingCup,
      c.preparingRandom,
      c.canSpectate(),
      c.isHost ? [c.review.dropped, c.review.runs.map((r) => [r.id, r.outcome, r.flag, r.reviewed])] : null
    ]);
    if (key !== this.#signature) {
      const previousPositions = rankingPositions(this.#shadow);
      const lobbyScroll = [
        ...this.#shadow.querySelectorAll(".lobby-roster,.lobby-action")
      ].map((element2) => [element2.className, element2.scrollTop]);
      const buttonFocus = this.#shadow.activeElement?.dataset.actionKey;
      const focus = this.#shadow.activeElement?.dataset?.field, presetFocus = this.#shadow.activeElement?.dataset?.presetField, view = `${s?.id}:${s?.phase === "registration" ? "setup" : s?.phase === "complete" ? "results" : "race"}`, bodyScroll = this.#renderedView === view ? this.#body?.scrollTop ?? 0 : 0;
      const presetInput = presetFocus ? this.#shadow.activeElement : null;
      const presetSelection = presetInput?.type === "text" ? [presetInput.selectionStart, presetInput.selectionEnd] : null;
      const gridScroll = this.#renderedView === view ? this.#shadow.querySelector(".track-grid")?.scrollTop ?? 0 : 0;
      this.#renderedView = view;
      const inviteSelection = this.#shadow.activeElement === this.#invite.input ? [this.#invite.input.selectionStart, this.#invite.input.selectionEnd] : null;
      const drafts = Object.fromEntries(
        [
          ...this.#shadow.querySelectorAll("[data-field]")
        ].map((e) => [e.dataset.field, e.value])
      );
      this.#signature = key;
      this.#panel.replaceChildren();
      this.#lobbyStart = null;
      this.#resultControls = null;
      this.#membershipControls = null;
      const header = element("header");
      const title = element("div", void 0, "header-title");
      title.append(element("h1", "PolyCup"));
      if (s)
        title.append(
          element(
            "p",
            `${s.name} / ${s.phase === "registration" ? { roster: "Lobby", bans: "Banning", picks: "Picking" }[s.draft?.stage ?? "picks"] ?? "Picking" : s.phase === "between-rounds" && this.#c.needsRebind.size ? "Cup paused" : names[s.phase]}`
          )
        );
      const hide = this.button(
        "Hide",
        () => {
          this.#open = false;
        },
        "quiet header-hide"
      );
      header.append(title, this.#invite.element);
      if (s && s.phase !== "registration") {
        const chat = this.button(
          "Chat",
          () => this.#chatUI.isOpen ? this.#chatUI.close() : this.#chatUI.open(),
          "quiet header-chat"
        );
        chat.setAttribute("aria-controls", "cup-chat-panel");
        header.append(chat);
      }
      if (s && s.phase !== "registration") {
        const rules = this.button("Rules", () => this.showRules(), "quiet header-rules");
        rules.setAttribute("aria-haspopup", "dialog");
        header.append(rules);
      }
      header.append(hide);
      this.#panel.append(header);
      if (c.error) {
        const error = element("p", c.error, "error");
        error.setAttribute("role", "alert");
        this.#panel.append(error);
      }
      if (c.physicsWarnings.length) {
        const warnings = element("div", void 0, "physics-warnings");
        warnings.setAttribute("role", "status");
        for (const warning of c.physicsWarnings)
          warnings.append(
            element(
              "p",
              `${this.name(warning.id)}: modified physics reported${warning.driveForce !== null && warning.driveForce !== 4e3 ? ` (drive force ${warning.driveForce}; standard 4000)` : ""}.`,
              "warning"
            )
          );
        warnings.title = "Client-reported physics check. This warns only; it does not block racing or prove a client is unmodified.";
        this.#panel.append(warnings);
      }
      if (!c.connection) this.welcome();
      else if (!s) this.setup();
      else {
        this.#body = element("div", void 0, "body");
        this.#panel.append(this.#body);
        this.tournament();
        if (c.isHost) {
          this.hostControls();
          if (s.phase !== "registration") this.lobbyPeople();
          if (c.review.runs.length || c.review.dropped) this.#body.append(reviewPanel(this));
        }
        this.#panel.append(element("div", void 0, "panel-chat-slot"));
        if (this.#resultControls) this.#panel.append(this.#resultControls);
        if (c.isHost || this.#membershipControls) {
          const footer = element("footer");
          if (c.isHost) {
            const tools = element("div", void 0, "cup-actions");
            const automatic = this.button(
              c.auto ? "Auto rounds: on" : "Auto rounds: off",
              () => c.toggleAutomaticRounds(),
              "quiet"
            );
            automatic.setAttribute("aria-pressed", String(c.auto));
            tools.append(automatic);
            if (c.review.runs.length || c.review.dropped)
              tools.append(
                this.button(
                  "Run review",
                  () => {
                    this.#shadow.querySelector(".review-panel")?.scrollIntoView({ block: "start", behavior: "smooth" });
                  },
                  "quiet"
                )
              );
            tools.prepend(
              this.button(
                "End Cup",
                () => {
                  if (confirm(
                    "End this Cup for everyone and return to normal multiplayer? You can restore the autosave later."
                  ))
                    c.endCup();
                },
                "quiet danger"
              )
            );
            footer.append(tools);
          }
          if (this.#membershipControls) footer.append(this.#membershipControls);
          const startControl = this.#startControls();
          if (startControl) footer.append(startControl);
          else if (c.isHost && s.phase === "between-rounds") {
            const next = this.button(
              "Start next round",
              async () => {
                await c.runRound();
                this.#open = false;
              },
              "primary"
            );
            next.disabled = !c.canStartRound();
            if (next.disabled)
              next.title = "Waiting for connected racers or saved identity confirmation.";
            footer.append(next);
          }
          this.#panel.append(footer);
        }
      }
      for (const e of this.#shadow.querySelectorAll(
        "[data-field]"
      ))
        if (e.dataset.field in drafts) e.value = drafts[e.dataset.field];
      if (buttonFocus && this.#open)
        [...this.#shadow.querySelectorAll("button[data-action-key]")].find((button) => button.dataset.actionKey === buttonFocus && !button.disabled)?.focus({ preventScroll: true });
      if (focus && this.#open)
        this.#shadow.querySelector(`[data-field="${focus}"]`)?.focus();
      if (presetFocus && this.#open) {
        const input = this.#shadow.querySelector(
          `[data-preset-field="${presetFocus}"]`
        );
        input?.focus();
        if (presetSelection && input?.type === "text") input.setSelectionRange(...presetSelection);
      }
      if (inviteSelection && this.#open && !this.#invite.input.disabled) {
        this.#invite.input.focus();
        this.#invite.input.setSelectionRange(...inviteSelection);
      }
      this.renderHud();
      animateRanking(this.#shadow, previousPositions);
      if (this.#body) this.#body.scrollTop = bodyScroll;
      for (const [className, scroll] of lobbyScroll) {
        const region = this.#shadow.querySelector(`.${className}`);
        if (region) region.scrollTop = scroll;
      }
      const grid = this.#shadow.querySelector(".track-grid");
      if (grid) grid.scrollTop = gridScroll;
    }
    for (const badge of this.#shadow.querySelectorAll("[data-record-until]"))
      badge.hidden = Date.now() >= Number(badge.dataset.recordUntil);
    this.#playerMenu.sync();
    this.updatePings();
    const chatSlot = this.#open && s ? this.#shadow.querySelector(
      s.phase === "registration" && innerWidth > 950 ? ".lobby-chat-slot" : ".panel-chat-slot"
    ) : null;
    this.#chatUI.mount(chatSlot, s?.phase === "registration");
    this.#chatUI.render();
    const chatButton = this.#shadow.querySelector(".header-chat");
    if (chatButton) {
      chatButton.setAttribute("aria-expanded", String(this.#chatUI.isOpen));
      chatButton.textContent = this.#chatUI.unread ? `Chat (${this.#chatUI.unread})` : "Chat";
    }
    this.updateInputOverlay();
    const seconds = this.#open ? null : roundSeconds(s, c.now());
    this.#roundTimer.classList.toggle("visible", seconds !== null);
    this.#roundTimer.setAttribute("aria-hidden", String(seconds === null));
    if (seconds !== null) this.#roundTimer.textContent = `${seconds}s`;
    const label = this.#open ? "" : c.preparingRandom ? "Choosing next track\u2026" : c.reconnectPending ? "Reconnected \xB7 Racing next round" : downtimeLabel(
      s?.phase,
      c.waitingForRacers(),
      s?.runtime?.trackId === c.info?.trackData?.getId()
    );
    this.#downtime.hidden = !label;
    if (this.#downtime.textContent !== label) this.#downtime.textContent = label;
    this.#toolbar.sync(this.#open);
    this.refreshPendingButtons();
    for (const e of this.#shadow.querySelectorAll("[data-clock]")) {
      const run = s?.runtime;
      const target = s?.phase === "racing" ? run?.deadline : run?.startsAt;
      e.textContent = target ? `${Math.max(0, Math.ceil((target - c.now()) / 1e3))}s` : "";
    }
  }
  welcome() {
    const content = element("div", void 0, "body");
    content.append(element("h2", "Multiplayer required"), element("p", "Host or join a multiplayer lobby."));
    this.#panel.append(content);
  }
  updateInputOverlay() {
    const c = this.#c, visible = !!this.#inputView && !this.#open && !!c.state && !c.info?.disposed && c.canSpectate() && c.watchable().length > 0;
    const mask = visible ? c.watchedInputs() : null;
    const signature = `${visible}:${mask}:${c.watchId}:${visible ? this.name(c.watchId) : ""}`;
    if (signature === this.#inputSignature) return;
    this.#inputSignature = signature;
    this.#inputHud.hidden = !visible;
    if (mask !== this.#lastInputMask) {
      this.#inputView?.update(inputControls(mask ?? 0));
      this.#inputStatus.style.visibility = mask === null ? "visible" : "hidden";
      this.#lastInputMask = mask;
    }
    this.#inputHud.setAttribute(
      "aria-label",
      `Reported driving inputs for ${visible ? this.name(c.watchId) : "spectated racer"}`
    );
    this.#inputHud.title = "Reported racer inputs, synchronized with the buffered POV. Not proof of manual driving.";
  }
  renderStartCue() {
    const c = this.#c, value = roundStartCue(
      c.state,
      c.info?.disposed ? null : c.info?.sessionId ?? null,
      c.now()
    );
    this.#startCue.hidden = !value || this.#open;
    if (value === this.#startCueValue) return;
    this.#startCueValue = value;
    this.#startCue.replaceChildren();
    if (!value) return;
    const signal = element("div", void 0, `start-signal${value === "GO" ? " go" : ""}`);
    signal.append(element("span", value === "GO" ? "GO!" : value, "start-number"));
    this.#startCue.append(signal);
  }
  setup() {
    const body = element("div", void 0, "body");
    body.append(element("h2", this.#c.isHost ? "Create a Simple Cup" : "Waiting for the organizer"));
    if (this.#c.isHost) {
      const label = element("label", "Competition name");
      const input = element("input");
      input.value = "Simple Cup";
      input.dataset.field = "cup-name";
      input.maxLength = 64;
      label.append(input);
      body.append(label);
      body.append(this.button("Create Cup", () => this.#c.create(input.value), "primary"));
      const saved = localStorage.getItem("pwc-save-v2");
      if (saved)
        body.append(this.button("Restore autosave", () => this.#c.restore(saved), "quiet"));
    }
    this.#panel.append(body);
  }
  lobbyPeople() {
    const c = this.#c, s = c.cup;
    const people = c.lobby.filter(
      (p) => !player(s, p.id) || s.withdrawn?.includes(p.id) || s.pendingRacers?.includes(p.id)
    );
    const missing = s.roster.filter((p) => !c.lobby.some((peer) => peer.id === p.id));
    if (!people.length && !missing.length) return;
    const section = element("section", void 0, "cup-people");
    section.append(element("h3", "Spectators & returning racers"));
    const list = element("div", void 0, "cup-people-list");
    for (const p of [...people.map((p2) => ({ id: p2.id, name: p2.nickname })), ...missing]) {
      const row = element("div", void 0, "cup-person");
      row.append(this.racerName(p.id, p.name, true, true));
      if (missing.some((person) => person.id === p.id))
        row.append(element("small", "Disconnected", "muted"));
      else if (s.pendingRacers?.includes(p.id))
        row.append(element("small", "Joining next round", "muted"));
      list.append(row);
    }
    section.append(list);
    this.#body.append(section);
  }
  country(id) {
    return this.#c.lobby.find((p) => p.id === id)?.countryCode ?? this.#c.state?.roster.find((p) => p.id === id)?.countryCode;
  }
  flag(code) {
    const url = countryFlag(code);
    if (!url) return null;
    const image = element("img", void 0, "country-flag");
    image.src = url;
    image.alt = String(code).toUpperCase();
    image.title = "Player\u2019s selected country";
    image.addEventListener("error", () => {
      image.hidden = true;
    });
    return image;
  }
  optionName(id, name = this.name(id)) {
    const code = this.country(id);
    return countryFlag(code) ? `${[...code.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join("")} ${name}` : name;
  }
  playerLabel(id, name = this.name(id), showFlag = false) {
    const label = element("span", void 0, "player-label");
    const flag = showFlag ? this.flag(this.country(id)) : null;
    if (flag) label.append(flag);
    label.append(element("span", name));
    return label;
  }
  playerTools(id) {
    const tools = element("div", void 0, "player-tools");
    const ping = element("span", void 0, "player-ping");
    ping.dataset.pingPlayer = String(id);
    const bars = element("span", void 0, "connection-bars");
    bars.setAttribute("aria-hidden", "true");
    bars.append(element("i"), element("i"), element("i"));
    ping.append(bars, element("small", "\u2014", "ping-value"));
    tools.append(ping);
    return tools;
  }
  updatePings() {
    for (const element2 of this.#shadow.querySelectorAll("[data-ping-player]")) {
      const ping = this.#c.ping(Number(element2.dataset.pingPlayer));
      const quality = ping === null ? "unknown" : ping <= 100 ? "good" : ping <= 200 ? "fair" : "poor";
      element2.dataset.quality = quality;
      const label = ping === null ? "Ping unavailable" : `${ping} milliseconds to the host`;
      element2.setAttribute("aria-label", label);
      element2.title = label;
      element2.querySelector(".ping-value").textContent = ping === null ? "\u2014" : `${ping} ms`;
    }
  }
  racerName(id, name, showFlag = false, actions = false) {
    const group = element("span", void 0, "racer-name grow"), image = element("img", void 0, "car-skin");
    group.title = name;
    image.alt = "";
    image.title = `${name}'s car`;
    image.draggable = false;
    image.src = new URL("images/car_thumbnail_placeholder.png", document.baseURI).href;
    this.thumbnail(id).then((url) => {
      if (url && image.isConnected) image.src = url;
    });
    group.append(image);
    const flag = showFlag ? this.flag(this.country(id)) : null;
    if (flag) group.append(flag);
    group.append(element("span", name));
    if (actions && this.#c.isHost) {
      const button = this.button(
        "",
        () => this.#playerMenu.show(id, button),
        "player-actions-toggle",
        `player-menu:${id}`
      );
      button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>';
      button.setAttribute("aria-label", `Manage ${name}`);
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "player-actions-menu");
      button.setAttribute("aria-expanded", "false");
      button.dataset.playerMenuId = String(id);
      button.title = "Player actions";
      group.prepend(button);
    }
    return group;
  }
  async thumbnail(id) {
    const style = this.#c.lobby.find((p) => p.id === id)?.carStyle;
    if (style) {
      const key = style.serialize();
      if (!this.#carThumbnails.has(key)) {
        if (this.#carThumbnails.size >= 64)
          this.#carThumbnails.delete(this.#carThumbnails.keys().next().value);
        this.#carThumbnails.set(
          key,
          this.#c.native.carThumbnail(style).catch(() => null)
        );
      }
      this.#playerThumbnails.set(id, this.#carThumbnails.get(key));
    }
    return this.#playerThumbnails.get(id) ?? null;
  }
  joinControls() {
    const s = this.#c.cup, box = element("div", void 0, "controls"), joined = !!player(s, this.#c.localPlayerId);
    if (!rosterOpen(s)) return box;
    const full = !joined && s.roster.length >= 8;
    const join = this.button(
      joined ? "Switch to spectator" : full ? "Grid full \xB7 spectating" : "Join as racer",
      () => this.#c.action(joined ? "leave" : "join"),
      "primary"
    );
    join.disabled = full;
    box.append(join);
    return box;
  }
  trackPack({ embedded = false } = {}) {
    const s = this.#c.cup, c = this.#c, joined = !!player(s, c.localPlayerId);
    const banning = s.draft?.stage === "bans" && s.phase === "registration";
    const mayChoose = banning ? banTurn(s) === c.localPlayerId : joined && picksOpen(s);
    if (!embedded)
      this.#body.append(
        element(
          "h2",
          banning ? banTurn(s) === c.localPlayerId ? "Your ban" : `${this.optionName(banTurn(s))}\u2019s ban` : s.phase === "registration" ? "Track picks" : "Track order"
        )
      );
    if (s.draft && !embedded) {
      const bans = element("div", void 0, "ban-list");
      for (const { racerId: id, track: t } of banEntries(s)) {
        const item = element("span", `\xD7 ${t.name}`, "draft-ban");
        item.title = `Banned by ${this.name(Number(id))}`;
        bans.append(item);
      }
      this.#body.append(bans);
      if (s.draft.stage === "roster") {
        this.#body.append(element("p", "Waiting for the organizer to begin bans.", "muted"));
        return;
      }
    }
    if (!embedded)
      for (const t of s.tracks) {
        const row = element("div", void 0, "row");
        row.append(
          element("strong", t.name, "grow"),
          element(
            "small",
            s.roster.filter((p) => chosenTracks(s, p.id).includes(t.id)).map((p) => this.optionName(p.id, p.name)).join(", "),
            "muted"
          )
        );
        this.#body.append(row);
      }
    if (!embedded && s.phase === "registration" && !joined) this.#body.append(this.joinControls());
    if (s.phase === "registration" && (joined || banning)) {
      const pool = rulesFor(s).pool.filter((category) => !banning || category !== "custom");
      if (!pool.includes(this.#trackCategory))
        this.#trackCategory = pool[0] ?? "official";
      if (c.transferProgress) this.#body.append(element("p", c.transferProgress, "upload-status"));
      const tabs = element("div", void 0, "track-tabs");
      tabs.setAttribute("aria-label", "Track collections");
      for (const [category, text] of [
        ["official", "Official tracks"],
        ["community", "Community tracks"],
        ["custom", "Custom tracks"]
      ]) {
        if (!pool.includes(category)) continue;
        const button = this.button(
          text,
          () => {
            this.#trackCategory = category;
          },
          category === this.#trackCategory ? "selected" : "quiet"
        );
        button.setAttribute("aria-pressed", String(category === this.#trackCategory));
        tabs.append(button);
      }
      this.#body.append(tabs);
      const search = element("input");
      search.type = "search";
      search.placeholder = "Search tracks";
      search.value = this.#trackQuery;
      search.setAttribute("aria-label", "Search tracks");
      search.dataset.field = "track-search";
      search.className = "track-search";
      const grid = element("div", void 0, "track-grid");
      let entries;
      try {
        entries = c.allowedTracks();
      } catch (error) {
        grid.append(element("p", error instanceof Error ? error.message : String(error), "muted"));
      }
      const draw = () => {
        if (!entries) return;
        grid.replaceChildren();
        const tracks = entries.filter(
          (t) => t.category === this.#trackCategory && `${t.name} ${t.author ?? ""}`.toLocaleLowerCase().includes(this.#trackQuery.toLocaleLowerCase())
        );
        if (!tracks.length)
          grid.append(
            element(
              "p",
              this.#trackCategory === "custom" && !this.#trackQuery ? "No saved custom tracks." : "No matching tracks.",
              "muted"
            )
          );
        for (const track of tracks) {
          const selected = c.localPlayerId !== null && chosenTracks(s, c.localPlayerId).includes(track.id);
          const banned = isBanned(s, track.id);
          const button = this.button(
            "",
            async () => {
              button.disabled = true;
              try {
                if (banning) await c.action("ban", track.id);
                else await c.addLibraryTrack(track);
              } finally {
                if (button.isConnected) button.disabled = false;
              }
            },
            `track-card${selected ? " added" : ""}${banned ? " banned" : ""}${banning ? " ban-choice" : ""}`,
            `track:${track.id}`
          );
          button.disabled = !mayChoose || banned || selected || !!c.pendingUpload;
          button.setAttribute(
            "aria-label",
            `${banned ? "Banned" : selected ? "Selected" : banning ? "Ban" : "Choose"} ${track.name}`
          );
          const image = element("img");
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
          const text = element("span");
          text.append(element("strong", track.name));
          if (banned || selected || track.author)
            text.append(
              element(
                "small",
                banned ? "Banned" : selected ? "Your pick" : track.author,
                banned ? "ban-label" : "muted"
              )
            );
          button.append(image, text);
          grid.append(button);
        }
      };
      search.addEventListener("input", () => {
        this.#trackQuery = search.value;
        draw();
      });
      this.#body.append(search, grid);
      draw();
      if (banning || !mayChoose || !rulesFor(s).pool.includes("custom")) return;
      const advanced = element("section", void 0, "track-code");
      advanced.append(element("h3", "Paste a share code instead"));
      const label = element("label", "PolyTrack share code"), code = element("textarea");
      code.rows = 4;
      code.dataset.field = "track-code";
      code.spellcheck = false;
      label.append(code);
      advanced.append(
        label,
        this.button(
          "Choose this track",
          async () => {
            await c.importTrack(code.value);
            code.value = "";
          },
          "primary"
        )
      );
      this.#body.append(advanced);
    }
  }
  tournament() {
    const c = this.#c, s = c.cup;
    if (c.reconnectPending) this.#body.append(element("p", "Reconnected \xB7 Racing next round", "muted"));
    if (s.phase === "between-rounds" && this.#c.needsRebind.size) {
      this.recovery();
      return;
    }
    if (s.phase === "complete") {
      this.results();
      return;
    }
    if (s.phase === "registration") {
      this.#body.append(lobbyPanel(this));
    } else {
      if (rulesFor(s).allowRacerChanges && c.localPlayerId !== null) {
        const queued = s.pendingRacers?.includes(c.localPlayerId), joined = activeIds(s).includes(c.localPlayerId);
        const membership = element("div", void 0, "membership-controls");
        const button = this.button(
          queued ? "Cancel join" : joined ? "Switch to spectator" : "Join as racer",
          () => c.action(queued || joined ? "leave" : "join"),
          "primary"
        );
        button.disabled = !joined && !queued && occupiedSlots(s) >= 8;
        button.title = queued ? "Cancel joining the next round" : joined ? "Leave the racer roster and retire this round" : "Join the next round; new racers start at zero points";
        if (queued) membership.append(element("small", "Joining next round", "muted"));
        membership.append(button);
        this.#membershipControls = membership;
      }
      this.#body.append(this.scoreboard(true));
      if (s.runtime) {
        const roundBar = element("div", void 0, "scoreboard-meta");
        const status = element(
          "p",
          `Round ${s.runtime.round} \xB7 ${s.tracks.find((t) => t.id === s.runtime.trackId)?.name} `,
          "scoreboard-round"
        );
        const clock = element("strong");
        clock.dataset.clock = "";
        status.append(clock);
        roundBar.append(status);
        this.#body.append(roundBar);
        if (s.phase === "loading")
          this.#body.append(
            element("p", `Loaded: ${s.runtime.ready.length}/${activeIds(s).length}`, "muted")
          );
        if (s.phase === "warmup") this.#body.append(this.practiceControls());
        if (s.phase === "racing" && c.localPlayerId !== null && activeIds(s).includes(c.localPlayerId) && !roundDone(s, c.localPlayerId))
          roundBar.append(
            this.button(
              "Retire this round (DNF)",
              async () => {
                await c.action("dnf", s.runtime.id);
                this.#open = false;
              },
              "quiet"
            )
          );
        if (roundDone(s, c.localPlayerId) && !c.canSpectate() && c.watchable().length)
          roundBar.append(
            this.button("Watch remaining racers", () => {
              c.watchRemaining();
              this.#open = false;
            })
          );
      }
    }
  }
  recovery() {
    const c = this.#c;
    this.#body.append(element("h2", "Cup paused"));
    if (!c.isHost) {
      this.#body.append(
        element("p", "Waiting for the organizer to reconnect racers and restart the round.")
      );
      return;
    }
    this.#body.append(element("p", "Click each saved racer\u2019s name to confirm their lobby identity."));
    for (const racer of c.recoveryRacers()) {
      const row = element("div", void 0, "row");
      row.append(this.racerName(racer.id, racer.name, true, true));
      this.#body.append(row);
    }
  }
  hostControls() {
    const c = this.#c, s = c.cup;
    const controls = element("div", void 0, "controls");
    if (s.phase === "racing")
      controls.append(
        this.button(
          "End round",
          () => {
            if (confirm("Score the current finishes and give every unfinished racer a DNF?"))
              c.finishRound();
          },
          "quiet"
        )
      );
    if (s.runtime)
      controls.append(
        this.button(
          "Void round",
          () => {
            if (confirm("Stop this round without awarding points?")) c.voidRound();
          },
          "quiet"
        )
      );
    if (["between-rounds", "complete"].includes(s.phase)) {
      const undo = this.button(
        "Undo last scored round",
        () => {
          if (confirm("Undo the last scored round in this match?")) c.change(undoRound);
        },
        "quiet"
      );
      undo.disabled = s.history.at(-1)?.matchIndex !== s.matchIndex;
      controls.append(undo);
    }
    if (currentTrackVisit(s))
      controls.append(
        this.button(
          "Remove current track",
          async () => {
            if (confirm(
              "Remove this track for the rest of the Cup and undo every scored round from this visit? Earlier visits keep their scores."
            ))
              await c.removeTrack();
          },
          "quiet"
        )
      );
    if (controls.childElementCount || s.phase !== "registration") {
      const section = element("section", void 0, "host-round-controls");
      const heading = element("div", void 0, "section-heading");
      heading.append(element("h3", "Round controls"));
      const ghosts = this.button(
        c.hideOtherGhosts ? "Show ghosts" : "Hide ghosts",
        () => this.toggleGhosts(),
        "quiet"
      );
      ghosts.setAttribute("aria-pressed", String(c.hideOtherGhosts));
      heading.append(ghosts);
      section.append(heading, controls);
      this.#body.append(section);
    }
    if (c.isHost && !s.runtime && s.phase !== "complete") {
      const advanced = element("section", void 0, "organizer-settings");
      const label = element("label", void 0, "disconnect-rule");
      label.append(element("span", "If a racer disconnects during a race"));
      const select = element("select");
      select.setAttribute("aria-label", "Disconnect rule");
      for (const [value, text] of [
        ["dnf", "DNF; organizer may void the round"],
        ["void", "Void round and wait for reconnect"]
      ]) {
        const option = element("option", text);
        option.value = value;
        option.selected = value === s.disconnectPolicy;
        select.append(option);
      }
      select.addEventListener(
        "change",
        () => c.change((s2) => {
          s2.disconnectPolicy = select.value === "void" ? "void" : "dnf";
          touch(s2);
        })
      );
      label.append(select);
      advanced.append(label);
      const target = s.phase === "registration" ? this.#body.querySelector(".lobby-action") ?? this.#body : this.#body;
      target.append(advanced);
    }
  }
  scoreboard(personalBests = false) {
    const s = this.#c.cup, board = element("div", void 0, "scoreboard"), rows = standings(s);
    board.classList.toggle("full-scoreboard", personalBests);
    const match = currentMatch(s), run = s.runtime ?? match.roundsLog.at(-1);
    const scope = `${s.id}:${s.matchIndex}:${run?.round}:${run?.trackId}`;
    if (scope !== this.#recordCueScope) {
      this.#recordCueScope = scope;
      this.#recordCues.clear();
    }
    const winners = rows.filter((r) => r.winner), racers = rows.filter((r) => !r.winner);
    if (winners.length) {
      const podium = element("div", void 0, "winner-strip");
      podium.append(element("small", "CUP WINNER"));
      for (const r of winners) podium.append(this.racerName(r.id, this.name(r.id)));
      board.append(podium);
    }
    const heading = element("div", void 0, "ranking-heading");
    heading.append(element("strong", s.phase === "racing" ? "ROUND RANKING" : "CUP STANDINGS"));
    board.append(heading);
    for (const [i, r] of racers.entries()) {
      const row = element(
        "div",
        void 0,
        `score-row${r.id === this.#c.localPlayerId ? " highlighted" : ""}${r.finalist ? " finalist" : ""}${r.id === this.#c.localPlayerId ? " self" : ""}`
      );
      const name = this.racerName(r.id, this.name(r.id), false, personalBests);
      name.title = this.name(r.id);
      const movement = element(
        "small",
        r.movement > 0 ? `\u25B2${r.movement}` : r.movement < 0 ? `\u25BC${-r.movement}` : "",
        r.movement < 0 ? "movement down" : "movement up"
      );
      movement.title = s.phase === "racing" ? "Places gained or lost at the latest race update" : "Places gained or lost in Cup standings this round";
      const points = element("span", void 0, "points");
      const total = element("strong", r.finalist ? "F" : String(r.score));
      total.title = r.finalist ? "Finalist: win an outright round to take the Cup" : `${r.score} of ${currentMatch(s).target} points`;
      const gain = element(
        "small",
        r.gain ? `+${r.gain}` : "",
        `point-gain${r.provisional ? " projected" : ""}`
      );
      gain.title = r.provisional ? "Provisional points if these finish positions hold" : "Points gained this round";
      points.append(total, gain);
      const reading = r.frames ?? r.splitFrames;
      const showGap = s.phase === "racing" ? i > 0 && r.delta !== null : r.delta !== null && r.delta > 0;
      const result = r.dnf ? "DNF" : reading === void 0 ? "\u2014" : showGap ? formatGap(r.delta ?? 0) : formatTime(reading);
      const timing = element("span", result, "time");
      timing.title = r.dnf ? "Retired this round" : r.frames !== void 0 ? `Finish: ${formatTime(r.frames)}` : r.splitFrames !== void 0 ? `Checkpoint ${r.checkpoint + 1}: ${formatTime(r.splitFrames)} \xB7 ${formatGap(r.delta ?? 0)}` : "No checkpoint reached";
      const identity = element("div", void 0, "score-identity");
      identity.append(name);
      if (personalBests) {
        row.classList.add("with-pb");
        const car = name.querySelector(".car-skin");
        if (car) identity.prepend(car);
        const actions = name.querySelector(".player-actions-toggle");
        if (actions) identity.append(actions);
        const track = recordTrack(s);
        const pb = track ? s.records[track]?.pbs[r.id] : null;
        const best = !track ? "\u2014" : !pb ? "Loading\u2026" : pb.frames ? formatTime(pb.frames) : pb.status === "unavailable" ? "Unavailable" : "No record";
        const record = element("small", void 0, "score-pb");
        record.title = "Overall personal best for this track";
        record.append(element("span", "PB"), element("span", best));
        identity.append(record);
      }
      row.append(element("strong", r.position, "position"), identity, movement, points, timing);
      const entry = element("div", void 0, "score-entry");
      entry.dataset.rankingRow = `${personalBests ? "panel" : "hud"}:${scope}:${r.id}`;
      entry.dataset.rankingOrder = String(i);
      entry.append(row);
      const award = run?.recordAwards?.[r.id];
      if (award) {
        if (!this.#recordCues.has(r.id)) this.#recordCues.set(r.id, Date.now());
        const since = this.#recordCues.get(r.id);
        if (Date.now() < since + 6e3) {
          const badge = element("small", award, `record-badge record-badge-${award.toLowerCase()}`);
          badge.title = award === "WR" ? "New world-record time" : award === "TR" ? "New Cup track record" : "New personal best";
          badge.dataset.recordUntil = String(since + 6e3);
          badge.style.animationDelay = `${-Math.min(300, Date.now() - since)}ms`;
          entry.append(badge);
        }
      }
      board.append(entry);
    }
    return board;
  }
  recordStrip(label, record, name, tooltip) {
    const strip = element("div", void 0, `record-strip record-${label.toLowerCase()}`);
    strip.title = tooltip;
    const status = !record ? "Loading\u2026" : "status" in record && record.status === "missing" ? "No record" : "status" in record && record.status === "unavailable" ? "Unavailable" : name;
    const holder = element("span", status, "record-holder");
    if (record && "ids" in record) {
      holder.replaceChildren();
      for (const id of record.ids) {
        if (holder.childNodes.length) holder.append(" / ");
        holder.append(this.playerLabel(id));
      }
    }
    strip.append(
      element("strong", label),
      holder,
      element("strong", record?.frames ? formatTime(record.frames) : "\u2014", "record-time")
    );
    return strip;
  }
  renderHud() {
    this.#hud.replaceChildren();
    this.#povHud.replaceChildren();
    this.#povRecordHud.replaceChildren();
    this.#practiceHud.replaceChildren();
    this.#practiceHud.hidden = true;
    this.#povHud.hidden = true;
    this.#povRecordHud.hidden = true;
    this.#hud.hidden = !this.#c.state || !currentMatch(this.#c.state) || this.#open;
    this.#hud.classList.toggle("spectating", this.#c.canSpectate());
    if (this.#hud.hidden) return;
    const s = this.#c.cup, m = currentMatch(s), id = recordTrack(s), track = s.tracks.find((t) => t.id === id);
    const title = element("div", void 0, "hud-track");
    title.append(element("strong", track?.name ?? s.name));
    const sub = element("div", void 0, "hud-meta"), round = s.runtime?.round ?? Math.max(1, m.rounds);
    const visit = trackProgress(s, round - 1);
    if (!visit || !id) return;
    const picked = s.roster.filter((p) => chosenTracks(s, p.id).includes(id)).map((p) => p.name).join(", ");
    const picker = element(
      "span",
      rulesFor(s).selection === "random" ? "Random track" : "Picked by ",
      "track-pickers"
    );
    for (const player2 of s.roster.filter((p) => chosenTracks(s, p.id).includes(id))) {
      if (picker.childNodes.length > 1) picker.append(", ");
      picker.append(this.playerLabel(player2.id));
    }
    picker.title = picked;
    sub.append(picker, element("strong", `ROUND ${visit.round}/${visit.rounds}`));
    title.append(sub);
    const status = element("div", void 0, "hud-phase");
    status.append(
      element(
        "span",
        s.phase === "between-rounds" && this.#c.needsRebind.size ? "Cup paused" : names[s.phase]
      )
    );
    title.append(status);
    const records = s.records[id], tr = sessionRecord(s, id);
    const summary = element("div", void 0, "hud-summary");
    summary.append(
      title,
      this.recordStrip(
        "WR",
        records?.wr,
        records?.wr?.name,
        "Overall leaderboard record. Official/community tracks use verified records; custom tracks use their public leaderboard."
      ),
      this.recordStrip(
        "TR",
        tr ?? { status: "missing" },
        tr?.ids.map((id2) => this.name(id2)).join(" / "),
        "Fastest scored run on this track in this Cup, including current round provisionally. Voided rounds are excluded."
      )
    );
    this.#hud.append(summary, this.scoreboard());
    if (s.phase === "warmup") {
      this.#practiceHud.hidden = false;
      this.#practiceHud.append(this.practiceControls());
    } else if (roundDone(s, this.#c.localPlayerId) && !this.#c.canSpectate() && this.#c.watchable().length) {
      this.#practiceHud.hidden = false;
      this.#practiceHud.append(
        this.button("Watch remaining racers", () => this.#c.watchRemaining())
      );
    }
    if (this.#c.canSpectate() && this.#c.watchable().length) {
      this.#povHud.hidden = false;
      this.#povHud.append(this.spectatorControls());
      this.#povRecordHud.hidden = false;
      this.#povRecordHud.append(this.spectatorRecord());
    }
  }
  spectatorControls() {
    const c = this.#c, box = element("section", void 0, "pov"), racers = c.watchable();
    box.setAttribute("aria-label", "Spectator controls");
    const previous = this.button("", () => c.cycleWatch(-1), "pov-cycle previous");
    const next = this.button("", () => c.cycleWatch(1), "pov-cycle next");
    for (const [button, label, key] of [
      [previous, "Previous racer", "["],
      [next, "Next racer", "]"]
    ]) {
      button.setAttribute("aria-label", `${label} (${key})`);
      button.setAttribute("aria-keyshortcuts", key);
      button.title = `${label} (${key})`;
      button.disabled = racers.length < 2;
      const icon = element("span", void 0, "pov-arrow");
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
    }
    const main = element("div", void 0, "pov-main"), name = element("div", void 0, "pov-name");
    const selected = element("span", void 0, "pov-selected");
    if (c.watchId !== null && racers.includes(c.watchId))
      selected.append(this.playerLabel(c.watchId));
    else selected.textContent = "Waiting for racer";
    name.title = c.watchId !== null && racers.includes(c.watchId) ? this.name(c.watchId) : "Waiting for racer";
    name.append(selected);
    main.append(name);
    box.append(previous, main, next);
    return box;
  }
  spectatorRecord() {
    const c = this.#c, id = recordTrack(c.cup), watching = c.watchId !== null && c.watchable().includes(c.watchId);
    const pb = watching && id ? c.cup.records[id]?.pbs[c.watchId] : null;
    const record = element("div", void 0, "pov-pb");
    const best = !watching ? "\u2014" : !pb ? "Loading\u2026" : pb.frames ? formatTime(pb.frames) : pb.status === "unavailable" ? "Unavailable" : "No record";
    record.title = `${watching ? `${this.name(c.watchId)} \u2014 ` : ""}Overall personal best for this track${pb?.source ? ` (${pb.source === "online" ? "online leaderboard" : "saved profile"})` : ""}`;
    record.append(element("span", "PB"), element("strong", best));
    return record;
  }
  results() {
    const s = this.#c.cup;
    if (s.phase === "complete") {
      const board = element("div", void 0, "final-standings");
      board.append(element("h2", "Final standings"));
      for (const r of resultRows(s)) {
        const row = element("div", void 0, `final-row${r.winner ? " champion" : ""}`);
        const score = element("span", r.score, "final-score");
        score.title = "Cup points";
        row.append(element("strong", r.place), this.racerName(r.id, r.name, false, true));
        if (r.winner) row.append(element("span", "Winner", "winner-label"));
        row.append(score);
        board.append(row);
      }
      this.#body.append(board);
      const controls = element("div", void 0, "controls result-controls");
      if (this.#c.isHost)
        controls.append(
          this.button("Race again", () => this.#c.rematch(), "primary"),
          this.button("Choose new tracks", () => this.#c.rematch(true))
        );
      controls.append(this.button("Save results image", () => this.downloadImage(), "quiet"));
      this.#resultControls = controls;
    }
    const history = element("section", void 0, "race-history");
    history.append(element("h3", this.#c.isHost ? "Race history" : "Latest round"));
    const parent = this.#body;
    this.#body.append(history);
    this.#body = history;
    if (!s.matches.length) this.#body.append(element("p", "No scored rounds yet.", "muted"));
    for (const m of s.matches) {
      this.#body.append(element("h3", m.name));
      if (!m.roundsLog.length) this.#body.append(element("p", "No scored rounds yet.", "muted"));
      for (const r of m.roundsLog.slice(-20).reverse()) {
        this.#body.append(
          element(
            "p",
            `Round ${r.round}: ${m.players.map((id) => `${this.name(id)} ${r.finishes[id] === void 0 ? "DNF" : formatTime(r.finishes[id])}`).join(" / ")}${r.tiedFirst ? " \xB7 Tied first: no finalist win" : ""}`,
            "history"
          )
        );
      }
    }
    this.#body = parent;
  }
  practiceControls() {
    const c = this.#c, s = c.cup, run = c.round, box = element("div", void 0, "practice-controls");
    const ready = run.practiceReady ?? [], ids = activeIds(s);
    const count = element(
      "span",
      rulesFor(s).readyEndsWarmup ? `${ready.length}/${ids.length} ready` : "Practice"
    ), clock = element("strong");
    clock.dataset.clock = "";
    box.append(count, clock);
    if (rulesFor(s).readyEndsWarmup && c.localPlayerId !== null && ids.includes(c.localPlayerId)) {
      const button = this.button(
        ready.includes(c.localPlayerId) ? "Ready \u2713" : "Ready",
        () => c.action("practice-ready", run.id),
        "primary"
      );
      button.disabled = ready.includes(c.localPlayerId);
      box.append(button);
    }
    return box;
  }
  renderCompletion() {
    const s = this.#c.state, winner = s?.phase === "complete" ? resultRows(s).find((r) => r.winner) : null;
    if (!winner) {
      clearTimeout(this.#finishTimer);
      this.#finishCue.hidden = true;
      this.#finishKey = null;
      return;
    }
    const key = `${s.id}:${currentMatch(s).rounds}:${winner.id}`;
    if (this.#finishKey === key) return;
    this.#finishKey = key;
    this.#open = false;
    this.#finishCue.hidden = false;
    this.#finishCue.replaceChildren();
    const card = element("div", void 0, "champion-card");
    card.append(
      element("h2", "Cup winner"),
      this.racerName(winner.id, winner.name),
      this.button("View results", () => this.showResults(key), "primary")
    );
    this.#finishCue.append(card);
    clearTimeout(this.#finishTimer);
    this.#finishTimer = setTimeout(() => this.showResults(key), 2500);
  }
  showResults(key) {
    if (this.#finishKey !== key || this.#c.state?.phase !== "complete") return;
    clearTimeout(this.#finishTimer);
    this.#finishCue.hidden = true;
    this.#open = true;
    this.#signature = "";
    this.render();
  }
  async downloadImage() {
    const state = structuredClone(this.#c.cup), blob = await resultsImage(state, (id) => this.thumbnail(id));
    const url = URL.createObjectURL(blob), a = element("a");
    a.href = url;
    a.download = "polycup-results.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
};

// src/version-check.ts
function registerVersionCheck(pml, insert) {
  const version = JSON.stringify(VERSION);
  pml.registerClassMixin("ii.prototype", "renewInvite", {
    type: insert,
    token: "const h = [];",
    func: `
      const cupMods = o.mods.filter(mod => typeof mod === 'string' && mod.startsWith('polytrack-world-cup:'));
      if (cupMods.length !== 1 || cupMods[0] !== 'polytrack-world-cup:' + ${version}) {
        e.send(JSON.stringify({version:'0.6.3',type:'declineJoin',session:t,
          reason:'IncompatibleMods',polyCupVersion:${version}}));
        return;
      }
    `
  });
  pml.registerClassMixin("vc.prototype", "joinInvite", {
    type: insert,
    token: "const s = [];",
    func: `
      const cupMods = t.mods.filter(mod => typeof mod === 'string' && mod.startsWith('polytrack-world-cup:'));
      if (cupMods.length && (cupMods.length !== 1 || cupMods[0] !== 'polytrack-world-cup:' + ${version})) {
        const required = cupMods[0].slice('polytrack-world-cup:'.length).replace(/[^a-zA-Z0-9.+-]/g,'').slice(0,40);
        const error = new Dl('polycup-version');
        error.message = 'PolyCup version mismatch. Host: ' + required + '. Installed: ' + ${version} + '. Install the same version as the host, then rejoin.';
        o(error); u.close(); return;
      }
    `
  });
  pml.registerClassMixin("vc.prototype", "joinInvite", {
    type: insert,
    token: "const e = t.reason;",
    func: `
      if (e === 'IncompatibleMods') {
        const required = typeof t.polyCupVersion === 'string' ? t.polyCupVersion.replace(/[^a-zA-Z0-9.+-]/g,'').slice(0,40) : null;
        const error = new Dl('polycup-version');
        error.message = required
          ? 'PolyCup version mismatch. Host: ' + required + '. Installed: ' + ${version} + '. Install the same version as the host, then rejoin.'
          : 'Incompatible mods. Installed PolyCup: ' + ${version} + '. PolyCup versions must match. Check the host\u2019s mods and versions, then rejoin.';
        o(error); u.close(); return;
      }
    `
  });
  pml.registerFuncMixin("qc", {
    type: insert,
    token: "switch (e.errorType) {",
    func: `case 'polycup-version': n = e.message; break;`
  });
}

// src/main.ts
var { PolyMod, MixinType } = await import(new URL("PolyTypes.js", document.baseURI).href);
var PolyCup = class _PolyCup extends PolyMod {
  #controller;
  #ui;
  #physics = new PhysicsIntegrity();
  constructor() {
    super();
    for (const hook of ["preInit", "init", "postInit", "onGameLoad"]) {
      Object.defineProperty(this, hook, {
        value: _PolyCup.prototype[hook].bind(this),
        writable: false
      });
    }
  }
  preInit(pml) {
    this.#physics.install(pml);
    registerCarVisibility(pml, MixinType.INSERT);
  }
  init(pml) {
    this.#controller = new Controller(() => this.#ui?.render());
    this.#controller.setPhysicsSource(() => this.#physics.report);
    try {
      registerVersionCheck(pml, MixinType.INSERT);
      this.#controller.init(pml);
      pml.registerSettingCategory("PolyCup");
      pml.registerSetting("Spectate after finishing", "PolyCupAutoSpectate", "boolean", true);
      pml.registerBindCategory("PolyCup");
      pml.registerKeybind(
        "Open Cup chat",
        "PolyCupChat",
        "keydown",
        "KeyY",
        null,
        (event) => this.#ui?.chatHotkey(event)
      );
      pml.registerKeybind(
        "Toggle other players' ghosts",
        "PolyCupToggleGhosts",
        "keydown",
        "KeyG",
        null,
        (event) => this.#ui?.ghostHotkey(event)
      );
    } catch (error) {
      this.#controller.fail(error);
    }
  }
  postInit() {
    if (!this.#ui) this.#ui = new CupUI(this.#controller);
    this.#ui.render();
  }
  onGameLoad() {
    this.postInit();
  }
};
var polyMod = new PolyCup();
export {
  polyMod
};
