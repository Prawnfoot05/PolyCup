import { element as h } from './dom.ts';
import { discordIdentity } from './account-flow.ts';
export function profilePicture(name: string, url?: string | null) {
  const portrait = h('span', Array.from(name.trim())[0]?.toUpperCase() || '?', 'player-portrait');
  portrait.setAttribute('aria-hidden', 'true');
  const safe = discordIdentity({ avatar_url: url }).avatar;
  if (safe) {
    const image = h('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = safe;
    image.onerror = () => image.remove();
    portrait.append(image);
  }
  return portrait;
}
export const profilePictureCSS = `.player-portrait{position:relative;display:inline-grid;place-items:center;box-sizing:border-box;flex:0 0 28px;width:28px;height:28px;overflow:hidden;border:1px solid #586a92;border-radius:3px;background:#2c3b66;color:#eef3ff;font:400 17px ForcedSquare,Arial,sans-serif;vertical-align:middle}.player-portrait img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.player-with-portrait{display:inline-flex;align-items:center;gap:9px;min-width:0;max-width:100%}.player-with-portrait>span:last-child{min-width:0;overflow-wrap:anywhere}`;
