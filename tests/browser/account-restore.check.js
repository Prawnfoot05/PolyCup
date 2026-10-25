async (page) => {
  const origin = 'http://127.0.0.1:8796';
  const id = '00000000-0000-4000-8000-000000000001';
  const user = { id, aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},
    user_metadata:{full_name:'Restore test'},created_at:new Date().toISOString() };
  const encoded = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const token = `${encoded({alg:'HS256',typ:'JWT'})}.${encoded({sub:id,exp:Math.floor(Date.now()/1000)+3600})}.test-signature`;
  const results=[];
  for(const rejected of [false,true]) {
    const expired={access_token:token,refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)-60,token_type:'bearer',user};
    const context=await page.context().browser().newContext({storageState:{cookies:[],origins:[{origin,localStorage:[{name:'polycup.account.v1',value:JSON.stringify(expired)}]}]}});
    let refreshes=0;
    try {
      await context.route('**/*', route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='127.0.0.1' || (url.hostname==='cdn.polymodloader.com' && route.request().method()==='GET')) return route.continue();
        if(url.hostname==='wqaipijoqqqrwyivajjg.supabase.co') {
          if(url.pathname.endsWith('/token')) {
            refreshes++;
            if(url.searchParams.get('grant_type')!=='refresh_token') throw new Error('Restart unexpectedly requested a new login');
            if(rejected) return route.fulfill({status:400,json:{code:'refresh_token_not_found',message:'Test session revoked'}});
            return route.fulfill({json:{access_token:token,refresh_token:'test-rotated-refresh',expires_in:3600,token_type:'bearer',user}});
          }
          if(url.pathname.endsWith('/polycup_friends')) return route.fulfill({json:[]});
          if(/\/polycup_presence_(touch|leave)$/.test(url.pathname)) return route.fulfill({json:null});
          if(url.pathname.endsWith('/profiles')) return route.fulfill({json:{display_name:'Saved Cup name'}});
          if(url.pathname.endsWith('/player_ratings')) return route.fulfill({json:{rating:null}});
          if(url.pathname.endsWith('/user')) return route.fulfill({json:user});
        }
        return route.abort();
      });
      await context.routeWebSocket('**/*', socket=>socket.close());
      const client=await context.newPage();
      await client.goto(origin);
      await client.locator('#polytrack-world-cup').waitFor({state:'attached'});
      await client.keyboard.press('F8');
      await client.getByRole('button',{name:'Account',exact:true}).click();
      if(rejected) {
        await client.getByRole('button',{name:'Sign in with Discord',exact:true}).waitFor();
        if(await client.evaluate(()=>localStorage.getItem('polycup.account.v1'))) throw new Error('Revoked session was retained');
      } else {
        await client.getByText('Saved Cup name',{exact:true}).waitFor();
        const saved=await client.evaluate(()=>JSON.parse(localStorage.getItem('polycup.account.v1')));
        if(saved.refresh_token!=='test-rotated-refresh') throw new Error('Refreshed session was not persisted');
      }
      if(refreshes!==1) throw new Error('Unexpected refresh count: '+refreshes);
      results.push({case:rejected?'revoked session clears and offers login':'expired session restores and rotates refresh token',passed:true});
    } finally { await context.close(); }
  }
  return {results,liveAccountWrites:0,leaderboardRequestsAllowed:0};
}
