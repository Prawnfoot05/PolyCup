import { WaitingRoom } from './waiting-room.ts';
import type { LobbyDirectory } from './lobby-directory.ts';
import type { Ranked } from './ranked.ts';
import type { RoomData, RoomSnapshot, RoomTracks } from './waiting-room-model.ts';
import type { ChatLine } from './chat.ts';
import { newCup, chooseTrack } from './cup.ts';
import { standardPreset } from './presets.ts';
import { rankedTranscript, verifyOwnFinishes } from './ranked-transcript.ts';
import type { CupState } from './types.ts';

export interface RankedSession {
  reconnect?: { player: string; name: string; until: string; abandoned: boolean }[];
  id: string;
  status: string;
  host: number;
  self: number;
  ticket: string;
  rules: Record<string, unknown>;
  pool: { id: string; category: string; digest: string }[];
  members: {
    id: number;
    account: string;
    name: string;
    country: null;
    online: boolean;
    native: number | null;
  }[];
  session: {
    revision: number;
    bans: { player_id: string; track_id: string }[];
    picks: { player_id: string; track_id: string }[];
    ready: string[];
    chat: ChatLine[];
    launch: RoomData['launch'];
    error?: string;
  };
}
export function rankedRoomSnapshot(raw: RankedSession, tracks: RoomTracks): RoomSnapshot {
  const preset = standardPreset();
  preset.name = 'Ranked';
  for (const key of Object.keys(preset.rules))
    (preset.rules as unknown as Record<string, unknown>)[key] = raw.rules[key];
  const cup = newCup('Ranked Cup', preset);
  cup.id = raw.id;
  cup.roster = raw.members.map((m) => ({ id: m.id, name: m.name }));
  const catalog = new Map(tracks.list().map((t) => [t.id, t]));
  const track = (id: string) => ({ id, name: catalog.get(id)?.name ?? id.slice(0, 12) });
  const actor = (id: string) => raw.members.find((m) => m.account === id)!.id;
  const bans = raw.session.bans.map((b) => ({
    racerId: actor(b.player_id),
    track: track(b.track_id),
  }));
  cup.draft = {
    stage: bans.length === raw.members.length * 2 ? 'picks' : 'bans',
    order: raw.members.map((m) => m.id),
    bans: Object.fromEntries(bans.map((b) => [b.racerId, b.track])),
    banHistory: bans,
  };
  for (const p of raw.session.picks) chooseTrack(cup, actor(p.player_id), track(p.track_id));
  cup.draftReady = raw.session.ready.map(actor);
  cup.revision = raw.session.revision;
  if (raw.session.launch?.stage === 'grace') cup.draftStartsAt = raw.session.launch.at;
  const chat = [...raw.session.chat];
  return {
    id: raw.id,
    code: '',
    host: raw.host,
    self: raw.self,
    ticket: raw.ticket,
    revision: raw.session.revision,
    members: raw.members,
    events: [],
    results: [],
    data: { cup, chat, public: false, muted: [], codes: {}, launch: raw.session.launch },
  };
}
/** Adapts server-owned ranked choices to the existing Cup UI and race handoff. */
export class RankedRoom extends WaitingRoom {
  #inputReviewEnabled = false;
  override get inputReviewEnabled() {
    return this.#inputReviewEnabled;
  }
  #onInputRun?: (item: Omit<import('./ranked-inputs.ts').PendingInput, 'at'>) => void;
  setInputHandler(handler: (item: Omit<import('./ranked-inputs.ts').PendingInput, 'at'>) => void) {
    this.#onInputRun = handler;
  }
  override recordOwnInput(run: import('./ranked-inputs.ts').InputRun) {
    const player = this.#raw?.members.find((m) => m.id === this.selfId)?.account;
    if (this.#inputReviewEnabled && player)
      this.#onInputRun?.({ match: this.#key, instance: this.#lease, player, run });
  }
  #disconnected = false;
  override get disconnected() {
    return this.#disconnected;
  }
  override async connectionLost() {
    this.#disconnected = true;
    // Backend presence survives native host loss so guests are not forfeited.
    await this.#request('connection-lost');
    this.#changed();
  }
  #own: Record<string, number> = {};
  #journalKey() {
    return (
      'polycup.ranked.finishes.' +
      this.#key +
      '.' +
      this.#raw?.members.find((m) => m.id === this.selfId)?.account
    );
  }
  override recordOwnFinish(round: number, track: string, frames: number) {
    this.#own[`${round}:${track}`] ??= frames;
    try {
      const old = JSON.parse(localStorage.getItem(this.#journalKey()) || '{}');
      localStorage.setItem(this.#journalKey(), JSON.stringify({ ...old, ...this.#own }));
    } catch {}
  }
  resultTranscript(state: CupState) {
    if (!this.#raw?.session.launch) throw Error('Ranked session unavailable.');
    const transcript = rankedTranscript(state, this.#raw.session.launch.id, this.#raw.members);
    let journal = this.#own;
    try {
      journal = { ...JSON.parse(localStorage.getItem(this.#journalKey()) || '{}'), ...journal };
    } catch {}
    const player = this.#raw.members.find((m) => m.id === this.selfId)!.account;
    verifyOwnFinishes(transcript, player, journal);
    return { player, instance: this.#lease, transcript };
  }
  #directoryClient: LobbyDirectory;
  #api: Ranked;
  #key: string;
  #lease: string;
  #library: RoomTracks;
  #raw: RankedSession | null = null;
  #view: RoomSnapshot | null = null;
  #listeners = new Set<() => void>();
  #timer?: ReturnType<typeof setInterval>;
  #suspended = false;
  #busy = false;
  #last = 0;
  #error = '';
  #epoch = 0;
  #requestId = 0;
  #applied = 0;
  constructor(
    directory: LobbyDirectory,
    api: Ranked,
    key: string,
    lease: string,
    library: RoomTracks,
  ) {
    super(directory, library);
    this.#directoryClient = directory;
    this.#api = api;
    this.#key = key;
    this.#lease = lease;
    this.#library = library;
    if (typeof api.inputReviewEnabled === 'function')
      void api
        .inputReviewEnabled()
        .then((enabled) => {
          this.#inputReviewEnabled = enabled;
        })
        .catch(() => {});
  }
  protected override ranksChanged() {
    this.#changed();
  }
  override verifiedConnection(nativeId: number) {
    return this.#raw?.members.find((m) => m.id === this.selfId)?.native === nativeId;
  }
  override get ranked() {
    return true;
  }
  override get snapshot() {
    return this.#view;
  }
  override get state() {
    return this.#view?.data.cup ?? null;
  }
  override get selfId() {
    return this.#view?.self ?? null;
  }
  override get isHost() {
    return !!this.#view && this.#view.self === this.#view.host;
  }
  override get error() {
    return this.#error || this.#raw?.session.error || '';
  }
  override get fresh() {
    return Date.now() - this.#last < 10000;
  }
  override get active() {
    return !!this.#view && !this.#suspended;
  }
  override get requiresAccount() {
    return !!this.#view;
  }
  override get lobby() {
    return (this.#view?.members ?? [])
      .filter((m) => m.online)
      .map((m) => ({
        id: m.id,
        nickname: m.name,
        countryCode: m.country,
        isSelf: m.id === this.selfId,
      }));
  }
  override get rankedTrackIds() {
    return new Set(this.#raw?.pool.map((t) => t.id) ?? []);
  }
  override subscribe(fn: () => void) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  #changed() {
    for (const fn of this.#listeners) fn();
  }
  async enter() {
    await this.#request('rejoin');
    if (this.#view && !this.#timer)
      this.#timer = setInterval(() => {
        if (Date.now() - this.#last >= (this.#suspended ? 5000 : 1000)) void this.poll();
      }, 500);
  }
  async #request(action: string, value: unknown = null) {
    const epoch = this.#epoch,
      request = ++this.#requestId;
    const raw = await this.#api.session(this.#key, this.#lease, action, value);
    if (epoch !== this.#epoch) return null;
    if (raw === null) {
      this.dismiss();
      return null;
    }
    if (
      this.#raw &&
      (raw.session.revision < this.#raw.session.revision ||
        (raw.session.revision === this.#raw.session.revision && request < this.#applied))
    )
      return this.#raw;
    this.#applied = request;
    this.#raw = raw;
    this.#view = rankedRoomSnapshot(raw, this.#library);
    const host = raw.members.find((m) => m.id === raw.host)?.account;
    if (raw.self !== raw.host && raw.reconnect?.some((p) => p.player === host))
      this.#disconnected = true;
    this.#last = Date.now();
    this.#error = '';
    this.refreshRanks(this.#directoryClient.browserClient, this.#lease, true);
    this.#changed();
    return raw;
  }
  override async poll() {
    if (this.#busy || !this.#view) return;
    this.#busy = true;
    try {
      await this.#request('poll');
    } catch (e) {
      this.#error = (e as Error).message;
      this.#changed();
    } finally {
      this.#busy = false;
    }
  }
  override async submit(kind: string, value?: unknown) {
    await this.#request(kind, value ?? null);
  }
  override async update(apply: (data: RoomData) => void) {
    if (!this.isHost || !this.#view) throw new Error('Only the race host can connect this match.');
    const next = structuredClone(this.#view.data),
      prior = this.#view.data.launch;
    apply(next);
    if (!prior) throw new Error('No ranked start attempt.');
    if (!next.launch) {
      await this.#request('failed', prior.id);
      return;
    }
    if (next.launch.code !== prior.code) {
      await this.#request('code', { attempt: prior.id, code: next.launch.code });
      return;
    }
    if (next.launch.stage === 'racing') {
      await this.#request('race', prior.id);
      return;
    }
    throw new Error('Ranked rules cannot be changed.');
  }
  override async bind(ticket: string, native: number, launch: string) {
    return this.#api.sessionBind(this.#key, this.#lease, { ticket, native, attempt: launch });
  }
  override async trackCodes() {
    return {};
  }
  override async kick(_id: number) {
    throw new Error('Ranked rosters are fixed.');
  }
  override suspend() {
    this.#suspended = true;
    this.#changed();
  }
  override resume() {
    if (this.#view) {
      this.#suspended = false;
      this.#changed();
    }
  }
  override async leave() {
    await this.#request('leave');
    this.dismiss();
  }
  override dismiss() {
    ++this.#epoch;
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#view = null;
    this.#raw = null;
    this.#changed();
  }
}
