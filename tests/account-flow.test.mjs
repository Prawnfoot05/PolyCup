import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_STORAGE, PENDING_STORAGE, LOGIN_LIFETIME, parseReturnCode, readPending,
  clearPending, accountStorage, discordIdentity, validateAccountName } from '../src/account-flow.ts';
const id = '00000000-0000-4000-8000-000000000001';
test('account names preserve styled Unicode and match the database character limit', () => {
  assert.equal(validateAccountName('  𝓴𝓲𝓴𝓲  '), '𝓴𝓲𝓴𝓲');
  assert.equal(validateAccountName('𝓚'.repeat(32)), '𝓚'.repeat(32));
  for (const value of ['', '   ', '\u200b', 'a\nb', 'a\u0085b', '𝓚'.repeat(33)])
    assert.throws(() => validateAccountName(value));
});
const code = '12345678-1234-4000-8000-123456789012';
const pending = { attempt: id, flowId: 'aabbccddeeff00112233445566778899', expires: 1000 + LOGIN_LIFETIME, url: 'https://example.test' };
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i],
    getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
test('return codes are bound to the pending attempt and expiration', () => {
  assert.equal(parseReturnCode(` polycup1:${id}:${code} `, pending, 1001), code);
  assert.throws(() => parseReturnCode(`polycup1:${id}:${code}`, pending, pending.expires), /expired/);
  assert.throws(() => parseReturnCode(`polycup1:${id}:${code}`, null, 1001), /expired/);
  assert.throws(() => parseReturnCode(`polycup1:${code}:${code}`, pending, 1001), /another sign-in/);
  for (const value of ['access_token=secret', code, `polycup1:${id}:bad<script>`, `polycup1:${id}:${code}:extra`])
    assert.throws(() => parseReturnCode(value, pending, 1001), /complete return code/);
});
test('pending login restores after reload but malformed and expired entries are discarded', () => {
  const tab = storage(); tab.setItem(PENDING_STORAGE, JSON.stringify(pending));
  assert.deepEqual(readPending(tab, 1001), pending);
  assert.equal(readPending(tab, pending.expires), null);
  for (const value of ['{', 'null', JSON.stringify({ ...pending, flowId: '<script>' }), JSON.stringify({ ...pending, expires: 9999999999999 })]) {
    tab.setItem(PENDING_STORAGE, value); assert.equal(readPending(tab, 1001), null);
  }
});
test('session persistence removes Discord API tokens and keeps verifiers isolated per tab', () => {
  const persistent = storage(), tab = storage(), otherTab = storage();
  const a = accountStorage(persistent, tab), b = accountStorage(persistent, otherTab);
  a.setItem(ACCOUNT_STORAGE, JSON.stringify({ access_token: 'supabase-access', refresh_token: 'supabase-refresh', provider_token: 'discord', provider_refresh_token: 'discord-refresh' }));
  assert.deepEqual(JSON.parse(a.getItem(ACCOUNT_STORAGE)), { access_token: 'supabase-access', refresh_token: 'supabase-refresh' });
  a.setItem(`${ACCOUNT_STORAGE}-flow-${id}-code-verifier`, 'private-verifier');
  assert.equal(b.getItem(`${ACCOUNT_STORAGE}-flow-${id}-code-verifier`), null);
  assert.equal(persistent.length, 1);
  tab.setItem(PENDING_STORAGE, JSON.stringify(pending)); tab.setItem('other-mod', 'keep');
  clearPending(tab); assert.equal(tab.length, 1); assert.equal(tab.getItem('other-mod'), 'keep');
});
test('Discord identity displays only useful fields and accepts only Discord avatar hosts', () => {
  const metadata = { global_name: ' Kiki ', user_name: 'kiki', email: 'private@example.test', avatar_url: 'https://cdn.discordapp.com/avatars/123/avatar.png' };
  assert.deepEqual(discordIdentity(metadata), { name: 'Kiki', username: 'kiki', avatar: metadata.avatar_url });
  for (const avatar_url of ['javascript:alert(1)', 'https://evil.test/a.png', 'http://cdn.discordapp.com/avatars/a.png', 'https://cdn.discordapp.com.evil.test/avatars/a.png', 'https://user:pass@cdn.discordapp.com/avatars/a.png'])
    assert.equal(discordIdentity({ ...metadata, avatar_url }).avatar, '');
  assert.deepEqual(discordIdentity({}), { name: 'Player', username: '', avatar: '' });
  const longAvatar = 'https://cdn.discordapp.com/avatars/123456789012345678/a_12345678901234567890123456789012.gif';
  assert.ok(longAvatar.length > 80);
  assert.deepEqual(discordIdentity({ full_name:'discord.username', custom_claims:{global_name:'Display name'}, picture:longAvatar }),
    {name:'Display name',username:'discord.username',avatar:longAvatar});
});
