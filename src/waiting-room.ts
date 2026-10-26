import type { SupabaseClient } from '@supabase/supabase-js';
import { VERSION, touch } from './cup.ts';
import {
  roomData,
  reduceRoomEvent,
  reconcileRoom,
  cancelRoomStart,
  type RoomSnapshot,
  type RoomData,
  type RoomTracks,
} from './waiting-room-model.ts';
import type { LobbyDirectory } from './lobby-directory.ts';

export interface WaitingRoomListing {
  id: string;
  title: string;
  version: string;
  phase: string;
  host_name: string;
  players: number;
}
export class WaitingRoom {
  recordOwnFinish(_round: number, _track: string, _frames: number) {}
  get inputReviewEnabled() {
    return false;
  }
  recordOwnInput(_run: import('./ranked-inputs.ts').InputRun) {}
  get disconnected() {
    return false;
  }
  connectionLost() {
    return this.leave();
  }
  verifiedConnection(_nativeId: number) {
    return true;
  }
  verifiedChatKey(_nativeId: number): string | undefined {
    return undefined;
  }
  get ranked(): boolean {
    return false;
  }
  get rankedTrackIds(): Set<string> | undefined {
    return undefined;
  }
  #ranks: Record<number, import('./ranked.ts').RankedProfile | null> = {};
  #rankRevision = 0;
  get rankRevision() {
    return this.#rankRevision;
  }
  #ranksKey = '';
  #ranksAt = 0;
  #ranksBusy = false;
  #ranksEpoch = 0;
  rank(id: number) {
    return this.#ranks[id];
  }
  protected ranksChanged() {
    this.#changed();
  }
  protected refreshRanks(client: SupabaseClient, instance: string, ranked = false) {
    const snap = this.snapshot;
    if (!snap || this.#ranksBusy) return;
    const key = snap.id + ':' + snap.members.map((m) => m.id).join(',');
    if (key === this.#ranksKey && Date.now() - this.#ranksAt < 60000) return;
    if (this.#ranksKey.split(':')[0] !== snap.id) this.#ranks = {};
    this.#ranksBusy = true;
    this.#ranksKey = key;
    this.#ranksAt = Date.now();
    const epoch = ++this.#ranksEpoch;
    void (async () => {
      try {
        const { data, error } = await client
          .rpc('polycup_lobby_ranks', { room_key: snap.id, instance_key: instance, ranked })
          .abortSignal(AbortSignal.timeout(10000));
        if (!error && this.snapshot?.id === snap.id && epoch === this.#ranksEpoch) {
          this.#ranks = data ?? {};
          ++this.#rankRevision;
          this.ranksChanged();
        }
      } catch {
      } finally {
        this.#ranksBusy = false;
      }
    })();
  }
  #directory: LobbyDirectory;
  #client?: SupabaseClient;
  #snapshot: RoomSnapshot | null = null;
  #creating: RoomData | null = null;
  #instance: string;
  #listeners = new Set<() => void>();
  #tracks: RoomTracks;
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
  #pollAgain = false;
  #ackTimer?: ReturnType<typeof setTimeout>;
  #error = '';
  #connectionFailure?: { launch: string; message: string };
  get connectionFailure() {
    return this.#connectionFailure?.launch === this.snapshot?.data.launch?.id
      ? (this.#connectionFailure?.message ?? '')
      : '';
  }
  failedConnection(message: string) {
    const launch = this.snapshot?.data.launch?.id;
    if (launch) this.#connectionFailure = { launch, message };
    this.#changed();
  }
  #lastOK = 0;
  #pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; at: number }>();
  #updates: {
    apply: (data: RoomData) => void;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  #suspended = false;
  #epoch = 0;
  constructor(directory: LobbyDirectory, tracks: RoomTracks) {
    this.#directory = directory;
    this.#tracks = tracks;
    this.#instance = sessionStorage.getItem('polycup.room.instance') || crypto.randomUUID();
    sessionStorage.setItem('polycup.room.instance', this.#instance);
    window.addEventListener('online', () => void this.poll());
    window.addEventListener('pagehide', () => this.#stop());
    window.addEventListener('pageshow', () => this.#clock());
  }
  get snapshot() {
    return this.#snapshot;
  }
  get state() {
    return this.#snapshot?.data.cup ?? null;
  }
  get selfId() {
    return this.#snapshot?.self ?? null;
  }
  get isHost() {
    return !!this.#snapshot && this.#snapshot.self === this.#snapshot.host;
  }
  get error() {
    return this.connectionFailure || this.#error;
  }
  get fresh() {
    return Date.now() - this.#lastOK < 10000;
  }
  get active() {
    return !!this.#snapshot && !this.#suspended;
  }
  get requiresAccount() {
    return !!this.#snapshot && this.#client === this.#directory.browserClient;
  }
  get lobby(): import('./game-types.ts').LobbyPlayer[] {
    return (this.#snapshot?.members ?? [])
      .filter((p) => p.online)
      .map((p) => ({
        id: p.id,
        nickname: p.name,
        countryCode: p.country,
        isSelf: p.id === this.selfId,
      }));
  }
  subscribe(fn: () => void) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  #changed() {
    for (const fn of this.#listeners) fn();
  }
  async listings(): Promise<WaitingRoomListing[]> {
    const { data, error } = await this.#directory.browserClient
      .rpc('polycup_room_directory')
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  async #session() {
    this.#client ??= (await this.#directory.roomSession()).client;
  }
  async #rpc(op: string, args: object = {}, id = this.#snapshot?.id) {
    const epoch = this.#epoch;
    if (!this.#client || !id) throw new Error('Join a waiting room first.');
    const parameters = {
      ...args,
      requests: [...this.#pending.keys()],
      presence: this.#snapshot?.members.map((p) => `${p.id}:${p.online}`).join(','),
    };
    const { data, error } = await this.#client
      .rpc('polycup_room', { op, room_key: id, instance_key: this.#instance, args: parameters })
      .abortSignal(AbortSignal.timeout(10000));
    if (epoch !== this.#epoch) throw new Error('The waiting room changed.');
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
  }
  #accept(value: RoomSnapshot) {
    if (
      this.#snapshot &&
      value.id === this.#snapshot.id &&
      value.revision < this.#snapshot.revision
    )
      return;
    if (!value.data && this.#snapshot) value.data = this.#snapshot.data;
    if (!value.members && this.#snapshot) value.members = this.#snapshot.members;
    this.#snapshot = value;
    this.#lastOK = Date.now();
    this.#error = '';
    for (const result of value.results) {
      const pending = this.#pending.get(result.request);
      if (pending) {
        this.#pending.delete(result.request);
        if (result.error) pending.reject(new Error(result.error));
        else pending.resolve();
      }
    }
    if (this.#client) this.refreshRanks(this.#client, this.#instance);
    this.#changed();
  }
  async create(
    name: string,
    identity: { name: string; country?: string | null },
    isPublic = false,
  ) {
    if (this.#snapshot) throw new Error('Leave your current room first.');
    await this.#session();
    // Retry an ambiguous create with the same room ID: the server may have
    // created it even if its response was lost on the way back.
    const data = (this.#creating ??= { ...roomData(name), public: isPublic });
    sessionStorage.setItem('polycup.room.id', data.cup.id);
    this.#accept(await this.#rpc('create', { data, version: VERSION, ...identity }, data.cup.id));
    this.#creating = null;
    this.#connectionFailure = undefined;
    sessionStorage.setItem('polycup.room.id', data.cup.id);
    this.#clock();
    await this.submit('join');
  }
  async join(id: string, identity: { name: string; country?: string | null }, code = '') {
    if (this.#snapshot && this.#snapshot.id !== id)
      throw new Error('Leave your current room first.');
    await this.#session();
    this.#accept(await this.#rpc('join', { ...identity, version: VERSION, code }, id));
    this.#suspended = false;
    sessionStorage.setItem('polycup.room.id', id);
    this.#clock();
    if (
      this.state?.draft?.stage === 'roster' &&
      !this.state.roster.some((p) => p.id === this.selfId) &&
      this.state.roster.length < 8
    )
      await this.submit('join');
  }
  async joinCode(code: string, identity: { name: string; country?: string | null }) {
    await this.#session();
    const { data, error } = await this.#client!.rpc('polycup_room_by_code', {
      room_code: code.trim(),
    }).abortSignal(AbortSignal.timeout(10000));
    if (error || !data) throw new Error(error?.message ?? 'Room code not found.');
    await this.join(data, identity, code.trim());
  }
  async restore(identity: { name: string; country?: string | null }) {
    const id = sessionStorage.getItem('polycup.room.id');
    if (id && !this.#snapshot) {
      try {
        await this.join(id, identity);
      } catch (e) {
        this.#error = (e as Error).message;
        this.#changed();
      }
    }
  }
  async leave() {
    if (!this.#snapshot) return;
    try {
      await this.#rpc('leave');
    } catch (error) {
      if (
        ![
          'This waiting room is no longer available.',
          'Join this waiting room first.',
          'You were removed from this room.',
        ].includes((error as Error).message)
      ) {
        // Keep the room and its leave control available until the backend
        // confirms release. Otherwise an offline leave strands membership.
        this.#error = 'Could not leave the Cup. Check your connection and try again.';
        this.#changed();
        throw error;
      }
    }
    this.dismiss();
  }
  dismiss() {
    this.#epoch++;
    this.#stop();
    this.#snapshot = null;
    this.#creating = null;
    this.#suspended = false;
    sessionStorage.removeItem('polycup.room.id');
    this.#rejectPending('The waiting room closed.');
    this.#changed();
  }
  #rejectPending(message: string) {
    for (const pending of this.#pending.values()) pending.reject(new Error(message));
    this.#pending.clear();
    for (const update of this.#updates.splice(0)) update.reject(new Error(message));
  }
  async submit(kind: string, value?: unknown) {
    if (!this.active) throw new Error('Join a waiting room first.');
    const request = crypto.randomUUID();
    const promise = new Promise<void>((resolve, reject) =>
      this.#pending.set(request, { resolve, reject, at: Date.now() }),
    );
    // Attach the rejection handler before network work can fail.
    const outcome = promise;
    void outcome.catch(() => {});
    try {
      let snapshot: RoomSnapshot | undefined;
      const epoch = this.#epoch;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          snapshot = await this.#rpc('event', { request, kind, value: value ?? null });
          break;
        } catch (error) {
          // Retry ambiguous transport failures with the SAME server-deduplicated
          // request ID. An acknowledgement lost after COMMIT must not apply twice.
          if (attempt === 2 || epoch !== this.#epoch || (error as { code?: string }).code)
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      if (!snapshot) throw new Error('Could not send this action. Please try again.');
      this.#accept(snapshot);
      // The event reply already contains the host's work queue. Do not spend
      // another round trip fetching it before applying a local host action.
      void this.poll(snapshot);
    } catch (e) {
      if (
        [
          'This waiting room is no longer available.',
          'Join this waiting room first.',
          'You were removed from this room.',
        ].includes((e as Error).message)
      ) {
        this.dismiss();
        return outcome;
      }
      this.#pending.get(request)?.reject(e as Error);
      this.#pending.delete(request);
      return outcome;
    }
    return outcome;
  }
  update(apply: (data: RoomData) => void) {
    if (!this.isHost) return Promise.reject(new Error('Only the host can update the room.'));
    const result = new Promise<void>((resolve, reject) =>
      this.#updates.push({ apply, resolve, reject }),
    );
    void this.poll();
    return result;
  }
  async bind(ticket: string, native: number, launch: string): Promise<number> {
    return this.#rpc('bind', { ticket, native, launch });
  }
  async kick(member: number) {
    this.#accept(await this.#rpc('kick', { member }));
  }
  async trackCodes(): Promise<Record<string, string>> {
    return this.#rpc('tracks');
  }
  suspend() {
    this.#suspended = true;
    this.#changed();
  }
  resume() {
    this.#suspended = false;
    this.#clock();
    this.#changed();
  }
  #clock() {
    if (!this.#snapshot || this.#timer) return;
    this.#timer = setInterval(() => {
      const interval = this.#suspended
        ? 20000
        : document.hidden && !this.isHost
          ? 8000
          : this.isHost || this.#snapshot?.data.launch
            ? 1000
            : 2000;
      if (Date.now() - this.#lastOK >= interval) void this.poll();
    }, 250);
    void this.poll();
  }
  #stop() {
    clearInterval(this.#timer);
    clearTimeout(this.#ackTimer);
    this.#pollAgain = false;
    this.#timer = undefined;
  }
  async poll(reply?: RoomSnapshot) {
    if (!this.#snapshot) return;
    if (this.#busy) {
      this.#pollAgain = true;
      return;
    }
    clearTimeout(this.#ackTimer);
    this.#busy = true;
    try {
      this.#accept(reply ?? (await this.#rpc('poll', { revision: this.#snapshot.revision })));
      const snapshot = this.#snapshot;
      if (this.isHost && !this.#suspended) {
        let data = structuredClone(snapshot.data);
        reconcileRoom(data, snapshot.members);
        const results: { seq: number; error: string | null }[] = [];
        for (const event of snapshot.events) {
          try {
            data = reduceRoomEvent(data, event, snapshot.members, snapshot.host, this.#tracks);
            results.push({ seq: event.seq, error: null });
          } catch (e) {
            results.push({ seq: event.seq, error: (e as Error).message });
          }
        }
        reconcileRoom(data, snapshot.members);
        const updates = this.#updates.slice(0, 0);
        for (const update of [...this.#updates]) {
          try {
            const next = structuredClone(data);
            update.apply(next);
            data = next;
            updates.push(update);
          } catch (error) {
            this.#updates = this.#updates.filter((item) => item !== update);
            update.reject(error as Error);
          }
        }
        const launch = data.launch;
        if (launch?.stage === 'grace') {
          const seconds = Math.max(0, Math.ceil((launch.at - Date.now()) / 1000));
          if (!seconds) {
            launch.stage = 'connecting';
            launch.at = Date.now();
            touch(data.cup);
          }
        } else if (launch?.stage === 'connecting' && Date.now() - launch.at > 90000)
          cancelRoomStart(
            data,
            'Could not connect every racer. Your picks are saved; try starting again.',
          );
        if (
          results.length ||
          updates.length ||
          JSON.stringify(data) !== JSON.stringify(snapshot.data)
        ) {
          const next = await this.#rpc('commit', { revision: snapshot.revision, data, results });
          this.#updates = this.#updates.filter((item) => !updates.includes(item));
          this.#accept(next);
          for (const update of updates) update.resolve();
        }
      }
      for (const [id, pending] of this.#pending)
        if (Date.now() - pending.at > 20000) {
          this.#pending.delete(id);
          pending.reject(
            new Error(
              'The host has not acknowledged this action yet. It may still apply when they reconnect.',
            ),
          );
        }
    } catch (e) {
      if ((e as { code?: string }).code !== '40001') {
        if (
          [
            'This waiting room is no longer available.',
            'Join this waiting room first.',
            'You were removed from this room.',
          ].includes((e as Error).message)
        ) {
          this.dismiss();
          return;
        }
        this.#error = (e as Error).message;
        this.#changed();
      }
    } finally {
      this.#busy = false;
      const again = this.#pollAgain;
      this.#pollAgain = false;
      // Faster acknowledgement only while an action is outstanding. Idle
      // rooms keep their existing polling budget; slow/offline requests cannot overlap.
      if (this.#snapshot && (again || (this.active && this.#pending.size)))
        this.#ackTimer = setTimeout(() => void this.poll(), again ? 0 : 200);
    }
  }
}
