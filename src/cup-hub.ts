import { RankedResultUI } from './ranked-result-ui.ts';
import { RankedSettlement } from './ranked-settlement.ts';
import { RankedInputOutbox } from './ranked-inputs.ts';
import { RankedNotifications } from './ranked-notifications.ts';
import type { RankedProfile } from './ranked.ts';
import { LeaderboardUI } from './leaderboard-ui.ts';
import { element as h } from './dom.ts';
import { WaitingRoom, type WaitingRoomListing } from './waiting-room.ts';
import { WaitingRoomChat } from './waiting-room-chat.ts';
import { RoomHandoff, controllerRaceBridge } from './room-handoff.ts';
import { CUP_MENU_EVENT, menuIdentity, coverNativeMenu } from './native-cup-menu.ts';
import { VERSION } from './cup.ts';
import type { Controller } from './controller.ts';
import type { AccountUI } from './account-ui.ts';
import css from './cup-hub.css';
import { RankedRoom } from './ranked-room.ts';
import { RankedQueueUI } from './ranked-queue-ui.ts';
import { RankedReconnectUI } from './ranked-reconnect-ui.ts';
import { CupGuide } from './cup-guide.ts';

export class CupHub {
  #dialog = h('dialog', undefined, 'cup-hub');
  #social = h('aside', undefined, 'hub-social');
  #list = h('div', undefined, 'hub-list');
  #error = h('p', undefined, 'error');
  #online = h('span', 'Online: —', 'hub-online-count');
  #onlineAt = 0;
  #onlineBusy = false;
  #back = h('button', 'Back', 'quiet hub-back');
  #account: AccountUI;
  #controller: Controller;
  #room?: WaitingRoom;
  #handoff?: RoomHandoff;
  #reconnectUI?: RankedReconnectUI;
  #rows: WaitingRoomListing[] = [];
  #entered: () => void;
  #timer?: ReturnType<typeof setInterval>;
  #busy = false;
  #refreshing = false;
  #restored = false;
  #rankedOpening = false;
  #resultUI?: RankedResultUI;
  #notifications?: RankedNotifications;
  #settlement?: RankedSettlement;
  #inputOutbox?: RankedInputOutbox;
  #leaderboard?: LeaderboardUI;
  #resultShown = new Set<string>();
  #rankedBefore: { match: string; player: string; profile: RankedProfile | null } | null = null;
  #rankedEntered = '';
  #guide: CupGuide;
  get isOpen() {
    return this.#dialog.open;
  }
  get room() {
    return this.#room;
  }
  constructor(shadow: ShadowRoot, account: AccountUI, controller: Controller, entered: () => void) {
    this.#account = account;
    this.#guide = new CupGuide(shadow);
    account.setSignOutAllowed(() => !this.#room?.requiresAccount && !account.account?.queue.active);
    this.#controller = controller;
    this.#entered = entered;
    if (account.account) {
      this.#notifications = new RankedNotifications(
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        localStorage,
        () =>
          !document.hidden &&
          !this.#resultUI?.isOpen &&
          !controller.nativeState &&
          !this.#room?.snapshot &&
          !account.account?.queue.active &&
          !shadow.querySelector('dialog[open]:not(.cup-hub):not(.account-embedded)'),
        (match, player, before) => this.#resultUI?.open(match, player, before),
      );
      setInterval(() => {
        this.#resultUI?.checkUser();
        void this.#notifications?.tick();
      }, 2000);
      window.addEventListener('online', () => this.#notifications?.wake());
      this.#settlement = new RankedSettlement(
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        localStorage,
        () => {
          account.account?.queue.invalidateProfile();
          this.#leaderboard?.invalidate();
          void account.account?.queue.refresh();
          this.#notifications?.wake();
        },
      );
      setInterval(() => void this.#settlement?.flush(), 5000);
      this.#inputOutbox = new RankedInputOutbox(
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        localStorage,
      );
      setInterval(() => void this.#inputOutbox?.flush(), 5000);
    }
    if (account.account)
      this.#resultUI = new RankedResultUI(
        shadow,
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        (id) => account.openHistory(id, 'Your matches'),
        {
          claim: (match, player) => this.#notifications!.claim(match, player),
          seen: (match, player) => this.#notifications!.seen(match, player),
          closed: (seen) => {
            setTimeout(() => {
              if (!this.#resultUI?.isOpen) {
                if (seen) this.#notifications?.wake();
                else this.#notifications?.snooze();
              }
            }, 0);
          },
        },
      );
    account.setInviteJoin(async (code) => {
      if (account.account?.queue.active)
        throw new Error('Leave ranked before joining an invitation.');
      if (this.#room?.snapshot)
        throw new Error('Leave your current Cup before joining an invitation.');
      await this.#ensure().joinCode(code, menuIdentity());
      account.close();
      this.#enter();
    });
    shadow.append(h('style', css), this.#dialog);
    this.#dialog.setAttribute('aria-label', 'PolyCup');
    const header = h('header', undefined, 'hub-header');
    header.append(h('h1', 'PolyCup'));
    this.#online.title =
      'Signed-in PolyCup players active in the last 90 seconds. Each account counts once.';
    this.#online.setAttribute('aria-label', 'Online players unavailable');
    header.append(this.#online);
    if (account.account) {
      const board = new LeaderboardUI(
        shadow,
        account.account.ranked,
        () => account.account?.user?.id ?? null,
        (id, name) => account.openHistory(id, name),
      );
      this.#leaderboard = board;
    }

    this.#back.type = 'button';
    this.#back.addEventListener('click', () => this.close());
    const content = h('div', undefined, 'hub-content'),
      main = h('main', undefined, 'hub-main');
    const actions = h('div', undefined, 'hub-actions');
    const codeForm = h('form', undefined, 'hub-code'),
      code = h('input');
    code.placeholder = 'Room code';
    code.maxLength = 10;
    code.setAttribute('aria-label', 'Room code');
    const join = this.#button('Join', () => {});
    join.dataset.cupAdmission = '';
    join.type = 'submit';
    codeForm.append(code, join);
    codeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#act(async () => {
        await this.#ensure().joinCode(code.value, menuIdentity());
        this.#enter();
      }, 'join');
    });
    actions.append(codeForm);
    header.append(actions);
    const footer = h('form', undefined, 'hub-host'),
      name = h('input');
    name.placeholder = 'Cup name';
    name.id = 'polycup-host-name';
    name.value = 'Simple Cup';
    name.maxLength = 64;
    name.setAttribute('aria-label', 'Cup name');
    const host = this.#button('Host Cup', () => {});
    host.dataset.cupAdmission = '';
    host.className = 'primary';
    host.type = 'submit';
    const nameLabel = h('label', 'Cup name', 'hub-activity-title');
    nameLabel.htmlFor = name.id;
    footer.append(nameLabel, name, host);
    footer.addEventListener('submit', (event) => {
      event.preventDefault();
      const dialog = h('dialog', undefined, 'rules-dialog create-cup-dialog');
      dialog.setAttribute('aria-label', 'Host Cup');
      dialog.append(h('h2', 'Host Cup'));
      const choices = h('fieldset', undefined, 'cup-visibility');
      choices.append(h('legend', 'Visibility'));
      let isPublic = false;
      for (const [label, value] of [
        ['Private', false],
        ['Public', true],
      ] as const) {
        const option = h('label'),
          radio = h('input');
        radio.type = 'radio';
        radio.name = 'cup-visibility';
        radio.value = label.toLowerCase();
        radio.checked = !value;
        radio.onchange = () => {
          isPublic = value;
        };
        option.append(radio, h('span', label));
        choices.append(option);
      }
      dialog.append(choices);
      const controls = h('div', undefined, 'controls');
      const cancel = h('button', 'Cancel', 'quiet');
      cancel.type = 'button';
      cancel.onclick = () => dialog.close();
      const create = h('button', 'Create Cup', 'primary');
      create.type = 'button';
      create.onclick = () => {
        dialog.close();
        void this.#act(async () => {
          if (controller.connection)
            throw new Error('Leave your current multiplayer game before hosting a Cup.');
          await this.#ensure().create(name.value, menuIdentity(), isPublic);
          this.#enter();
        }, 'create');
      };
      controls.append(cancel, create);
      dialog.append(controls);
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      shadow.append(dialog);
      dialog.showModal();
    });
    this.#error.hidden = true;
    this.#error.setAttribute('role', 'alert');
    this.#list.setAttribute('aria-label', 'Public Cups');
    const listHeader = h('div', undefined, 'hub-list-header');
    listHeader.append(
      h('h2', 'Public Cups'),
      this.#button('Refresh', () => this.refresh(), true),
    );
    const activities = h('div', undefined, 'hub-activities');
    activities.setAttribute('aria-label', 'Cup activities');
    activities.append(footer);
    main.append(this.#error, listHeader, this.#list, activities);
    if (account.account) {
      const queue = account.account.queue;
      const queueUI = new RankedQueueUI(
        shadow,
        queue,
        () =>
          controller.connection
            ? 'Leave your multiplayer game before joining ranked.'
            : this.#room?.snapshot
              ? 'Leave your current Cup before joining ranked.'
              : null,
        () => {
          if (this.#room?.ranked && this.#room.snapshot && !this.#room.disconnected) this.#enter();
          else if (queue.snapshot?.match) void this.#enterRanked(queue.snapshot.match.id);
        },
        () => this.#leaderboard?.open(),
        () => this.#guide.ranks(),
      );
      activities.append(queueUI.element);
      this.#reconnectUI = new RankedReconnectUI(
        shadow,
        queue,
        () =>
          this.#dialog.open &&
          !this.#rankedOpening &&
          (!this.#room?.snapshot || !!this.#room.disconnected),
        () => {
          const match = queue.snapshot?.match;
          if (match) void this.#enterRanked(match.id);
        },
      );
      queue.subscribe(() => {
        const match = queue.snapshot?.match;
        if (
          match &&
          !match.left &&
          !match.abandoned &&
          match.status === 'drafting' &&
          !queue.confirmingAcceptance &&
          this.#rankedEntered !== match.id &&
          !this.#rankedOpening
        )
          void this.#enterRanked(match.id);
        if (!match) this.#rankedEntered = '';
        for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>(
          '[data-cup-admission]',
        ))
          button.disabled = queue.active || this.#busy || button.dataset.incompatible === 'true';
      });
    }
    content.append(this.#social, main);
    this.#dialog.append(header, content);
    this.#dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
    window.addEventListener(CUP_MENU_EVENT, () => this.open());
  }
  async #enterRanked(id: string) {
    if (this.#rankedOpening) return;
    const account = this.#account.account!;
    this.#rankedOpening = true;
    this.#reconnectUI?.close();
    const player = account.user?.id;
    if (player) {
      this.#rankedBefore = { match: id, player, profile: null };
      void account.ranked
        .profile(player)
        .then((profile) => {
          if (this.#rankedBefore?.match === id && this.#rankedBefore.player === player) {
            this.#rankedBefore.profile = profile;
            this.#notifications?.rememberBefore(id, player, profile);
          }
        })
        .catch(() => {});
    }
    try {
      const room = new RankedRoom(account.directory, account.ranked, id, account.queue.instance, {
        list: () => this.#controller.availableTracks(),
        parse: () => {
          throw new Error('Custom tracks unavailable in ranked.');
        },
      });
      this.#handoff?.dispose();
      room.setInputHandler((item) => this.#inputOutbox?.enqueue(item));
      this.#room?.dismiss();
      this.#room = room;
      this.#controller.attachWaitingRoom(room, new WaitingRoomChat(room));
      this.#handoff = new RoomHandoff(room, controllerRaceBridge(this.#controller));
      let entered = false,
        observedDisconnected = false;
      room.subscribe(() => {
        if (entered && room.disconnected && room.snapshot && !observedDisconnected) {
          observedDisconnected = true;
          this.#controller.requestPanel(false);
          this.open();
        }
        if (entered && !room.snapshot) {
          this.#controller.releaseCup('Ranked Cup ended');
          this.#controller.requestPanel(false);
          this.open();
          if (this.#resultShown.has(id)) this.#resultUI?.reopen();
          else if (player)
            void account.ranked
              .resultStatus(id)
              .then((status) => {
                if (status && ['review', 'completed'].includes(status.status)) {
                  this.#resultShown.add(id);
                  this.#resultUI?.open(id, player, this.#rankedBefore?.profile ?? null);
                  account.queue.invalidateProfile();
                }
              })
              .catch(() => {});
          void account.queue.refresh();
        }
      });
      await room.enter(menuIdentity());
      if (!room.snapshot) throw new Error('This ranked match ended.');
      entered = true;
      this.#rankedEntered = id;
      this.#enter();
    } catch (e) {
      this.#controller.requestPanel(false);
      this.open();
      this.#error.textContent = `Could not open ranked Cup: ${(e as Error).message} Use Ranked match to retry.`;
      this.#error.hidden = false;
    } finally {
      this.#rankedOpening = false;
      this.#reconnectUI?.render();
    }
  }
  #ensure() {
    if (this.#room && !this.#room.ranked) return this.#room;
    if (!this.#account.account)
      throw new Error('Browser storage is unavailable. Enable it to host or join a Cup.');
    const c = this.#controller;
    this.#handoff?.dispose();
    const room = (this.#room = new WaitingRoom(this.#account.account.directory, {
      list: () => c.availableTracks(),
      parse: (code) => {
        const track = c.native.parse(code);
        if (!track?.trackData.hasStartingPoint())
          throw new Error('The track needs a starting point.');
        const id = track.trackData.getId();
        return {
          id,
          name: track.trackMetadata.name,
          category: c.native.trackLibrary?.isOfficialTrack(id)
            ? 'official'
            : c.native.trackLibrary?.isCommunityTrack(id)
              ? 'community'
              : 'custom',
        };
      },
    }));
    c.attachWaitingRoom(room, new WaitingRoomChat(room));
    this.#handoff = new RoomHandoff(room, controllerRaceBridge(c));
    let wasInRoom = false;
    room.subscribe(() => {
      if (wasInRoom && !room.snapshot) {
        c.requestPanel(false);
        this.open();
      }
      wasInRoom = !!room.snapshot;
    });
    return room;
  }
  #button(text: string, run: () => unknown, independent = false) {
    const button = h('button', text, 'quiet');
    button.type = 'button';
    button.addEventListener('click', () => {
      if (button.type !== 'submit') {
        if (independent)
          void Promise.resolve(run()).catch((error) => {
            this.#error.textContent = (error as Error).message;
            this.#error.hidden = false;
          });
        else void this.#act(run);
      }
    });
    return button;
  }
  async #act(run: () => unknown, activity?: 'create' | 'join') {
    if (this.#busy) return;
    this.#busy = true;
    this.#error.hidden = true;
    const labels = new Map<HTMLButtonElement, string>();
    const active = (this.#dialog.getRootNode() as ShadowRoot).activeElement;
    for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>(
      '.hub-list-header button, .hub-host button, .hub-room button, .hub-actions button',
    )) {
      labels.set(button, button.textContent ?? '');
      button.disabled = true;
      if ((activity === 'join' || button === active) && button.textContent === 'Join')
        button.textContent = 'Joining…';
      else if (activity === 'create' && button.textContent === 'Host Cup')
        button.textContent = 'Creating…';
    }
    try {
      await run();
    } catch (e) {
      this.#error.textContent = (e as Error).message;
      this.#error.hidden = false;
    } finally {
      this.#busy = false;
      for (const [button, label] of labels) button.textContent = label;
      for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>(
        '.hub-list-header button, .hub-host button, .hub-room button, .hub-actions button',
      ))
        button.disabled = false;
      this.#renderRows();
    }
  }
  #enter() {
    this.close();
    this.#entered();
  }
  open() {
    if (this.#room?.snapshot && !this.#room.disconnected) {
      this.#entered();
      return;
    }
    if (!this.#dialog.open) this.#dialog.showModal();
    this.#resultUI?.reopen();
    this.#notifications?.wake();
    coverNativeMenu(true);
    this.#account.mount(this.#social, this.#back);
    this.#account.account?.queue.setVisible(true);
    this.#reconnectUI?.render();
    if (!this.#account.account?.queue.active && !this.#resultUI?.isOpen) this.#guide.welcome();
    void this.#act(async () => {
      const room = this.#room ?? this.#ensure();
      if (!this.#restored && !room.ranked) {
        this.#restored = true;
        await room.restore(menuIdentity());
        if (room.snapshot) {
          this.#enter();
          return;
        }
      }
      await this.refresh();
    });
    clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      if (!this.#busy)
        void this.refresh().catch(() => {
          if (!this.#dialog.open) return;
          this.#error.textContent =
            'Could not refresh public Cups. Your room code and hosting controls are still available.';
          this.#error.hidden = false;
        });
    }, 15000);
  }
  close() {
    this.#reconnectUI?.close();
    this.#guide.close();
    this.#account.account?.queue.setVisible(false);
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#account.unmount();
    this.#dialog.close();
    coverNativeMenu(false);
  }
  async refresh() {
    if (this.#refreshing) return;
    if (this.#dialog.open && !this.#onlineBusy && Date.now() - this.#onlineAt >= 30000) {
      const api = this.#account.account?.ranked;
      if (api) {
        this.#onlineBusy = true;
        this.#onlineAt = Date.now();
        void api
          .onlineCount()
          .then((count) => {
            if (!Number.isSafeInteger(count) || count < 0)
              throw new Error('Invalid presence count');
            this.#online.textContent = `${count} online`;
            this.#online.setAttribute('aria-label', `${count} players online`);
            this.#online.classList.add('available');
          })
          .catch(() => {
            this.#online.textContent = 'Online: —';
            this.#online.setAttribute('aria-label', 'Online players unavailable');
            this.#online.classList.remove('available');
          })
          .finally(() => {
            this.#onlineBusy = false;
          });
      }
    }
    this.#refreshing = true;
    const button = this.#dialog.querySelector<HTMLButtonElement>('.hub-list-header button');
    if (button) {
      button.disabled = true;
      button.textContent = 'Refreshing…';
    }
    try {
      // Listing rooms must not replace a ranked room whose initial request is
      // still in flight. That would detach its handoff before the draft opens.
      this.#rows = await (this.#room ?? this.#ensure()).listings();
      this.#renderRows();
    } finally {
      this.#refreshing = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Refresh';
      }
    }
  }
  update() {
    const state = this.#controller.nativeState,
      before = this.#rankedBefore;
    if (
      this.#room?.ranked &&
      state?.phase === 'complete' &&
      before?.match === state.id &&
      this.#account.account?.user?.id === before.player &&
      !this.#resultShown.has(state.id)
    ) {
      try {
        this.#settlement?.enqueue((this.#room as RankedRoom).resultTranscript(state));
      } catch (e) {
        this.#error.textContent = (e as Error).message;
        this.#error.hidden = false;
        if (/recorded finish|omitted your/.test((e as Error).message)) {
          this.#resultShown.add(state.id);
          const account = this.#account.account!;
          void account.ranked.rejectResult(state.id, account.queue.instance).catch(() => {});
          this.#resultUI?.showIssue(
            'The result differs from your recorded finishes. No rating change has been confirmed.',
          );
        }
        return;
      }
      this.#resultShown.add(state.id);
      this.#resultUI?.open(state.id, before.player, before.profile);
    }
  }
  #renderRows() {
    this.#list.replaceChildren();
    const rows = this.#rows;
    this.#list.classList.toggle('is-empty', !rows.length);
    if (!rows.length) {
      const empty = h('div', undefined, 'hub-empty');
      empty.append(
        h('h3', 'No public Cups available'),
        h('p', 'Host your own Cup or join an existing one using a room code.'),
      );
      this.#list.append(empty);
    }
    for (const row of rows) {
      const element = h('article', undefined, 'hub-room'),
        identity = h('div', undefined, 'hub-room-identity');
      identity.append(h('strong', row.title), h('small', row.host_name));
      const phase = h(
        'span',
        row.phase === 'racing'
          ? 'Racing'
          : ['bans', 'picks'].includes(row.phase)
            ? 'Drafting'
            : 'Waiting',
        'hub-phase',
      );
      const join = this.#button(
        row.version !== VERSION ? 'Update mod' : row.players >= 16 ? 'Full' : 'Join',
        async () => {
          if (this.#controller.connection)
            throw new Error('Leave your current multiplayer game before joining a Cup.');
          await this.#ensure().join(row.id, menuIdentity());
          this.#enter();
        },
      );
      join.disabled = this.#busy || row.version !== VERSION || row.players >= 16;
      join.dataset.cupAdmission = '';
      join.dataset.incompatible = String(row.version !== VERSION || row.players >= 16);
      join.disabled ||= !!this.#account.account?.queue.active;
      element.append(identity, phase, h('span', `${row.players}/16`, 'hub-count'), join);
      this.#list.append(element);
    }
    for (const button of this.#dialog.querySelectorAll<HTMLButtonElement>('[data-cup-admission]'))
      button.disabled ||= !!this.#account.account?.queue.active;
  }
}
