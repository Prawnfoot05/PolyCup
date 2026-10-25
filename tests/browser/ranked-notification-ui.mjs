import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const bundle=await build({stdin:{contents:`
import {RankedResultUI} from './src/ranked-result-ui.ts';
const shadow=document.body.attachShadow({mode:'open'});let ready=false,hidden=false,user='alice',release;
const result={match_id:'match',players:[{player_id:'alice',place:1,display_name:'Alice',rating_before:12500,rating_after:12780}]};
window.qa={claims:0,seen:0,ready:v=>ready=v,hidden:v=>{hidden=v;document.dispatchEvent(new Event('visibilitychange'));},user:v=>user=v,delayed:false,release:()=>release?.()};
Object.defineProperty(document,'hidden',{get:()=>hidden});
const api={match:async()=>ready?result:null,profile:async()=>null,resultStatus:async()=>({status:'review'})};
const delivery={claim:async()=>{qa.claims++;if(qa.delayed)await new Promise(r=>release=r);return true;},seen:()=>qa.seen++,closed:()=>{}};
const ui=new RankedResultUI(shadow,api,()=>user,()=>{},delivery);
qa.open=()=>ui.open('match',user,null);qa.close=()=>ui.close();qa.reopen=()=>ui.reopen();qa.reset=()=>{ready=false;hidden=false;user='alice';qa.claims=0;qa.seen=0;};
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',loader:{'.css':'text','.svg':'text','.png':'dataurl'}});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();const setup=async()=>{await page.goto('about:blank');await page.addScriptTag({content:bundle.outputFiles[0].text});};
 await setup();await page.evaluate(()=>qa.open());await page.getByText('Confirming rating…',{exact:true}).waitFor();await page.evaluate(()=>qa.close());assert.deepEqual(await page.evaluate(()=>[qa.claims,qa.seen]),[0,0]);
 await page.evaluate(()=>{qa.ready(true);qa.open();});await page.locator('.ranked-outcome-delta').waitFor();await page.waitForFunction(()=>qa.seen===1);await page.evaluate(()=>qa.reopen());await page.locator('.ranked-outcome-delta').waitFor();assert.equal(await page.evaluate(()=>qa.seen),1);
 await setup();await page.evaluate(()=>{qa.ready(true);qa.hidden(true);qa.open();});await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>[qa.claims,qa.seen]),[0,0]);assert.equal(await page.locator('.ranked-outcome-delta').count(),0);await page.evaluate(()=>qa.hidden(false));await page.waitForFunction(()=>qa.seen===1);
 await setup();await page.evaluate(()=>{qa.ready(true);qa.delayed=true;qa.open();});await page.waitForFunction(()=>qa.claims===1);await page.evaluate(()=>{qa.close();qa.release();});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>qa.seen),0);
 console.log('Notification UI passed: loading close, one acknowledgement across reposition, hidden rendering, close during delayed delivery.');
}finally{await browser.close();}
