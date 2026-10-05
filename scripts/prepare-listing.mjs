import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Preparation only: registration is a moderator action in PML's current registry.
const [baseArg, destination = 'output/library-submission'] = process.argv.slice(2);
if (!baseArg) throw new Error('Usage: node scripts/prepare-listing.mjs <public HTTPS mod base URL | --draft> [output folder]');
const draft = baseArg === '--draft';
const base = draft ? null : new URL(baseArg);
if (base && (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash))
  throw new Error('Use a public HTTPS mod root without credentials, query, or fragment.');
const url = base?.href.replace(/\/+$/, '') ?? null;
const mod = JSON.parse(await readFile('mod.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (manifest.latest[mod.gameVersion] !== mod.version || manifest.author !== mod.author)
  throw new Error('Build the current metadata before preparing a listing.');
const registration = { mod_id: mod.id, url, name: mod.name, authors: [mod.author],
  game_versions: [mod.gameVersion], latest: { [mod.gameVersion]: mod.version },
  tags: mod.tags, icon_url: url ? `${url}/${mod.version}/icon.png` : null, description: mod.description };
const release = { mod_id: mod.id, version: mod.version, game_versions: [mod.gameVersion],
  dependencies: [], changelog: mod.changelog.join('\n') };
const hashes = {};
for (const file of ['manifest.json', 'polylib.json', ...['main.mod.js', 'version.json', 'description.html', 'icon.png'].map(f => `${mod.version}/${f}`)]) {
  hashes[file] = createHash('sha256').update(await readFile(path.join('dist', file))).digest('hex');
}
await mkdir(destination, { recursive: true });
for (const [name, body] of Object.entries({ registration, release, hashes }))
  await writeFile(path.join(destination, `${name}${draft && name === 'registration' ? '.draft' : ''}.json`), JSON.stringify(body, null, 2) + '\n');
await writeFile(path.join(destination, 'submission.txt'), `Please register ${mod.name} by ${mod.author} in the PolyModLoader mod library for PolyTrack ${mod.gameVersion}.\n\nImport URL: ${url ?? 'NOT YET HOSTED — upload dist/ and set its public HTTPS base URL first.'}\nVersion: ${mod.version} (pilot)\n\n${mod.description}\n\n${draft ? 'registration.draft.json has null URL fields until hosting is assigned. Do not submit it as-is. Regenerate with scripts/prepare-listing.mjs and the final HTTPS mod base URL.' : 'registration.json is ready for /api/mods.'} release.json is for /api/versions. The mod is not claimed to be verified. hashes.json identifies the submitted files.\n\nValidation: 25 automated tests including buffered POV under jitter, loss, and reordering; a prior three-instance desktop race checked native invite-code joining, scoring, and switchable racer camera spectating. Normal PML Core 1.3.8 URL import, load, apply, and startup were checked. Version 0.1.1 UI checks covered native track selection, custom-track loading, skin thumbnails, and competition-name typing. A new two-client custom-track transfer check was blocked by the native invite service. Eight-computer Internet performance and independent anti-cheat are not established. Version 0.1.2 buffers camera and car visual transforms together by 250 ms. Every participant must update to 0.1.2 together.\n`);
console.log(`Prepared moderator submission in ${destination}. No registration request was sent.`);
