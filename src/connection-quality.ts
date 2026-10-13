type Quality = 'good' | 'fair' | 'poor' | 'unknown';
// Colour is deliberately steadier than the numeric reading. A 10 ms margin
// and a short dwell avoid flashing when ping sits on a category boundary.
export class ConnectionQuality {
  #peers = new Map<number, { value: Quality; pending: Quality; since: number }>();
  read(id: number, ping: number | null, now = performance.now()): Quality {
    if (ping === null) {
      this.#peers.delete(id);
      return 'unknown';
    }
    const raw: Quality = ping <= 100 ? 'good' : ping <= 200 ? 'fair' : 'poor';
    let peer = this.#peers.get(id);
    if (!peer) {
      peer = { value: raw, pending: raw, since: now };
      this.#peers.set(id, peer);
      return raw;
    }
    const target: Quality =
      peer.value === 'good' && ping <= 110
        ? 'good'
        : peer.value === 'poor' && ping >= 190
          ? 'poor'
          : peer.value === 'fair' && ping >= 90 && ping <= 210
            ? 'fair'
            : raw;
    if (target === peer.value) {
      peer.pending = target;
      peer.since = now;
    } else if (target !== peer.pending) {
      peer.pending = target;
      peer.since = now;
    } else if (now - peer.since >= 750) peer.value = target;
    return peer.value;
  }
  retain(ids: Set<number>) {
    for (const id of this.#peers.keys()) if (!ids.has(id)) this.#peers.delete(id);
  }
}
