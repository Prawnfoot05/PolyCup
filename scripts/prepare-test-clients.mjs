import { readFile, writeFile, readdir, mkdir, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeArchive } from './install.mjs';

if (process.versions.electron) process.noAsar = true;
const project = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(process.argv[2] || path.join(project, '..'));
const target = path.join(project, 'output', 'test-clients', 'game');
await readFile(path.join(source, 'PolyTrack.exe'));
await mkdir(path.join(target, 'resources'), { recursive: true });
// Copy only the native runtime and its notices. Never copy the user's game archive or profile.
for (const item of await readdir(source, { withFileTypes: true })) {
  if (item.isFile() && (/\.(exe|dll|pak|bin|dat|json)$/i.test(item.name) || /^(LICENSE.*|version)$/.test(item.name)))
    await copyFile(path.join(source, item.name), path.join(target, item.name));
}
await cp(path.join(source, 'locales'), path.join(target, 'locales'), { recursive: true });
await writeFile(path.join(target, 'resources', 'app.asar'), await makeArchive({ testing: true, visible: true }));
console.log('Prepared isolated, windowed test clients. Your normal game and profile were not changed.');
