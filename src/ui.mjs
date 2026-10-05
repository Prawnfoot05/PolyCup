import * as Cup from './cup.mjs';
import { standings, recordTrack, sessionRecord } from './standings.mjs';
import { CupToolbar } from './toolbar.mjs';
import css from './world-cup.css';
const h = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const names = { registration: 'Registration', loading: 'Loading track',
  warmup: 'Warmup', countdown: 'Get ready', racing: 'Live round', 'between-rounds': 'Round results', complete: 'Cup results' };
const time = frames => frames === undefined ? '—' : (frames / 1000).toFixed(3);
export class CupUI {
  constructor(controller) {
    this.c = controller; this.open = true; this.tab = 'Tournament'; this.signature = '';
    this.trackCategory = 'official'; this.trackQuery = ''; this.carThumbnails = new Map();
    const root = h('div'); root.id = 'polytrack-world-cup'; document.body.append(root);
    this.shadow = root.attachShadow({ mode: 'open' });
    const style = h('style', css); this.shadow.append(style);
    this.toggle = this.button('PolyCup · F8', () => { this.open = !this.open; this.signature = ''; this.render(); }, 'launcher');
    this.panel = h('section', undefined, 'panel'); this.panel.setAttribute('aria-label', 'Simple Cup');
    this.hud = h('aside', undefined, 'hud'); this.povHud = h('aside', undefined, 'pov-hud'); this.shadow.append(this.toggle, this.panel, this.hud, this.povHud);
    this.toolbar = new CupToolbar({ fallback: this.toggle, hud: this.hud, toggle: () => this.toggle.click() });
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
    this.toolbar.sync(this.open);
    this.panel.hidden = !this.open;
    const key = JSON.stringify([this.open, this.tab, s?.id, s?.revision, c.isHost, c.selfId,
      c.lobby.map(p => [p.id, p.nickname, c.hello.has(p.id), p.carStyle?.serialize()]), c.error, !!c.connection, c.auto, c.watchId, c.watchStatus, c.transferProgress]);
    if (key !== this.signature) {
      // Preserve a partially entered track code/name when unrelated lobby updates arrive.
      const focus = this.shadow.activeElement?.dataset?.field;
      const drafts = Object.fromEntries([...this.shadow.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e.value]));
      this.signature = key; this.panel.replaceChildren();
      const header = h('header');
      const title = h('div'); title.append(h('h1', 'PolyCup'), h('p', s ? `${s.name} / ${names[s.phase]}` : 'PolyTrack 0.6.3 · Live competition'));
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
    content.append(h('h2', 'Join. Pick a track. Race.'),
      h('p', 'Host or join a normal multiplayer lobby to begin. Set Maximum Players to 16 to leave room for spectators.'),
      h('p', 'Two to eight racers share one Cup. Reach 100 points, then win a later round to take the Cup. Everyone else can spectate.'),
      h('p', 'F8 opens this panel. Spectators follow a racer’s driving camera. Press [ or ] to cycle racers.', 'muted'));
    this.panel.append(content);
  }
  setup() {
    const body = h('div', undefined, 'body');
    body.append(h('h2', this.c.isHost ? 'Create a Simple Cup' : 'Waiting for the organizer'));
    if (this.c.isHost) {
      const label = h('label', 'Competition name'); const input = h('input'); input.value = 'Simple Cup'; input.dataset.field = 'cup-name';
      input.maxLength = 64; label.append(input); body.append(label);
      body.append(this.button('Create Cup', () => this.c.create(input.value), 'primary'));
      const saved = localStorage.getItem('pwc-save-v2');
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
      h('p', 'Join as a racer and choose one track. Stay out of the grid to spectate.', 'muted'));
    const list = h('div', undefined, 'rows');
    for (const p of s.roster) {
      const row = h('div', undefined, 'row');
      row.append(this.racerName(p.id, p.name));
      const pick = s.tracks.find(t => t.id === s.picks[p.id]); row.append(h('span', pick?.name ?? 'Choosing a track…', pick ? 'badge' : 'muted'));
      const online = c.lobby.some(l => l.id === p.id);
      row.append(h('small', c.needsRebind?.has(p.id) ? 'Confirm identity' : online ? 'In lobby' : 'Disconnected', 'muted'));
      if (c.isHost && s.phase === 'registration') {
        row.append(this.button('Remove', () => c.change(s => { Cup.removePlayer(s, p.id); c.pruneTrackData(); }), 'quiet'));
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
    this.body.append(list);
    if (s.phase === 'registration') this.body.append(this.joinControls());
    this.body.append(h('h3', 'Lobby & spectators'));
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
  joinControls() {
    const box = h('div', undefined, 'controls'), joined = !!Cup.player(this.c.state, this.c.selfId);
    const full = !joined && this.c.state.roster.length >= 8;
    const join = this.button(joined ? 'Switch to spectator' : full ? 'Grid full · spectating' : 'Join as racer', () => this.c.action(joined ? 'leave' : 'join'), joined || full ? 'quiet' : 'primary');
    join.disabled = full; box.append(join);
    if (joined) box.append(this.button('Choose my track', () => { this.tab = 'Tracks'; }));
    return box;
  }
  trackPack() {
    const s = this.c.state, c = this.c, joined = !!Cup.player(s, c.selfId);
    this.body.append(h('h2', 'One racer, one track'), h('p', 'Pick from your game’s tracks. Everyone receives custom tracks automatically. Shared picks count once; the organizer starts with a shuffled order.', 'muted'));
    for (const t of s.tracks) {
      const row = h('div', undefined, 'row'); row.append(h('strong', t.name, 'grow'),
        h('small', s.roster.filter(p => s.picks[p.id] === t.id).map(p => p.name).join(', '), 'muted')); this.body.append(row);
    }
    if (s.phase === 'registration' && !joined) this.body.append(this.joinControls());
    if (s.phase === 'registration' && joined) {
      if (c.transferProgress) this.body.append(h('p', c.transferProgress, 'upload-status'));
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
          const selected = s.picks[c.selfId] === track.id;
          const button = this.button('', async () => {
            button.disabled = true;
            try { await c.addLibraryTrack(track); } finally { if (button.isConnected) button.disabled = false; }
          }, `track-card${selected ? ' added' : ''}`);
          button.disabled = selected || !!c.pendingUpload;
          button.setAttribute('aria-label', `${selected ? 'Selected' : 'Choose'} ${track.name}`);
          const image = h('img'); image.alt = ''; image.loading = 'lazy'; image.draggable = false;
          Promise.resolve(track.thumbnail).then(src => { if (src && image.isConnected) image.src = src; }).catch(() => {});
          image.addEventListener('error', () => { image.hidden = true; });
          const text = h('span'); text.append(h('strong', track.name), h('small', selected ? 'Your pick' : track.author || 'Custom track', 'muted'));
          button.append(image, text); grid.append(button);
        }
      };
      search.addEventListener('input', () => { this.trackQuery = search.value; draw(); });
      this.body.append(search, grid); draw();
      const advanced = h('details', undefined, 'track-code'); advanced.append(h('summary', 'Paste a share code instead'));
      const label = h('label', 'PolyTrack share code'), code = h('textarea'); code.rows = 4; code.dataset.field = 'track-code'; code.spellcheck = false;
      label.append(code); advanced.append(label,
        this.button('Choose this track', async () => { await c.importTrack(code.value); code.value = ''; }, 'primary'));
      this.body.append(advanced);
    }
  }
  tournament() {
    const c = this.c, s = c.state, m = Cup.currentMatch(s);
    if (s.phase === 'registration') {
      const ready = s.roster.filter(p => s.picks[p.id]).length;
      this.body.append(h('h2', 'Your next Cup starts here'),
        h('p', 'Join the grid, choose one track, and race together. No seeding. No captain draft.'),
        h('p', '100 points → Finalist → win a round. First finalist to win takes the Cup.', 'cup-rules'));
      const stats = h('div', undefined, 'setup-stats'); stats.append(h('span', `${s.roster.length}/8 racers`), h('span', `${ready}/${s.roster.length} tracks chosen`)); this.body.append(stats);
      this.body.append(this.joinControls());
      if (c.isHost) {
        const start = this.button('Shuffle tracks & start Cup', () => { c.startCup(); this.open = false; }, 'primary');
        start.disabled = s.roster.length < 2 || ready !== s.roster.length; this.body.append(start);
        this.body.append(h('p', 'Start with any 2–8 racers. The organizer stays connected throughout the Cup.', 'muted'));
      } else this.body.append(h('p', 'The organizer starts when the grid is ready.', 'muted'));
      const list = h('div', undefined, 'ready-list');
      for (const p of s.roster) {
        const row = h('div', undefined, 'row'), picked = s.tracks.find(t => t.id === s.picks[p.id]);
        row.append(this.racerName(p.id, p.name), h('span', picked ? `✓ ${picked.name}` : 'Choosing a track…', picked ? 'ready-pick' : 'muted')); list.append(row);
      }
      this.body.append(list);
    } else {
      this.body.append(h('h2', s.phase === 'complete' ? `${this.name(s.results[0].id)} wins the Cup` : `${m.name} · ${names[s.phase]}`));
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
        if (s.phase === 'racing') controls.append(this.button('End round · unfinished DNF', () => {
          if (confirm('Score the current finishes and give every unfinished racer a DNF?')) c.finishRound();
        }, 'quiet'));
        if (s.runtime) controls.append(this.button('Void & stop round', () => c.voidRound(), 'quiet'));
        if (['between-rounds', 'complete'].includes(s.phase)) controls.append(this.button('Undo last scored round', () => {
          if (confirm('Undo the last scored round in this match?')) c.change(Cup.undoRound);
        }, 'quiet'));
        controls.append(this.button(c.auto ? 'Automatic rounds: on' : 'Automatic rounds: off', () => { c.auto = !c.auto; }, 'quiet'));
        this.body.append(controls);
      }
    }
    if (c.isHost && !s.runtime) {
      const advanced = h('details', undefined, 'organizer-settings'); advanced.append(h('summary', 'Organizer settings'));
      const label = h('label', undefined, 'disconnect-rule'); label.append(h('span', 'If a racer disconnects during a race'));
      const select = h('select'); select.setAttribute('aria-label', 'Disconnect rule');
      for (const [value,text] of [['dnf','DNF; organizer may void the round'],['void','Void round and wait for reconnect']]) {
        const option = h('option', text); option.value = value; option.selected = value === s.disconnectPolicy; select.append(option);
      }
      select.addEventListener('change', () => c.change(s => { s.disconnectPolicy = select.value; Cup.touch(s); }));
      label.append(select); advanced.append(label); this.body.append(advanced);
    }
    if (c.canSpectate() && c.watchable().length) this.body.append(this.spectatorControls());
  }
  scoreboard() {
    const s = this.c.state, board = h('div', undefined, 'scoreboard'), rows = standings(s);
    const winners = rows.filter(r => r.winner), racers = rows.filter(r => !r.winner);
    if (winners.length) {
      const podium = h('div', undefined, 'winner-strip'); podium.append(h('small', 'CUP WINNER'));
      for (const r of winners) podium.append(this.racerName(r.id, this.name(r.id)));
      board.append(podium);
    }
    const heading = h('div', undefined, 'ranking-heading'); heading.append(h('strong', s.phase === 'racing' ? 'ROUND RANKING' : 'CUP STANDINGS'), h('small', '100 PT CUP')); board.append(heading);
    for (const [i,r] of racers.entries()) {
      const row = h('div', undefined, `score-row${i === 0 ? ' leader' : ''}${r.finalist ? ' finalist' : ''}${r.id === this.c.selfId ? ' self' : ''}`);
      const name = this.racerName(r.id, this.name(r.id)); name.title = this.name(r.id);
      const movement = h('small', r.movement > 0 ? `▲${r.movement}` : r.movement < 0 ? `▼${-r.movement}` : '', r.movement < 0 ? 'movement down' : 'movement up');
      movement.title = 'Places gained or lost in Cup standings this round';
      const points = h('span', undefined, 'points');
      const total = h('strong', r.finalist ? 'F' : String(r.score)); total.title = r.finalist ? 'Finalist: win an outright round to take the Cup' : `${r.score} of 100 points`;
      const gain = h('small', r.gain ? `+${r.gain}` : '', `point-gain${r.provisional ? ' projected' : ''}`); gain.title = r.provisional ? 'Provisional points if these finish positions hold' : 'Points gained this round';
      points.append(total, gain);
      const result = r.dnf ? 'DNF' : r.frames === undefined ? '—' : r.delta > 0 ? `+${time(r.delta)}` : time(r.frames);
      const timing = h('span', result, 'time'); timing.title = r.frames === undefined ? 'No finish recorded' : `Finish: ${time(r.frames)} s`;
      row.append(h('strong', r.position, 'position'), name, movement, points, timing); board.append(row);
    }
    board.append(h('p', s.phase === 'racing' ? 'Finished racers first · +points are provisional' : 'Green +points = last round · F = win to finish', 'ranking-note'));
    return board;
  }
  recordStrip(label, record, name, tooltip) {
    const strip = h('div', undefined, `record-strip record-${label.toLowerCase()}`); strip.title = tooltip;
    const status = !record ? 'Loading…' : record.status === 'missing' ? 'No record' : record.status === 'unavailable' ? 'Unavailable' : name;
    strip.append(h('strong', label), h('span', status, 'record-holder'), h('strong', record?.frames ? time(record.frames) : '—', 'record-time')); return strip;
  }
  renderHud() {
    this.hud.replaceChildren(); this.povHud.replaceChildren(); this.povHud.hidden = true; this.hud.hidden = !this.c.state || !Cup.currentMatch(this.c.state) || this.open;
    if (this.hud.hidden) return;
    const s = this.c.state, m = Cup.currentMatch(s), id = recordTrack(s), track = s.tracks.find(t => t.id === id);
    const title = h('div', undefined, 'hud-track'); title.append(h('strong', track?.name ?? s.name));
    const sub = h('div', undefined, 'hud-meta'), round = s.runtime?.round ?? Math.max(1,m.rounds);
    const picked = s.roster.filter(p => s.picks[p.id] === id).map(p => p.name).join(', ');
    sub.append(h('span', `Picked by ${picked}`), h('strong', `ROUND ${(round - 1) % 4 + 1}/4`)); title.append(sub);
    const status = h('div', undefined, 'hud-phase'); status.append(h('span', names[s.phase])); const clock = h('strong'); clock.dataset.clock = ''; status.append(clock); title.append(status);
    const records = s.records[id], tr = sessionRecord(s,id);
    this.hud.append(title, this.recordStrip('WR', records?.wr, records?.wr?.name, 'Overall leaderboard record. Official/community tracks use verified records; custom tracks use their public leaderboard.'),
      this.recordStrip('TR', tr ?? { status: 'missing' }, tr?.ids.map(id => this.name(id)).join(' / '), 'Fastest scored run on this track in this Cup, including current round provisionally. Voided rounds are excluded.'), this.scoreboard());
    if (this.c.canSpectate()) { this.povHud.hidden = false; this.povHud.append(this.spectatorControls()); }
    this.hud.append(h('p', 'F8 · Cup controls', 'hud-footer'));
  }
  spectatorControls() {
    const c = this.c, box = h('section', undefined, 'pov');
    box.append(h('small', 'RACER POV'), h('strong', c.watchId === null ? 'Waiting for racer' : this.name(c.watchId)));
    const id = recordTrack(c.state), pb = c.state.records[id]?.pbs[c.watchId];
    box.append(this.recordStrip('PB', pb, pb?.source === 'online' ? 'Overall · online' : 'Overall · player profile', 'Watched racer’s best for this track, including runs outside this Cup. Shared by their mod; never inferred from their nickname.'));
    const controls = h('div', undefined, 'controls');
    controls.append(this.button('← [', () => c.cycleWatch(-1), 'quiet'));
    const select = h('select'); select.setAttribute('aria-label', 'Spectate racer');
    for (const id of c.watchable()) { const option = h('option', this.name(id)); option.value = id; option.selected = id === c.watchId; select.append(option); }
    select.addEventListener('change', () => c.selectWatch(Number(select.value)));
    controls.append(select, this.button('] →', () => c.cycleWatch(1), 'quiet'));
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
