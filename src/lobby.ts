import type { CupUI } from './ui.ts';
import { element as h } from './dom.ts';
import { banTurn } from './draft.ts';
import type { CupState } from './types.ts';
export function countryFlag(code: unknown) {
  return typeof code === 'string' && /^[a-z]{2}$/i.test(code)
    ? 'images/countries/' + code.toLowerCase() + '.svg'
    : null;
}
export function lobbyView(s: CupState, selfId: number, editing = false) {
  const stage = s.draft?.stage ?? 'picks',
    joined = s.roster.some((p) => p.id === selfId);
  const turn = banTurn(s),
    pick = s.tracks.find((t) => t.id === s.picks[selfId]);
  const mode =
    stage === 'roster'
      ? 'join'
      : stage === 'bans'
        ? 'ban'
        : !joined
          ? 'spectator'
          : pick && !editing
            ? 'selected'
            : 'pick';
  return {
    stage,
    joined,
    turn,
    pick,
    mode,
    ready: s.roster.filter((p) => s.picks[p.id]).length,
    title:
      mode === 'join'
        ? joined
          ? 'You’re on the grid'
          : 'Join the race'
        : mode === 'ban'
          ? turn === selfId
            ? 'Your ban'
            : `${s.roster.find((p) => p.id === turn)?.name ?? 'Racer'}’s ban`
          : mode === 'selected'
            ? 'Your pick'
            : mode === 'pick'
              ? 'Choose your track'
              : 'Racers are picking',
  };
}
export function lobbyPanel(ui: CupUI) {
  const c = ui.c,
    s = c.state!,
    view = lobbyView(s, c.selfId!, ui.editingPick);
  const shell = h('section', undefined, 'cup-lobby'),
    roster = h('aside', undefined, 'lobby-roster'),
    action = h('section', undefined, 'lobby-action');
  roster.setAttribute('aria-label', 'Racer roster');
  action.setAttribute('aria-label', 'Current lobby action');
  const heading = h('div', undefined, 'lobby-roster-heading');
  heading.append(h('h2', `Racers · ${s.roster.length}/8`));
  roster.append(heading);
  const order = s.draft?.order.length ? s.draft.order : s.roster.map((p) => p.id);
  if (!order.length) roster.append(h('p', 'No racers yet.', 'muted'));
  for (const id of order) {
    const row = h(
      'div',
      undefined,
      `lobby-racer${view.turn === id ? ' current-turn' : ''}${id === c.selfId ? ' you' : ''}`,
    );
    const identity = ui.racerName(id, ui.name(id), true);
    const car = identity.querySelector('.car-skin');
    if (car) row.append(car);
    row.append(identity);
    if (!c.lobby.some((p) => p.id === id) || c.needsRebind?.has(id))
      row.append(h('small', 'Disconnected', 'ban-label'));
    const ban = s.draft?.bans[id],
      pick = s.tracks.find((t) => t.id === s.picks[id]);
    const choices = h('div', undefined, 'lobby-choices');
    if (s.draft && view.stage !== 'roster')
      choices.append(
        h('span', ban ? `× ${ban.name}` : view.turn === id ? 'Banning…' : '—', 'draft-ban'),
      );
    if (view.stage === 'picks')
      choices.append(
        h('span', pick ? `✓ ${pick.name}` : 'Pick pending', pick ? 'draft-pick' : 'muted'),
      );
    row.append(choices);
    roster.append(row);
  }
  const spectators = c.lobby.filter((p) => !s.roster.some((r) => r.id === p.id));
  if (spectators.length) {
    const more = h('details', undefined, 'lobby-spectators');
    more.append(h('summary', `Spectators · ${spectators.length}`));
    for (const p of spectators) more.append(ui.racerName(p.id, p.nickname, true));
    roster.append(more);
  }
  const actionTitle = h('h2', view.title);
  if (view.mode === 'ban' && view.turn !== c.selfId && view.turn !== null) {
    actionTitle.replaceChildren(ui.playerLabel(view.turn, ui.name(view.turn), true), '’s ban');
  }
  action.append(actionTitle);
  if (!s.draft && !view.joined) action.append(ui.joinControls());
  if (view.mode === 'join') {
    const join = ui.button(
      view.joined ? 'Switch to spectator' : 'Join as racer',
      () => c.action(view.joined ? 'leave' : 'join'),
      view.joined ? 'quiet' : 'primary',
    );
    join.disabled = !view.joined && s.roster.length >= 8;
    action.append(join);
    if (c.isHost) {
      const begin = ui.button('Begin bans', () => c.beginBans(), 'primary');
      begin.disabled = s.roster.length < 2;
      action.append(begin);
    } else action.append(h('p', 'Waiting for the organizer to begin bans.', 'muted'));
  } else if (view.mode === 'selected') {
    const card = h('div', undefined, 'selected-track');
    card.append(h('strong', view.pick!.name));
    try {
      const entry = c.availableTracks().find((t) => t.id === view.pick!.id);
      if (entry) {
        const image = h('img');
        image.alt = '';
        Promise.resolve(entry.thumbnail)
          .then((src) => {
            if (src && image.isConnected) image.src = src;
          })
          .catch(() => {});
        card.prepend(image);
      }
    } catch {}
    card.append(
      ui.button(
        'Change pick',
        () => {
          ui.editPick(true);
        },
        'quiet',
      ),
    );
    action.append(card);
    action.append(h('p', `${view.ready}/${s.roster.length} racers have picked`, 'muted'));
  } else if (view.mode === 'ban' || view.mode === 'pick') {
    if (view.mode === 'ban')
      action.append(
        h(
          'p',
          `Ban ${Object.keys(s.draft!.bans).length + 1}/${s.roster.length}`,
          'lobby-turn-count',
        ),
      );
    if (view.pick)
      action.append(
        ui.button(
          'Keep current pick',
          () => {
            ui.editPick(false);
          },
          'quiet',
        ),
      );
    ui.renderTrackChoices(action);
  } else action.append(h('p', `${view.ready}/${s.roster.length} racers have picked`, 'muted'));
  if (c.isHost && view.stage === 'picks') {
    const start = ui.button(
      c.startingCup ? 'Preparing tracks…' : 'Start Cup',
      () => c.startCup(),
      'primary lobby-start',
    );
    start.disabled = !!c.startingCup || s.roster.length < 2 || view.ready !== s.roster.length;
    action.append(start);
  }
  const rules = h('details', undefined, 'cup-rules');
  rules.append(
    h('summary', 'Rules'),
    h(
      'p',
      'One main/community ban each, then one pick. Custom picks allowed; duplicate picks count once.',
    ),
    h('p', '140 points, then win a later round outright. Points: 10 / 8 / 6 / 5 / 4 / 3 / 2 / 1.'),
    h(
      'p',
      'About four minutes of WR driving per track; four rounds without a WR. Tracks repeat until a finalist wins.',
    ),
    h(
      'p',
      'First-visit practice: 1.5× WR, minimum 30 seconds. All racers Ready ends practice early.',
    ),
  );
  action.append(rules);
  shell.append(roster, action);
  return shell;
}
