// Server-side policy for future validated match history. Never accept these
// summaries directly from a player as proof of performance or activity.
export type CupSummary = {
  matchId: string;
  startedAt: number;
  finishedAt: number;
  racers: number;
  place: number;
  rounds: number;
  finishedRounds: number;
  firstRoundPlace: number | null;
};
export type PlayerTag = {
  id: string;
  label: string;
  kind: 'activity' | 'performance';
  explanation: string;
};
export type TagContext = {
  // Counts/history must come from the server, with complete recent coverage.
  lifetimeCups: number;
  recentCups: CupSummary[];
  currentCupStartedAt: number | null;
  now: number;
};
const hour = 60 * 60 * 1000;
export function derivePlayerTags(context: TagContext): PlayerTag[] {
  const { lifetimeCups, now, currentCupStartedAt } = context;
  if (!Number.isFinite(now) || !Number.isSafeInteger(lifetimeCups) || lifetimeCups < 0) return [];
  const seen = new Set<string>();
  const cups = [...context.recentCups].filter(cup =>
    typeof cup.matchId === 'string' && cup.matchId.length > 0 &&
    Number.isFinite(cup.startedAt) && Number.isFinite(cup.finishedAt) &&
    cup.startedAt <= cup.finishedAt && cup.finishedAt <= now &&
    Number.isSafeInteger(cup.racers) && cup.racers >= 2 && cup.racers <= 8 &&
    Number.isSafeInteger(cup.place) && cup.place >= 1 && cup.place <= cup.racers &&
    Number.isSafeInteger(cup.rounds) && cup.rounds > 0 &&
    Number.isSafeInteger(cup.finishedRounds) && cup.finishedRounds >= 0 && cup.finishedRounds <= cup.rounds &&
    (cup.firstRoundPlace === null || (Number.isSafeInteger(cup.firstRoundPlace) && cup.firstRoundPlace >= 1 && cup.firstRoundPlace <= cup.racers))
  ).sort((a,b) => b.finishedAt - a.finishedAt).filter(cup => {
    if (seen.has(cup.matchId)) return false;
    seen.add(cup.matchId); return true;
  }).slice(0,20);
  // Missing or inconsistent history must not become a flattering tag.
  if (cups.length > lifetimeCups || (lifetimeCups > 0 && cups.length === 0)) return [];
  const tags: PlayerTag[] = [];
  const add = (id: string, label: string, kind: PlayerTag['kind'], explanation: string) =>
    tags.push({ id, label, kind, explanation });
  if (lifetimeCups < 5) {
    add('fresh-wheels','Fresh wheels','activity','Fewer than five completed Cups on this PolyCup account.');
  } else if (currentCupStartedAt !== null && Number.isFinite(currentCupStartedAt) && currentCupStartedAt <= now && cups.length) {
    const gap = currentCupStartedAt - cups[0].finishedAt;
    if (gap >= 7 * 24 * hour) add('back-on-track','Back on track','activity','First Cup after a break of at least a week.');
    else if (gap >= 8 * hour) add('waking-up','Waking up','activity','First Cup after a break of at least eight hours.');
  }
  if (cups.length >= 3 && cups.slice(0,3).every(cup => cup.place === 1))
    add('on-a-roll','On a roll','performance','Won their last three completed Cups.');
  const rounds = cups.reduce((n,cup) => n + cup.rounds,0);
  const finishes = cups.reduce((n,cup) => n + cup.finishedRounds,0);
  if (cups.length >= 10 && rounds >= 50 && finishes / rounds >= .95)
    add('consistent','Consistent','performance','Finished at least 95% of rounds across their latest Cups (at least 10 Cups and 50 rounds; up to 20 Cups).');
  const larger = cups.filter(cup => cup.racers >= 4);
  if (larger.length >= 10 && larger.filter(cup => cup.place <= 3).length / larger.length >= .6)
    add('podium-regular','Podium regular','performance','Placed in the top three in at least 60% of recent Cups with four or more racers (minimum 10 Cups).');
  const starts = larger.filter(cup => cup.firstRoundPlace !== null);
  if (starts.length >= 10 && starts.filter(cup => cup.firstRoundPlace === 1).length / starts.length >= .4)
    add('fast-starter','Fast starter','performance','Won the opening round in at least 40% of recent Cups with four or more racers (minimum 10 Cups).');
  return tags.slice(0,3);
}
