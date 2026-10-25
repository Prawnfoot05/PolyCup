async (page) => {
  const context = page.context();
  await context.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === '127.0.0.1' || (host === 'cdn.polymodloader.com' && route.request().method() === 'GET') ? route.continue() : route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  let exchanges = 0, pkceBody, authUrl, profileReads = 0, profileName = 'Kiki', failNameSave = false, writes = 0;
  const id = '00000000-0000-4000-8000-000000000001';
  const user = { id, aud:'authenticated', role:'authenticated', email:'unused@example.invalid',
    app_metadata:{ provider:'discord', providers:['discord'] },
    user_metadata:{ full_name:'Kiki · Long Display Name', user_name:'kiki', avatar_url:'https://cdn.discordapp.com/embed/avatars/0.png' },
    created_at:new Date().toISOString() };
  const encoded = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const token = `${encoded({alg:'HS256',typ:'JWT'})}.${encoded({sub:id,exp:Math.floor(Date.now()/1000)+3600})}.test-signature`;
  await context.route('https://wqaipijoqqqrwyivajjg.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/authorize')) {
      authUrl = url;
      return route.fulfill({ contentType:'text/html', body:'<title>Mock Discord</title><p>Local OAuth test</p>' });
    }
    if (url.pathname.endsWith('/token')) {
      exchanges++; pkceBody = route.request().postDataJSON();
      return route.fulfill({ json:{ access_token:token, refresh_token:'test-refresh', expires_in:3600,
        token_type:'bearer', provider_token:'discard-discord-token', provider_refresh_token:'discard-discord-refresh', user } });
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({status:204});
    if (url.pathname.endsWith('/user')) return route.fulfill({json:user});
    if (url.pathname.endsWith('/profiles')) {
      profileReads++;
      if (route.request().method() === 'PATCH') {
        writes++;
        if (url.searchParams.get('id') !== 'eq.'+id) throw new Error('Profile update was not restricted to current account');
        if (failNameSave) return route.fulfill({status:403,json:{message:'Test denied'}});
        const patch = route.request().postDataJSON();
        if (Object.keys(patch).join(',') !== 'display_name') throw new Error('Unexpected profile columns');
        profileName = patch.display_name;
      }
      return route.fulfill({json:{display_name:profileName}});
    }
    if (url.pathname.endsWith('/player_ratings')) return route.fulfill({json:{rating:null}});
    if (url.pathname.endsWith('/polycup_room_directory')) return route.fulfill({json:[]});
    if (url.pathname.endsWith('/polycup_friends')) return route.fulfill({json:[]});
    if (/\/polycup_presence_(touch|leave)$/.test(url.pathname)) return route.fulfill({json:null});
    throw new Error('Unexpected Supabase endpoint: '+url.pathname);
  });
  await context.route('https://cdn.discordapp.com/**', route => route.fulfill({status:404}));
  await context.route('https://prawnfoot05.github.io/PolyCup/auth/**', async route => {
    const url = new URL(route.request().url());
    const response = await page.request.get('http://127.0.0.1:8794'+url.pathname.replace('/PolyCup',''));
    await route.fulfill({response});
  });
  await page.goto('http://127.0.0.1:8796/');
  await page.setViewportSize({width:1000,height:800});
  await page.evaluate(() => {localStorage.clear();sessionStorage.clear();});
  await page.reload();
  await page.locator('#polytrack-world-cup').waitFor({state:'attached'});
  await page.keyboard.press('F8');
  if(!await page.locator('.cup-hub').evaluate(el=>el.open))await page.keyboard.press('F8');
  await page.getByRole('button',{name:'Sign in with Discord',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/hub-account-signed-out.png',animations:'disabled'});
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button',{name:'Sign in with Discord',exact:true}).click();
  const popup = await popupPromise;
  await popup.waitForURL('https://wqaipijoqqqrwyivajjg.supabase.co/**');
  if(!await page.getByLabel('Return code',{exact:true}).isVisible())await page.getByText('Enter return code',{exact:true}).click();
  await page.getByRole('button',{name:'Finish sign-in',exact:true}).waitFor();
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('polycup.account.pending.v1')));
  if (!pending.flowId || authUrl.searchParams.get('code_challenge_method') !== 's256') throw new Error('Missing PKCE flow/challenge');
  const code = `polycup1:${pending.attempt}:12345678-1234-4000-8000-123456789012`;
  await page.evaluate(code => window.postMessage({type:'polycup-auth-return',code},location.origin),code);
  if (exchanges !== 0) throw new Error('Untrusted message accepted');
  const callback = new URL(authUrl.searchParams.get('redirect_to'));
  callback.searchParams.set('code','12345678-1234-4000-8000-123456789012');
  await popup.goto(callback.href);
  const automatic = await popup.evaluate(() => !!window.opener);
  if (!automatic) {
    const returned = await popup.getByRole('textbox',{name:'Return code'}).inputValue();
    if(!await page.getByLabel('Return code',{exact:true}).isVisible())await page.getByText('Enter return code',{exact:true}).click();
    await page.getByLabel('Return code', {exact:true}).fill(returned);
    await page.getByRole('button',{name:'Finish sign-in',exact:true}).click();
  }
  await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  if (automatic) await popup.getByRole('heading',{name:'You’re signed in'}).waitFor();
  if (exchanges !== 1 || !pkceBody.code_verifier) throw new Error('Code exchange count/verifier wrong');
  const challenge = await page.evaluate(async verifier => {
    const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  },pkceBody.code_verifier);
  if (challenge !== authUrl.searchParams.get('code_challenge')) throw new Error('PKCE challenge mismatch');
  if (new URL(popup.url()).search) throw new Error('Callback leaked code into retained URL');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('polycup.account.v1')));
  if (persisted.provider_token || persisted.provider_refresh_token) throw new Error('Discord API token was persisted');
  await page.getByRole('heading',{name:'Kiki',exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit name',exact:true}).click();
  await page.getByRole('textbox',{name:'PolyCup name',exact:true}).fill('X'.repeat(33));
  await page.getByRole('button',{name:'Save name',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'32 characters'}).waitFor();
  if (writes !== 0) throw new Error('Invalid name reached the backend');
  const editedName = '𝓴𝓲𝓴𝓲 · Cup';
  await page.getByRole('textbox',{name:'PolyCup name',exact:true}).fill(editedName);
  await page.getByRole('button',{name:'Save name',exact:true}).click();
  await page.getByRole('status').filter({hasText:'PolyCup name saved.'}).waitFor();
  if (writes !== 1 || profileName !== editedName) throw new Error('Name save failed');
  await page.getByText('@kiki',{exact:true}).waitFor();
  await page.getByRole('heading',{name:editedName,exact:true}).waitFor();
  await page.getByRole('button',{name:'Edit name',exact:true}).click();
  const draft = 'Draft survives refresh';
  await page.getByRole('textbox',{name:'PolyCup name',exact:true}).fill(draft);
  const readsBeforeRefresh = profileReads;
  await page.evaluate(session => {
    const channel = new BroadcastChannel('polycup.account.v1');
    channel.postMessage({event:'TOKEN_REFRESHED',session});
    setTimeout(()=>channel.close(),250);
  },persisted);
  await page.waitForTimeout(350);
  if (profileReads !== readsBeforeRefresh) throw new Error('Token refresh unnecessarily reloaded the profile');
  const retained = await page.getByRole('textbox',{name:'PolyCup name',exact:true}).inputValue();
  if (retained !== draft) throw new Error('Token refresh lost name draft');
  if (!await page.getByRole('textbox',{name:'PolyCup name',exact:true}).evaluate(e=>e.getRootNode().activeElement===e)) throw new Error('Token refresh lost input focus');
  failNameSave = true;
  await page.getByRole('button',{name:'Save name',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'could not be saved'}).waitFor();
  if (await page.getByRole('textbox',{name:'PolyCup name',exact:true}).inputValue() !== draft) throw new Error('Failed save lost draft');
  if (profileName !== editedName) throw new Error('Failed save changed displayed server value');
  await page.getByRole('button',{name:'Cancel name edit',exact:true}).click();
  failNameSave = false;
  await page.keyboard.press('F8');
  await page.getByRole('dialog',{name:'PolyCup account',exact:true}).waitFor({state:'hidden'});
  if(!await page.locator('.cup-hub').evaluate(el=>el.open))await page.keyboard.press('F8');
  await page.getByRole('heading',{name:editedName,exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/hub-account-signed-in.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:780});
  await page.screenshot({path:'output/playwright/hub-account-signed-in-mobile.png',animations:'disabled'});
  await page.reload();
  await page.locator('#polytrack-world-cup').waitFor({state:'attached'});
  await page.keyboard.press('F8');
  if(!await page.locator('.cup-hub').evaluate(el=>el.open))await page.keyboard.press('F8');
  await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  await page.getByRole('heading',{name:editedName,exact:true}).waitFor();
  if (exchanges !== 1) throw new Error('Reload unnecessarily exchanged login');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('button',{name:'Sign in with Discord',exact:true}).waitFor();
  if (await page.evaluate(()=>localStorage.getItem('polycup.account.v1'))) throw new Error('Sign-out retained session');
  await page.evaluate(()=>{window.open=()=>null;});
  await page.getByRole('button',{name:'Sign in with Discord',exact:true}).click();
  if(!await page.getByLabel('Return code',{exact:true}).isVisible())await page.getByText('Enter return code',{exact:true}).click();
  await page.getByRole('button',{name:'Finish sign-in',exact:true}).waitFor();
  await page.getByRole('button',{name:'Copy sign-in link',exact:true}).waitFor();
  const manual = await page.evaluate(()=>JSON.parse(sessionStorage.getItem('polycup.account.pending.v1')));
  await page.getByLabel('Return code', {exact:true}).fill(code);
  await page.getByRole('button',{name:'Finish sign-in',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'another sign-in'}).waitFor();
  if(exchanges!==1) throw new Error('Stale code reached token endpoint');
  await page.reload();
  await page.locator('#polytrack-world-cup').waitFor({state:'attached'});
  await page.keyboard.press('F8');
  if(!await page.locator('.cup-hub').evaluate(el=>el.open))await page.keyboard.press('F8');
  if(!await page.getByLabel('Return code',{exact:true}).isVisible())await page.getByText('Enter return code',{exact:true}).click();
  await page.getByRole('button',{name:'Finish sign-in',exact:true}).waitFor();
  await page.getByLabel('Return code', {exact:true}).fill(`polycup1:${manual.attempt}:12345678-1234-4000-8000-123456789013`);
  await page.getByRole('button',{name:'Finish sign-in',exact:true}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).waitFor();
  if(exchanges!==2 || profileReads<2) throw new Error('Manual flow/profile loading failed');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await popup.close();
  return {passed:true, exchanges, writes, automatic, checks:['real game Account UI','PKCE','saved session reload','name edit','Unicode limit','owner-filtered update','failed save retains draft','token refresh retains draft and focus','F8 modal handling','sign-out','stale-code rejection','blocked-popup fallback','pending-flow reload','desktop/mobile rendering'], liveAccountWrites:0, leaderboardRequestsAllowed:0};
}
