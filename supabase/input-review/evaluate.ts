import { decodeRecording, digest, inspect } from './matcher.ts';
export function evaluateInput(row: any, corpus: any) {
  const round = row.transcript.rounds.find((r: any) => r.round === row.round),
    finish = round?.finishes.find((f: any) => f.player === row.player_id)?.frames;
  let status = 'no_match',
    findings: any[] = [];
  if (
    digest(JSON.stringify(row.transcript)) !== row.validated_digest ||
    !round ||
    round.track !== row.track ||
    finish !== row.finish
  )
    status = 'invalid';
  else {
    const entry = corpus.manifest.tracks.find((t: any) => t.track === row.track);
    const refs = corpus.references.filter(
      (r: any) => r.track === row.track && r.gameVersion === row.game_version,
    );
    if (
      !entry ||
      !refs.length ||
      !row.track_pool.some(
        (t: any) => t.id === row.track && t.digest === corpus.trackDigests[row.track],
      )
    )
      status = 'no_reference';
    else
      try {
        findings = inspect(
          decodeRecording(row.recording, row.native_finish),
          row.track,
          row.game_version,
          refs,
        ).map((f) => ({
          ...f,
          kind: row.time_offset > 0 ? 'segment' : f.kind,
          start: f.start + row.time_offset,
          end: f.end + row.time_offset,
          coverage: (f.end - f.start) / row.finish,
        }));
        status = findings.length ? 'flagged' : row.time_offset > 0 ? 'partial' : 'no_match';
        // A late start or start reset shifts the Cup clock. The native recording is
        // still comparable, but never claim coverage of the unrecorded prefix.
      } catch {
        status = 'invalid';
      }
  }

  return { status, findings };
}
