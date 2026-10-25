import { element as h } from './dom.ts';
import { VERSION } from './cup.ts';
import type { PolyCupAccount } from './account.ts';
import type { LobbyDirectory, LobbyListing, HostedLobby } from './lobby-directory.ts';
import { openNativeLobby } from './native-lobby.ts';
import css from './lobby-finder.css';
export type FinderContext = { host: HostedLobby | null; connected: boolean };
export class LobbyFinderUI {
  #dialog = h('dialog', undefined, 'rules-dialog lobby-finder');
  #body = h('div', undefined, 'finder-body');
  #listing = h('div', undefined, 'finder-host');
  #footer = h('footer', undefined, 'finder-footer');
  #search = h('input');
  #account: () => PolyCupAccount | undefined;
  #context: () => FinderContext;
  #navigated: () => void;
  #directory: LobbyDirectory | undefined;
  #signature = '';
  #error = '';
  #joining = false;
  get isOpen() {
    return this.#dialog.open;
  }
  constructor(
    shadow: ShadowRoot,
    account: () => PolyCupAccount | undefined,
    context: () => FinderContext,
    navigated: () => void,
  ) {
    this.#account = account;
    this.#context = context;
    this.#navigated = navigated;
    shadow.append(h('style', css));
    this.#dialog.setAttribute('aria-label', 'Lobby finder');
    const header = h('header', undefined, 'finder-header');
    const close = this.#button('×', () => this.close());
    close.setAttribute('aria-label', 'Close lobby finder');
    header.append(h('h2', 'Lobby finder'), close);
    const tools = h('div', undefined, 'finder-tools');
    this.#search.placeholder = 'Search lobbies';
    this.#search.setAttribute('aria-label', 'Search lobbies');
    this.#search.oninput = () => this.#render();
    tools.append(
      this.#search,
      this.#button('Refresh', async () => {
        this.#error = '';
        await this.#directory?.refresh();
      }),
    );
    this.#dialog.append(header, this.#listing, tools, this.#body, this.#footer);
    this.#dialog.addEventListener('close', () => this.#directory?.setVisible(false));
    this.#dialog.addEventListener('click', (e) => {
      if (e.target !== this.#dialog) return;
      const r = this.#dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        this.close();
    });
    shadow.append(this.#dialog);
    this.update();
  }
  #button(text: string, action: () => void | Promise<void>) {
    const b = h('button', text, 'quiet');
    b.type = 'button';
    b.onclick = () => {
      void (async () => {
        try {
          await action();
        } catch (e) {
          this.#error = e instanceof Error ? e.message : 'Action failed.';
        }
        this.#render();
      })();
    };
    return b;
  }
  update() {
    if (!this.#directory) {
      this.#directory = this.#account()?.directory;
      this.#directory?.subscribe(() => this.#render());
    }
    const context = this.#context();
    this.#directory?.setContext(context.host);
    const signature = JSON.stringify(context);
    if (signature !== this.#signature) {
      this.#signature = signature;
      this.#render();
    }
  }
  open() {
    this.update();
    this.#dialog.showModal();
    this.#directory?.setVisible(true);
    this.#render();
  }
  close() {
    this.#dialog.close();
  }
  async #join(row: LobbyListing) {
    if (this.#joining) return;
    if (this.#context().connected)
      throw new Error('Leave your current lobby before joining another.');
    this.#joining = true;
    this.#error = '';
    this.#render();
    try {
      const code = await this.#directory!.resolve(row);
      if (this.#context().connected)
        throw new Error('Leave your current lobby before joining another.');
      await openNativeLobby('join', code);
      this.close();
      this.#navigated();
    } finally {
      this.#joining = false;
    }
  }
  #render() {
    if (!this.#dialog.open) return;
    const focus = (this.#dialog.getRootNode() as ShadowRoot).activeElement;
    const focusId = focus instanceof HTMLElement ? focus.id : '';
    const scroll = this.#body.scrollTop;
    const directory = this.#directory,
      context = this.#context();
    this.#body.replaceChildren();
    this.#listing.replaceChildren();
    this.#footer.replaceChildren();
    this.#listing.hidden = !context.host;
    if (context.host && directory) {
      const label = h('label', undefined, 'finder-public');
      const checkbox = h('input');
      checkbox.type = 'checkbox';
      checkbox.checked = directory.listed;
      checkbox.id = 'finder-public';
      checkbox.onchange = () => {
        void directory.setPublic(checkbox.checked);
      };
      label.append(checkbox, h('span', 'List publicly'));
      const identity = h('div');
      identity.append(
        h('strong', context.host.title),
        h('small', directory.listed ? (directory.confirmed ? 'Public' : 'Updating…') : 'Private'),
      );
      this.#listing.append(identity, label);
      if (directory.publishError)
        this.#listing.append(h('p', directory.publishError, 'finder-error'));
    }
    const error = this.#error || directory?.error;
    if (error) {
      const note = h('p', error, 'finder-error');
      note.setAttribute('role', 'alert');
      this.#body.append(note);
    }
    if (!directory)
      this.#body.append(
        h('p', 'Account services are unavailable. Reload to retry.', 'finder-error'),
      );
    const query = this.#search.value.trim().toLocaleLowerCase();
    const rows = (directory?.rows ?? []).filter((r) =>
      (r.title + ' ' + r.host_name).toLocaleLowerCase().includes(query),
    );
    if (!rows.length && !error)
      this.#body.append(
        h('p', directory?.fresh ? 'No lobbies found.' : 'Loading…', 'finder-empty'),
      );
    for (const row of rows) {
      const item = h('article', undefined, 'finder-row');
      const title = h('div', undefined, 'finder-identity');
      title.append(h('h3', row.title), h('span', row.host_name));
      const phase = h(
        'span',
        row.phase === 'waiting' ? 'In lobby' : row.phase === 'drafting' ? 'Drafting' : 'Racing',
        `finder-phase ${row.phase}`,
      );
      const players = h('span', `${row.players}/${row.capacity}`, 'finder-players');
      players.title = 'Players in the multiplayer lobby';
      const compatible = row.mod_version === VERSION,
        full = row.players >= row.capacity;
      const join = this.#button(
        this.#joining ? 'Joining…' : !compatible ? 'Update mod' : full ? 'Full' : 'Join',
        () => this.#join(row),
      );
      join.id = `finder-join-${row.host_id}`;
      join.className = 'primary';
      join.disabled =
        this.#joining || !compatible || full || context.connected || !directory?.fresh;
      join.title = !compatible
        ? `Requires PolyCup ${row.mod_version}`
        : context.connected
          ? 'Leave your current lobby first.'
          : '';
      item.append(title, phase, players, join);
      this.#body.append(item);
    }
    if (context.connected && !context.host)
      this.#footer.append(h('span', 'Leave your current lobby to join another.'));
    const host = this.#button('Host lobby', async () => {
      if (this.#context().connected || this.#joining) return;
      this.#joining = true;
      this.#render();
      try {
        await openNativeLobby('host');
        this.close();
        this.#navigated();
      } finally {
        this.#joining = false;
      }
    });
    host.disabled = context.connected || this.#joining;
    host.title = context.connected ? 'Already in a multiplayer lobby.' : '';
    this.#footer.append(host);
    this.#body.scrollTop = scroll;
    if (focusId)
      this.#dialog
        .querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)
        ?.focus({ preventScroll: true });
  }
}
