import css from './toolbar.css';
import trophy from '../assets/toolbar-trophy.svg';

// Keep the launcher inside the native toolbar: native scaling, clipping, hover
// animation and auto-hide then apply without copying any game UI implementation.
export class CupToolbar {
  constructor({ fallback, hud, toggle }) {
    this.fallback = fallback; this.hud = hud; this.toolbar = null;
    this.button = document.createElement('button');
    this.button.type = 'button'; this.button.className = 'button polycup-toolbar-button';
    this.button.title = 'PolyCup (F8)'; this.button.setAttribute('aria-keyshortcuts', 'F8');
    const icon = document.createElement('img');
    icon.className = 'button-icon polycup-trophy'; icon.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trophy)}`;
    icon.alt = ''; icon.draggable = false;
    this.button.append(icon, document.createTextNode(' PolyCup'));
    this.button.addEventListener('click', toggle);
    // Native game input listens on window and otherwise consumes Space/Enter.
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => {
      if (document.activeElement !== this.button || !['Space', 'Enter'].includes(e.code)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (type === 'keydown' && !e.repeat) this.button.click();
    }, { capture: true });
    const style = document.createElement('style'); style.textContent = css;
    document.head.append(style);
    this.schedule = () => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.sync(); });
    };
    this.observer = new MutationObserver(records => {
      if (records.some(r => r.type === 'childList' || r.target === this.toolbar)) this.schedule();
    });
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    this.resize = new ResizeObserver(this.schedule);
    window.addEventListener('resize', this.schedule);
    this.sync();
  }
  sync(open) {
    if (open !== undefined) this.open = open;
    const toolbar = document.querySelector('.game-toolbar-ui');
    if (toolbar !== this.toolbar) {
      this.resize.disconnect();
      this.toolbar?.removeEventListener('transitionend', this.schedule);
      this.toolbar?.classList.remove('polycup-toolbar');
      this.toolbar = toolbar;
      if (toolbar) {
        toolbar.classList.add('polycup-toolbar'); this.resize.observe(toolbar);
        toolbar.addEventListener('transitionend', this.schedule);
      }
    }
    const container = toolbar?.querySelector(':scope > .button-container');
    if (container && this.button.parentElement !== container) container.append(this.button);
    if (!container) this.button.remove();
    this.fallback.hidden = !!container;
    this.button.setAttribute('aria-expanded', String(!!this.open));
    this.fallback.setAttribute('aria-expanded', String(!!this.open));
    this.button.tabIndex = toolbar?.classList.contains('visible') ? 0 : -1;

    // Keep room during the native delayed fade-out; collapse only once it has
    // disappeared. A bottom-docked toolbar does not need top-corner space.
    const rect = toolbar?.getBoundingClientRect();
    const visible = toolbar && (toolbar.classList.contains('visible') || Number(getComputedStyle(toolbar).opacity) > .01);
    const top = visible && rect.height > 0 && rect.top < innerHeight / 2
      ? Math.max(0, Math.ceil(rect.bottom) + 8) : 0;
    if (top !== this.lastTop) {
      // Clear the returning toolbar immediately; animate only the move back up.
      this.hud.classList.toggle('settling', top < this.lastTop);
      this.hud.style.setProperty('--pwc-hud-top', `${top}px`); this.lastTop = top;
    }
  }
}
