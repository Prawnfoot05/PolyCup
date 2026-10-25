import { readFile, writeFile, mkdir, access, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pack, unpack } from './asar.mjs';
// Electron otherwise treats an .asar filename as a virtual directory, even in Node mode.
if (process.versions.electron) process.noAsar = true;
const project = fileURLToPath(new URL('../', import.meta.url));
const { version: modVersion } = JSON.parse(await readFile(path.join(project, 'mod.json'), 'utf8'));
const defaultModRoot = modVersion.includes('-') ? path.join('output', 'dev-mod') : 'dist';
const url = 'https://git.polymodloader.com/polytrackmods/PolyModLoader/releases/download/v0.6.3-1/app.asar';
const expected = '5c09a6ab0146797c147b603e0367f14d15e235be77392ca96df66ea81d3b12f8';
const digest = b => createHash('sha256').update(b).digest('hex');
export async function makeArchive({ testing = false, visible = false, modRoot = process.env.PWC_MOD_ROOT || defaultModRoot } = {}) {
  const cache = path.join(project, '.research', 'pml-0.6.3-1.asar'); let official;
  try { official = await readFile(cache); } catch {
    console.log('Downloading pinned PolyModLoader v0.6.3-1…');
    const response = await fetch(url); if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    official = Buffer.from(await response.arrayBuffer());
    if (digest(official) !== expected) throw new Error('PolyModLoader download checksum mismatch.');
    await mkdir(path.dirname(cache), { recursive: true }); await writeFile(cache, official);
  }
  if (digest(official) !== expected) throw new Error('Cached PolyModLoader checksum mismatch.');
  const files = unpack(official);
  // Keep this portable game's normal settings/tracks profile instead of switching to a new app name.
  const metadata = JSON.parse(files.get('package.json').toString());
  metadata.productName = 'PolyTrack'; metadata.name = 'polytrack';
  files.set('package.json', Buffer.from(JSON.stringify(metadata,null,2)));
  for (const file of ['manifest.json', 'polylib.json', ...['version.json', 'main.mod.js', 'description.html', 'icon.png'].map(file => `${modVersion}/${file}`)]) {
    files.set(`world-cup/${file}`, await readFile(path.resolve(project, modRoot, file)));
  }
  // PML's release fetches /package.json, which resolves to the drive root under file://.
  // Resolve the metadata next to its module for a portable desktop installation.
  let loader = files.get('PolyModLoader.js').toString();
  if (!loader.includes('fetch("/package.json")')) throw new Error('Unexpected PML metadata loader.');
  loader = loader.replace('fetch("/package.json")', 'fetch(new URL("./package.json", import.meta.url))');
  // Standalone release has no get-pml-port IPC handler; Electron returns an object.
  if (!loader.includes('if (!port)')) throw new Error('Unexpected launcher helper detection.');
  loader = loader.replace('if (!port)', 'if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535)');
  loader = loader.replace('if (this.polyDb.cacheMods && dbMod && polyModObject.version === dbMod.version)',
    'if (!polyModObject.base.endsWith("/world-cup") && this.polyDb.cacheMods && dbMod && polyModObject.version === dbMod.version)');
  files.set('PolyModLoader.js', Buffer.from(loader));
  let bundle = files.get('main.bundle.js').toString();
  const publicPath = /if \(!e\)\s*throw new Error\(\s*"Automatic publicPath is not supported in this browser",?\s*\);/;
  if (!publicPath.test(bundle)) throw new Error('Unexpected PML bundle public path detection.');
  bundle = bundle.replace(publicPath, 'if (!e) e = new URL("main.bundle.js", document.baseURI).href;');
  files.set('main.bundle.js', Buffer.from(bundle));
  const bootstrap = `<script>(()=>{const base=new URL('world-cup',document.baseURI).href;let mods=[];try{mods=JSON.parse(localStorage.getItem('polyMods')||'[]');if(!Array.isArray(mods))mods=[];}catch{}mods=mods.filter(m=>!String(m.base).endsWith('/world-cup'));if(!mods.some(m=>String(m.base).endsWith('/pmlcore')||String(m.base).endsWith('/pmlcore/')))mods.unshift({base:'https://cdn.polymodloader.com/pml/PolyModLoader/pmlcore',version:'latest',loaded:true});mods.push({base,version:'${modVersion}',loaded:true});localStorage.setItem('polyMods',JSON.stringify(mods));})();</script>`;
  files.set('index.html', Buffer.from(files.get('index.html').toString().replace('<head>', '<head>' + bootstrap)));
  files.set('electron/polycup-auth.cjs', await readFile(path.join(project, 'scripts', 'desktop-auth.cjs')));
  files.set('electron/main.js', Buffer.from(files.get('electron/main.js').toString() + `
    let polycupAuthReturn=null,polycupAuthGeneration=0;
    const checkPolycupSender=event=>{
      if(event.sender!==browserWindow?.webContents||!event.senderFrame?.url.startsWith('file:'))
        throw new Error('Invalid sign-in window.');
    };
    ipcMain.handle('polycup-start-auth-return', async (event,attempt) => {
      checkPolycupSender(event);
      const generation=++polycupAuthGeneration;
      polycupAuthReturn?.cancel();polycupAuthReturn=null;
      const receiver=await require('./polycup-auth.cjs').createAuthReturn(attempt,code=>{
        if(!browserWindow?.isDestroyed())browserWindow.webContents.send('polycup-auth-return',code);
      });
      if(generation!==polycupAuthGeneration){receiver.cancel();throw new Error('Sign-in was replaced.');}
      polycupAuthReturn=receiver;
      return receiver.url;
    });
    ipcMain.handle('polycup-cancel-auth-return',event=>{
      checkPolycupSender(event);++polycupAuthGeneration;
      polycupAuthReturn?.cancel();polycupAuthReturn=null;
    });
    ipcMain.handle('polycup-finish-auth-return',(event,attempt,success)=>{
      checkPolycupSender(event);
      if(polycupAuthReturn?.attempt!==attempt)return;
      if(polycupAuthReturn.finish(success===true)&&success===true){
        if(browserWindow.isMinimized())browserWindow.restore();
        browserWindow.show();browserWindow.focus();
      }
      polycupAuthReturn=null;
    });
    app.on('before-quit',()=>polycupAuthReturn?.cancel());
    ipcMain.handle('polycup-open-auth', async (event, url) => {
      if (event.sender !== browserWindow?.webContents ||
          !event.senderFrame?.url.startsWith('file:') ||
          !require('./polycup-auth.cjs').isDiscordSignInUrl(url))
        throw new Error('Invalid Discord sign-in link.');
      await shell.openExternal(url);
    });
  `));
  files.set('electron/preload.js', Buffer.from(files.get('electron/preload.js').toString() + `
    contextBridge.exposeInMainWorld('polycupDesktop', {
      openDiscord: url => ipcRenderer.invoke('polycup-open-auth', url),
      startReturn: attempt => ipcRenderer.invoke('polycup-start-auth-return', attempt),
      cancelReturn: () => ipcRenderer.invoke('polycup-cancel-auth-return'),
      finishReturn: (attempt, success) => ipcRenderer.invoke('polycup-finish-auth-return',attempt,success),
      onReturn: callback => {
        const listener=(_event,code)=>callback(code);
        ipcRenderer.on('polycup-auth-return',listener);
        return ()=>ipcRenderer.removeListener('polycup-auth-return',listener);
      },
    });
  `));
  if (testing) {
    let main = files.get('electron/main.js').toString();
    if (!main.includes('let browserWindow = null;') || !main.includes('fullscreen: !0,') ||
      !main.includes('browserWindow.removeMenu(),') || main.indexOf('let browserWindow = null;') > main.indexOf('app.requestSingleInstanceLock()'))
      throw new Error('Unexpected desktop launcher: cannot safely isolate test profiles.');
    main = main.replace('let browserWindow = null;', `if(!process.env.PWC_PROFILE_DIR || !path.isAbsolute(process.env.PWC_PROFILE_DIR)) throw new Error('Start this test build with Start-Test-Clients.cmd.');\napp.setPath('userData',path.resolve(process.env.PWC_PROFILE_DIR));\nlet browserWindow = null;`);
    main = main.replace('fullscreen: !0,', `fullscreen: false, show: ${visible},`);
    if (visible) main = main.replace('browserWindow.removeMenu(),', `browserWindow.removeMenu(),
      browserWindow.setTitle('PolyCup test client ' + (process.env.PWC_TEST_CLIENT || '')),
      browserWindow.webContents.on('page-title-updated', e => e.preventDefault()),`);
    if (!main.includes('browserWindow.loadFile("index.html")')) throw new Error('Unexpected test launcher navigation.');
    main = main.replace('browserWindow.loadFile("index.html")', 'process.env.PWC_QA_MANUAL_START === "1" ? browserWindow.loadURL("about:blank") : browserWindow.loadFile("index.html")');
    files.set('electron/main.js', Buffer.from(main));
  }
  return pack(files);
}
async function install() {
  const args = process.argv.slice(2), target = path.resolve(args.find(a => !a.startsWith('--')) ?? path.join(project, '..'));
  const archive = path.join(target, 'resources', 'app.asar'), backup = path.join(target, 'resources', 'app.asar.before-world-cup');
  const receipt = path.join(target, 'resources', 'world-cup-install.json');
  await access(path.join(target, 'PolyTrack.exe'));
  if (args.includes('--restore')) {
    const record = JSON.parse(await readFile(receipt, 'utf8'));
    if (digest(await readFile(archive)) !== record.installedHash) throw new Error('The installed archive changed. Preserve it and restore the backup manually.');
    const original = await readFile(backup);
    if (digest(original) !== record.originalHash) throw new Error('Backup checksum mismatch.');
    await writeFile(archive + '.restore', original); await rename(archive + '.restore', archive);
    console.log('Restored the original game. Backup retained.'); return;
  }
  const current = await readFile(archive); let oldReceipt = null;
  try { oldReceipt = JSON.parse(await readFile(receipt, 'utf8')); } catch {}
  let originalHash = digest(current);
  try {
    const original = await readFile(backup);
    if (!oldReceipt || digest(original) !== oldReceipt.originalHash ||
      ![oldReceipt.installedHash, oldReceipt.originalHash].includes(digest(current)))
      throw new Error('Existing backup or game does not match the installation receipt. Nothing changed.');
    originalHash = oldReceipt.originalHash;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const metadata = JSON.parse(unpack(current).get('package.json').toString());
    if (metadata.version !== '0.6.3') throw new Error(`Expected PolyTrack 0.6.3, found ${metadata.version}.`);
    await copyFile(archive, backup, 1);
  }
  const output = await makeArchive();
  await writeFile(archive + '.world-cup-new', output); await rename(archive + '.world-cup-new', archive);
  await writeFile(receipt, JSON.stringify({ loader: 'v0.6.3-1', mod: modVersion, originalHash, installedHash: digest(output) }, null, 2));
  console.log(`Installed PolyCup ${modVersion} with PolyModLoader v0.6.3-1. Launch PolyTrack.exe and open PolyCup from the main menu.`);
  console.log('Original game backed up as resources/app.asar.before-world-cup.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) install().catch(error => { console.error(error.message); process.exitCode = 1; });
