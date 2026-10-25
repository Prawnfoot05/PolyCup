import type { RaceRecord, RecordBaselines, RecordAward, Round, TrackRecords } from './types.ts';

export type PersonalRecord = Omit<RaceRecord, 'source'> & { source?: RaceRecord['source'] | 'cup' };
export function personalRecord(
  records: TrackRecords | undefined,
  id: number,
  liveFrames?: number,
): PersonalRecord | undefined {
  const saved = records?.pbs[id];
  const cup = Math.min(records?.cupPbs?.[id] ?? Infinity, liveFrames ?? Infinity);
  if (Number.isFinite(cup) && (saved?.status !== 'ready' || cup < saved.frames!))
    return { status: 'ready', frames: cup, source: 'cup' };
  return saved;
}

export function recordBaselines(records: TrackRecords | undefined): RecordBaselines {
  return {
    ...(records?.wr?.status === 'ready' ? { wr: records.wr.frames } : {}),
    ...(records?.tr ? { tr: records.tr.frames } : {}),
    pbs: Object.fromEntries(
      [
        ...new Set([...Object.keys(records?.pbs ?? {}), ...Object.keys(records?.cupPbs ?? {})]),
      ].flatMap<[string, number | null]>((id) => {
        const pb = personalRecord(records, Number(id));
        return pb?.status === 'ready'
          ? [[id, pb.frames!]]
          : pb?.status === 'missing'
            ? [[id, null]]
            : [];
      }),
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
