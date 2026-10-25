import { build } from 'esbuild';
import path from 'node:path';
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
const mod = JSON.parse(await readFile('mod.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const source = await readFile('src/cup.ts', 'utf8');
if (pkg.version !== mod.version || !source.includes("VERSION = '" + mod.version + "'")) {
  throw new Error('Package, mod and protocol versions must match.');
}
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
  throw new Error('Usage: node scripts/build.mjs [--output DIRECTORY]');
}
const staged = args.length > 0;
if (staged && path.resolve(args[1]) === path.resolve('dist')) {
  throw new Error('Staging must use a separate directory from dist.');
}
let previousLibrary = {};
try {
  previousLibrary = JSON.parse(await readFile('dist/polylib.json', 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
// Prereleases are local development artifacts, never updates to the stable library.
const output = staged ? args[1] : mod.version.includes('-') ? 'output/dev-mod' : 'dist';
const folder = `${output}/${mod.version}`;
await mkdir(folder, { recursive: true });
const bundle = await build({ metafile: true, entryPoints: ['src/main.ts'], outfile: `${folder}/main.mod.js`, bundle: true,
  format: 'esm', target: 'es2022', loader: { '.css': 'text', '.svg': 'text', '.png': 'dataurl' }, legalComments: 'inline' });
await writeFile(`${output}/manifest.json`, JSON.stringify({ name: mod.name, author: mod.author,
  id: mod.id, latest: { [mod.gameVersion]: mod.version } }, null, 2) + '\n');
await writeFile(`${folder}/version.json`, JSON.stringify({ targets: [mod.gameVersion], dependencies: [], main: 'main.mod.js' }, null, 2) + '\n');
await writeFile(`${output}/polylib.json`, JSON.stringify({ shortdesc: mod.description, changelogs: { ...previousLibrary.changelogs, [mod.version]: mod.changelog } }, null, 2) + '\n');
await copyFile('assets/icon.png', `${folder}/icon.png`);
await copyFile('assets/description.html', `${folder}/description.html`);
// Keep the versioned local distribution discoverable without advertising a
// prerelease through the stable manifest or library metadata.
if (!staged && mod.version.includes('-')) {
  await cp(folder, `dist/${mod.version}`, { recursive: true });
}
if (staged) await writeFile(`${output}/build-inputs.json`, JSON.stringify(Object.keys(bundle.metafile.inputs), null, 2) + '\n');
console.log(`Built ${mod.name} ${mod.version} by ${mod.author} for PolyModLoader ${mod.gameVersion}.`);
