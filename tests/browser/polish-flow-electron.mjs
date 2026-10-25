process.on('exit',code=>console.log('QA process exit',code));process.on('uncaughtException',e=>{console.error(e.stack);process.exitCode=1;});
// Actual packaged test clients, isolated synthetic auth/database. No live Supabase.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const { _electron }=await import(pathToFileURL(process.env.PWC_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const count=2;
const root=process.cwd(),api='http://127.0.0.1:'+(process.env.POLYCUP_QA_PORT||8847);
const output=path.join(root,process.env.PWC_POLISH_OUTPUT||'output/playwright/polish-flow');await mkdir(output,{recursive:true});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const apps=[],clients=[],errors=[],actionTimings=[];let faultDelay=0;let requests=0,droppedResultResponses=0,submissionCalls=0;let hosts=0,sessions=0;const invites=new Map(),joins=new Map();
const testPost=async(name,body={})=>{const response=await fetch(api+'/test/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
const state=()=>fetch(api+'/test/ranked-state').then(r=>r.json());
const waitUntil=async(fn,label)=>{for(let n=0;n<120;n++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out: '+label);};
async function client(actor,label){
 const app=await _electron.launch({executablePath:path.join(root,'output/polish-test-game/PolyTrack.exe'),args:['--no-sandbox'],
   env:{...process.env,PWC_QA_MANUAL_START:'1',PWC_PROFILE_DIR:path.join(root,'output/queue-qa-profiles',label),PWC_TEST_CLIENT:'Ranked QA '+label},timeout:30000});
 apps.push(app);
 await app.evaluate(({BrowserWindow})=>{for(const win of BrowserWindow.getAllWindows())win.webContents.setBackgroundThrottling(false);});
 console.log('Launched',actor);const page=await app.firstWindow();console.log('First window',actor);page.on('crash',()=>console.log('RENDERER CRASH',actor));
 await page.context().route('https://vps.kodub.com/v6/iceServers',route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'[]'}));
 await page.context().routeWebSocket('**/*',ws=>{
  if(ws.url().includes('/multiplayer/host')){
   const code='QA'+String(++hosts).padStart(6,'0');invites.set(code,ws);
   ws.onMessage(raw=>{const msg=JSON.parse(String(raw));if(msg.type==='createInvite')ws.send(JSON.stringify({type:'createInvite',inviteCode:code,key:'qa',timeoutMilliseconds:3600000,censoredNickname:msg.nickname||'Anonymous'}));else if(msg.type==='ping')ws.send(JSON.stringify({type:'pong'}));else if(msg.session&&joins.has(msg.session))joins.get(msg.session).send(JSON.stringify(msg));});ws.onClose(()=>{if(invites.get(code)===ws)invites.delete(code);});
  }else if(ws.url().includes('/multiplayer/join')){
   let host;const session='ranked-qa-'+(++sessions);
   ws.onMessage(raw=>{const msg=JSON.parse(String(raw));if(msg.offer){host=invites.get(msg.inviteCode);joins.set(session,ws);if(!host)return ws.send(JSON.stringify({type:'declineJoin',reason:'Expired'}));host.send(JSON.stringify({...msg,type:'joinInvite',session,iceServers:[]}));}else if('candidate'in msg)host?.send(JSON.stringify({type:'iceCandidate',session,candidate:msg.candidate}));});
  }else ws.close();
 });
 page.on('dialog',async d=>{console.log('Startup dialog:',d.message().slice(0,200));if(d.type()==='confirm')await d.accept();else await d.dismiss();});
 page.on('console',m=>{if(process.env.PWC_QUEUE_PROBE || m.type()==='error')console.log('CONSOLE',m.text().slice(0,300));});
 page.setDefaultTimeout(15000);
 let dropResultResponse=actor===2;
 await page.exposeFunction('__rankedQaFetch',async req=>{
   requests++;
   const u=new URL(req.url);
   if(faultDelay)await new Promise(resolve=>setTimeout(resolve,faultDelay));
   const response=await fetch(api+u.pathname+u.search,{method:req.method,headers:req.headers,body:req.body||undefined});
   const responseBody=await response.text();if(u.pathname.endsWith('/polycup_ranked_submit')){submissionCalls++;if(dropResultResponse&&response.ok){dropResultResponse=false;droppedResultResponses++;throw Error('QA dropped result response after commit');}}return {status:response.status,body:responseBody};
 });
 const user={id:id(actor),aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},
   user_metadata:{full_name:'QA Racer '+actor,user_name:'qa'+actor},created_at:new Date().toISOString()};
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token=enc({alg:'HS256'})+'.'+enc({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})+'.test';
 const initialize=({user,token})=>{
   if(window.__rankedQaInitialized)return;window.__rankedQaInitialized=true;
   localStorage.setItem('polycup.welcome.seen.v1','1');
   localStorage.setItem('polycup.account.v1',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));
   const capture=setInterval(()=>{try{
    const proto=window.polyModLoader.getFromPolyTrack('du.prototype');if(!proto?.forEachTrack)return;
    window.__qaTracks=window.polyModLoader.getFromPolyTrack(`(()=>{const tracks=[],Sun=i(7929).A;for(let i=0;i<16;i++){
      const t=new Ul.A(0,new Sun());t.addPart(0,0,0,5,0,0,0,null,0);
      for(let z=-4;z>-12-i*4;z-=4)t.addPart(0,0,z,0,0,0,0,null,null);
      t.addPart(0,0,-12-i*4,6,0,0,0,null,null);
      tracks.push({trackData:t,trackMetadata:{name:'Local straight '+(i+1),author:'QA',lastModified:null}});
    }return tracks;})()`);
    proto.forEachTrack=function(callback){window.__qaLibrary=this;for(const track of window.__qaTracks)callback(track.trackData.getId(),track.trackMetadata,'official',0,async()=>track,'');};
    const official=proto.isOfficialTrack;proto.isOfficialTrack=function(id){return window.__qaTracks.some(t=>t.trackData.getId()===id)||official.call(this,id);};
    for(const method of ['forEachTrack','getFirstSessionTrack','getRandomOfficialTrack']){const old=proto[method];proto[method]=function(...args){window.__qaLibrary=this;return old.apply(this,args);};}
    const game=window.polyModLoader.getFromPolyTrack('Is.prototype'),update=game.update;
    game.update=function(...args){window.__qaGame=this;return update.apply(this,args);};clearInterval(capture);
   }catch{}},10);
   const original=window.fetch.bind(window);
   window.fetch=async(input,init)=>{
     const request=new Request(input,init),url=new URL(request.url);
     if(url.hostname.endsWith('.supabase.co')){
       const result=await window.__rankedQaFetch({url:url.href,method:request.method,headers:Object.fromEntries(request.headers),body:['GET','HEAD'].includes(request.method)?null:await request.text()});
       return new Response(result.body,{status:result.status,headers:{'content-type':'application/json'}});
     }
     if(url.pathname.includes('/iceServers'))return new Response('[]',{headers:{'content-type':'application/json'}});
     if(['file:','data:','blob:'].includes(url.protocol)||url.hostname==='cdn.polymodloader.com')return original(input,init);
     throw new TypeError('External network blocked in ranked QA');
   };
 };
 await page.context().addInitScript(initialize,{user,token});
 console.log('Navigating',actor);await page.goto(pathToFileURL(path.join(root,'output/polish-test-game/resources/app.asar/index.html')).href,{waitUntil:'domcontentloaded',timeout:60000});
 page.on('pageerror',e=>errors.push(e.message)); console.log('Game loaded',actor);await page.locator('#polytrack-world-cup').waitFor({state:'attached',timeout:75000}).catch(async e=>{console.log('BOOT FAILURE',await page.locator('body').innerText().catch(()=>''),await page.locator('#error-screen textarea').inputValue().catch(()=>''));throw e;});
 if(!await page.locator('.track-tabs').isVisible()&&!await page.locator('.hud').isVisible()&&!await page.locator('.cup-hub').isVisible()){
 await page.screenshot({path:path.join(output,'boot-'+actor+'.png')});console.log('BOOT',await page.locator('#polytrack-world-cup').evaluate(e=>[...e.shadowRoot.querySelectorAll('dialog[open],section.panel')].map(x=>({label:x.getAttribute('aria-label'),hidden:x.hidden,text:x.innerText.slice(0,400)}))));
 if(await page.locator('.panel').isVisible())await page.keyboard.press('F8');
  const exit=page.getByText('Exit',{exact:true}),back=page.getByText('Back',{exact:true});
  for(let n=0;n<4&&!await page.locator('.polycup-menu-button').isVisible();n++){
   await waitUntil(async()=>await page.locator('.polycup-menu-button').isVisible()||await exit.isVisible()||await back.isVisible(),'native menu');
   if(await page.locator('.polycup-menu-button').isVisible())break;if(await exit.isVisible())await exit.click();else if(await back.isVisible())await back.click();await page.waitForTimeout(500);
  }
  await page.locator('.polycup-menu-button').click();
 }
 await waitUntil(async()=>await page.locator('.cup-hub').isVisible()||await page.locator('.track-tabs').isVisible()||await page.locator('.hud').isVisible()||await page.locator('.pov-hud').isVisible(),'hub or recovered draft');
 await page.screenshot({path:path.join(output,'client-'+actor+'.png')});console.log('CLIENT UI',actor,await page.locator('.cup-hub').innerText());
 console.log('Client ready: '+label);
 return {app,page,actor,label};
}
const match=p=>p.getByRole('dialog',{name:'Ranked match',exact:true});
const join=async p=>{await waitUntil(()=>p.getByRole('button',{name:'Find ranked',exact:true}).isEnabled(),'join enabled');await p.getByRole('button',{name:'Find ranked',exact:true}).click();};

let stage='setup';
try{
 await testPost('reset-ranked');
 for(let n=1;n<=count;n++)clients.push(await client(n,'race-'+n+'-'+Date.now()));
 const catalog=await clients[0].page.evaluate(()=>{const tracks=[];window.__qaLibrary.forEachTrack((id,m,category)=>{if(['official','community'].includes(category))tracks.push({id,category,digest:id});});return tracks;});
 assert.equal(catalog.length,16);await testPost('catalog',{tracks:catalog});

 if(process.env.PWC_RANKED_ONLY!=='1'){
 stage='custom menu stress';const h=clients[0].page,g=clients[1].page;
 await h.getByRole('button',{name:'Host Cup',exact:true}).click();await h.getByRole('dialog',{name:'Host Cup',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await (await fetch(api+'/test/rooms')).json()).length,0);
 await h.getByRole('button',{name:'Host Cup',exact:true}).click();await h.getByRole('button',{name:'Create Cup',exact:true}).click();await h.getByRole('heading',{name:'Racers · 1/8',exact:true}).waitFor();
 assert.equal(await h.getByRole('button',{name:'End Cup',exact:true}).count(),0);assert.equal(await h.getByRole('button',{name:'Close Cup',exact:true}).count(),1);
 const code=await h.locator('.room-code button').innerText();await g.getByRole('textbox',{name:'Room code',exact:true}).fill(code);await g.locator('.hub-header').getByRole('button',{name:'Join',exact:true}).click();await h.getByRole('heading',{name:'Racers · 2/8',exact:true}).waitFor();
 await g.getByRole('button',{name:'Leave Cup',exact:true}).click();await g.locator('.cup-hub').waitFor({state:'visible'});
 await g.getByRole('textbox',{name:'Room code',exact:true}).fill(code);await g.locator('.hub-header').getByRole('button',{name:'Join',exact:true}).click();await g.getByRole('heading',{name:'Racers · 2/8',exact:true}).waitFor();
 faultDelay=250;await h.getByRole('button',{name:'Begin bans',exact:true}).click();
 for(let i=0;i<2;i++){
  await waitUntil(async()=>await h.locator('.track-card:not(:disabled)').count() || await g.locator('.track-card:not(:disabled)').count(),'current ban turn');
  const p=await h.locator('.track-card:not(:disabled)').count()?h:g;await p.locator('.track-card:not(:disabled)').first().waitFor();const start=Date.now();await p.locator('.track-card:not(:disabled)').first().click();
  await p.waitForFunction(()=>document.querySelector('#polytrack-world-cup').shadowRoot.querySelector('.track-card[aria-busy=true]'));await p.screenshot({path:path.join(output,'pending-ban-'+i+'.png')});
  await waitUntil(async()=>!await p.locator('.track-card[aria-busy=true]').count(),'ban acknowledgement');actionTimings.push({kind:'ban',client:p===h?'host':'guest',delayMs:faultDelay,elapsedMs:Date.now()-start});
 }
 for(const p of [h,g]){const card=p.locator('.track-card:not(:disabled)').first();const start=Date.now();await card.click();await waitUntil(async()=>!await p.locator('.track-card[aria-busy=true]').count(),'pick acknowledgement');actionTimings.push({kind:'pick',client:p===h?'host':'guest',delayMs:faultDelay,elapsedMs:Date.now()-start});await p.getByRole('button',{name:'Ready up',exact:true}).click();}
 await h.getByRole('button',{name:'Start Cup',exact:true}).waitFor();await h.getByRole('button',{name:'Start Cup',exact:true}).click();await g.getByRole('button',{name:'Unready',exact:true}).click();await waitUntil(async()=>!(await (await fetch(api+'/test/rooms')).json())[0].data.launch,'cancelled countdown');assert.equal(hosts,0);
 faultDelay=0;await g.getByRole('button',{name:'Ready up',exact:true}).click();await waitUntil(async()=>(await (await fetch(api+'/test/rooms')).json())[0].data.cup.draftReady.length===2,'ready acknowledged');await h.getByRole('button',{name:'Start Cup',exact:true}).click();
 for(const p of [h,g])await p.waitForFunction(()=>document.querySelector('#polytrack-world-cup').shadowRoot.querySelector('.hud')?.textContent.includes('Warmup'),{},{timeout:75000});
 await g.keyboard.press('F8');assert.equal(await g.getByRole('button',{name:'Find lobby',exact:true}).count(),0);await g.getByRole('button',{name:'Leave Cup',exact:true}).click();await g.locator('.cup-hub').waitFor({state:'visible'});
 await g.getByRole('textbox',{name:'Room code',exact:true}).fill(code);await g.locator('.hub-header').getByRole('button',{name:'Join',exact:true}).click();await g.waitForFunction(()=>document.querySelector('#polytrack-world-cup').shadowRoot.querySelector('.hud')?.textContent.includes('Warmup'),{},{timeout:75000});
 await h.keyboard.press('F8');assert.equal(await h.locator('.panel .lobby-rank-badge').count(),2);await h.screenshot({path:path.join(output,'racing-panel.png')});await h.getByRole('button',{name:'Close Cup',exact:true}).click();for(const p of [h,g])await p.locator('.cup-hub').waitFor({state:'visible',timeout:20000});
 console.log('Custom stress passed',JSON.stringify(actionTimings));await writeFile(path.join(output,'custom-checks.json'),JSON.stringify({passed:true,actionTimings},null,2));
 }
 const rankedHostBaseline=hosts;

 stage='queue';for(const c of clients)await join(c.page);
 if(count<4){await waitUntil(async()=>(await state()).queue.length===count,'all players queued');await testPost('queue-age',{seconds:121});}
 for(const c of clients)await match(c.page).getByRole('heading',{name:'Match found',exact:true}).waitFor();
 for(const c of clients)await match(c.page).getByRole('button',{name:'Accept',exact:true}).click();
 for(const c of clients)await c.page.locator('.track-tabs').waitFor();
 const current=async()=>(await state()).matches.find(m=>['drafting','racing'].includes(m.status));
 const initial=await current();assert.equal(initial.roster.length,count);assert.equal(hosts,rankedHostBaseline);
 if(count===4){stage='draft reconnect';
 const saved=initial.id;await clients[1].app.close();await testPost('ranked-member-expire',{player:id(2)});clients[1]=await client(2,'reconnected-'+Date.now());assert.equal((await current()).id,saved);}
 await waitUntil(async()=>await clients[0].page.locator('.lobby-rank-badge img').count()===count,'lobby badge artwork');
 stage='bans';
 for(let i=0;i<count*2;i++){
  const who=clients.find(c=>id(c.actor)===initial.roster[i%count]);
  await who.page.locator('.track-card:not(:disabled)').first().click();
  await waitUntil(async()=>(await current()).session.bans.length===i+1,'ban '+i);
 }
 stage='picks';
 for(const c of clients){
  for(let i=0;i<2;i++){
   await c.page.locator('.track-card:not(:disabled)').nth(i).click();
   await waitUntil(async()=>(await current()).session.picks.filter(p=>p.player_id===id(c.actor)).length===i+1,'pick '+i);
  }
 }
 await clients[0].page.screenshot({path:path.join(output,'draft.png')});
 for(const c of clients){assert.equal(await c.page.getByRole('button',{name:'Start Cup',exact:true}).count(),0);await c.page.getByRole('button',{name:'Ready up',exact:true}).click();}
 stage='handoff';
 for(const c of clients)await c.page.waitForFunction(()=>document.querySelector('#polytrack-world-cup').shadowRoot.querySelector('.hud')?.textContent.includes('Warmup'),{},{timeout:75000});
 assert.equal((await current()).status,'racing');
 for(const c of clients){assert.equal(await c.page.locator('.panel').isVisible(),false);await c.page.screenshot({path:path.join(output,'warmup-'+c.actor+'.png')});}

 if(process.env.PWC_GARAGE_SMOKE==='1'){
  for(const c of clients){
   const native=await c.page.evaluate(()=>window.polyModLoader.getFromPolyTrack('Za').get(window.__qaGame).multiplayerConnection.getPlayers().map(p=>({id:p.id,nickname:p.nickname,country:p.countryCode})));
   const hud=await c.page.locator('.hud').innerText();for(const p of native)assert.ok(hud.includes(p.nickname),'Native garage nickname missing from Cup HUD');
   assert.equal(await c.page.locator('.hud .player-portrait').count(),0);assert.ok(await c.page.locator('.hud .car-skin').count()>0);
   await c.page.screenshot({path:path.join(output,'garage-'+c.actor+'.png')});
  }
  await writeFile(path.join(output,'garage-verification.json'),JSON.stringify({passed:true,checks:['native garage nicknames in Cup HUD','car thumbnails retained','no account portraits in live Cup'],scope:'Two packaged clients, actual native handoff and warmup; local backend and signalling.'},null,2));
 }else{
 stage='full Cup';
 // Drive through real native finish callbacks. No score, clock, target or round injection.
 const driveStart=Date.now(),deadline=driveStart+12*60*1000;let last='',disconnected=false,rejoined=false;
 while(Date.now()<deadline){
   const status=(await state()).matches.find(m=>m.id===initial.id)?.status;
   if(status==='completed')break;
   if(['unrated','cancelled'].includes(status))throw Error('Cup ended '+status);
   for(const c of clients){
    if(c.page.isClosed())continue;
    const ready=c.page.getByRole('button',{name:'Ready',exact:true});if(await ready.isVisible())await ready.click();
    const hud=await c.page.locator('.hud').textContent().catch(()=> '');
    if(c.actor===1 && hud!==last){console.log('HOST HUD',hud);last=hud;}
    if(hud?.includes('Live round')){c.liveSince??=Date.now();if(c.actor===1||Date.now()-c.liveSince>900)await c.page.keyboard.down('ArrowUp');}else{c.liveSince=null;await c.page.keyboard.up('ArrowUp');}
   }
   // Reconnect between rounds, retaining the client's finish journal/profile.
   const text=await clients[0].page.locator('.hud').textContent().catch(()=> '');
   if(!disconnected && Date.now()-driveStart>45000 && !text?.includes('Live round')){
    disconnected=true;console.log('Disconnecting guest during Cup');
    const savedLabel=clients[1].label;await clients[1].app.close();await testPost('ranked-member-expire',{player:id(2)});
    clients[1]=await client(2,savedLabel);const resume=clients[1].page.getByRole('dialog',{name:'Return to ranked Cup',exact:true});await resume.waitFor({timeout:30000});await clients[1].page.screenshot({path:path.join(output,'reconnect-choice.png')});assert.match(await resume.innerText(),/abandonment loss/);await resume.getByRole('button',{name:'Reconnect',exact:true}).click();await clients[1].page.locator('.hud').waitFor({state:'visible',timeout:75000});rejoined=true;console.log('Guest rejoined native race with saved journal');
   }
   await new Promise(r=>setTimeout(r,200));
 }
 const finalMatch=(await state()).matches.find(m=>m.id===initial.id);assert.equal(finalMatch.status,'completed');
 await waitUntil(()=>submissionCalls>=3,'lost result response retried');assert.equal(droppedResultResponses,1);
 const beforeRetry=await testPost('settlement');assert.equal(beforeRetry.events.filter(e=>e.match_id===initial.id).length,2);
 await testPost('settle-again',{match:initial.id});
 const afterRetry=await testPost('settlement');assert.deepEqual(afterRetry.events,beforeRetry.events);assert.deepEqual(afterRetry.ratings,beforeRetry.ratings);
 for(const c of clients){await c.page.getByRole('dialog',{name:'Ranked result',exact:true}).locator('.ranked-outcome-delta').waitFor({timeout:30000});await c.page.screenshot({path:path.join(output,'settled-'+c.actor+'.png')});}
 assert.ok(disconnected&&rejoined);
 await clients[0].page.getByRole('dialog',{name:'Ranked result',exact:true}).getByRole('button',{name:'Match history',exact:true}).click();
 await clients[0].page.locator('.ranked-history-row').first().waitFor();assert.equal(await clients[0].page.locator('.ranked-history-row').count(),1);
 const savedProfile=clients[1].label;await clients[1].app.close();clients[1]=await client(2,savedProfile);
 await waitUntil(async()=>(await clients[1].page.locator('.ranked-player-stats').innerText()).includes('1 match'),'rating persisted after client restart');
 assert.equal(await clients[1].page.getByRole('dialog',{name:'Ranked result',exact:true}).isVisible(),false,'an already-shown result must not reopen after restarting');
 assert.deepEqual((await testPost('settlement')).events,beforeRetry.events);
 await clients[1].page.screenshot({path:path.join(output,'rating-after-restart.png')});
 console.log('FULL CUP VERIFIED',JSON.stringify({match:initial.id,disconnected,rejoined,events:beforeRetry.events,ratings:beforeRetry.ratings}));
 if(process.env.POLYCUP_QA_INPUT_REVIEW==='1'){
  await waitUntil(async()=>{const r=await testPost('input-review');return r.runs.length>=20&&r.checks.length===r.runs.length;},'native input submissions and checks');
  const evidence=await testPost('input-review');assert.ok(evidence.runs.some(r=>r.player_id===id(1)));assert.ok(evidence.runs.some(r=>r.player_id===id(2)));assert.ok(evidence.runs.every(r=>r.bytes>0&&r.finish===r.native_finish+r.time_offset));assert.ok(evidence.checks.every(c=>c.status==='no_reference'||c.status==='unsupported'));
  await writeFile(path.join(output,'input-review.json'),JSON.stringify({passed:true,...evidence},null,2));
 }
 await writeFile(path.join(output,'settlement.json'),JSON.stringify({passed:true,disconnected,rejoined,droppedResultResponses,submissionCalls,elapsedMs:Date.now()-driveStart,...beforeRetry},null,2));
 assert.deepEqual(errors,[]);assert.ok(hosts>0&&sessions>0,'Local signalling must intercept native connections');
 const result={passed:true,actionTimings,clients:count,requests,hosts,sessions,catalog:catalog.length,checks:[count===2?'duel fallback':'four-player formation',count===4?'draft reconnect':'fresh draft','accept popup','2 bans each','2 picks each','automatic all-ready grace','native WebRTC handoff','warmup','all clients live physics','verified racing reconnect','ranked host controls hidden','full native Cup completion','exactly once settlement'],scope:'Packaged Electron clients, local migrated PostgreSQL + synthetic auth + local signalling; real native WebRTC and simulation. Local rating settlement; no hosted Supabase changes.'};
 await writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }
}catch(error){console.log('STAGE',stage,'ERRORS',errors);for(const [i,c] of clients.entries())if(!c.page.isClosed()){console.log('PAGE',i,await c.page.locator('body').innerText().catch(()=>''));console.log('SHADOW',await c.page.locator('#polytrack-world-cup').evaluate(el=>el.shadowRoot.textContent.slice(-13000)).catch(()=>''));await c.page.screenshot({path:path.join(output,'failure-'+i+'.png')}).catch(()=>{});}console.log('STATE',JSON.stringify(await state()));throw error;
}finally{await testPost('clear-rooms').catch(()=>{});await testPost('reset-ranked').catch(()=>{});for(const app of apps)await app.close().catch(()=>{});}
