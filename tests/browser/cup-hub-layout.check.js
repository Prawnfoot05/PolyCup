async (page) => {
  const origin = 'http://127.0.0.1:8796';
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
        if(u.pathname.endsWith('/polycup_room_directory'))return route.fulfill({json:[{id:id(500),title:'Friday Night Cup',host_name:'Frostbitten',phase:'roster',players:3,version:'0.4.0-dev.1'},{id:id(501),title:'Community Sprint',host_name:'Monstrosity',phase:'picks',players:6,version:'0.4.0-dev.1'}]});
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
    await client.locator('#polytrack-world-cup').waitFor({state:'attached'});
    await client.keyboard.press('F8');
    await client.getByRole('heading',{name:'Online (3)',exact:true}).waitFor();
    await client.getByRole('heading',{name:'Offline (4)',exact:true}).waitFor();
    await client.locator('.hub-header').getByRole('textbox',{name:'Room code',exact:true}).waitFor();
    await client.locator('.hub-list-header').getByRole('button',{name:'Refresh',exact:true}).waitFor();
    await client.locator('.account-footer').getByRole('button',{name:'Back',exact:true}).waitFor();
    if(await client.getByRole('textbox',{name:'Search Cups',exact:true}).count())throw new Error('Search Cups still occupies list space');
    const toolbarBounds=await client.locator('.hub-list-header').boundingBox(),listBounds=await client.locator('.hub-list').boundingBox();
    if(listBounds.y-toolbarBounds.y-toolbarBounds.height>20)throw new Error('Server list does not begin directly below its toolbar');
    const panel = client.getByRole('dialog',{name:'PolyCup account',exact:true});
    if(await client.getByRole('button',{name:'Profile',exact:true}).count())throw new Error('Profile tab remains');
    if(await client.getByText('Your friends',{exact:true}).count())throw new Error('Redundant friends heading remains');
    await client.getByRole('button',{name:'Copy friend code',exact:true}).click();
    if(await client.evaluate(()=>window.__copiedFriendCode)!==id(1))throw new Error('Copy button did not copy account friend code');
    await client.getByRole('button',{name:'Friend code copied',exact:true}).waitFor();
    await client.mouse.move(0,0);
    for(const [width,height,label] of [[1100,850,'desktop'],[390,800,'mobile'],[320,640,'narrow']]) {
      await client.setViewportSize({width,height});
      await client.getByRole('dialog',{name:'PolyCup',exact:true}).screenshot({path:`output/playwright/hub-social-${label}.png`,animations:'disabled'});
      const overflow = await panel.evaluate(el=>[el,...el.querySelectorAll('.account-body,.friend-row,.account-social-header')].some(node=>node.scrollWidth>node.clientWidth+1));
      if(overflow)throw new Error(`Horizontal overflow at ${width}px`);
      if(await client.locator('.hub-header').evaluate(el=>el.scrollWidth>el.clientWidth+1))throw new Error(`Header overflow at ${width}px`);
      const back=await client.locator('.hub-back').boundingBox(),signOut=await client.getByRole('button',{name:'Sign out',exact:true}).boundingBox();
      if(back.x>=signOut.x||Math.abs(back.y-signOut.y)>1)throw new Error('Back and Sign out are not aligned in the footer');
      const footerTop = await client.locator('.account-footer').evaluate(el=>el.getBoundingClientRect().top);
      const headerTop = await client.locator('.account-social-header').evaluate(el=>el.getBoundingClientRect().top);
      await client.locator('.account-body').evaluate(el=>el.scrollTop=el.scrollHeight);
      if(await client.locator('.account-social-header').evaluate(el=>el.getBoundingClientRect().top)!==headerTop)throw new Error('Header moved with friends list');
      if(await client.locator('.account-footer').evaluate(el=>el.getBoundingClientRect().top)!==footerTop)throw new Error('Sign-out footer moved');
      await client.locator('.account-body').evaluate(el=>el.scrollTop=0);
    }
    await client.setViewportSize({width:1100,height:850});
    await client.getByRole('button',{name:'Requests (1)',exact:true}).click();
    await client.getByRole('button',{name:'Accept',exact:true}).waitFor();
    await panel.screenshot({path:'output/playwright/hub-social-requests.png',animations:'disabled'});
    await client.locator('#account-view-find').click();
    const field = client.getByRole('textbox',{name:'Player name or friend code',exact:true});
    await field.waitFor();
    const searchBox = await field.boundingBox(), searchButton = await client.getByRole('button',{name:'Search',exact:true}).boundingBox();
    if(Math.abs(searchBox.y-searchButton.y)>1)throw new Error('Search button not aligned with input');
    await client.mouse.move(0,0);
    await panel.screenshot({path:'output/playwright/hub-social-add-friend.png',animations:'disabled'});
    await client.getByRole('button',{name:'Edit name',exact:true}).click();
    await client.getByRole('textbox',{name:'PolyCup name',exact:true}).fill('Draft to preserve');
    await client.getByRole('button',{name:'Friends',exact:true}).click();
    await client.locator('#account-view-find').click();
    if(await client.getByRole('textbox',{name:'PolyCup name',exact:true}).inputValue()!=='Draft to preserve')throw new Error('Tab switch lost draft');
    await client.setViewportSize({width:390,height:800});
    await panel.screenshot({path:'output/playwright/hub-social-edit-mobile.png',animations:'disabled'});
    if(await panel.evaluate(el=>el.scrollWidth>el.clientWidth+1))throw new Error('Name editor overflow');
    await client.getByRole('button',{name:'Cancel name edit',exact:true}).click();
    let framesChecked=0;
    await client.setViewportSize({width:1100,height:850});
    for(const delay of [20,80,200]){
      const result=await panel.evaluate(async(el,delay)=>{
        const root=el.getRootNode();root.querySelector('.hub-back').click();
        setTimeout(()=>window.dispatchEvent(new Event('polycup-open-menu')),delay);
        let frames=0;const end=performance.now()+delay+220;
        while(performance.now()<end){await new Promise(requestAnimationFrame);const style=getComputedStyle(el);if(style.display==='none')continue;frames++;
          if(style.flexDirection!=='column'||!el.closest('.hub-social'))throw Error('Social panel flashed outside its anchor');
        }return frames;
      },delay);framesChecked+=result;
    }
    rows.splice(0);
    await client.getByRole('button',{name:/^Requests/}).click();
    await client.getByRole('heading',{name:'Received 0',exact:true}).waitFor();
    await client.mouse.move(0,0);
    await panel.screenshot({path:'output/playwright/hub-social-requests-empty.png',animations:'disabled'});
    await client.getByRole('button',{name:'Friends',exact:true}).click();
    await client.getByRole('heading',{name:'Online (0)',exact:true}).waitFor();
    await client.mouse.move(0,0);
    await panel.screenshot({path:'output/playwright/hub-social-friends-empty.png',animations:'disabled'});
    return {passed:true,framesChecked,syntheticPlayers:9,widths:[1100,390,320],checks:['group counts','long names without horizontal overflow','fixed identity header','request badge','draft preserved across tabs','clipboard copies exact friend code','fixed sign-out footer','inline search','empty request structure'],liveAccountWrites:0};
  } finally {await context.close();}
}
