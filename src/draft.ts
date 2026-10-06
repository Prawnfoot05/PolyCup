import type { CupState, Track } from './types.ts';
// Optional on old saves; every newly created Cup enables the ban draft.
function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export const rosterOpen = (s: CupState) =>
  s.phase === 'registration' && (!s.draft || s.draft.stage === 'roster');
export const picksOpen = (s: CupState) =>
  s.phase === 'registration' && (!s.draft || s.draft.stage === 'picks');
export const banTurn = (s: CupState) =>
  s.draft?.stage === 'bans' ? s.draft.order[Object.keys(s.draft.bans).length] : null;
export const isBanned = (s: CupState, id: string) =>
  Object.values(s.draft?.bans ?? {}).some((t) => t.id === id);
export function resetDraft(s: CupState) {
  requireThat(s.phase === 'registration', 'The Cup has already started.');
  s.draft = { stage: 'roster', order: [], bans: {} };
  s.picks = {};
  s.tracks = [];
  s.records = {};
  s.revision++;
}
export function beginBans(s: CupState, random = Math.random) {
  requireThat(rosterOpen(s), 'Bans have already started.');
  requireThat(s.roster.length >= 2, 'At least two racers are required.');
  const order = s.roster.map((p) => p.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  s.draft = { stage: 'bans', order, bans: {} };
  s.picks = {};
  s.tracks = [];
  s.records = {};
  s.revision++;
}
export function banTrack(
  s: CupState,
  actor: number,
  track: (Track & { category: string }) | undefined,
) {
  requireThat(
    s.draft && s.phase === 'registration' && banTurn(s) === actor,
    'Wait for your ban turn.',
  );
  requireThat(
    track && ['official', 'community'].includes(track.category) && /^[a-f0-9]{64}$/i.test(track.id),
    'Bans must come from the main or community track pool.',
  );
  requireThat(!isBanned(s, track.id), 'That track is already banned.');
  s.draft.bans[actor] = {
    id: track.id,
    name: String(track.name)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 64),
  };
  if (Object.keys(s.draft.bans).length === s.draft.order.length) s.draft.stage = 'picks';
  s.revision++;
}
export function validDraft(s: CupState) {
  const d = s.draft;
  if (d === undefined) return true; // Continue pre-draft saved Cups.
  if (
    !d ||
    !['roster', 'bans', 'picks'].includes(d.stage) ||
    !Array.isArray(d.order) ||
    !d.bans ||
    typeof d.bans !== 'object' ||
    Array.isArray(d.bans)
  )
    return false;
  const keys = Object.keys(d.bans),
    bans = Object.values(d.bans);
  if (d.stage === 'roster')
    return (
      s.phase === 'registration' &&
      !d.order.length &&
      !keys.length &&
      !s.tracks.length &&
      !Object.keys(s.picks).length
    );
  if (
    d.order.length < 2 ||
    d.order.length !== s.roster.length ||
    new Set(d.order).size !== d.order.length ||
    !d.order.every((id) => s.roster.some((p) => p.id === id)) ||
    keys.length > d.order.length ||
    !keys.every((id) => d.order.slice(0, keys.length).includes(Number(id))) ||
    !bans.every(
      (t) =>
        t &&
        typeof t.id === 'string' &&
        /^[a-f0-9]{64}$/i.test(t.id) &&
        typeof t.name === 'string' &&
        t.name.length <= 64,
    ) ||
    new Set(bans.map((t) => t.id)).size !== bans.length ||
    s.tracks.some((t) => isBanned(s, t.id))
  )
    return false;
  return d.stage === 'bans'
    ? s.phase === 'registration' &&
        keys.length < d.order.length &&
        !s.tracks.length &&
        !Object.keys(s.picks).length
    : keys.length === d.order.length;
}
