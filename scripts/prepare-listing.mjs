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
await writeFile(path.join(destination, 'submission.txt'), `Please register ${mod.name} by ${mod.author} in the PolyModLoader mod library for PolyTrack ${mod.gameVersion}.\n\nImport URL: ${url ?? 'NOT YET HOSTED — upload dist/ and set its public HTTPS base URL first.'}\nVersion: ${mod.version} (pilot)\n\n${mod.description}\n\n${draft ? 'registration.draft.json has null URL fields until hosting is assigned. Do not submit it as-is. Regenerate with scripts/prepare-listing.mjs and the final HTTPS mod base URL.' : 'registration.json is ready for /api/mods.'} release.json is for /api/versions. The mod is not claimed to be verified. hashes.json identifies the submitted files.\n\nValidation: 42 automated tests cover all 2-8 racer counts, scoring, ties, remote custom-track chunks, PB identity binding, session records and buffered POV. Real-game browser checks use native libraries plus controlled HUD fixtures. The 0.2.1 UI checks cover native toolbar integration, dynamic leaderboard placement, typography and readable button states. The 0.2.2 checks cover invite copying, expiry, retry, permissions, text cleanup, record readability and native shortcut rebinding with reload persistence. The 0.2.7 browser checks cover the slim white-inset nameplate, square arrow-only buttons, separate PB card, switching, record states and compact-screen separation. The 0.2.6 native browser checks cover centered ranking headings, record spacing and the centered spectator dock, with button/keyboard/direct selection, PB states, long names and waiting controls. The 0.2.5 visual checks cover the separate left-docked strips, eight-racer layout, dynamic top positioning, inset time cells and supplied trophy icon at desktop and compact widths. The 0.2.4 native renderer checks verify G hides and restores both remote cars and nameplates at draw time. More than 6,600 controlled looping frames verify camera distance, buffered model placement, unchanged car state and target switching. Closed startup panels and the centered synchronized 3-2-1-GO countdown were also checked. The 0.2.3 checks cover centered menus, minute-based times, inset time cells, quieter provisional gains, Cup creation/start panel transitions, missed-end recovery and stale-message rejection. Native browser checks verify ending Cup mode restores the normal UI and allows autosave restoration. A prior three-instance desktop race checked the underlying native invite and POV paths. The complete 0.2.0 flow on eight independent computers is not established. Every participant must use ${mod.version}. Library registration remains a moderator action.\n`);
console.log(`Prepared moderator submission in ${destination}. No registration request was sent.`);
