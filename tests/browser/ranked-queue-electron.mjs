// Actual packaged test clients, isolated synthetic auth/database. No live Supabase.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const { _electron }=await import(pathToFileURL(process.env.PWC_PLAYWRIGHT_MODULE || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const root=process.cwd(),api='http://127.0.0.1:8821';
const output=path.join(root,'output/playwright/ranked-queue');await mkdir(output,{recursive:true});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const apps=[],clients=[],errors=[];let requests=0;
const testPost=async(name,body={})=>{const response=await fetch(api+'/test/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
const state=()=>fetch(api+'/test/ranked-state').then(r=>r.json());
const waitUntil=async(fn,label)=>{for(let n=0;n<120;n++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out: '+label);};
async function client(actor,label){
 const app=await _electron.launch({executablePath:path.join(root,'output/test-clients/game/PolyTrack.exe'),args:['--no-sandbox'],
   env:{...process.env,PWC_PROFILE_DIR:path.join(root,'output/queue-qa-profiles',label),PWC_TEST_CLIENT:'Ranked QA '+label},timeout:30000});
 apps.push(app);
 const page=await app.firstWindow();
 page.on('dialog',async d=>{console.log('Startup dialog:',d.message().slice(0,200));await d.dismiss();});
 page.on('console',m=>{if(process.env.PWC_QUEUE_PROBE || m.type()==='error')console.log('CONSOLE',m.text().slice(0,300));});
 page.setDefaultTimeout(15000);
 await page.locator('#polytrack-world-cup').waitFor({state:'attached',timeout:45000});
 await page.exposeFunction('__rankedQaFetch',async req=>{
   requests++;
   const u=new URL(req.url);
   const response=await fetch(api+u.pathname+u.search,{method:req.method,headers:req.headers,body:req.body||undefined});
   return {status:response.status,body:await response.text()};
 });
 const user={id:id(actor),aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},
   user_metadata:{full_name:'QA Racer '+actor,user_name:'qa'+actor},created_at:new Date().toISOString()};
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const token=enc({alg:'HS256'})+'.'+enc({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})+'.test';
 await page.context().addInitScript(({user,token})=>{
   localStorage.setItem('polycup.account.v1',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));
   const original=window.fetch.bind(window);
   window.fetch=async(input,init)=>{
     const request=new Request(input,init),url=new URL(request.url);
     if(url.hostname.endsWith('.supabase.co')){
       const result=await window.__rankedQaFetch({url:url.href,method:request.method,headers:Object.fromEntries(request.headers),body:['GET','HEAD'].includes(request.method)?null:await request.text()});
       return new Response(result.body,{status:result.status,headers:{'content-type':'application/json'}});
     }
     if(['file:','data:','blob:'].includes(url.protocol)||url.hostname==='cdn.polymodloader.com')return original(input,init);
     throw new TypeError('External network blocked in ranked QA');
   };
 },{user,token});
 page.on('pageerror',e=>errors.push(e.message));
 await page.reload();
 await page.locator('#polytrack-world-cup').waitFor({state:'attached',timeout:45000});
 await page.keyboard.press('F8');
 await page.locator('.cup-hub').waitFor({state:'visible'});
 await waitUntil(async()=>{if(await page.getByRole('dialog',{name:'Ranked match',exact:true}).isVisible())return true;const button=page.getByRole('button',{name:'Find ranked',exact:true});return await button.count() ? button.isEnabled() : false;},'ranked enabled '+label);
 console.log('Client ready: '+label);
 return {app,page,actor};
}
const match=p=>p.getByRole('dialog',{name:'Ranked match',exact:true});
const join=async p=>{await waitUntil(()=>p.getByRole('button',{name:'Find ranked',exact:true}).isEnabled(),'join enabled');await p.getByRole('button',{name:'Find ranked',exact:true}).click();};
try{
 await testPost('reset-ranked');
 for(let n=1;n<=(process.env.PWC_QUEUE_PROBE ? 1 : 4);n++)clients.push(await client(n,'player-'+n+'-'+Date.now()));
 await clients[0].page.screenshot({path:path.join(output,'ranked-section.png')});
 const hostBox=await clients[0].page.locator('.hub-host').boundingBox(),rankedBox=await clients[0].page.locator('.ranked-queue-bar').boundingBox();assert.ok(rankedBox.y>=hostBox.y+hostBox.height);
 console.log('Testing queue cancellation');
 await join(clients[0].page);
 await waitUntil(async()=> (await state()).queue.length===1,'one queued');
 if(process.env.PWC_QUEUE_PROBE){await clients[0].page.reload();await clients[0].page.locator('#polytrack-world-cup').waitFor({state:'attached',timeout:45000});await clients[0].page.keyboard.press('F8');}
 await clients[0].page.locator('.ranked-queue-bar').getByRole('button',{name:'Cancel',exact:true}).waitFor();
 await clients[0].page.locator('.ranked-queue-bar').getByRole('button',{name:'Cancel',exact:true}).click();
 await waitUntil(async()=> (await state()).queue.length===0,'cancel removes row');
 if(process.env.PWC_QUEUE_PROBE) { console.log('Reload probe passed');process.exitCode=0; } else {
 console.log('Testing four-player formation');
 for(const c of clients)await join(c.page);
 for(const c of clients)await match(c.page).getByRole('heading',{name:'Match found',exact:true}).waitFor();
 const formed=(await state()).matches.filter(m=>m.status==='reserved');assert.equal(formed.length,1);assert.equal(formed[0].roster.length,4);
 await clients[0].page.screenshot({path:path.join(output,'four-player-found.png')});
 await match(clients[0].page).getByRole('button',{name:'Accept',exact:true}).click();
 await match(clients[0].page).getByRole('heading',{name:'Waiting for other players',exact:true}).waitFor();
 await clients[0].page.screenshot({path:path.join(output,'waiting-for-acceptance.png')});
 for(const c of clients.slice(1))await match(c.page).getByRole('button',{name:'Accept',exact:true}).click();
 for(const c of clients)await match(c.page).getByRole('heading',{name:'Ranked lobby',exact:true}).waitFor();
 assert.equal((await state()).matches.find(m=>m.id===formed[0].id).status,'drafting');
 await clients[0].page.screenshot({path:path.join(output,'four-player-accepted.png')});
 console.log('Testing real client closure and replacement reconnect');
 await clients[2].app.close();
 await testPost('ranked-member-expire',{player:id(3)});
 // Recovery opens the reserved roster rather than Find ranked, so launch helper
 // below is asked to allow a match instead of an enabled idle Join button.
 const replacementPromise=client(3,'replacement-'+Date.now());
 clients[2]=await replacementPromise;
 await match(clients[2].page).getByRole('heading',{name:'Ranked lobby',exact:true}).waitFor();
 assert.equal((await state()).matches.find(m=>m.id===formed[0].id).roster.length,4);
 await match(clients[0].page).getByRole('button',{name:'Leave match',exact:true}).click();
 for(const c of clients)await waitUntil(()=>match(c.page).isHidden(),'match ended returns finder');
 console.log('Testing three-player fallback and decline');
 for(const c of clients.slice(0,3))await join(c.page);
 await testPost('queue-age',{seconds:61});
 for(const c of clients.slice(0,3))await match(c.page).getByRole('heading',{name:'Match found',exact:true}).waitFor();
 assert.equal((await state()).matches.filter(m=>m.status==='reserved')[0].roster.length,3);
 await match(clients[1].page).getByRole('button',{name:'Decline',exact:true}).click();
 for(const c of clients.slice(0,3))await waitUntil(()=>match(c.page).isHidden(),'decline clears peers');
 console.log('Testing duel fallback and acceptance expiry');
 for(const c of clients.slice(0,2))await join(c.page);
 await testPost('queue-age',{seconds:121});
 for(const c of clients.slice(0,2))await match(c.page).getByRole('heading',{name:'Match found',exact:true}).waitFor();
 assert.equal((await state()).matches.filter(m=>m.status==='reserved')[0].roster.length,2);
 await testPost('match-expire');
 for(const c of clients.slice(0,2))await waitUntil(()=>match(c.page).isHidden(),'expiry clears peers');
 assert.equal((await state()).queue.length,0);
 assert.deepEqual(errors,[]);
 const result={passed:true,clients:4,requests,checks:['cancel','four-player match','all accept','close/reconnect same roster','three-player fallback','decline','duel fallback','acceptance expiry'],
  scope:'Packaged Electron clients + local migrated PostgreSQL fixture, synthetic auth. Queue through accepted roster; no ranked racing/ratings or live backend.'};
 await writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
}catch(error){
 console.log('CLIENT ERRORS',JSON.stringify(errors));
 for(const [i,c] of clients.entries()){if(!c.page.isClosed()){console.log('PAGE',i,c.page.url(),await c.page.locator('body').innerText().catch(()=>''));await c.page.screenshot({path:path.join(output,'failure-'+i+'.png'),timeout:5000}).catch(()=>{});}}
 throw error;
}finally{
 await testPost('reset-ranked').catch(()=>{});
 for(const app of apps)await app.close().catch(()=>{});
}
