import type { SupabaseClient } from '@supabase/supabase-js';
export type FriendPerson = {
  player_id: string;
  display_name: string;
  discord_name: string;
  discord_username: string;
  avatar_url: string;
  rating: number | null;
};
export type FriendRelationship = FriendPerson & {
  friendship_id: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'accepted';
  online: boolean;
  activity?: 'lobby' | 'racing' | null;
  can_join?: boolean;
};
export type CupInvite = { id: string; room_title: string; sender_name: string; code: string };
const timeout = () => AbortSignal.timeout(12000);
export class Friends {
  #client: SupabaseClient;
  #changed: () => void;
  #user: string | null = null;
  #session = '';
  #generation = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #flight: Promise<void> | null = null;
  #rows: FriendRelationship[] = [];
  #invites: CupInvite[] = [];
  get invites() {
    return this.#invites;
  }
  #results: FriendPerson[] = [];
  #error = '';
  #lastRead = 0;
  #working = false;
  #searching = false;
  #legacyList = false;
  #searchRevision = 0;
  #searchAbort: AbortController | null = null;
  get rows() {
    return this.#rows;
  }
  get results() {
    return this.#results;
  }
  get error() {
    return this.#error;
  }
  get fresh() {
    return !this.#error && Date.now() - this.#lastRead < 60000;
  }
  get working() {
    return this.#working;
  }
  get searching() {
    return this.#searching;
  }
  constructor(client: SupabaseClient, changed: () => void) {
    this.#client = client;
    this.#changed = changed;
  }
  start(user: string | null) {
    if (user === this.#user && this.#timer) return;
    if (this.#user) void this.stop();
    if (!user) return;
    this.#user = user;
    this.#session = crypto.randomUUID();
    ++this.#generation;
    this.#rows = [];
    this.#invites = [];
    this.#results = [];
    this.#lastRead = 0;
    this.#error = '';
    this.#flight = null;
    this.#working = false;
    this.#searching = false;
    this.#timer = setInterval(() => {
      void this.refresh();
    }, 30000);
    void this.refresh();
  }
  async stop() {
    const session = this.#session,
      flight = this.#flight;
    this.#user = null;
    ++this.#generation;
    ++this.#searchRevision;
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#searchAbort?.abort();
    this.#rows = [];
    this.#invites = [];
    this.#results = [];
    this.#lastRead = 0;
    this.#error = '';
    this.#working = false;
    this.#searching = false;
    this.#changed();
    // Finish an already-sent heartbeat before deleting this session; otherwise
    // an in-flight touch could recreate it after sign-out.
    await flight;
    if (session) {
      try {
        await this.#client
          .rpc('polycup_presence_leave', { session_key: session })
          .abortSignal(timeout());
      } catch {
        /* TTL handles a closed page or an unavailable network. */
      }
    }
  }
  refresh(): Promise<void> {
    if (!this.#user) return Promise.resolve();
    if (this.#flight) return this.#flight;
    const generation = this.#generation,
      session = this.#session;
    const job = (async () => {
      let changed = false;
      try {
        const [presence, list, invites] = await Promise.all([
          this.#client
            .rpc('polycup_presence_touch', { session_key: session })
            .abortSignal(timeout()),
          this.#readFriends(),
          this.#client.rpc('polycup_friend_invites').abortSignal(timeout()),
        ]);
        if (generation !== this.#generation) return;
        if (presence.error || list.error) throw new Error();
        const rows = (list.data ?? []) as FriendRelationship[];
        const incoming = invites.error ? this.#invites : ((invites.data ?? []) as CupInvite[]);
        changed =
          !!this.#error ||
          !this.#lastRead ||
          JSON.stringify(rows) !== JSON.stringify(this.#rows) ||
          JSON.stringify(incoming) !== JSON.stringify(this.#invites);
        this.#rows = rows;
        this.#invites = incoming;
        this.#lastRead = Date.now();
        this.#error = '';
      } catch {
        if (generation !== this.#generation) return;
        changed = !this.#error;
        this.#error = 'Friends are unavailable. Check your connection and try again.';
      } finally {
        if (changed && generation === this.#generation) this.#changed();
      }
    })();
    this.#flight = job;
    void job.finally(() => {
      if (this.#flight === job) this.#flight = null;
    });
    return job;
  }
  async #readFriends() {
    if (this.#legacyList) return this.#client.rpc('polycup_friends').abortSignal(timeout());
    const result = await this.#client.rpc('polycup_friends_v2').abortSignal(timeout());
    if (['PGRST202', '42883'].includes(result.error?.code ?? '')) {
      this.#legacyList = true;
      return this.#client.rpc('polycup_friends').abortSignal(timeout());
    }
    return result;
  }
  async gameCode(player: string): Promise<string> {
    const { data, error } = await this.#client
      .rpc('polycup_friend_game', { friend_key: player })
      .abortSignal(timeout());
    if (error || !data)
      throw new Error(error?.message ?? 'This friend is no longer in a joinable public Cup.');
    return data;
  }
  async search(query: string) {
    const term = query.trim();
    if (!this.#user) throw new Error('Sign in to find players.');
    if (Array.from(term).length < 2 || Array.from(term).length > 64)
      throw new Error('Enter at least two characters of a PolyCup name, or paste a friend code.');
    const generation = this.#generation,
      revision = ++this.#searchRevision;
    this.#searchAbort?.abort();
    this.#searchAbort = new AbortController();
    const controller = this.#searchAbort;
    const timer = setTimeout(() => controller.abort(), 12000);
    this.#searching = true;
    this.#results = [];
    this.#changed();
    try {
      if (term.toLowerCase() === this.#user.toLowerCase())
        throw new Error('You cannot add yourself, silly');
      const { data, error } = await this.#client
        .rpc('polycup_find_players', { search_text: term })
        .abortSignal(controller.signal);
      if (generation !== this.#generation || revision !== this.#searchRevision) return;
      if (error) throw new Error('Player search failed. Please try again.');
      this.#results = (data ?? []) as FriendPerson[];
    } finally {
      clearTimeout(timer);
      if (generation === this.#generation && revision === this.#searchRevision) {
        this.#searching = false;
        this.#changed();
      }
    }
  }
  async #mutate(action: () => PromiseLike<{ error: { code?: string; message: string } | null }>) {
    if (!this.#user) throw new Error('Sign in first.');
    if (this.#working) return;
    const generation = this.#generation;
    this.#working = true;
    this.#changed();
    try {
      const { error } = await action();
      if (generation !== this.#generation) return;
      if (error && error.code !== '23505')
        throw new Error(
          error.code === 'P0001'
            ? error.message
            : 'That change could not be saved. Please try again.',
        );
      await this.#flight;
      if (generation === this.#generation) await this.refresh();
    } finally {
      if (generation === this.#generation) {
        this.#working = false;
        this.#changed();
      }
    }
  }
  request(player: string) {
    if (player === this.#user) return Promise.reject(new Error('You cannot add yourself, silly'));
    return this.#mutate(() =>
      this.#client
        .from('friendships')
        .insert({ requester_id: this.#user, addressee_id: player })
        .abortSignal(timeout()),
    );
  }
  invite(player: string, room: string, instance: string) {
    return this.#mutate(() =>
      this.#client
        .rpc('polycup_invite_friend', {
          friend_key: player,
          room_key: room,
          instance_key: instance,
        })
        .abortSignal(timeout()),
    );
  }
  dismissInvite(invite: string) {
    return this.#mutate(() =>
      this.#client.rpc('polycup_dismiss_invite', { invite_key: invite }).abortSignal(timeout()),
    );
  }
  accept(friendship: string) {
    return this.#mutate(() =>
      this.#client
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendship)
        .eq('status', 'pending')
        .abortSignal(timeout()),
    );
  }
  remove(friendship: string, status: 'pending' | 'accepted') {
    return this.#mutate(() =>
      this.#client
        .from('friendships')
        .delete()
        .eq('id', friendship)
        .eq('status', status)
        .abortSignal(timeout()),
    );
  }
}
