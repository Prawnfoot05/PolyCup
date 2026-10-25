import http from 'node:http';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const source=`
import {statusIcon} from './src/status-icon.ts';
import {RankedResultUI} from './src/ranked-result-ui.ts';
import {AccountUI} from './src/account-ui.ts';
import {CupHub} from './src/cup-hub.ts';
import {Controller} from './src/controller.ts';
import css from './src/world-cup.css';
const params=new URLSearchParams(location.search),id='00000000-0000-4000-8000-000000000001';
const user={id,aud:'authenticated',role:'authenticated',app_metadata:{provider:'discord'},user_metadata:{full_name:'kiki',user_name:'herrdoktorspankoflex'},created_at:new Date().toISOString()};
const enc=x=>btoa(JSON.stringify(x)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_');
localStorage.clear();sessionStorage.clear();
if(!params.has('guest'))localStorage.setItem('polycup.account.v1',JSON.stringify({access_token:enc({alg:'HS256'})+'.'+enc({sub:id,exp:Math.floor(Date.now()/1000)+3600})+'.test',refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user}));
let queued=false;
window.fetch=async(input,init)=>{
const req=new Request(input,init),name=new URL(req.url).pathname.split('/').at(-1);let data=null;
if(name==='user')data=user;
else if(name==='profiles')data={display_name:params.has('long')?'AlexandriaTheVeryLongRacerName':'kiki'};
else if(name==='player_ratings')data={rating:27845};
else if((name==='polycup_friends'||name==='polycup_friends_v2'))data=['Frostbitten','AlexandriaTheVeryLongRacerName','Monstrosity','SpeedySebas'].map((name,i)=>({friendship_id:'friend'+i,player_id:'racer'+i,display_name:name,discord_username:'racer'+i,status:'accepted',direction:'incoming',online:i<2,activity:i===0?'racing':null,can_join:i===0}));
else if(name==='polycup_friend_invites')data=[];
else if(name==='polycup_room_directory')data=params.has('populated')?[{id:'cup1',title:'Friday Night Cup',host_name:'Frostbitten',phase:'roster',players:3,version:'0.4.0-dev.1'},{id:'cup2',title:'Community Sprint',host_name:'Monstrosity',phase:'picks',players:6,version:'0.4.0-dev.1'}]:[];
else if(name==='polycup_ranked_stats')data=params.has('unranked')?{matches:0,wins:0,win_rate:null}:{matches:20,wins:9,win_rate:45};
else if(name==='polycup_ranked_profile')data=params.has('unranked')?[]:[{player_id:id,display_name:'kiki',rating:27845,tier:params.has('master')?'master':'grandmaster',gm_position:1,provisional:false,rated_matches:20,leaderboard_position:1}];
else if(name==='polycup_queue'||name==='polycup_queue_info'){const body=init?.body?JSON.parse(init.body):{};if(body.action==='join')queued=true;if(body.action==='cancel')queued=false;data={enabled:!params.has('disabled'),state:queued?'queued':'idle',waiting:queued?1:0,version:'0.4.0-dev.1',three_after:60,two_after:120};}
else if(name==='polycup_leaderboard'||name==='polycup_friends_leaderboard'){const body=JSON.parse(await req.text()||'{}'),all=Array.from({length:53},(_,i)=>({player_id:i===0?id:'board'+i,display_name:i===0?'kiki':'Racer '+(i+1),rating:28000-i*250,rated_matches:20+i,leaderboard_position:i+1,tier:i<10?'grandmaster':'diamond',gm_position:i<10?i+1:null}));const rows=name==='polycup_friends_leaderboard'?[all[0],all[11],all[20]].map((r,i)=>({...r,friend_position:i+1})):all;data=rows.slice(body.page_offset||0,(body.page_offset||0)+(body.page_size||26));}
else if(name==='polycup_ranked_history')data=[];
else if(name==='polycup_find_players')data=[];
return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
const shadow=document.querySelector('#preview').attachShadow({mode:'open'});const style=document.createElement('style');style.textContent=css;shadow.append(style);
const account=new AccountUI(shadow),controller=new Controller(()=>{}),hub=new CupHub(shadow,account,controller,()=>{});hub.open();
if(params.has('icons')){const tray=document.createElement('div');tray.className='ranked-match-ready';tray.style.cssText='position:fixed;z-index:9999;left:40%;top:40%;background:#1b2343;padding:40px';for(const kind of ['check','cross','waiting']){const box=document.createElement('span');box.append(statusIcon(kind));tray.append(box);}shadow.append(tray);}

if(params.has('result')){
 const mode=params.get('result');const before={player_id:id,display_name:'kiki',rating:19900,tier:'diamond',provisional:false,rated_matches:20,leaderboard_position:12,gm_position:null};
 const after={...before,rating:mode==='loss'?19725:20150,tier:mode==='loss'?'diamond':'master',rated_matches:21};
 const api={resultStatus:async()=>({status:'review'}),match:async()=>mode==='pending'?null:{match_id:'preview-result',finished_at:new Date().toISOString(),rounds:12,players:[{player_id:id,display_name:'kiki',place:mode==='loss'?4:1,rating_before:19900,rating_after:after.rating},{player_id:'other',display_name:'Racer',place:2,rating_before:15000,rating_after:14900},{player_id:'third',display_name:'Racer 3',place:3,rating_before:15000,rating_after:14900},{player_id:'fourth',display_name:'Racer 4',place:mode==='loss'?1:4,rating_before:15000,rating_after:14900}]},profile:async()=>after};
 window.__qaResult=new RankedResultUI(shadow,api,()=>id,()=>{});window.__qaResult.open('preview-result',id,before);
}

`;
http.createServer(async(req,res)=>{try{
if(req.url.startsWith('/preview.js')){const result=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',loader:{'.css':'text','.svg':'text','.png':'dataurl'}});res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].contents);}
else if(req.url==='/font.woff2'){res.setHeader('Content-Type','font/woff2');res.end(await readFile('.research/PolyModLoader/forced_square.woff2'));}
else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><style>@font-face{font-family:ForcedSquare;src:url(/font.woff2)}body{margin:0;background:#30435c}</style><div id="preview"></div><script type="module" src="/preview.js"></script>');}
}catch(e){res.writeHead(500).end(String(e));}}).listen(Number(process.env.PWC_SOCIAL_PREVIEW_PORT||process.argv[2]||8848),'127.0.0.1',()=>console.log('Local UI-only fixture on 8848; synthetic data, no game/backend traffic.'));
