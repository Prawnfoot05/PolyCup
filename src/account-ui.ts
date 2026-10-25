import { element as h } from './dom.ts';
import { PolyCupAccount } from './account.ts';
import { discordIdentity } from './account-flow.ts';
import css from './account.css';
import discordMark from '../assets/discord-mark.svg';
import { desktopAuth } from './desktop-auth.ts';
import { FriendsUI, type FriendsView } from './friends-ui.ts';
import { RankedHistoryUI } from './ranked-history-ui.ts';

export class AccountUI {
  #friendsOnly = false;
  #inviteRoom?: { id: string; instance: string };
  #joinInvite?: (code: string) => Promise<void>;
  setInviteJoin(join: (code: string) => Promise<void>) {
    this.#joinInvite = join;
  }
  openFriends(room?: { id: string; instance: string }) {
    this.#friendsOnly = true;
    this.#inviteRoom = room;
    this.#view = 'friends';
    this.open();
  }
  #embedded = false;
  #embeddedFooterLeading?: HTMLElement;
  #signOutAllowed: () => boolean = () => true;
  setSignOutAllowed(check: () => boolean) {
    this.#signOutAllowed = check;
  }
  #home: ShadowRoot;
  #dialog = h('dialog', undefined, 'rules-dialog account-dialog');
  #body = h('div', undefined, 'rules-dialog-body account-body');
  #header = h('div', undefined, 'account-social-header');
  #nav = h('nav', undefined, 'account-tabs');
  #footer = h('footer', undefined, 'account-footer');
  #friendCodeCopied = false;
  #copyFeedbackTimer?: number;
  #account?: PolyCupAccount;
  #error = '';
  #code = '';
  #copied = false;
  #editingName = false;
  #nameDraft = '';
  #nameOwner: string | null = null;
  #nameSaved = false;
  #view: FriendsView = 'friends';
  #historyUI: RankedHistoryUI;
  #friendsUI = new FriendsUI(
    () => this.#render(),
    (person) => {
      if (this.#account)
        this.#historyUI.open(this.#account.ranked, person.player_id, person.display_name);
    },
  );
  openHistory(id: string, name: string) {
    if (this.#account) this.#historyUI.open(this.#account.ranked, id, name);
  }
  get account() {
    return this.#account;
  }
  get isOpen() {
    return this.#dialog.open && !this.#embedded;
  }
  mount(container: HTMLElement, footerLeading?: HTMLElement) {
    this.#friendsOnly = false;
    this.#inviteRoom = undefined;
    this.#dialog.close();
    this.#embedded = true;
    this.#embeddedFooterLeading = footerLeading;
    this.#dialog.classList.add('account-embedded');
    this.#dialog.style.display = '';
    container.append(this.#dialog);
    this.#dialog.open = true;
    this.#render();
  }
  unmount() {
    this.#dialog.style.display = 'none';
    this.#dialog.close();
    this.#embedded = false;
    this.#embeddedFooterLeading = undefined;
    this.#dialog.classList.remove('account-embedded');
    this.#home.append(this.#dialog);
  }
  close() {
    this.#dialog.close();
  }
  constructor(shadow: ShadowRoot) {
    this.#home = shadow;
    this.#historyUI = new RankedHistoryUI(shadow);
    shadow.append(h('style', css));
    const close = this.#button('×', () => this.#dialog.close());
    close.className = 'account-close';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    this.#nav.setAttribute('aria-label', 'Account views');
    this.#dialog.append(this.#header, close, this.#nav, this.#body, this.#footer);
    this.#dialog.setAttribute('aria-label', 'PolyCup account');
    this.#dialog.addEventListener('click', (e) => {
      if (e.target !== this.#dialog) return;
      const r = this.#dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        this.#dialog.close();
    });
    shadow.append(this.#dialog);
    // Restore saved sign-ins and presence when the game opens, not on first visit
    // to this panel. Auth errors must never prevent ordinary Cup play.
    try {
      this.#account = new PolyCupAccount(() => this.#render());
    } catch {
      this.#error = 'Account storage is unavailable. Allow browser storage to sign in.';
    }
    window.addEventListener('message', (e) => {
      if (this.#account?.accepts(e))
        void this.#act(async () => {
          if (await this.#account!.complete(e.data.code)) this.#code = '';
        });
    });
    desktopAuth()?.onReturn?.((code) => {
      const attempt = this.#account?.pending?.attempt;
      if (!attempt || typeof code !== 'string') return;
      void this.#act(async () => {
        let success = false;
        try {
          success = await this.#account!.complete(code);
          if (success) this.#code = '';
        } finally {
          await desktopAuth()?.finishReturn?.(attempt, success);
        }
      });
    });
  }
  #button(label: string, action: () => void | Promise<void>, primary = false) {
    const button = h('button', label, primary ? 'primary' : 'quiet');
    button.type = 'button';
    button.disabled = this.#account?.busy ?? false;
    button.addEventListener('click', () => {
      if (button.type !== 'submit') void this.#act(action);
    });
    return button;
  }
  #iconButton(label: string, path: string, action: () => void | Promise<void>) {
    const button = this.#button('', action);
    button.className = 'account-icon-button';
    button.setAttribute('aria-label', label);
    button.title = label;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', path);
    icon.append(line);
    button.append(icon);
    return button;
  }
  #discordButton(label: string, action: () => Promise<void>) {
    const button = this.#button(label, action);
    button.className = 'discord-sign-in';
    const icon = h('span', undefined, 'discord-mark');
    icon.innerHTML = discordMark;
    icon.setAttribute('aria-hidden', 'true');
    button.replaceChildren(icon, h('span', label));
    return button;
  }
  async #act(action: () => void | Promise<void>) {
    this.#error = '';
    try {
      await action();
    } catch (error) {
      this.#error =
        error instanceof Error ? error.message : 'Account action failed. Please try again.';
    }
    this.#render();
  }
  open() {
    if (this.#embedded) this.unmount();
    this.#dialog.style.display = '';
    this.#dialog.showModal();
    void this.#act(async () => {
      this.#account ??= new PolyCupAccount(() => this.#render());
      await this.#account.refresh();
      void this.#account.friends.refresh();
    });
    this.#render();
  }
  #render() {
    if (!this.#dialog.open) return;
    const focused = (this.#dialog.getRootNode() as ShadowRoot).activeElement;
    const focusId =
      focused instanceof HTMLElement && this.#dialog.contains(focused) ? focused.id : '';
    const input =
      focused instanceof HTMLInputElement && this.#dialog.contains(focused) ? focused : null;
    const selection = input?.id
      ? { id: input.id, start: input.selectionStart, end: input.selectionEnd }
      : null;
    this.#renderBody();
    if (focusId && !selection && this.#dialog.open)
      this.#dialog
        .querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)
        ?.focus({ preventScroll: true });
    if (selection && this.#dialog.open) {
      const replacement = this.#dialog.querySelector<HTMLInputElement>(`#${selection.id}`);
      if (replacement && !replacement.disabled) {
        replacement.focus({ preventScroll: true });
        replacement.setSelectionRange(selection.start, selection.end);
      }
    }
  }
  #renderBody() {
    const a = this.#account;
    if (this.#nameOwner !== (a?.user?.id ?? null)) {
      this.#nameOwner = a?.user?.id ?? null;
      this.#editingName = false;
      this.#nameDraft = '';
      this.#nameSaved = false;
      this.#friendCodeCopied = false;
      window.clearTimeout(this.#copyFeedbackTimer);
      this.#view = 'friends';
      this.#friendsUI.reset();
    }
    this.#body.replaceChildren();
    this.#header.replaceChildren();
    this.#nav.replaceChildren();
    this.#footer.replaceChildren();
    this.#dialog.setAttribute('aria-label', this.#friendsOnly ? 'Friends' : 'PolyCup account');
    this.#dialog.classList.toggle('friends-only', this.#friendsOnly);
    if (this.#friendsOnly) {
      this.#header.append(h('h2', 'Friends'));
      this.#nav.hidden = true;
      this.#footer.hidden = true;
      if (a?.user)
        this.#body.append(
          this.#friendsUI.render(a.friends, 'friends', this.#inviteRoom, this.#joinInvite),
        );
      else
        this.#body.append(
          h('p', 'Sign in from the server finder to invite friends.', 'account-note'),
        );
      if (this.#error) this.#body.append(h('p', this.#error, 'account-error'));
      return;
    }
    if (this.#embeddedFooterLeading) this.#footer.append(this.#embeddedFooterLeading);
    this.#footer.hidden = !a?.user && !this.#embeddedFooterLeading;
    this.#nav.hidden = !a?.user;
    if (a?.user) {
      const identity = discordIdentity(a.user.user_metadata);
      const portrait = h(
        'span',
        Array.from(identity.name)[0]?.toUpperCase() || '?',
        'account-avatar',
      );
      if (identity.avatar) {
        const avatar = h('img');
        avatar.alt = '';
        avatar.referrerPolicy = 'no-referrer';
        avatar.src = identity.avatar;
        avatar.onerror = () => avatar.remove();
        portrait.append(avatar);
      }
      const labels = h('div', undefined, 'account-header-labels');
      if (this.#editingName) {
        const form = h('form', undefined, 'account-header-edit');
        const input = h('input');
        input.id = 'polycup-account-name';
        input.setAttribute('aria-label', 'PolyCup name');
        input.value = this.#nameDraft;
        input.disabled = a.busy;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = 64;
        input.oninput = () => {
          this.#nameDraft = input.value;
        };
        const save = this.#iconButton('Save name', 'M5 12l4 4L19 6', () => {});
        save.type = 'submit';
        const cancel = this.#iconButton('Cancel name edit', 'M6 6l12 12M6 18L18 6', () => {
          this.#editingName = false;
          this.#nameDraft = '';
          requestAnimationFrame(() =>
            this.#header.querySelector<HTMLElement>('#account-edit-name')?.focus(),
          );
        });
        form.onsubmit = (e) => {
          e.preventDefault();
          void this.#act(async () => {
            await a.updateName(this.#nameDraft);
            this.#editingName = false;
            this.#nameSaved = true;
            requestAnimationFrame(() =>
              this.#header.querySelector<HTMLElement>('#account-edit-name')?.focus(),
            );
          });
        };
        form.append(input, save, cancel);
        labels.append(form);
      } else {
        const name = h('div', undefined, 'account-name-line');
        const edit = this.#iconButton(
          'Edit name',
          'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
          () => {
            this.#editingName = true;
            this.#nameDraft = a.profileName;
            this.#nameSaved = false;
            requestAnimationFrame(() => {
              const field = this.#header.querySelector<HTMLInputElement>('#polycup-account-name');
              field?.focus();
              field?.select();
            });
          },
        );
        edit.id = 'account-edit-name';
        name.append(h('h2', a.profileName || identity.name), edit);
        labels.append(name);
      }
      const username = h('div', undefined, 'account-username-line');
      if (identity.username) username.append(h('p', `@${identity.username}`));
      const copy = this.#iconButton(
        this.#friendCodeCopied ? 'Friend code copied' : 'Copy friend code',
        this.#friendCodeCopied ? 'M5 12l4 4L19 6' : 'M9 8h11v13H9zM15 8V3H4v13h5',
        async () => {
          await navigator.clipboard.writeText(a.user!.id);
          this.#friendCodeCopied = true;
          const owner = a.user!.id;
          window.clearTimeout(this.#copyFeedbackTimer);
          this.#copyFeedbackTimer = window.setTimeout(() => {
            if (this.#nameOwner !== owner) return;
            this.#friendCodeCopied = false;
            this.#render();
          }, 2000);
        },
      );
      copy.id = 'account-copy-friend-code';
      copy.classList.toggle('is-copied', this.#friendCodeCopied);
      username.append(copy);
      const history = this.#iconButton(
        'Match history',
        'M3 12a9 9 0 1 0 3-6M3 3v6h6M12 7v5l3 2',
        () => {
          this.#historyUI.open(a.ranked, a.user!.id, a.profileName || identity.name);
        },
      );
      history.id = 'account-match-history';
      username.append(history);
      labels.append(username);
      const feedback = h(
        'span',
        this.#friendCodeCopied
          ? 'Friend code copied.'
          : this.#nameSaved
            ? 'PolyCup name saved.'
            : '',
        'account-visually-hidden',
      );
      feedback.setAttribute('role', 'status');
      labels.append(feedback);
      const signOut = this.#button('Sign out', () => a.signOut());
      signOut.disabled ||= !this.#signOutAllowed();
      if (!this.#signOutAllowed()) signOut.title = 'Leave your Cup before signing out.';
      this.#footer.append(signOut);
      this.#header.append(portrait, labels);
    } else {
      this.#header.append(h('h2', this.#embedded ? 'Guest' : 'PolyCup account'));
    }
    if (this.#error || a?.signInError) {
      const error = h('p', this.#error || a!.signInError, 'account-error');
      error.setAttribute('role', 'alert');
      this.#body.append(error);
    }
    if (!a) {
      this.#body.append(h('p', 'Opening your account…'));
      return;
    }
    if (a.user) {
      const incoming = a.friends.rows.filter(
        (r) => r.status === 'pending' && r.direction === 'incoming',
      ).length;
      for (const [view, label, path] of [
        [
          'friends',
          'Friends',
          'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
        ],
        [
          'requests',
          incoming ? `Requests (${incoming})` : 'Requests',
          'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
        ],
        ['find', 'Add friend', 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
      ] as const) {
        const tab = this.#button(label, () => {
          this.#view = view;
          void a.friends.refresh();
        });
        tab.className = this.#view === view ? 'selected' : 'quiet';
        tab.id = `account-view-${view}`;
        tab.title = label;
        tab.setAttribute('aria-label', label);
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', path);
        icon.append(line);
        tab.replaceChildren(icon, h('span', label));
        tab.setAttribute('aria-current', this.#view === view ? 'page' : 'false');
        this.#nav.append(tab);
      }
      if (a.profileError) this.#body.append(h('p', a.profileError, 'account-error'));
      this.#body.append(this.#friendsUI.render(a.friends, this.#view, undefined, this.#joinInvite));
    } else if (a.pending) {
      const manual = Boolean(
        (desktopAuth()?.requiresReturnCode && !a.pending.relayRead) || a.browserBlocked,
      );
      const message = a.browserBlocked
        ? a.pending.relayRead
          ? 'The browser could not open. Copy the sign-in link into your browser. This window will finish signing you in.'
          : 'The browser could not open. Copy the sign-in link into your browser, then paste the return code below.'
        : manual
          ? 'Sign in in your browser, then paste the return code below.'
          : 'Waiting for Discord…';
      const status = h('p', message, 'account-sign-in-status');
      status.setAttribute('role', 'status');
      const actions = h('div', undefined, 'account-sign-in-actions');
      actions.append(this.#discordButton('Open Discord', () => a.reopen()));
      if (!manual)
        actions.append(
          this.#iconButton(
            this.#copied ? 'Link copied' : 'Copy sign-in link',
            'M9 9h11v12H9zM5 16H3V3h12v2',
            async () => {
              await navigator.clipboard.writeText(a.pending!.url);
              this.#copied = true;
            },
          ),
        );
      if (manual) {
        actions.classList.add('account-sign-in-manual');
        const copyLink = this.#button(
          this.#copied ? 'Link copied' : 'Copy sign-in link',
          async () => {
            await navigator.clipboard.writeText(a.pending!.url);
            this.#copied = true;
          },
        );
        actions.append(copyLink);
        const link = h('input');
        link.readOnly = true;
        link.value = a.pending.url;
        link.setAttribute('aria-label', 'Sign-in link');
        link.addEventListener('click', () => link.select());
        actions.append(link);
      }
      const details = h('div', undefined, 'account-return-code');
      const form = h('form', undefined, 'account-return-form');
      const label = h('label', 'Return code');
      const input = h('input');
      input.value = this.#code;
      input.placeholder = 'Return code';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.id = 'polycup-return-code';
      label.htmlFor = input.id;
      input.addEventListener('input', () => {
        this.#code = input.value;
      });
      const complete = h('button', a.busy ? 'Signing in…' : 'Finish sign-in', 'primary');
      complete.type = 'submit';
      complete.disabled = a.busy;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void this.#act(async () => {
          if (await a.complete(this.#code)) {
            this.#code = '';
            void desktopAuth()
              ?.cancelReturn?.()
              .catch(() => {});
          }
        });
      });
      const row = h('div', undefined, 'account-return-row');
      row.append(input, complete);
      form.append(label, row);
      details.append(form);
      const cancel = this.#button('Cancel sign-in', () => {
        a.cancel();
        this.#copied = false;
        this.#code = '';
      });
      cancel.className = 'account-sign-in-cancel';
      this.#body.append(status, actions, details, cancel);
    } else {
      this.#body.append(
        this.#discordButton(a.busy ? 'Opening Discord…' : 'Sign in with Discord', () => a.begin()),
      );
    }
  }
}
