import { readFile } from 'node:fs/promises';
import pg from 'pg';

export async function connectWorker(env = process.env) {
  if (env.POLYCUP_RESULT_WORKER_ENABLED !== '1') throw new Error('Worker is disabled.');
  if (!env.POLYCUP_RESULT_DATABASE_URL) throw new Error('Worker database is not configured.');
  let url;
  try { url = new URL(env.POLYCUP_RESULT_DATABASE_URL); } catch { throw new Error('Invalid worker database URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || [...url.searchParams.keys()].some(k => /^ssl/i.test(k)))
    throw new Error('Use a PostgreSQL URL without SSL query overrides.');
  const local = env.POLYCUP_RESULT_LOCAL_TEST === '1';
  if (local && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Non-TLS test connections must use loopback.');
  const ssl = local ? false : {
    rejectUnauthorized: true,
    ...(env.POLYCUP_RESULT_CA_PEM ? { ca: env.POLYCUP_RESULT_CA_PEM } :
      env.POLYCUP_RESULT_CA_FILE ? { ca: await readFile(env.POLYCUP_RESULT_CA_FILE, 'utf8') } : {}),
  };
  const pool = new pg.Pool({ connectionString: url.toString(), ssl, max: 2,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    statement_timeout: 15000, application_name: 'polycup-result-worker' });
  // The next batch reconnects. Never print pg's error message (it can include SQL/data).
  pool.on('error', () => {});
  return {
    async transaction(fn) {
      const client = await pool.connect();
      let broken = false;
      try {
        await client.query('begin');
        await client.query('set local role polycup_result_worker');
        await client.query("set local statement_timeout='15s'");
        await client.query("set local lock_timeout='3s'");
        await client.query("set local idle_in_transaction_session_timeout='30s'");
        const result = await fn(client);
        await client.query('commit');
        return result;
      } catch (error) {
        try { await client.query('rollback'); } catch { broken = true; }
        throw error;
      } finally { client.release(broken); }
    },
    close: () => pool.end(),
  };
}
