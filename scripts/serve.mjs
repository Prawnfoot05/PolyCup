import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html',
  '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary' };
const port = Number(process.env.PWC_PORT || 8787);
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const mod = url.pathname === '/mod' || url.pathname.startsWith('/mod/');
    const base = path.resolve(root, mod ? 'dist' : '.research/PolyModLoader');
    let relative = decodeURIComponent(mod ? url.pathname.slice(4) : url.pathname);
    if (relative === '' || relative === '/') relative = '/index.html';
    let file = path.resolve(base, '.' + relative);
    if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await readFile(file);
    if (!mod && relative === '/index.html' && process.env.PWC_AUTOLOAD !== '0') {
      const boot = `<script>const mods=JSON.parse(localStorage.getItem('polyMods')||'[]');if(!mods.some(m=>m.base===location.origin+'/mod')){mods.push({base:location.origin+'/mod',version:'latest',loaded:true});localStorage.setItem('polyMods',JSON.stringify(mods));}</script>`;
      body = Buffer.from(body.toString().replace('<head>', '<head>' + boot));
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(body);
  } catch { res.writeHead(404).end('Not found. Run npm run build and obtain the PML 0.6.3 research checkout for game preview.'); }
}).listen(port, '127.0.0.1', () => console.log(`Local game preview: http://127.0.0.1:${port}/\nMod URL: http://127.0.0.1:${port}/mod`));
