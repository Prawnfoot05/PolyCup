import { test } from 'node:test';
import assert from 'node:assert/strict';
import auth from '../scripts/desktop-auth.cjs';
import { setTimeout as delay } from 'node:timers/promises';
const attempt = '00000000-0000-4000-8000-000000000001';
const code = '12345678-1234-4000-8000-123456789012';
const callback = (receiver, id = receiver.attempt) => `${receiver.url}?attempt=${id}&code=${code}`;
test('desktop browser handoff only accepts the configured Discord OAuth entry point', () => {
  const base = 'https://wqaipijoqqqrwyivajjg.supabase.co/auth/v1/authorize';
  assert.equal(auth.isDiscordSignInUrl(base + '?provider=discord&code_challenge=example'), true);
  for (const url of [base + '?provider=github', base.replace('https:', 'http:') + '?provider=discord',
    'https://example.org/auth/v1/authorize?provider=discord', 'file:///C:/Windows/notepad.exe',
    'javascript:alert(1)', base.replace('/authorize', '/callback') + '?provider=discord',
    base.replace('https://', 'https://user:password@') + '?provider=discord'])
    assert.equal(auth.isDiscordSignInUrl(url), false, url);
});

test('loopback return is bound to the attempt and reports success only after the game acknowledges', async () => {
  let delivered, calls = 0;
  const received = new Promise(resolve => { delivered = resolve; });
  const receiver = await auth.createAuthReturn(attempt, value => { calls++; delivered(value); });
  try {
    assert.equal(new URL(receiver.url).hostname, '127.0.0.1');
    assert.equal((await fetch(callback(receiver, 'wrong'))).status, 400);
    assert.equal((await fetch(receiver.url + '/wrong')).status, 404);
    assert.equal((await fetch(callback(receiver), { method: 'POST' })).status, 404);
    assert.equal(calls, 0);
    const response = fetch(callback(receiver));
    assert.equal(await received, `polycup1:${attempt}:${code}`);
    assert.equal((await fetch(callback(receiver))).status, 410, 'replay cannot trigger a second exchange');
    assert.equal(calls, 1);
    assert.equal(receiver.finish(true), true);
    const result = await response;
    assert.equal(result.status, 200);
    assert.match(await result.text(), /You’re signed in/);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(receiver.finish(true), false);
    await assert.rejects(fetch(callback(receiver)), /fetch failed/);
  } finally { receiver.cancel(); }
});

test('two desktop clients cannot consume each other’s sign-in returns', async () => {
  const seen = [];
  const a = await auth.createAuthReturn(attempt, value => { seen.push(['a', value]); a.finish(true); });
  const b = await auth.createAuthReturn('00000000-0000-4000-8000-000000000002', value => { seen.push(['b', value]); b.finish(true); });
  try {
    assert.notEqual(a.url, b.url);
    assert.equal((await fetch(callback(b, a.attempt))).status, 400);
    assert.equal((await fetch(callback(a))).status, 200);
    assert.deepEqual(seen.map(x => x[0]), ['a']);
    assert.equal((await fetch(callback(b))).status, 200);
    assert.deepEqual(seen.map(x => x[0]), ['a', 'b']);
  } finally { a.cancel(); b.cancel(); }
});

test('cancelled, expired and unacknowledged desktop returns close safely', async () => {
  let delivered;
  const received = new Promise(resolve => { delivered = resolve; });
  const cancelled = await auth.createAuthReturn(attempt, delivered);
  const pending = fetch(callback(cancelled)); await received;
  cancelled.cancel();
  assert.equal((await pending).status, 410);
  const expired = await auth.createAuthReturn(attempt, () => assert.fail('expired callback'), { lifetime: 10 });
  await delay(30);
  await assert.rejects(fetch(callback(expired)), /fetch failed/);
  const hung = await auth.createAuthReturn(attempt, () => {}, { responseTimeout: 20 });
  const failure = await fetch(callback(hung));
  assert.equal(failure.status, 400);
  assert.doesNotMatch(await failure.text(), /You’re signed in/);
});
