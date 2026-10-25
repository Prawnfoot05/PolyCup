import { element as h } from './dom.ts';
import { discordIdentity } from './account-flow.ts';
import type { Friends, FriendPerson, FriendRelationship } from './friends.ts';
export type FriendsView = 'friends' | 'requests' | 'find';
export class FriendsUI {
  #changed: () => void;
  #query = '';
  #searched = false;
  #error = '';
  #notice = '';
  #selected: string | null = null;
  #menu?: HTMLElement;
  #joinGame?: (code: string) => Promise<void>;
  #confirmRemove: string | null = null;
  #view: FriendsView | null = null;
  #inviteRoom?: { id: string; instance: string };
  #sent = new Set<string>();
  constructor(
    changed: () => void,
    private showHistory?: (person: FriendPerson) => void,
  ) {
    this.#changed = changed;
  }
  reset() {
    this.#query = '';
    this.#searched = false;
    this.#error = '';
    this.#notice = '';
    this.#selected = null;
    this.#confirmRemove = null;
    this.#view = null;
  }
  async #act(action: () => void | Promise<void>) {
    this.#error = '';
    this.#notice = '';
    try {
      await action();
    } catch (error) {
      this.#error =
        error instanceof Error ? error.message : 'That action failed. Please try again.';
    }
    this.#changed();
  }
  #button(label: string, action: () => void | Promise<void>, disabled = false, primary = false) {
    const button = h('button', label, primary ? 'primary' : 'quiet');
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = () => {
      void this.#act(action);
    };
    return button;
  }
  render(
    friends: Friends,
    view: FriendsView,
    inviteRoom?: { id: string; instance: string },
    joinInvite?: (code: string) => Promise<void>,
  ) {
    this.#joinGame = joinInvite;
    if (this.#inviteRoom?.id !== inviteRoom?.id) this.#sent.clear();
    this.#inviteRoom = inviteRoom;
    if (this.#view !== view) {
      this.#error = '';
      this.#notice = '';
      this.#view = view;
    }
    const root = h('section', undefined, 'friends-content');
    root.setAttribute('aria-label', 'Friends');
    if (this.#error) {
      const error = h('p', this.#error, 'account-error');
      error.setAttribute('role', 'alert');
      root.append(error);
    }
    if (this.#notice) {
      const notice = h('p', this.#notice, 'account-saved');
      notice.setAttribute('role', 'status');
      root.append(notice);
    }
    if (friends.error)
      root.append(
        h('p', friends.error, 'account-error'),
        this.#button('Retry', () => friends.refresh()),
      );
    if (view === 'find') {
      const form = h('form', undefined, 'friend-search');
      const input = h('input');
      input.id = 'polycup-friend-search';
      input.setAttribute('aria-label', 'Player name or friend code');
      input.value = this.#query;
      input.placeholder = 'Name or friend code';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.maxLength = 128;
      input.oninput = () => {
        this.#query = input.value;
      };
      const submit = h('button', friends.searching ? 'Searching…' : 'Search', 'primary');
      submit.type = 'submit';
      submit.disabled = friends.searching;
      form.onsubmit = (e) => {
        e.preventDefault();
        void this.#act(async () => {
          this.#searched = true;
          await friends.search(this.#query);
        });
      };
      form.append(input, submit);
      root.append(form);
      if (this.#searched && !friends.searching && !this.#error && !friends.results.length)
        root.append(h('p', 'No players found.', 'account-note'));
      for (const person of friends.results)
        root.append(
          this.#row(
            friends,
            person,
            friends.rows.find((r) => r.player_id === person.player_id),
          ),
        );
      if (friends.results.length === 20)
        root.append(
          h(
            'p',
            'Showing the first 20 matches. Use a longer name or an exact friend code.',
            'account-note',
          ),
        );
    } else if (view === 'requests') {
      const incoming = friends.rows.filter(
        (r) => r.status === 'pending' && r.direction === 'incoming',
      );
      const outgoing = friends.rows.filter(
        (r) => r.status === 'pending' && r.direction === 'outgoing',
      );
      for (const [label, rows] of [
        ['Received', incoming],
        ['Sent', outgoing],
      ] as const) {
        const group = h('section', undefined, 'friend-request-group');
        group.setAttribute('aria-label', label);
        const heading = h('h4', `${label} (${rows.length})`, 'friend-group-title');
        group.append(heading);
        rows.forEach((row) => group.append(this.#row(friends, row, row)));
        root.append(group);
      }
    } else {
      if (friends.invites.length) {
        root.append(h('h4', `Invitations (${friends.invites.length})`, 'friend-group-title'));
        for (const invite of friends.invites) {
          const row = h('article', undefined, 'friend-row');
          row.append(
            h('div', invite.room_title, 'friend-invite-title'),
            h('div', invite.sender_name, 'friend-username'),
          );
          const actions = h('div', undefined, 'friend-actions');
          actions.append(
            this.#button(
              'Join',
              async () => {
                if (!joinInvite) throw new Error('Open the server finder to join this Cup.');
                await joinInvite(invite.code);
                await friends.dismissInvite(invite.id);
              },
              friends.working,
              true,
            ),
            this.#button('Dismiss', () => friends.dismissInvite(invite.id), friends.working),
          );
          row.append(actions);
          root.append(row);
        }
      }
      const accepted = friends.rows
        .filter((r) => r.status === 'accepted')
        .sort(
          (a, b) =>
            (friends.fresh ? Number(b.online) - Number(a.online) : 0) ||
            a.display_name.localeCompare(b.display_name) ||
            a.player_id.localeCompare(b.player_id),
        );
      const groups = friends.fresh
        ? ([
            ['Online', accepted.filter((r) => r.online)],
            ['Offline', accepted.filter((r) => !r.online)],
          ] as const)
        : ([['Status unavailable', accepted]] as const);
      for (const [label, rows] of groups) {
        root.append(h('h4', `${label} (${rows.length})`, 'friend-group-title'));
        rows.forEach((row) => root.append(this.#row(friends, row, row)));
      }
    }
    return root;
  }
  #row(friends: Friends, person: FriendPerson, relation?: FriendRelationship) {
    const row = h('article', undefined, 'friend-row');
    row.dataset.playerId = person.player_id;
    const head = h('div', undefined, 'friend-row-heading');
    const portrait = h(
      'span',
      Array.from(person.display_name)[0]?.toUpperCase() || '?',
      'friend-avatar',
    );
    const avatar = discordIdentity({ avatar_url: person.avatar_url }).avatar;
    if (avatar) {
      const img = h('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = avatar;
      img.onerror = () => img.remove();
      portrait.append(img);
    }
    const name = h('span', person.display_name, 'friend-name');
    const chevron = this.#button('', () => {
      this.#selected = this.#selected === person.player_id ? null : person.player_id;
      this.#confirmRemove = null;
    });
    chevron.className = 'friend-menu-toggle';
    chevron.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4"/></svg>';
    chevron.id = 'friend-menu-' + person.player_id;
    chevron.setAttribute('aria-label', 'Actions for ' + person.display_name);
    chevron.setAttribute('aria-haspopup', 'menu');
    chevron.setAttribute('aria-expanded', String(this.#selected === person.player_id));
    const labels = h('div', undefined, 'friend-labels'),
      nameLine = h('div', undefined, 'friend-name-line');
    nameLine.append(name, chevron);
    labels.append(nameLine);
    if (person.discord_username && relation?.status !== 'accepted')
      labels.append(h('span', `@${person.discord_username}`, 'friend-username'));
    head.append(portrait, labels);
    if (relation?.status === 'accepted') {
      const status = h(
        'span',
        friends.fresh
          ? relation.activity === 'racing'
            ? 'In game'
            : relation.activity === 'lobby'
              ? 'In lobby'
              : relation.online
                ? 'Online'
                : 'Offline'
          : 'Unavailable',
        `friend-status ${friends.fresh && relation.online ? 'is-online' : ''}`,
      );
      status.title = status.textContent ?? '';
      labels.append(status);
    }
    row.append(head);
    const controls = h('div', undefined, 'friend-actions');
    if (relation?.status === 'accepted' && this.#inviteRoom) {
      const room = this.#inviteRoom;
      controls.append(
        this.#button(
          this.#sent.has(person.player_id) ? 'Invited' : 'Invite',
          async () => {
            await friends.invite(person.player_id, room.id, room.instance);
            this.#sent.add(person.player_id);
          },
          friends.working || this.#sent.has(person.player_id),
        ),
      );
    }
    if (!relation)
      controls.append(
        this.#button('Add friend', () => friends.request(person.player_id), friends.working, true),
      );
    else if (relation.status === 'pending') {
      if (relation.direction === 'incoming')
        controls.append(
          this.#button(
            'Accept',
            () => friends.accept(relation.friendship_id),
            friends.working,
            true,
          ),
          this.#button(
            'Decline',
            () => friends.remove(relation.friendship_id, 'pending'),
            friends.working,
          ),
        );
      else
        controls.append(
          h('span', 'Request sent', 'account-note'),
          this.#button(
            'Cancel request',
            () => friends.remove(relation.friendship_id, 'pending'),
            friends.working,
          ),
        );
    }
    if (controls.childElementCount) row.append(controls);
    if (this.#selected === person.player_id) {
      const details = h('div', undefined, 'friend-menu');
      details.setAttribute('popover', 'auto');
      details.setAttribute('role', 'menu');
      details.setAttribute('aria-label', person.display_name + ' actions');
      this.#menu = details;
      const close = () => {
        this.#selected = null;
        details.hidePopover();
      };
      const item = (label: string, action: () => void | Promise<void>, disabled = false) => {
        const button = this.#button(
          label,
          async () => {
            close();
            await action();
          },
          disabled,
        );
        button.setAttribute('role', 'menuitem');
        return button;
      };
      if (relation?.status === 'accepted' && relation.can_join && friends.fresh && this.#joinGame)
        details.append(
          item(
            'Join game',
            async () => {
              const code = await friends.gameCode(person.player_id);
              await this.#joinGame!(code);
            },
            friends.working,
          ),
        );
      if (this.showHistory) details.append(item('Match history', () => this.showHistory!(person)));
      details.append(
        item('Copy friend code', async () => {
          await navigator.clipboard.writeText(person.player_id);
          this.#notice = 'Friend code copied.';
        }),
      );
      if (relation?.status === 'accepted') {
        if (this.#confirmRemove === person.player_id)
          details.append(
            h('p', `Remove ${person.display_name} from your friends?`),
            this.#button(
              'Remove',
              async () => {
                await friends.remove(relation.friendship_id, 'accepted');
                this.#confirmRemove = null;
              },
              friends.working,
            ),
            this.#button('Keep friend', () => {
              this.#confirmRemove = null;
            }),
          );
        else
          details.append(
            this.#button(
              'Remove friend',
              () => {
                this.#confirmRemove = person.player_id;
              },
              friends.working,
            ),
          );
      }
      for (const button of details.querySelectorAll('button'))
        button.setAttribute('role', 'menuitem');
      details.addEventListener('toggle', () => {
        if (!details.matches(':popover-open') && this.#menu === details) {
          this.#selected = null;
          this.#confirmRemove = null;
          chevron.setAttribute('aria-expanded', 'false');
        }
      });
      details.addEventListener('keydown', (event) => {
        const buttons = [...details.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],
          index = buttons.indexOf(details.querySelector(':focus') as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          buttons[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
          ]?.focus();
        }
      });
      row.append(details);
      requestAnimationFrame(() => {
        if (!details.isConnected || this.#selected !== person.player_id) return;
        details.showPopover();
        const anchor = chevron.getBoundingClientRect(),
          box = details.getBoundingClientRect();
        details.style.left = Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8)) + 'px';
        details.style.top =
          Math.max(8, Math.min(anchor.bottom + 6, innerHeight - box.height - 8)) + 'px';
        details.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      });
    }
    return row;
  }
}
