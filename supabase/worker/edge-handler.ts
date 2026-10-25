import { connectWorker } from './postgres.mjs';
import { errorCode, runResultBatch, type Transaction } from './processor.ts';

// Keep the reusable secret out of pg_net's extension-owned request queue.
// Replays within the short validity window can only retry the same bounded
// processing action; row locks and atomic receipts still prevent double awards.
async function authorized(headers: Headers, secret: string): Promise<boolean> {
  const stamp=headers.get('x-polycup-time')??'', nonce=headers.get('x-polycup-nonce')??'';
  const signature=headers.get('x-polycup-signature')??'';
  if(!/^\d{10}$/.test(stamp) || !/^[a-f0-9-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature))return false;
  const age=Math.floor(Date.now()/1000)-Number(stamp);
  if(age < -10 || age > 90)return false;
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g)!,value=>parseInt(value,16));
  return crypto.subtle.verify('HMAC',key,bytes,encoder.encode(`polycup-results:v1:${stamp}:${nonce}`));
}

export function createResultHandler(env: Record<string, string | undefined>, connect = connectWorker,
  log: (value: unknown) => void = value => console.log(JSON.stringify(value))) {
  const respond = (status: number, body: unknown) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  return async (request: Request) => {
    if (request.method !== 'POST') return respond(405, { error: 'method_not_allowed' });
    const secret = env.POLYCUP_RESULT_CRON_TOKEN;
    if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return respond(503, { error: 'not_configured' });
    if (!await authorized(request.headers, secret)) return respond(401, { error: 'unauthorized' });
    if (env.POLYCUP_RESULT_WORKER_ENABLED !== '1') return respond(503, { error: 'disabled' });
    let db;
    try {
      db = await connect(env);
      // Small fixed batch amortizes connection/runtime setup across simultaneous
      // results. Each Cup still commits or rolls back independently.
      // Caller-provided payloads never change limits or choose matches/ratings.
      const summary = await runResultBatch(db, {
        limit: 4, budgetMs: 8_000, finishBudget: 2_000, signal: request.signal,
      });
      // Acknowledge after the settlement commits. Drain another ready Cup without
      // waiting for Cron; a failed/stale acknowledgement is recovered by Cron.
      try {
        await db.transaction((tx: Transaction) => tx.query('select public.polycup_ranked_dispatch_complete($1)',
          [request.headers.get('x-polycup-nonce')]));
      } catch { /* Never turn an already committed result into a failed request. */ }
      if (summary.completed || summary.unrated || summary.retry || summary.attention)
        log({ event: 'ranked_result_batch', ...summary });
      return respond(200, summary);
    } catch (error) {
      log({ event: 'ranked_result_batch_failed', code: errorCode(error) });
      return respond(503, { error: 'processing_unavailable' });
    } finally {
      try { await db?.close(); } catch { /* Next request creates a fresh pool. */ }
    }
  };
}
