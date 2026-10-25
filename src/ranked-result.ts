import type { RankedMatchResult, RankedProfile, RankTier } from './ranked.ts';
const tiers: RankTier[] = [
  'provisional',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'grandmaster',
];
export function confirmedRatingResult(
  result: RankedMatchResult,
  playerId: string,
  before: RankedProfile | null,
  after: RankedProfile | null,
) {
  const player = result.players.find((p) => p.player_id === playerId);
  if (!player || player.rating_after === null || !Number.isFinite(player.rating_after)) return null;
  const current =
    after?.player_id === playerId && after.rating === player.rating_after ? after : null;
  // A later match/profile refresh must never manufacture a promotion for this result.
  const comparable =
    !!before &&
    !!current &&
    before.player_id === playerId &&
    before.rating === player.rating_before &&
    current.rated_matches === before.rated_matches + 1;
  const promoted =
    comparable &&
    !before.provisional &&
    !current.provisional &&
    tiers.indexOf(current.tier) > tiers.indexOf(before.tier);
  const revealed = comparable && before.provisional && !current.provisional;
  return {
    ...player,
    delta: player.rating_before === null ? null : player.rating_after - player.rating_before,
    profile: current,
    promoted,
    revealed,
  };
}
