import { element as h } from './dom.ts';
import { rankBadge } from './rank-badge.ts';
import type { RankedProfile } from './ranked.ts';
import launch from '../supabase/ranked-launch-config.json';
import trophy from '../assets/toolbar-trophy.svg';
import css from './cup-guide.css';

const WELCOME_KEY = 'polycup.welcome.seen.v1';

/** Local onboarding: a shared device/profile sees this once, without a backend request. */
export class CupGuide {
  #welcome = h('dialog', undefined, 'cup-guide cup-welcome');
  #ranks = h('dialog', undefined, 'cup-guide cup-rank-guide');
  #visited = false;
  constructor(shadow: ShadowRoot) {
    shadow.append(h('style', css), this.#welcome, this.#ranks);
    this.#welcome.setAttribute('aria-label', 'Welcome to PolyCup');
    this.#ranks.setAttribute('aria-label', 'Ranked tiers');
    this.#ranks.addEventListener('close', () => {
      // Queue polling replaces the original opener while the guide is open.
      const opener = shadow.querySelector<HTMLButtonElement>('.ranked-guide-button');
      if (opener?.getClientRects().length) opener.focus();
    });
    const art = h('div', undefined, 'welcome-trophy');
    const image = h('img');
    image.src = `data:image/svg+xml,${encodeURIComponent(trophy)}`;
    image.alt = '';
    art.setAttribute('aria-hidden', 'true');
    art.append(h('span', '✦', 'welcome-spark'), image, h('span', '✦', 'welcome-spark'));
    const body = h('div', undefined, 'welcome-body');
    body.append(
      art,
      h('h2', 'Welcome to PolyCup'),
      h('p', 'Race Cups with friends or find a ranked match.', 'welcome-greeting'),
    );
    const paths = h('div', undefined, 'welcome-paths');
    for (const [title, text] of [
      ['Custom Cups', 'Choose tracks and rules, then invite players.'],
      ['Ranked', 'Play matched Cups and earn a rating.'],
    ]) {
      const item = h('div');
      item.append(h('h3', title), h('p', text));
      paths.append(item);
    }
    body.append(paths);
    const footer = h('footer');
    footer.append(this.#button('Continue', () => this.#welcome.close(), 'primary'));
    this.#welcome.append(body, footer);
    const header = h('header');
    const close = this.#button('×', () => this.#ranks.close());
    close.setAttribute('aria-label', 'Close ranked tiers');
    header.append(h('h2', 'Ranked tiers'), close);
    const content = h('div', undefined, 'rank-guide-body');
    const chart = h('ol', undefined, 'rank-tier-chart');
    chart.setAttribute('aria-label', 'Rating thresholds, Bronze to Master');
    const colors = ['#bd9057', '#b7bec9', '#f4c563', '#91dcf5', '#628afb', '#be8ee8'];
    launch.tierNames.forEach((tier, index) => {
      const floor = launch.tierFloors[index];
      const row = h('li', undefined, 'rank-tier-step');
      row.style.setProperty('--tier-color', colors[index]);
      row.style.setProperty('--tier-rise', `${10 + index * 29}px`);
      const profile = { tier, rating: floor, provisional: false } as RankedProfile;
      const bar = h('div', undefined, 'rank-tier-bar');
      bar.setAttribute('aria-hidden', 'true');
      const label = tier[0].toUpperCase() + tier.slice(1);
      const range =
        index === launch.tierFloors.length - 1
          ? `${floor.toLocaleString('en-US')}+`
          : `${floor.toLocaleString('en-US')}–${(launch.tierFloors[index + 1] - 1).toLocaleString('en-US')}`;
      row.append(rankBadge(profile), bar, h('h3', label), h('span', range, 'rank-tier-range'));
      chart.append(row);
    });
    const milestones = h('div', undefined, 'rank-guide-milestones');
    const placement = h('div', undefined, 'rank-placement');
    const dots = h('div', undefined, 'rank-placement-dots');
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < launch.provisionalMatches; i++) dots.append(h('i'));
    placement.append(
      rankBadge(null),
      dots,
      h('span', `${launch.provisionalMatches} placement Cups`),
    );
    const gm = h('div', undefined, 'rank-grandmaster');
    const gmBadge = rankBadge({
      tier: 'grandmaster',
      rating: launch.tierFloors.at(-1)!,
      gm_position: 1,
      provisional: false,
    } as RankedProfile);
    gmBadge.querySelector('.ranked-rating-value')!.replaceChildren(h('span', 'TOP 10'));
    gmBadge.setAttribute('aria-label', 'Grandmaster: top 10 eligible Masters');
    gm.append(gmBadge, h('div'));
    gm.lastElementChild!.append(h('h3', 'Grandmaster'), h('span', 'Top 10 Masters'));
    milestones.append(placement, gm);
    content.append(chart, milestones);
    this.#ranks.append(header, content);
  }
  #button(label: string, action: () => void, className = 'quiet') {
    const button = h('button', label, className);
    button.type = 'button';
    button.onclick = action;
    return button;
  }
  welcome() {
    if (this.#visited) return;
    this.#visited = true;
    try {
      if (localStorage.getItem(WELCOME_KEY)) return;
    } catch {
      /* Session-only when storage is unavailable. */
    }
    this.#welcome.showModal();
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* Do not block the menu on storage failure. */
    }
  }
  ranks() {
    if (!this.#ranks.open) this.#ranks.showModal();
  }
  close() {
    this.#welcome.close();
    this.#ranks.close();
  }
}
