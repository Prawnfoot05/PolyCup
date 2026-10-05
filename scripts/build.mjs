import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const mod = JSON.parse(await readFile('mod.json', 'utf8'));
const folder = `dist/${mod.version}`;
await mkdir(folder, { recursive: true });
await build({ entryPoints: ['src/main.mjs'], outfile: `${folder}/main.mod.js`, bundle: true,
  format: 'esm', target: 'es2022', loader: { '.css': 'text' }, legalComments: 'inline' });
await writeFile('dist/manifest.json', JSON.stringify({ name: mod.name, author: mod.author,
  id: mod.id, latest: { [mod.gameVersion]: mod.version } }, null, 2) + '\n');
await writeFile(`${folder}/version.json`, JSON.stringify({ targets: [mod.gameVersion], dependencies: [], main: 'main.mod.js' }, null, 2) + '\n');
await writeFile('dist/polylib.json', JSON.stringify({ shortdesc: mod.description, changelogs: { [mod.version]: mod.changelog } }, null, 2) + '\n');
await copyFile('assets/icon.png', `${folder}/icon.png`);
await copyFile('assets/description.html', `${folder}/description.html`);
console.log(`Built ${mod.name} ${mod.version} by ${mod.author} for PolyModLoader ${mod.gameVersion}.`);
