import * as Cup from './cup.ts';
import { beginBans, banTrack, resetDraft, rosterOpen } from './draft.ts';
import { rulesFor, validPreset } from './presets.ts';
import { cleanChatText, filterChat } from './chat-filter.ts';
import type { CupState, Track } from './types.ts';
import type { ChatLine } from './chat.ts';

export interface RoomMember {
  id: number;
  name: string;
  country: string | null;
  online: boolean;
  style?: string | null;
}
export interface RoomEvent {
  seq: number;
  actor: number;
  kind: string;
  value: unknown;
  request: string;
}
export interface RoomData {
  cup: CupState;
  chat: ChatLine[];
  muted: number[];
  codes: Record<string, string>;
  public: boolean;
  launch: null | { id: string; stage: 'grace' | 'connecting' | 'racing'; at: number; code: string };
}
export interface RoomSnapshot {
  id: string;
  code: string;
  host: number;
  self: number;
  revision: number;
  ticket: string;
  data: RoomData;
  members: RoomMember[];
  events: RoomEvent[];
  results: { request: string; error: string | null }[];
}
export interface RoomTracks {
  list(): (Track & { category: string })[];
  parse(code: string): Track & { category: string };
}
function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function roomData(name: string): RoomData {
  const cup = Cup.newCup(name);
  resetDraft(cup);
  return { cup, chat: [], muted: [], codes: {}, public: false, launch: null };
}
export function roomLine(data: RoomData, text: string, member?: RoomMember, now = Date.now()) {
  const line: ChatLine = {
    seq: (data.chat.at(-1)?.seq ?? 0) + 1,
    at: now,
    speaker: member?.id ?? 0,
    color: (member?.id ?? 0) % 8,
    name: member ? filterChat(member.name) : '',
    text: filterChat(cleanChatText(text)).slice(0, 400),
    ...(member ? {} : { system: true as const }),
  };
  requireThat(line.text, 'Enter a message.');
  data.chat.push(line);
  if (data.chat.length > 200) data.chat.shift();
}
export function cancelRoomStart(data: RoomData, reason: string) {
  if (!data.launch) return;
  data.launch = null;
  delete data.cup.draftStartsAt;
  roomLine(data, reason);
  Cup.touch(data.cup);
}
/** Same host authority as native Cups. Actor IDs come from the database, never the payload. */
export function reduceRoomEvent(
  source: RoomData,
  event: RoomEvent,
  members: RoomMember[],
  host: number,
  tracks: RoomTracks,
  now = Date.now(),
): RoomData {
  const data = structuredClone(source),
    s = data.cup;
  const member = members.find((p) => p.id === event.actor && p.online);
  requireThat(member, 'Rejoin the waiting room.');
  const hostOnly = () => requireThat(event.actor === host, 'Only the host can do that.');
  if (event.kind === 'chat') {
    requireThat(!data.muted.includes(member.id), 'The host muted you for this Cup.');
    requireThat(
      typeof event.value === 'string' && event.value.length <= 400,
      'Use 1–400 characters.',
    );
    roomLine(data, event.value, member, now);
    return data;
  }
  if (event.kind === 'cancel') {
    hostOnly();
    cancelRoomStart(data, 'Match start cancelled.');
    return data;
  }
  requireThat(
    !data.launch || data.launch.stage === 'grace',
    'The Cup is connecting. Wait or cancel the start.',
  );
  const value = typeof event.value === 'string' ? event.value : '';
  switch (event.kind) {
    case 'join':
      Cup.addPlayer(s, member.id, member.name);
      break;
    case 'leave':
      Cup.removePlayer(s, member.id);
      break;
    case 'draft-ready':
      requireThat(value === 'ready' || value === 'editing', 'Invalid ready status.');
      Cup.setDraftReady(s, member.id, value === 'ready');
      if (value === 'editing')
        cancelRoomStart(data, 'Match start cancelled. Waiting for everyone to ready up.');
      break;
    case 'remove-pick':
      Cup.removePick(s, member.id, value);
      break;
    case 'ban':
      banTrack(
        s,
        member.id,
        tracks.list().find((t) => t.id === value),
      );
      break;
    case 'pick': {
      requireThat(!Cup.picksComplete(s, member.id), 'Remove a pick before choosing another track.');
      const track = tracks.list().find((t) => t.id === value);
      requireThat(
        track && rulesFor(s).pool.includes(track.category as 'official'),
        'Track unavailable in this pool.',
      );
      Cup.chooseTrack(s, member.id, track);
      break;
    }
    case 'custom': {
      requireThat(!Cup.picksComplete(s, member.id), 'Remove a pick before choosing another track.');
      requireThat(value.length <= 2000000, 'Track code exceeds 2 MB.');
      const track = tracks.parse(value);
      requireThat(
        rulesFor(s).pool.includes(track.category as 'custom'),
        'Track unavailable in this pool.',
      );
      requireThat(
        track.category !== 'custom' || rulesFor(s).bansPerRacer === 0,
        'Custom tracks require zero bans.',
      );
      Cup.chooseTrack(s, member.id, track);
      data.codes[track.id] = value;
      break;
    }
    case 'preset':
      hostOnly();
      requireThat(validPreset(event.value), 'Invalid Cup preset.');
      Cup.applyPreset(s, event.value);
      break;
    case 'reopen':
      hostOnly();
      resetDraft(s);
      break;
    case 'begin': {
      hostOnly();
      const r = rulesFor(s),
        pool = tracks.list().filter((t) => r.pool.includes(t.category as 'official'));
      requireThat(
        new Set(pool.map((t) => t.id)).size >=
          s.roster.length * r.bansPerRacer + (r.pool.includes('custom') ? 0 : r.picksPerRacer),
        'Expand the track pool or reduce bans and picks.',
      );
      requireThat(
        s.roster.every((p) => members.some((m) => m.id === p.id && m.online)),
        'Every racer must be online.',
      );
      beginBans(s);
      break;
    }
    case 'public':
      hostOnly();
      requireThat(typeof event.value === 'boolean', 'Invalid visibility.');
      data.public = event.value;
      break;
    case 'mute': {
      hostOnly();
      const id = Number(event.value);
      requireThat(id !== host && members.some((m) => m.id === id), 'Choose another player.');
      data.muted = data.muted.includes(id)
        ? data.muted.filter((n) => n !== id)
        : [...data.muted, id];
      break;
    }
    case 'remove-racer': {
      hostOnly();
      requireThat(rosterOpen(s), 'Return to setup before changing racers.');
      Cup.removePlayer(s, Number(event.value));
      break;
    }
    case 'start': {
      hostOnly();
      requireThat(!data.launch, 'The Cup is already starting.');
      requireThat(
        s.roster.length >= 2 &&
          s.roster.every((p) => members.some((m) => m.id === p.id && m.online)),
        'At least two connected racers are required.',
      );
      Cup.requireDraftReady(s);
      if (rulesFor(s).selection !== 'random') Cup.lockRegistration(structuredClone(s));
      data.launch = { id: event.request, stage: 'grace', at: now + 5000, code: '' };
      s.draftStartsAt = now + 5000;
      roomLine(data, 'Match starting in 5…', undefined, now);
      break;
    }
    default:
      throw new Error('Unknown waiting-room action.');
  }
  for (const key of Object.keys(data.codes))
    if (!s.tracks.some((t) => t.id === key)) delete data.codes[key];
  Cup.touch(s);
  return data;
}

/** Return to an intact draft when a required racer disappears. */
export function reconcileRoom(data: RoomData, members: RoomMember[]) {
  // A missing member explicitly left (or was removed). Offline members still
  // exist and retain their seat for reconnect. Release departed setup slots.
  if (rosterOpen(data.cup))
    for (const player of [...data.cup.roster])
      if (!members.some((member) => member.id === player.id)) Cup.removePlayer(data.cup, player.id);
  if (
    data.launch &&
    data.launch.stage !== 'racing' &&
    data.cup.roster.some((p) => !members.some((m) => m.id === p.id && m.online))
  )
    cancelRoomStart(data, 'Match start cancelled. A racer disconnected.');
}

/** Rebind all draft references together; native IDs need not match room IDs. */
export function raceState(data: RoomData, mapping: Map<number, number>): CupState {
  const state = structuredClone(data.cup);
  requireThat(
    state.roster.every((p) => mapping.has(p.id)),
    'Waiting for every racer to connect.',
  );
  requireThat(new Set(mapping.values()).size === mapping.size, 'Duplicate player connection.');
  const id = (n: number) => {
    const next = mapping.get(n);
    requireThat(next !== undefined, 'Missing racer connection.');
    return next;
  };
  const keys = <T>(record: Record<number, T>) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [id(Number(key)), value]));
  state.roster = state.roster.map((p) => ({ ...p, id: id(p.id) }));
  state.picks = keys(state.picks);
  state.selections = keys(state.selections ?? {});
  state.draftReady = (state.draftReady ?? []).map(id);
  if (state.draft) {
    state.draft.order = state.draft.order.map(id);
    state.draft.bans = keys(state.draft.bans);
    state.draft.banHistory = state.draft.banHistory?.map((b) => ({ ...b, racerId: id(b.racerId) }));
  }
  delete state.draftStartsAt;
  Cup.touch(state);
  return state;
}
