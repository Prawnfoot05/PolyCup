import { element as h } from './dom.ts';
import type { Ranked, RankedProfile } from './ranked.ts';
import { confirmedRatingResult } from './ranked-result.ts';
import { rankBadge } from './rank-badge.ts';
import css from './ranked-result.css';
const number = (n: number) => n.toLocaleString('en-US');
export class RankedResultUI {
  #dialog = h('dialog', undefined, 'ranked-outcome');
  #body = h('div', undefined, 'ranked-outcome-body');
  #generation = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #animation = 0;
  #last?: [string, string, RankedProfile | null];
  #approved = '';
  #marked = new Set<string>();
  get isOpen() {
    return this.#dialog.open;
  }
  checkUser() {
    if (this.#last && this.user() !== this.#last[1]) this.close();
  }
  reopen() {
    if (this.#dialog.open && this.#last) {
      const args = this.#last;
      // close is dispatched asynchronously. Reopen only after its cleanup,
      // otherwise that event cancels the new result request.
      this.#dialog.addEventListener('close', () => this.open(...args), { once: true });
      this.close();
    }
  }
  constructor(
    shadow: ShadowRoot,
    private api: Ranked,
    private user: () => string | null,
    private history: (id: string) => void,
    private delivery?: {
      claim: (match: string, player: string) => Promise<boolean>;
      seen: (match: string, player: string) => void;
      closed: (seen: boolean) => void;
    },
  ) {
    shadow.append(h('style', css), this.#dialog);
    this.#dialog.setAttribute('aria-label', 'Ranked result');
    this.#dialog.append(this.#body);
    this.#dialog.addEventListener('close', () => {
      // A previous close event can arrive after an immediate new open.
      if (!this.#dialog.open) {
        const seen = !!this.#last && this.#marked.has(this.#last[1] + ':' + this.#last[0]);
        this.#stop();
        this.delivery?.closed(seen);
      }
    });
    this.#dialog.addEventListener('cancel', () => this.#stop());
  }
  #stop() {
    if (this.#approved && !this.#marked.has(this.#approved)) this.#approved = '';
    ++this.#generation;
    clearTimeout(this.#timer);
    cancelAnimationFrame(this.#animation);
  }
  close() {
    this.#stop();
    this.#dialog.close();
  }
  showIssue(message: string) {
    this.#stop();
    this.#last = undefined;
    this.#dialog.classList.remove('is-promotion');
    this.#body.replaceChildren(
      h('h2', 'Rating not confirmed'),
      h('p', message, 'ranked-outcome-note'),
      this.#button('Continue', () => this.close()),
    );
    if (!this.#dialog.open) this.#dialog.showModal();
  }
  #button(label: string, action: () => void) {
    const b = h('button', label);
    b.type = 'button';
    b.onclick = action;
    return b;
  }
  open(match: string, player: string, before: RankedProfile | null) {
    this.#last = [match, player, before];
    this.#stop();
    this.#dialog.classList.remove('is-promotion');
    const generation = this.#generation;
    const title = h('h2', 'Cup finished'),
      note = h('p', 'Confirming rating…', 'ranked-outcome-note');
    note.setAttribute('role', 'status');
    this.#body.replaceChildren(
      title,
      note,
      h('p', 'You can continue; your result will appear when ready.', 'ranked-outcome-note'),
      this.#button('Continue', () => this.close()),
    );
    if (!this.#dialog.open) this.#dialog.showModal();
    let attempts = 0;
    const load = async () => {
      if (generation !== this.#generation || !this.#dialog.open) return;
      if (this.user() !== player) {
        this.close();
        return;
      }
      try {
        const result = await this.api.match(match);
        if (generation !== this.#generation || this.user() !== player) return;
        if (!result) {
          const status = await this.api.resultStatus(match).catch(() => null);
          if (generation !== this.#generation || this.user() !== player) return;
          if (status && ['unrated', 'cancelled', 'disputed'].includes(status.status)) {
            note.textContent = 'Match ended without a rating change.';
            return;
          }
          // Cron drains one Cup per tick; retries or another Cup can exceed a minute.
          // Keep this open result live at a lower polling rate instead of stranding it.
          ++attempts;
          if (attempts >= 12)
            note.textContent = 'Rating confirmation is still pending. Checking automatically…';
          this.#timer = setTimeout(load, attempts < 12 ? 5000 : 15000);
          return;
        }
        const after = await this.api.profile(player).catch(() => null);
        if (generation !== this.#generation || this.user() !== player) return;
        if (result.players.find((p) => p.player_id === player)?.rating_after === null) {
          title.textContent = 'Cup ended';
          note.textContent = 'No rating change. The Cup could not continue.';
          return;
        }
        const view = confirmedRatingResult(result, player, before, after);
        if (!view) throw new Error('No confirmed rating');
        if (document.hidden) {
          document.addEventListener('visibilitychange', () => void load(), { once: true });
          return;
        }
        const deliveryId = player + ':' + match;
        if (this.delivery && this.#approved !== deliveryId) {
          const allowed = await this.delivery.claim(match, player);
          if (generation !== this.#generation || this.user() !== player) return;
          if (!allowed) {
            this.close();
            return;
          }
          if (document.hidden) {
            document.addEventListener('visibilitychange', () => void load(), { once: true });
            return;
          }
          this.#approved = deliveryId;
        }
        const heading = h(
          'h2',
          view.abandoned
            ? 'Cup abandoned'
            : view.promoted
              ? 'Promoted to ' + view.profile!.tier[0].toUpperCase() + view.profile!.tier.slice(1)
              : view.revealed
                ? 'Rank revealed'
                : 'Ranked result',
        );
        const place = h(
          'p',
          'Placed ' + view.place + ' / ' + result.players.length,
          'ranked-outcome-note',
        );
        const badge = h('div', undefined, 'ranked-outcome-badge');
        if (view.profile) badge.append(rankBadge(view.profile));
        const delta = h(
          'div',
          view.delta === null
            ? 'First rating'
            : (view.delta > 0 ? '+' : view.delta < 0 ? '−' : '') + number(Math.abs(view.delta)),
          'ranked-outcome-delta',
        );
        delta.classList.add(
          view.delta === null || view.delta === 0
            ? 'neutral'
            : view.delta > 0
              ? 'positive'
              : 'negative',
        );
        const rating = h('div', number(view.rating_after!), 'ranked-outcome-rating');
        rating.setAttribute('aria-hidden', 'true');
        const from = h(
          'p',
          view.rating_before === null
            ? 'Rating established'
            : number(view.rating_before) + ' → ' + number(view.rating_after!),
          'ranked-outcome-from',
        );
        const announcement = h(
          'p',
          (view.promoted ? 'Rank promoted. ' : '') +
            'Rating ' +
            number(view.rating_after!) +
            '. ' +
            delta.textContent,
          'account-visually-hidden',
        );
        announcement.setAttribute('role', 'status');
        const actions = h('footer');
        actions.append(
          this.#button('Match history', () => {
            this.close();
            this.history(player);
          }),
          this.#button('Continue', () => this.close()),
        );
        this.#body.replaceChildren(
          heading,
          place,
          badge,
          delta,
          rating,
          from,
          announcement,
          actions,
        );
        this.#dialog.classList.toggle('is-promotion', view.promoted || view.revealed);
        if (this.delivery && !this.#marked.has(deliveryId)) {
          const mark = () => {
            if (generation !== this.#generation || !this.#dialog.open || this.user() !== player)
              return;
            if (document.hidden) {
              document.addEventListener('visibilitychange', mark, { once: true });
              return;
            }
            this.delivery!.seen(match, player);
            this.#marked.add(deliveryId);
          };
          requestAnimationFrame(mark);
        }
        if (
          !matchMedia('(prefers-reduced-motion: reduce)').matches &&
          view.rating_before !== null &&
          view.delta !== 0
        ) {
          const start = performance.now(),
            initial = view.rating_before,
            final = view.rating_after!;
          const tick = (time: number) => {
            if (generation !== this.#generation) return;
            const progress = Math.min(1, (time - start) / 900);
            rating.textContent = number(
              Math.round(initial + (final - initial) * (1 - Math.pow(1 - progress, 3))),
            );
            if (progress < 1) this.#animation = requestAnimationFrame(tick);
          };
          this.#animation = requestAnimationFrame(tick);
        }
      } catch {
        if (generation !== this.#generation || !this.#dialog.open) return;
        note.textContent = 'Connection interrupted. Retrying rating confirmation…';
        this.#timer = setTimeout(load, 15000);
      }
    };
    void load();
  }
}
