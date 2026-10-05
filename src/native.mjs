// Version-specific access is isolated here. These symbols were inspected in PML v0.6.3-1.
import { renderCarPose } from './spectator.mjs';
export function connectNative(pml, controller) {
  if (pml.polyVersion !== '0.6.3') throw new Error('World Cup requires PolyTrack 0.6.3.');
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
      fov:c.fov, frames:car.getTime().numberOfFrames, speed:car.getSpeedKmh(),
      carPosition:car.getPosition().toArray(), carQuaternion:car.getQuaternion().toArray(),
      view:c===car.cameraCockpit?1:0 }; },
    remoteCar: (g,id) => as.get(g).get(id)?.car,
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
  for (const key of ['Host', 'Client', 'Game', 'read', 'peers', 'parse', 'reset', 'guard']) {
    if (typeof api[key] !== 'function') throw new Error(`Unsupported game build: ${key} is unavailable.`);
  }
  const follow = api.follow;
  api.follow = (game, pose, id) => {
    follow(game, pose, id);
    renderCarPose(api.remoteCar(game, id), pose);
  };
  // The game's own library owns built-in tracks and the current profile's custom tracks.
  for (const method of ['getFirstSessionTrack', 'getRandomOfficialTrack', 'forEachTrack',
    'forEachOfficialTrack', 'forEachCommunityTrack', 'forEachCustomTrack']) {
    const original = api.TrackLibrary.prototype[method];
    api.TrackLibrary.prototype[method] = function (...args) {
      api.trackLibrary = this;
      return original.apply(this, args);
    };
  }
  const original = api.Game.prototype.update;
  api.Game.prototype.update = function (...args) {
    controller.observeGame(this);
    const result = original.apply(this, args);
    controller.afterGame(this);
    return result;
  };
  const dispose = api.Game.prototype.dispose;
  api.Game.prototype.dispose = function (...args) {
    const result = dispose.apply(this,args); controller.gameDisposed(this); return result;
  };
  api.guard(game => controller.shouldBlock(game));
  api.guardRestart(game => controller.shouldBlockRestart(game));
  return api;
}

// A dedicated, negotiated channel shares the game's existing WebRTC peer connection.
// Never place new messages on PolyTrack's binary channels 0 and 1.
export class CupTransport {
  constructor(onMessage, onChange, { channelId = 42, realtime = false } = {}) {
    this.onMessage = onMessage; this.onChange = onChange;
    this.channels = new Map(); this.peers = new Map();
    this.channelId = channelId; this.realtime = realtime;
  }
  sync(peers) {
    const pcs = new Set(peers.map(p => p.pc));
    for (const [pc, entry] of this.peers) if (!pcs.has(pc)) {
      entry.channel.close(); this.peers.delete(pc); this.channels.delete(entry.id); this.onChange();
    }
    for (const { id, pc } of peers) if (!this.peers.has(pc) && pc.connectionState !== 'closed') {
      const channel = pc.createDataChannel(`polytrack-world-cup-${this.channelId}`, this.realtime ?
        { negotiated: true, id: this.channelId, ordered: false, maxRetransmits: 0 } :
        { negotiated: true, id: this.channelId, ordered: true });
      const entry = { id, channel, windowAt: performance.now(), count: 0 };
      this.peers.set(pc, entry); this.channels.set(id, channel);
      channel.onopen = () => this.onChange();
      channel.onclose = () => this.onChange();
      channel.onerror = () => this.onChange();
      channel.onmessage = event => {
        if (typeof event.data !== 'string' || event.data.length > (this.realtime ? 2000 : 60000)) return;
        const now = performance.now();
        if (now - entry.windowAt > 1000) { entry.windowAt = now; entry.count = 0; }
        if (++entry.count > (this.realtime ? 30 : 35)) return;
        try {
          const message = JSON.parse(event.data);
          if (!message || message.protocol !== 1 || typeof message.type !== 'string') return;
          this.onMessage(id, message); // Native peer ID, never an ID supplied by a client.
        } catch (error) { console.warn('[World Cup] Rejected peer message:', error.message); }
      };
    }
  }
  send(id, message) {
    const channel = this.channels.get(id);
    if (channel?.readyState !== 'open' || channel.bufferedAmount > 256000) return false;
    const text = JSON.stringify({ ...message, protocol: 1 });
    if (text.length > 60000) throw new Error('Tournament update exceeds the network message limit.');
    try { channel.send(text); return true; } catch { return false; }
  }
  broadcast(message) { for (const id of this.channels.keys()) this.send(id, message); }
  has(id) { return this.channels.get(id)?.readyState === 'open'; }
  dispose() { for (const entry of this.peers.values()) entry.channel.close(); this.peers.clear(); this.channels.clear(); }
}
