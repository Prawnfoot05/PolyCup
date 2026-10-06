import type { CameraView } from './types.ts';
import type { LobbyPlayer } from './game-types.ts';
import * as Cup from './cup.ts';
import { banTrack, beginBans, picksOpen, resetDraft } from './draft.ts';
import type {
  GameInfo,
  LibraryTrack,
  LoadedTrack,
  NativeApi,
  NativeCar,
  NativeConnection,
  NativeGame,
  PolyModLoader,
} from './game-types.ts';
import { frameNumber, InputCapture, inputMask, InputTimeline, validInputEvents } from './inputs.ts';
import { connectNative, CupTransport } from './native.ts';
import { CheckpointProgress } from './progress.ts';
import type {
  ActionMessage,
  ActionType,
  CheckpointMessage,
  FinishMessage,
  InputViewMessage,
  Message,
  ReadyMessage,
  StateMutation,
  TrackMessage,
} from './protocol.ts';
import { ReviewLog } from './review.ts';
import { ReconnectRegistry, validPublicKey, type ProfileIdentity } from './reconnect.ts';
import { CameraBuffer, validPose } from './spectator.ts';
import { standings, updateLiveMovement } from './standings.ts';
import type {
  CameraPose,
  CupState,
  InputContext,
  InputPacket,
  RaceRecord,
  Round,
} from './types.ts';
import { validPB, validSnapshot, validWR } from './validation.ts';
export class Controller {
  #reconnect = new ReconnectRegistry();
  #identity: Promise<ProfileIdentity> | null = null;
  #identityCup = '';
  #lastIdentity = 0;
  #reconnectOffer: number | null = null;
  #reconnectDeclined = false;
  get reconnectOffer() {
    return this.#reconnectOffer;
  }
  get game() {
    return this.#game;
  }
  get info() {
    return this.#info;
  }
  get state() {
    return this.#state;
  }
  get panelRequest() {
    return this.#panelRequest;
  }
  get selfId() {
    return this.#selfId;
  }
  get connection() {
    return this.#connection;
  }
  get lobby() {
    return this.#lobby;
  }
  get watchId() {
    return this.#watchId;
  }
  get startingCup() {
    return this.#startingCup;
  }
  get pendingUpload() {
    return this.#pendingUpload;
  }
  get review() {
    return this.#review;
  }
  get native() {
    return this.#native;
  }
  get hideOtherGhosts() {
    return this.#hideOtherGhosts;
  }
  get isHost() {
    return this.#isHost;
  }
  get hello() {
    return this.#hello;
  }
  get error() {
    return this.#error;
  }
  get auto() {
    return this.#auto;
  }
  get watchStatus() {
    return this.#watchStatus;
  }
  get transferProgress() {
    return this.#transferProgress;
  }
  get needsRebind() {
    return this.#needsRebind;
  }

  #onChange: () => void;
  #state: CupState | null = null;
  #game: NativeGame | null = null;
  #connection: NativeConnection | null = null;
  #isHost: boolean = false;
  #selfId: number | null = null;
  #lobby: LobbyPlayer[] = [];
  #tracks: Map<string, LoadedTrack> = new Map();
  #hello: Set<number> = new Set();
  #offset: number = 0;
  #bestRtt: number = Infinity;
  #error: string = '';
  #resetKey: string = '';
  #startKey: string = '';
  #readyKey: string = '';
  #lastBroadcast: number = 0;
  #transport: CupTransport;
  #trackUploads: Map<
    number,
    { transferId: string; cupId: string; length: number; data: string; seq: number; until: number }
  > = new Map();
  #pendingUpload: { transferId: string; done: boolean; error: string | null } | null = null;
  #transferProgress: string = '';
  #recordRequests: Map<string, { pending: boolean; until: number }> = new Map();
  #lastRecordPoll: number = 0;
  #startingCup: object | null = null;

  #lastHello: number = 0;
  #lastSaved: number = -1;
  #auto: boolean = true;
  #cameraTransport: CupTransport;
  #cameraBuffers: Map<number, CameraBuffer> = new Map();
  #subscriptions: Map<number, number> = new Map();
  #watchId: number | null = null;
  #lastPose: number = 0;
  #lastSubscribe: number = 0;
  #watchStatus: string = '';
  #watchedPose: CameraPose | null = null;
  #hideOtherGhosts: boolean = false;
  #checkpointProgress: CheckpointProgress = new CheckpointProgress();
  #syncSequence: number = 0;
  #receivedSequence: number = -1;
  #panelRequest: {
    revision: number;
    open: boolean;
    message: string;
  } = { revision: 0, open: false, message: '' };
  #roundViewKey: string = '';
  #review: ReviewLog = new ReviewLog();
  #liveInputs: Map<number, InputTimeline> = new Map();
  #inputSequences: Map<number, number> = new Map();
  #native!: NativeApi;
  #timer: number | undefined;
  #inputGame: NativeGame | null = null;
  #inputCapture: InputCapture | null = null;
  #info: GameInfo | null = null;
  #unwatchInputs: (() => void) | undefined;
  #needsRebind: Set<number> = new Set();
  #viewCupId: string | null = null;
  #inputScope: string = '';
  #manualWatchRound: string | null = null;
  #lastWatchPose: CameraView | null = null;
  #filteredCars: boolean = false;
  #followingGame: NativeGame | null = null;
  #nextAuto: number | null = null;
  #loadingSession: number | undefined;
  #sentRevision: number | undefined;
  #savedReview: number = 0;
  #savedAt: number = 0;

  #onSpectatorInputs?: () => void;
  constructor(onChange: () => void) {
    this.#onChange = onChange;

    this.#transport = new CupTransport(
      (id, m) => this.receive(id, m),
      () => {
        this.#lastBroadcast = 0;
      },
    );

    this.#cameraTransport = new CupTransport(
      (id, m) => m.type === 'camera' && this.receiveCamera(id, m),
      () => {},
      { channelId: 43, realtime: true },
    );
  }
  get cup(): CupState {
    if (!this.#state) throw new Error('No Cup is active.');
    return this.#state;
  }
  get round(): Round {
    if (!this.cup.runtime) throw new Error('No round is active.');
    return this.cup.runtime;
  }
  get gameInfo(): GameInfo {
    if (!this.#info) throw new Error('No game session is active.');
    return this.#info;
  }
  get activeGame(): NativeGame {
    if (!this.#game) throw new Error('No game is active.');
    return this.#game;
  }
  get localPlayerId(): number | null {
    return this.#selfId;
  }
  toggleAutomaticRounds() {
    this.requireHost();
    this.#auto = !this.#auto;
    this.#nextAuto =
      this.#auto && this.#state?.phase === 'between-rounds' && !this.recoveryRacers().length
        ? Date.now() + 5000
        : null;
  }
  onInputsChanged(callback: () => void) {
    this.#onSpectatorInputs = callback;
  }
  init(pml: PolyModLoader) {
    if (this.#timer !== undefined) return;
    this.#native = connectNative(pml, this);
    this.#timer = setInterval(() => this.tick(), 100);
  }
  now() {
    return Date.now() + (this.#isHost ? 0 : this.#offset);
  }
  gameDisposed(game: NativeGame) {
    // Track changes replace the game immediately. Leaving a lobby does not.
    setTimeout(() => {
      if (this.#game !== game) return;
      if (this.#isHost && this.#state) {
        this.#review.close(this.cup, 'interrupted');
        this.save(true);
      }
      this.#unwatchInputs?.();
      this.#inputGame = null;
      this.#inputCapture = null;
      this.#liveInputs.clear();
      this.#transport.dispose();
      this.#cameraTransport.dispose();
      this.#connection = null;
      this.#game = null;
      this.#info = null;
      this.#state = null;
      this.#lobby = [];
      this.#selfId = null;
      this.#auto = false;
      this.#isHost = false;
      this.#cameraBuffers.clear();
      this.#onChange();
    }, 500);
  }
  fail(error: unknown) {
    this.#error = error instanceof Error ? error.message : String(error);
    console.error('[PolyCup]', error);
    this.#onChange();
  }
  observeGame(game: NativeGame) {
    if (!this.#native) return;
    const info = this.#native.read(game);
    if (!info.connection) return;
    this.#game = game;
    this.#info = info;
    this.#lobby = info.connection.getPlayers();
    this.#selfId = this.#lobby.find((p) => p.isSelf)?.id ?? null;
    if (this.#inputGame !== game) {
      this.#unwatchInputs?.();
      this.#inputGame = game;
      this.#unwatchInputs = this.#native.watchInputs?.(game, () => this.captureInputs());
    }
    if (this.#connection !== info.connection) {
      this.#transport.dispose();
      this.#cameraTransport.dispose();
      this.#cameraBuffers.clear();
      this.#subscriptions.clear();
      this.#hello.clear();
      this.#connection = info.connection;
      this.#identity = null;
      this.#identityCup = '';
      this.#reconnectOffer = null;
      this.#reconnectDeclined = false;
      this.#trackUploads.clear();
      this.#recordRequests.clear();
      this.#isHost = this.#connection instanceof this.#native.Host;
      this.#state = null;
      this.#startingCup = null;
      this.#resetKey = '';
      this.#readyKey = '';
      this.#lastSaved = -1;
      this.#lastHello = 0;
      this.#offset = 0;
      this.#bestRtt = Infinity;
      this.#watchId = null;
      this.#needsRebind = new Set();
      this.#syncSequence = 0;
      this.#receivedSequence = -1;
      this.#roundViewKey = '';
      this.#viewCupId = null;
      this.#onChange();
    }
    if (!this.#state || this.localPlayerId === null) return;
    const racing = Cup.activeIds(this.#state).includes(this.localPlayerId);
    const phase = this.cup.phase;
    if (!racing && info.spectator) this.#native.enableCupSpectator?.(game);
    const run = this.cup.runtime;
    if (
      run &&
      ['warmup', 'countdown', 'racing'].includes(phase) &&
      info.sessionId === run.sessionId
    ) {
      const resetKey = `${run.id}:${phase === 'warmup' ? 'warmup' : 'race'}`;
      if (this.#resetKey !== resetKey) {
        this.#resetKey = resetKey;
        this.#startKey = '';
        this.#native.reset(game);
        this.#native.clearRecords(this.#connection);
        if (racing) info.spectator.isEnabled = false;
        this.#info = this.#native.read(game);
        if (phase !== 'warmup' && racing) this.hookFinish(this.gameInfo.car, run);
      }
      const startDue =
        (phase === 'countdown' || phase === 'racing') &&
        run.startsAt !== null &&
        this.now() >= run.startsAt!!;
      if (racing && startDue && this.#startKey !== run.id) {
        this.#startKey = run.id;
        this.gameInfo.car.start();
        this.captureInputs();
      }
    }
  }
  shouldBlock(game: NativeGame) {
    if (!this.#state || game !== this.#game) return false;
    if (this.localPlayerId === null) return true;
    if (!Cup.activeIds(this.#state).includes(this.localPlayerId)) return true;
    if (this.gameInfo.sessionId !== this.cup.runtime?.sessionId) return true;
    if (this.cup.phase === 'warmup') return false;
    return !(
      ['racing', 'countdown'].includes(this.cup.phase) &&
      this.cup.runtime?.startsAt !== null &&
      this.now() >= this.round.startsAt! &&
      !(this.localPlayerId in this.round.finishes) &&
      !this.round.dnfs.includes(this.localPlayerId)
    );
  }
  shouldBlockRestart(game: NativeGame) {
    return !!this.#state && game === this.#game && this.cup.phase !== 'warmup';
  }
  restartHotkey(event: KeyboardEvent) {
    const s = this.#state,
      run = s?.runtime;
    if (
      this.localPlayerId === null ||
      event.repeat ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event
        .composedPath()
        .some(
          (e) =>
            ['INPUT', 'TEXTAREA', 'SELECT'].includes((e as HTMLElement).tagName) ||
            (e as HTMLElement).isContentEditable,
        ) ||
      !this.#game ||
      this.#info?.disposed ||
      s?.phase !== 'racing' ||
      !run ||
      this.#info?.sessionId !== run.sessionId ||
      run.startsAt === null ||
      this.now() < run.startsAt ||
      !Cup.activeIds(s).includes(this.localPlayerId) ||
      Cup.roundDone(s, this.localPlayerId) ||
      !this.#native.restartPressed(this.#game, event)
    )
      return false;
    // Do not attach this to the native restart routine: checkpoint reset can
    // call that same routine when no checkpoint is available.
    this.action('dnf', run.id);
    return true;
  }
  hookFinish(car: NativeCar, run: Round) {
    let checkpoint: number | null = null;
    const checkpointIndex = this.gameInfo.checkpointCount - 2;
    car.addCheckpointCallback((index) => {
      if (index === checkpointIndex && checkpointIndex >= 0)
        checkpoint = car.getTime().numberOfFrames;
      if (
        this.localPlayerId === null ||
        this.#state?.phase !== 'racing' ||
        this.cup.runtime?.id !== run.id
      )
        return;
      // The native callback receives the previous index. Read the current
      // progress so a frame crossing several checkpoints reports the furthest.
      const reached = car.getNextCheckpointIndex() - 1;
      if (reached < 0 || reached > checkpointIndex) return;
      const message: CheckpointMessage = {
        type: 'checkpoint',
        cupId: this.cup.id,
        roundId: run.id,
        sessionId: run.sessionId,
        index: reached,
        frames: car.getTime().numberOfFrames,
      };
      if (this.#isHost) this.receiveCheckpoint(this.localPlayerId, message);
      else this.#transport.send(0, message);
    });
    car.addFinishCallback(() => {
      if (
        this.localPlayerId === null ||
        this.#state?.phase !== 'racing' ||
        this.cup.runtime?.id !== run.id
      )
        return;
      this.flushInputs();
      const message: FinishMessage = {
        type: 'finish',
        roundId: run.id,
        sessionId: run.sessionId,
        frames: car.getTime().numberOfFrames,
        checkpoint,
      };
      if (this.#isHost) this.receiveFinish(this.localPlayerId, message);
      else this.#transport.send(0, message);
    });
  }
  receiveFinish(id: number, m: FinishMessage) {
    const run = this.#state?.runtime;
    if (!run || m.roundId !== run.id || m.sessionId !== run.sessionId) return;
    const before = standings(this.cup).map((r) => r.id);
    if (Cup.recordFinish(this.cup, id, m.frames, this.now())) {
      if (
        typeof m.checkpoint === 'number' &&
        Number.isSafeInteger(m.checkpoint) &&
        m.checkpoint >= 0 &&
        m.checkpoint <= m.frames
      )
        run.checkpoints[id] = m.checkpoint;
      updateLiveMovement(this.cup, before);
      this.broadcast();
    }
  }
  receiveCheckpoint(id: number, m: CheckpointMessage) {
    const run = this.#state?.runtime;
    if (
      !this.#isHost ||
      !run ||
      m.cupId !== this.cup.id ||
      m.roundId !== run.id ||
      m.sessionId !== run.sessionId ||
      this.#info?.sessionId !== run.sessionId
    )
      return;
    if (
      this.#checkpointProgress.record(
        this.cup,
        id,
        m.index,
        m.frames,
        this.now(),
        this.gameInfo.checkpointCount,
      )
    ) {
      this.ensureReview();
      this.#review.checkpoint(run.id, id, m.index, m.frames);
      this.broadcast();
    }
  }
  ensureReview() {
    if (!this.#isHost || !this.#state) return;
    if (this.#review.cupId !== this.cup.id) this.#review = new ReviewLog(this.cup.id);
    if (
      this.cup.phase === 'racing' ||
      (this.cup.phase === 'countdown' && this.now() >= (this.cup.runtime?.startsAt ?? Infinity))
    )
      this.#review.begin(this.#state, this.#info?.checkpointCount ?? 0);
  }
  inputContext(): InputContext | null {
    const s = this.#state,
      r = s?.runtime;
    if (
      !r ||
      r.sessionId !== this.#info?.sessionId ||
      this.#info?.disposed ||
      !(
        s.phase === 'warmup' ||
        (['countdown', 'racing'].includes(s.phase) &&
          r.startsAt !== null &&
          this.now() >= r.startsAt)
      )
    )
      return null;
    return {
      cupId: s.id,
      roundId: r.id,
      sessionId: r.sessionId,
      stage: s.phase === 'warmup' ? 'warmup' : 'race',
    };
  }
  syncInputScope(context: InputContext | null) {
    const scope = JSON.stringify(context);
    if (scope !== this.#inputScope) {
      this.#inputScope = scope;
      this.#inputCapture = null;
      this.#liveInputs.clear();
      this.#inputSequences.clear();
    }
  }
  captureInputs() {
    if (this.localPlayerId === null) return;
    const context = this.inputContext();
    this.syncInputScope(context);
    if (
      !context ||
      !Cup.activeIds(this.#state).includes(this.localPlayerId) ||
      Cup.roundDone(this.#state, this.localPlayerId) ||
      !this.#native?.readInputs
    )
      return;
    this.#inputCapture ??= new InputCapture(context);
    try {
      const sample = this.#native.readInputs(this.activeGame);
      this.#inputCapture.capture(sample.frames, inputMask(sample.controls));
    } catch {
      // Evidence capture must never interrupt the native render/control loop.
      this.#inputCapture.markGap();
    }
  }
  flushInputs() {
    if (this.localPlayerId === null) return;
    this.captureInputs();
    if (
      !this.#inputCapture ||
      !this.inputContext() ||
      Cup.roundDone(this.#state, this.localPlayerId)
    )
      return;
    const actor = this.localPlayerId;
    return this.#inputCapture.flush((message) =>
      this.#isHost ? this.receiveInputs(actor, message) : this.#transport.send(0, message),
    );
  }
  receiveInputs(id: number, m: InputPacket) {
    const context = this.inputContext();
    if (
      !this.#isHost ||
      !context ||
      !Object.entries(context).every(([k, v]) => m[k as keyof InputContext] === v) ||
      (id !== this.#selfId && !this.#hello.has(id)) ||
      !Cup.activeIds(this.#state).includes(id) ||
      Cup.roundDone(this.#state, id) ||
      !Number.isSafeInteger(m.seq) ||
      m.seq < 0 ||
      !frameNumber(m.through) ||
      typeof m.gap !== 'boolean' ||
      !Number.isSafeInteger(m.attempt) ||
      m.attempt < 0 ||
      (context.stage === 'race' && m.attempt !== 0) ||
      !validInputEvents(m.events, m.through) ||
      (context.stage === 'race' && m.through > this.now() - this.round.startsAt! + 2000)
    )
      return false;
    this.syncInputScope(context);
    if (m.seq <= (this.#inputSequences.get(id) ?? -1)) return false;
    let timeline = this.#liveInputs.get(id) ?? new InputTimeline();
    if (m.attempt < timeline.attempt) return false;
    if (m.attempt > timeline.attempt) {
      timeline = new InputTimeline(m.attempt);
    }
    if (
      m.through < timeline.through ||
      (m.events.length && m.events[0][0] < (timeline.events.at(-1)?.[0] ?? 0))
    )
      return false;
    if (context.stage === 'race') {
      this.ensureReview();
      if (!this.#review.inputs(m.roundId, id, m)) return false;
    }
    this.#inputSequences.set(id, m.seq);
    timeline.push(m.events, m.through, this.now());
    this.#liveInputs.set(id, timeline);
    for (const [spectator, watched] of this.#subscriptions)
      if (watched === id && Cup.mayWatch(this.#state, spectator))
        this.#transport.send(spectator, {
          type: 'input-view',
          ...context,
          racerId: id,
          attempt: m.attempt,
          through: m.through,
          events: m.events,
        });
    return true;
  }
  receiveInputView(id: number, m: InputViewMessage) {
    const context = this.inputContext();
    if (
      this.#isHost ||
      id !== 0 ||
      !context ||
      !this.canSpectate() ||
      m.racerId !== this.#watchId ||
      !Object.entries(context).every(([k, v]) => m[k as keyof InputContext] === v) ||
      !Number.isSafeInteger(m.attempt) ||
      m.attempt < 0 ||
      (context.stage === 'race' && m.attempt !== 0) ||
      !frameNumber(m.through) ||
      !validInputEvents(m.events, m.through)
    )
      return;
    this.syncInputScope(context);
    let timeline = this.#liveInputs.get(m.racerId) ?? new InputTimeline();
    if (m.attempt < timeline.attempt) return;
    if (m.attempt > timeline.attempt) {
      timeline = new InputTimeline(m.attempt);
    }
    if (timeline.push(m.events, m.through, this.now())) this.#liveInputs.set(m.racerId, timeline);
  }
  watchedInputs() {
    return this.canSpectate() && this.#watchedPose
      ? (this.#liveInputs.get(this.#watchId!)?.sample(this.#watchedPose.frames, this.now()) ?? null)
      : null;
  }
  canSpectate() {
    if (!this.#state?.runtime) return false;
    if (this.localPlayerId === null) return false;
    if (!Cup.mayWatch(this.#state, this.#selfId)) return false;
    if (!Cup.activeIds(this.#state).includes(this.localPlayerId)) return true;
    return (
      this.#manualWatchRound === this.cup.runtime?.id ||
      (!!this.#game && (this.#native?.autoSpectate?.(this.#game) ?? true))
    );
  }
  watchRemaining() {
    if (this.localPlayerId === null) return;
    if (!Cup.roundDone(this.#state, this.localPlayerId)) return;
    this.#manualWatchRound = this.round.id;
    this.#onChange();
  }
  toggleGhosts() {
    if (!this.#state) return;
    this.#hideOtherGhosts = !this.#hideOtherGhosts;
    this.#onChange();
  }
  watchable() {
    return this.#state && this.cup.phase !== 'complete'
      ? Cup.activeIds(this.#state).filter(
          (id) => !Cup.roundDone(this.#state, id) && this.#lobby.some((p) => p.id === id),
        )
      : [];
  }
  cycleWatch(delta: number) {
    const ids = this.watchable();
    if (!this.canSpectate() || !ids.length) return;
    const i = ids.indexOf(this.#watchId!);
    this.selectWatch(ids[(i + delta + ids.length) % ids.length]);
  }
  selectWatch(id: number) {
    if (!this.canSpectate() || !this.watchable().includes(id)) return;
    if (!this.#isHost) this.#liveInputs.clear();
    this.#watchId = id;
    this.#lastSubscribe = 0;
    this.#watchedPose = null;
    this.#lastWatchPose = null;
    this.#onChange();
  }
  beforeRender(game: NativeGame) {
    if (game !== this.#game) return;
    this.captureInputs();
    const spectating = !this.#info?.disposed && this.canSpectate() && this.watchable().length > 0;
    // Native session-end screens still render after the session stops accepting
    // controls. Update their presentation before the disposed-session guard.
    this.#native.presentation?.(game, !!this.#state, spectating);
    if (this.#info?.disposed || this.localPlayerId === null) return;
    if (!this.#state) {
      if (this.#filteredCars) this.#native.visibility(game, null, this.localPlayerId);
      this.#filteredCars = false;
      return;
    }
    const now = this.now(),
      active = Cup.activeIds(this.#state);
    if (this.canSpectate() && !this.watchable().includes(this.#watchId!))
      this.selectWatch(this.watchable()[0]);
    if (!spectating && this.#followingGame === game) {
      this.#native.release(game);
      this.#followingGame = null;
      this.#lastWatchPose = null;
    }
    const viewed = spectating ? this.#watchId : this.#selfId;
    this.#native.visibility(
      game,
      this.#hideOtherGhosts ? active.filter((id) => id === viewed) : active,
      this.localPlayerId,
    );
    this.#filteredCars = true;
    if (
      active.includes(this.localPlayerId) &&
      !Cup.roundDone(this.#state, this.localPlayerId) &&
      now - this.#lastPose >= 50 &&
      !this.gameInfo.spectator.isEnabled
    ) {
      this.#lastPose = now;
      const pose = { ...this.#native.camera(game), at: now };
      if (this.#isHost) this.relayCamera(this.localPlayerId, pose);
      else this.#cameraTransport.send(0, { type: 'camera', pose });
    }
    if (!spectating) {
      this.#watchedPose = null;
      this.#onSpectatorInputs?.();
      return;
    }
    if (!this.#isHost && Date.now() - this.#lastSubscribe > 1000) {
      if (this.#transport.send(0, { type: 'watch', value: this.#watchId }))
        this.#lastSubscribe = Date.now();
    }
    const buffer = this.#cameraBuffers.get(this.#watchId!);
    const pose = buffer?.playback(now, this.gameInfo.sessionId, performance.now());
    this.#watchedPose = pose ?? null;
    this.#watchStatus = pose ? 'Buffered POV' : 'Waiting for racer camera';
    if (pose) this.#lastWatchPose = pose;
    else if (!this.#lastWatchPose || this.#lastWatchPose.sessionId !== this.gameInfo.sessionId)
      this.#lastWatchPose = {
        ...this.#native.camera(game),
        carPosition: undefined,
        carQuaternion: undefined,
      };
    this.#native.follow(game, this.#lastWatchPose!, this.#watchId!);
    this.#followingGame = game;
    this.#onSpectatorInputs?.();
  }
  receiveCamera(id: number, message: Extract<Message, { type: 'camera' }>) {
    if (
      message.type !== 'camera' ||
      !validPose(message.pose) ||
      !this.#state ||
      Math.abs(message.pose.at - this.now()) > 5000 ||
      message.pose.sessionId !== this.#info?.sessionId
    )
      return;
    if (this.#isHost) {
      if (
        this.#hello.has(id) &&
        Cup.activeIds(this.#state).includes(id) &&
        !Cup.roundDone(this.#state, id)
      )
        this.relayCamera(id, message.pose);
    } else if (id === 0 && message.racerId === this.#watchId!)
      this.bufferCamera(message.racerId, message.pose);
  }
  bufferCamera(id: number, pose: CameraPose) {
    if (!this.#cameraBuffers.has(id)) this.#cameraBuffers.set(id, new CameraBuffer());
    this.#cameraBuffers.get(id)!.push(pose);
  }
  relayCamera(id: number, pose: CameraPose) {
    this.bufferCamera(id, pose);
    for (const [spectator, watched] of this.#subscriptions)
      if (watched === id && Cup.mayWatch(this.#state, spectator))
        this.#cameraTransport.send(spectator, { type: 'camera', racerId: id, pose });
  }
  tick() {
    try {
      if (!this.#connection || !this.#native || !this.#game) return;
      this.#info = this.#native.read(this.#game);
      if (this.gameInfo.disposed) return;
      this.#lobby = this.#connection.getPlayers();
      this.#selfId = this.#lobby.find((p) => p.isSelf)?.id ?? null;
      if (this.#selfId === null) {
        this.#onChange();
        return;
      }
      this.#transport.sync(this.#native.peers(this.#connection));
      this.#cameraTransport.sync(this.#native.peers(this.#connection));
      this.syncReconnect();
      if (Date.now() - this.#lastHello > 2000) {
        this.#lastHello = Date.now();
        if (!this.#isHost)
          this.#transport.send(0, { type: 'hello', version: Cup.VERSION, sentAt: Date.now() });
      }
      if (!this.#state) {
        if (this.#isHost && Date.now() - this.#lastBroadcast > 1000) this.broadcast();
        this.#onChange();
        return;
      }
      this.sendReady();
      this.ensureReview();
      this.flushInputs();
      this.refreshRecords();
      for (const [id, upload] of this.#trackUploads)
        if (upload.until < Date.now()) this.#trackUploads.delete(id);
      if (this.#isHost) {
        this.checkDisconnects();
        this.advanceClock();
        if (this.cup.phase === 'racing' && this.gameInfo.sessionId === this.round.sessionId) {
          const run = this.round;
          if (
            Cup.allFinished(this.#state) ||
            (run.deadline !== null && this.now() >= run.deadline + 1500)
          )
            this.finishRound();
        }
        if (
          this.#auto &&
          this.cup.phase === 'between-rounds' &&
          this.#nextAuto &&
          Date.now() >= this.#nextAuto
        ) {
          this.#nextAuto = null;
          if (!this.recoveryRacers().length) this.runRound();
        }
        if (Date.now() - this.#lastBroadcast > 1000 || this.#sentRevision !== this.cup.revision)
          this.broadcast();
        this.save();
      }
      this.#onChange();
    } catch (error) {
      this.#auto = false;
      this.fail(error);
    }
  }
  create(name: string) {
    this.requireHost();
    this.#state = Cup.newCup(name);
    this.#startingCup = null;
    this.#tracks.clear();
    this.#error = '';
    resetDraft(this.#state);
    this.#needsRebind = new Set();
    this.#trackUploads.clear();
    this.#recordRequests.clear();
    this.#auto = true;
    this.#lastSaved = -1;
    this.broadcast();
    this.#onChange();
    this.ensureReview();
  }
  requireHost() {
    if (!this.#isHost || !this.#connection)
      throw new Error('Host a PolyTrack multiplayer lobby first.');
  }
  beginBans() {
    this.requireHost();
    this.requireStartRacers();
    const pool = this.availableTracks().filter((t) =>
      ['official', 'community'].includes(t.category),
    );
    if (new Set(pool.map((t) => t.id)).size <= this.cup.roster.length)
      throw new Error('The main/community track pool is not ready.');
    this.change((s) => beginBans(s));
    this.#tracks.clear();
    this.#trackUploads.clear();
  }
  reopenRoster() {
    this.change((s) => resetDraft(s));
    this.#tracks.clear();
    this.#trackUploads.clear();
  }
  requestPanel(open: boolean, message: string = '') {
    this.#panelRequest = { revision: this.#panelRequest.revision + 1, open, message };
  }
  async rematch(newTracks = false) {
    this.requireHost();
    if (this.#state?.phase !== 'complete')
      throw new Error('Finish the Cup before starting a rematch.');
    if (!newTracks) {
      this.requireStartRacers();
      if (this.cup.tracks.some((t) => !this.#tracks.has(t.id)))
        throw new Error('A rematch track is missing. Choose new tracks instead.');
    }
    this.save();
    this.#state = Cup.rematch(this.#state, newTracks);
    this.#startingCup = null;
    if (newTracks) this.#tracks.clear();
    this.#trackUploads.clear();
    this.#recordRequests.clear();
    this.#cameraBuffers.clear();
    this.#subscriptions.clear();
    this.#watchId = null;
    this.#lastWatchPose = null;
    this.#manualWatchRound = null;
    this.#auto = true;
    this.#nextAuto = null;
    this.#loadingSession = undefined;
    this.#lastSaved = -1;
    this.#error = '';
    this.broadcast();
    this.#onChange();
    if (!newTracks) await this.startCup();
  }
  syncRoundPanel() {
    const s = this.#state,
      run = s?.runtime;
    const key = JSON.stringify([s?.id, s?.phase, run?.id, run?.sessionId]);
    if (key === this.#roundViewKey) return;
    this.#roundViewKey = key;
    if (run && ['loading', 'warmup', 'countdown', 'racing'].includes(s.phase)) {
      this.requestPanel(false);
    } else if (
      s &&
      (this.#viewCupId !== s.id ||
        (s.phase === 'between-rounds' && this.recoveryRacers().length > 0))
    ) {
      this.requestPanel(true);
    }
    this.#viewCupId = s?.id ?? null;
  }
  releaseCup(message: string) {
    this.#reconnect.reset('');
    this.#reconnectOffer = null;
    this.#identity = null;
    this.#identityCup = '';
    this.#state = null;
    this.#startingCup = null;
    this.#auto = false;
    this.#nextAuto = null;
    this.#loadingSession = undefined;
    this.#resetKey = '';
    this.#startKey = '';
    this.#readyKey = '';
    this.#error = '';
    this.#cameraBuffers.clear();
    this.#subscriptions.clear();
    this.#recordRequests.clear();
    this.#trackUploads.clear();
    this.#watchId = null;
    this.#watchedPose = null;
    this.#lastWatchPose = null;
    this.#watchStatus = '';
    this.#followingGame = null;
    this.#manualWatchRound = null;
    if (this.#pendingUpload) this.#pendingUpload.error = 'The Cup ended.';
    this.#transferProgress = '';
    this.#roundViewKey = '';
    this.#viewCupId = null;
    if (this.#game) this.#native?.presentation?.(this.#game, false, false);
    if (this.#game && !this.#info?.disposed && this.localPlayerId !== null) {
      this.#native?.release?.(this.#game);
      if (this.#info?.spectator) this.gameInfo.spectator.isEnabled = false;
      this.#native?.visibility?.(this.#game, null, this.localPlayerId);
      this.#filteredCars = false;
    }
    this.requestPanel(false, message);
    this.syncInputScope(null);
    this.#onSpectatorInputs?.();
  }
  endCup() {
    this.requireHost();
    if (!this.#state) return;
    this.#review.close(this.#state, 'interrupted');
    this.save(true);
    this.releaseCup('Cup ended · Normal multiplayer');
    this.broadcast();
    this.#onChange();
  }
  acceptTrack(actor: number, code: string) {
    if (typeof code !== 'string' || code.length > 2000000)
      throw new Error('The track code is too large.');
    const track = this.#native.parse(code.trim());
    if (!track?.trackData?.hasStartingPoint())
      throw new Error('The code must contain a valid PolyTrack track with a start.');
    const id = track.trackData.getId();
    Cup.chooseTrack(this.cup, actor, { id, name: track.trackMetadata.name });
    this.#tracks.set(id, { ...track, code: code.trim() });
    this.pruneTrackData();
    this.broadcast();
  }
  pruneTrackData() {
    for (const id of this.#tracks.keys())
      if (!this.cup.tracks.some((t) => t.id === id)) this.#tracks.delete(id);
  }
  async importTrack(code: string) {
    if (
      this.localPlayerId === null ||
      this.#state?.phase !== 'registration' ||
      !Cup.player(this.#state, this.localPlayerId)
    )
      throw new Error('Join as a racer before choosing a track.');
    if (typeof code !== 'string' || !code.trim() || code.length > 2000000)
      throw new Error('Choose a valid track of up to 2 MB.');
    if (this.#isHost) {
      this.acceptTrack(this.localPlayerId, code);
      return;
    }
    if (this.#pendingUpload) throw new Error('Your previous track is still uploading.');
    const cupId = this.cup.id,
      connection = this.#connection,
      transferId = crypto.randomUUID();
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const pending = { transferId, done: false, error: null };
    this.#pendingUpload = pending;
    const send = async (
      message:
        | { type: 'track-begin'; length: number }
        | { type: 'track-chunk'; seq: number; data: string }
        | { type: 'track-end' },
    ) => {
      const deadline = Date.now() + 5000;
      while (true) {
        if (
          this.#connection !== connection ||
          this.#state?.id !== cupId ||
          this.cup.phase !== 'registration'
        )
          throw new Error('The Cup changed during track upload.');
        if (pending.error) throw new Error(pending.error);
        if (this.#transport.send(0, { ...message, cupId, transferId })) return;
        if (Date.now() > deadline) throw new Error('Track upload lost its connection. Try again.');
        await sleep(100);
      }
    };
    try {
      await send({ type: 'track-begin', length: code.length });
      for (let offset = 0, seq = 0; offset < code.length; offset += 24000, seq++) {
        await sleep(100);
        await send({ type: 'track-chunk', seq, data: code.slice(offset, offset + 24000) });
        this.#transferProgress = `Sending track · ${Math.min(100, Math.round(((offset + 24000) / code.length) * 100))}%`;
        this.#onChange();
      }
      await send({ type: 'track-end' });
      const deadline = Date.now() + 15000;
      while (!pending.done && !pending.error && Date.now() < deadline) await sleep(100);
      if (pending.error) throw new Error(pending.error);
      if (!pending.done) throw new Error('The organizer did not confirm the track. Try again.');
    } finally {
      this.#pendingUpload = null;
      this.#transferProgress = '';
      this.#onChange();
    }
  }
  receiveTrack(id: number, m: TrackMessage) {
    if (
      !this.#hello.has(id) ||
      !this.#state ||
      !picksOpen(this.#state) ||
      m.cupId !== this.cup.id ||
      !Cup.player(this.#state, id)
    )
      return;
    if (typeof m.transferId !== 'string' || m.transferId.length > 64) return;
    try {
      if (m.type === 'track-begin') {
        if (!Number.isSafeInteger(m.length) || m.length < 1 || m.length > 2000000)
          throw new Error('Invalid track size.');
        this.#trackUploads.set(id, {
          transferId: m.transferId,
          cupId: m.cupId,
          length: m.length,
          data: '',
          seq: 0,
          until: Date.now() + 30000,
        });
        return;
      }
      const u = this.#trackUploads.get(id);
      if (!u || u.transferId !== m.transferId || u.cupId !== m.cupId || u.until < Date.now())
        throw new Error('Track transfer expired. Select the track again.');
      if (m.type === 'track-chunk') {
        if (
          m.seq !== u.seq ||
          typeof m.data !== 'string' ||
          !m.data.length ||
          m.data.length > 24000 ||
          u.data.length + m.data.length > u.length
        )
          throw new Error('Invalid track chunk.');
        u.data += m.data;
        u.seq++;
        return;
      }
      if (m.type === 'track-end') {
        if (u.data.length !== u.length) throw new Error('Incomplete track upload. Try again.');
        this.#trackUploads.delete(id);
        this.acceptTrack(id, u.data);
        this.#transport.send(id, { type: 'track-ack', transferId: m.transferId });
      }
    } catch (e) {
      this.#trackUploads.delete(id);
      this.#transport.send(id, {
        type: 'track-ack',
        transferId: m.transferId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  availableTracks() {
    if (!this.#native?.trackLibrary)
      throw new Error(
        'The game track library is not ready. Open the normal track selector once, then try again.',
      );
    const tracks: LibraryTrack[] = [];
    this.#native.trackLibrary.forEachTrack(
      (id, metadata, category, _environment, load, thumbnail) => {
        tracks.push({
          id,
          name: metadata.name,
          author: metadata.author,
          category,
          thumbnail,
          load,
        });
      },
    );
    return tracks;
  }
  async addLibraryTrack(entry: LibraryTrack) {
    const state = this.#state,
      connection = this.#connection;
    if (state?.phase !== 'registration')
      throw new Error('Tracks can only be selected during registration.');
    const track = await entry.load();
    if (this.#state !== state || this.#connection !== connection || state.phase !== 'registration')
      throw new Error('The tournament changed while the track was loading. Select it again.');
    // Export the actual native track, so autosaves and native multiplayer transfers
    // work even when other players have never installed this custom track.
    await this.importTrack(track.trackData.toExportString(track.trackMetadata));
    this.#error = '';
    this.#onChange();
  }
  change(fn: StateMutation) {
    this.requireHost();
    const before = this.cup.runtime ? structuredClone(this.cup.runtime) : null;
    const undone = fn === Cup.undoRound ? Cup.currentMatch(this.cup)?.roundsLog.at(-1) : null;
    this.ensureReview();
    fn(this.cup);
    if (before && [Cup.completeRound, Cup.voidRound].includes(fn))
      this.#review.close({ runtime: before }, fn === Cup.completeRound ? 'scored' : 'void');
    if (undone) this.#review.undo(undone.round, undone.trackId);
    this.#error = '';
    this.broadcast();
    this.#onChange();
  }
  syncReconnect() {
    const state = this.#state,
      connection = this.#connection;
    this.#reconnect.reset(state?.id ?? '');
    if (!state || !connection) {
      this.#reconnectOffer = null;
      return;
    }
    if (this.#isHost) {
      this.#reconnect.sync(
        this.#lobby.map((p) => p.id),
        state.roster.map((p) => p.id),
      );
      return;
    }
    if (Cup.player(state, this.#selfId)) this.#reconnectOffer = null;
    if (!this.#native.reconnectIdentity || !this.#game || this.#selfId === null) return;
    if (this.#identityCup !== state.id) {
      this.#identityCup = state.id;
      this.#lastIdentity = 0;
      this.#reconnectOffer = null;
      this.#reconnectDeclined = false;
      this.#identity = this.#native.reconnectIdentity(this.#game, state.id);
      // An unavailable crypto/profile API leaves organizer recovery available.
      void this.#identity.catch(() => {});
    }
    if (Date.now() - this.#lastIdentity < 2000 || state.phase === 'complete') return;
    this.#lastIdentity = Date.now();
    void this.#identity
      ?.then((identity) => {
        if (this.#connection === connection && this.#state?.id === state.id)
          this.#transport.send(0, {
            type: 'identity-open',
            cupId: state.id,
            publicKey: identity.publicKey,
          });
      })
      .catch(() => {});
  }
  offerReconnect(id: number) {
    const s = this.#state,
      owner = this.#reconnect.owner(id);
    if (
      !s ||
      s.phase === 'complete' ||
      owner === null ||
      owner === id ||
      !Cup.player(s, owner) ||
      Cup.player(s, id) ||
      this.#lobby.some((p) => p.id === owner)
    )
      return;
    this.#transport.send(id, { type: 'reconnect-offer', cupId: s.id, racerId: owner });
  }
  async receiveReconnect(id: number, message: Message) {
    if (
      !('cupId' in message) ||
      message.cupId !== this.#state?.id ||
      !this.#state ||
      this.#state.phase === 'complete'
    )
      return;
    const state = this.#state,
      connection = this.#connection;
    if (this.#isHost) {
      if (!this.#hello.has(id) || !this.#lobby.some((p) => p.id === id)) return;
      this.#reconnect.reset(state.id);
      if (message.type === 'identity-open' && validPublicKey(message.publicKey)) {
        if (this.#reconnect.verified(id, message.publicKey)) {
          this.offerReconnect(id);
          return;
        }
        const nonce = this.#reconnect.challenge(id, message.publicKey);
        if (nonce) this.#transport.send(id, { type: 'identity-challenge', cupId: state.id, nonce });
      } else if (
        message.type === 'identity-proof' &&
        typeof message.nonce === 'string' &&
        typeof message.signature === 'string'
      ) {
        if (!(await this.#reconnect.prove(id, message.nonce, message.signature))) return;
        if (
          this.#state !== state ||
          this.#connection !== connection ||
          !this.#lobby.some((p) => p.id === id)
        )
          return;
        this.#reconnect.sync(
          this.#lobby.map((p) => p.id),
          state.roster.map((p) => p.id),
        );
        this.offerReconnect(id);
      } else if (message.type === 'reconnect-accept') {
        const owner = this.#reconnect.owner(id);
        if (
          owner === null ||
          owner !== message.racerId ||
          Cup.player(state, id) ||
          this.#lobby.some((p) => p.id === owner)
        )
          return;
        if (state.runtime) {
          this.#transport.send(id, {
            type: 'error',
            message: 'Your racer is recognized. Rejoin after the current round ends.',
          });
          return;
        }
        const player = this.#lobby.find((p) => p.id === id)!;
        this.rebindRacer(owner, id, player.nickname);
      }
    } else if (id === 0) {
      if (
        message.type === 'identity-challenge' &&
        typeof message.nonce === 'string' &&
        /^[a-f0-9]{64}$/.test(message.nonce)
      ) {
        if (this.#identityCup !== state.id || !this.#identity) return;
        const identity = await this.#identity,
          signature = await identity.sign(message.nonce);
        if (this.#state?.id === state.id && this.#connection === connection)
          this.#transport.send(0, {
            type: 'identity-proof',
            cupId: state.id,
            nonce: message.nonce,
            signature,
          });
      } else if (
        message.type === 'reconnect-offer' &&
        Number.isSafeInteger(message.racerId) &&
        Cup.player(state, message.racerId) &&
        !Cup.player(state, this.#selfId)
      ) {
        if (!this.#reconnectDeclined && this.#reconnectOffer !== message.racerId) {
          this.#reconnectOffer = message.racerId;
          this.requestPanel(true);
          this.#onChange();
        }
      }
    }
  }
  acceptReconnect() {
    if (
      !this.#isHost &&
      this.#state &&
      this.#reconnectOffer !== null &&
      this.#state.phase !== 'complete'
    )
      this.#transport.send(0, {
        type: 'reconnect-accept',
        cupId: this.#state.id,
        racerId: this.#reconnectOffer,
      });
  }
  declineReconnect() {
    this.#reconnectDeclined = true;
    this.#reconnectOffer = null;
    this.#onChange();
  }
  recoveryRacers() {
    return (
      this.#state?.roster.filter(
        (p) => this.#needsRebind.has(p.id) || !this.#lobby.some((l) => l.id === p.id),
      ) ?? []
    );
  }
  rebindRacer(oldId: number, newId: number, name: string) {
    this.requireHost();
    if (this.cup.runtime) throw new Error('Void the round before reconnecting a racer.');
    if (!this.#lobby.some((p) => p.id === newId)) throw new Error('Choose a connected player.');
    if (newId !== this.#selfId && (!this.#hello.has(newId) || !this.#transport.has(newId)))
      throw new Error('Wait for the returning player to load PolyCup.');
    if (oldId !== newId && this.#lobby.some((p) => p.id === oldId) && !this.#needsRebind.has(oldId))
      throw new Error('That racer is still connected.');
    if (oldId !== newId) Cup.rebindPlayer(this.cup, oldId, newId, name);
    else Cup.touch(this.cup);
    if (oldId !== newId) this.#review.rebind(oldId, newId);
    this.#reconnect.rebind(oldId, newId);
    this.#needsRebind.delete(oldId);
    this.#error = '';
    this.save(true);
    this.broadcast();
    this.#onChange();
  }
  action(type: ActionType, value?: string) {
    if (this.localPlayerId === null) return;
    if (type === 'dnf') this.flushInputs();
    if (this.#isHost)
      this.handleAction(this.localPlayerId, { type, value, cupId: this.#state?.id });
    else this.#transport.send(0, { type, value, cupId: this.#state?.id });
  }
  handleAction(actor: number, m: ActionMessage) {
    if (!this.#state || (!this.#hello.has(actor) && actor !== this.localPlayerId)) return;
    if (m.cupId !== this.cup.id) return;
    if (m.type === 'join') {
      const p = this.#lobby.find((p) => p.id === actor);
      if (!p) return;
      Cup.addPlayer(this.#state, actor, p.nickname);
    } else if (m.type === 'leave') {
      Cup.removePlayer(this.#state, actor);
      this.pruneTrackData();
    } else if (m.type === 'ban') {
      const track = this.availableTracks().find(
        (t) => t.id === m.value && ['official', 'community'].includes(t.category),
      );
      banTrack(this.#state, actor, track);
    } else if (m.type === 'dnf' && m.value === this.cup.runtime?.id) {
      const before = standings(this.cup).map((r) => r.id);
      Cup.markDNF(this.#state, actor);
      updateLiveMovement(this.cup, before);
    } else if (m.type === 'practice-ready') {
      if (!Cup.practiceReady(this.#state, actor, m.value ?? '')) return;
      this.advanceClock();
    } else return;
    this.broadcast();
  }
  receive(id: number, m: Message) {
    if (
      [
        'identity-open',
        'identity-challenge',
        'identity-proof',
        'reconnect-offer',
        'reconnect-accept',
      ].includes(m.type)
    ) {
      void this.receiveReconnect(id, m).catch(() => {});
      return;
    }
    if (this.#isHost) {
      if (m.type === 'hello' && m.version === Cup.VERSION && Number.isFinite(m.sentAt)) {
        this.#hello.add(id);
        this.#transport.send(id, {
          type: 'hello-ack',
          version: Cup.VERSION,
          sentAt: m.sentAt,
          hostAt: Date.now(),
        });
        this.#transport.send(id, this.syncMessage());
      } else if (m.type === 'ready' && this.#hello.has(id)) this.markReady(id, m);
      else if (m.type === 'finish' && this.#hello.has(id)) this.receiveFinish(id, m);
      else if (m.type === 'checkpoint' && this.#hello.has(id)) this.receiveCheckpoint(id, m);
      else if (m.type === 'inputs') this.receiveInputs(id, m);
      else if (m.type === 'watch' && this.#hello.has(id)) {
        if (
          m.value !== null &&
          Cup.mayWatch(this.#state, id) &&
          this.watchable().includes(m.value)
        ) {
          this.#subscriptions.set(id, m.value);
          const context = this.inputContext(),
            timeline = this.#liveInputs.get(m.value);
          if (context && timeline)
            this.#transport.send(id, {
              type: 'input-view',
              ...context,
              racerId: m.value,
              ...timeline.snapshot(),
            });
        } else this.#subscriptions.delete(id);
      } else if (m.type === 'pb' && this.#hello.has(id)) this.receivePB(id, m);
      else if (['track-begin', 'track-chunk', 'track-end'].includes(m.type))
        this.receiveTrack(id, m as TrackMessage);
      else if (['join', 'leave', 'dnf', 'practice-ready', 'ban'].includes(m.type)) {
        try {
          this.handleAction(id, m as ActionMessage);
        } catch (e) {
          this.#transport.send(id, {
            type: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } else if (id === 0) {
      if (m.type === 'input-view') this.receiveInputView(id, m);
      else if (m.type === 'track-ack' && this.#pendingUpload?.transferId === m.transferId) {
        this.#pendingUpload.done = !m.error;
        this.#pendingUpload.error = m.error ? String(m.error).slice(0, 200) : null;
      } else if (m.type === 'hello-ack' && Number.isFinite(m.sentAt) && Number.isFinite(m.hostAt)) {
        const rtt = Date.now() - m.sentAt;
        if (rtt >= 0 && rtt < this.#bestRtt) {
          this.#bestRtt = rtt;
          this.#offset = m.hostAt + rtt / 2 - Date.now();
        }
      } else if (
        m.type === 'state' &&
        Number.isSafeInteger(m.sequence) &&
        m.sequence > this.#receivedSequence &&
        (m.state === null || validSnapshot(m.state))
      ) {
        this.#receivedSequence = m.sequence;
        if (m.state === null) {
          if (this.#state) this.releaseCup('Organizer ended the Cup · Normal multiplayer');
        } else {
          this.#state = { ...m.state, history: [] };
          this.#error = '';
        }
        this.syncRoundPanel();
      } else if (m.type === 'error') this.#error = String(m.message).slice(0, 200);
    }
    this.#onChange();
  }
  refreshRecords() {
    if (this.localPlayerId === null) return;
    if (Date.now() - this.#lastRecordPoll < 5000 || !this.#native?.personalBest || !this.#state)
      return;
    this.#lastRecordPoll = Date.now();
    const state = this.#state,
      cupId = state.id,
      connection = this.#connection;
    const trackId = state.runtime?.trackId ?? Cup.nextTrack(state);
    if (!trackId) return;
    const stillCurrent = () => this.#state?.id === cupId && this.#connection === connection;
    const launch = (key: string, interval: number, fn: () => Promise<void>) => {
      const old = this.#recordRequests.get(key);
      if (old && (old.pending || old.until > Date.now())) return;
      const request = { pending: true, until: Date.now() + interval };
      this.#recordRequests.set(key, request);
      Promise.resolve()
        .then(fn)
        .catch(() => {})
        .finally(() => {
          request.pending = false;
        });
    };
    if (Cup.player(state, this.localPlayerId)) {
      const actor = this.localPlayerId;
      launch(`${cupId}:pb:${trackId}:${actor}`, 5000, async () => {
        const pb = await this.#native.personalBest(this.activeGame, trackId);
        if (!stillCurrent() || this.#selfId !== actor || !validPB(pb)) return;
        const message: Extract<Message, { type: 'pb' }> = { type: 'pb', cupId, trackId, pb };
        if (this.#isHost) this.receivePB(actor, message);
        else this.#transport.send(0, message);
      });
    }
    if (this.#isHost)
      launch(`${cupId}:wr:${trackId}`, 120000, async () => {
        const wr = await this.#native.worldRecord(this.activeGame, trackId);
        if (!stillCurrent() || !this.cup.tracks.some((t) => t.id === trackId)) return;
        const records = (this.cup.records[trackId] ??= { pbs: {} });
        if (JSON.stringify(records.wr) !== JSON.stringify(wr)) {
          records.wr = wr;
          Cup.touch(this.cup);
          this.broadcast();
        }
      });
  }
  receivePB(actor: number, m: Extract<Message, { type: 'pb' }>) {
    const s = this.#state;
    if (
      !s ||
      m.cupId !== s.id ||
      !Cup.player(s, actor) ||
      !s.tracks.some((t) => t.id === m.trackId) ||
      !validPB(m.pb)
    )
      return;
    const pb: RaceRecord =
      m.pb.status === 'ready'
        ? { status: 'ready', frames: m.pb.frames, source: m.pb.source }
        : { status: m.pb.status };
    const r = (s.records[m.trackId] ??= { pbs: {} });
    if (JSON.stringify(r.pbs[actor]) !== JSON.stringify(pb)) {
      r.pbs[actor] = pb;
      Cup.touch(s);
      this.broadcast();
    }
  }
  async worldRecordForStart(
    trackId: string,
    game: NativeGame | null = this.#game,
    timeoutMs = 5000,
  ): Promise<RaceRecord> {
    let timer;
    try {
      const wr = await Promise.race([
        Promise.resolve().then(() => this.#native.worldRecord(game!, trackId)),
        new Promise<RaceRecord>((resolve) => {
          timer = setTimeout(() => resolve({ status: 'unavailable' }), timeoutMs);
        }),
      ]);
      return validWR(wr) ? wr : { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
  async startCup() {
    this.requireHost();
    if (this.#startingCup) return;
    if (this.#state?.phase !== 'registration') throw new Error('The Cup has already started.');
    const state = this.#state,
      connection = this.#connection,
      game = this.#game;
    const setup = () => JSON.stringify([state.roster, state.picks, state.draft]);
    const before = setup();
    // Validate before any requests, then again after they settle in case a racer left.
    Cup.lockRegistration(structuredClone(state));
    this.requireStartRacers();
    const request = {};
    this.#startingCup = request;
    this.#error = '';
    this.#onChange();
    try {
      const records = await Promise.all(
        state.tracks.map(async (t) => [t.id, await this.worldRecordForStart(t.id, game)] as const),
      );
      if (
        this.#startingCup !== request ||
        this.#state !== state ||
        this.#connection !== connection ||
        state.phase !== 'registration'
      )
        return;
      if (setup() !== before)
        throw new Error('Racers or track picks changed. Start the Cup again.');
      this.requireStartRacers();
      for (const [id, wr] of records) (state.records[id] ??= { pbs: {} }).wr = wr;
      Cup.lockRegistration(state);
      this.#trackUploads.clear();
      this.broadcast();
      this.runRound();
    } finally {
      if (this.#startingCup === request) {
        this.#startingCup = null;
        this.#onChange();
      }
    }
  }
  requireStartRacers() {
    if (
      this.cup.roster.some(
        (p) =>
          this.#needsRebind?.has(p.id) ||
          !this.#lobby.some((l) => l.id === p.id) ||
          (p.id !== this.#selfId && (!this.#hello.has(p.id) || !this.#transport.has(p.id))),
      )
    )
      throw new Error('Every racer must be connected with the current mod before starting.');
  }
  networkState() {
    const state = Cup.publicState(this.cup);
    // The complete journal stays on the host/export; live peers need only the latest round.
    state.audit = state.audit.slice(-8);
    state.matches.forEach((m) => {
      m.roundsLog = m.roundsLog.slice(-1);
    });
    return state;
  }
  broadcast() {
    this.#transport.broadcast(this.syncMessage());
    this.#sentRevision = this.#state?.revision;
    this.#lastBroadcast = Date.now();
  }
  syncMessage(): Extract<Message, { type: 'state' }> {
    this.syncRoundPanel();
    return {
      type: 'state',
      sequence: ++this.#syncSequence,
      state: this.#state ? this.networkState() : null,
    };
  }
  runRound() {
    this.requireHost();
    if (!['dnf', 'void'].includes(this.cup.disconnectPolicy))
      throw new Error('Choose a disconnect rule in Tournament before starting.');
    if (this.cup.roster.some((p) => this.#needsRebind?.has(p.id)))
      throw new Error('Confirm every saved racer’s lobby identity in Racers before resuming.');
    for (const id of Cup.activeIds(this.#state)) {
      if (!this.#lobby.some((p) => p.id === id))
        throw new Error(
          `${Cup.player(this.#state, id)!.name} is disconnected. Reconnect or replace their lobby identity.`,
        );
      if (id !== this.#selfId && (!this.#hello.has(id) || !this.#transport.has(id)))
        throw new Error(`${Cup.player(this.#state, id)!.name} must load PolyCup ${Cup.VERSION}.`);
    }
    const track = this.#tracks.get(Cup.nextTrack(this.cup)!);
    if (!track) throw new Error('The selected track is missing from this organizer’s saved pack.');
    Cup.beginRound(this.cup);
    this.#readyKey = '';
    this.#nextAuto = null;
    this.#loadingSession = this.gameInfo.sessionId;
    this.broadcast();
    this.#connection!.startNewSession(1, track.trackMetadata, track.trackData);
  }
  checkDisconnects() {
    const s = this.#state;
    if (!s?.runtime) return;
    const missing = Cup.activeIds(s).filter(
      (id) =>
        !this.#lobby.some((p) => p.id === id) &&
        !(id in s.runtime!.finishes) &&
        !s.runtime!.dnfs.includes(id),
    );
    if (!missing.length) return;
    this.#nextAuto = null;
    if (s.disconnectPolicy === 'dnf' && s.phase === 'racing') {
      const before = standings(s).map((r) => r.id);
      for (const id of missing) Cup.markDNF(s, id);
      updateLiveMovement(s, before);
      Cup.note(s, 'Disconnected racers received DNF. Waiting for reconnect.');
    } else {
      this.#review.close(s, 'void');
      Cup.voidRound(s);
      this.#loadingSession = undefined;
      this.#nextAuto = null;
      this.#error =
        'Round voided after a racer disconnected. Reconnect their identity before restarting.';
    }
  }
  sendReady() {
    if (this.localPlayerId === null) return;
    const s = this.cup,
      run = s.runtime;
    if (s.phase !== 'loading' || !run || this.gameInfo.trackData.getId() !== run.trackId) return;
    if (this.#isHost && run.sessionId === null) {
      // startNewSession takes five seconds. Wait for the new native game instance/session.
      if (this.#loadingSession === undefined) {
        this.#loadingSession = this.gameInfo.sessionId;
        return;
      }
      if (this.gameInfo.sessionId === this.#loadingSession) return;
      run.sessionId = this.gameInfo.sessionId;
      Cup.touch(s);
      this.broadcast();
    }
    if (this.gameInfo.sessionId !== run.sessionId || !Cup.activeIds(s).includes(this.localPlayerId))
      return;
    const key = `${run.id}:${run.sessionId}`;
    if (this.#readyKey === key) return;
    const m: ReadyMessage = {
      type: 'ready',
      roundId: run.id,
      sessionId: run.sessionId!,
      trackId: run.trackId,
    };
    if (this.#isHost) this.markReady(this.localPlayerId, m);
    else if (!this.#transport.send(0, m)) return;
    this.#readyKey = key;
  }
  markReady(id: number, m: ReadyMessage) {
    const run = this.#state?.runtime;
    if (
      this.#state?.phase !== 'loading' ||
      !run ||
      m.roundId !== run.id ||
      m.sessionId !== run.sessionId ||
      m.trackId !== run.trackId ||
      !Cup.activeIds(this.#state).includes(id) ||
      run.ready.includes(id)
    )
      return;
    run.ready.push(id);
    Cup.touch(this.#state);
  }
  advanceClock() {
    const s = this.#state,
      run = s?.runtime;
    if (!run) return;
    if (
      s.phase === 'loading' &&
      run.sessionId !== null &&
      Cup.activeIds(s).every((id) => run.ready.includes(id))
    ) {
      s.phase = run.warmup ? 'warmup' : 'countdown';
      run.startsAt =
        this.now() +
        (run.warmup
          ? (Cup.currentMatch(s).trackWarmups?.[run.trackId] ?? Cup.RULES.warmupMs)
          : 3000);
      Cup.touch(s);
      this.broadcast();
    } else if (
      s.phase === 'warmup' &&
      ((run.startsAt !== null && this.now() >= run.startsAt) ||
        Cup.activeIds(s).every((id) => run.practiceReady?.includes(id)))
    ) {
      s.phase = 'countdown';
      run.startsAt = this.now() + 3000;
      Cup.touch(s);
      this.broadcast();
    } else if (s.phase === 'countdown' && run.startsAt !== null && this.now() >= run.startsAt) {
      Cup.startRace(s, run.startsAt!);
      this.broadcast();
    }
  }
  finishRound() {
    this.change(Cup.completeRound);
    this.#loadingSession = undefined;
    this.#nextAuto =
      this.#auto && this.cup.phase === 'between-rounds' && !this.recoveryRacers().length
        ? Date.now() + 5000
        : null;
  }
  voidRound() {
    this.change(Cup.voidRound);
    this.#loadingSession = undefined;
    this.#nextAuto = null;
  }
  exportData() {
    return {
      format: 'polytrack-world-cup',
      schema: 1,
      state: this.#state,
      ...(this.#isHost && this.#review.cupId === this.#state?.id
        ? { review: this.#review.data() }
        : {}),
      tracks: [...this.#tracks].map(([id, t]) => ({ id, code: t.code })),
    };
  }
  restore(text: string) {
    this.requireHost();
    if (text.length > 18000000) throw new Error('The save is too large.');
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid Cup save.');
    const data = value as { format: unknown; state: unknown; tracks: unknown; review?: unknown };
    if (
      data.format !== 'polytrack-world-cup' ||
      !validSnapshot(data.state) ||
      !Array.isArray(data.tracks) ||
      data.tracks.length > 8 ||
      !Array.isArray(data.state.history)
    )
      throw new Error(
        'This is not a Simple Cup save. Older PolyCup exports remain readable as JSON but cannot be resumed in this format.',
      );
    const tracks = new Map<string, LoadedTrack>();
    for (const value of data.tracks as unknown[]) {
      if (!value || typeof value !== 'object') throw new Error('Invalid saved track.');
      const entry = value as { id: string; code: string };
      if (typeof entry.code !== 'string' || entry.code.length > 2000000)
        throw new Error('Invalid saved track.');
      const track = this.#native.parse(entry.code);
      if (!track || track.trackData.getId() !== entry.id || !track.trackData.hasStartingPoint())
        throw new Error('Saved track checksum failed.');
      tracks.set(entry.id, { ...track, code: entry.code });
    }
    for (const track of data.state.tracks)
      if (!tracks.has(track.id)) throw new Error('A saved track is missing.');
    // Native peer IDs are session-local. Require the organizer to reconnect EVERY saved racer.
    const s: CupState = { ...data.state, history: data.state.history };
    const review = ReviewLog.restore(data.review, s);
    if (s.runtime) {
      s.runtime = null;
      s.phase = 'between-rounds';
    }
    s.roster.forEach((p, i) => review.rebind(p.id, -i - 1));
    this.#review = review;
    Cup.detachIdentities(s);
    this.#state = s;
    this.#startingCup = null;
    this.#tracks = tracks;
    this.#auto = true;
    this.#nextAuto = null;
    this.#needsRebind = new Set(s.roster.map((p) => p.id));
    this.#loadingSession = undefined;
    this.#lastSaved = -1;
    Cup.note(s, 'Restored save. Organizer must reconnect saved racer identities.');
    Cup.touch(s);
    this.broadcast();
    this.#onChange();
  }
  save(force = false) {
    if (
      !force &&
      this.#lastSaved === this.cup.revision &&
      (this.#savedReview === this.#review.revision || Date.now() - (this.#savedAt ?? 0) < 5000)
    )
      return;
    try {
      localStorage.setItem('pwc-save-v2', JSON.stringify(this.exportData()));
      this.#lastSaved = this.cup.revision;
      this.#savedReview = this.#review.revision;
      this.#savedAt = Date.now();
    } catch {
      this.#error = 'Autosave is full or unavailable. Export the tournament to keep results.';
    }
  }
}
export { validPB, validSnapshot } from './validation.ts';
