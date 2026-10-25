import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from './runtime.mjs';
const source=(await readFile('.research/patch-031/ui-audit-entry.ts','utf8')).replaceAll("'./source/","'./.research/test-src/");
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},plugins:[{name:'fixture-assets',setup(b){b.onResolve({filter:/\.ts$/},args=>{const name=path.basename(args.path);if((args.resolveDir.endsWith('test-src')||args.path.includes('test-src/'))&&!['controller.ts','ui.ts','review.ts'].includes(name))return {path:path.resolve('src',name)};});b.onResolve({filter:/ranked-launch-config\.json$/},()=>({path:path.resolve('supabase/ranked-launch-config.json')}));b.onResolve({filter:/\.(css|svg|png)$/},args=>({path:path.resolve(args.path.startsWith('../assets/')?args.path.slice(3):'src/'+path.basename(args.path))}));}}],bundle:true,write:false,format:'iife',loader:{'.css':'text','.svg':'text','.png':'dataurl'}});
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);}else if(req.url==='/font.woff2'){res.end(await readFile('.research/PolyModLoader/forced_square.woff2'));}else{res.setHeader('content-type','text/html');res.end('<style>@font-face{font-family:ForcedSquare;src:url(/font.woff2)}body{margin:0;background:#3d5870}</style><body><script src="/bundle.js"></script></body>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true}),out='output/playwright/pb-rejoin';await mkdir(out,{recursive:true});
const errors=[];let pages=[];
try{
 for(let i=0;i<2;i++){const context=await browser.newContext({viewport:{width:1440,height:960}});const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log(e.message);});await page.goto(url);await page.waitForFunction(()=>window.audit);pages.push(page);}
 const [host,guest]=pages;
 await host.evaluate(()=>{const {c,Cup,ui,tracks}=audit;const s=Cup.newCup('PB regression');for(const id of [1,2]){Cup.addPlayer(s,id,id===1?'Frostbitten':'Famous');Cup.chooseTrack(s,id,tracks[id-1]);}Cup.lockRegistration(s,()=>.999);c.state=s;c.lobby=c.lobby.slice(0,2);s.records[tracks[0].id]={pbs:{1:{status:'ready',frames:70431,source:'profile'},2:{status:'missing'}}};ui.open=true;ui.redraw();});
 await guest.evaluate(()=>{audit.c.isHost=false;audit.c.selfId=2;audit.c.state=null;audit.ui.open=true;});
 // Actual direct WebRTC data channel; fixture controls the scored finishes, not native physics.
 for(const p of pages)await p.evaluate(()=>{window.pc=new RTCPeerConnection({iceServers:[]});});
 await host.evaluate(()=>{window.dc=pc.createDataChannel('pb-state');audit.c.broadcast=()=>{dc.send(JSON.stringify(audit.c.syncMessage()));audit.c.requestPanel(true);audit.ui.open=true;audit.ui.redraw();};});
 await guest.evaluate(()=>{pc.ondatachannel=e=>{window.dc=e.channel;dc.onmessage=e=>{window.lastState=JSON.parse(e.data);audit.c.receive(0,JSON.parse(e.data));audit.c.requestPanel(true);audit.ui.open=true;audit.ui.redraw();};};});
 const offer=await host.evaluate(async()=>{await pc.setLocalDescription(await pc.createOffer());await new Promise(r=>{if(pc.iceGatheringState==='complete')r();else pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')r();};});return pc.localDescription.toJSON();});
 const answer=await guest.evaluate(async offer=>{await pc.setRemoteDescription(offer);await pc.setLocalDescription(await pc.createAnswer());await new Promise(r=>{if(pc.iceGatheringState==='complete')r();else pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')r();};});return pc.localDescription.toJSON();},offer);
 await host.evaluate(answer=>pc.setRemoteDescription(answer),answer);await host.waitForFunction(()=>dc.readyState==='open');
 const round=async(time,other)=>{await host.evaluate(({time,other})=>{const{c,Cup}=audit;Cup.beginRound(c.state);c.state.phase='countdown';Cup.startRace(c.state,Date.now()-Math.max(time,other));Cup.recordFinish(c.state,2,other,c.state.runtime.startsAt+other);Cup.recordFinish(c.state,1,time,c.state.runtime.startsAt+time);c.broadcast();},{time,other});await guest.waitForFunction(time=>audit.c.state?.runtime?.finishes[1]===time,time,{timeout:5000}).catch(async e=>{console.log(JSON.stringify(await guest.evaluate(()=>({received:window.lastState,state:audit.c.state,error:audit.c.error}))));throw e;});};
 const score=async()=>{await host.evaluate(()=>{audit.Cup.completeRound(audit.c.state);audit.c.broadcast();});await guest.waitForFunction(()=>audit.c.state?.runtime===null);};
 await round(27346,26000);for(const p of pages){assert.ok((await p.locator('.panel').innerText()).includes('0:27.346'),await p.locator('.panel').innerText());assert.equal(await p.locator('.panel .record-badge-pb:visible').count(),1);}await guest.screenshot({path:out+'/new-best.png'});await score();
 await round(27393,26010);for(const p of pages){assert.ok((await p.locator('.panel').innerText()).includes('0:27.346'));assert.equal(await p.locator('.panel .record-badge-pb:visible').count(),0);}await guest.screenshot({path:out+'/slower-round.png'});await score();
 for(const [time,other] of [[28000,26020],[27900,26030],[41000,40000],[42000,40001],[43000,40002],[44000,40003]]){await round(time,other);await score();}
 await round(28001,26040);for(const p of pages){assert.ok((await p.locator('.panel').innerText()).includes('0:27.346'));assert.equal(await p.locator('.panel .record-badge-pb:visible').count(),0);}await guest.screenshot({path:out+'/return-to-track.png'});await score();
 for(let i=9;i<15;i++){await round(32000+i,25000+i);await score();}
 await guest.waitForFunction(()=>audit.c.state?.phase==='complete');await guest.reload();await guest.waitForFunction(()=>window.audit);
 const final=await host.evaluate(()=>audit.c.syncMessage());await guest.evaluate(final=>{audit.c.isHost=false;audit.c.selfId=2;audit.c.receive(0,final);audit.c.finishWaitingRace();audit.ui.open=true;audit.ui.redraw();},final);
 assert.equal(await guest.evaluate(()=>audit.c.panelRequest.open),true);await guest.screenshot({path:out+'/reopened-results.png'});
 assert.deepEqual(errors,[]);await writeFile(out+'/checks.json',JSON.stringify({passed:true,transport:'Direct WebRTC, two browser contexts',scope:'Rendered production UI and controller with fixture finishes; not native driving or live backend',checks:['live PB update','slower next round no PB award','compact peer snapshots','separate track bests','return visit','reopened completed standings'],errors},null,2));console.log('Two-browser WebRTC PB and completed-result UI checks passed.');
}finally{await browser.close();server.close();}
