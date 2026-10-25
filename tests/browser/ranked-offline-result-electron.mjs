// Actual packaged test clients, isolated synthetic auth/database. No live Supabase.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const { _electron }=await import(pathToFileURL(process.env.PWC_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const count=2;
const root=process.cwd(),api='http://127.0.0.1:'+(process.env.POLYCUP_QA_PORT||8821);
const output=path.join(root,'output/playwright/ranked-offline-result');await mkdir(output,{recursive:true});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const apps=[],clients=[],errors=[];let acknowledgementCalls=0,droppedAcknowledgements=0;let requests=0,droppedResultResponses=0,submissionCalls=0;let hosts=0,sessions=0;const invites=new Map(),joins=new Map();
const testPost=async(name,body={})=>{const response=await fetch(api+'/test/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
const state=()=>fetch(api+'/test/ranked-state').then(r=>r.json());
const waitUntil=async(fn,label)=>{for(let n=0;n<120;n++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out: '+label);};
async function client(actor,label){
 const app=await _electron.launch({executablePath:path.join(root,'output/test-clients/game/PolyTrack.exe'),args:['--no-sandbox'],
   env:{...process.env,PWC_QA_MANUAL_START:'1',PWC_PROFILE_DIR:path.join(root,'output/queue-qa-profiles',label),PWC_TEST_CLIENT:'Ranked QA '+label},timeout:30000});
 apps.push(app);
 const page=await app.firstWindow();
 await page.context().routeWebSocket('**/*',ws=>{
  if(ws.url().includes('/multiplayer/host')){
   const code='QA'+String(++hosts).padStart(6,'0');invites.set(code,ws);
   ws.onMessage(raw=>{const msg=JSON.parse(String(raw));if(msg.type==='createInvite')ws.send(JSON.stringify({type:'createInvite',inviteCode:code,key:'qa',timeoutMilliseconds:3600000,censoredNickname:msg.nickname||'Anonymous'}));else if(msg.type==='ping')ws.send(JSON.stringify({type:'pong'}));else if(msg.session&&joins.has(msg.session))joins.get(msg.session).send(JSON.stringify(msg));});ws.onClose(()=>invites.delete(code));
  }else if(ws.url().includes('/multiplayer/join')){
   let host;const session='ranked-qa-'+(++sessions);
   ws.onMessage(raw=>{const msg=JSON.parse(String(raw));if(msg.offer){host=invites.get(msg.inviteCode);joins.set(session,ws);if(!host)return ws.send(JSON.stringify({type:'declineJoin',reason:'Expired'}));host.send(JSON.stringify({...msg,type:'joinInvite',session,iceServers:[]}));}else if('candidate'in msg)host?.send(JSON.stringify({type:'iceCandidate',session,candidate:msg.candidate}));});
  }else ws.close();
 });
 page.on('dialog',async d=>{console.log('Startup dialog:',d.message().slice(0,200));await d.dismiss();});
 page.on('console',m=>{if(process.env.PWC_QUEUE_PROBE || m.type()==='error')console.log('CONSOLE',m.text().slice(0,300));});
 page.setDefaultTimeout(15000);
 let dropResultResponse=false;
 await page.exposeFunction('__rankedQaFetch',async req=>{
   requests++;
   const u=new URL(req.url);
   const response=await fetch(api+u.pathname+u.search,{method:req.method,headers:req.headers,body:req.body||undefined});
   const responseBody=await response.text();if(u.pathname.endsWith('/polycup_ranked_seen_result')&&actor===2){acknowledgementCalls++;if(response.ok&&droppedAcknowledgements===0){droppedAcknowledgements++;throw Error('QA dropped committed acknowledgement response');}}if(u.pathname.endsWith('/polycup_ranked_submit')){submissionCalls++;if(dropResultResponse&&response.ok){dropResultResponse=false;droppedResultResponses++;throw Error('QA dropped result response after commit');}}return {status:response.status,body:responseBody};
 });
 const user={id:id(actor),aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},
   user_metadata:{full_name:'QA Racer '+actor,user_name:'qa'+actor},created_at:new Date().toISOString()};
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token=enc({alg:'HS256'})+'.'+enc({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})+'.test';
 const initialize=({user,token})=>{
   if(window.__rankedQaInitialized)return;window.__rankedQaInitialized=true;
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
 await page.goto(pathToFileURL(path.join(root,'output/test-clients/game/resources/app.asar/index.html')).href);
 page.on('pageerror',e=>errors.push(e.message)); await page.locator('#polytrack-world-cup').waitFor({state:'attached',timeout:75000});
 if(!await page.locator('.ranked-outcome').isVisible()&&!await page.locator('.track-tabs').isVisible()&&!await page.locator('.hud').isVisible()&&!await page.locator('.pov-hud').isVisible())await page.keyboard.press('F8');
 await waitUntil(async()=>await page.locator('.ranked-outcome').isVisible()||await page.locator('.cup-hub').isVisible()||await page.locator('.track-tabs').isVisible()||await page.locator('.hud').isVisible()||await page.locator('.pov-hud').isVisible(),'hub or recovered draft');
 await waitUntil(async()=>{if(await page.locator('.ranked-outcome').isVisible()||await page.getByRole('dialog',{name:'Ranked match',exact:true}).isVisible()||await page.locator('.track-tabs').isVisible()||await page.locator('.hud').isVisible()||await page.locator('.pov-hud').isVisible())return true;const button=page.getByRole('button',{name:'Find ranked',exact:true});return await button.count() ? button.isEnabled({timeout:200}).catch(()=>false) : false;},'ranked enabled '+label);
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
 stage='queue';for(const c of clients)await join(c.page);
 if(count<4){await waitUntil(async()=>(await state()).queue.length===count,'all players queued');await testPost('queue-age',{seconds:121});}
 for(const c of clients)await match(c.page).getByRole('heading',{name:'Match found',exact:true}).waitFor();
 for(const c of clients)await match(c.page).getByRole('button',{name:'Accept',exact:true}).click();
 for(const c of clients)await c.page.locator('.track-tabs').waitFor();
 const current=async()=>(await state()).matches.find(m=>['drafting','racing'].includes(m.status));
 const initial=await current();assert.equal(initial.roster.length,count);assert.equal(hosts,0);
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

 stage='full Cup';await testPost('pause-settlement',{paused:true});
 // Drive through real native finish callbacks. No score, clock, target or round injection.
 const driveStart=Date.now(),deadline=driveStart+12*60*1000;let last='',disconnected=false,rejoined=false;
 while(Date.now()<deadline){
   const status=(await state()).matches.find(m=>m.id===initial.id)?.status;
   if(status==='review')break;
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
   if(false && !disconnected && Date.now()-driveStart>45000 && !text?.includes('Live round')){
    disconnected=true;console.log('Disconnecting guest during Cup');
    const savedLabel=clients[1].label;await clients[1].app.close();await testPost('ranked-member-expire',{player:id(2)});
    clients[1]=await client(2,savedLabel);rejoined=true;console.log('Guest rejoined with saved journal');
   }
   await new Promise(r=>setTimeout(r,200));
 }

 stage='close before settlement';
 assert.equal((await state()).matches.find(m=>m.id===initial.id).status,'review');
 const pending=await testPost('settlement');assert.equal(pending.events.length,0);assert.equal(pending.transcripts.length,2);
 assert.ok(pending.transcripts.every(t=>t.transcript.rounds.length===15));
 const saved=clients[1].label;await clients[1].app.close();
 assert.equal((await testPost('settlement')).events.length,0,'Game closed before rating settlement');
 await testPost('pause-settlement',{paused:false});
 await waitUntil(async()=>(await testPost('settlement')).events.length===2,'settlement while guest offline');
 stage='first reopen';clients[1]=await client(2,saved);
 const result=clients[1].page.getByRole('dialog',{name:'Ranked result',exact:true});
 await result.locator('.ranked-outcome-delta').waitFor({timeout:20000});
 assert.equal(await result.locator('.ranked-outcome-delta').innerText(),'−279');
 await waitUntil(async()=>(await testPost('receipts')).some(r=>r.player_id===id(2)&&r.seen_at),'rendered result acknowledged');
 assert.equal(droppedAcknowledgements,1);
 await clients[1].page.screenshot({path:path.join(output,'first-reopen-rating.png')});
 // Close immediately after viewing, without pressing Continue. Rendering itself counts as seen.
 await clients[1].app.close();stage='second reopen';clients[1]=await client(2,saved);
 await waitUntil(()=>acknowledgementCalls>=2,'durable acknowledgement retry');
 await new Promise(r=>setTimeout(r,4000));
 assert.equal(await clients[1].page.locator('.ranked-outcome').isVisible(),false);
 await clients[1].page.screenshot({path:path.join(output,'second-reopen-no-popup.png')});
 await clients[1].app.close();stage='fresh installation';clients[1]=await client(2,'offline-fresh-'+Date.now());
 await new Promise(r=>setTimeout(r,4000));assert.equal(await clients[1].page.locator('.ranked-outcome').isVisible(),false,'Account receipt survives local storage loss');
 const beforeRetry=await testPost('settlement');await testPost('settle-again',{match:initial.id});assert.deepEqual((await testPost('settlement')).events,beforeRetry.events);
 const proof={passed:true,match:initial.id,rounds:15,closedBeforeSettlement:true,firstReopenDelta:-279,secondReopenPopup:false,freshInstallationPopup:false,droppedAcknowledgements,acknowledgementCalls,ratingEvents:beforeRetry.events.length,scope:'Packaged Electron clients, actual native Cup and WebRTC, local migrated database and local signalling. Worker paused only to deterministically close before settlement; no hosted changes.'};
 await writeFile(path.join(output,'verification.json'),JSON.stringify(proof,null,2));console.log('OFFLINE RESULT VERIFIED',JSON.stringify(proof));assert.deepEqual(errors,[]);
}catch(error){console.log('STAGE',stage,'ERRORS',errors);for(const [i,c] of clients.entries())if(!c.page.isClosed()){console.log('PAGE',i,await c.page.locator('body').innerText().catch(()=>''));console.log('SHADOW',await c.page.locator('#polytrack-world-cup').evaluate(el=>el.shadowRoot.textContent.slice(-13000)).catch(()=>''));await c.page.screenshot({path:path.join(output,'failure-'+i+'.png')}).catch(()=>{});}console.log('STATE',JSON.stringify(await state()));throw error;
}finally{await testPost('clear-rooms').catch(()=>{});await testPost('reset-ranked').catch(()=>{});for(const app of apps)await app.close().catch(()=>{});}
