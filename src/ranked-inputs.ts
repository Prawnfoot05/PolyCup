import type { Ranked } from './ranked.ts';
export interface InputRun {
  gameVersion: '0.6.3';
  round: number;
  track: string;
  finish: number;
  nativeFinish: number;
  timeOffset: number;
  recording: string;
}
export interface PendingInput {
  match: string;
  player: string;
  instance: string;
  run: InputRun;
  at: number;
}
const KEY = 'polycup.ranked.inputs.pilot.v1';
/** Independent of rating delivery. Each racer submits only their own native
 * recording. Persistence and retries survive closing the game mid-Cup. */
export class RankedInputOutbox {
  #busy = false;
  #retryAfter = new Map<string, number>();
  #capacityAfter = new Map<string, number>();
  #key(item: PendingInput) {
    return `${item.player}:${item.match}:${item.run.round}`;
  }
  constructor(
    private api: Ranked,
    private user: () => string | null,
    private storage: Storage,
  ) {}
  #read(): PendingInput[] {
    try {
      const rows = JSON.parse(this.storage.getItem(KEY) || '[]');
      return Array.isArray(rows)
        ? rows.filter(
            (r) => r && typeof r.player === 'string' && r.run && Date.now() - r.at < 86400000,
          )
        : [];
    } catch {
      return [];
    }
  }
  enqueue(item: Omit<PendingInput, 'at'>) {
    const rows = this.#read();
    if (
      rows.some(
        (r) => r.player === item.player && r.match === item.match && r.run.round === item.run.round,
      )
    )
      return;
    rows.push({ ...item, at: Date.now() });
    if (rows.length > 200 || JSON.stringify(rows).length > 3500000) return; // Missing evidence remains visibly unavailable.
    try {
      this.storage.setItem(KEY, JSON.stringify(rows));
      void this.flush();
    } catch {
      /* Never interrupt racing on storage quota errors. */
    }
  }
  async flush() {
    if (this.#busy) return;
    const player = this.user();
    if (player && (this.#capacityAfter.get(player) ?? 0) > Date.now()) return;
    const item = this.#read().find(
      (r) => r.player === player && (this.#retryAfter.get(this.#key(r)) ?? 0) <= Date.now(),
    );
    if (!player || !item) return;
    this.#busy = true;
    try {
      if (!(await this.api.inputReviewEnabled()) || this.user() !== player) return;
      const accepted = await this.api.submitInputRun(item.match, item.instance, item.run);
      if (this.user() !== player) return;
      if (!accepted) {
        this.#retryAfter.set(this.#key(item), Date.now() + 60000);
        return;
      }
      this.storage.setItem(
        KEY,
        JSON.stringify(
          this.#read().filter(
            (r) =>
              !(r.player === player && r.match === item.match && r.run.round === item.run.round),
          ),
        ),
      );
    } catch (e) {
      if (this.user() !== player) return;
      if ((e as { code?: string }).code === 'PC001') {
        this.storage.setItem(
          KEY,
          JSON.stringify(this.#read().filter((r) => this.#key(r) !== this.#key(item))),
        );
      } else if ((e as { code?: string }).code === 'PC002') {
        this.#capacityAfter.set(player, Date.now() + 300000);
      } else this.#retryAfter.set(this.#key(item), Date.now() + 30000);
      // A rejected or offline row cannot starve later rounds/Cups.
    } finally {
      this.#busy = false;
    }
  }
}
