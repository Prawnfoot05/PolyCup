// Read-only public game API. Never uploads runs, authenticates, or touches Supabase.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {decodeRecording,digest} from '../supabase/input-review/matcher.ts';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
// Use the ordinary public browser path; no login, tokens or leaderboard writes.
const {chromium}=await import(pathToFileURL(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
await page.goto('https://www.kodub.com/apps/polytrack',{waitUntil:'domcontentloaded'});
const catalog=JSON.parse(await readFile('supabase/catalogs/polytrack-0.6.3.json','utf8'));
const folder='output/input-review/references';await mkdir(folder,{recursive:true});
const cap={requests:500,bytes:20000000}, meter={requests:0,bytes:0};
const base='https://vps.kodub.com/v6/',sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(route){
 for(let attempt=0;attempt<3;attempt++){
  if(meter.requests>=cap.requests||meter.bytes>=cap.bytes)throw Error('Download budget exhausted');await sleep(300);meter.requests++;
  const r=await page.evaluate(async url=>{const res=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(20000)});const reader=res.body.getReader();let text='',bytes=0;const decoder=new TextDecoder();while(true){const x=await reader.read();if(x.done)break;bytes+=x.value.length;if(bytes>2000000){await reader.cancel();throw Error('Response too large');}text+=decoder.decode(x.value,{stream:true});}return {status:res.status,ok:res.ok,text:text+decoder.decode(),bytes,retry:res.headers.get('retry-after')};},base+route);
  meter.bytes+=r.bytes;
  if(r.status===429||r.status>=500){await sleep(Math.min(30000,Math.max(1500,Number(r.retry)*1000||0)));continue;}
  if(!r.ok)throw Error('Public replay API HTTP '+r.status);
  if(meter.bytes>cap.bytes)throw Error('Download byte budget exhausted');return JSON.parse(r.text);
 }throw Error('Public replay API unavailable after bounded retries');
}
const manifest={schema:1,gameVersion:catalog.gameVersion,catalogDigest:digest(JSON.stringify(catalog.entries)),referenceTop:10,holdoutRanks:[11,15],at:new Date().toISOString(),tracks:[],meter,cap};
try { for(const track of catalog.tracks){
 const path=`${folder}/${track.id}.json`;let data;
 try{data=JSON.parse(await readFile(path,'utf8'));if(data.track!==track.id||data.gameVersion!==catalog.gameVersion||!data.complete) data=null;}catch{}
 if(!data){
  const board=await get(`leaderboard?version=0.6.3&trackId=${track.id}&skip=0&amount=15&onlyVerified=true`);
  if(!Array.isArray(board.entries))throw Error('Unexpected leaderboard format');
  data={track:track.id,name:track.name,gameVersion:catalog.gameVersion,trackDigest:catalog.entries.find(e=>e.id===track.id).digest,fetchedAt:new Date().toISOString(),entries:[],complete:false};
  for(let offset=0;offset<Math.min(15,board.entries.length);offset+=5){
   const batch=board.entries.slice(offset,offset+5);if(!batch.every(e=>Number.isSafeInteger(e.id)))throw Error('Invalid reference IDs');
   const recordings=await get('recordings?version=0.6.3&ids='+batch.map(e=>e.id).join(','));if(!Array.isArray(recordings)||recordings.length!==batch.length)throw Error('Unexpected recordings response');
   for(let i=0;i<batch.length;i++){const source=batch[i],r=recordings[i];const rank=offset+i+1;if(!r){data.entries.push({id:String(source.id),rank,available:false});continue;}const run=decodeRecording(r.recording,r.frames);data.entries.push({id:String(source.id),rank,available:true,role:rank<=10?'reference':'holdout',nickname:source.nickname,verifiedState:r.verifiedState,frames:r.frames,recording:r.recording,sha256:digest(r.recording),events:run.events});}
  }data.complete=true;await writeFile(path,JSON.stringify(data));
 }
 manifest.tracks.push({track:data.track,name:data.name,fetchedAt:data.fetchedAt,references:data.entries.filter(e=>e.available&&e.rank<=10).length,holdouts:data.entries.filter(e=>e.available&&e.rank>10).length,missing:data.entries.filter(e=>!e.available).length});
 await writeFile(folder+'/manifest.json',JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({tracks:manifest.tracks.length,total:catalog.tracks.length,requests:meter.requests,bytes:meter.bytes}));
}
console.log('Reference cache complete; raw recordings remain local under output/.');
} finally { await browser.close(); }
