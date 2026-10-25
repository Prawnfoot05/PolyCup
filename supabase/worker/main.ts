import { setTimeout as sleep } from 'node:timers/promises';
import { connectWorker } from './postgres.mjs';
import { errorCode, runResultBatch } from './processor.ts';

const loop = process.argv.includes('--loop');
const stop = new AbortController();
process.once('SIGTERM', () => stop.abort());
process.once('SIGINT', () => stop.abort());
let db;
try {
  db = await connectWorker();
  let nextHealth = 0;
  do {
    try {
      const summary = await runResultBatch(db, { signal: stop.signal });
      if (!loop || summary.completed || summary.unrated || summary.retry || Date.now() >= nextHealth) {
        console.log(JSON.stringify({ event: 'ranked_result_batch', ...summary }));
        nextHealth = Date.now() + 60_000;
      }
      if (!loop && (summary.retry || summary.attention)) process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({ event: 'ranked_result_batch_failed', code: errorCode(error) }));
      if (!loop) process.exitCode = 1;
    }
    if (loop && !stop.signal.aborted) await sleep(15_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (loop && !stop.signal.aborted);
} catch (error) {
  console.error(JSON.stringify({ event: 'ranked_result_worker_unavailable', code: errorCode(error) }));
  process.exitCode = 1;
} finally { await db?.close(); }
