import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';
import {chromium} from './runtime.mjs';
const source=`import {LeaderboardUI} from './src/leaderboard-ui.ts';import {FriendsUI} from './src/friends-ui.ts';import {Ranked} from './src/ranked.ts';import world from './src/world-cup.css';import account from './src/account.css';
const root=document.querySelector('#root'),shadow=root.attachShadow({mode:'open'}),style=document.createElement('style');style.textContent=world+account;shadow.append(style);
const names=['Bob','AlexandriaTheVeryLongRacerName','Pilot Racer'],rows=names.map((display_name,i)=>({player_id:String(i),display_name,friendship_id:'f'+i,status:'accepted',direction:'incoming',discord_name:display_name,discord_username:'player'+i,avatar_url:'',online:false}));
const container=document.createElement('div');container.className='account-body account-embedded';container.style.cssText='width:270px;padding:20px;background:#1b2441;color:#eef3ff;--muted:#b7c8df;--gold:#ffda6c';shadow.append(container);const friends={rows,invites:[],results:[],fresh:true,working:false,error:''};const ui=new FriendsUI(()=>container.replaceChildren(ui.render(friends,'friends')));container.append(ui.render(friends,'friends'));
const standings=names.map((display_name,i)=>({player_id:String(i),display_name,rating:28000-i*500,rated_matches:20+i,leaderboard_position:i+1,tier:'grandmaster',gm_position:i+1,friend_position:i+1}));
const api=new Ranked({rpc:(name,args)=>({abortSignal:async()=>({error:null,data:name==='polycup_profile_pictures'?{'0':'https://cdn.discordapp.com/embed/avatars/0.png','1':'https://cdn.discordapp.com/embed/avatars/broken.png','2':'https://untrusted.invalid/tracker.png'}:standings})})});
const board=new LeaderboardUI(shadow,api,()=> '0',()=>{});window.fixture={board};`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',loader:{'.css':'text','.png':'dataurl','.svg':'text'}});
const server=createServer(async(req,res)=>{if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);}else if(req.url==='/font.woff2')res.end(await readFile('.research/PolyModLoader/forced_square.woff2'));else res.end('<style>@font-face{font-family:ForcedSquare;src:url(/font.woff2)}body{background:#10172c}</style><div id="root"></div><script src="/bundle.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),out='output/playwright/profile-pictures';await mkdir(out,{recursive:true});
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:800}}),badRequests=[];page.on('request',r=>{if(r.url().includes('untrusted.invalid'))badRequests.push(r.url());});
  await page.route('https://cdn.discordapp.com/**',r=>r.request().url().includes('broken')?r.fulfill({status:404,body:''}):r.fulfill({contentType:'image/png',path:'assets/icon.png'}));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('.friend-menu-toggle svg').first().waitFor();assert.equal(await page.locator('.friend-menu-toggle').first().textContent(),'');
  await page.locator('.account-body').screenshot({path:out+'/friends-'+width+'.png'});
  await page.getByRole('button',{name:'Actions for Bob',exact:true}).click();await page.getByRole('menu',{name:'Bob actions'}).waitFor();await page.keyboard.press('Escape');
  await page.evaluate(()=>fixture.board.open());const board=page.getByRole('dialog',{name:'Leaderboards'});await board.locator('tbody tr').first().waitFor();await page.waitForFunction(()=>document.querySelector('#root').shadowRoot.querySelectorAll('.player-portrait img').length===1);
  assert.equal(await board.locator('.player-portrait').count(),3);assert.equal(await board.evaluate(el=>el.scrollWidth>el.clientWidth),false);await page.screenshot({path:out+'/leaderboard-'+width+'.png'});
  await board.getByRole('tab',{name:'Friends',exact:true}).click();await board.locator('tbody tr').first().waitFor();assert.equal(await board.locator('.player-portrait').count(),3);assert.deepEqual(badRequests,[]);await page.close();
 }
 await writeFile(out+'/verification.json',JSON.stringify({passed:true,checks:['global and friends avatars','broken image fallback','untrusted URL rejected','continuous player layout','SVG chevron and menu keyboard dismissal','390px and 1280px no overflow']},null,2));console.log('Profile pictures and friend chevrons verified.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
