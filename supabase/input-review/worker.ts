import { evaluateInput } from './evaluate.ts';
import { trackCorpus } from './corpus.ts';
import { digest, POLICY } from './matcher.ts';
export async function runInputBatch(db: any) {
  const contexts = new Map<string, any>();
  const summary = { processed: 0, flagged: 0, retry: 0 };
  const started = Date.now();
  // One run per transaction: SKIP LOCKED prevents overlap, and a crash rolls
  // findings and blob disposal back together. Retried commits are already marked.
  for (let i = 0; i < 8 && Date.now() - started < 8000; i++) {
    const result = await db.transaction(async (tx: any) => {
      const row = (
        await tx.query(`select u.*
 from public.polycup_input_runs u join public.polycup_ranked_matches m on m.id=u.match_id
 join public.polycup_ranked_validations v on v.match_id=m.id and v.method='local-peer-transcript-v1'

 where u.processed_at is null and u.recording is not null and u.next_attempt_at<=now() and m.status='completed'
 and (select enabled from public.polycup_input_review_config where singleton)
 order by u.created_at,u.match_id,u.player_id,u.round limit 1 for update of u skip locked`)
      ).rows[0];
      if (!row) return null;
      await tx.query('savepoint input_run');
      const keys = [row.match_id, row.player_id, row.round];
      try {
        let context = contexts.get(row.match_id);
        if (!context) {
          context = (
            await tx.query(
              `select m.track_pool,t.transcript,v.digest validated_digest from public.polycup_ranked_matches m join public.polycup_ranked_validations v on v.match_id=m.id join lateral(select transcript from public.polycup_ranked_transcripts where match_id=m.id order by player_id limit 1)t on true where m.id=$1`,
              [row.match_id],
            )
          ).rows[0];
          contexts.set(row.match_id, context);
        }
        const corpus = trackCorpus(row.track),
          r = evaluateInput({ ...row, ...context }, corpus);
        await tx.query(
          `insert into public.polycup_input_checks(match_id,player_id,round,status,policy,corpus,input_digest,findings)
 values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(match_id,player_id,round) do update set status=excluded.status,policy=excluded.policy,corpus=excluded.corpus,input_digest=excluded.input_digest,findings=excluded.findings,checked_at=now()`,
          [
            ...keys,
            r.status,
            POLICY.version,
            corpus.digest,
            digest(row.recording),
            JSON.stringify(r.findings),
          ],
        );
        await tx.query(
          'update public.polycup_input_runs set processed_at=now(),recording=null where match_id=$1 and player_id=$2 and round=$3',
          keys,
        );
        return r.status;
      } catch (error) {
        const code =
          typeof (error as any)?.code === 'string' && /^[A-Z0-9]{5}$/.test((error as any).code)
            ? (error as any).code
            : 'OTHER';
        await tx.query('rollback to savepoint input_run');
        await tx.query(
          `update public.polycup_input_runs set last_error_code=$4,attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(900,15*(2^least(attempts,6))::integer)) where match_id=$1 and player_id=$2 and round=$3`,
          [...keys, code],
        );
        return 'retry';
      }
    });
    if (!result) break;
    if (result === 'retry') summary.retry++;
    else {
      summary.processed++;
      if (result === 'flagged') summary.flagged++;
    }
  }
  return summary;
}
