// Local UI harness. Browser checks intercept all non-local traffic.
import http from 'node:http';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const built=await build({stdin:{contents:`
 import {AccountUI} from './src/account-ui.ts';
 import css from './src/world-cup.css';
 const shadow=document.querySelector('#preview').attachShadow({mode:'open'});
 const style=document.createElement('style');style.textContent=css;shadow.append(style);
 const ui=new AccountUI(shadow);ui.open();
 `,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',loader:{'.css':'text','.svg':'text','.png':'dataurl'}});
const html=`<!doctype html><meta charset="utf-8"><style>
 @font-face{font-family:ForcedSquare;src:url('/font.woff2')}body{background:#10172c;margin:0;min-height:100vh}
 </style><div id="preview"></div><script type="module" src="/preview.js"></script>`;
const server=http.createServer(async(req,res)=>{
 if(req.url==='/preview.js'){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].contents);}
 else if(req.url==='/font.woff2'){res.setHeader('Content-Type','font/woff2');res.end(await readFile('.research/PolyModLoader/forced_square.woff2'));}
 else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}
 else res.writeHead(404).end();
});
server.listen(8847,'127.0.0.1',()=>console.log('Ranked history preview: http://127.0.0.1:8847'));
