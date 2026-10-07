import type { TrackLibrary } from './game-types.ts';
import type { Controller } from './controller.ts';
import type { NativeApi, PolyModLoader } from './game-types.ts';
import type { Message } from './protocol.ts';
// Version-specific access is isolated here. These symbols were inspected in PML v0.6.3-1.
import { renderCarPose } from './spectator.ts';
import { profileIdentity } from './reconnect.ts';

export function registerCarVisibility(pml: PolyModLoader, insertType: unknown) {
  // Smoke, skidmarks and nameplates are separate scene objects in PolyTrack.
  pml.registerGlobalMixin({
    type: insertType,
    token: 'e.scene.add((0, d.gn)(this, a, "f")),',
    func: `Object.defineProperty(this, "setVisible", {
      value: visible => { a.get(this).visible = visible; }
    }),`,
  });
  pml.registerGlobalMixin({
    type: insertType,
    token: '(0, l.gn)(this, me, "f").visible = e;',
    func: `if (!e) {
      if (Ae.get(this)) Ae.get(this).visible = false;
    }
    for (const trail of Pe.get(this) || []) E.get(trail).visible = e;
    Ue.get(this)?.setVisible(e);`,
  });
}

export function beforeGameRender(
  renderer: { update: (...args: unknown[]) => unknown },
  prepare: () => void,
  update: () => unknown,
) {
  const descriptor = Object.getOwnPropertyDescriptor(renderer, 'update'),
    original = renderer.update;
  renderer.update = function (...args) {
    prepare();
    return original.apply(this, args);
  };
  try {
    return update();
  } finally {
    if (descriptor) Object.defineProperty(renderer, 'update', descriptor);
    else Reflect.deleteProperty(renderer, 'update');
  }
}

export function connectNative(pml: PolyModLoader, controller: Controller) {
  if (pml.polyVersion !== '0.6.3') throw new Error('PolyCup requires PolyTrack 0.6.3.');
  const api = pml.getFromPolyTrack(`({
    Host: ii, Client: vc, Game: Is, TrackLibrary: du,
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
    restartPressed: (g,event) => !fs.get(g).isEnabled && !bs.call(g) && Ps.call(g) &&
      Xa.get(g).hasStarted() && !Xa.get(g).hasFinished() &&
      ua.get(g).checkKeyBinding(event,ge.A.VehicleStartReset) &&
      !ua.get(g).checkKeyBinding(event,ge.A.VehicleCheckpointReset),
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
  })`) as NativeApi;
  api.reconnectIdentity = (game, cupId) =>
    profileIdentity(api.records(game).profiles.getCurrentUserProfile().token, cupId);
  for (const key of [
    'Host',
    'Client',
    'Game',
    'read',
    'peers',
    'parse',
    'reset',
    'guard',
  ] as const) {
    if (typeof api[key] !== 'function')
      throw new Error(`Unsupported game build: ${key} is unavailable.`);
  }
  const onlinePB = new Map<
    string,
    { until: number; value: Promise<{ ok: boolean; frames: number | null }> }
  >();
  const verified = (id: string) =>
    !!(api.trackLibrary?.isOfficialTrack(id) || api.trackLibrary?.isCommunityTrack(id));
  api.personalBest = async (game, id) => {
    const { server, profiles, store } = api.records(game);
    const profile = profiles.getCurrentUserProfile(),
      slot = profiles.profileSlot;
    // Use the game's own identity locally; only the time and its source leave this client.
    const key = `${slot}:${profile.tokenHash}:${id}`,
      cached = onlinePB.get(key);
    if (!cached || cached.until < Date.now()) {
      onlinePB.set(key, {
        until: Date.now() + 60000,
        value: server
          .getLeaderboardUserEntry(profile.tokenHash, id, verified(id))
          .then((record) => ({ ok: true, frames: record?.time?.numberOfFrames ?? null }))
          .catch(() => ({ ok: false, frames: null })),
      });
    }
    const online = await onlinePB.get(key)!.value;
    const local = store.getRecordTime(slot, id)?.numberOfFrames ?? null;
    if (online.frames !== null && (local === null || online.frames <= local))
      return { status: 'ready', frames: online.frames, source: 'online' };
    if (local !== null) return { status: 'ready', frames: local, source: 'profile' };
    return { status: online.ok ? 'missing' : 'unavailable' };
  };
  api.worldRecord = async (game, id) => {
    const { server, profiles } = api.records(game);
    try {
      const data = await server.getLeaderboard(
        profiles.getCurrentUserProfile().tokenHash,
        id,
        0,
        1,
        verified(id),
      );
      const best = data.entries[0];
      return best
        ? {
            status: 'ready',
            frames: best.frames.numberOfFrames,
            name: String(best.nickname).slice(0, 64),
            ...(best.countryCode ? { countryCode: best.countryCode } : {}),
          }
        : { status: 'missing' };
    } catch {
      return { status: 'unavailable' };
    }
  };
  const follow = api.follow;
  api.follow = (game, pose, id) => {
    follow(game, pose, id);
    renderCarPose(api.remoteCar(game, id), pose);
  };
  // The game's own library owns built-in tracks and the current profile's custom tracks.
  for (const method of [
    'getFirstSessionTrack',
    'getRandomOfficialTrack',
    'forEachTrack',
    'forEachOfficialTrack',
    'forEachCommunityTrack',
    'forEachCustomTrack',
  ]) {
    const original = api.TrackLibrary.prototype[method];
    api.TrackLibrary.prototype[method] = function (...args) {
      api.trackLibrary = this as unknown as TrackLibrary;
      return original.apply(this, args);
    };
  }
  const original = api.Game.prototype.update;
  api.Game.prototype.update = function (...args) {
    controller.observeGame(this);
    // Game.update draws the frame itself. Apply visibility and the buffered POV
    // after native car updates, but before that draw can consume their transforms.
    return beforeGameRender(
      api.renderer(this),
      () => controller.beforeRender(this),
      () => original.apply(this, args),
    );
  };
  const dispose = api.Game.prototype.dispose;
  api.Game.prototype.dispose = function (...args) {
    const result = dispose.apply(this, args);
    controller.gameDisposed(this);
    return result;
  };
  api.guard((game) => controller.shouldBlock(game));
  api.guardRestart((game) => controller.handleRestart(game));
  return api;
}

// A dedicated, negotiated channel shares the game's existing WebRTC peer connection.
// Never place new messages on PolyTrack's binary channels 0 and 1.
export class CupTransport {
  #onMessage: (id: number, message: Message) => void;
  #onChange: () => void;
  #channels: Map<number, RTCDataChannel> = new Map();
  #peers: Map<
    RTCPeerConnection,
    { id: number; channel: RTCDataChannel; windowAt: number; count: number }
  > = new Map();
  #channelId: number;
  #realtime: boolean;

  constructor(
    onMessage: (id: number, message: Message) => void,
    onChange: () => void,
    { channelId = 42, realtime = false } = {},
  ) {
    this.#onMessage = onMessage;
    this.#onChange = onChange;

    this.#channelId = channelId;
    this.#realtime = realtime;
  }
  sync(peers: { id: number; pc: RTCPeerConnection }[]) {
    const pcs = new Set(peers.map((p) => p.pc));
    for (const [pc, entry] of this.#peers)
      if (!pcs.has(pc) || entry.channel.readyState === 'closed') {
        entry.channel.close();
        this.#drop(pc, entry);
        this.#onChange();
      }
    for (const { id, pc } of peers)
      if (!this.#peers.has(pc) && pc.connectionState !== 'closed') {
        let channel: RTCDataChannel;
        try {
          channel = pc.createDataChannel(
            `polytrack-world-cup-${this.#channelId}`,
            this.#realtime
              ? { negotiated: true, id: this.#channelId, ordered: false, maxRetransmits: 0 }
              : { negotiated: true, id: this.#channelId, ordered: true },
          );
        } catch {
          // A browser may still be finishing the SCTP stream reset after a
          // background tab closed the old channel. Retry on the next sync.
          continue;
        }
        const entry = { id, channel, windowAt: performance.now(), count: 0 };
        this.#peers.set(pc, entry);
        this.#channels.set(id, channel);
        channel.onopen = () => this.#onChange();
        channel.onclose = () => {
          if (this.#peers.get(pc)?.channel === channel) this.#drop(pc, entry);
          this.#onChange();
        };
        channel.onerror = () => {
          if (channel.readyState === 'closed' && this.#peers.get(pc)?.channel === channel)
            this.#drop(pc, entry);
          this.#onChange();
        };
        channel.onmessage = (event) => {
          if (typeof event.data !== 'string' || event.data.length > (this.#realtime ? 2000 : 60000))
            return;
          const now = performance.now();
          if (now - entry.windowAt > 1000) {
            entry.windowAt = now;
            entry.count = 0;
          }
          if (++entry.count > (this.#realtime ? 30 : 35)) return;
          try {
            const candidate: unknown = JSON.parse(event.data);
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
            const message = candidate as Message & { protocol?: number };
            if (!message || message.protocol !== 1 || typeof message.type !== 'string') return;
            this.#onMessage(id, message); // Native peer ID, never an ID supplied by a client.
          } catch (error) {
            console.warn('[PolyCup] Rejected peer message:', String(error));
          }
        };
      }
  }
  recover() {
    for (const [pc, entry] of this.#peers) {
      entry.channel.close();
      this.#drop(pc, entry);
    }
    this.#onChange();
  }
  send(id: number, message: Message) {
    const channel = this.#channels.get(id);
    if (channel?.readyState !== 'open' || channel.bufferedAmount > 256000) return false;
    const text = JSON.stringify({ ...message, protocol: 1 });
    if (text.length > 60000)
      throw new Error('Tournament update exceeds the network message limit.');
    try {
      channel.send(text);
      return true;
    } catch {
      return false;
    }
  }
  broadcast(message: Message) {
    for (const id of this.#channels.keys()) this.send(id, message);
  }
  has(id: number) {
    return this.#channels.get(id)?.readyState === 'open';
  }
  dispose() {
    for (const entry of this.#peers.values()) entry.channel.close();
    this.#peers.clear();
    this.#channels.clear();
  }
  #drop(pc: RTCPeerConnection, entry: { id: number; channel: RTCDataChannel }) {
    if (this.#peers.get(pc)?.channel !== entry.channel) return;
    this.#peers.delete(pc);
    if (this.#channels.get(entry.id) === entry.channel) this.#channels.delete(entry.id);
  }
}
