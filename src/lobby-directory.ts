import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accountConfig } from './account-config.ts';
import { VERSION } from './cup.ts';
export type LobbyListing = {
  host_id: string;
  cup_id: string;
  host_name: string;
  title: string;
  mod_version: string;
  phase: 'waiting' | 'drafting' | 'racing';
  players: number;
  capacity: number;
};
export type HostedLobby = {
  cupId: string;
  hostName: string;
  title: string;
  code: string;
  expires: number;
  phase: LobbyListing['phase'];
  players: number;
  capacity: number;
};
export class LobbyDirectory {
  #client: SupabaseClient;
  #guest: SupabaseClient | undefined;
  #writer: { client: SupabaseClient; owner: string } | null = null;
  #user: string | null = null;
  #instance = crypto.randomUUID();
  #context: HostedLobby | null = null;
  #public = false;
  #preference = true;
  #published = false;
  #visible = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #listeners = new Set<() => void>();
  #flight: Promise<void> | null = null;
  #resync = false;
  #read: Promise<void> | null = null;
  #rows: LobbyListing[] = [];
  #error = '';
  #publishError = '';
  #lastRead = 0;
  #lastPublish = 0;
  #retryAfter = 0;
  #sent = '';
  #guestName = '';
  get rows() {
    return this.#rows;
  }
  get error() {
    return this.#error;
  }
  get publishError() {
    return this.#publishError;
  }
  get listed() {
    return this.#public;
  }
  get confirmed() {
    return this.#published && !this.#publishError;
  }
  get fresh() {
    return !this.#error && Date.now() - this.#lastRead < 45000;
  }
  subscribe(fn: () => void) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  #changed() {
    for (const fn of this.#listeners) fn();
  }
  constructor(client: SupabaseClient) {
    this.#client = client;
  }
  setUser(user: string | null) {
    if (user === this.#user) return;
    if (this.#writer?.client === this.#client && this.#writer.owner !== user) {
      // A remote sign-out revokes this client's ability to remove the old owner's
      // listing; its server lease expires. Never try to mutate it as the new user.
      this.#writer = null;
      this.#published = false;
      this.#sent = '';
    }
    this.#user = user;
    this.#public = !!this.#context && this.#preference;
    if (this.#public) void this.#sync(true);
    this.#clock();
    this.#changed();
  }
  setContext(context: HostedLobby | null) {
    const differentCup = this.#context?.cupId !== context?.cupId;
    this.#context = context;
    if (differentCup) {
      this.#preference = true;
      this.#public = !!context;
      void this.#sync(true);
      this.#clock();
      this.#changed();
    }
  }
  setVisible(visible: boolean) {
    this.#visible = visible;
    this.#clock();
    if (visible) void this.refresh();
  }
  #clock() {
    clearInterval(this.#timer);
    this.#timer = undefined;
    if (this.#visible || this.#public || this.#writer)
      this.#timer = setInterval(() => {
        if (this.#visible && Date.now() - this.#lastRead > 15000) void this.refresh();
        if (this.#public || this.#writer) void this.#sync();
      }, 3000);
  }
  async setPublic(value: boolean) {
    if (value && !this.#context) throw new Error('Host a Cup first.');
    this.#preference = value;
    this.#public = value;
    this.#publishError = '';
    this.#clock();
    this.#changed();
    await this.#sync(true);
  }
  async stop() {
    this.#public = false;
    this.#visible = false;
    this.#clock();
    await this.#sync(true);
  }
  resume() {
    this.#public = !!this.#context && this.#preference;
    this.#clock();
    if (this.#public) void this.#sync(true);
  }
  async #unlist() {
    if (!this.#writer) return;
    const { error } = await this.#writer.client
      .rpc('polycup_unlist_lobby', { instance_key: this.#instance })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;
    this.#writer = null;
    this.#published = false;
    this.#sent = '';
    this.#clock();
    if (this.#visible) void this.refresh();
  }
  async #publisher() {
    if (this.#user) return { client: this.#client, owner: this.#user };
    this.#guest ??= createClient(accountConfig.url, accountConfig.publishableKey, {
      auth: {
        storageKey: 'polycup.lobby-guest.v1',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    let {
      data: { session },
    } = await this.#guest.auth.getSession();
    if (!session) {
      const result = await this.#guest.auth.signInAnonymously();
      if (result.error || !result.data.session)
        throw new Error('Guest hosting is unavailable. Try again shortly.');
      session = result.data.session;
    }
    return { client: this.#guest, owner: session.user.id };
  }
  // Waiting rooms use the same isolated guest session as public announcements.
  roomSession() {
    return this.#publisher();
  }
  get browserClient() {
    return this.#client;
  }
  async #publish(force: boolean) {
    const context = this.#context;
    if (!force && Date.now() < this.#retryAfter) return;
    if (!this.#public || !context || context.expires <= Date.now() || !context.code) {
      await this.#unlist();
      this.#publishError = '';
      this.#changed();
      return;
    }
    if (!force && Date.now() < this.#retryAfter) return;
    const signature = JSON.stringify(context);
    if (!force && signature === this.#sent && Date.now() - this.#lastPublish < 20000) return;
    const user = this.#user;
    const writer = await this.#publisher();
    if (user !== this.#user || context.cupId !== this.#context?.cupId || !this.#public) {
      this.#resync = true;
      return;
    }
    if (
      this.#writer &&
      (writer.client !== this.#writer.client || writer.owner !== this.#writer.owner)
    )
      await this.#unlist();
    if (writer.client === this.#guest) {
      const name =
        Array.from(context.hostName.replace(/[\u0000-\u001f\u007f]/g, '').trim())
          .slice(0, 32)
          .join('') || 'Player';
      if (name !== this.#guestName) {
        const { error } = await writer.client
          .from('profiles')
          .update({ display_name: name })
          .eq('id', writer.owner);
        if (error) throw error;
        this.#guestName = name;
      }
    }
    // Remember even an ambiguous write so switching private attempts removal.
    this.#writer = writer;
    const { error } = await writer.client
      .rpc('polycup_list_lobby', {
        instance_key: this.#instance,
        cup_key: context.cupId,
        lobby_title: context.title,
        code: context.code,
        version: VERSION,
        stage: context.phase,
        player_count: context.players,
        player_limit: context.capacity,
        invite_seconds: Math.max(
          1,
          Math.min(3600, Math.floor((context.expires - Date.now()) / 1000)),
        ),
      })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;
    const changed = signature !== this.#sent;
    this.#published = true;
    this.#sent = signature;
    this.#lastPublish = Date.now();
    this.#publishError = '';
    this.#changed();
    if (changed && this.#visible) void this.refresh();
  }
  #sync(force = false) {
    if (this.#flight) {
      this.#resync ||= force;
      return this.#flight;
    }
    this.#flight = (async () => {
      do {
        this.#resync = false;
        try {
          await this.#publish(force);
        } catch (error) {
          this.#retryAfter = Date.now() + 30000;
          this.#publishError =
            (error as { code?: string })?.code === 'P0001'
              ? 'Another window is already listing a lobby.'
              : error instanceof Error
                ? error.message
                : 'Could not update the listing. Retry shortly.';
          this.#changed();
        }
        force = true;
      } while (this.#resync);
    })().finally(() => {
      this.#flight = null;
    });
    return this.#flight;
  }
  refresh() {
    if (this.#read) return this.#read;
    const task = (async () => {
      try {
        const { data, error } = await this.#client
          .rpc('polycup_lobbies')
          .abortSignal(AbortSignal.timeout(10000));
        if (error) throw error;
        this.#rows = Array.isArray(data) ? data : [];
        this.#error = '';
        this.#lastRead = Date.now();
      } catch {
        this.#error = 'Lobbies unavailable. Try refreshing.';
        this.#rows = [];
        this.#lastRead = Date.now();
      } finally {
        this.#read = null;
        this.#changed();
      }
    })();
    this.#read = task;
    return task;
  }
  async resolve(row: LobbyListing) {
    const { data, error } = await this.#client
      .rpc('polycup_join_lobby', {
        host_key: row.host_id,
        expected_cup: row.cup_id,
        client_version: VERSION,
      })
      .abortSignal(AbortSignal.timeout(10000));
    if (error || typeof data !== 'string' || !/^[A-Z0-9]{8}$/.test(data)) {
      void this.refresh();
      throw new Error('Lobby unavailable. Refresh and try again.');
    }
    return data;
  }
}
