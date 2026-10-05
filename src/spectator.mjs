// Transmit the racer's actual camera, including their cockpit/chase choice and FOV.
// This is scene data only; no screen capture, microphone, or camera permission.
export const VIEW_DELAY_MS = 250;
const vector = p => Array.isArray(p) && p.length === 3 && p.every(n => Number.isFinite(n) && Math.abs(n) < 1e7);
const rotation = p => Array.isArray(p) && p.length === 4 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1.01) && Math.abs(Math.hypot(...p) - 1) < .02;
export function validPose(p) {
  return !!p && Number.isSafeInteger(p.sessionId) && Number.isFinite(p.at) &&
    Array.isArray(p.position) && p.position.length === 3 && p.position.every(n => Number.isFinite(n) && Math.abs(n) < 1e7) &&
    Array.isArray(p.quaternion) && p.quaternion.length === 4 && p.quaternion.every(n => Number.isFinite(n) && Math.abs(n) <= 1.01) &&
    Math.abs(Math.hypot(...p.quaternion) - 1) < .02 &&
    Number.isFinite(p.fov) && p.fov >= 5 && p.fov <= 175 &&
    Number.isSafeInteger(p.frames) && p.frames >= 0 && p.frames <= 3600000 &&
    Number.isFinite(p.speed) && Math.abs(p.speed) < 100000 &&
    vector(p.carPosition) && rotation(p.carQuaternion) && [0, 1].includes(p.view);
}
function mixRotation(a, b, t) {
  let dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const sign = dot < 0 ? -1 : 1; dot = Math.min(1, Math.abs(dot));
  const angle = Math.acos(dot), sine = Math.sin(angle);
  const x = dot > .9995 ? 1 - t : Math.sin((1 - t) * angle) / sine;
  const y = dot > .9995 ? t : Math.sin(t * angle) / sine;
  const q = a.map((v, i) => x * v + y * b[i] * sign), length = Math.hypot(...q);
  return q.map(v => v / length);
}
const mixPosition = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Redraw only the remote car's visual transform. Never set a physics/network car
// state: doing so would feed our viewing delay back into native interpolation.
export function renderCarPose(car, pose) {
  if (!car || !pose?.carPosition) return;
  const position = car.getPosition().fromArray(pose.carPosition);
  const quaternion = car.getQuaternion().fromArray(pose.carQuaternion);
  const saved = ['getPosition', 'getQuaternion'].map(key => [key, Object.getOwnPropertyDescriptor(car, key)]);
  try {
    car.getPosition = () => position.clone();
    car.getQuaternion = () => quaternion.clone();
    car.update(0); // Update body/wheel transforms without advancing animations or skidmarks.
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(car, key, descriptor); else delete car[key];
    }
  }
}
export class CameraBuffer {
  constructor() { this.frames = []; this.playhead = null; this.lastTick = null; }
  push(p) {
    if (!validPose(p)) return false;
    const last = this.frames.at(-1);
    if (last && last.sessionId === p.sessionId && last.at >= p.at) return false;
    if (last && (last.sessionId !== p.sessionId || p.frames < last.frames)) {
      this.frames = []; this.playhead = null; this.lastTick = null;
    }
    this.frames.push(p); this.frames = this.frames.slice(-40); return true;
  }
  sample(at, sessionId) {
    const frames = this.frames.filter(p => p.sessionId === sessionId);
    if (!frames.length || at - frames.at(-1).at > 1500) return null;
    const bIndex = frames.findIndex(p => p.at >= at);
    if (bIndex < 1) return bIndex === 0 ? frames[0] : frames.at(-1);
    const a = frames[bIndex - 1], b = frames[bIndex], t = Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at)));
    // A respawn is a cut, not a flight through scenery.
    if (a.view !== b.view || Math.hypot(...a.carPosition.map((v, i) => b.carPosition[i] - v)) > 40 ||
      Math.hypot(...a.position.map((v, i) => b.position[i] - v)) > 40) return t < 1 ? a : b;
    return { ...a, at, position: mixPosition(a.position, b.position, t),
      quaternion: mixRotation(a.quaternion, b.quaternion, t), fov: a.fov + (b.fov - a.fov) * t,
      carPosition: mixPosition(a.carPosition, b.carPosition, t), carQuaternion: mixRotation(a.carQuaternion, b.carQuaternion, t),
      frames: Math.round(a.frames + (b.frames - a.frames) * t), speed: a.speed + (b.speed - a.speed) * t };
  }
  playback(now, sessionId, tick) {
    const frames = this.frames.filter(p => p.sessionId === sessionId);
    if (!frames.length || now - frames.at(-1).at > 1500) {
      this.playhead = null; this.lastTick = null; return null;
    }
    const desired = now - VIEW_DELAY_MS;
    if (this.playhead === null || this.lastTick === null || tick - this.lastTick > 1000) this.playhead = desired;
    else {
      const dt = Math.max(0, Math.min(100, tick - this.lastTick));
      // Correct drift gradually; packet arrival and clock synchronization must
      // never rewind the camera or cause the native 50 ms catch-up steps.
      const drift = desired - (this.playhead + dt);
      const rate = Math.max(.9, Math.min(1.1, 1 + drift / 1000));
      this.playhead += dt * rate;
    }
    this.lastTick = tick;
    // Keep the logical cursor before the first sample during startup so the
    // full buffer fills instead of immediately chasing newly arriving packets.
    this.playhead = Math.min(frames.at(-1).at, this.playhead);
    return this.sample(this.playhead, sessionId);
  }
}
