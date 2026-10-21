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
  const origin = params.get('origin');
  let allowed = false;
  try {
    const url = new URL(origin);
    allowed = url.origin === origin && (
      (url.protocol === 'https:' && ['w.polymodloader.com', 'app-polytrack-desktop.polymodloader.com'].includes(url.hostname)) ||
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
