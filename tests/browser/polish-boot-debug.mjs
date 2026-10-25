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
const output=path.join(root,'output/playwright/polish-flow');await mkdir(output,{recursive:true});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const apps=[],clients=[],errors=[],actionTimings=[];let faultDelay=0;let requests=0,droppedResultResponses=0,submissionCalls=0;let hosts=0,sessions=0;const invites=new Map(),joins=new Map();
const testPost=async(name,body={})=>{const response=await fetch(api+'/test/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
const state=()=>fetch(api+'/test/ranked-state').then(r=>r.json());
const waitUntil=async(fn,label)=>{for(let n=0;n<120;n++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out: '+label);};
async function client(actor,label){
 const app=await _electron.launch({executablePath:path.join(root,'output/polish-test-game/PolyTrack.exe'),args:['--no-sandbox'],
   env:{...process.env,PWC_QA_MANUAL_START:'1',PWC_PROFILE_DIR:path.join(root,'output/queue-qa-profiles',label),PWC_TEST_CLIENT:'Ranked QA '+label},timeout:30000});
 apps.push(app);
 console.log('Launched',actor);const page=await app.firstWindow();console.log('First window',actor);page.on('crash',()=>console.log('RENDERER CRASH',actor));
 await page.context().routeWebSocket('**/*',ws=>{
  if(ws.url().includes('/multiplayer/host')){
   const code='QA'+String(++hosts).padStart(6,'0');invites.set(code,ws);
   ws.onMessage(raw=>{const msg=JSON.parse(String(raw));if(msg.type==='createInvite')ws.send(JSON.stringify({type:'createInvite',inviteCode:code,key:'qa',timeoutMilliseconds:3600000,censoredNickname:msg.nickname||'Anonymous'}));else if(msg.type==='ping')ws.send(JSON.stringify({type:'pong'}));else if(msg.session&&joins.has(msg.session))joins.get(msg.session).send(JSON.stringify(msg));});ws.onClose(()=>invites.delete(code));
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
 console.log('Navigating',actor);await page.goto(pathToFileURL(path.join(root,'output/polish-test-game/resources/app.asar/index.html')).href);
 page.on('pageerror',e=>errors.push(e.message)); console.log('Game loaded',actor);await page.locator('#polytrack-world-cup').waitFor({state:'attached',timeout:75000});
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
 await page.screenshot({path:path.join(output,'client-'+actor+'.png')});console.log('CLIENT UI',actor,await page.locator('.cup-hub').innerText());console.log('DIALOG',await page.locator('.cup-hub').evaluate(d=>({open:d.open,tag:d.tagName,display:getComputedStyle(d).display,rect:d.getBoundingClientRect().toJSON(),styles:[...d.getRootNode().querySelectorAll('style')].map(s=>s.textContent.match(/[^{}]*cup-hub[^{}]*\{[^}]*\}/g)).flat()})));
 console.log('Client ready: '+label);
 return {app,page,actor,label};
}
const match=p=>p.getByRole('dialog',{name:'Ranked match',exact:true});
const join=async p=>{await waitUntil(()=>p.getByRole('button',{name:'Find ranked',exact:true}).isEnabled(),'join enabled');await p.getByRole('button',{name:'Find ranked',exact:true}).click();};

let stage='setup';try{const c=await client(1,'debug-'+Date.now());}finally{for(const app of apps)await app.close().catch(()=>{});}