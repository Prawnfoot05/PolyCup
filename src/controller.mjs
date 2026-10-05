import * as Cup from './cup.mjs';
import { connectNative, CupTransport } from './native.mjs';
import { CameraBuffer, validPose } from './spectator.mjs';
export class Controller {
  constructor(onChange) {
    this.onChange = onChange; this.state = null; this.game = null; this.connection = null;
    this.isHost = false; this.selfId = null; this.lobby = []; this.tracks = new Map();
    this.hello = new Set(); this.offset = 0; this.bestRtt = Infinity; this.error = '';
    this.resetKey = ''; this.startKey = ''; this.readyKey = ''; this.lastBroadcast = 0;
    this.transport = new CupTransport((id, m) => this.receive(id, m), () => { this.lastBroadcast = 0; });
    this.trackUploads = new Map(); this.pendingUpload = null; this.transferProgress = '';
    this.recordRequests = new Map(); this.lastRecordPoll = 0;
    this.lastTick = 0; this.lastHello = 0; this.lastSaved = -1; this.auto = false;
    this.cameraTransport = new CupTransport((id, m) => this.receiveCamera(id, m), () => {}, { channelId: 43, realtime: true });
    this.cameraBuffers = new Map(); this.subscriptions = new Map(); this.watchId = null;
    this.lastPose = 0; this.lastSubscribe = 0; this.watchStatus = ''; this.watchedPose = null;
    this.hideOtherGhosts = false;
    this.syncSequence = 0; this.receivedSequence = -1;
    this.panelRequest = { revision: 0, open: false, message: '' }; this.roundViewKey = '';
  }
  init(pml) { this.native = connectNative(pml, this); this.timer = setInterval(() => this.tick(), 100); }
  now() { return Date.now() + (this.isHost ? 0 : this.offset); }
  gameDisposed(game) {
    // Track changes replace the game immediately. Leaving a lobby does not.
    setTimeout(() => {
      if (this.game !== game) return;
      this.transport.dispose(); this.cameraTransport.dispose(); this.connection = null;
      this.game = null; this.info = null; this.state = null; this.lobby = []; this.selfId = null;
      this.auto = false; this.isHost = false; this.cameraBuffers.clear(); this.onChange();
    },500);
  }
  fail(error) { this.error = error?.message ?? String(error); console.error('[PolyCup]', error); this.onChange(); }
  observeGame(game) {
    if (!this.native) return;
    const info = this.native.read(game);
    if (!info.connection) return;
    this.game = game; this.info = info;
    if (this.connection !== info.connection) {
      this.transport.dispose(); this.cameraTransport.dispose(); this.cameraBuffers.clear(); this.subscriptions.clear();
      this.hello.clear(); this.connection = info.connection; this.trackUploads.clear(); this.recordRequests.clear();
      this.isHost = this.connection instanceof this.native.Host;
      this.state = null; this.resetKey = ''; this.readyKey = ''; this.lastSaved = -1;
      this.offset = 0; this.bestRtt = Infinity; this.watchId = null; this.needsRebind = new Set();
      this.syncSequence = 0; this.receivedSequence = -1; this.roundViewKey = ''; this.viewCupId = null;
      this.onChange();
    }
    if (!this.state) return;
    const racing = Cup.activeIds(this.state).includes(this.selfId);
    const phase = this.state.phase;
    if (!racing && info.spectator) info.spectator.isEnabled = true;
    const run = this.state.runtime;
    if (run && ['warmup', 'countdown', 'racing'].includes(phase) && info.sessionId === run.sessionId) {
      const resetKey = `${run.id}:${phase === 'warmup' ? 'warmup' : 'race'}`;
      if (this.resetKey !== resetKey) {
        this.resetKey = resetKey; this.startKey = '';
        this.native.reset(game); this.native.clearRecords(this.connection);
        if (racing) info.spectator.isEnabled = false;
        this.info = this.native.read(game);
        if (phase !== 'warmup' && racing) this.hookFinish(this.info.car, run);
      }
      const startDue = (phase === 'countdown' || phase === 'racing') && this.now() >= run.startsAt;
      if (racing && startDue && this.startKey !== run.id) {
        this.startKey = run.id; this.info.car.start();
      }
    }
  }
  shouldBlock(game) {
    if (!this.state || game !== this.game) return false;
    if (!Cup.activeIds(this.state).includes(this.selfId)) return true;
    if (this.info.sessionId !== this.state.runtime?.sessionId) return true;
    if (this.state.phase === 'warmup') return false;
    return !(['racing', 'countdown'].includes(this.state.phase) && this.state.runtime?.startsAt !== null &&
      this.now() >= this.state.runtime.startsAt && !(this.selfId in this.state.runtime.finishes) &&
      !this.state.runtime.dnfs.includes(this.selfId));
  }
  shouldBlockRestart(game) {
    return !!this.state && game === this.game && this.state.phase !== 'warmup';
  }
  hookFinish(car, run) {
    let checkpoint = null;
    const checkpointIndex = this.info.checkpointCount - 2;
    car.addCheckpointCallback(index => {
      if (index === checkpointIndex && checkpointIndex >= 0) checkpoint = car.getTime().numberOfFrames;
    });
    car.addFinishCallback(() => {
      if (this.state?.phase !== 'racing' || this.state.runtime?.id !== run.id) return;
      const message = { type: 'finish', roundId: run.id, sessionId: run.sessionId,
        frames: car.getTime().numberOfFrames, checkpoint };
      if (this.isHost) this.receiveFinish(this.selfId, message);
      else this.transport.send(0, message);
    });
  }
  receiveFinish(id, m) {
    const run = this.state?.runtime;
    if (!run || m.roundId !== run.id || m.sessionId !== run.sessionId) return;
    if (Cup.recordFinish(this.state, id, m.frames, this.now())) {
      if (Number.isSafeInteger(m.checkpoint) && m.checkpoint >= 0 && m.checkpoint <= m.frames) run.checkpoints[id] = m.checkpoint;
      this.broadcast();
    }
  }
  canSpectate() { return !!this.state && !Cup.activeIds(this.state).includes(this.selfId); }
  toggleGhosts() {
    if (!this.state) return;
    this.hideOtherGhosts = !this.hideOtherGhosts; this.onChange();
  }
  watchable() { return this.state ? Cup.activeIds(this.state).filter(id => this.lobby.some(p => p.id === id)) : []; }
  cycleWatch(delta) {
    const ids = this.watchable(); if (!this.canSpectate() || !ids.length) return;
    const i = ids.indexOf(this.watchId); this.selectWatch(ids[(i + delta + ids.length) % ids.length]);
  }
  selectWatch(id) {
    if (!this.canSpectate() || !this.watchable().includes(id)) return;
    this.watchId = id; this.lastSubscribe = 0; this.watchedPose = null; this.lastWatchPose = null; this.onChange();
  }
  afterGame(game) {
    if (game !== this.game || this.info?.disposed) return;
    if (!this.state) { if(this.filteredCars) this.native.visibility(game,null,this.selfId); this.filteredCars=false; return; }
    const now = this.now(), active = Cup.activeIds(this.state);
    if (this.canSpectate() && !this.watchable().includes(this.watchId)) this.selectWatch(this.watchable()[0]);
    const viewed = active.includes(this.selfId) ? this.selfId : this.watchId;
    this.native.visibility(game,this.hideOtherGhosts ? active.filter(id => id === viewed) : active,this.selfId); this.filteredCars=true;
    if (active.includes(this.selfId) && now - this.lastPose >= 50 && !this.info.spectator.isEnabled) {
      this.lastPose = now;
      const pose = { ...this.native.camera(game), at: now };
      if (this.isHost) this.relayCamera(this.selfId, pose);
      else this.cameraTransport.send(0, { type: 'camera', pose });
    }
    if (!this.canSpectate()) { this.watchedPose = null; return; }
    if (!this.isHost && Date.now() - this.lastSubscribe > 1000) {
      if (this.transport.send(0, { type: 'watch', value: this.watchId })) this.lastSubscribe = Date.now();
    }
    const buffer = this.cameraBuffers.get(this.watchId);
    const pose = buffer?.playback(now, this.info.sessionId, performance.now());
    this.watchedPose = pose ?? null;
    this.watchStatus = pose ? 'Buffered POV' : 'Waiting for racer camera';
    if (pose) this.lastWatchPose = pose;
    else if (!this.lastWatchPose || this.lastWatchPose.sessionId !== this.info.sessionId)
      this.lastWatchPose = { ...this.native.camera(game), carPosition: undefined, carQuaternion: undefined };
    this.native.follow(game, this.lastWatchPose, this.watchId);
  }
  receiveCamera(id, message) {
    if (message.type !== 'camera' || !validPose(message.pose) || !this.state ||
      Math.abs(message.pose.at - this.now()) > 5000 || message.pose.sessionId !== this.info?.sessionId) return;
    if (this.isHost) {
      if (this.hello.has(id) && Cup.activeIds(this.state).includes(id)) this.relayCamera(id, message.pose);
    } else if (id === 0 && message.racerId === this.watchId) this.bufferCamera(message.racerId, message.pose);
  }
  bufferCamera(id, pose) {
    if (!this.cameraBuffers.has(id)) this.cameraBuffers.set(id, new CameraBuffer());
    this.cameraBuffers.get(id).push(pose);
  }
  relayCamera(id, pose) {
    this.bufferCamera(id, pose);
    for (const [spectator, watched] of this.subscriptions) if (watched === id && !Cup.activeIds(this.state).includes(spectator))
      this.cameraTransport.send(spectator, { type: 'camera', racerId: id, pose });
  }
  tick() {
    try {
      if (!this.connection || !this.native || !this.game) return;
      this.info = this.native.read(this.game);
      if (this.info.disposed) return;
      this.lobby = this.connection.getPlayers(); this.selfId = this.lobby.find(p => p.isSelf)?.id ?? null;
      this.transport.sync(this.native.peers(this.connection));
      this.cameraTransport.sync(this.native.peers(this.connection));
      if (Date.now() - this.lastHello > 2000) {
        this.lastHello = Date.now();
        if (!this.isHost) this.transport.send(0, { type: 'hello', version: Cup.VERSION, sentAt: Date.now() });
      }
      if (!this.state) {
        if (this.isHost && Date.now() - this.lastBroadcast > 1000) this.broadcast();
        this.onChange(); return;
      }
      this.sendReady();
      this.refreshRecords();
      for (const [id, upload] of this.trackUploads) if (upload.until < Date.now()) this.trackUploads.delete(id);
      if (this.isHost) {
        this.checkDisconnects();
        this.advanceClock();
        if (this.state.phase === 'racing' && this.info.sessionId === this.state.runtime.sessionId) {
          const run = this.state.runtime;
          if (Cup.allFinished(this.state) || (run.deadline !== null && this.now() >= run.deadline + 1500)) this.finishRound();
        }
        if (this.auto && this.state.phase === 'between-rounds' && this.nextAuto && Date.now() >= this.nextAuto) {
          this.nextAuto = null; this.runRound();
        }
        if (Date.now() - this.lastBroadcast > 1000 || this.sentRevision !== this.state.revision) this.broadcast();
        this.save();
      }
      this.onChange();
    } catch (error) { this.auto = false; this.fail(error); }
  }
  create(name) {
    this.requireHost(); this.state = Cup.newCup(name); this.tracks.clear(); this.error = '';
    this.needsRebind = new Set(); this.trackUploads.clear(); this.recordRequests.clear(); this.auto = true;
    this.lastSaved = -1; this.broadcast(); this.onChange();
  }
  requireHost() { if (!this.isHost || !this.connection) throw new Error('Host a PolyTrack multiplayer lobby first.'); }
  requestPanel(open, message = '') {
    this.panelRequest = { revision: this.panelRequest.revision + 1, open, message };
  }
  syncRoundPanel() {
    const s = this.state, run = s?.runtime;
    const key = JSON.stringify([s?.id, s?.phase, run?.id, run?.sessionId]);
    if (key === this.roundViewKey) return;
    this.roundViewKey = key;
    if (run && ['loading', 'warmup', 'countdown', 'racing'].includes(s.phase)) {
      this.requestPanel(false);
    } else if (s && this.viewCupId !== s.id) {
      this.requestPanel(true);
    }
    this.viewCupId = s?.id ?? null;
  }
  releaseCup(message) {
    this.state = null; this.auto = false; this.nextAuto = null; this.loadingSession = undefined;
    this.resetKey = ''; this.startKey = ''; this.readyKey = ''; this.error = '';
    this.cameraBuffers.clear(); this.subscriptions.clear(); this.recordRequests.clear(); this.trackUploads.clear();
    this.watchId = null; this.watchedPose = null; this.lastWatchPose = null; this.watchStatus = '';
    if (this.pendingUpload) this.pendingUpload.error = 'The Cup ended.';
    this.transferProgress = ''; this.roundViewKey = ''; this.viewCupId = null;
    if (this.game && !this.info?.disposed) {
      this.native?.release?.(this.game);
      if (this.info?.spectator) this.info.spectator.isEnabled = false;
      this.native?.visibility?.(this.game, null, this.selfId); this.filteredCars = false;
    }
    this.requestPanel(false, message);
  }
  endCup() {
    this.requireHost(); if (!this.state) return;
    this.save(); // Keep the last Cup available through Restore autosave.
    this.releaseCup('Cup ended · Normal multiplayer');
    this.broadcast(); this.onChange();
  }
  acceptTrack(actor, code) {
    if (typeof code !== 'string' || code.length > 2000000) throw new Error('The track code is too large.');
    const track = this.native.parse(code.trim());
    if (!track?.trackData?.hasStartingPoint()) throw new Error('The code must contain a valid PolyTrack track with a start.');
    const id = track.trackData.getId();
    Cup.chooseTrack(this.state, actor, { id, name: track.trackMetadata.name });
    this.tracks.set(id, { ...track, code: code.trim() });
    this.pruneTrackData(); this.broadcast();
  }
  pruneTrackData() { for (const id of this.tracks.keys()) if (!this.state.tracks.some(t => t.id === id)) this.tracks.delete(id); }
  async importTrack(code) {
    if (this.state?.phase !== 'registration' || !Cup.player(this.state, this.selfId)) throw new Error('Join as a racer before choosing a track.');
    if (typeof code !== 'string' || !code.trim() || code.length > 2000000) throw new Error('Choose a valid track of up to 2 MB.');
    if (this.isHost) { this.acceptTrack(this.selfId, code); return; }
    if (this.pendingUpload) throw new Error('Your previous track is still uploading.');
    const cupId = this.state.id, connection = this.connection, transferId = crypto.randomUUID();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const pending = { transferId, done: false, error: null }; this.pendingUpload = pending;
    const send = async message => {
      const deadline = Date.now() + 5000;
      while (true) {
        if (this.connection !== connection || this.state?.id !== cupId || this.state.phase !== 'registration') throw new Error('The Cup changed during track upload.');
        if (pending.error) throw new Error(pending.error);
        if (this.transport.send(0, { ...message, cupId, transferId })) return;
        if (Date.now() > deadline) throw new Error('Track upload lost its connection. Try again.');
        await sleep(100);
      }
    };
    try {
      await send({ type: 'track-begin', length: code.length });
      for (let offset = 0, seq = 0; offset < code.length; offset += 24000, seq++) {
        await sleep(100); await send({ type: 'track-chunk', seq, data: code.slice(offset, offset + 24000) });
        this.transferProgress = `Sending track · ${Math.min(100, Math.round((offset + 24000) / code.length * 100))}%`; this.onChange();
      }
      await send({ type: 'track-end' });
      const deadline = Date.now() + 15000;
      while (!pending.done && !pending.error && Date.now() < deadline) await sleep(100);
      if (pending.error) throw new Error(pending.error);
      if (!pending.done) throw new Error('The organizer did not confirm the track. Try again.');
    } finally { this.pendingUpload = null; this.transferProgress = ''; this.onChange(); }
  }
  receiveTrack(id, m) {
    if (!this.hello.has(id) || this.state?.phase !== 'registration' || m.cupId !== this.state.id || !Cup.player(this.state, id)) return;
    if (typeof m.transferId !== 'string' || m.transferId.length > 64) return;
    try {
      if (m.type === 'track-begin') {
        if (!Number.isSafeInteger(m.length) || m.length < 1 || m.length > 2000000) throw new Error('Invalid track size.');
        this.trackUploads.set(id, { transferId: m.transferId, cupId: m.cupId, length: m.length, data: '', seq: 0, until: Date.now() + 30000 }); return;
      }
      const u = this.trackUploads.get(id);
      if (!u || u.transferId !== m.transferId || u.cupId !== m.cupId || u.until < Date.now()) throw new Error('Track transfer expired. Select the track again.');
      if (m.type === 'track-chunk') {
        if (m.seq !== u.seq || typeof m.data !== 'string' || !m.data.length || m.data.length > 24000 || u.data.length + m.data.length > u.length) throw new Error('Invalid track chunk.');
        u.data += m.data; u.seq++; return;
      }
      if (m.type === 'track-end') {
        if (u.data.length !== u.length) throw new Error('Incomplete track upload. Try again.');
        this.trackUploads.delete(id); this.acceptTrack(id, u.data);
        this.transport.send(id, { type: 'track-ack', transferId: m.transferId });
      }
    } catch (e) { this.trackUploads.delete(id); this.transport.send(id, { type: 'track-ack', transferId: m.transferId, error: e.message }); }
  }
  availableTracks() {
    if (!this.native?.trackLibrary) throw new Error('The game track library is not ready. Open the normal track selector once, then try again.');
    const tracks = [];
    this.native.trackLibrary.forEachTrack((id, metadata, category, environment, load, thumbnail) => {
      tracks.push({ id, name: metadata.name, author: metadata.author, category, thumbnail, load });
    });
    return tracks;
  }
  async addLibraryTrack(entry) {
    const state = this.state, connection = this.connection;
    if (state?.phase !== 'registration') throw new Error('Tracks can only be selected during registration.');
    const track = await entry.load();
    if (this.state !== state || this.connection !== connection || state.phase !== 'registration')
      throw new Error('The tournament changed while the track was loading. Select it again.');
    // Export the actual native track, so autosaves and native multiplayer transfers
    // work even when other players have never installed this custom track.
    await this.importTrack(track.trackData.toExportString(track.trackMetadata));
    this.error = ''; this.onChange();
  }
  change(fn) { this.requireHost(); fn(this.state); this.error = ''; this.broadcast(); this.onChange(); }
  action(type, value) {
    if (this.isHost) this.handleAction(this.selfId, { type, value, cupId: this.state?.id });
    else this.transport.send(0, { type, value, cupId: this.state?.id });
  }
  handleAction(actor, m) {
    if (!this.state || !this.hello.has(actor) && actor !== this.selfId) return;
    if (m.cupId !== this.state.id) return;
    if (m.type === 'join') {
      const p = this.lobby.find(p => p.id === actor); if (!p) return;
      Cup.addPlayer(this.state, actor, p.nickname);
    } else if (m.type === 'leave') { Cup.removePlayer(this.state, actor); this.pruneTrackData(); }
    else if (m.type === 'dnf' && m.value === this.state.runtime?.id) Cup.markDNF(this.state, actor);
    else return;
    this.broadcast();
  }
  receive(id, m) {
    if (this.isHost) {
      if (m.type === 'hello' && m.version === Cup.VERSION && Number.isFinite(m.sentAt)) {
        this.hello.add(id);
        this.transport.send(id, { type: 'hello-ack', version: Cup.VERSION, sentAt: m.sentAt, hostAt: Date.now() });
        this.transport.send(id, this.syncMessage());
      } else if (m.type === 'ready' && this.hello.has(id)) this.markReady(id, m);
      else if (m.type === 'finish' && this.hello.has(id)) this.receiveFinish(id, m);
      else if (m.type === 'watch' && this.hello.has(id)) {
        if (this.state && !Cup.activeIds(this.state).includes(id) && Cup.activeIds(this.state).includes(m.value)) this.subscriptions.set(id, m.value);
        else this.subscriptions.delete(id);
      }
      else if (m.type === 'pb' && this.hello.has(id)) this.receivePB(id, m);
      else if (['track-begin', 'track-chunk', 'track-end'].includes(m.type)) this.receiveTrack(id, m);
      else if (['join', 'leave', 'dnf'].includes(m.type)) {
        try { this.handleAction(id, m); } catch (e) { this.transport.send(id, { type: 'error', message: e.message }); }
      }
    } else if (id === 0) {
      if (m.type === 'track-ack' && this.pendingUpload?.transferId === m.transferId) {
        this.pendingUpload.done = !m.error; this.pendingUpload.error = m.error ? String(m.error).slice(0,200) : null;
      } else if (m.type === 'hello-ack' && Number.isFinite(m.sentAt) && Number.isFinite(m.hostAt)) {
        const rtt = Date.now() - m.sentAt;
        if (rtt >= 0 && rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = m.hostAt + rtt / 2 - Date.now(); }
      } else if (m.type === 'state' && Number.isSafeInteger(m.sequence) && m.sequence > this.receivedSequence &&
        (m.state === null || validSnapshot(m.state))) {
        this.receivedSequence = m.sequence;
        if (m.state === null) {
          if (this.state) this.releaseCup('Organizer ended the Cup · Normal multiplayer');
        } else { this.state = m.state; this.error = ''; }
        this.syncRoundPanel();
      } else if (m.type === 'error') this.error = String(m.message).slice(0, 200);
    }
    this.onChange();
  }
  refreshRecords() {
    if (Date.now() - this.lastRecordPoll < 5000 || !this.native?.personalBest || !this.state) return;
    this.lastRecordPoll = Date.now();
    const state = this.state, cupId = state.id, connection = this.connection;
    const trackId = state.runtime?.trackId ?? Cup.nextTrack(state);
    if (!trackId) return;
    const stillCurrent = () => this.state?.id === cupId && this.connection === connection;
    const launch = (key, interval, fn) => {
      const old = this.recordRequests.get(key);
      if (old && (old.pending || old.until > Date.now())) return;
      const request = { pending: true, until: Date.now() + interval }; this.recordRequests.set(key, request);
      Promise.resolve().then(fn).catch(() => {}).finally(() => { request.pending = false; });
    };
    if (Cup.player(state, this.selfId)) {
      const actor = this.selfId;
      launch(`${cupId}:pb:${trackId}:${actor}`, 5000, async () => {
        const pb = await this.native.personalBest(this.game, trackId);
        if (!stillCurrent() || this.selfId !== actor || !validPB(pb)) return;
        const message = { type: 'pb', cupId, trackId, pb };
        if (this.isHost) this.receivePB(actor, message); else this.transport.send(0, message);
      });
    }
    if (this.isHost) launch(`${cupId}:wr:${trackId}`, 120000, async () => {
      const wr = await this.native.worldRecord(this.game, trackId);
      if (!stillCurrent() || !this.state.tracks.some(t => t.id === trackId)) return;
      const records = this.state.records[trackId] ??= { pbs: {} };
      if (JSON.stringify(records.wr) !== JSON.stringify(wr)) { records.wr = wr; Cup.touch(this.state); this.broadcast(); }
    });
  }
  receivePB(actor, m) {
    const s = this.state;
    if (!s || m.cupId !== s.id || !Cup.player(s, actor) || !s.tracks.some(t => t.id === m.trackId) || !validPB(m.pb)) return;
    const pb = m.pb.status === 'ready' ? { status: 'ready', frames: m.pb.frames, source: m.pb.source } : { status: m.pb.status };
    const r = s.records[m.trackId] ??= { pbs: {} };
    if (JSON.stringify(r.pbs[actor]) !== JSON.stringify(pb)) { r.pbs[actor] = pb; Cup.touch(s); this.broadcast(); }
  }
  startCup() {
    this.requireHost();
    if (this.state.roster.some(p => this.needsRebind?.has(p.id) || !this.lobby.some(l => l.id === p.id) || p.id !== this.selfId && (!this.hello.has(p.id) || !this.transport.has(p.id))))
      throw new Error('Every racer must be connected with the current mod before starting.');
    Cup.lockRegistration(this.state); this.trackUploads.clear(); this.broadcast(); this.runRound();
  }
  networkState() {
    const state = Cup.publicState(this.state);
    // The complete journal stays on the host/export; live peers need only the latest round.
    state.audit = state.audit.slice(-8);
    state.matches.forEach(m => { m.roundsLog = m.roundsLog.slice(-1); });
    return state;
  }
  broadcast() {
    this.transport.broadcast(this.syncMessage());
    this.sentRevision = this.state?.revision; this.lastBroadcast = Date.now();
  }
  syncMessage() {
    this.syncRoundPanel();
    return { type: 'state', sequence: ++this.syncSequence, state: this.state ? this.networkState() : null };
  }
  runRound() {
    this.requireHost();
    if (!['dnf', 'void'].includes(this.state.disconnectPolicy)) throw new Error('Choose a disconnect rule in Tournament before starting.');
    if (this.state.roster.some(p => this.needsRebind?.has(p.id))) throw new Error('Confirm every saved racer’s lobby identity in Racers before resuming.');
    for (const id of Cup.activeIds(this.state)) {
      if (!this.lobby.some(p => p.id === id)) throw new Error(`${Cup.player(this.state, id).name} is disconnected. Reconnect or replace their lobby identity.`);
      if (id !== this.selfId && (!this.hello.has(id) || !this.transport.has(id))) throw new Error(`${Cup.player(this.state, id).name} must load PolyCup ${Cup.VERSION}.`);
    }
    const track = this.tracks.get(Cup.nextTrack(this.state));
    if (!track) throw new Error('The selected track is missing from this organizer’s saved pack.');
    Cup.beginRound(this.state); this.readyKey = ''; this.nextAuto = null;
    this.loadingSession = this.info.sessionId;
    this.broadcast();
    this.connection.startNewSession(1, track.trackMetadata, track.trackData);
  }
  checkDisconnects() {
    const s = this.state;
    if (!s?.runtime) return;
    const missing = Cup.activeIds(s).filter(id => !this.lobby.some(p => p.id === id) &&
      !(id in s.runtime.finishes) && !s.runtime.dnfs.includes(id));
    if (!missing.length) return;
    this.auto = false;
    if (s.disconnectPolicy === 'dnf' && s.phase === 'racing') {
      for (const id of missing) Cup.markDNF(s, id);
      Cup.note(s, 'Disconnected racers received DNF. Automatic rounds stopped.');
    } else {
      Cup.voidRound(s); this.loadingSession = undefined; this.nextAuto = null;
      this.error = 'Round voided after a racer disconnected. Reconnect their identity before restarting.';
    }
  }
  sendReady() {
    const s = this.state, run = s.runtime;
    if (s.phase !== 'loading' || !run || this.info.trackData.getId() !== run.trackId) return;
    if (this.isHost && run.sessionId === null) {
      // startNewSession takes five seconds. Wait for the new native game instance/session.
      if (this.loadingSession === undefined) { this.loadingSession = this.info.sessionId; return; }
      if (this.info.sessionId === this.loadingSession) return;
      run.sessionId = this.info.sessionId; Cup.touch(s); this.broadcast();
    }
    if (this.info.sessionId !== run.sessionId || !Cup.activeIds(s).includes(this.selfId)) return;
    const key = `${run.id}:${run.sessionId}`;
    if (this.readyKey === key) return;
    const m = { type: 'ready', roundId: run.id, sessionId: run.sessionId, trackId: run.trackId };
    if (this.isHost) this.markReady(this.selfId, m);
    else if (!this.transport.send(0, m)) return;
    this.readyKey = key;
  }
  markReady(id, m) {
    const run = this.state?.runtime;
    if (this.state?.phase !== 'loading' || !run || m.roundId !== run.id || m.sessionId !== run.sessionId ||
      m.trackId !== run.trackId || !Cup.activeIds(this.state).includes(id) || run.ready.includes(id)) return;
    run.ready.push(id); Cup.touch(this.state);
  }
  advanceClock() {
    const s = this.state, run = s.runtime;
    if (!run) return;
    if (s.phase === 'loading' && run.sessionId !== null && Cup.activeIds(s).every(id => run.ready.includes(id))) {
      s.phase = run.warmup ? 'warmup' : 'countdown';
      run.startsAt = this.now() + (run.warmup ? Cup.RULES.warmupMs : 3000); Cup.touch(s); this.broadcast();
    } else if (s.phase === 'warmup' && this.now() >= run.startsAt) {
      s.phase = 'countdown'; run.startsAt = this.now() + 3000; Cup.touch(s); this.broadcast();
    } else if (s.phase === 'countdown' && this.now() >= run.startsAt) {
      Cup.startRace(s, run.startsAt); this.broadcast();
    }
  }
  finishRound() {
    this.change(Cup.completeRound); this.loadingSession = undefined;
    this.nextAuto = this.auto && this.state.phase === 'between-rounds' ? Date.now() + 5000 : null;
  }
  voidRound() { this.change(Cup.voidRound); this.loadingSession = undefined; this.nextAuto = null; this.auto = false; }
  exportData() { return { format: 'polytrack-world-cup', schema: 1, state: this.state,
    tracks: [...this.tracks].map(([id, t]) => ({ id, code: t.code })) }; }
  restore(text) {
    this.requireHost();
    if (text.length > 18000000) throw new Error('The save is too large.');
    const data = JSON.parse(text);
    if (data.format !== 'polytrack-world-cup' || !validSnapshot(data.state) || !Array.isArray(data.tracks) || data.tracks.length > 8 ||
      !Array.isArray(data.state.history)) throw new Error('This is not a Simple Cup save. Older PolyCup exports remain readable as JSON but cannot be resumed in this format.');
    const tracks = new Map();
    for (const entry of data.tracks) {
      if (typeof entry.code !== 'string' || entry.code.length > 2000000) throw new Error('Invalid saved track.');
      const track = this.native.parse(entry.code);
      if (!track || track.trackData.getId() !== entry.id || !track.trackData.hasStartingPoint()) throw new Error('Saved track checksum failed.');
      tracks.set(entry.id, { ...track, code: entry.code });
    }
    for (const track of data.state.tracks) if (!tracks.has(track.id)) throw new Error('A saved track is missing.');
    // Native peer IDs are session-local. Require the organizer to reconnect EVERY saved racer.
    const s = data.state;
    if (s.runtime) { s.runtime = null; s.phase = 'between-rounds'; }
    Cup.detachIdentities(s);
    this.state = s; this.tracks = tracks; this.auto = false; this.nextAuto = null;
    this.needsRebind = new Set(s.roster.map(p => p.id));
    this.loadingSession = undefined; this.lastSaved = -1;
    Cup.note(s, 'Restored save. Organizer must reconnect saved racer identities.'); Cup.touch(s);
    this.broadcast(); this.onChange();
  }
  save() {
    if (this.lastSaved === this.state.revision) return;
    try { localStorage.setItem('pwc-save-v2', JSON.stringify(this.exportData())); this.lastSaved = this.state.revision; }
    catch { this.error = 'Autosave is full or unavailable. Export the tournament to keep results.'; }
  }
}
export function validSnapshot(s) {
  const obj = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const text = t => typeof t === 'string' && t.length <= 128;
  const num = n => Number.isSafeInteger(n) && n >= 0;
  const frames = n => Number.isSafeInteger(n) && n > 0 && n <= 3600000;
  if (!obj(s) || s.schema !== 2 || !text(s.id) || !text(s.name) || !num(s.revision) ||
    !['registration','loading','warmup','countdown','racing','between-rounds','complete'].includes(s.phase) ||
    !['dnf','void'].includes(s.disconnectPolicy) ||
    !Array.isArray(s.roster) || s.roster.length > 8 || !s.roster.every(p => obj(p) && Number.isSafeInteger(p.id) && p.id !== 0 && text(p.name)) ||
    new Set(s.roster.map(p => p.id)).size !== s.roster.length ||
    !Array.isArray(s.tracks) || s.tracks.length > 8 || !s.tracks.every(t => obj(t) && typeof t.id === 'string' && /^[a-f0-9]{64}$/i.test(t.id) && text(t.name)) ||
    new Set(s.tracks.map(t => t.id)).size !== s.tracks.length) return false;
  const ids = values => Array.isArray(values) && values.length <= 8 && values.every(id => s.roster.some(p => p.id === id)) && new Set(values).size === values.length;
  const times = o => obj(o) && Object.keys(o).length <= 8 && Object.entries(o).every(([id, n]) => s.roster.some(p => p.id === Number(id)) && num(n));
  const trackId = id => s.tracks.some(t => t.id === id);
  if (!obj(s.picks) || Object.entries(s.picks).some(([id,t]) => !ids([Number(id)]) || !trackId(t)) || !obj(s.records) || Object.keys(s.records).length > 8) return false;
  for (const [id,r] of Object.entries(s.records)) {
    if (!trackId(id) || !obj(r) || !obj(r.pbs) || Object.keys(r.pbs).length > 8) return false;
    for (const [id,p] of Object.entries(r.pbs)) if (!ids([Number(id)]) || !validPB(p)) return false;
    if (r.wr && (!obj(r.wr) || !['ready','missing','unavailable'].includes(r.wr.status) ||
      r.wr.status === 'ready' && (!frames(r.wr.frames) || !text(r.wr.name)))) return false;
    if (r.tr && (!obj(r.tr) || !frames(r.tr.frames) || !ids(r.tr.ids))) return false;
  }
  const round = r => obj(r) && num(r.round) && trackId(r.trackId) && times(r.finishes) && times(r.points) && ids(r.dnfs) && ids(r.winners) && ids(r.beforeRanking);
  const match = m => obj(m) && text(m.name) && ids(m.players) && m.players.length >= 2 && ids(m.winners) && ids(m.ranking) &&
    m.target === 100 && m.winnerCount === 1 && m.winners.length <= 1 && num(m.rounds) &&
    Array.isArray(m.order) && m.order.length >= 1 && m.order.length <= 8 && m.order.every(trackId) && new Set(m.order).size === m.order.length &&
    times(m.scores) && m.players.every(id => num(m.scores[id]) && m.scores[id] <= 100) && obj(m.finalists) &&
    Object.entries(m.finalists).every(([id,f]) => m.players.includes(Number(id)) && obj(f) && num(f.round) && num(f.position) && (f.checkpoint === null || num(f.checkpoint))) &&
    Array.isArray(m.roundsLog) && m.roundsLog.every(round);
  if (!Array.isArray(s.matches) || s.matches.length > 1 || !s.matches.every(match) ||
    s.matchIndex !== (s.matches.length ? 0 : -1) || (s.phase !== 'registration' && !s.matches.length) ||
    !Array.isArray(s.audit) || !s.audit.every(a => obj(a) && text(a.message) && text(a.at)) ||
    !Array.isArray(s.results) || s.results.length > 8 || !s.results.every(r => obj(r) && ids([r.id]) && Number.isInteger(r.place) && r.place >= 1 && r.place <= 8) ||
    (s.history !== undefined && (!Array.isArray(s.history) || !s.history.every(h => obj(h) && h.matchIndex === 0 && match(h.before))))) return false;
  const r = s.runtime;
  if (!['loading','warmup','countdown','racing'].includes(s.phase)) return r === null;
  return obj(r) && text(r.id) && num(r.round) && trackId(r.trackId) &&
    (r.sessionId === null || num(r.sessionId)) && typeof r.warmup === 'boolean' &&
    ids(r.ready) && ids(r.dnfs) && times(r.finishes) && times(r.checkpoints) &&
    (r.startsAt === null || Number.isFinite(r.startsAt)) && (r.deadline === null || Number.isFinite(r.deadline));
}
export function validPB(p) {
  return !!p && ['ready','missing','unavailable'].includes(p.status) &&
    (p.status !== 'ready' || Number.isSafeInteger(p.frames) && p.frames > 0 && p.frames <= 3600000 && ['profile','online'].includes(p.source));
}
