import type { CupState } from './types.ts';
export interface RankedTranscript {
  schema: 1;
  match: string;
  launch: string;
  order: string[];
  rounds: { round: number; track: string; finishes: { player: string; frames: number | null }[] }[];
}
export function rankedTranscript(
  state: CupState,
  launch: string,
  members: { account: string; native: number | null }[],
): RankedTranscript {
  if (state.phase !== 'complete' || state.matches.length !== 1)
    throw new Error('Cup is not complete.');
  const racers = members
    .map((m) => {
      if (m.native === null || !state.roster.some((p) => p.id === m.native))
        throw new Error('Waiting for verified racer identities.');
      return { account: m.account, native: m.native };
    })
    .sort((a, b) => a.account.localeCompare(b.account));
  return {
    schema: 1,
    match: state.id,
    launch,
    order: [...state.matches[0].order],
    rounds: state.matches[0].roundsLog.map((r) => ({
      round: r.round,
      track: r.trackId,
      finishes: racers.map((m) => ({ player: m.account, frames: r.finishes[m.native] ?? null })),
    })),
  };
}
export function verifyOwnFinishes(
  transcript: RankedTranscript,
  player: string,
  observed: Record<string, number>,
) {
  for (const r of transcript.rounds) {
    const finish = r.finishes.find((f) => f.player === player);
    if (!finish) throw new Error('Your racer is missing from the result.');
    if (finish.frames !== null && observed[`${r.round}:${r.track}`] !== finish.frames)
      throw new Error('The result does not match your recorded finish.');
    if (finish.frames === null && observed[`${r.round}:${r.track}`] !== undefined)
      throw new Error('The result omitted your recorded finish.');
  }
}
