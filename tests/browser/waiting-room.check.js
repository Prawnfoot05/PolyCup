async(page)=>{
 const api='http://127.0.0.1:8813',game='http://127.0.0.1:8796';
 const contexts=[],pages=[],errors=[];let stage='setup',bytes=0,requests=0,hosts=0,sessions=0;const invites=new Map(),joins=new Map();let rejectFirstJoin=true,holdJoin=true;const pendingOffers=[];
 await page.request.post(api+'/test/clear-rooms');
 async function client(){
  const ctx=await page.context().browser().newContext({viewport:{width:1440,height:1000}});contexts.push(ctx);
  await ctx.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.hostname.endsWith('.supabase.co')){
    const response=await page.request.fetch(api+u.pathname+u.search,{method:req.method(),headers:req.headers(),data:req.postData()||undefined});
    const body=await response.body();bytes+=body.length;requests++;return route.fulfill({status:response.status(),headers:{'content-type':'application/json','access-control-allow-origin':'*'},body});
   }
   if(u.hostname==='127.0.0.1'||(u.hostname==='cdn.polymodloader.com'&&req.method()==='GET'))return route.continue();
   if(u.pathname.includes('/iceServers'))return route.fulfill({status:200,contentType:'application/json',body:'[]'});
   return route.abort();
  });
  await ctx.routeWebSocket('**/*',ws=>{
   if(ws.url().includes('/multiplayer/host')){
    let code='QA'+String(++hosts).padStart(6,'0');invites.set(code,ws);
    ws.onMessage(raw=>{const msg=JSON.parse(String(raw));
     if(msg.type==='createInvite')ws.send(JSON.stringify({type:'createInvite',inviteCode:code,key:'qa',timeoutMilliseconds:3600000,censoredNickname:msg.nickname||'Anonymous'}));
     else if(msg.type==='ping')ws.send(JSON.stringify({type:'pong'}));
     else if(msg.session&&joins.has(msg.session))joins.get(msg.session).send(JSON.stringify(msg));
    });
    ws.onClose(()=>invites.delete(code));
   }else if(ws.url().includes('/multiplayer/join')){
    let host,session='test-session-'+(++sessions);
    ws.onMessage(raw=>{const msg=JSON.parse(String(raw));
     if(msg.offer){host=invites.get(msg.inviteCode);joins.set(session,ws);if(!host)return ws.send(JSON.stringify({type:'declineJoin',reason:'Expired'}));if(rejectFirstJoin){rejectFirstJoin=false;ws.close();return;}const send=()=>host.send(JSON.stringify({...msg,type:'joinInvite',session,iceServers:[]}));if(holdJoin)pendingOffers.push(send);else send();}
     else if('candidate'in msg){const send=()=>host?.send(JSON.stringify({type:'iceCandidate',session,candidate:msg.candidate}));if(holdJoin&&!rejectFirstJoin)pendingOffers.push(send);else send();}
    });
   }else ws.close();
  });
  const p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',dialog=>dialog.accept());
  await p.goto(game);await p.waitForFunction(()=>!!window.polyModLoader?.getFromPolyTrack&&!!document.querySelector('#polytrack-world-cup'),{},{timeout:40000});
  await p.evaluate(()=>{
   const proto=window.polyModLoader.getFromPolyTrack('Is.prototype'),old=proto.update;
   proto.update=function(...args){window.__qaGame=this;return old.apply(this,args);};
  });
  await p.getByRole('button',{name:'Exit',exact:true}).waitFor({timeout:30000});
  await p.getByRole('button',{name:'Exit',exact:true}).click();
  await p.getByRole('button',{name:'Back',exact:true}).click();
  await p.locator('.polycup-menu-button').waitFor({timeout:30000});
  if(pages.length===1){await p.getByRole('button',{name:'Multiplayer',exact:true}).click();await p.getByRole('textbox',{name:'Enter invite code',exact:true}).waitFor();await p.getByRole('button',{name:'Back',exact:true}).click();}
  await p.screenshot({path:'output/playwright/polycup-main-menu.png',animations:'disabled'});
  await p.locator('.polycup-menu-button').click();await p.getByRole('dialog',{name:'PolyCup',exact:true}).waitFor();
  return p;
 }
 try{
  stage='host menu';const host=await client();
  await host.screenshot({path:'output/playwright/polycup-hub.png'});
  const menuOrder=await host.locator('.menu-ui .button-image').allTextContents();
  if(menuOrder.findIndex(t=>t==='PolyCup')!==menuOrder.findIndex(t=>t==='Multiplayer')+1)throw Error('Menu tile order incorrect '+JSON.stringify(menuOrder));
  stage='host room';await host.getByRole('button',{name:'Host Cup',exact:true}).click();
  await host.getByRole('heading',{name:'Racers · 1/8',exact:true}).waitFor({timeout:30000});
  if(hosts)throw Error('Native game hosted during setup');
  await host.screenshot({path:'output/playwright/polycup-waiting-room.png'});
  stage='guest menu';const guest=await client();
  stage='guest joins';await guest.locator('.hub-room').filter({hasText:'Simple Cup'}).getByRole('button',{name:'Join',exact:true}).click();
  await guest.getByRole('heading',{name:'Racers · 2/8',exact:true}).waitFor({timeout:30000});
  await host.getByRole('heading',{name:'Racers · 2/8',exact:true}).waitFor({timeout:30000});
  const idleStart={bytes,requests};await page.waitForTimeout(5000);const idle={seconds:5,bytes:bytes-idleStart.bytes,requests:requests-idleStart.requests};
  stage='draft';await host.getByRole('button',{name:'Begin bans',exact:true}).click();await host.locator('.track-tabs').waitFor();
  // Choose each ban according to the database-owned turn order, using visible track cards.
  for(let i=0;i<2;i++){
   const room=(await(await page.request.get(api+'/test/rooms')).json())[0];
   const who=room.data.cup.draft.order[i]===1?host:guest;
   await who.locator('.track-card:not(:disabled)').first().click();
   const banDeadline=Date.now()+12000;let banned=false;while(Date.now()<banDeadline){const state=(await(await page.request.get(api+'/test/rooms')).json())[0];if((state.data.cup.draft.banHistory?.length??0)===i+1){banned=true;break;}await page.waitForTimeout(200);}if(!banned)throw Error('Ban not acknowledged');
  }
  stage='picks';for(const p of [host,guest]){await p.locator('.track-card:not(:disabled)').first().click();await p.getByRole('button',{name:'Ready up',exact:true}).click();}
  await host.getByRole('button',{name:'Start Cup',exact:true}).waitFor();
  stage='grace cancellation';await host.getByRole('button',{name:'Start Cup',exact:true}).click();
  await guest.getByRole('region',{name:'Chat history'}).getByText('Match starting in 5…',{exact:true}).waitFor({timeout:10000});
  await guest.getByRole('button',{name:'Unready',exact:true}).click();
  await host.getByRole('region',{name:'Chat history'}).getByText('Match start cancelled. Waiting for everyone to ready up.',{exact:true}).waitFor({timeout:10000});
  if(hosts)throw Error('Native game started despite cancellation');
  stage='retry start';await guest.getByRole('button',{name:'Ready up',exact:true}).click();
  await page.waitForTimeout(2200);await host.getByRole('button',{name:'Start Cup',exact:true}).click();
  stage='failed connection';
  await host.getByRole('region',{name:'Chat history'}).getByText(/^Could not connect:/).waitFor({timeout:45000});
  await host.getByRole('button',{name:'Cancel start',exact:true}).click();
  await host.getByRole('button',{name:'Start Cup',exact:true}).waitFor({timeout:15000});
  await guest.getByRole('button',{name:'Unready',exact:true}).waitFor({timeout:15000});
  const saved=(await(await page.request.get(api+'/test/rooms')).json())[0];
  if(saved.data.cup.tracks.length!==1||saved.data.cup.draftReady.length!==2||saved.data.launch)throw Error('Failed handoff lost draft or readiness');
  stage='slow joining racer';await host.getByRole('button',{name:'Start Cup',exact:true}).click();
  await host.getByText(/^Connecting racers/).waitFor({timeout:15000}).catch(()=>{});
  const until=Date.now()+20000;while(!pendingOffers.length&&Date.now()<until)await page.waitForTimeout(100);
  if(!pendingOffers.length)throw Error('Retry did not request a new native connection');
  await page.waitForTimeout(2500);
  const held=(await(await page.request.get(api+'/test/rooms')).json())[0];
  if(held.data.launch?.stage!=='connecting')throw Error('Started without the delayed racer');
  holdJoin=false;for(const send of pendingOffers.splice(0))send();
  stage='native handoff';
  await host.waitForFunction(()=>window.__qaGame&&window.polyModLoader.getFromPolyTrack('Za').get(window.__qaGame)?.multiplayerConnection?.getPlayers().length===2,{},{timeout:65000});
  await guest.waitForFunction(()=>window.__qaGame&&window.polyModLoader.getFromPolyTrack('Za').get(window.__qaGame)?.multiplayerConnection?.getPlayers().length===2,{},{timeout:65000});
  stage='cup race';await host.waitForFunction(()=>document.querySelector('#polytrack-world-cup').shadowRoot.querySelector('.hud')?.textContent.includes('Warmup'),{},{timeout:30000});
  await guest.waitForFunction(()=>document.querySelector('#polytrack-world-cup').shadowRoot.querySelector('.hud')?.textContent.includes('Warmup'),{},{timeout:30000});
  await host.screenshot({path:'output/playwright/polycup-race-host.png'});await guest.screenshot({path:'output/playwright/polycup-race-guest.png'});
  stage='start racing';await host.getByRole('button',{name:'Ready',exact:true}).click();await guest.getByRole('button',{name:'Ready',exact:true}).click();
  for(const p of [host,guest])await p.waitForFunction(()=>{
   const root=document.querySelector('#polytrack-world-cup').shadowRoot,info=window.polyModLoader.getFromPolyTrack('Za').get(window.__qaGame);
   return root.querySelector('.practice-hud')?.hidden&&root.querySelector('.start-countdown')?.hidden&&root.querySelector('.hud')?.textContent.includes('Live round')&&window.polyModLoader.getFromPolyTrack('Xa').get(window.__qaGame)?.getTime().numberOfFrames>500;
  },{},{timeout:20000});
  await host.screenshot({path:'output/playwright/polycup-live-race.png'});
  stage='late spectator';const spectator=await client();await spectator.locator('.hub-room').filter({hasText:'Simple Cup'}).getByRole('button',{name:'Join',exact:true}).click();
  await spectator.waitForFunction(()=>window.__qaGame&&window.polyModLoader.getFromPolyTrack('Za').get(window.__qaGame)?.multiplayerConnection?.getPlayers().length===3,{},{timeout:40000});
  await spectator.locator('.pov-hud').waitFor({state:'visible',timeout:15000});await spectator.keyboard.press('F8');await spectator.waitForFunction(()=>document.querySelector('#polytrack-world-cup').shadowRoot.querySelector('.panel')?.textContent.includes('Live round'),{},{timeout:15000});
  if(!await host.locator('.polycup-toolbar-button').count())throw Error('Cup toolbar shortcut is missing');
  if(await host.getByRole('button',{name:'Change Track',exact:true}).isVisible())throw Error('Native track switch remains enabled during a Cup');
  stage='end cup cleanup';await host.keyboard.press('F8');await host.getByRole('button',{name:'End Cup',exact:true}).click();
  await host.getByRole('dialog',{name:'PolyCup',exact:true}).waitFor({state:'visible',timeout:15000});
  const remaining=await(await page.request.get(api+'/test/rooms')).json();if(remaining.length)throw Error('Ended Cup remained in the directory');
  return {passed:true,hosts,sessions,requests,bytes,idle,pageErrors:errors,network:'Local SQL and signalling; real native WebRTC and game loading; external game API and leaderboard traffic blocked'};
 }catch(error){
  const diagnostics=[];
  for(let i=0;i<pages.length;i++){
   await pages[i].screenshot({path:'output/playwright/room-failure-'+i+'.png'}).catch(()=>{});
   diagnostics.push(await pages[i].evaluate(()=>({text:document.querySelector('#polytrack-world-cup')?.shadowRoot?.querySelector('.hud')?.textContent?.slice(-1800), native:!!window.__qaGame&&!!window.polyModLoader.getFromPolyTrack('Za').get(window.__qaGame)?.multiplayerConnection})).catch(()=>null));
  }
  throw Error(stage+': '+error.message+' '+JSON.stringify({errors,hosts,sessions,diagnostics}));
 }finally{for(const ctx of contexts)await ctx.close();}
}
