async (page) => {
  const results=[];
  for(const origin of ['http://127.0.0.1:8794','http://127.0.0.1:8796']) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const user = {id:id(1),aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},user_metadata:{full_name:'PreviewRacer',custom_claims:{global_name:'Preview Racer'}},created_at:new Date().toISOString()};
  const enc = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const token = `${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})}.test-signature`;
  const session = {access_token:token,refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
  const names = ['Apex','AlexandriaTheVeryLongRacerName','Midnight Runner','Monstrosity','Snowdrift','W'.repeat(32),'Frostbitten','SpeedySebas','Nightfall'];
  const rows = names.map((name,i)=>({friendship_id:id(100+i),direction:i===8?'outgoing':'incoming',status:i>6?'pending':'accepted',player_id:id(i+2),display_name:name,discord_name:name,discord_username:`racer${i+2}`,avatar_url:null,rating:null,online:i<3}));
  const context = await page.context().browser().newContext({viewport:{width:1100,height:850},storageState:{cookies:[],origins:[{origin,localStorage:[{name:'polycup.account.v1',value:JSON.stringify(session)}]}]}});
  try {
    await context.route('**/*',route=>{
      const u = new URL(route.request().url());
      if(u.hostname==='127.0.0.1'||(u.hostname==='cdn.polymodloader.com'&&route.request().method()==='GET'))return route.continue();
      if(u.hostname==='wqaipijoqqqrwyivajjg.supabase.co') {
        if(u.pathname.endsWith('/profiles'))return route.fulfill({json:{display_name:'Preview Racer'}});
        if(u.pathname.endsWith('/player_ratings'))return route.fulfill({json:{rating:null}});
        if(u.pathname.endsWith('/polycup_friends'))return route.fulfill({json:rows});
        if(u.pathname.endsWith('/polycup_find_players'))return route.fulfill({json:[]});
        if(/\/polycup_presence_(touch|leave)$/.test(u.pathname))return route.fulfill({json:null});
        if(u.pathname.endsWith('/user'))return route.fulfill({json:user});
      }
      return route.abort();
    });
    await context.addInitScript(() => {Object.defineProperty(navigator, 'clipboard', {value:{writeText:async value=>{window.__copiedFriendCode=value;}}});});
    await context.routeWebSocket('**/*',socket=>socket.close());
    const client = await context.newPage();
    await client.goto(origin);
    if(origin.endsWith('8796')) {
      await client.locator('#polytrack-world-cup').waitFor({state:'attached'});
      await client.keyboard.press('F8');
    }
    await client.getByRole('button',{name:'Account',exact:true}).click();
    await client.getByRole('heading',{name:'Online (3)',exact:true}).waitFor();
    await client.getByRole('heading',{name:'Offline (4)',exact:true}).waitFor();
    const panel = client.getByRole('dialog',{name:'PolyCup account',exact:true});

    await client.getByRole('button',{name:'Edit name',exact:true}).click();
    await client.getByRole('textbox',{name:'PolyCup name',exact:true}).fill('Draft survives reopening');
    let totalFrames=0;
    for(const width of [1100,390]) {
      await client.setViewportSize({width,height:850});
      for(const reducedMotion of ['no-preference','reduce']) {
        await client.emulateMedia({reducedMotion});
        for(const reopenAfter of [30,90,210]) {
          await client.waitForTimeout(180);
          const sample=await panel.evaluate(async (el,delay)=>{
            const root=el.getRootNode();
            const opener=Array.from(root.querySelectorAll('button')).find(b=>b.textContent==='Account');
            const frames=[];
            const start=performance.now();
            el.querySelector('.account-close').click();
            const timer=setTimeout(()=>opener.click(),delay);
            const record=()=>{
              const cs=getComputedStyle(el),r=el.getBoundingClientRect();
              if(cs.display==='none'||Number(cs.opacity)<0.01)return;
              const head=el.querySelector('.account-social-header').getBoundingClientRect();
              const nav=el.querySelector('.account-tabs').getBoundingClientRect();
              frames.push({open:el.open,direction:cs.flexDirection,x:r.x,w:r.width,headerHeight:head.height,navY:nav.y,headerBottom:head.bottom});
            };
            record();
            while(performance.now()-start<delay+190) {
              await new Promise(requestAnimationFrame);record();
            }
            clearTimeout(timer);
            const bad=frames.find(f=>f.direction!=='column'||Math.abs(f.x-(innerWidth-f.w)/2)>2||f.headerHeight>220||f.navY<f.headerBottom-1);
            return {frames:frames.length,bad};
          },reopenAfter);
          totalFrames+=sample.frames;
          if(sample.bad)throw new Error(JSON.stringify({origin,width,reducedMotion,reopenAfter,...sample.bad}));
          if(await client.getByRole('textbox',{name:'PolyCup name',exact:true}).inputValue()!=='Draft survives reopening')throw new Error('Reopening lost draft');
        }
      }
    }
    await client.emulateMedia({reducedMotion:'no-preference'});
    await client.setViewportSize({width:1100,height:850});
    await client.mouse.move(0,0);
    await panel.screenshot({path:`output/account-preview/transition-${origin.slice(-4)}.png`});
    results.push({origin,totalFrames,cycles:12,passed:true});
  } finally {await context.close();}
  }
  return {passed:true,results,liveAccountWrites:0};
}
