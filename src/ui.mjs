import * as Cup from './cup.mjs';
import { standings, recordTrack, sessionRecord } from './standings.mjs';
import { CupToolbar } from './toolbar.mjs';
import { CupInvite } from './invite.mjs';
import { formatTime as time, formatGap } from './time.mjs';
import { roundStartCue } from './countdown.mjs';
import { resultRows, resultsImage } from './results.mjs';
import css from './world-cup.css';
const h = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const names = { registration: 'Registration', loading: 'Loading track',
  warmup: 'Warmup', countdown: 'Get ready', racing: 'Live round', 'between-rounds': 'Round results', complete: 'Cup results' };
export class CupUI {
  constructor(controller) {
    this.c = controller; this.open = false; this.tab = 'Tournament'; this.signature = '';
    this.trackCategory = 'official'; this.trackQuery = ''; this.carThumbnails = new Map(); this.playerThumbnails = new Map();
    const root = h('div'); root.id = 'polytrack-world-cup'; document.body.append(root);
    this.shadow = root.attachShadow({ mode: 'open' });
    const style = h('style', css); this.shadow.append(style);
    this.toggle = this.button('PolyCup · F8', () => { this.open = !this.open; this.signature = ''; this.render(); }, 'launcher');
    this.panel = h('section', undefined, 'panel'); this.panel.setAttribute('aria-label', 'Simple Cup');
    this.hud = h('aside', undefined, 'hud'); this.povHud = h('aside', undefined, 'pov-hud');
    this.povRecordHud = h('aside', undefined, 'pov-record-hud');
    this.shadow.append(this.toggle, this.panel, this.hud, this.povHud, this.povRecordHud);
    this.toolbar = new CupToolbar({ fallback: this.toggle, hud: this.hud, toggle: () => this.toggle.click() });
    this.invite = new CupInvite();
    this.notice = h('div', undefined, 'notice'); this.notice.hidden = true;
    this.notice.setAttribute('role', 'status'); this.shadow.append(this.notice);
    this.startCue = h('div', undefined, 'start-countdown'); this.startCue.hidden = true;
    this.startCue.setAttribute('role','status'); this.startCue.setAttribute('aria-live','assertive');
    this.shadow.append(this.startCue);
    this.practiceHud = h('aside', undefined, 'practice-hud'); this.practiceHud.hidden = true;
    this.finishCue = h('section', undefined, 'finish-cue'); this.finishCue.hidden = true;
    this.finishCue.setAttribute('aria-label', 'Cup winner'); this.finishCue.setAttribute('role', 'dialog');
    this.shadow.append(this.practiceHud, this.finishCue);
    for (const type of ['keydown', 'keyup', 'keypress']) this.panel.addEventListener(type, e => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) e.stopPropagation();
    });
    // Game controls listen on window. Stop those listeners before they can cancel
    // editing, while leaving the browser's normal typing/selection/paste intact.
    for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, e => {
      const active = this.shadow.activeElement;
      if ((!this.panel.hidden || this.povHud.contains(active) || this.practiceHud.contains(active) || this.finishCue.contains(active)) && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) ||
        (active?.tagName === 'BUTTON' && ['Space', 'Enter'].includes(e.code))))
        e.stopImmediatePropagation();
    }, { capture: true });
    for (const panel of [this.panel, this.povHud, this.practiceHud, this.finishCue]) panel.addEventListener('focusin', e => {
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName) && this.c.game)
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
  ghostHotkey(event) {
    if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !this.c.game ||
      this.c.info?.disposed || !this.c.state || document.querySelector('dialog[open],.settings-menu-ui') ||
      event.composedPath().some(e => ['INPUT','TEXTAREA','SELECT'].includes(e.tagName) || e.isContentEditable)) return;
    this.toggleGhosts(); event.preventDefault();
  }
  toggleGhosts() {
    this.c.toggleGhosts();
    this.ghostHintCup = this.c.state?.id;
    this.showNotice(this.c.hideOtherGhosts ? 'Other ghosts hidden' : 'Other ghosts shown', 1600);
    this.signature = ''; this.render();
  }
  showNotice(text, duration) {
    this.notice.textContent = text; this.notice.hidden = false; clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { this.notice.hidden = true; }, duration);
  }
  name(id) { return Cup.player(this.c.state, id)?.name ?? `Player ${id}`; }
  render() {
    const c = this.c, s = c.state;
    if (c.panelRequest.revision !== this.seenPanelRequest) {
      this.seenPanelRequest = c.panelRequest.revision;
      if (c.panelRequest.revision > 0) {
        this.open = c.panelRequest.open;
        if (this.open) {
          this.tab = s?.phase === 'complete' ? 'Results' : 'Tournament';
          if (c.game && !c.info?.disposed) c.native?.clearInput?.(c.game);
        } else this.shadow.activeElement?.blur();
        if (c.panelRequest.message) this.showNotice(c.panelRequest.message, 6500);
      }
    }
    this.renderCompletion();
    this.toolbar.sync(this.open);
    this.invite.update(c.connection, this.open);
    this.panel.hidden = !this.open;
    this.renderStartCue();
    if (!this.open && s?.runtime && ['warmup', 'countdown', 'racing'].includes(s.phase) &&
      Cup.activeIds(s).includes(c.selfId) && this.ghostHintCup !== s.id) {
      const keys = c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) ?? [] : [];
      if (keys.length) {
        this.ghostHintCup = s.id; this.showNotice(`${keys.join(' / ')} · Toggle other ghosts`, 6000);
      }
    }
    const key = JSON.stringify([this.open, this.tab, s?.id, s?.revision, c.isHost, c.selfId,
      c.lobby.map(p => [p.id, p.nickname, c.hello.has(p.id), p.carStyle?.serialize()]), c.error, !!c.connection, c.auto, c.watchId, c.watchStatus, c.transferProgress, c.hideOtherGhosts,
      c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) : null, !!c.startingCup, c.canSpectate()]);
    if (key !== this.signature) {
      // Preserve a partially entered track code/name when unrelated lobby updates arrive.
      const focus = this.shadow.activeElement?.dataset?.field;
      const inviteSelection = this.shadow.activeElement === this.invite.input
        ? [this.invite.input.selectionStart, this.invite.input.selectionEnd] : null;
      const drafts = Object.fromEntries([...this.shadow.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e.value]));
      this.signature = key; this.panel.replaceChildren(); this.resultControls = null;
      const header = h('header');
      const title = h('div', undefined, 'header-title'); title.append(h('h1', 'PolyCup'));
      if (s) title.append(h('p', `${s.name} / ${names[s.phase]}`));
      const hide = this.button('Hide', () => { this.open = false; }, 'quiet header-hide');
      header.append(title, this.invite.element, hide); this.panel.append(header);
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
        if (this.resultControls) this.panel.append(this.resultControls);
        if (c.isHost) {
          const footer = h('footer');
          const exportButton = this.button('Export tournament', () => this.download(), 'quiet');
          exportButton.title = 'Download all results and race history. Autosaves stay on this device.';
          footer.append(exportButton);
          footer.append(this.button('End Cup for everyone', () => {
            if (!confirm('End this Cup for everyone and return to normal multiplayer? You can restore the autosave later.')) return;
            c.endCup();
          }, 'quiet'));
          this.panel.append(footer);
        }
      }
      for (const e of this.shadow.querySelectorAll('[data-field]')) if (e.dataset.field in drafts) e.value = drafts[e.dataset.field];
      if (focus && this.open) this.shadow.querySelector(`[data-field="${focus}"]`)?.focus();
      if (inviteSelection && this.open && !this.invite.input.disabled) {
        this.invite.input.focus(); this.invite.input.setSelectionRange(...inviteSelection);
      }
      this.renderHud();
    }
    for (const e of this.shadow.querySelectorAll('[data-clock]')) {
      const run = s?.runtime;
      const target = s?.phase === 'racing' ? run?.deadline : run?.startsAt;
      e.textContent = target ? `${Math.max(0, Math.ceil((target - c.now()) / 1000))}s` : '';
    }
  }
  welcome() {
    const content = h('div', undefined, 'body');
    content.append(h('h2', 'Multiplayer required'), h('p', 'Host or join a multiplayer lobby.'));
    this.panel.append(content);
  }
  renderStartCue() {
    const c=this.c, value=roundStartCue(c.state,c.info?.disposed ? null : c.info?.sessionId,c.now());
    if (value===this.startCueValue) return;
    this.startCueValue=value;this.startCue.hidden=!value;this.startCue.replaceChildren();
    if (!value) return;
    const signal=h('div',undefined,`start-signal${value==='GO'?' go':''}`);
    signal.append(h('span',value,'start-number'));
    const lights=h('div',undefined,'start-lights');lights.setAttribute('aria-hidden','true');
    for(let i=0;i<3;i++) lights.append(h('i',undefined,value==='GO'||i<4-Number(value)?'lit':''));
    signal.append(lights);this.startCue.append(signal);
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
    }
    this.panel.append(body);
  }
  roster() {
    const s = this.c.state, c = this.c;
    const heading = h('div', undefined, 'roster-heading');
    const keys = c.game && !c.info?.disposed ? c.native?.ghostKeys?.(c.game) ?? [] : [];
    const ghosts = this.button(`${c.hideOtherGhosts ? 'Show' : 'Hide'} other ghosts${keys.length ? ` · ${keys.join(' / ')}` : ''}`, () => this.toggleGhosts(), 'quiet');
    ghosts.title = 'Local visibility only. Rebind in Settings → PolyCup. The watched racer stays visible.';
    ghosts.setAttribute('aria-pressed', String(c.hideOtherGhosts));
    heading.append(h('h2', `${s.roster.length} / 8 racers`), ghosts); this.body.append(heading);
    const list = h('div', undefined, 'rows');
    for (const p of s.roster) {
      const row = h('div', undefined, 'row');
      row.append(this.racerName(p.id, p.name));
      const pick = s.tracks.find(t => t.id === s.picks[p.id]); row.append(h('span', pick?.name ?? 'Choosing a track…', pick ? 'badge' : 'muted'));
      const online = c.lobby.some(l => l.id === p.id);
      if (!online || c.needsRebind?.has(p.id)) row.append(h('small', c.needsRebind?.has(p.id) ? 'Confirm identity' : 'Disconnected', 'muted'));
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
      row.append(this.racerName(l.id, l.nickname));
      if (c.isHost && !l.isSelf && !c.hello.has(l.id)) row.append(h('small', 'Awaiting mod', 'muted'));
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
    this.thumbnail(id).then(url => { if (url && image.isConnected) image.src = url; });
    group.append(image, h('span', name)); return group;
  }
  async thumbnail(id) {
    const style = this.c.lobby.find(p => p.id === id)?.carStyle;
    if (style) {
      const key = style.serialize();
      if (!this.carThumbnails.has(key)) {
        if (this.carThumbnails.size >= 64) this.carThumbnails.delete(this.carThumbnails.keys().next().value);
        this.carThumbnails.set(key, this.c.native.carThumbnail(style).catch(() => null));
      }
      this.playerThumbnails.set(id, this.carThumbnails.get(key));
    }
    return this.playerThumbnails.get(id) ?? null;
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
    this.body.append(h('h2', s.phase === 'registration' ? 'Track picks' : 'Track order'));
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
        if (!tracks.length) grid.append(h('p', this.trackCategory === 'custom' && !this.trackQuery ? 'No saved custom tracks.' : 'No matching tracks.', 'muted'));
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
          const text = h('span'); text.append(h('strong', track.name));
          if (selected || track.author) text.append(h('small', selected ? 'Your pick' : track.author, 'muted'));
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
    if (s.phase === 'complete') { this.results(); return; }
    if (s.phase === 'registration') {
      const ready = s.roster.filter(p => s.picks[p.id]).length;
      const stats = h('div', undefined, 'setup-stats'); stats.append(h('span', `${s.roster.length}/8 racers`), h('span', `${ready}/${s.roster.length} tracks chosen`)); this.body.append(stats);
      this.body.append(this.joinControls());
      if (c.isHost) {
        const start = this.button(c.startingCup ? 'Preparing tracks…' : 'Shuffle tracks & start Cup', () => c.startCup(), 'primary');
        start.disabled = !!c.startingCup || s.roster.length < 2 || ready !== s.roster.length; this.body.append(start);
        if (s.roster.length < 2) this.body.append(h('p', 'At least 2 racers required.', 'muted'));
        else if (ready !== s.roster.length) this.body.append(h('p', 'Waiting for track picks.', 'muted'));
      } else this.body.append(h('p', 'Waiting for organizer.', 'muted'));
      const list = h('div', undefined, 'ready-list');
      for (const p of s.roster) {
        const row = h('div', undefined, 'row'), picked = s.tracks.find(t => t.id === s.picks[p.id]);
        row.append(this.racerName(p.id, p.name), h('span', picked ? `✓ ${picked.name}` : 'Choosing a track…', picked ? 'ready-pick' : 'muted')); list.append(row);
      }
      this.body.append(list);
      const rules = h('details', undefined, 'cup-rules'); rules.append(h('summary', 'Rules'));
      rules.append(h('p', `2–8 racers · ${Cup.RULES.target} points to become a finalist. Win a later round outright to win the Cup.`),
        h('p', 'Points: 10 / 8 / 6 / 5 / 4 / 3 / 2 / 1. Duplicate picks count once.'),
        h('p', 'Rounds per track: about 4 minutes ÷ WR time, fixed at Cup start. No WR: 4 rounds. Tracks repeat until a finalist wins.'),
        h('p', 'First visit practice: 1.5× WR, at least 30 seconds; 90 seconds without a WR. Everyone Ready ends practice early. Repeat visits skip practice.'),
        h('p', 'The organizer must stay connected. Use 16 lobby slots for spectator space.'));
      this.body.append(rules);
    } else {
      this.body.append(this.scoreboard());
      if (s.runtime) {
        const status = h('p', `Round ${s.runtime.round} / ${s.tracks.find(t => t.id === s.runtime.trackId)?.name} `);
        const clock = h('strong'); clock.dataset.clock = ''; status.append(clock); this.body.append(status);
        if (s.phase === 'loading') this.body.append(h('p', `Loaded: ${s.runtime.ready.length}/${Cup.activeIds(s).length}`, 'muted'));
        if (s.phase === 'warmup') this.body.append(this.practiceControls());
        if (s.phase === 'racing' && Cup.activeIds(s).includes(c.selfId) && !Cup.roundDone(s, c.selfId))
          this.body.append(this.button('Retire this round (DNF)', () => { c.action('dnf', s.runtime.id); this.open = false; }, 'quiet'));
        if (Cup.roundDone(s, c.selfId) && !c.canSpectate() && c.watchable().length)
          this.body.append(this.button('Watch remaining racers', () => { c.watchRemaining(); this.open = false; }));
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
    if (c.canSpectate() && c.watchable().length) this.body.append(this.spectatorControls(), this.spectatorRecord());
  }
  scoreboard() {
    const s = this.c.state, board = h('div', undefined, 'scoreboard'), rows = standings(s);
    const winners = rows.filter(r => r.winner), racers = rows.filter(r => !r.winner);
    if (winners.length) {
      const podium = h('div', undefined, 'winner-strip'); podium.append(h('small', 'CUP WINNER'));
      for (const r of winners) podium.append(this.racerName(r.id, this.name(r.id)));
      board.append(podium);
    }
    const heading = h('div', undefined, 'ranking-heading'); heading.append(h('strong', s.phase === 'racing' ? 'ROUND RANKING' : 'CUP STANDINGS')); board.append(heading);
    for (const [i,r] of racers.entries()) {
      const row = h('div', undefined, `score-row${i === 0 ? ' leader' : ''}${r.finalist ? ' finalist' : ''}${r.id === this.c.selfId ? ' self' : ''}`);
      const name = this.racerName(r.id, this.name(r.id)); name.title = this.name(r.id);
      const movement = h('small', r.movement > 0 ? `▲${r.movement}` : r.movement < 0 ? `▼${-r.movement}` : '', r.movement < 0 ? 'movement down' : 'movement up');
      movement.title = 'Places gained or lost in Cup standings this round';
      const points = h('span', undefined, 'points');
      const total = h('strong', r.finalist ? 'F' : String(r.score)); total.title = r.finalist ? 'Finalist: win an outright round to take the Cup' : `${r.score} of ${Cup.currentMatch(s).target} points`;
      const gain = h('small', r.gain ? `+${r.gain}` : '', `point-gain${r.provisional ? ' projected' : ''}`); gain.title = r.provisional ? 'Provisional points if these finish positions hold' : 'Points gained this round';
      points.append(total, gain);
      const result = r.dnf ? 'DNF' : r.frames === undefined ? '—' : r.delta > 0 ? formatGap(r.delta) : time(r.frames);
      const timing = h('span', result, 'time'); timing.title = r.frames === undefined ? 'No finish recorded' : `Finish: ${time(r.frames)}`;
      row.append(h('strong', r.position, 'position'), name, movement, points, timing); board.append(row);
    }
    return board;
  }
  recordStrip(label, record, name, tooltip) {
    const strip = h('div', undefined, `record-strip record-${label.toLowerCase()}`); strip.title = tooltip;
    const status = !record ? 'Loading…' : record.status === 'missing' ? 'No record' : record.status === 'unavailable' ? 'Unavailable' : name;
    strip.append(h('strong', label), h('span', status, 'record-holder'), h('strong', record?.frames ? time(record.frames) : '—', 'record-time')); return strip;
  }
  renderHud() {
    this.hud.replaceChildren(); this.povHud.replaceChildren(); this.povRecordHud.replaceChildren();
    this.practiceHud.replaceChildren(); this.practiceHud.hidden = true;
    this.povHud.hidden = true; this.povRecordHud.hidden = true; this.hud.hidden = !this.c.state || !Cup.currentMatch(this.c.state) || this.open;
    this.hud.classList.toggle('spectating', this.c.canSpectate());
    if (this.hud.hidden) return;
    const s = this.c.state, m = Cup.currentMatch(s), id = recordTrack(s), track = s.tracks.find(t => t.id === id);
    const title = h('div', undefined, 'hud-track'); title.append(h('strong', track?.name ?? s.name));
    const sub = h('div', undefined, 'hud-meta'), round = s.runtime?.round ?? Math.max(1,m.rounds);
    const visit = Cup.trackProgress(s, round - 1);
    const picked = s.roster.filter(p => s.picks[p.id] === id).map(p => p.name).join(', ');
    const picker = h('span', `Picked by ${picked}`); picker.title = picked;
    sub.append(picker, h('strong', `ROUND ${visit.round}/${visit.rounds}`)); title.append(sub);
    const status = h('div', undefined, 'hud-phase'); status.append(h('span', names[s.phase])); const clock = h('strong'); clock.dataset.clock = ''; status.append(clock); title.append(status);
    const records = s.records[id], tr = sessionRecord(s,id);
    const summary = h('div', undefined, 'hud-summary');
    summary.append(title, this.recordStrip('WR', records?.wr, records?.wr?.name, 'Overall leaderboard record. Official/community tracks use verified records; custom tracks use their public leaderboard.'),
      this.recordStrip('TR', tr ?? { status: 'missing' }, tr?.ids.map(id => this.name(id)).join(' / '), 'Fastest scored run on this track in this Cup, including current round provisionally. Voided rounds are excluded.'));
    this.hud.append(summary, this.scoreboard());
    if (s.phase === 'warmup') { this.practiceHud.hidden = false; this.practiceHud.append(this.practiceControls()); }
    else if (Cup.roundDone(s, this.c.selfId) && !this.c.canSpectate() && this.c.watchable().length) {
      this.practiceHud.hidden = false;
      this.practiceHud.append(this.button('Watch remaining racers', () => this.c.watchRemaining()));
    }
    if (this.c.canSpectate() && this.c.watchable().length) {
      this.povHud.hidden = false; this.povHud.append(this.spectatorControls());
      this.povRecordHud.hidden = false; this.povRecordHud.append(this.spectatorRecord());
    }
  }
  spectatorControls() {
    const c = this.c, box = h('section', undefined, 'pov'), racers = c.watchable();
    box.setAttribute('aria-label', 'Spectator controls');
    const previous = this.button('', () => c.cycleWatch(-1), 'pov-cycle previous');
    const next = this.button('', () => c.cycleWatch(1), 'pov-cycle next');
    for (const [button, label, key] of [[previous, 'Previous racer', '['], [next, 'Next racer', ']']]) {
      button.setAttribute('aria-label', `${label} (${key})`); button.setAttribute('aria-keyshortcuts', key);
      button.title = `${label} (${key})`; button.disabled = racers.length < 2;
      const icon = h('span', undefined, 'pov-arrow'); icon.setAttribute('aria-hidden', 'true'); button.append(icon);
    }
    const main = h('div', undefined, 'pov-main'), name = h('div', undefined, 'pov-name');
    const select = h('select'); select.setAttribute('aria-label', 'Spectate racer'); select.disabled = !racers.length;
    if (!racers.length) select.append(h('option', 'Waiting for racer'));
    for (const id of racers) { const option = h('option', this.name(id)); option.value = id; option.selected = id === c.watchId; select.append(option); }
    select.title = racers.includes(c.watchId) ? this.name(c.watchId) : 'Choose racer';
    select.addEventListener('change', () => { c.selectWatch(Number(select.value)); this.signature = ''; this.render(); });
    name.append(select);
    main.append(name); box.append(previous, main, next); return box;
  }
  spectatorRecord() {
    const c = this.c, id = recordTrack(c.state), watching = c.watchable().includes(c.watchId);
    const pb = watching ? c.state.records[id]?.pbs[c.watchId] : null;
    const record = h('div', undefined, 'pov-pb');
    const best = !watching ? '—' : !pb ? 'Loading…' : pb.frames ? time(pb.frames) : pb.status === 'unavailable' ? 'Unavailable' : 'No record';
    record.title = `${watching ? `${this.name(c.watchId)} — ` : ''}Overall personal best for this track${pb?.source ? ` (${pb.source === 'online' ? 'online leaderboard' : 'saved profile'})` : ''}`;
    record.append(h('span', 'PB'), h('strong', best));
    return record;
  }
  results() {
    const s = this.c.state;
    if (s.phase === 'complete') {
      const board = h('div', undefined, 'final-standings');
      board.append(h('h2', 'Final standings'));
      for (const r of resultRows(s)) {
        const row = h('div', undefined, `final-row${r.winner ? ' champion' : ''}`);
        const score = h('span', r.score, 'final-score'); score.title = 'Cup points';
        row.append(h('strong', r.place), this.racerName(r.id, r.name));
        if (r.winner) row.append(h('span', 'Winner', 'winner-label'));
        row.append(score); board.append(row);
      }
      this.body.append(board);
      const controls = h('div', undefined, 'controls result-controls');
      if (this.c.isHost) controls.append(this.button('Race again', () => this.c.rematch(), 'primary'),
        this.button('Choose new tracks', () => this.c.rematch(true)));
      controls.append(this.button('Save results image', () => this.downloadImage(), 'quiet')); this.resultControls = controls;
    }
    const history = h('details', undefined, 'race-history');
    history.append(h('summary', this.c.isHost ? 'Race history' : 'Latest round'));
    const parent = this.body; this.body.append(history); this.body = history;
    if (!s.matches.length) this.body.append(h('p', 'No scored rounds yet.', 'muted'));
    for (const m of s.matches) {
      this.body.append(h('h3', m.name));
      if (!m.roundsLog.length) this.body.append(h('p', 'No scored rounds yet.', 'muted'));
      for (const r of m.roundsLog.slice(-20).reverse()) {
        this.body.append(h('p', `Round ${r.round}: ${m.players.map(id => `${this.name(id)} ${r.finishes[id] === undefined ? 'DNF' : time(r.finishes[id])}`).join(' / ')}${r.tiedFirst ? ' · Tied first: no finalist win' : ''}`, 'history'));
      }
    }
    this.body = parent;
  }
  practiceControls() {
    const c = this.c, s = c.state, run = s.runtime, box = h('div', undefined, 'practice-controls');
    const ready = run.practiceReady ?? [], ids = Cup.activeIds(s);
    const count = h('span', `${ready.length}/${ids.length} ready`), clock = h('strong'); clock.dataset.clock = '';
    box.append(count, clock);
    if (ids.includes(c.selfId)) {
      const button = this.button(ready.includes(c.selfId) ? 'Ready ✓' : 'Ready', () => c.action('practice-ready', run.id), 'primary');
      button.disabled = ready.includes(c.selfId); box.append(button);
    }
    return box;
  }
  renderCompletion() {
    const s = this.c.state, winner = s?.phase === 'complete' ? resultRows(s).find(r => r.winner) : null;
    if (!winner) { clearTimeout(this.finishTimer); this.finishCue.hidden = true; this.finishKey = null; return; }
    const key = `${s.id}:${Cup.currentMatch(s).rounds}:${winner.id}`;
    if (this.finishKey === key) return;
    this.finishKey = key; this.open = false; this.finishCue.hidden = false; this.finishCue.replaceChildren();
    const card = h('div', undefined, 'champion-card');
    card.append(h('h2', 'Cup winner'), this.racerName(winner.id, winner.name),
      this.button('View results', () => this.showResults(key), 'primary'));
    this.finishCue.append(card); clearTimeout(this.finishTimer);
    this.finishTimer = setTimeout(() => this.showResults(key), 4000);
  }
  showResults(key) {
    if (this.finishKey !== key || this.c.state?.phase !== 'complete') return;
    clearTimeout(this.finishTimer); this.finishCue.hidden = true;
    this.open = true; this.tab = 'Results'; this.signature = ''; this.render();
  }
  async downloadImage() {
    const state = structuredClone(this.c.state), blob = await resultsImage(state, id => this.thumbnail(id));
    const url = URL.createObjectURL(blob), a = h('a'); a.href = url; a.download = 'polycup-results.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  download() {
    const data = JSON.stringify(this.c.exportData(), null, 2), url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = h('a'); a.href = url; a.download = 'polytrack-world-cup-results.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
