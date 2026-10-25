import type { Ranked, RankedProfile } from './ranked.ts';
const RECEIPTS = 'polycup.ranked.seen-pending.v1';
const OWNER = 'polycup.ranked.delivery.v1';
const BEFORE = 'polycup.ranked.before.v1';
type Receipt = { player: string; match: string };
/** Acknowledgement follows rendering, never fetching or opening a loading panel. */
export class RankedNotifications {
  #busy = false;
  #user: string | null = null;
  #next = 0;
  #seen = new Set<string>();
  #owner: string;
  get owner() {
    return this.#owner;
  }
  constructor(
    private api: Pick<Ranked, 'claimResult' | 'seenResult'>,
    private user: () => string | null,
    private storage: Storage,
    private canShow: () => boolean,
    private show: (match: string, player: string, before: RankedProfile | null) => void,
  ) {
    this.#owner = storage.getItem(OWNER) || crypto.randomUUID();
    storage.setItem(OWNER, this.owner);
  }
  #read<T>(key: string, fallback: T): T {
    try {
      return JSON.parse(this.storage.getItem(key) || 'null') ?? fallback;
    } catch {
      return fallback;
    }
  }
  rememberBefore(match: string, player: string, profile: RankedProfile | null) {
    const entries = this.#read<{ match: string; player: string; profile: RankedProfile | null }[]>(
      BEFORE,
      [],
    ).filter((r) => r.match !== match || r.player !== player);
    entries.push({ match, player, profile });
    this.storage.setItem(BEFORE, JSON.stringify(entries.slice(-20)));
  }
  async claim(match: string, player: string) {
    if (
      this.user() !== player ||
      this.#seen.has(player + ':' + match) ||
      this.#read<Receipt[]>(RECEIPTS, []).some((r) => r.player === player && r.match === match)
    )
      return false;
    const claimed = await this.api.claimResult(this.owner, match);
    return this.user() === player && claimed === match;
  }
  seen(match: string, player: string) {
    if (this.user() !== player) return;
    const rows = this.#read<Receipt[]>(RECEIPTS, []);
    if (!rows.some((r) => r.player === player && r.match === match)) rows.push({ player, match });
    this.storage.setItem(RECEIPTS, JSON.stringify(rows));
    this.#seen.add(player + ':' + match);
    this.#next = 0;
    void this.tick();
  }
  wake() {
    this.#next = 0;
    void this.tick();
  }
  snooze() {
    this.#next = Infinity;
  }
  async tick() {
    const player = this.user();
    if (player !== this.#user) {
      this.#user = player;
      this.#next = 0;
    }
    if (!player || this.#busy || Date.now() < this.#next) return;
    this.#busy = true;
    this.#next = Date.now() + 60000;
    try {
      for (const receipt of this.#read<Receipt[]>(RECEIPTS, []).filter(
        (r) => r.player === player,
      )) {
        if (this.user() !== player) return;
        await this.api.seenResult(receipt.match);
        this.storage.setItem(
          RECEIPTS,
          JSON.stringify(
            this.#read<Receipt[]>(RECEIPTS, []).filter(
              (r) => r.player !== player || r.match !== receipt.match,
            ),
          ),
        );
      }
      if (this.user() !== player || !this.canShow()) return;
      const match = await this.api.claimResult(this.owner);
      if (!match || this.user() !== player || !this.canShow()) return;
      const before =
        this.#read<{ match: string; player: string; profile: RankedProfile | null }[]>(
          BEFORE,
          [],
        ).find((r) => r.match === match && r.player === player)?.profile ?? null;
      this.show(match, player, before);
    } catch {
      /* Keep the unread result/receipt. Retry with bounded reads. */
    } finally {
      this.#busy = false;
    }
  }
}
