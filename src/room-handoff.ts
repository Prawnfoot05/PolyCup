import { CupTransport } from './native.ts';
import { launchNativeRace, returnToNativeMenu } from './native-cup-menu.ts';
import { raceState, cancelRoomStart, type RoomData } from './waiting-room-model.ts';
import { rulesFor } from './presets.ts';
import type { WaitingRoom } from './waiting-room.ts';
import type { Controller } from './controller.ts';
import type { LoadedTrack, NativeConnection } from './game-types.ts';
import { duringAttempt } from './race-attempt.ts';

export interface RaceBridge {
  prepare(data: RoomData, signal: AbortSignal): Promise<Map<string, LoadedTrack>>;
  connect(
    host: boolean,
    signal: AbortSignal,
    tracks?: Map<string, LoadedTrack>,
    code?: string,
  ): Promise<NativeConnection>;
  self(): number | null;
  peers(connection: NativeConnection): { id: number; pc: RTCPeerConnection }[];
  ready(ids: number[]): boolean;
  started(cupId: string): boolean;
  begin(data: RoomData, ids: Map<number, number>, tracks: Map<string, LoadedTrack>): Promise<void>;
  entered(): void;
  rebind?(oldId: number, newId: number): void;
  returnToMenu(): void;
}
/** One attempt owns every asynchronous operation. Late completions cannot start a replacement Cup. */
export class RoomHandoff {
  #room: WaitingRoom;
  #bridge: RaceBridge;
  #attempt = '';
  #abort?: AbortController;
  #connection?: NativeConnection;
  #tracks = new Map<string, LoadedTrack>();
  #bindings = new Map<number, number>();
  #binding = new Set<number>();
  #channel: CupTransport;
  #busy = false;
  #lastTicket = 0;
  #finished = false;
  #connecting = false;
  #inviteRetries = 0;
  #timer?: ReturnType<typeof setInterval>;
  #unsubscribe?: () => void;
  constructor(room: WaitingRoom, bridge: RaceBridge) {
    this.#room = room;
    this.#bridge = bridge;
    this.#channel = new CupTransport(
      (id, message) => {
        if (
          !room.isHost ||
          message.type !== 'room-ticket' ||
          message.launch !== this.#attempt ||
          !/^[a-f0-9-]{36}$/i.test(message.ticket)
        )
          return;
        void this.#bind(id, message.ticket);
      },
      () => {},
      { channelId: 44 },
    );
    this.#unsubscribe = room.subscribe(() => this.#changed());
    this.#timer = setInterval(() => void this.tick(), 200);
  }
  dispose() {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    clearInterval(this.#timer);
    if (this.#attempt) this.#reset();
  }
  #changed() {
    if (!this.#room.snapshot) {
      // The hub reuses custom waiting rooms after leaving. End this attempt,
      // but keep listening so a later join can start a new handoff.
      clearInterval(this.#timer);
      this.#timer = undefined;
      if (this.#attempt) this.#reset();
      return;
    }
    this.#timer ??= setInterval(() => void this.tick(), 200);
    const launch = this.#room.snapshot?.data.launch;
    if (this.#attempt && (!launch || launch.id !== this.#attempt)) this.#reset();
    void this.tick();
  }
  #reset() {
    const connected = this.#connecting || !!this.#connection;
    this.#abort?.abort();
    this.#channel.dispose();
    this.#connection?.dispose();
    this.#connection = undefined;
    this.#tracks.clear();
    this.#bindings.clear();
    this.#binding.clear();
    this.#attempt = '';
    this.#finished = false;
    this.#connecting = false;
    this.#inviteRetries = 0;
    this.#room.resume();
    if (connected) this.#bridge.returnToMenu();
  }
  async #bind(nativeId: number, ticket: string) {
    if (this.#binding.has(nativeId) || [...this.#bindings.values()].includes(nativeId)) return;
    const attempt = this.#attempt;
    this.#binding.add(nativeId);
    try {
      const member = await this.#room.bind(ticket, nativeId, attempt);
      if (this.#attempt === attempt && !this.#abort?.signal.aborted) {
        const old = this.#bindings.get(member);
        this.#bindings.set(member, nativeId);
        if (this.#finished && old !== undefined && old !== nativeId)
          this.#bridge.rebind?.(old, nativeId);
      }
    } catch {
      /* Invalid or stale tickets cannot acquire a racer slot. */
    } finally {
      this.#binding.delete(nativeId);
    }
  }
  async tick() {
    const snapshot = this.#room.snapshot,
      launch = snapshot?.data.launch;
    if (!snapshot || !launch || launch.stage === 'grace') return;
    if (this.#finished) {
      if (this.#room.ranked && this.#connection)
        this.#channel.sync(this.#bridge.peers(this.#connection));
      return;
    }
    if (!this.#attempt) {
      this.#attempt = launch.id;
      this.#abort = new AbortController();
    }
    if (this.#busy) return;
    const attempt = this.#attempt,
      signal = this.#abort!.signal;
    const current = () =>
      !signal.aborted &&
      this.#attempt === attempt &&
      this.#room.snapshot?.data.launch?.id === attempt;
    this.#busy = true;
    try {
      if (!this.#room.fresh) return;
      if (!this.#connection) {
        if (this.#room.isHost) {
          this.#tracks = await duringAttempt(this.#bridge.prepare(snapshot.data, signal), signal);
          if (!current()) return;
        } else if (!launch.code) return;
        this.#connecting = true;
        const connection = await this.#bridge.connect(
          this.#room.isHost,
          signal,
          this.#tracks,
          launch.code,
        );
        if (!current()) {
          connection.dispose();
          return;
        }
        this.#connection = connection;
        this.#connecting = false;
      }
      this.#channel.sync(this.#bridge.peers(this.#connection));
      const self = this.#bridge.self();
      if (self === null) return;
      if (this.#room.isHost) {
        await this.#bind(self, snapshot.ticket);
        const invite = this.#connection.getInvite();
        // Private waiting rooms hide the native invite UI too. Request the
        // race connection code ourselves instead of relying on that UI.
        if (
          !launch.code &&
          !invite?.inviteCode &&
          this.#connection.isInviteAllowed() &&
          !this.#connection.getInviteIsLoading()
        ) {
          if (this.#inviteRetries++ >= 2)
            throw new Error('Could not create a multiplayer invitation.');
          this.#connection.renewInvite();
        }
        if (!launch.code && invite?.inviteCode) {
          await this.#room.update((data) => {
            if (data.launch?.id === attempt) data.launch.code = invite.inviteCode;
          });
          if (!current()) return;
        }
        const racers = snapshot.data.cup.roster;
        if (!racers.every((p) => this.#bindings.has(p.id))) return;
        const nativeIds = racers.map((p) => this.#bindings.get(p.id)!);
        if (!this.#bridge.ready(nativeIds)) return;
        // The database also verifies current-attempt bindings before accepting this transition.
        await this.#room.update((data) => {
          if (data.launch?.id !== attempt) throw new Error('The start attempt changed.');
          data.launch.stage = 'racing';
        });
        if (!current()) return;
        await this.#bridge.begin(this.#room.snapshot!.data, this.#bindings, this.#tracks);
        this.#bridge.entered();
        this.#finished = true;
      } else {
        if (Date.now() - this.#lastTicket > 1000) {
          this.#lastTicket = Date.now();
          this.#channel.send(0, { type: 'room-ticket', launch: attempt, ticket: snapshot.ticket });
        }
        if (
          launch.stage === 'racing' &&
          this.#bridge.started(snapshot.id) &&
          (!this.#room.ranked || this.#room.verifiedConnection(self))
        ) {
          this.#room.suspend();
          this.#bridge.entered();
          this.#finished = true;
        }
      }
    } catch (error) {
      if (!current()) return;
      this.#abort?.abort();
      this.#connection?.dispose();
      this.#connection = undefined;
      this.#bridge.returnToMenu();
      this.#room.resume();
      if (!this.#room.ranked)
        this.#room.failedConnection?.(
          `Could not connect: ${(error as Error).message} ${this.#room.isHost ? 'Your picks are saved; try starting again.' : 'Waiting for the host to retry.'}`,
        );
      if (this.#room.ranked && this.#room.snapshot?.data.launch?.stage === 'racing') {
        await this.#room.leave().catch(() => {});
      } else if (this.#room.isHost) {
        await this.#room
          .update((data) => {
            if (data.launch?.id === attempt)
              cancelRoomStart(
                data,
                `${(error as Error).message} Your picks are saved; try starting again.`,
              );
          })
          .catch(() => {});
      }
      // Clients keep the room open and tell the host; timeout/cancel ends the shared attempt.
      else if (this.#room.ranked) await this.#room.submit('failed', attempt).catch(() => {});
      else
        await this.#room
          .submit(
            'chat',
            `Could not connect: ${(error as Error).message} Please cancel and retry the start.`,
          )
          .catch(() => {});
      if (this.#attempt === attempt) this.#finished = true;
    } finally {
      this.#busy = false;
    }
  }
}

export function controllerRaceBridge(c: Controller): RaceBridge {
  return {
    async prepare(data, signal) {
      const map = new Map<string, LoadedTrack>();
      const codes = await c.waitingRoom!.trackCodes();
      const pool = c
        .availableTracks()
        .filter((t) => rulesFor(data.cup).pool.includes(t.category as 'official'));
      let chosen = data.cup.tracks;
      if (rulesFor(data.cup).selection === 'random') {
        if (!pool.length) throw new Error('The track pool is empty.');
        chosen = [pool[Math.floor(Math.random() * pool.length)]];
      }
      for (const track of chosen) {
        signal.throwIfAborted();
        const code = codes[track.id];
        const loaded = code
          ? c.native.parse(code)
          : await pool.find((t) => t.id === track.id)?.load();
        if (!loaded?.trackData.hasStartingPoint() || loaded.trackData.getId() !== track.id)
          throw new Error(`Could not load ${track.name}.`);
        map.set(track.id, {
          ...loaded,
          code: loaded.trackData.toExportString(loaded.trackMetadata),
        });
      }
      return map;
    },
    connect: (host, signal, tracks, code) =>
      launchNativeRace(host ? 'host' : 'join', signal, tracks?.values().next().value, code),
    self: () => c.nativeSelfId,
    peers: (connection) => c.native.peers(connection),
    ready: (ids) => c.connectedRacers(ids),
    started: (_cupId) => c.nativeState !== null,
    entered: () => c.finishWaitingRace(),
    rebind: (oldId, newId) => c.verifiedRankedReconnect(oldId, newId),
    async begin(data, ids, tracks) {
      const state = raceState(data, ids);
      for (const [member, native] of ids) {
        const racer = state.roster.find((p) => p.id === native),
          profile = c.room?.rank(member);
        if (racer && profile !== undefined)
          racer.rank = profile
            ? {
                tier: profile.tier,
                rating: profile.rating,
                gm_position: profile.gm_position,
                provisional: profile.provisional,
              }
            : null;
      }
      if (rulesFor(state).selection === 'random')
        state.tracks = [...tracks.entries()].map(([id, t]) => ({ id, name: t.trackMetadata.name }));
      await c.acceptWaitingRace(state, tracks);
    },
    returnToMenu: returnToNativeMenu,
  };
}
