import { element as h } from './dom.ts';
import type { Ranked, RankedHistoryEntry, RankedMatchResult, InputReview } from './ranked.ts';
import css from './ranked-history.css';
import { profilePicture, profilePictureCSS } from './profile-picture.ts';

const PAGE_SIZE = 20;
const number = (value: number) => value.toLocaleString('en-US');
export function ratingChange(before: number | null, after: number | null): string {
  if (after === null) return '—';
  if (before === null) return 'First rating';
  const delta = after - before;
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${number(Math.abs(delta))}`;
}
export function placing(place: number): string {
  return `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'}`;
}

export class RankedHistoryUI {
  #dialog = h('dialog', undefined, 'ranked-history');
  #title = h('h2', 'Match history');
  #name = h('span', undefined, 'ranked-history-name');
  #body = h('div', undefined, 'ranked-history-body');
  #footer = h('footer');
  #generation = 0;
  #offset = 0;
  #player = '';
  #client?: Ranked;
  #rows: RankedHistoryEntry[] = [];
  #checks: InputReview[] | null = null;
  #reviewError = false;

  constructor(shadow: ShadowRoot) {
    shadow.append(h('style', css + profilePictureCSS));
    const header = h('header');
    const title = h('div');
    title.append(this.#title, this.#name);
    const close = this.#button('×', () => this.close());
    close.setAttribute('aria-label', 'Close match history');
    header.append(title, close);
    this.#title.id = 'polycup-history-title';
    this.#dialog.setAttribute('aria-labelledby', this.#title.id);
    this.#body.setAttribute('aria-live', 'polite');
    this.#dialog.append(header, this.#body, this.#footer);
    this.#dialog.addEventListener('close', () => {
      ++this.#generation;
    });
    this.#dialog.addEventListener('cancel', () => {
      ++this.#generation;
    });
    shadow.append(this.#dialog);
  }

  open(client: Ranked, playerId: string, name: string) {
    this.#client = client;
    this.#player = playerId;
    this.#name.textContent = name;
    this.#offset = 0;
    this.#rows = [];
    if (!this.#dialog.open) this.#dialog.showModal();
    void this.#load();
  }

  close() {
    ++this.#generation;
    this.#dialog.close();
  }

  #button(label: string, action: () => void, disabled = false) {
    const button = h('button', label);
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = action;
    return button;
  }

  #pending() {
    this.#body.replaceChildren(h('p', 'Loading…', 'ranked-history-note'));
    this.#body.setAttribute('aria-busy', 'true');
    this.#footer.replaceChildren();
  }

  #error(retry: () => void) {
    this.#body.setAttribute('aria-busy', 'false');
    const error = h('p', 'Match history is unavailable. Try again.', 'ranked-history-note');
    error.setAttribute('role', 'alert');
    this.#body.replaceChildren(error, this.#button('Retry', retry));
    this.#footer.replaceChildren(
      this.#button('Back', () => (this.#rows.length ? this.#list() : this.close())),
    );
  }

  async #load(offset = this.#offset) {
    const generation = ++this.#generation;
    this.#title.textContent = 'Match history';
    this.#pending();
    try {
      // One extra row determines Next without a separate count query.
      const rows = await this.#client!.history(this.#player, PAGE_SIZE + 1, offset);
      if (generation !== this.#generation || !this.#dialog.open) return;
      this.#rows = rows;
      this.#checks = null;
      this.#reviewError = false;
      try {
        this.#checks = await this.#client!.inputReview(
          rows.slice(0, PAGE_SIZE).map((r) => r.match_id),
          this.#player,
        );
      } catch {
        this.#reviewError = true;
      }
      if (generation !== this.#generation || !this.#dialog.open) return;
      this.#offset = offset;
      this.#list();
    } catch {
      if (generation === this.#generation && this.#dialog.open)
        this.#error(() => void this.#load(offset));
    }
  }

  #list() {
    ++this.#generation;
    this.#title.textContent = 'Match history';
    this.#body.setAttribute('aria-busy', 'false');
    this.#body.replaceChildren();
    if (this.#reviewError)
      this.#body.append(
        h(
          'p',
          'Input review is unavailable. Match results are shown below.',
          'ranked-history-note',
        ),
      );
    if (!this.#rows.length)
      this.#body.append(h('p', 'No rated matches yet.', 'ranked-history-note'));
    else {
      const heading = h('div', undefined, 'ranked-history-columns');
      for (const label of ['Date', 'Place', 'Rating', 'Change']) heading.append(h('span', label));
      this.#body.append(heading);
      for (const row of this.#rows.slice(0, PAGE_SIZE)) {
        const button = this.#button('', () => void this.#details(row.match_id));
        button.className = 'ranked-history-row';
        button.title = 'View match';
        const time = h(
          'time',
          new Date(row.finished_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          }),
        );
        time.dateTime = row.finished_at;
        time.title = new Date(row.finished_at).toLocaleString();
        button.append(
          time,
          h('span', `${placing(row.place)} / ${row.player_count}`),
          h('span', number(row.rating_after)),
          this.#delta(row.rating_before, row.rating_after),
        );
        button.setAttribute(
          'aria-label',
          `View match: ${placing(row.place)} of ${row.player_count}, ${time.title}`,
        );
        this.#body.append(button);
        const flags =
          this.#checks?.filter((c) => c.match_id === row.match_id && c.status === 'flagged') ?? [];
        if (flags.length) {
          button.append(
            h(
              'span',
              `Possible copied inputs detected · ${flags.length} ${flags.length === 1 ? 'run' : 'runs'}`,
              'input-review-flag',
            ),
          );
          button.setAttribute(
            'aria-label',
            button.getAttribute('aria-label') +
              `, possible copied inputs detected in ${flags.length} runs`,
          );
        } else if (this.#checks) {
          const checks = this.#checks.filter((c) => c.match_id === row.match_id);
          const checked = checks.filter((c) => c.status === 'no_match').length;
          button.append(
            h(
              'span',
              checked
                ? `${checked}/${checks.length} finished runs checked · no qualifying reference match`
                : 'Input evidence not fully checked',
              'input-review-status',
            ),
          );
        }
      }
    }
    this.#footer.replaceChildren(
      this.#button(
        'Previous',
        () => {
          void this.#load(Math.max(0, this.#offset - PAGE_SIZE));
        },
        this.#offset === 0,
      ),
      h('span', `Page ${this.#offset / PAGE_SIZE + 1}`),
      this.#button(
        'Next',
        () => {
          void this.#load(this.#offset + PAGE_SIZE);
        },
        this.#rows.length <= PAGE_SIZE,
      ),
    );
  }

  #delta(before: number | null, after: number | null) {
    const span = h('span', ratingChange(before, after), 'ranked-history-change');
    if (before !== null && after !== null)
      span.classList.add(after > before ? 'positive' : after < before ? 'negative' : 'neutral');
    return span;
  }

  async #details(matchId: string) {
    const generation = ++this.#generation;
    this.#pending();
    try {
      const result = await this.#client!.match(matchId);
      if (generation !== this.#generation || !this.#dialog.open) return;
      if (!result) throw new Error('Match unavailable');
      let checks: InputReview[] | null = null,
        reviewError = false;
      try {
        checks = await this.#client!.inputReview([matchId]);
      } catch {
        reviewError = true;
      }
      if (generation !== this.#generation || !this.#dialog.open) return;
      this.#result(result, checks, reviewError);
    } catch {
      if (generation === this.#generation && this.#dialog.open)
        this.#error(() => void this.#details(matchId));
    }
  }

  #result(result: RankedMatchResult, checks: InputReview[] | null = null, reviewError = false) {
    this.#title.textContent = 'Match result';
    this.#body.setAttribute('aria-busy', 'false');
    this.#body.replaceChildren(
      h(
        'p',
        `${result.season ? result.season.name + ' · ' : ''}${new Date(result.finished_at).toLocaleString()} · ${result.rounds} rounds`,
        'ranked-history-note',
      ),
    );
    if (reviewError)
      this.#body.append(h('p', 'Input review is unavailable.', 'ranked-history-note'));
    const reviewSection = h('details', undefined, 'match-input-review');
    reviewSection.append(h('summary', 'Input review'));
    for (const player of result.players) {
      const row = h('div', undefined, 'ranked-result-row');
      row.classList.toggle('is-you', player.player_id === this.#player);
      const playerName = h('span', undefined, 'ranked-result-player player-with-portrait');
      playerName.append(
        profilePicture(player.display_name, player.avatar_url),
        h('span', player.display_name),
      );
      row.append(
        h('span', placing(player.place)),
        playerName,
        h('span', player.rating_after === null ? '—' : number(player.rating_after)),
        this.#delta(player.rating_before, player.rating_after),
      );
      this.#body.append(row);
      if (checks !== null) {
        const runs = checks.filter((c) => c.player_id === player.player_id);
        const group = h('div', undefined, 'input-review-runs');
        group.append(h('p', player.display_name, 'input-review-player'));
        for (const run of runs) {
          if (run.status !== 'flagged') continue;
          const details = h('details'),
            summary = h(
              'summary',
              `Round ${run.round} · Possible copied inputs detected`,
              'input-review-flag',
            );
          details.append(summary);
          for (const f of run.findings) {
            const seconds = (ms: number) => (ms / 1000).toFixed(3) + 's';
            details.append(
              h(
                'p',
                `${f.kind === 'whole' ? 'Whole run' : 'Exact segment'} · ${f.transitions} control changes · ${(f.coverage * 100).toFixed(1)}% of run`,
              ),
            );
            details.append(
              h(
                'p',
                `Cup ${seconds(f.start)}–${seconds(f.end)} · Reference ${seconds(f.referenceStart)}–${seconds(f.referenceEnd)}`,
              ),
            );
            details.append(
              h(
                'p',
                `Cached reference rank #${f.referenceRank} · Recording ${f.reference}`,
                'input-review-status',
              ),
            );
          }
          group.append(details);
        }
        const counts = runs.reduce<Record<string, number>>((out, r) => {
          out[r.status] = (out[r.status] ?? 0) + 1;
          return out;
        }, {});
        const labels: Record<string, string> = {
          no_match: 'no qualifying reference match',
          partial: 'partial recording checked; no qualifying reference match',
          pending: 'pending check',
          unavailable: 'inputs unavailable',
          no_reference: 'no reference coverage',
          unsupported: 'unsupported input recording',
          invalid: 'input evidence could not be checked',
        };
        const notes = Object.entries(counts)
          .filter(([s]) => s !== 'flagged')
          .map(([s, n]) => `${n} ${n === 1 ? 'run' : 'runs'} · ${labels[s] ?? s}`);
        if (notes.length) group.append(h('p', notes.join(' · '), 'input-review-status'));
        if (!runs.length)
          group.append(h('p', 'No finished-run input evidence available.', 'input-review-status'));
        reviewSection.append(group);
      }
    }
    if (checks !== null) {
      const flagged = checks.filter((c) => c.status === 'flagged').length;
      if (flagged) {
        reviewSection.querySelector('summary')!.textContent =
          `Possible copied inputs detected · ${flagged} ${flagged === 1 ? 'run' : 'runs'}`;
        reviewSection.querySelector('summary')!.className = 'input-review-flag';
      }
      this.#body.append(reviewSection);
    }
    this.#footer.replaceChildren(this.#button('Back', () => this.#list()));
  }
}
