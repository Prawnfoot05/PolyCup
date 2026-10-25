import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from './runtime.mjs';
const source=`
import {RankedReconnectUI} from './src/ranked-reconnect-ui.ts';
import css from './src/world-cup.css';import queueCss from './src/ranked-queue.css';
const shadow=document.querySelector('#root').attachShadow({mode:'open'}),style=document.createElement('style');style.textContent=css+queueCss;shadow.append(style);
const listeners=[];let reconnected=0,abandoned=0,reject=false;
const q={busy:false,error:'',snapshot:{match:{id:'one',status:'racing',is_host:false,can_reconnect:true,left:true,reconnect_until:new Date(Date.now()+119000).toISOString()}},subscribe:fn=>listeners.push(fn),async abandonMatch(id){abandoned++;q.busy=true;emit();await new Promise(r=>setTimeout(r,250));q.busy=false;if(reject)q.error='Network unavailable. Please retry.';else q.snapshot.match.abandoned=true;emit();}};
const emit=()=>listeners.forEach(fn=>fn());const ui=new RankedReconnectUI(shadow,q,()=>true,()=>reconnected++);
window.fixture={ui,q,emit,stats:()=>({reconnected,abandoned}),setReject:v=>reject=v,reset:patch=>{q.busy=false;q.error='';q.snapshot.match={id:crypto.randomUUID(),status:'racing',is_host:false,can_reconnect:true,left:true,reconnect_until:new Date(Date.now()+119000).toISOString(),...patch};emit();}};emit();
`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',loader:{'.css':'text','.svg':'text','.png':'dataurl'}});
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);}else if(req.url==='/font.woff2')res.end(await readFile('.research/PolyModLoader/forced_square.woff2'));else res.end('<style>@font-face{font-family:ForcedSquare;src:url(/font.woff2)}body{background:#141d35}</style><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});const out='output/playwright/ranked-reconnect-choice';await mkdir(out,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const dialog=page.getByRole('dialog',{name:'Return to ranked Cup'});await dialog.waitFor();assert.match(await dialog.innerText(),/abandonment loss/);await page.screenshot({path:out+'/choice.png'});
 assert.equal(await page.evaluate(()=>document.querySelector('#root').shadowRoot.activeElement.textContent),'Reconnect');
 await dialog.getByRole('button',{name:'Reconnect',exact:true}).click();assert.equal((await page.evaluate(()=>fixture.stats())).reconnected,1);
 await page.evaluate(()=>fixture.reset({}));await dialog.getByRole('button',{name:'Abandon match',exact:true}).click();assert.match(await dialog.innerText(),/will not be able to rejoin/);
 await dialog.getByRole('button',{name:'Go back',exact:true}).click();assert.equal((await page.evaluate(()=>fixture.stats())).abandoned,0);
 await page.evaluate(()=>fixture.setReject(true));await dialog.getByRole('button',{name:'Abandon match',exact:true}).click();await page.screenshot({path:out+'/confirmation.png'});
 await dialog.getByRole('button',{name:'Confirm abandonment',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.ok(await dialog.isVisible());
 await page.evaluate(()=>fixture.setReject(false));await dialog.getByRole('button',{name:'Confirm abandonment',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>fixture.stats())).abandoned,2);
 await page.evaluate(()=>fixture.reset({host_disconnected:true,can_reconnect:false}));assert.equal(await dialog.getByRole('button',{name:'Abandon match',exact:true}).count(),0);assert.match(await dialog.innerText(),/do not need to abandon/);await dialog.getByRole('button',{name:'Back to menu'}).click();await page.evaluate(()=>fixture.emit());assert.equal(await dialog.isVisible(),false);
 await page.evaluate(()=>fixture.reset({is_host:true,can_reconnect:false}));assert.match(await dialog.innerText(),/cannot be restored/);assert.equal(await dialog.getByRole('button',{name:'Reconnect',exact:true}).count(),0);
 await page.evaluate(()=>fixture.reset({reconnect_until:new Date(Date.now()-1000).toISOString()}));assert.equal(await dialog.getByRole('button',{name:'Reconnect',exact:true}).isDisabled(),true);assert.match(await dialog.innerText(),/confirming the result/);
 await dialog.getByRole('button',{name:'Back to menu'}).click();await page.evaluate(()=>fixture.emit());assert.equal(await dialog.isVisible(),false);
 await page.evaluate(()=>fixture.reset({}));await dialog.getByRole('button',{name:'Abandon match',exact:true}).click();assert.equal(await page.evaluate(()=>document.querySelector('#root').shadowRoot.activeElement.textContent),'Go back');
 await page.evaluate(()=>{fixture.q.snapshot.match.host_disconnected=true;fixture.q.snapshot.match.can_reconnect=false;fixture.emit();});assert.doesNotMatch(await dialog.innerText(),/Abandon ranked Cup\?|Abandoning counts/);assert.match(await dialog.innerText(),/do not need to abandon/);
 await page.evaluate(()=>fixture.reset({result_submitted:true}));assert.equal(await dialog.isVisible(),false);assert.deepEqual(errors,[]);
 await writeFile(out+'/checks.json',JSON.stringify({passed:true,errors,checks:['explicit reconnect','two-step abandonment','network failure retry','no guest penalty prompt on host loss','host recovery limitation','server-confirmed grace expiry','submitted results excluded']},null,2));console.log('Ranked reconnect/abandon popup browser checks passed.');
}finally{await browser.close();server.close();}
