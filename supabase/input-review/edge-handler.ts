import { connectWorker } from './postgres.mjs';
import { runInputBatch } from './worker.ts';
async function authorized(headers: Headers, secret: string): Promise<boolean> {
  const stamp = headers.get('x-polycup-time') ?? '',
    nonce = headers.get('x-polycup-nonce') ?? '';
  const signature = headers.get('x-polycup-signature') ?? '';
  if (
    !/^\d{10}$/.test(stamp) ||
    !/^[a-f0-9-]{36}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const age = Math.floor(Date.now() / 1000) - Number(stamp);
  if (age < -10 || age > 90) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const bytes = Uint8Array.from(signature.match(/../g)!, (value) => parseInt(value, 16));
  return crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    encoder.encode(`polycup-input-review:v1:${stamp}:${nonce}`),
  );
}

export function createInputHandler(
  env: Record<string, string | undefined>,
  connect = connectWorker,
) {
  return async (request: Request) => {
    const reply = (status: number, body: unknown) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    const secret = env.POLYCUP_INPUT_CRON_TOKEN;
    if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return reply(503, { error: 'not_configured' });
    if (!(await authorized(request.headers, secret))) return reply(401, { error: 'unauthorized' });
    if (env.POLYCUP_INPUT_WORKER_ENABLED !== '1') return reply(503, { error: 'disabled' });
    let db;
    try {
      db = await connect(env);
      const claimed = await db.transaction(
        async (tx: any) =>
          (
            await tx.query('select public.polycup_input_dispatch_claim($1) claimed', [
              request.headers.get('x-polycup-nonce'),
            ])
          ).rows[0].claimed,
      );
      if (!claimed) return reply(200, { processed: 0, flagged: 0, retry: 0, duplicate: true });
      const result = await runInputBatch(db);
      try {
        await db.transaction((tx: any) =>
          tx.query('select public.polycup_input_dispatch_complete($1)', [
            request.headers.get('x-polycup-nonce'),
          ]),
        );
      } catch {
        /* Cron retries missed acknowledgements. */
      }
      return reply(200, result);
    } catch {
      return reply(503, { error: 'processing_unavailable' });
    } finally {
      try {
        await db?.close();
      } catch {}
    }
  };
}
