import type {
  Ranked,
  RankedQueueInfo,
  RankedQueueSnapshot,
  QueueAction,
  RankedProfile,
  RankedStats,
} from './ranked.ts';
import { VERSION } from './cup.ts';

/** Queue lifetime is independent of the finder window. No background polling
 * while signed out or idle with the finder closed. The server owns every match. */
export class RankedQueue {
  #user: string | null = null;
  #profile: RankedProfile | null = null;
  #stats: RankedStats | null = null;
  get stats() {
    return this.#stats;
  }
  #profileState: 'loading' | 'ready' | 'error' = 'ready';
  #profileAt = 0;
  #profileBusy = false;
  get profile() {
    return this.#profile;
  }
  get profileState() {
    return this.#profileState;
  }
  invalidateProfile() {
    this.#profileAt = 0;
    void this.refreshProfile();
  }
  async refreshProfile() {
    if (!this.#visible || !this.#user || this.#profileBusy || Date.now() - this.#profileAt < 60000)
      return;
    const generation = this.#generation;
    this.#profileBusy = true;
    this.#profileState = 'loading';
    try {
      const [profile, stats] = await Promise.allSettled([
        this.api.profile(this.#user),
        this.api.stats(this.#user),
      ]);
      if (generation !== this.#generation) return;
      if (profile.status === 'fulfilled') this.#profile = profile.value;
      if (stats.status === 'fulfilled') this.#stats = stats.value;
      this.#profileState = profile.status === 'fulfilled' ? 'ready' : 'error';
      this.#profileAt = Date.now();
    } catch {
      if (generation === this.#generation) this.#profileState = 'error';
    } finally {
      if (generation === this.#generation) {
        this.#profileBusy = false;
        this.#changed();
      }
    }
  }
  #confirmationTimer?: ReturnType<typeof setTimeout>;
  #confirmingAcceptance = false;
  get confirmingAcceptance() {
    return this.#confirmingAcceptance;
  }
  #instance: string;
  #snapshot: RankedQueueSnapshot | null = null;
  #info: RankedQueueInfo | null = null;
  #active = false;
  #visible = false;
  #busy = false;
  #abandonPending = false;
  #currentAction: QueueAction = 'poll';
  #queuedAction?: { action: QueueAction; resolve: () => void };
  #generation = 0;
  #error = '';
  #notice = '';
  #pendingExit: QueueAction | null = null;
  #timer?: ReturnType<typeof setTimeout>;
  #listeners = new Set<() => void>();
  constructor(
    private api: Ranked,
    private storage: Storage = sessionStorage,
  ) {
    this.#instance = storage.getItem('polycup.ranked.instance') || crypto.randomUUID();
    storage.setItem('polycup.ranked.instance', this.#instance);
  }
  get instance() {
    return this.#instance;
  }
  get snapshot() {
    return this.#snapshot;
  }
  get info() {
    return this.#info;
  }
  get active() {
    return this.#active;
  }
  get signedIn() {
    return !!this.#user;
  }
  get busy() {
    return (
      this.#abandonPending || (this.#busy && this.#currentAction !== 'poll') || !!this.#queuedAction
    );
  }
  get error() {
    return this.#error;
  }
  get notice() {
    return this.#notice;
  }
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #changed() {
    for (const listener of this.#listeners) listener();
  }
  setUser(user: string | null) {
    if (user === this.#user) return;
    ++this.#generation;
    this.#abandonPending = false;
    this.#queuedAction?.resolve();
    this.#queuedAction = undefined;
    this.#currentAction = 'poll';
    clearTimeout(this.#confirmationTimer);
    this.#confirmingAcceptance = false;
    this.#user = user;
    this.#profile = null;
    this.#stats = null;
    this.#profileAt = 0;
    this.#profileBusy = false;
    this.#profileState = user ? 'loading' : 'ready';
    void this.refreshProfile();
    this.#busy = false;
    this.#snapshot = null;
    this.#error = '';
    this.#notice = '';
    this.#active = !!user && this.storage.getItem('polycup.ranked.active') === user;
    const exit = this.storage.getItem('polycup.ranked.exit');
    this.#pendingExit = this.#active && exit === user ? 'cancel' : null;
    clearTimeout(this.#timer);
    this.#changed();
    if (this.#active || this.#visible) void this.refresh();
  }
  setVisible(visible: boolean) {
    this.#visible = visible;
    if (visible) {
      void this.refresh();
      void this.refreshProfile();
    } else this.#schedule();
  }
  #remember() {
    if (this.#active && this.#user) this.storage.setItem('polycup.ranked.active', this.#user);
    else this.storage.removeItem('polycup.ranked.active');
    if (this.#active && this.#pendingExit && this.#user)
      this.storage.setItem('polycup.ranked.exit', this.#user);
    else this.storage.removeItem('polycup.ranked.exit');
  }
  #schedule() {
    clearTimeout(this.#timer);
    if (!this.#active && !this.#visible) return;
    this.#timer = setTimeout(() => void this.refresh(), this.#active ? 5000 : 15000);
  }
  async refresh() {
    if (this.#active || this.#user) return this.act(this.#pendingExit ?? 'poll');
    if (this.#busy) return;
    const generation = this.#generation;
    this.#busy = true;
    try {
      const info = await this.api.queueInfo();
      if (generation !== this.#generation) return;
      this.#info = info;
      this.#error = '';
    } catch {
      if (generation === this.#generation) this.#error = 'Ranked is unavailable. Try again later.';
    } finally {
      if (generation === this.#generation) {
        this.#busy = false;
        this.#changed();
        this.#schedule();
      }
    }
  }
  async act(action: QueueAction) {
    if (this.#busy) {
      if (!this.#user || action === 'poll' || this.#currentAction !== 'poll' || this.#queuedAction)
        return;
      const queued = new Promise<void>((resolve) => {
        this.#queuedAction = { action, resolve };
      });
      this.#changed();
      return queued;
    }
    if (!this.#user) {
      this.#error = 'Sign in with Discord to play ranked.';
      this.#changed();
      return;
    }
    const generation = this.#generation;
    const previous = this.#snapshot?.state;
    const previousMatch = this.#snapshot?.match;
    this.#busy = true;
    this.#currentAction = action;
    this.#error = '';
    this.#notice = '';
    // A lost join response must remain recoverable by polling, never enqueue a
    // second account or silently abandon a seat the server already reserved.
    if (action === 'join') {
      if (!this.#active) {
        this.#instance = crypto.randomUUID();
        this.storage.setItem('polycup.ranked.instance', this.#instance);
      }
      this.#pendingExit = null;
      this.#active = true;
      this.#remember();
    }
    if (['cancel', 'decline', 'leave-match'].includes(action)) {
      this.#pendingExit = action;
      this.#remember();
    }
    this.#changed();
    try {
      const value = await this.api.queue(action, this.#instance, VERSION);
      if (generation !== this.#generation) return;
      if (
        previousMatch?.id === value.match?.id &&
        previousMatch?.status === 'reserved' &&
        value.match?.status === 'drafting' &&
        value.match.players.every((p) => p.accepted)
      ) {
        this.#confirmingAcceptance = true;
        clearTimeout(this.#confirmationTimer);
        this.#confirmationTimer = setTimeout(() => {
          if (generation !== this.#generation) return;
          this.#confirmingAcceptance = false;
          this.#changed();
        }, 650);
      } else if (
        !value.match ||
        value.match.id !== previousMatch?.id ||
        value.match.status !== 'drafting'
      ) {
        clearTimeout(this.#confirmationTimer);
        this.#confirmingAcceptance = false;
      }
      this.#snapshot = value;
      this.#info = value;
      this.#active = value.state !== 'idle';
      if (!this.#active) this.#pendingExit = null;
      if (value.state === 'idle' && previous === 'matched' && action === 'poll') {
        const ended =
          previousMatch && typeof this.api.resultStatus === 'function'
            ? await this.api.resultStatus(previousMatch.id).catch(() => null)
            : null;
        if (generation !== this.#generation) return;
        this.#notice =
          ended?.status === 'completed'
            ? ''
            : ended?.status === 'unrated'
              ? 'Match ended without a rating change.'
              : 'Match cancelled or expired.';
      } else if (value.state === 'idle' && previous === 'queued' && action === 'poll')
        this.#notice = 'You left the queue. Join again when ready.';
      this.#remember();
    } catch (error) {
      if (generation === this.#generation) {
        this.#error =
          (error as { code?: string })?.code === 'PGRST202'
            ? 'Ranked is not available yet.'
            : error instanceof Error
              ? error.message
              : 'Ranked is unavailable. Try again.';
        if (
          action === 'join' &&
          ['P0001', '42501'].includes((error as { code?: string })?.code ?? '')
        ) {
          this.#active = false;
          this.#remember();
        }
      }
    } finally {
      if (generation === this.#generation) {
        this.#busy = false;
        const queued = this.#queuedAction;
        this.#queuedAction = undefined;
        this.#changed();
        this.#schedule();
        if (queued) void this.act(queued.action).finally(queued.resolve);
      }
    }
  }
  async abandonMatch(match: string) {
    if (this.#abandonPending || this.#snapshot?.match?.id !== match || !this.#user) return;
    const generation = this.#generation;
    this.#abandonPending = true;
    this.#changed();
    if (this.#busy)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        };
        const unsubscribe = this.subscribe(() => {
          if (!this.#busy || generation !== this.#generation) done();
        });
        const timer = setTimeout(done, 11000);
      });
    if (generation !== this.#generation) return;
    if (this.#snapshot?.match?.id !== match || this.#busy) {
      this.#abandonPending = false;
      if (generation === this.#generation && this.#busy)
        this.#error = 'Another request is still finishing. Please try again.';
      this.#changed();
      return;
    }
    this.#busy = true;
    this.#currentAction = 'leave-match';
    this.#error = '';
    this.#changed();
    let success = false;
    try {
      await this.api.abandon(match, this.#instance);
      success = true;
    } catch (error) {
      if (generation === this.#generation) this.#error = (error as Error).message;
    } finally {
      if (generation === this.#generation) {
        this.#abandonPending = false;
        this.#busy = false;
        this.#changed();
        if (success) await this.refresh();
        else this.#schedule();
      }
    }
  }
  dispose() {
    ++this.#generation;
    this.#abandonPending = false;
    this.#changed();
    this.#queuedAction?.resolve();
    this.#queuedAction = undefined;
    clearTimeout(this.#confirmationTimer);
    clearTimeout(this.#timer);
    this.#listeners.clear();
  }
}
