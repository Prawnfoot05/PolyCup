async(page)=>{
 const api='http://127.0.0.1:8812',game='http://127.0.0.1:8796';
 const contexts=[];const pageErrors=[];let signups=0;let stage='setup';const pages=[];
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const host={cupId:'guest-cup',hostName:'Guest Racer',title:'Friday Night Cup',code:'ABCDEFGH',expires:Date.now()+3600000,phase:'waiting',players:3,capacity:8};
 async function client(origin){
  const ctx=await page.context().browser().newContext({viewport:{width:1100,height:850}});contexts.push(ctx);
  await ctx.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='127.0.0.1'||(u.hostname==='cdn.polymodloader.com'&&route.request().method()==='GET'))return route.continue();
   if(u.hostname==='wqaipijoqqqrwyivajjg.supabase.co'){
    if(u.pathname.endsWith('/signup'))signups++;
    const response=await ctx.request.fetch(api+u.pathname+u.search,{method:route.request().method(),headers:{authorization:route.request().headers().authorization??'','content-type':'application/json'},data:route.request().postData()??undefined});
    return route.fulfill({response});
   }
   return route.abort();
  });await ctx.routeWebSocket('**/*',s=>s.close());
  const p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>pageErrors.push(e.message.split('?')[0].slice(0,200)));await p.goto(origin);
  if(origin===game){await p.locator('#polytrack-world-cup').waitFor({state:'attached'});await p.keyboard.press('F8');}
  await p.getByRole('button',{name:'Find lobby',exact:true}).click();return p;
 }
 try{
  await page.request.post(api+'/test/clear-lobbies');
  const a=await client(api),b=await client(api);
  await b.getByText('No lobbies found.',{exact:true}).waitFor();
  if(signups!==0)throw new Error('Browsing created guest accounts');
  stage='host/context';await a.evaluate(host=>window.lobbyQa.set({host,connected:true}),host);
  await a.getByText('Public',{exact:true}).waitFor();
  if(signups!==1)throw new Error('Guest hosting did not create one saved identity');
  await a.getByRole('heading',{name:'Friday Night Cup',exact:true}).waitFor();
  await a.mouse.move(0,0);await a.getByRole('dialog',{name:'Lobby finder'}).screenshot({path:'output/account-preview/lobby-finder-host.png'});
  await b.getByRole('button',{name:'Refresh',exact:true}).click();
  await b.getByRole('heading',{name:host.title,exact:true}).waitFor();
  await b.getByText('Guest Racer',{exact:true}).waitFor();
  stage='private/public';await a.getByRole('checkbox',{name:'List publicly',exact:true}).uncheck();
  await a.waitForFunction(()=>!window.lobbyQa.directory().confirmed);
  await b.getByRole('button',{name:'Refresh',exact:true}).click();await b.getByText('No lobbies found.',{exact:true}).waitFor();
  stage='host/context';await a.evaluate(host=>window.lobbyQa.set({host:{...host,phase:'drafting'},connected:true}),host);
  if(await a.getByRole('checkbox',{name:'List publicly',exact:true}).isChecked())throw new Error('Phase change reset privacy');
  stage='private/public';await a.getByRole('checkbox',{name:'List publicly',exact:true}).check();await a.getByText('Public',{exact:true}).waitFor();
  if(signups!==1)throw new Error('Relisting recreated guest account');
  await b.getByRole('button',{name:'Refresh',exact:true}).click();await b.getByText('Drafting',{exact:true}).waitFor();
  await b.getByRole('textbox',{name:'Search lobbies'}).fill('no match');await b.getByText('No lobbies found.',{exact:true}).waitFor();
  await b.getByRole('textbox',{name:'Search lobbies'}).fill('');
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  for(const [n,title,stage,players,version] of [[1,'Community Sprint','waiting',5,'0.4.0-dev.1'],[2,'Late Night Racing','racing',8,'0.4.0-dev.1'],[3,'A Different Version','waiting',2,'0.3.3']]){
   const token=enc({alg:'HS256'})+'.'+enc({sub:id(n)})+'.test';
   const r=await page.request.post(api+'/rest/v1/rpc/polycup_list_lobby',{headers:{authorization:'Bearer '+token},data:{instance_key:id(n+20),cup_key:'cup-'+n,lobby_title:title,code:'ABCDEFGH',version,stage,player_count:players,player_limit:8,invite_seconds:3600}});
   if(!r.ok())throw new Error('Fixture publish failed');
  }
  await b.getByRole('button',{name:'Refresh',exact:true}).click();await b.getByRole('button',{name:'Full',exact:true}).waitFor();
  if(!await b.getByRole('button',{name:'Update mod',exact:true}).isDisabled())throw new Error('Version mismatch join enabled');
  await b.mouse.move(0,0);await b.getByRole('dialog',{name:'Lobby finder'}).screenshot({path:'output/account-preview/lobby-finder.png'});
  await b.setViewportSize({width:390,height:800});
  const dialog=b.getByRole('dialog',{name:'Lobby finder'});
  if(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1))throw new Error('Narrow dialog overflow');
  await dialog.screenshot({path:'output/account-preview/lobby-finder-mobile.png'});
  stage='game load';const actual=await client(game);
  await actual.bringToFront();
  await actual.bringToFront();
  stage='native join';await actual.evaluate(()=>{
   window.addEventListener('polycup-native-lobby-v1',e=>{window.__navigationState=e.detail;});
   const transition=window.polyModLoader.getFromPolyTrack('Mu.prototype');const oldTrigger=transition.trigger;window.__transitionTrace=[];transition.trigger=function(fn){window.__transitionTrace.push(fn.toString().slice(0,150));return oldTrigger.call(this,fn);};
   const prototype=window.polyModLoader.getFromPolyTrack('vc.prototype');
   prototype.joinInvite=async function(code){window.__finderJoinedCode=code;throw new Error('Test intercepted native connection');};
  });
  await actual.locator('.finder-row').filter({hasText:'Community Sprint'}).getByRole('button',{name:'Join',exact:true}).click();
  await actual.waitForFunction(()=>window.__finderJoinedCode==='ABCDEFGH',{},{timeout:10000});
  await actual.getByRole('textbox',{name:'Enter invite code',exact:true}).waitFor();
  if(signups!==1)throw new Error('Joining required a guest account');
  stage='native host';
  await actual.keyboard.press('F8');await actual.getByRole('button',{name:'Find lobby',exact:true}).click();
  await actual.getByRole('button',{name:'Host lobby',exact:true}).click();
  await actual.getByRole('button',{name:'Select Track',exact:true}).waitFor();
  stage='end cup';await a.evaluate(()=>window.lobbyQa.set({host:null,connected:false}));
  await a.waitForFunction(()=>!window.lobbyQa.directory().confirmed);
  await b.getByRole('button',{name:'Refresh',exact:true}).click();
  await b.getByRole('heading',{name:'Friday Night Cup',exact:true}).waitFor({state:'hidden'});
  await page.request.post(api+'/test/expire-lobbies');
  await b.getByRole('button',{name:'Refresh',exact:true}).click();await b.getByText('No lobbies found.',{exact:true}).waitFor();
  return {passed:true,signups,checks:['no-login browse and join','saved guest hosting','public default','private survives phase change','search','full and incompatible lobbies','native join and host handoff','end Cup removes listing','stale expiry','desktop and narrow layout'],liveAccountWrites:0};
 }catch(error){const diagnostics=[];for(let n=0;n<pages.length;n++){await pages[n].screenshot({path:'output/account-preview/finder-fail-'+n+'.png'}).catch(()=>{});diagnostics.push(await pages[n].evaluate(()=>({navigation:window.__navigationState,transitions:window.__transitionTrace,joined:window.__finderJoinedCode,hidden:document.hidden,body:document.body.innerText.slice(0,500)})).catch(()=>''));}throw new Error(stage+': '+error.message+' '+JSON.stringify({diagnostics,pageErrors}));}finally{for(const ctx of contexts)await ctx.close();}
}
