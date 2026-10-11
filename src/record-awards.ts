import type { RecordBaselines, RecordAward, Round, TrackRecords } from './types.ts';

export function recordBaselines(records: TrackRecords | undefined): RecordBaselines {
  return {
    ...(records?.wr?.status === 'ready' ? { wr: records.wr.frames } : {}),
    ...(records?.tr ? { tr: records.tr.frames } : {}),
    pbs: Object.fromEntries(
      Object.entries(records?.pbs ?? {}).flatMap<[string, number | null]>(([id, pb]) =>
        pb.status === 'ready' ? [[id, pb.frames!]] : pb.status === 'missing' ? [[id, null]] : [],
      ),
    ),
  };
}
export function recordAward(run: Round, id: number, frames: number): RecordAward | null {
  const baseline = run.recordBaselines;
  const fastest = Math.min(...Object.values(run.finishes));
  if (baseline?.wr !== undefined && frames < Math.min(baseline.wr, fastest)) return 'WR';
  if (frames < Math.min(baseline?.tr ?? Infinity, fastest)) return 'TR';
  return personalBestAward(run, id, frames);
}
function personalBestAward(run: Round, id: number, frames: number): RecordAward | null {
  const pb = run.recordBaselines?.pbs[id];
  return pb === null || (pb !== undefined && frames < pb) ? 'PB' : null;
}
export function awardFinish(run: Round, id: number, frames: number) {
  const award = recordAward(run, id, frames);
  if (!award) return;
  const awards = (run.recordAwards ??= {});
  if (award === 'TR' || award === 'WR') {
    // Finish reports can arrive out of time order. Superseded shared records
    // must not remain on slower racers, but their personal improvements still count.
    for (const [racer, previous] of Object.entries(awards)) {
      if (previous !== 'TR' && previous !== 'WR') continue;
      const racerId = Number(racer);
      const pb = personalBestAward(run, racerId, run.finishes[racerId]);
      if (pb) awards[racerId] = pb;
      else delete awards[racerId];
    }
  }
  awards[id] = award;
}
