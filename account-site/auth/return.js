(() => {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  // Remove the one-use authorization code from history before doing any work.
  history.replaceState(null, '', location.pathname);
  const title = document.querySelector('#title');
  const status = document.querySelector('#status');
  const handoff = document.querySelector('#handoff');
  const field = document.querySelector('#code');
  const copy = document.querySelector('#copy');
  const attempt = params.get('attempt') || '';
  const code = params.get('code') || '';
  if (params.has('error') || hash.has('error')) {
    title.textContent = 'Sign-in wasn’t completed';
    status.textContent = 'Return to PolyCup, cancel this sign-in, and try again when you’re ready.';
    return;
  }
  if (hash.has('access_token') || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(attempt) ||
      !/^[a-zA-Z0-9_-]{8,512}$/.test(code)) {
    title.textContent = 'Start from the game';
    status.textContent = 'Open PolyCup → Account → Sign in with Discord. This page completes a sign-in started there.';
    return;
  }
  field.value = `polycup1:${attempt}:${code}`;
  handoff.hidden = false;
  status.textContent = 'Return to your game. If sign-in doesn’t finish automatically, use the code below.';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(field.value); copy.textContent = 'Copied'; }
    catch { field.focus(); field.select(); copy.textContent = 'Select and copy the code above'; }
  });
  // The launcher or browser may not preserve an opener. This short-lived relay
  // carries the one-use PKCE code; the verifier stays only in the initiating game.
  const relay = params.get('relay');
  if (/^[a-f0-9]{64}$/.test(relay || '')) {
    const returnValue = field.value;
    const send = async () => {
      for (let attemptNumber = 0; attemptNumber < 3; attemptNumber++) {
        try {
          const response = await fetch('https://wqaipijoqqqrwyivajjg.supabase.co/rest/v1/rpc/polycup_signin_return', {
            method: 'POST', headers: {
              apikey: 'sb_publishable_cFxm38ysj67TJozQQFg8_Q_1JgDov4g',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({action:'put',attempt_key:attempt,secret:relay,return_code:returnValue}),
            signal: AbortSignal.timeout(8000),
          });
          const result = await response.json();
          if (response.ok && result.received) {
            if (!handoff.hidden) status.textContent = 'Return sent to PolyCup. Switch back to the game to continue.';
            return;
          }
          if (response.status !== 429 && response.status < 500) break;
          if (attemptNumber < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attemptNumber + 1)));
        } catch { if (attemptNumber < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attemptNumber + 1))); }
      }
      if (!handoff.hidden) status.textContent = 'Automatic return was unavailable. Paste the code below into PolyCup.';
    };
    void send();
  }
  // Top-level navigation avoids cross-origin requests to the local desktop app.
  // Only its random, single-use loopback endpoint is accepted.
  try {
    const desktop = new URL(params.get('desktop_return'));
    if (desktop.protocol === 'http:' && desktop.hostname === '127.0.0.1' &&
        Number(desktop.port) >= 1024 && !desktop.username && !desktop.password &&
        !desktop.search && !desktop.hash && /^\/polycup-auth\/[a-f0-9]{64}$/.test(desktop.pathname)) {
      desktop.searchParams.set('attempt', attempt);
      desktop.searchParams.set('code', code);
      status.textContent = 'Returning to PolyCup…';
      location.replace(desktop.href);
      return;
    }
  } catch { /* Keep the existing browser/manual return paths available. */ }
  const origin = params.get('origin');
  let allowed = false;
  try {
    const url = new URL(origin);
    allowed = url.origin === origin && (
      (url.protocol === 'https:' && ['w.polymodloader.com', 'web.polymodloader.com', 'app-polytrack-desktop.polymodloader.com'].includes(url.hostname)) ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    );
  } catch { /* A launcher with no opener uses the manual code path. */ }
  let timer;
  if (allowed && window.opener) {
    window.addEventListener('message', event => {
      if (event.source !== window.opener || event.origin !== origin || event.data?.type !== 'polycup-auth-complete') return;
      clearTimeout(timer);
      field.value = ''; handoff.hidden = true;
      title.textContent = 'You’re signed in';
      status.textContent = 'Return to PolyCup. You can close this tab.';
    });
    window.opener.postMessage({ type: 'polycup-auth-return', code: field.value }, origin);
  }
  timer = setTimeout(() => {
    field.value = ''; handoff.hidden = true;
    title.textContent = 'Return code expired';
    status.textContent = 'Start a new Discord sign-in from PolyCup.';
  }, 5 * 60 * 1000);
})();
