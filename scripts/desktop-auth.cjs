// Only the configured Discord OAuth entry point may leave the desktop app.
function isDiscordSignInUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://wqaipijoqqqrwyivajjg.supabase.co' &&
      url.pathname === '/auth/v1/authorize' && !url.username && !url.password &&
      url.searchParams.get('provider') === 'discord';
  } catch { return false; }
}
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const validAttempt = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** A single-use loopback receiver; no credentials or session tokens cross it. */
async function createAuthReturn(attempt, onReturn, { lifetime = 600000, responseTimeout = 30000 } = {}) {
  if (!validAttempt(attempt)) throw new Error('Invalid sign-in attempt.');
  const path = '/polycup-auth/' + randomBytes(32).toString('hex');
  let response, consumed = false, closed = false, expires, responseTimer;
  const reply = (res, status, title, message) => {
    const nonce = randomBytes(16).toString('hex');
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
    });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
      <style>body{margin:0;background:#10162d;color:#fff;font:17px/1.5 Arial;display:grid;place-items:center;min-height:100vh}main{max-width:460px;margin:24px;padding:32px;background:#1a2142;border-top:4px solid #ffd568}h1{font-size:26px;margin:0 0 12px}p{color:#b8cae4;margin:0}</style>
      <main><h1>${title}</h1><p>${message}</p></main><script nonce="${nonce}">history.replaceState(null,'',location.pathname)</script>`);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(expires); clearTimeout(responseTimer);
    server.close();
    server.closeIdleConnections();
  };
  const cancel = () => {
    if (response) { reply(response, 410, 'Sign-in cancelled', 'Start a new sign-in from PolyCup.'); response = undefined; }
    close();
  };
  const finish = (success) => {
    if (closed || !response) return false;
    reply(response, success ? 200 : 400, success ? 'You’re signed in' : 'Sign-in wasn’t completed',
      success ? 'PolyCup is ready. You can close this tab.' : 'Return to PolyCup and start sign-in again.');
    response = undefined;
    close();
    return true;
  };
  const server = http.createServer((req, res) => {
    const address = server.address();
    if (!address || req.headers.host !== `127.0.0.1:${address.port}`) { res.writeHead(403).end(); return; }
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${address.port}`); }
    catch { res.writeHead(400).end(); return; }
    if (req.method !== 'GET' || url.pathname !== path) { res.writeHead(404).end(); return; }
    if (closed || consumed) { reply(res, 410, 'Sign-in already handled', 'Return to PolyCup.'); return; }
    if (url.searchParams.get('attempt') !== attempt || url.searchParams.getAll('code').length !== 1 ||
        !/^[a-zA-Z0-9_-]{8,512}$/.test(url.searchParams.get('code') || '')) {
      reply(res, 400, 'Invalid sign-in return', 'Start sign-in from PolyCup.'); return;
    }
    consumed = true; response = res;
    responseTimer = setTimeout(() => finish(false), responseTimeout);
    responseTimer.unref();
    try { onReturn(`polycup1:${attempt}:${url.searchParams.get('code')}`); }
    catch { finish(false); }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  expires = setTimeout(cancel, lifetime); expires.unref();
  return { attempt, url: `http://127.0.0.1:${server.address().port}${path}`, finish, cancel };
}
module.exports = { isDiscordSignInUrl, createAuthReturn };
