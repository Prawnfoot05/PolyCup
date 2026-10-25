import type { Ranked } from './ranked.ts';
import type { RankedTranscript } from './ranked-transcript.ts';
const KEY = 'polycup.ranked.outbox.v1';
interface PendingResult {
  player: string;
  instance: string;
  transcript: RankedTranscript;
}
/** Persist before sending. Lost responses and client restarts replay identical evidence. */
export class RankedSettlement {
  #busy = false;
  #next = 0;
  constructor(
    private api: Ranked,
    private user: () => string | null,
    private storage: Storage,
    private settled: () => void,
  ) {}
  #read(): PendingResult[] {
    try {
      const rows = JSON.parse(this.storage.getItem(KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
  enqueue(item: PendingResult) {
    const rows = this.#read();
    const prior = rows.find(
      (r) => r.player === item.player && r.transcript.match === item.transcript.match,
    );
    if (prior && JSON.stringify(prior.transcript) !== JSON.stringify(item.transcript))
      throw Error('Saved result differs. Rating needs review.');
    if (!prior) rows.push(item);
    else prior.instance = item.instance;
    this.storage.setItem(KEY, JSON.stringify(rows));
    this.#next = 0;
    void this.flush();
  }
  async flush() {
    if (this.#busy || Date.now() < this.#next) return;
    const player = this.user(),
      item = this.#read().find((r) => r.player === player);
    if (!player || !item) return;
    this.#busy = true;
    this.#next = Date.now() + 5000;
    try {
      const status = await this.api.submitResult(
        item.transcript.match,
        item.instance,
        item.transcript,
      );
      if (this.user() !== player) return;
      if (['completed', 'unrated', 'cancelled', 'disputed'].includes(status)) {
        this.storage.setItem(
          KEY,
          JSON.stringify(
            this.#read().filter(
              (r) => !(r.player === player && r.transcript.match === item.transcript.match),
            ),
          ),
        );
        this.storage.removeItem('polycup.ranked.finishes.' + item.transcript.match + '.' + player);
        this.settled();
      }
    } catch {
      /* Keep the durable evidence for a retry after connectivity returns. */
    } finally {
      this.#busy = false;
    }
  }
}
