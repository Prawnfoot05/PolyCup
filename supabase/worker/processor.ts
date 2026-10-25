import { settleRankedInTransaction } from '../ranked-validator.ts';

// The adapter must pin one connection for each transaction, including savepoints.
export type Transaction = { query(sql: string, values?: any[]): Promise<any> };
export type Database = { transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> };

/** Only SQLSTATE codes are retained. Never log database messages, URLs or evidence. */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'WORKER_ERROR';
}

export async function discoverResults(db: Database, limit = 100) {
  return db.transaction(async tx => {
    // Same lock order as queue/session maintenance. No session locks or timers
    // are required, so transaction pooling is supported as well.
    await tx.query('select pg_advisory_xact_lock(777,1)');
    await tx.query('select public.polycup_ranked_expire()');
    await tx.query(`insert into public.polycup_ranked_result_jobs(match_id)
      select m.id from public.polycup_ranked_matches m
      where m.status in ('racing','review')
      and not exists(select 1 from public.polycup_ranked_result_jobs j where j.match_id=m.id)
      and public.polycup_ranked_result_ready(m.id)
      order by m.started_at,m.id limit $1 on conflict do nothing`, [limit]);
  });
}

/** A row lock is the claim. A dead process releases it; no lease can get stuck.
 * The job receipt and rating transaction commit together. Savepoint rollback
 * keeps partial rating writes out of the durable failure/retry receipt.
 */
export async function processNextResult(db: Database, work: {
  remaining?: number; allowOversized?: boolean; consumed?: (amount: number) => void;
} = {}) {
  return db.transaction(async tx => {
    const job = (await tx.query(`select * from public.polycup_ranked_result_jobs
      where finished_at is null and next_attempt_at<=now()
      order by next_attempt_at,created_at,match_id for update skip locked limit 1`)).rows[0];
    if (!job) return null;
    if (work.remaining !== undefined) {
      const cost = (await tx.query(`select coalesce((select max(jsonb_array_length(t.transcript->'rounds'))
        from public.polycup_ranked_transcripts t where t.match_id=m.id),0)
        * cardinality(m.roster) as cost from public.polycup_ranked_matches m where m.id=$1`, [job.match_id])).rows[0]?.cost ?? 0;
      // Check while holding the actual job lock: concurrent workers cannot swap
      // a cheap estimate for an expensive job between estimation and settlement.
      if (cost > work.remaining && !work.allowOversized) return 'budget';
      work.consumed?.(cost);
    }
    await tx.query('savepoint ranked_attempt');
    try {
      const outcome = await settleRankedInTransaction(tx, job.match_id);
      if (outcome === 'pending') {
        // Evidence can disappear when an account is deleted while queued.
        await tx.query(`update public.polycup_ranked_result_jobs set
          next_attempt_at=now()+interval '1 minute',outcome='pending'
          where match_id=$1`, [job.match_id]);
      } else {
        await tx.query(`update public.polycup_ranked_result_jobs set
          attempts=attempts+1,finished_at=now(),outcome=$2,last_error_code=null
          where match_id=$1`, [job.match_id, outcome ?? 'removed']);
      }
      await tx.query('release savepoint ranked_attempt');
      return outcome === 'completed' ? 'completed' : outcome === 'pending' ? 'pending' : 'unrated';
    } catch (error) {
      await tx.query('rollback to savepoint ranked_attempt');
      const attempts = job.attempts + 1;
      const delay = Math.min(900, 15 * 2 ** Math.min(attempts - 1, 6));
      await tx.query(`update public.polycup_ranked_result_jobs set attempts=attempts+1,
        next_attempt_at=now()+make_interval(secs=>$2::int),last_error_code=$3,outcome='retry'
        where match_id=$1`, [job.match_id, delay, errorCode(error)]);
      return 'retry';
    }
  });
}

export async function runResultBatch(db: Database, options: { limit?: number; budgetMs?: number; finishBudget?: number; signal?: AbortSignal } = {}) {
  const limit = options.limit ?? 20, budgetMs = options.budgetMs ?? 20_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 60_000)
    throw new Error('Invalid worker batch limits.');
  if (options.finishBudget !== undefined && (!Number.isInteger(options.finishBudget) || options.finishBudget < 1 || options.finishBudget > 10000))
    throw new Error('Invalid worker finish budget.');
  const summary = { completed: 0, unrated: 0, pending: 0, retry: 0, backlog: 0, attention: 0 };
  const end = Date.now() + budgetMs;
  let remaining = options.finishBudget;
  await discoverResults(db, limit);
  for (let i = 0; i < limit && Date.now() < end && !options.signal?.aborted; i++) {
    const result = await processNextResult(db, {
      remaining, allowOversized: i === 0,
      consumed: cost => { if (remaining !== undefined) remaining -= cost; },
    });
    if (!result || result === 'budget') break;
    summary[result]++;
    if (remaining !== undefined && remaining <= 0) break;
  }
  const counts = await db.transaction(async tx => (await tx.query(`select
    count(*)::int as backlog,
    count(*) filter(where attempts>=5 or created_at<now()-interval '10 minutes')::int as attention
    from public.polycup_ranked_result_jobs where finished_at is null`)).rows[0]);
  return { ...summary, ...counts };
}
