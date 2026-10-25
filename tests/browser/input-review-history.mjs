import assert from 'node:assert/strict';
import {build} from 'esbuild';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';
import {chromium} from './runtime.mjs';
const fixture=JSON.parse(await readFile('output/input-review/public-fixture.json','utf8'));
const source=`import {RankedHistoryUI} from './src/ranked-history-ui.ts';import {Ranked} from './src/ranked.ts';
const fixture=${JSON.stringify(fixture)},shadow=document.querySelector('#root').attachShadow({mode:'open'}),ui=new RankedHistoryUI(shadow);
const api=new Ranked({rpc:(name,args)=>({abortSignal:async()=>({error:null,data:name==='polycup_profile_pictures'?{[fixture.player]:'https://cdn.discordapp.com/embed/avatars/0.png'}:name==='polycup_input_review_policy'?true:name==='polycup_input_review'?fixture.checks.filter(c=>!args.player_key||c.player_id===args.player_key):name==='polycup_ranked_history'?[{match_id:fixture.match,finished_at:'2026-10-25T10:00:00Z',place:1,rating_before:12000,rating_after:12280,model_version:'pilot',player_count:2,rounds:2}]:{match_id:fixture.match,finished_at:'2026-10-25T10:00:00Z',rounds:2,players:[{player_id:fixture.player,display_name:'Pilot Racer',place:1,rating_before:12000,rating_after:12280},{player_id:'00000000-0000-4000-8000-000000000002',display_name:'Another Racer',place:2,rating_before:12000,rating_after:11721}]}})})});
ui.open(api,fixture.player,'Pilot Racer');window.fixture={ui,api,data:fixture};`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',loader:{'.css':'text','.png':'dataurl','.svg':'text'}});
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);}else if(req.url==='/font.woff2')res.end(await readFile('.research/PolyModLoader/forced_square.woff2'));else res.end('<style>@font-face{font-family:ForcedSquare;src:url(/font.woff2)}body{background:#141d35}</style><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),output='output/playwright/input-review-history';await mkdir(output,{recursive:true});
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://cdn.discordapp.com/**',r=>r.fulfill({contentType:'image/png',path:'assets/icon.png'}));await page.goto('http://127.0.0.1:'+server.address().port);
  const dialog=page.locator('.ranked-history');await dialog.getByText('Possible copied inputs detected · 1 run',{exact:true}).waitFor();await page.screenshot({path:output+'/history-'+width+'.png'});
  await dialog.getByRole('button',{name:/View match:.*possible copied inputs detected/}).click();
  await dialog.locator('.ranked-result-row').first().waitFor();
  assert.equal(await dialog.locator('.ranked-result-row').first().evaluate(el=>el.nextElementSibling.classList.contains('ranked-result-row')),true);
  assert.equal(await dialog.locator('.player-portrait img').count(),1);assert.equal(await dialog.locator('.player-portrait').count(),2);
  await page.screenshot({path:output+'/scoreboard-'+width+'.png'});
  await dialog.locator('.match-input-review>summary').click();await page.getByText('Round 1 · Possible copied inputs detected',{exact:true}).click();
  assert.match(await dialog.innerText(),/Whole run/);assert.match(await dialog.innerText(),/Cached reference rank/);assert.match(await dialog.innerText(),/inputs unavailable/);
  assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);await page.screenshot({path:output+'/details-'+width+'.png'});
  await dialog.getByRole('button',{name:'Back',exact:true}).click();assert.ok(await page.getByText('Possible copied inputs detected · 1 run',{exact:true}).isVisible());assert.deepEqual(errors,[]);await page.close();
 }
 const uiSource=await readFile('src/ui.ts','utf8');assert.doesNotMatch(uiSource,/reviewPanel|Run review|review-panel/);
 await writeFile(output+'/verification.json',JSON.stringify({passed:true,widths:[1280,390],scope:'Real RankedHistoryUI and Ranked RPC adapter using the public SQL-test response for an unrelated observer. SQL permission tests independently verify owner/outsider/anonymous equality. No live backend changes.',checks:['history flag','public match detail','exact segment metrics','missing evidence distinguished','no horizontal overflow','host review entry removed']},null,2));console.log('Shared input review history browser checks passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
