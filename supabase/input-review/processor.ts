import { evaluateInput } from './evaluate.ts';
import { readFile } from 'node:fs/promises';
import { decodeRecording, digest, POLICY, type Reference } from './matcher.ts';

export async function loadCorpus(folder = 'output/input-review/references') {
  const manifest = JSON.parse(await readFile(folder + '/manifest.json', 'utf8')),
    references: Reference[] = [];
  const sources: string[] = [];
  const trackDigests: Record<string, string> = {};
  for (const t of manifest.tracks) {
    if (!/^[a-f0-9]{64}$/.test(t.track)) throw Error('Invalid cached track');
    const data = JSON.parse(await readFile(folder + '/' + t.track + '.json', 'utf8'));
    if (data.track !== t.track || data.gameVersion !== manifest.gameVersion)
      throw Error('Reference cache identity mismatch');
    trackDigests[t.track] = data.trackDigest;
    for (const e of data.entries.filter((e: any) => e.available && e.rank <= 10)) {
      if (digest(e.recording) !== e.sha256) throw Error('Reference cache digest mismatch');
      references.push({
        ...decodeRecording(e.recording, e.frames),
        id: e.id,
        track: t.track,
        gameVersion: data.gameVersion,
        rank: e.rank,
      });
      sources.push(
        JSON.stringify([
          t.track,
          e.id,
          e.sha256,
          e.frames,
          e.rank,
          data.gameVersion,
          data.trackDigest,
          data.fetchedAt,
        ]),
      );
    }
  }
  return {
    references,
    digest: digest(sources.sort().join('\n') + JSON.stringify(trackDigests)),
    manifest,
    trackDigests,
  };
}
/** Operator-owned local process. Public clients never supply match findings.
 * Source evidence remains client-reported, not hardware-attested or physics-verified. */
export async function processInputReviews(
  db: any,
  corpus: Awaited<ReturnType<typeof loadCorpus>>,
  limit = 40,
) {
  const rows = (
    await db.query(
      `select u.*,m.track_pool,t.transcript,v.digest validated_digest from public.polycup_input_runs u
 join public.polycup_ranked_matches m on m.id=u.match_id
 join public.polycup_ranked_validations v on v.match_id=m.id and v.method='local-peer-transcript-v1'
 join lateral(select transcript from public.polycup_ranked_transcripts where match_id=m.id order by player_id limit 1)t on true
 where m.status='completed' and not exists(select 1 from public.polycup_input_checks c where (c.match_id,c.player_id,c.round)=(u.match_id,u.player_id,u.round) and c.policy=$1 and c.corpus=$2)
 order by u.created_at limit $3`,
      [POLICY.version, corpus.digest, limit],
    )
  ).rows;
  for (const row of rows) {
    const { status, findings } = evaluateInput(row, corpus);
    await db.query(
      `insert into public.polycup_input_checks(match_id,player_id,round,status,policy,corpus,input_digest,findings) values($1,$2,$3,$4,$5,$6,$7,$8)
   on conflict(match_id,player_id,round) do update set status=excluded.status,policy=excluded.policy,corpus=excluded.corpus,input_digest=excluded.input_digest,findings=excluded.findings,checked_at=now()`,
      [
        row.match_id,
        row.player_id,
        row.round,
        status,
        POLICY.version,
        corpus.digest,
        digest(row.recording),
        JSON.stringify(findings),
      ],
    );
  }
  return rows.length;
}
