import { statusIcon } from './status-icon.ts';
import type { CupUI } from './ui.ts';
import { element as h } from './dom.ts';
import { banTurn, banEntries } from './draft.ts';
import { chosenTracks, picksComplete, draftReady } from './cup.ts';
import { rulesFor } from './presets.ts';
import type { CupState } from './types.ts';
function draftBadge(name: string, banned: boolean, button?: HTMLButtonElement) {
  const badge = button ?? h('span');
  badge.classList.add('draft-badge', banned ? 'draft-ban' : 'draft-pick');
  badge.title = `${banned ? 'Banned' : 'Picked'}: ${name}`;
  badge.setAttribute('aria-label', badge.title);
  const icon = h('span', undefined, 'draft-badge-icon');
  icon.append(statusIcon(banned ? 'cross' : 'check'));
  icon.setAttribute('aria-hidden', 'true');
  badge.append(icon, h('span', name, 'draft-badge-name'));
  return badge;
}
export function countryFlag(code: unknown) {
  return typeof code === 'string' && /^[a-z]{2}$/i.test(code)
    ? 'images/countries/' + code.toLowerCase() + '.svg'
    : null;
}
export function lobbyView(s: CupState, selfId: number) {
  const stage = s.draft?.stage ?? 'picks',
    joined = s.roster.some((p) => p.id === selfId);
  const turn = banTurn(s),
    pick = s.tracks.find((t) => t.id === s.picks[selfId]);
  const mode =
    stage === 'roster' ? 'join' : stage === 'bans' ? 'ban' : !joined ? 'spectator' : 'pick';
  return {
    stage,
    joined,
    turn,
    pick,
    mode,
    ready: s.roster.filter((p) => draftReady(s, p.id)).length,
    title:
      mode === 'join'
        ? joined
          ? 'You’re on the grid'
          : 'Join the race'
        : mode === 'ban'
          ? turn === selfId
            ? 'Your ban'
            : `${s.roster.find((p) => p.id === turn)?.name ?? 'Racer'}’s ban`
          : mode === 'pick'
            ? draftReady(s, selfId)
              ? 'Ready to race'
              : rulesFor(s).picksPerRacer > 1
                ? 'Choose your tracks'
                : 'Choose your track'
            : 'Racers are picking',
  };
}
export function lobbyPanel(ui: CupUI) {
  const c = ui.c,
    s = c.state!,
    view = lobbyView(s, c.selfId!);
  const shell = h('section', undefined, 'cup-lobby'),
    roster = h('aside', undefined, 'lobby-roster'),
    action = h('section', undefined, 'lobby-action');
  shell.classList.toggle('drafting', view.mode !== 'join');
  roster.setAttribute('aria-label', 'Racer roster');
  action.setAttribute('aria-label', 'Current lobby action');
  const rules = rulesFor(s);
  const heading = h('div', undefined, 'lobby-roster-heading');
  heading.append(h('h2', `Racers · ${s.roster.length}/${c.ranked ? s.roster.length : 8}`));
  roster.append(heading);
  const order = s.draft?.order.length ? s.draft.order : s.roster.map((p) => p.id);
  if (!order.length) roster.append(h('p', 'No racers yet.', 'muted'));
  for (const id of order) {
    const row = h(
      'div',
      undefined,
      `lobby-racer${view.turn === id ? ' current-turn' : ''}${id === c.selfId ? ' you' : ''}`,
    );
    const identity = ui.racerName(id, ui.name(id), true, true);
    const ready = draftReady(s, id);
    row.classList.toggle('draft-ready', ready);
    const car = identity.querySelector('.car-skin');
    if (car) row.append(car);
    const badge = ui.lobbyRank(id);
    if (badge) identity.insertBefore(badge, identity.querySelector('.player-actions-toggle'));
    identity.insertBefore(ui.playerPing(id), identity.querySelector('.player-actions-toggle'));
    row.append(identity);
    const meta = h('div', undefined, 'lobby-meta');
    const disconnected = !c.lobby.some((p) => p.id === id) || c.needsRebind?.has(id);
    const status = disconnected
      ? 'Offline'
      : view.turn === id
        ? 'Banning…'
        : view.stage === 'picks'
          ? ready
            ? '✓ Ready'
            : picksComplete(s, id)
              ? 'Not ready'
              : 'Picking…'
          : '';
    if (status)
      meta.append(h('span', status, `racer-ready-status${disconnected ? ' offline' : ''}`));
    row.append(meta);
    const bans = banEntries(s).filter((b) => b.racerId === id),
      picks = chosenTracks(s, id).map((key) => s.tracks.find((t) => t.id === key));
    const choices = h('div', undefined, 'lobby-choices');
    const banGroup = h('div', undefined, 'lobby-ban-choices');
    const pickGroup = h('div', undefined, 'lobby-pick-choices');
    if (view.stage !== 'roster') {
      for (const [kind, count, group] of [
        ['ban', rules.bansPerRacer, banGroup],
        ['pick', rules.picksPerRacer, pickGroup],
      ] as const)
        for (let index = 0; index < count; index++) {
          const slot = h('div', undefined, 'draft-slot');
          const pick = kind === 'ban' ? bans[index]?.track : picks[index];
          if (!pick) {
            const label = `${kind === 'ban' ? 'Ban' : 'Pick'} ${index + 1}`;
            const empty = draftBadge(label, kind === 'ban');
            empty.classList.add('draft-empty');
            empty.title = `${label} not selected`;
            empty.setAttribute('aria-label', empty.title);
            slot.append(empty);
            group.append(slot);
            continue;
          }
          const unpick =
            kind === 'pick' && view.stage === 'picks' && id === c.localPlayerId && !ready
              ? ui.button('', () => c.action('remove-pick', pick.id), '', `track:unpick:${pick.id}`)
              : undefined;
          const badge = draftBadge(pick.name, kind === 'ban', unpick);
          ui.animateDraftSlot(badge, id, kind, index);
          if (unpick) {
            badge.title = `Unpick ${pick.name}`;
            badge.setAttribute('aria-label', badge.title);
            unpick.disabled = !!c.pendingUpload;
          }
          slot.append(badge);
          group.append(slot);
        }
    }
    if (banGroup.childElementCount) choices.append(banGroup);
    if (pickGroup.childElementCount) choices.append(pickGroup);
    row.append(choices);
    roster.append(row);
  }
  if (view.mode === 'join') {
    const join = ui.button(view.joined ? 'Joined' : 'Join', () => c.action('join'), 'primary');
    join.disabled = view.joined || s.roster.length >= 8;
    roster.append(join);
    ui.explainDisabled(
      join,
      !view.joined && s.roster.length >= 8 ? 'All 8 racer slots are occupied.' : '',
    );
  }
  const spectators = c.lobby.filter((p) => !s.roster.some((r) => r.id === p.id));
  const more = h('section', undefined, 'lobby-spectators');
  more.append(h('h2', `Spectators · ${spectators.length}`));
  if (!spectators.length) more.append(h('p', 'No spectators.', 'muted'));
  for (const p of spectators) {
    const row = h('div', undefined, `lobby-racer${p.id === c.selfId ? ' you' : ''}`);
    const identity = ui.racerName(p.id, p.nickname, true, true),
      car = identity.querySelector('.car-skin');
    if (car) row.append(car);
    identity.insertBefore(ui.playerPing(p.id), identity.querySelector('.player-actions-toggle'));
    row.append(identity);
    more.append(row);
  }
  if (view.mode === 'join') {
    const spectate = ui.button(
      view.joined ? 'Spectate' : 'Spectating',
      () => c.action('leave'),
      'primary',
    );
    spectate.disabled = !view.joined;
    more.append(spectate);
  }
  if (!c.ranked) roster.append(more);
  if (!s.draft && !view.joined) action.append(ui.joinControls());
  if (view.mode === 'join') {
    if (c.isHost) {
      const begin = ui.button(
        rules.selection === 'random'
          ? c.startingCup
            ? 'Preparing tracks…'
            : 'Start Cup'
          : rules.bansPerRacer
            ? 'Begin bans'
            : 'Begin picks',
        () => (rules.selection === 'random' ? c.startCup() : c.beginBans()),
        'primary',
      );
      begin.disabled = s.roster.length < 2 || ui.presetDirty || !!c.startingCup;
      begin.dataset.setupStart = '';
      begin.title =
        s.roster.length < 2
          ? 'At least two racers are needed.'
          : ui.presetDirty
            ? 'Finish editing the rules to continue.'
            : '';
      ui.setLobbyStart(begin);
    } else
      roster.append(
        h(
          'p',
          `Waiting for the organizer to ${rules.selection === 'random' ? 'start the Cup' : rules.bansPerRacer ? 'begin bans' : 'begin picks'}.`,
          'muted',
        ),
      );
  } else if (view.mode === 'ban' || view.mode === 'pick') {
    ui.renderTrackChoices(action);
  } else action.append(h('p', `${view.ready}/${s.roster.length} racers ready`, 'muted'));
  const selfReady = draftReady(s, c.selfId!);
  let readyButton: HTMLButtonElement | undefined;
  if (view.joined && view.stage === 'picks') {
    readyButton = ui.button(
      selfReady ? 'Unready' : 'Ready up',
      () => c.action('draft-ready', selfReady ? 'editing' : 'ready'),
      selfReady && c.isHost ? 'quiet' : 'primary',
      'track:draft-ready',
    );
    const connecting = c.waitingRoom?.snapshot?.data.launch?.stage;
    readyButton.disabled =
      !picksComplete(s, c.selfId!) ||
      !!c.pendingUpload ||
      (c.ranked && connecting === 'grace') ||
      connecting === 'connecting' ||
      connecting === 'racing';
    readyButton.title = !readyButton.disabled
      ? ''
      : connecting
        ? 'The Cup is starting.'
        : c.pendingUpload
          ? 'Your track is still uploading.'
          : 'Choose all your tracks first.';
    ui.setLobbyStart(readyButton);
  }
  if (c.isHost && !c.ranked && view.stage === 'picks' && (!view.joined || selfReady)) {
    const start = ui.button(
      c.startingCup ? 'Starting…' : 'Start Cup',
      () => c.startCup(),
      'primary lobby-start',
    );
    start.disabled =
      !!c.startingCup || s.roster.length < 2 || view.ready !== s.roster.length || ui.presetDirty;
    start.title =
      s.roster.length < 2
        ? 'At least two racers are needed.'
        : view.ready !== s.roster.length
          ? `${view.ready}/${s.roster.length} racers ready`
          : ui.presetDirty
            ? 'Finish editing the rules to continue.'
            : '';
    ui.setLobbyStart(start, readyButton);
  }
  if (view.mode === 'join') {
    const preset = ui.presetPanel();
    preset.classList.add('preset-at-top');
    action.append(preset);
  }
  const people = h('div', undefined, 'lobby-column');
  people.append(roster, h('div', undefined, 'lobby-chat-slot'));
  shell.append(people, action);
  return shell;
}
