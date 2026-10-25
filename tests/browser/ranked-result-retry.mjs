import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';import os from 'node:os';
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const bundle=await build({stdin:{contents:`import {RankedResultUI} from './src/ranked-result-ui.ts';window.ResultUI=RankedResultUI;`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',loader:{'.css':'text','.png':'dataurl'}});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.clock.install();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{
  const root=document.querySelector('#root').attachShadow({mode:'open'});window.calls=0;window.mode='pending';
  const result={match_id:'match',rounds:15,players:[{player_id:'self',display_name:'QA',place:1,rating_before:12500,rating_after:12700}]};
  window.ui=new window.ResultUI(root,{match:async()=>{calls++;if(mode==='pending'&&calls<=13)return null;if(mode==='error'&&calls===1)throw Error('connection lost');return result;},resultStatus:async()=>({status:'review'}),profile:async()=>null},()=> 'self',()=>{});ui.open('match','self',null);
 });
 for(let i=0;i<12;i++)await page.clock.runFor(5000);
 assert.equal(await page.locator('.ranked-outcome-delta').count(),0);
 await page.clock.runFor(30000);assert.equal(await page.locator('.ranked-outcome-delta').textContent(),'+200');assert.ok(await page.evaluate(()=>calls)>12);
 await page.evaluate(()=>{ui.close();mode='error';calls=0;});await page.clock.runFor(10);await page.evaluate(()=>ui.open('other','self',null));await page.clock.runFor(15000);assert.equal(await page.locator('.ranked-outcome-delta').textContent(),'+200');
 await page.evaluate(()=>{ui.close();mode='pending';calls=0;});await page.clock.runFor(10);await page.evaluate(()=>ui.open('third','self',null));await page.clock.runFor(100);await page.getByRole('button',{name:'Continue',exact:true}).click();const before=await page.evaluate(()=>calls);await page.clock.runFor(60000);assert.equal(await page.evaluate(()=>calls),before);
 console.log('PASS: pending beyond one minute, connection retry, and close stops polling.');
}finally{await browser.close();}
