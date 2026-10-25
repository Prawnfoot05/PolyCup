import { element as h } from './dom.ts';
import type { Ranked, LeaderboardEntry } from './ranked.ts';
import { rankBadge } from './rank-badge.ts';
import css from './leaderboard.css';
import rankCSS from './ranked-queue.css';
import { profilePicture, profilePictureCSS } from './profile-picture.ts';
type Tab = 'global' | 'friends';
type Entry = LeaderboardEntry & { friend_position?: number };
const PAGE = 25;
export class LeaderboardUI {
  #dialog = h('dialog', undefined, 'cup-leaderboard');
  #body = h('div', undefined, 'leaderboard-body');
  #footer = h('footer');
  #tabs = h('nav', undefined, 'leaderboard-tabs');
  #tab: Tab = 'global';
  #page = 0;
  #generation = 0;
  #cache = new Map<string, { at: number; rows: Entry[] }>();
  constructor(
    shadow: ShadowRoot,
    private api: Ranked,
    private user: () => string | null,
    private history: (id: string, name: string) => void,
  ) {
    const header = h('header');
    header.append(
      h('h2', 'Leaderboards'),
      this.#button('×', () => this.#dialog.close(), 'Close leaderboards'),
    );
    this.#dialog.setAttribute('aria-label', 'Leaderboards');
    this.#tabs.setAttribute('role', 'tablist');
    this.#tabs.setAttribute('aria-label', 'Leaderboard scope');
    this.#body.setAttribute('role', 'tabpanel');
    this.#body.id = 'polycup-leaderboard-panel';
    this.#dialog.append(header, this.#tabs, this.#body, this.#footer);
    shadow.append(h('style', rankCSS + css + profilePictureCSS), this.#dialog);
    this.#dialog.addEventListener('close', () => {
      ++this.#generation;
    });
    this.#tabs.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      this.#tab =
        e.key === 'Home'
          ? 'global'
          : e.key === 'End'
            ? 'friends'
            : this.#tab === 'global'
              ? 'friends'
              : 'global';
      this.#page = 0;
      void this.#load();
      this.#tabs.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
    });
  }
  open() {
    this.#page = 0;
    if (!this.#dialog.open) this.#dialog.showModal();
    void this.#load();
  }
  invalidate() {
    this.#cache.clear();
    ++this.#generation;
    if (this.#dialog.open) void this.#load();
  }
  #button(text: string, action: () => void, label?: string) {
    const b = h('button', text, 'quiet');
    b.type = 'button';
    b.onclick = action;
    if (label) b.setAttribute('aria-label', label);
    return b;
  }
  async #load() {
    const generation = ++this.#generation,
      user = this.user(),
      tab = this.#tab,
      page = this.#page;
    this.#tabs.replaceChildren();
    for (const [key, label] of [
      ['global', 'Global'],
      ['friends', 'Friends'],
    ] as const) {
      const button = this.#button(label, () => {
        this.#tab = key;
        this.#page = 0;
        void this.#load();
      });
      button.setAttribute('role', 'tab');
      button.id = 'leaderboard-tab-' + key;
      button.setAttribute('aria-controls', this.#body.id);
      button.setAttribute('aria-selected', String(tab === key));
      button.tabIndex = tab === key ? 0 : -1;
      this.#tabs.append(button);
    }
    this.#body.setAttribute('aria-labelledby', 'leaderboard-tab-' + tab);
    this.#footer.replaceChildren();
    if (tab === 'friends' && !user) {
      this.#body.replaceChildren(
        h('p', 'Sign in with Discord to view your friends’ standings.', 'leaderboard-empty'),
      );
      return;
    }
    const key = (tab === 'friends' ? user : 'public') + ':' + tab + ':' + page,
      cached = this.#cache.get(key);
    this.#body.replaceChildren(h('p', 'Loading…', 'leaderboard-empty'));
    this.#body.setAttribute('aria-busy', 'true');
    try {
      const rows: Entry[] =
        cached && Date.now() - cached.at < 60000
          ? cached.rows
          : await (tab === 'friends'
              ? this.api.friendsLeaderboard(PAGE + 1, page * PAGE)
              : this.api.leaderboard(PAGE + 1, page * PAGE));
      if (generation !== this.#generation || user !== this.user() || !this.#dialog.open) return;
      this.#cache.set(key, { rows, at: cached?.rows === rows ? cached.at : Date.now() });
      this.#body.replaceChildren();
      if (!rows.length)
        this.#body.append(
          h(
            'p',
            tab === 'friends'
              ? 'No ranked standings among your friends yet.'
              : 'No ranked standings yet.',
            'leaderboard-empty',
          ),
        );
      else {
        const table = h('table');
        const head = h('thead'),
          titles = h('tr');
        for (const label of ['#', 'Player', 'Rank', 'Matches']) titles.append(h('th', label));
        head.append(titles);
        table.append(head);
        const body = h('tbody');
        for (const row of rows.slice(0, PAGE)) {
          const tr = h('tr');
          tr.classList.toggle('is-self', row.player_id === user);
          const position = h(
            'td',
            String(tab === 'friends' ? row.friend_position : row.leaderboard_position),
          );
          position.title = 'Global position ' + row.leaderboard_position;
          const name = h('td');
          name.append(
            this.#button(
              row.display_name,
              () => this.history(row.player_id, row.display_name),
              'Match history for ' + row.display_name,
            ),
          );
          const playerButton = name.querySelector('button')!;
          playerButton.classList.add('player-with-portrait');
          playerButton.replaceChildren(
            profilePicture(row.display_name, row.avatar_url),
            h('span', row.display_name),
          );
          const rank = h('td');
          rank.append(rankBadge({ ...row, provisional: false }));
          tr.append(position, name, rank, h('td', String(row.rated_matches)));
          body.append(tr);
        }
        table.append(body);
        this.#body.append(table);
      }
      const previous = this.#button('Previous', () => {
        --this.#page;
        void this.#load();
      });
      previous.disabled = !page;
      const next = this.#button('Next', () => {
        ++this.#page;
        void this.#load();
      });
      next.disabled = rows.length <= PAGE;
      this.#footer.append(previous, h('span', 'Page ' + (page + 1)), next);
    } catch {
      if (generation !== this.#generation) return;
      this.#body.replaceChildren(
        h('p', 'Standings are unavailable.', 'leaderboard-empty'),
        this.#button('Retry', () => void this.#load()),
      );
    } finally {
      if (generation === this.#generation) this.#body.removeAttribute('aria-busy');
    }
  }
}
