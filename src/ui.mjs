import * as Cup from './cup.mjs';
import css from './world-cup.css';
const h = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const names = { registration: 'Registration', 'group-picks': 'Captain picks', 'track-picks': 'Track picks', loading: 'Loading track',
  warmup: 'Warmup', countdown: 'Get ready', racing: 'Live round', 'between-rounds': 'Round results', 'match-complete': 'Match complete', complete: 'World Cup results' };
const time = frames => frames === undefined ? '—' : (frames / 1000).toFixed(3);
export class CupUI {
  constructor(controller) {
    this.c = controller; this.open = true; this.tab = 'Tournament'; this.signature = '';
    this.trackCategory = 'official'; this.trackQuery = ''; this.carThumbnails = new Map();
    const root = h('div'); root.id = 'polytrack-world-cup'; document.body.append(root);
    this.shadow = root.attachShadow({ mode: 'open' });
    const style = h('style', css); this.shadow.append(style);
    this.toggle = this.button('World Cup · F8', () => { this.open = !this.open; this.signature = ''; this.render(); }, 'launcher');
    this.panel = h('section', undefined, 'panel'); this.panel.setAttribute('aria-label', 'World Cup tournament');
    this.hud = h('aside', undefined, 'hud'); this.shadow.append(this.toggle, this.panel, this.hud);
    for (const type of ['keydown', 'keyup', 'keypress']) this.panel.addEventListener(type, e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) e.stopPropagation();
    });
    // Game controls listen on window. Stop those listeners before they can cancel
    // editing, while leaving the browser's normal typing/selection/paste intact.
    for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, e => {
      if (!this.panel.hidden && ['INPUT', 'TEXTAREA', 'SELECT'].includes(this.shadow.activeElement?.tagName))
        e.stopImmediatePropagation();
    }, { capture: true });
    this.panel.addEventListener('focusin', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && this.c.game)
        this.c.native?.clearInput(this.c.game);
    });
    window.addEventListener('keydown', e => {
      if (e.code === 'F8') { e.preventDefault(); this.toggle.click(); }
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(this.shadow.activeElement?.tagName) && this.c.canSpectate() && ['BracketLeft', 'BracketRight'].includes(e.code)) {
        e.preventDefault(); this.c.cycleWatch(e.code === 'BracketLeft' ? -1 : 1);
      }
    });
  }
  button(text, fn, cls = '') {
    const b = h('button', text, cls); b.type = 'button';
    b.addEventListener('click', async () => { try { await fn(); this.signature = ''; this.render(); } catch (e) { this.c.fail(e); } }); return b;
  }
  name(id) { return Cup.player(this.c.state, id)?.name ?? `Player ${id}`; }
  render() {
    const c = this.c, s = c.state;
    this.panel.hidden = !this.open;
    const key = JSON.stringify([this.open, this.tab, s?.id, s?.revision, c.isHost, c.selfId,
      c.lobby.map(p => [p.id, p.nickname, c.hello.has(p.id), p.carStyle?.serialize()]), c.error, !!c.connection, c.auto, c.watchId, c.watchStatus]);
    if (key !== this.signature) {
      // Preserve a partially entered track code/name when unrelated lobby updates arrive.
      const focus = this.shadow.activeElement?.dataset?.field;
      const drafts = Object.fromEntries([...this.shadow.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e.value]));
      this.signature = key; this.panel.replaceChildren();
      const header = h('header');
      const title = h('div'); title.append(h('h1', 'World Cup'), h('p', s ? `${s.name} / ${names[s.phase]}` : 'PolyTrack 0.6.3 · Live competition'));
      header.append(title, this.button('Hide', () => { this.open = false; }, 'quiet')); this.panel.append(header);
      if (c.error) { const error = h('p', c.error, 'error'); error.setAttribute('role', 'alert'); this.panel.append(error); }
      if (!c.connection) this.welcome();
      else if (!s) this.setup();
      else {
        const nav = h('nav');
        for (const tab of ['Tournament', 'Racers', 'Tracks', 'Results']) {
          const b = this.button(tab, () => { this.tab = tab; }, tab === this.tab ? 'selected' : 'quiet');
          b.setAttribute('aria-current', tab === this.tab ? 'page' : 'false'); nav.append(b);
        }
        this.panel.append(nav);
        this.body = h('div', undefined, 'body'); this.panel.append(this.body);
        if (this.tab === 'Racers') this.roster();
        else if (this.tab === 'Tracks') this.trackPack();
        else if (this.tab === 'Results') this.results();
        else this.tournament();
        const footer = h('footer', c.isHost ? 'Organizer · Scores save on this device' : 'Connected to organizer');
        if (c.isHost) {
          footer.append(this.button('Export tournament', () => this.download(), 'quiet'));
          footer.append(this.button('Leave Cup mode', () => {
            if (!confirm('End Cup mode for this lobby? Export first to keep a portable copy.')) return;
            c.transport.broadcast({ type: 'end-cup' }); c.state = null; c.auto = false;
            if (c.info?.spectator) c.info.spectator.isEnabled = false;
          }, 'quiet'));
        }
        this.panel.append(footer);
      }
      for (const e of this.shadow.querySelectorAll('[data-field]')) if (e.dataset.field in drafts) e.value = drafts[e.dataset.field];
      if (focus) this.shadow.querySelector(`[data-field="${focus}"]`)?.focus();
      this.renderHud();
    }
    for (const e of this.shadow.querySelectorAll('[data-clock]')) {
      const run = s?.runtime;
      const target = s?.phase === 'racing' ? run?.deadline : run?.startsAt;
      e.textContent = target ? `${Math.max(0, Math.ceil((target - c.now()) / 1000))}s` : '';
    }
    for (const e of this.shadow.querySelectorAll('[data-pov-stats]')) e.textContent = c.watchedPose ?
      `${time(c.watchedPose.frames)} s · ${Math.round(c.watchedPose.speed)} km/h` : c.watchStatus;
  }
  welcome() {
    const content = h('div', undefined, 'body');
    content.append(h('h2', 'Eight racers. One World Cup.'),
      h('p', 'Host or join a normal multiplayer lobby to begin. Set Maximum Players to 16 to leave room for spectators.'),
      h('p', 'Everyone joins with the game’s invite code and loads this mod. The organizer stays connected for semifinal A, semifinal B, and the final.'),
      h('p', 'F8 opens this panel. Spectators follow a racer’s driving camera. Press [ or ] to cycle racers.', 'muted'));
    this.panel.append(content);
  }
  setup() {
    const body = h('div', undefined, 'body');
    body.append(h('h2', this.c.isHost ? 'Create a World Cup' : 'Waiting for the organizer'));
    if (this.c.isHost) {
      const label = h('label', 'Competition name'); const input = h('input'); input.value = 'World Cup'; input.dataset.field = 'cup-name';
      input.maxLength = 64; label.append(input); body.append(label);
      body.append(this.button('Create tournament', () => this.c.create(input.value), 'primary'));
      const saved = localStorage.getItem('pwc-save-v1');
      if (saved) body.append(this.button('Restore autosave', () => this.c.restore(saved), 'quiet'));
      const file = h('input'); file.type = 'file'; file.accept = '.json'; file.hidden = true;
      file.addEventListener('change', async () => {
        try { if (file.files[0]) this.c.restore(await file.files[0].text()); } catch (e) { this.c.fail(e); }
      });
      body.append(file, this.button('Import saved tournament', () => file.click(), 'quiet'));
    } else body.append(h('p', 'Your lobby host can create the event. You can race or spectate from the same lobby.'));
    this.panel.append(body);
  }
  roster() {
    const s = this.c.state, c = this.c;
    this.body.append(h('h2', `${s.roster.length} / 8 racers`),
      h('p', 'Seed 1 is captain A; seed 2 is captain B. They alternate opponent picks. Seed order also decides track-pick turns.', 'muted'));
    const list = h('div', undefined, 'rows');
    for (const p of s.roster) {
      const row = h('div', undefined, 'row');
      row.append(h('strong', `#${p.seed}`), this.racerName(p.id, p.name));
      const online = c.lobby.some(l => l.id === p.id);
      row.append(h('small', c.needsRebind?.has(p.id) ? 'Confirm identity' : online ? 'In lobby' : 'Disconnected', 'muted'));
      if (c.isHost && s.phase === 'registration') {
        if (p.seed > 1) row.append(this.button('↑', () => c.change(s => Cup.moveSeed(s, p.id, -1)), 'quiet'));
        if (p.seed < s.roster.length) row.append(this.button('↓', () => c.change(s => Cup.moveSeed(s, p.id, 1)), 'quiet'));
        row.append(this.button('Remove', () => c.change(s => Cup.removePlayer(s, p.id)), 'quiet'));
      }
      if (c.isHost && (!online || c.needsRebind?.has(p.id)) && !s.runtime) {
        const select = h('select'); select.setAttribute('aria-label', `Reconnect ${p.name}`);
        for (const l of c.lobby.filter(l => !s.roster.some(p => p.id === l.id) || l.id === p.id)) {
          const option = h('option', l.nickname); option.value = l.id; select.append(option);
        }
        row.append(select, this.button('Reconnect', () => {
          const id = Number(select.value), found = c.lobby.find(l => l.id === id);
          if (!found) throw new Error('Choose a connected player.');
          const oldId = p.id;
          c.change(s => { if (id !== oldId) Cup.rebindPlayer(s, oldId, id, found.nickname); else Cup.touch(s); });
          c.needsRebind?.delete(oldId);
        }, 'quiet'));
      }
      list.append(row);
    }
    this.body.append(list, h('h3', 'Lobby & spectators'));
    for (const l of c.lobby) {
      const row = h('div', undefined, 'row');
      row.append(this.racerName(l.id, l.nickname), h('small', l.isSelf || c.hello.has(l.id) ? 'Mod connected' : c.isHost ? 'Awaiting mod' : 'In lobby', 'muted'));
      if (s.roster.some(p => p.id === l.id)) row.append(h('span', 'Racer', 'badge'));
      else if (c.isHost && s.phase === 'registration' && s.roster.length < 8)
        row.append(this.button('Register racer', () => c.change(s => Cup.addPlayer(s, l.id, l.nickname)), 'quiet'));
      else row.append(h('span', 'Spectator', 'badge'));
      this.body.append(row);
    }
  }
  racerName(id, name) {
    const group = h('span', undefined, 'racer-name grow'), image = h('img', undefined, 'car-skin');
    image.alt = ''; image.title = `${name}'s car`; image.draggable = false;
    image.src = new URL('images/car_thumbnail_placeholder.png', document.baseURI).href;
    const style = this.c.lobby.find(p => p.id === id)?.carStyle;
    if (style) {
      const key = style.serialize();
      if (!this.carThumbnails.has(key)) {
        if (this.carThumbnails.size >= 64) this.carThumbnails.delete(this.carThumbnails.keys().next().value);
        this.carThumbnails.set(key, this.c.native.carThumbnail(style).catch(() => null));
      }
      this.carThumbnails.get(key).then(url => { if (url && image.isConnected) image.src = url; });
    }
    group.append(image, h('span', name)); return group;
  }
  trackPack() {
    const s = this.c.state, c = this.c;
    this.body.append(h('h2', `Track pack · ${s.tracks.length} / 5`), h('p', 'Choose three to five tracks from your game. Joined players receive the selected track automatically. Each track visit has a 15-second warmup and four scored rounds.', 'muted'));
    for (const t of s.tracks) {
      const row = h('div', undefined, 'row'); row.append(h('span', t.name, 'grow'));
      if (c.isHost && s.phase === 'registration') row.append(this.button('Remove', () => c.change(s => {
        s.tracks = s.tracks.filter(track => track.id !== t.id); c.tracks.delete(t.id); Cup.touch(s);
      }), 'quiet'));
      this.body.append(row);
    }
    if (c.isHost && s.phase === 'registration') {
      const tabs = h('div', undefined, 'track-tabs'); tabs.setAttribute('aria-label', 'Track collections');
      for (const [category, text] of [['official', 'Official tracks'], ['community', 'Community tracks'], ['custom', 'Custom tracks']]) {
        const button = this.button(text, () => { this.trackCategory = category; }, category === this.trackCategory ? 'selected' : 'quiet');
        button.setAttribute('aria-pressed', String(category === this.trackCategory)); tabs.append(button);
      }
      this.body.append(tabs);
      const search = h('input'); search.type = 'search'; search.placeholder = 'Search tracks'; search.value = this.trackQuery;
      search.setAttribute('aria-label', 'Search tracks'); search.dataset.field = 'track-search'; search.className = 'track-search';
      const grid = h('div', undefined, 'track-grid');
      let entries;
      try { entries = c.availableTracks(); } catch (error) { grid.append(h('p', error.message, 'muted')); }
      const draw = () => {
        if (!entries) return;
        grid.replaceChildren();
        const tracks = entries.filter(t => t.category === this.trackCategory &&
          `${t.name} ${t.author ?? ''}`.toLocaleLowerCase().includes(this.trackQuery.toLocaleLowerCase()));
        if (!tracks.length) grid.append(h('p', this.trackCategory === 'custom' && !this.trackQuery ? 'No custom tracks saved in this game profile yet.' : 'No matching tracks.', 'muted'));
        for (const track of tracks) {
          const selected = s.tracks.some(t => t.id === track.id);
          const button = this.button('', async () => {
            button.disabled = true;
            try { await c.addLibraryTrack(track); } finally { if (button.isConnected) button.disabled = false; }
          }, `track-card${selected ? ' added' : ''}`);
          button.disabled = selected || s.tracks.length >= 5;
          button.setAttribute('aria-label', `${selected ? 'Added' : 'Add'} ${track.name}`);
          const image = h('img'); image.alt = ''; image.loading = 'lazy'; image.draggable = false;
          Promise.resolve(track.thumbnail).then(src => { if (src && image.isConnected) image.src = src; }).catch(() => {});
          image.addEventListener('error', () => { image.hidden = true; });
          const text = h('span'); text.append(h('strong', track.name), h('small', selected ? 'Added to cup' : track.author || 'Custom track', 'muted'));
          button.append(image, text); grid.append(button);
        }
      };
      search.addEventListener('input', () => { this.trackQuery = search.value; draw(); });
      this.body.append(search, grid); draw();
      const advanced = h('details', undefined, 'track-code'); advanced.append(h('summary', 'Paste a share code instead'));
      const label = h('label', 'PolyTrack share code'), code = h('textarea'); code.rows = 4; code.dataset.field = 'track-code'; code.spellcheck = false;
      label.append(code); advanced.append(label,
        this.button('Import track', () => { c.importTrack(code.value); code.value = ''; }, 'primary'));
      this.body.append(advanced);
    }
  }
  tournament() {
    const c = this.c, s = c.state, m = Cup.currentMatch(s);
    if (c.isHost && !s.runtime) {
      const label = h('label', undefined, 'disconnect-rule'); label.append(h('span', 'If a racer disconnects during a race'));
      const select = h('select'); select.setAttribute('aria-label', 'Disconnect rule');
      for (const [value, text] of [['', 'Choose a rule before starting'], ['dnf', 'DNF; organizer may void the round'], ['void', 'Void round and wait for reconnect']]) {
        const option = h('option', text); option.value = value; option.selected = value === (s.disconnectPolicy ?? ''); select.append(option);
      }
      select.addEventListener('change', () => c.change(s => { s.disconnectPolicy = select.value || null; Cup.touch(s); }));
      label.append(select); this.body.append(label);
    }
    if (c.canSpectate() && c.watchable().length) this.body.append(this.spectatorControls());
    if (s.phase === 'registration') {
      this.body.append(h('h2', 'Build the starting grid'), h('p', 'Register eight lobby players and import a track pack, then confirm seeding. Everyone else stays a spectator.'));
      const stats = h('div', undefined, 'setup-stats'); stats.append(h('span', `${s.roster.length}/8 racers`), h('span', `${s.tracks.length}/3–5 tracks`)); this.body.append(stats);
      if (c.isHost) this.body.append(this.button('Racers & seeds', () => { this.tab = 'Racers'; }), this.button('Import tracks', () => { this.tab = 'Tracks'; }),
        this.button('Lock grid & begin captain picks', () => c.change(Cup.lockRegistration), 'primary'));
    } else if (s.phase === 'group-picks') {
      const actor = Cup.groupPicker(s);
      this.body.append(h('h2', `${this.name(actor)} chooses an opponent`), h('p', 'Captains alternate until each semifinal has four racers.', 'muted'));
      for (const p of s.roster.filter(p => !s.groups.flat().includes(p.id))) {
        const row = h('div', undefined, 'row'); row.append(h('span', `#${p.seed} ${p.name}`, 'grow'));
        if (actor === c.selfId) row.append(this.button('Pick opponent', () => c.action('pick-opponent', p.id)));
        else if (c.isHost) row.append(this.button('Record captain’s pick', () => c.change(s => { Cup.note(s, 'Organizer recorded a captain pick.'); Cup.pickOpponent(s, actor, p.id); }), 'quiet'));
        this.body.append(row);
      }
    } else if (s.phase === 'track-picks') {
      const actor = Cup.trackPicker(s);
      this.body.append(h('h2', `${m.name} · Track picks`), h('p', `${this.name(actor)} picks next. Order: ${m.order.map(id => s.tracks.find(t => t.id === id).name).join(' / ') || 'No picks yet'}`));
      for (const t of s.tracks.filter(t => !m.order.includes(t.id))) {
        const row = h('div', undefined, 'row'); row.append(h('span', t.name, 'grow'));
        if (actor === c.selfId) row.append(this.button('Pick track', () => c.action('pick-track', t.id)));
        else if (c.isHost) row.append(this.button('Record racer’s pick', () => c.change(s => { Cup.note(s, 'Organizer recorded a track pick.'); Cup.pickTrack(s, actor, t.id); }), 'quiet'));
        this.body.append(row);
      }
    } else {
      this.body.append(h('h2', s.phase === 'complete' ? `${this.name(s.results[0].id)} wins the World Cup` : `${m.name} · ${names[s.phase]}`));
      this.body.append(this.scoreboard());
      if (s.runtime) {
        const status = h('p', `Round ${s.runtime.round} / ${s.tracks.find(t => t.id === s.runtime.trackId)?.name} `);
        const clock = h('strong'); clock.dataset.clock = ''; status.append(clock); this.body.append(status);
        if (s.phase === 'loading') this.body.append(h('p', `Ready: ${s.runtime.ready.length}/${Cup.activeIds(s).length}. Waiting for each racer to load the track.`, 'muted'));
        if (s.phase === 'racing' && Cup.activeIds(s).includes(c.selfId)) this.body.append(this.button('Retire this round (DNF)', () => c.action('dnf', s.runtime.id), 'quiet'));
      }
      if (c.isHost) {
        const controls = h('div', undefined, 'controls');
        if (s.phase === 'between-rounds') controls.append(this.button('Start next round', () => { c.runRound(); this.open = false; }, 'primary'));
        if (s.phase === 'match-complete') controls.append(this.button('Continue to next match', () => c.change(Cup.advanceMatch), 'primary'));
        if (s.phase === 'racing') controls.append(this.button('End round · unfinished DNF', () => {
          if (confirm('Score the current finishes and give every unfinished racer a DNF?')) c.finishRound();
        }, 'quiet'));
        if (s.runtime) controls.append(this.button('Void & stop round', () => c.voidRound(), 'quiet'));
        if (['between-rounds', 'match-complete', 'complete'].includes(s.phase)) controls.append(this.button('Undo last scored round', () => {
          if (confirm('Undo the last scored round in this match?')) c.change(Cup.undoRound);
        }, 'quiet'));
        controls.append(this.button(c.auto ? 'Automatic rounds: on' : 'Automatic rounds: off', () => { c.auto = !c.auto; }, 'quiet'));
        this.body.append(controls);
      }
    }
    if (s.phase !== 'registration') this.bracket();
  }
  bracket() {
    const s = this.c.state, bracket = h('div', undefined, 'bracket');
    for (let i = 0; i < 3; i++) {
      const match = s.matches[i], box = h('section', undefined, i === s.matchIndex ? 'match active' : 'match');
      box.append(h('h3', ['Semifinal A', 'Semifinal B', 'Grand final'][i]));
      const ids = match?.players ?? s.groups[i] ?? [];
      for (const id of ids) box.append(h('p', this.name(id), match?.winners.includes(id) ? 'qualified' : ''));
      if (!ids.length) box.append(h('p', 'Awaiting qualifiers', 'muted'));
      bracket.append(box);
    }
    this.body.append(bracket);
  }
  scoreboard() {
    const s = this.c.state, m = Cup.currentMatch(s), board = h('div', undefined, 'scoreboard');
    if (!m) return board;
    const ranking = Cup.rankMatch(s, m);
    for (const id of ranking) {
      const won = m.winners.indexOf(id), finalist = id in m.finalists;
      const row = h('div', undefined, `score-row${won >= 0 ? ' won' : finalist ? ' finalist' : ''}`);
      const position = h('strong', `#${ranking.indexOf(id) + 1}`, 'position');
      row.append(position, h('span', this.name(id), 'grow'), h('small', s.runtime?.dnfs.includes(id) ? 'DNF' : time(s.runtime?.finishes[id]), 'time'),
        h('strong', won >= 0 ? (s.matchIndex === 2 ? 'Podium' : 'Qualified') : finalist ? 'Finalist' : `${m.scores[id]} / ${m.target}`, 'points'));
      board.append(row);
    }
    return board;
  }
  renderHud() {
    this.hud.replaceChildren(); this.hud.hidden = !this.c.state || !Cup.currentMatch(this.c.state) || this.open;
    if (this.hud.hidden) return;
    const s = this.c.state, m = Cup.currentMatch(s), title = h('div', undefined, 'hud-title');
    title.append(h('strong', m.name), h('span', names[s.phase]));
    const clock = h('strong'); clock.dataset.clock = ''; title.append(clock);
    this.hud.append(title, this.scoreboard());
    if (this.c.canSpectate()) this.hud.append(this.spectatorControls());
    this.hud.append(h('p', 'F8 · Tournament controls', 'muted'));
  }
  spectatorControls() {
    const c = this.c, box = h('section', undefined, 'pov');
    box.append(h('strong', `Watching ${c.watchId === null ? '—' : this.name(c.watchId)}`));
    const controls = h('div', undefined, 'controls');
    controls.append(this.button('← Previous [', () => c.cycleWatch(-1), 'quiet'));
    const select = h('select'); select.setAttribute('aria-label', 'Spectate racer');
    for (const id of c.watchable()) { const option = h('option', this.name(id)); option.value = id; option.selected = id === c.watchId; select.append(option); }
    select.addEventListener('change', () => c.selectWatch(Number(select.value)));
    controls.append(select, this.button('Next ] →', () => c.cycleWatch(1), 'quiet'));
    const stats = h('p', c.watchStatus, 'muted'); stats.dataset.povStats = '';
    box.append(controls, stats); return box;
  }
  results() {
    const s = this.c.state;
    this.body.append(h('h2', 'Results & race history'));
    if (s.results.length) for (const r of s.results) this.body.append(h('p', `${r.place}. ${this.name(r.id)}`, 'result'));
    for (const m of s.matches) {
      this.body.append(h('h3', m.name));
      if (!m.roundsLog.length) this.body.append(h('p', 'No scored rounds yet.', 'muted'));
      for (const r of m.roundsLog.slice(-20).reverse()) {
        this.body.append(h('p', `Round ${r.round}: ${m.players.map(id => `${this.name(id)} ${r.finishes[id] === undefined ? 'DNF / already qualified' : time(r.finishes[id])}`).join(' / ')}${r.tiedFirst ? ' · Tied first: no finalist win' : ''}`, 'history'));
      }
    }
    this.body.append(h('p', 'The organizer’s export contains the full round history. Live clients show the latest round per match.', 'muted'));
  }
  download() {
    const data = JSON.stringify(this.c.exportData(), null, 2), url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = h('a'); a.href = url; a.download = 'polytrack-world-cup-results.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
