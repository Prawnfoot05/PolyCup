// Transmit the racer's actual camera, including their cockpit/chase choice and FOV.
// This is scene data only; no screen capture, microphone, or camera permission.
export function validPose(p) {
  return !!p && Number.isSafeInteger(p.sessionId) && Number.isFinite(p.at) &&
    Array.isArray(p.position) && p.position.length === 3 && p.position.every(n => Number.isFinite(n) && Math.abs(n) < 1e7) &&
    Array.isArray(p.quaternion) && p.quaternion.length === 4 && p.quaternion.every(n => Number.isFinite(n) && Math.abs(n) <= 1.01) &&
    Math.abs(Math.hypot(...p.quaternion) - 1) < .02 &&
    Number.isFinite(p.fov) && p.fov >= 5 && p.fov <= 175 &&
    Number.isSafeInteger(p.frames) && p.frames >= 0 && p.frames <= 3600000 &&
    Number.isFinite(p.speed) && Math.abs(p.speed) < 100000;
}
export class CameraBuffer {
  constructor() { this.frames = []; }
  push(p) {
    if (!validPose(p)) return false;
    const last = this.frames.at(-1);
    if (last && last.sessionId === p.sessionId && last.at >= p.at) return false;
    if (last && (last.sessionId !== p.sessionId || p.frames < last.frames)) this.frames = [];
    this.frames.push(p); this.frames = this.frames.slice(-40); return true;
  }
  sample(at, sessionId) {
    const frames = this.frames.filter(p => p.sessionId === sessionId);
    if (!frames.length || at - frames.at(-1).at > 1500) return null;
    const bIndex = frames.findIndex(p => p.at >= at);
    if (bIndex < 1) return bIndex === 0 ? frames[0] : frames.at(-1);
    const a = frames[bIndex - 1], b = frames[bIndex], t = Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at)));
    // A respawn is a cut, not a flight through scenery.
    if (Math.hypot(...a.position.map((v, i) => b.position[i] - v)) > 40) return b;
    const sign = a.quaternion.reduce((sum, v, i) => sum + v * b.quaternion[i], 0) < 0 ? -1 : 1;
    const q = a.quaternion.map((v, i) => v + (b.quaternion[i] * sign - v) * t), length = Math.hypot(...q);
    return { ...a, at, position: a.position.map((v, i) => v + (b.position[i] - v) * t),
      quaternion: q.map(v => v / length), fov: a.fov + (b.fov - a.fov) * t,
      frames: Math.round(a.frames + (b.frames - a.frames) * t), speed: a.speed + (b.speed - a.speed) * t };
  }
  sampleFrame(frame, sessionId, now) {
    const frames = this.frames.filter(p => p.sessionId === sessionId);
    if (!frames.length || now - frames.at(-1).at > 1500) return null;
    const i = frames.findIndex(p => p.frames >= frame);
    if (i < 1 || frames.at(-1).frames === frames[0].frames) return this.sample(now - 150, sessionId);
    const a = frames[i - 1], b = frames[i], t = (frame - a.frames) / (b.frames - a.frames);
    return this.sample(a.at + (b.at - a.at) * t, sessionId);
  }
}
