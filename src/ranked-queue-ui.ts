import { statusIcon } from './status-icon.ts';
import { element as h } from './dom.ts';
import type { RankedQueue } from './ranked-queue.ts';
import { VERSION } from './cup.ts';
import { rankBadge } from './rank-badge.ts';
import css from './ranked-queue.css';

export class RankedQueueUI {
  #element = h('section', undefined, 'ranked-queue-bar');
  get element() {
    return this.#element;
  }
  #dialog = h('dialog', undefined, 'ranked-match-dialog');
  #clock?: ReturnType<typeof setInterval>;
  #deadline = h('span', undefined, 'ranked-match-deadline');
  constructor(
    shadow: ShadowRoot,
    private queue: RankedQueue,
    private canJoin: () => string | null,
    private openMatch?: () => void,
    private openLeaderboard?: () => void,
    private openGuide?: () => void,
  ) {
    shadow.append(h('style', css), this.#dialog);
    this.#dialog.setAttribute('aria-label', 'Ranked match');
    this.element.setAttribute('aria-label', 'Ranked queue');
    this.#dialog.addEventListener('cancel', (e) => e.preventDefault());
    queue.subscribe(() => this.render());
    this.render();
  }
  #button(label: string, run: () => void, disabled = false) {
    const button = h('button', label, 'quiet');
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = run;
    return button;
  }
  render() {
    const q = this.queue,
      match = q.snapshot?.match;
    const confirming = !!match && q.confirmingAcceptance;
    const identity = h('div', undefined, 'ranked-queue-identity');
    const fallback = !q.signedIn
      ? 'Unranked'
      : q.profileState === 'loading'
        ? 'Loading…'
        : q.profileState === 'error'
          ? 'Rank unavailable'
          : 'Unranked';
    const title = h('h2', 'Ranked');
    if (this.openGuide) {
      const help = this.#button('?', this.openGuide);
      help.className = 'ranked-guide-button';
      help.setAttribute('aria-label', 'Ranked tiers');
      help.setAttribute('aria-haspopup', 'dialog');
      title.append(help);
    }
    identity.append(title, rankBadge(q.profile, fallback));
    if (q.signedIn) {
      const stats = h('div', undefined, 'ranked-player-stats');
      const matches = q.stats?.matches ?? q.profile?.rated_matches;
      const rate = q.stats?.win_rate;
      stats.title = 'Completed rated Cups. Wins are first-place finishes.';
      stats.append(
        h('span', `${matches ?? '—'} ${matches === 1 ? 'match' : 'matches'}`),
        h('span', `${rate == null ? '—' : `${Number(rate.toFixed(1))}%`} win rate`),
      );
      identity.append(stats);
    }
    const controls = h('div', undefined, 'ranked-queue-controls');
    this.element.replaceChildren(identity);
    if (this.openLeaderboard) {
      const board = this.#button('Leaderboards', this.openLeaderboard);
      board.classList.add('ranked-leaderboard');
      board.setAttribute('aria-haspopup', 'dialog');
      this.element.append(board);
    }
    this.element.append(controls);
    if (match?.abandoned)
      controls.append(h('span', 'Abandoned · confirming result', 'ranked-queue-message'));
    else if (match?.host_disconnected)
      controls.append(h('span', 'Host disconnected · waiting for result', 'ranked-queue-message'));
    else if (match)
      controls.append(
        this.#button(match.reconnect_until ? 'Reconnect' : 'Ranked match', () => {
          if (confirming) return;
          if (match.status !== 'reserved' && this.openMatch) {
            this.openMatch();
            return;
          }
          if (!this.#dialog.open) this.#dialog.showModal();
        }),
      );
    if (match?.reconnect_until && !match.abandoned && !match.host_disconnected) {
      const seconds = Math.max(
        0,
        Math.ceil((Date.parse(match.reconnect_until) - Date.now()) / 1000),
      );
      controls.append(
        h(
          'span',
          `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} to reconnect`,
          'ranked-queue-message',
        ),
      );
    } else if (!match && q.active)
      controls.append(
        h('span', `${q.info?.waiting ?? 0} waiting`),
        this.#button('Cancel', () => void q.act('cancel'), q.busy),
      );
    else if (!match) {
      const reason = !q.signedIn ? 'Sign in with Discord to play ranked.' : this.canJoin();
      const button = this.#button(
        q.info?.version && q.info.version !== VERSION ? 'Update for ranked' : 'Find ranked',
        () => void q.act('join'),
        q.busy || !!reason || !q.info?.enabled || q.info.version !== VERSION,
      );
      button.className = 'primary';
      button.title =
        reason || (!q.info?.enabled ? 'Ranked is not available yet.' : 'Find a ranked Cup');
      if (q.info?.enabled)
        controls.append(h('span', `${q.info.waiting} waiting`, 'ranked-queue-count'));
      controls.append(button);
      const unavailable =
        reason ||
        (!q.info
          ? 'Checking ranked availability…'
          : q.info.version !== VERSION
            ? 'Update PolyCup to play ranked.'
            : !q.info.enabled
              ? 'Ranked is not available yet.'
              : '');
      if (unavailable)
        controls.append(h('span', unavailable, 'ranked-queue-message ranked-queue-help'));
    }
    if (q.error || q.notice) {
      const text = h('span', q.error || q.notice, 'ranked-queue-message');
      text.setAttribute('role', q.error ? 'alert' : 'status');
      controls.append(text);
    }
    if (!match || (match.status !== 'reserved' && !confirming)) {
      clearInterval(this.#clock);
      this.#clock = undefined;
      this.#dialog.close();
      return;
    }
    const focus = this.#dialog.querySelector<HTMLButtonElement>(':focus')?.dataset.action;
    const accepted = !!match.players.find((p) => p.id === match.self)?.accepted;
    const header = h('header');
    header.append(
      h(
        'h2',
        confirming
          ? 'All players accepted'
          : match.status === 'reserved'
            ? accepted
              ? 'Waiting for other players'
              : 'Match found'
            : 'Ranked lobby',
      ),
    );
    if (match.status === 'reserved') {
      const tick = () => {
        const deadline = this.queue.snapshot?.match?.deadline;
        const seconds = deadline
          ? Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000))
          : 0;
        this.#deadline.textContent = seconds ? `${seconds}s remaining` : 'Checking acceptance…';
      };
      tick();
      header.append(this.#deadline);
      if (!this.#clock) this.#clock = setInterval(tick, 1000);
    } else {
      clearInterval(this.#clock);
      this.#clock = undefined;
    }
    const body = h('div', undefined, 'ranked-match-body');
    if (match.status === 'reserved' || confirming) {
      const ready = match.players.filter((p) => p.accepted).length;
      const indicators = h('div', undefined, 'ranked-match-ready');
      indicators.setAttribute('aria-label', `${ready} of ${match.players.length} players accepted`);
      for (const player of match.players) {
        const mark = h('span', undefined, player.accepted ? 'is-ready' : '');
        mark.append(statusIcon(player.accepted ? 'check' : 'waiting'));
        mark.title = player.accepted ? 'Accepted' : 'Waiting';
        mark.setAttribute('aria-hidden', 'true');
        indicators.append(mark);
      }
      body.append(
        indicators,
        h('p', `${ready}/${match.players.length} accepted`, 'ranked-match-progress'),
      );
    } else {
      const list = h('div', undefined, 'ranked-match-roster');
      for (const p of match.players) {
        const row = h('div', undefined, 'ranked-match-racer');
        row.append(
          h('span', p.name),
          h('span', p.online ? 'Ready' : 'Disconnected', p.online ? 'is-ready' : ''),
        );
        list.append(row);
      }
      body.append(
        list,
        h(
          'p',
          'Match formed. Ranked drafting and racing are not available in this local build.',
          'ranked-match-stage',
        ),
      );
    }
    if (q.error) {
      const error = h('p', q.error, 'ranked-queue-message');
      error.setAttribute('role', 'alert');
      body.append(error);
    }
    const footer = h('footer');
    if (confirming) {
      footer.append(h('span', 'Opening draft…', 'ranked-match-progress'));
    } else if (match.status === 'reserved') {
      const accept = this.#button(
        accepted ? 'Accepted' : 'Accept',
        () => void q.act('accept'),
        q.busy || accepted || !!this.canJoin(),
      );
      accept.dataset.action = 'accept';
      accept.className = 'primary';
      const decline = this.#button('Decline', () => void q.act('decline'), q.busy);
      decline.dataset.action = 'decline';
      footer.append(decline, accept);
    } else {
      const leave = this.#button(
        'Leave match',
        () => void q.act('leave-match'),
        q.busy || !match.can_leave,
      );
      leave.dataset.action = 'leave';
      footer.append(leave);
    }
    this.#dialog.replaceChildren(header, body, footer);
    if (!this.#dialog.open) this.#dialog.showModal();
    if (focus)
      this.#dialog.querySelector<HTMLButtonElement>(`button[data-action="${focus}"]`)?.focus();
  }
}
