import { element as h } from './dom.ts';
import { rankBadgeText, type RankedProfile } from './ranked.ts';
import unranked from '../assets/ranks/unranked.png';
import bronze from '../assets/ranks/bronze.png';
import silver from '../assets/ranks/silver.png';
import gold from '../assets/ranks/gold.png';
import platinum from '../assets/ranks/platinum.png';
import diamond from '../assets/ranks/diamond.png';
import master from '../assets/ranks/master.png';
import grandmaster from '../assets/ranks/grandmaster.png';

const images = { bronze, silver, gold, platinum, diamond, master, grandmaster };
export function rankBadge(
  profile: Pick<RankedProfile, 'tier' | 'rating' | 'gm_position' | 'provisional'> | null,
  fallback = 'Unranked',
) {
  const badge = h('div', undefined, 'ranked-rating-badge');
  if (!profile || profile.provisional || profile.tier === 'provisional') {
    if (!profile && fallback !== 'Unranked') {
      badge.classList.add('is-unranked');
      badge.append(h('span', fallback));
      return badge;
    }
    badge.classList.add('is-provisional');
    const image = h('img');
    image.src = unranked;
    image.alt = '';
    badge.append(image);
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', profile ? 'Provisional rating ' + profile.rating : 'Unranked');
    badge.title = profile ? 'Provisional rating ' + profile.rating : 'Unranked';
    if (profile) {
      const value = h('div', undefined, 'ranked-rating-value');
      value.append(h('span', String(profile.rating)));
      badge.append(value);
    }
    return badge;
  }
  const image = h('img');
  image.src = images[profile.tier];
  image.alt = '';
  const text = rankBadgeText(profile),
    value = h('div', undefined, 'ranked-rating-value');
  value.append(h('span', text.primary));
  if (text.secondary) {
    badge.classList.add('is-grandmaster');
    value.append(h('small', text.secondary));
  }
  badge.setAttribute('role', 'img');
  badge.setAttribute(
    'aria-label',
    `${profile.tier}, ${text.primary}${text.secondary ? `, rating ${text.secondary}` : ''}`,
  );
  badge.title = profile.tier[0].toUpperCase() + profile.tier.slice(1);
  badge.append(image, value);
  return badge;
}
