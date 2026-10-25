import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { accountConfig } from './account-config.ts';
import { LobbyDirectory } from './lobby-directory.ts';
import { Friends } from './friends.ts';
import { Ranked } from './ranked.ts';
import { RankedQueue } from './ranked-queue.ts';
import { desktopAuth } from './desktop-auth.ts';
import {
  ACCOUNT_STORAGE,
  PENDING_STORAGE,
  LOGIN_LIFETIME,
  accountStorage,
  clearPending,
  parseReturnCode,
  readPending,
  validateAccountName,
  type PendingLogin,
} from './account-flow.ts';

export class PolyCupAccount {
  #user: User | null = null;
  #profileName = '';
  #rating: number | null = null;
  #profileError = '';
  #pending: PendingLogin | null;
  #busy = false;
  #client: SupabaseClient;
  #popup: Window | null = null;
  #revision = 0;
  #changed: () => void;
  #tab: Storage;
  #friends: Friends;
  #directory: LobbyDirectory;
  #ranked: Ranked;
  #queue: RankedQueue;
  get queue() {
    return this.#queue;
  }
  get ranked() {
    return this.#ranked;
  }
  get directory() {
    return this.#directory;
  }
  get friends() {
    return this.#friends;
  }
  get user() {
    return this.#user;
  }
  get profileName() {
    return this.#profileName;
  }
  get rating() {
    return this.#rating;
  }
  get profileError() {
    return this.#profileError;
  }
  get pending() {
    return this.#pending;
  }
  get busy() {
    return this.#busy;
  }
  constructor(changed: () => void, tab = sessionStorage, persistent = localStorage) {
    this.#changed = changed;
    this.#tab = tab;
    this.#pending = readPending(tab);
    this.#client = createClient(accountConfig.url, accountConfig.publishableKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
        storageKey: ACCOUNT_STORAGE,
        storage: accountStorage(persistent, tab),
      },
    });
    this.#directory = new LobbyDirectory(this.#client);
    this.#ranked = new Ranked(this.#client);
    this.#queue = new RankedQueue(this.#ranked, tab);
    this.#friends = new Friends(this.#client, changed);
    window.addEventListener('pagehide', () => {
      void this.#friends.stop();
      void this.#directory.stop();
    });
    window.addEventListener('pageshow', () => {
      this.#friends.start(this.#user?.id ?? null);
      this.#directory.resume();
    });
    window.addEventListener('online', () => {
      void this.#friends.refresh();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.#friends.refresh();
    });
    this.#client.auth.onAuthStateChange((_event, session) => {
      const previous = this.#user?.id ?? null;
      this.#user = session?.user ?? null;
      this.#queue.setUser(this.#user && !this.#user.is_anonymous ? this.#user.id : null);
      this.#directory.setUser(this.#user?.id ?? null);
      // Supabase can emit SIGNED_IN again on tab focus. Don't rebuild the panel
      // or reload its profile for an unchanged identity on each focus/refresh.
      if (previous === (this.#user?.id ?? null) && _event !== 'USER_UPDATED') return;
      if (previous !== (this.#user?.id ?? null)) {
        this.#profileName = '';
        this.#rating = null;
      }
      this.#profileError = '';
      const revision = ++this.#revision;
      this.#changed();
      window.setTimeout(() => {
        if (revision !== this.#revision) return;
        this.#friends.start(this.#user?.id ?? null);
        if (this.#user) void this.#loadProfile(revision);
      }, 0);
    });
  }
  async #loadProfile(revision: number) {
    const id = this.#user?.id;
    if (!id) return;
    try {
      const [profile, rating] = await Promise.all([
        this.#client.from('profiles').select('display_name').eq('id', id).single(),
        this.#client.from('player_ratings').select('rating').eq('player_id', id).single(),
      ]);
      if (revision !== this.#revision) return;
      if (profile.error || rating.error) throw new Error();
      this.#profileName = profile.data.display_name;
      this.#rating = rating.data.rating;
    } catch {
      if (revision !== this.#revision) return;
      this.#profileError =
        'Signed in, but your PolyCup profile could not be loaded. Reopen Account to retry.';
    }
    this.#changed();
  }
  async refresh() {
    const { data, error } = await this.#client.auth.getSession();
    if (error) throw new Error('Your saved sign-in could not be restored. Please sign in again.');
    this.#user = data.session?.user ?? null;
    this.#friends.start(this.#user?.id ?? null);
    this.#directory.setUser(this.#user?.id ?? null);
    await this.#loadProfile(++this.#revision);
  }
  async updateName(value: string) {
    if (this.#busy) throw new Error('Wait for the current account action to finish.');
    const name = validateAccountName(value);
    const id = this.#user?.id;
    if (!id) throw new Error('Sign in before changing your PolyCup name.');
    this.#busy = true;
    ++this.#revision; // Ignore any older profile request already in flight.
    this.#changed();
    try {
      const { data, error } = await this.#client
        .from('profiles')
        .update({ display_name: name })
        .eq('id', id)
        .select('display_name')
        .single();
      if (error || !data)
        throw new Error('Your name could not be saved. Check your connection and try again.');
      if (this.#user?.id !== id)
        throw new Error('Your account changed. Sign in again before editing.');
      ++this.#revision;
      this.#profileName = data.display_name;
    } finally {
      this.#busy = false;
      this.#changed();
    }
  }
  async begin() {
    if (this.#busy) return;
    this.#busy = true;
    try {
      clearPending(this.#tab);
      this.#pending = null;
      // Open synchronously during the click; denied popups use the copy-link path.
      this.#popup = this.#desktop()
        ? null
        : window.open('about:blank', '_blank', 'popup,width=520,height=740');
      this.#changed();
      if (!crypto.subtle)
        throw new Error('Secure sign-in is unavailable here. Open PML over HTTPS.');
      const attempt = crypto.randomUUID();
      const redirect = new URL(accountConfig.callback);
      redirect.searchParams.set('attempt', attempt);
      let returnUrl: string | undefined;
      try {
        returnUrl = await this.#desktop()?.startReturn?.(attempt);
      } catch {
        /* A blocked local listener still permits the existing return-code flow. */
      }
      if (returnUrl) redirect.searchParams.set('desktop_return', returnUrl);
      if (location.origin !== 'null') redirect.searchParams.set('origin', location.origin);
      const { data, error } = await this.#client.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo: redirect.href, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw new Error('Could not start Discord sign-in. Please try again.');
      this.#pending = {
        attempt,
        flowId: data.flowId ?? undefined,
        expires: Date.now() + LOGIN_LIFETIME,
        url: data.url,
      };
      this.#tab.setItem(PENDING_STORAGE, JSON.stringify(this.#pending));
      if (this.#desktop()) await this.#desktop()!.openDiscord(data.url);
      else if (this.#popup) this.#popup.location.href = data.url;
    } catch (error) {
      this.#popup?.close();
      void this.#desktop()
        ?.cancelReturn?.()
        .catch(() => {});
      clearPending(this.#tab);
      this.#pending = null;
      throw error;
    } finally {
      this.#busy = false;
      this.#changed();
    }
  }
  #desktop() {
    return desktopAuth();
  }
  async reopen() {
    if (!this.#pending) return;
    if (this.#desktop()) await this.#desktop()!.openDiscord(this.#pending.url);
    else this.#popup = window.open(this.#pending.url, '_blank', 'popup,width=520,height=740');
  }
  accepts(event: MessageEvent) {
    return (
      event.origin === new URL(accountConfig.callback).origin &&
      event.source !== null &&
      event.source === this.#popup &&
      event.data?.type === 'polycup-auth-return' &&
      typeof event.data.code === 'string'
    );
  }
  async complete(value: string) {
    if (this.#busy) return false;
    const code = parseReturnCode(value, this.#pending);
    this.#busy = true;
    this.#changed();
    try {
      const { data, error } = await this.#client.auth.exchangeCodeForSession(
        code,
        this.#pending?.flowId ? { flowId: this.#pending.flowId } : undefined,
      );
      if (error || !data.session)
        throw new Error('This sign-in could not be completed. Start again with Discord.');
      this.#user = data.session.user;
      this.#friends.start(this.#user.id);
      clearPending(this.#tab);
      this.#pending = null;
      this.#popup?.postMessage(
        { type: 'polycup-auth-complete' },
        new URL(accountConfig.callback).origin,
      );
      await this.#loadProfile(++this.#revision);
      return true;
    } catch (error) {
      clearPending(this.#tab);
      this.#pending = null;
      throw error;
    } finally {
      this.#busy = false;
      this.#changed();
    }
  }
  cancel() {
    if (this.#busy) return;
    clearPending(this.#tab);
    this.#pending = null;
    this.#popup?.close();
    this.#popup = null;
    void this.#desktop()
      ?.cancelReturn?.()
      .catch(() => {});
    this.#changed();
  }
  async signOut() {
    if (this.#busy) return;
    this.#busy = true;
    this.#changed();
    try {
      await this.#directory.stop();
      await this.#friends.stop();
      const { error } = await this.#client.auth.signOut({ scope: 'local' });
      if (error) {
        this.#friends.start(this.#user?.id ?? null);
        this.#directory.resume();
        throw new Error('Could not sign out. Check your connection and try again.');
      }
      clearPending(this.#tab);
      this.#pending = null;
      this.#user = null;
    } finally {
      this.#busy = false;
      this.#changed();
    }
  }
}
