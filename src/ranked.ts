import type { SupabaseClient } from '@supabase/supabase-js';
import { standardPreset, type CupPreset, type CupRules } from './presets.ts';

export type RankTier =
  | 'provisional'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'grandmaster';
export type RankedStatus =
  | 'reserved'
  | 'drafting'
  | 'racing'
  | 'review'
  | 'disputed'
  | 'completed'
  | 'cancelled'
  | 'unrated';
export interface LeaderboardEntry {
  avatar_url?: string;
  player_id: string;
  display_name: string;
  rating: number;
  rated_matches: number;
  leaderboard_position: number;
  tier: Exclude<RankTier, 'provisional'>;
  gm_position: number | null;
}
export interface RankedProfile extends Omit<LeaderboardEntry, 'tier' | 'leaderboard_position'> {
  tier: RankTier;
  provisional: boolean;
  leaderboard_position: number | null;
}
export interface RankedStats {
  matches: number;
  wins: number;
  win_rate: number | null;
}
export interface InputReview {
  match_id: string;
  player_id: string;
  round: number;
  track: string;
  status:
    | 'flagged'
    | 'no_match'
    | 'partial'
    | 'pending'
    | 'unavailable'
    | 'no_reference'
    | 'unsupported'
    | 'invalid';
  policy: string | null;
  corpus: string | null;
  findings: {
    reference: string;
    referenceRank: number;
    kind: 'whole' | 'segment';
    start: number;
    end: number;
    referenceStart: number;
    referenceEnd: number;
    transitions: number;
    coverage: number;
  }[];
}
export interface RankedHistoryEntry {
  match_id: string;
  finished_at: string;
  place: number;
  rating_before: number | null;
  rating_after: number;
  model_version: string;
  player_count: number;
  rounds: number;
}
export interface RankedMatchResult {
  season?: { id: string; name: string } | null;
  match_id: string;
  finished_at: string;
  rounds: number;
  players: {
    avatar_url?: string;
    abandoned?: boolean;
    player_id: string;
    display_name: string;
    place: number;
    rating_before: number | null;
    rating_after: number | null;
  }[];
}
export interface RankedQueueInfo {
  enabled: boolean;
  version: string;
  waiting: number;
  three_after: number;
  two_after: number;
}
export interface RankedQueueSnapshot extends RankedQueueInfo {
  state: 'idle' | 'queued' | 'matched';
  joined_at?: string | null;
  server_time?: string;
  match?: {
    id: string;
    status: RankedStatus;
    deadline: string;
    self: string;
    rules: CupRules;
    can_leave: boolean;
    reconnect_until?: string | null;
    abandoned?: boolean;
    left?: boolean;
    host_disconnected?: boolean;
    is_host?: boolean;
    can_reconnect?: boolean;
    result_submitted?: boolean;
    players: { id: string; name: string; accepted: boolean; online: boolean }[];
  };
}
export type QueueAction = 'join' | 'poll' | 'cancel' | 'accept' | 'decline' | 'leave-match';
export interface RankedDraft {
  bans: { player_id: string; track_id: string }[];
  picks: { player_id: string; track_id: string }[];
}
export interface RankedMatch {
  id: string;
  status: RankedStatus;
  rules: CupRules & {
    version: number;
    minPlayers: number;
    maxPlayers: number;
    targetPlayers: number;
  };
  roster: string[];
  host_id: string;
  track_pool: { id: string; category: 'official' | 'community'; digest: string }[];
  draft: RankedDraft | null;
  deadline: string;
  reason: string | null;
  accepted: string[];
}
export interface RankedEvidence {
  /** Digest of the canonical match transcript, checked later by a trusted validator. */
  digest: string;
  rounds: number;
  standings: { player_id: string; place: number; points: number }[];
}

/** Ranked UI uses an allowlist. There is no special host override. */
export function rankedLobbyControls(status: RankedStatus) {
  return {
    friends: true,
    chat: true,
    viewRules: true,
    draft: status === 'drafting',
    accept: status === 'reserved',
    decline: status === 'reserved',
    invite: false,
    roomCode: false,
    visibility: false,
    editPreset: false,
    manageRacers: false,
    returnToLobby: false,
    changeTrack: false,
    editScores: false,
    hostStart: false,
    hostEnd: false,
  } as const;
}

/** Preview only. The server's versioned match snapshot is authoritative. */
export function rankedPreset(): CupPreset {
  const preset = standardPreset();
  preset.name = 'Ranked';
  Object.assign(preset.rules, {
    singleTrack: true,
    selection: 'random',
    roundsPerTrack: 1,
    pointsToWin: 30,
    points: [10, 7, 4, 2, 0, 0, 0, 0],
    bansPerRacer: 0,
    picksPerRacer: 0,
    warmup: 'first-visit',
    warmupTiming: 'fixed',
    warmupSeconds: 30,
    readyEndsWarmup: false,
    roundBreakSeconds: 3,
  });
  return preset;
}

/** Text layout contract for the supplied PNGs; no rank thresholds in the client. */
export function rankBadgeText(
  profile: Pick<RankedProfile, 'tier' | 'rating' | 'gm_position' | 'provisional'>,
): {
  primary: string;
  secondary: string | null;
} {
  if (profile.tier === 'grandmaster' && profile.gm_position !== null) {
    return { primary: `RANK ${profile.gm_position}`, secondary: String(profile.rating) };
  }
  return { primary: String(profile.rating), secondary: null };
}

/** No polling or network traffic until a caller explicitly uses a method.
 * Deliberately excludes reservation, advancement and rating-write APIs.
 */
export class Ranked {
  constructor(private client: SupabaseClient) {}
  #inputPolicy?: Promise<boolean>;
  #picturesUnavailable = false;
  #pictureCache = new Map<string, { url: string; at: number }>();
  async pictures(players: string[]): Promise<Record<string, string>> {
    if (this.#picturesUnavailable || !players.length) return {};
    const result: Record<string, string> = {},
      missing: string[] = [];
    for (const id of [...new Set(players)].slice(0, 100)) {
      const old = this.#pictureCache.get(id);
      if (old && Date.now() - old.at < 60000) result[id] = old.url;
      else missing.push(id);
    }
    if (!missing.length) return result;
    try {
      const { data, error } = await this.client
        .rpc('polycup_profile_pictures', { player_keys: missing })
        .abortSignal(AbortSignal.timeout(2000));
      if (error) throw error;
      for (const id of missing) {
        const url = typeof data?.[id] === 'string' ? data[id] : '';
        result[id] = url;
        this.#pictureCache.set(id, { url, at: Date.now() });
      }
      if (this.#pictureCache.size > 300)
        for (const id of [...this.#pictureCache.keys()].slice(0, this.#pictureCache.size - 300))
          this.#pictureCache.delete(id);
      return result;
    } catch (e) {
      if (['PGRST202', '42883'].includes((e as { code?: string }).code ?? ''))
        this.#picturesUnavailable = true;
      return result; // A failed optional image request must not hide the leaderboard.
    }
  }
  inputReviewEnabled(): Promise<boolean> {
    return (this.#inputPolicy ??= this.rpc<boolean>('polycup_input_review_policy').catch((e) => {
      if (['PGRST202', '42883'].includes(e.code)) return false;
      this.#inputPolicy = undefined;
      throw e;
    }));
  }
  async inputReview(
    matches: string[],
    player: string | null = null,
  ): Promise<InputReview[] | null> {
    if (!(await this.inputReviewEnabled())) return null;
    return this.rpc('polycup_input_review', { match_keys: matches, player_key: player });
  }
  submitInputRun(
    match: string,
    instance: string,
    run: import('./ranked-inputs.ts').InputRun,
  ): Promise<boolean> {
    return this.rpc('polycup_submit_input_run', { match_key: match, instance_key: instance, run });
  }
  #staticSnapshot?: {
    key: string;
    pool: import('./ranked-room.ts').RankedSession['pool'];
    rules: import('./ranked-room.ts').RankedSession['rules'];
  };
  #legacySession = false;

  private async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client
      .rpc(name, args)
      .abortSignal(AbortSignal.timeout(12000));
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as T;
  }

  async leaderboard(pageSize = 50, pageOffset = 0): Promise<LeaderboardEntry[]> {
    const rows = await this.rpc<LeaderboardEntry[]>('polycup_leaderboard', {
      page_size: pageSize,
      page_offset: pageOffset,
    });
    const pictures = await this.pictures(rows.map((r) => r.player_id));
    return rows.map((r) => ({ ...r, avatar_url: pictures[r.player_id] }));
  }
  seasons(): Promise<{ id: string; name: string; active: boolean }[]> {
    return this.rpc('polycup_seasons');
  }
  onlineCount(): Promise<number> {
    return this.rpc('polycup_online_count');
  }
  async seasonLeaderboard(
    season: string,
    friends: boolean,
    pageSize = 50,
    pageOffset = 0,
  ): Promise<LeaderboardEntry[]> {
    const rows = await this.rpc<LeaderboardEntry[]>('polycup_season_leaderboard', {
      season_key: season,
      friends_only: friends,
      page_size: pageSize,
      page_offset: pageOffset,
    });
    const pictures = await this.pictures(rows.map((r) => r.player_id));
    return rows.map((r) => ({ ...r, avatar_url: pictures[r.player_id] }));
  }

  async profile(playerId: string): Promise<RankedProfile | null> {
    const rows = await this.rpc<RankedProfile[]>('polycup_ranked_profile', {
      player_key: playerId,
    });
    return rows[0] ?? null;
  }

  stats(playerId: string): Promise<RankedStats> {
    return this.rpc('polycup_ranked_stats', { player_key: playerId });
  }

  async friendsLeaderboard(
    pageSize = 50,
    pageOffset = 0,
  ): Promise<(LeaderboardEntry & { friend_position: number })[]> {
    const rows = await this.rpc<(LeaderboardEntry & { friend_position: number })[]>(
      'polycup_friends_leaderboard',
      {
        page_size: pageSize,
        page_offset: pageOffset,
      },
    );
    const pictures = await this.pictures(rows.map((r) => r.player_id));
    return rows.map((r) => ({ ...r, avatar_url: pictures[r.player_id] }));
  }
  history(playerId: string, pageSize = 20, pageOffset = 0): Promise<RankedHistoryEntry[]> {
    return this.rpc('polycup_ranked_history', {
      player_key: playerId,
      page_size: pageSize,
      page_offset: pageOffset,
    });
  }

  async session(
    match: string,
    instance: string,
    action: string,
    value: unknown = null,
  ): Promise<import('./ranked-room.ts').RankedSession | null> {
    const args = {
      match_key: match,
      instance_key: instance,
      action,
      value,
    };
    if (this.#legacySession) return this.rpc('polycup_ranked_session', args);
    // Capture the cache used by this request: a concurrent response may replace
    // the latest catalog while this one is in flight.
    const cached = this.#staticSnapshot;
    type Session = import('./ranked-room.ts').RankedSession;
    let raw:
      | (Omit<Session, 'pool' | 'rules'> &
          Partial<Pick<Session, 'pool' | 'rules'>> & { static_key: string })
      | null;
    try {
      raw = await this.rpc('polycup_ranked_session_v2', {
        ...args,
        known_static_key: cached?.key ?? null,
      });
    } catch (error) {
      // Missing-function errors guarantee that no action ran. Never replay an
      // action after a timeout or an ambiguous transport failure.
      if (!['PGRST202', '42883'].includes((error as { code?: string }).code ?? '')) throw error;
      this.#legacySession = true;
      return this.rpc('polycup_ranked_session', args);
    }
    if (raw === null) return null;
    if (raw.pool && raw.rules) {
      this.#staticSnapshot = structuredClone({
        key: raw.static_key,
        pool: raw.pool,
        rules: raw.rules,
      });
      return raw as Session;
    }
    if (!cached || cached.key !== raw.static_key)
      throw new Error('Ranked track catalog is unavailable. Reopen the Cup to refresh it.');
    return { ...raw, ...structuredClone({ pool: cached.pool, rules: cached.rules }) } as Session;
  }
  sessionBind(match: string, instance: string, value: object): Promise<number> {
    return this.rpc('polycup_ranked_session', {
      match_key: match,
      instance_key: instance,
      action: 'bind',
      value,
    });
  }
  current(): Promise<string | null> {
    return this.rpc('polycup_ranked_current');
  }
  abandon(match: string, instance: string): Promise<void> {
    return this.rpc('polycup_ranked_abandon', { match_key: match, instance_key: instance });
  }
  submitResult(
    match: string,
    instance: string,
    transcript: import('./ranked-transcript.ts').RankedTranscript,
  ): Promise<string> {
    return this.rpc('polycup_ranked_submit', {
      match_key: match,
      instance_key: instance,
      transcript,
    });
  }
  resultStatus(match: string): Promise<{ status: RankedStatus; reason: string | null }> {
    return this.rpc('polycup_ranked_result_status', { match_key: match });
  }
  claimResult(owner: string, match: string | null = null): Promise<string | null> {
    return this.rpc('polycup_ranked_claim_result', { delivery_key: owner, match_key: match });
  }
  seenResult(match: string): Promise<void> {
    return this.rpc('polycup_ranked_seen_result', { match_key: match });
  }
  rejectResult(match: string, instance: string): Promise<void> {
    return this.rpc('polycup_ranked_reject_result', { match_key: match, instance_key: instance });
  }
  queueInfo(): Promise<RankedQueueInfo> {
    return this.rpc('polycup_queue_info');
  }
  queue(action: QueueAction, instance: string, version: string): Promise<RankedQueueSnapshot> {
    return this.rpc('polycup_queue', { action, instance_key: instance, client_version: version });
  }

  async match(matchId: string): Promise<RankedMatchResult | null> {
    const result = await this.rpc<RankedMatchResult | null>('polycup_ranked_match', {
      match_key: matchId,
    });
    if (!result) return null;
    const pictures = await this.pictures(result.players.map((p) => p.player_id));
    return {
      ...result,
      players: result.players.map((p) => ({ ...p, avatar_url: pictures[p.player_id] })),
    };
  }

  member(
    matchId: string,
    instanceId: string,
    action: 'poll' | 'accept' | 'withdraw' = 'poll',
  ): Promise<RankedMatch> {
    return this.rpc('polycup_ranked_member', {
      match_key: matchId,
      instance_key: instanceId,
      action,
    });
  }

  report(matchId: string, instanceId: string, evidence: RankedEvidence): Promise<RankedStatus> {
    return this.rpc('polycup_ranked_report', {
      match_key: matchId,
      instance_key: instanceId,
      evidence,
    });
  }
}
