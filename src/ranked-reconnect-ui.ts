import { element as h } from './dom.ts';
import type { RankedQueue } from './ranked-queue.ts';

/** The finder asks for an explicit decision; polling never silently rejoins. */
export class RankedReconnectUI {
  #dialog = h('dialog', undefined, 'ranked-match-dialog ranked-reconnect-dialog');
  #match = '';
  #confirm = false;
  #dismissed = '';
  #clock?: ReturnType<typeof setInterval>;
  #remaining = h('p', undefined, 'ranked-reconnect-time');
  #reconnect?: HTMLButtonElement;
  #expiredBack?: HTMLButtonElement;
  #serverOffset = 0;
  #serverTime = '';
  constructor(
    shadow: ShadowRoot,
    private queue: RankedQueue,
    private visible: () => boolean,
    private reconnect: () => void,
  ) {
    this.#dialog.setAttribute('aria-label', 'Return to ranked Cup');
    this.#dialog.addEventListener('cancel', (event) => event.preventDefault());
    shadow.append(this.#dialog);
    queue.subscribe(() => this.render());
  }
  close() {
    this.#dialog.close();
    clearInterval(this.#clock);
    this.#clock = undefined;
  }
  #seconds() {
    const until = this.queue.snapshot?.match?.reconnect_until;
    return until
      ? Math.max(0, Math.ceil((Date.parse(until) - Date.now() - this.#serverOffset) / 1000))
      : null;
  }
  #updateTime() {
    const match = this.queue.snapshot?.match;
    const remaining = this.#seconds();
    this.#remaining.textContent =
      remaining === null
        ? 'Reconnect before the 2-minute grace period ends.'
        : remaining
          ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} to reconnect`
          : 'Reconnect time expired · confirming the result…';
    if (this.#reconnect)
      this.#reconnect.disabled =
        this.queue.busy || remaining === 0 || match?.can_reconnect === false;
    if (this.#expiredBack) this.#expiredBack.hidden = remaining !== 0;
  }
  render() {
    const q = this.queue,
      match = q.snapshot?.match;
    if (q.snapshot?.server_time && q.snapshot.server_time !== this.#serverTime) {
      const server = Date.parse(q.snapshot.server_time);
      if (Number.isFinite(server)) {
        this.#serverOffset = server - Date.now();
        this.#serverTime = q.snapshot.server_time;
      }
    }
    if (
      !this.visible() ||
      !match ||
      match.status !== 'racing' ||
      match.abandoned ||
      match.result_submitted ||
      typeof match.is_host !== 'boolean'
    ) {
      this.close();
      return;
    }
    if (
      this.#dismissed === match.id &&
      (match.is_host || match.host_disconnected || this.#seconds() === 0)
    ) {
      this.close();
      return;
    }
    if (this.#match !== match.id) {
      this.#match = match.id;
      this.#confirm = false;
    }
    if (match.host_disconnected && !match.is_host) this.#confirm = false;
    const active = (this.#dialog.getRootNode() as ShadowRoot).activeElement;
    const restoreFocus = !this.#dialog.open || this.#dialog.contains(active);
    const focus = active instanceof HTMLButtonElement ? active.textContent : null;
    const header = h('header'),
      body = h('div', undefined, 'ranked-match-body'),
      footer = h('footer');
    header.append(
      h('h2', this.#confirm ? 'Abandon ranked Cup?' : 'Your ranked Cup is still active'),
    );
    const host = match.is_host === true;
    body.append(
      h(
        'p',
        this.#confirm
          ? 'Abandoning counts as a loss. You will not be able to rejoin this Cup.'
          : host
            ? 'Your hosted race has closed and cannot be restored. Leaving it counts as an abandonment loss.'
            : match.host_disconnected
              ? 'The host disconnected. This race cannot resume; its result is being checked.'
              : 'Reconnect to continue racing. If you do not return within 2 minutes, it counts as an abandonment loss.',
      ),
    );
    body.append(
      h(
        'p',
        match.host_disconnected && !host
          ? 'You do not need to abandon. Your result will appear when processing finishes.'
          : 'Your rating updates after the result is processed.',
        'ranked-reconnect-note',
      ),
    );
    if (!host && !match.host_disconnected) body.append(this.#remaining);
    if (q.error) {
      const error = h('p', q.error, 'ranked-queue-message');
      error.setAttribute('role', 'alert');
      body.append(error);
    }
    const button = (label: string, run: () => void, primary = false) => {
      const element = h('button', label, primary ? 'primary' : 'quiet');
      element.type = 'button';
      element.disabled = q.busy;
      element.onclick = run;
      return element;
    };
    this.#reconnect = undefined;
    this.#expiredBack = undefined;
    if (match.host_disconnected && !host) {
      footer.append(
        button(
          'Back to menu',
          () => {
            this.#dismissed = match.id;
            this.close();
          },
          true,
        ),
      );
    } else if (this.#confirm) {
      footer.append(
        button('Go back', () => {
          this.#confirm = false;
          this.render();
        }),
        button(q.busy ? 'Abandoning…' : 'Confirm abandonment', () => void q.abandonMatch(match.id)),
      );
    } else {
      footer.append(
        button('Abandon match', () => {
          this.#confirm = true;
          this.render();
        }),
      );
      if (host)
        footer.append(
          button(
            'Back to menu',
            () => {
              this.#dismissed = match.id;
              this.close();
            },
            true,
          ),
        );
      else {
        this.#reconnect = button(
          'Reconnect',
          () => {
            this.close();
            this.reconnect();
          },
          true,
        );
        footer.append(this.#reconnect);
      }
    }
    if (!host && !match.host_disconnected) {
      this.#expiredBack = button('Back to menu', () => {
        this.#dismissed = match.id;
        this.close();
      });
      this.#expiredBack.disabled = false;
      footer.append(this.#expiredBack);
    }
    this.#dialog.replaceChildren(header, body, footer);
    this.#updateTime();
    this.#clock ??= setInterval(() => this.#updateTime(), 1000);
    if (!this.#dialog.open) this.#dialog.showModal();
    if (restoreFocus) {
      const buttons = [...footer.querySelectorAll<HTMLButtonElement>('button')].filter(
        (b) => !b.disabled && !b.hidden,
      );
      (
        buttons.find((b) => b.textContent === focus) ??
        buttons.find((b) => b.textContent === (this.#confirm ? 'Go back' : 'Reconnect')) ??
        buttons.find((b) => b.textContent === 'Back to menu')
      )?.focus();
    }
  }
}
