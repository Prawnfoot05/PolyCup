# World Cup for PolyTrack 0.6.3

An organizer-hosted, eight-player competition mod by **Kiki**, with two sequential semifinals, a grand final, Cup Mode scoring, and racer POV spectating. Version 0.1.1 is a pilot build.

## PolyModLoader library distribution

The `dist/` folder is a standard PolyModLoader package: a root `manifest.json`, versioned JavaScript, version metadata, description, and icon. It can be hosted and installed through PolyModLoader's **Mods** menu without this project's desktop installer. Everyone in an event still needs PolyModLoader for PolyTrack 0.6.3 and the same World Cup version.

**Library registration is pending moderator action.** The package is hosted in [Prawnfoot05/PolyCup](https://github.com/Prawnfoot05/PolyCup). Until registration, use **Mods → Add**, enter the following URL and version `0.1.1`, click **Import**, then select World Cup and choose **Load → Apply**:

```text
https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist
```

After registration, players will find **World Cup — Kiki** in **Mods → Mod Library → Open**. The [moderator handoff](library-submission/submission.txt) includes the exact import URL, registration payload, version payload, and file hashes. Registration and verification are separate moderator decisions; this repository does not claim either has happened.

The current 0.6.3 in-game library reads `https://mods.polymodloader.com/api/mods` and `/api/versions`. Creating a mod record requires a PolyModLoader moderator or administrator; a modder account can only add versions to an existing record. The older GitHub PolyLibrary catalog is not the current in-game registration mechanism. See the [registry documentation](https://git.polymodloader.com/polytrackmods/modlist-rest-api) and [PML Core 1.3.8](https://git.polymodloader.com/polytrackmods/PolyModLoader/src/branch/pmlcore/1.3.8/main.mod.js).

For future releases, commit the rebuilt `dist/` package and regenerate the moderator handoff:

```powershell
npm.cmd ci
npm.cmd run build
node scripts/prepare-listing.mjs https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist library-submission
```

The helper writes `registration.json`, `release.json`, `hashes.json`, and a ready-to-send `submission.txt` to the chosen folder (default: `output/library-submission/`). It does not send anything or claim moderator verification. The moderator registers the mod and its initial version; verification remains their decision. Only `dist/` is needed for installation. Never upload the ignored research folder, game files, local profiles, test logs, or the source PDFs.

For a handoff before hosting is assigned, use `node scripts/prepare-listing.mjs --draft`. This leaves the public URL and icon URL explicitly unset in `registration.draft.json`; regenerate with the real URL before registration.

If you used the bundled desktop installer below, use **Restore-Original.cmd** with the game closed before switching that game to a normal PolyModLoader installation. Its bootstrap reinstalls the bundled copy on launch; simply importing the hosted copy would leave duplicate copies of the mod.

## Bundled Windows installation (local pilot)

1. Close the copy of PolyTrack you want to modify.
2. Put this entire `polytrack-world-cup` folder beside `PolyTrack.exe` (inside the game folder).
3. Double-click `Install-World-Cup.cmd`. It downloads the pinned official **PolyModLoader v0.6.3-1**, verifies its SHA-256, and installs the bundled mod.
4. Launch `PolyTrack.exe`. Press **F8** to open World Cup.

The installer uses the Node runtime already inside PolyTrack. No separate Node installation, tournament server, or account is required. Every participant and spectator installs the same mod version. Internet access and PolyTrack's existing multiplayer signaling/relay infrastructure are still required.

For another target location, run `Install-World-Cup.ps1 -GameDirectory "C:\path\to\PolyTrack"` in PowerShell. The batch launcher uses a process-only PowerShell execution-policy override; it does not change the machine policy.

The original game archive is preserved at `resources/app.asar.before-world-cup`, with hashes in `resources/world-cup-install.json`. The installer retains the PolyTrack application profile name so your ordinary settings and local tracks remain available. Double-click `Restore-Original.cmd` with the game closed to restore it. Backups are retained. If another tool has changed the installed archive, the restore script stops instead of overwriting it.

## Run a competition

### Test on one Windows computer

Double-click **Start-Test-Clients.cmd** to open two isolated, windowed clients first. To open all eight, run this from the mod folder:

```powershell
.\Start-Test-Clients.cmd -Count 8
```

To add six clients after starting the first two, use `Start-Test-Clients.cmd -StartFrom 3 -Count 6`. Each numbered client has its own persistent profile under `output/test-clients/profiles/`; launching an already-open number focuses that client. The helper makes a separate game copy under `output/test-clients/game/`, assigns each profile before the native single-instance check, and keeps your normal game/profile untouched. The first run downloads the pinned loader if it is not already cached. Close all test clients before rerunning the helper to rebuild them with a newer bundled mod.

Set distinct player names in the test clients. Host in client 1, share its native invite code with clients 2–8, and register all eight; the host is one of the racers. Set low graphics settings and keep unused windows small. Eight live renderers can consume substantial memory/GPU resources; add them gradually. Double-click **Stop-Test-Clients.cmd** to stop only these test windows (profiles are retained).

This checks lobby and tournament behavior on one computer. It does not simulate eight independent Internet connections, and it does not provide bots to drive eight cars simultaneously. Native invite/signaling services must still be reachable.

### Organizer flow

1. The organizer hosts a normal multiplayer room. Set **Maximum Players to 16**, choose an initial track, and share the native **Invite** code.
2. Open F8 and create a tournament. Register eight connected people under **Racers**. Everyone else spectates. The organizer may race or remain a spectator.
3. Set seeds with the arrows. Seeds 1 and 2 are the two captains. Under **Tracks**, choose **3–5 tracks** from **Official tracks**, **Community tracks**, or **Custom tracks** saved in your game profile. Search by track or author. Participants receive each track through native multiplayer and do not need to install custom tracks themselves. Pasting a share code remains an optional fallback.
4. Choose the disconnect rule: **DNF** or **void and wait for reconnect**. There is deliberately no default. Disconnects before racing void the round in either mode.
5. Lock the grid. Captains alternate picking opponents into their own semifinal. The organizer can record an absent captain's stated pick; those overrides are logged.
6. Each match's racers pick the track order in seed order, repeating until every track has been chosen. Start the first round. The mod loads the track, waits for all active racers, runs the warmup where applicable, and starts a synchronized countdown.
7. Run semifinal A, then B, then the grand final. **Automatic rounds** can start the next round after five seconds; starting a new match remains an organizer action.
8. Export the tournament from the footer. The export includes the full race history and track codes. An autosave is also kept locally on the organizer's device.

The 16-person native room limit includes racers, organizer, and spectators. With eight racers and a separate organizer, there are seven additional spectator places. This mod does not remove the native capacity limit or implement host migration. Keep the organizer's game open and the computer awake throughout the event.

## Spectating

Spectators follow a selected competitor's **actual driving-camera position, orientation, and field of view**, including changes between cockpit and chase view. Use **[ / ]**, the previous/next buttons, or the racer selector to switch. The HUD identifies the racer and shows their timer and speed alongside the match scores. Finished qualifiers and racers waiting for their semifinal become spectators automatically.

Camera samples travel at up to 20 Hz over a separate unreliable WebRTC channel through the organizer. Playback interpolates against the game's buffered car frames. Expect network delay; this is a rendering of the race in your own game, not a video stream or an exact copy of the driver's UI, graphics settings, or screen. No screen, microphone, or webcam capture is used. Inactive cars are hidden during Cup mode.

## Rules implemented

| Rule | Behavior |
|---|---|
| Bracket | Eight racers; two four-player semifinals; top two from each enter the final |
| Target | 120 in semifinals; 140 in the final |
| Points | 10 / 6 / 4 / 3 for finishers; DNF earns zero |
| Finalist | Reach the target, then win a later round outright |
| Match end | Two qualifying wins per semifinal; three podium wins in the final |
| Track rotation | Four scored rounds per track; cycle the selected order |
| Warmup | 15 seconds on each new track visit, including the next rotation |
| Finish timeout | Ten seconds after the first finish; bounded network delivery grace |
| Respawn | Checkpoint respawn remains enabled; full restart is blocked during scored rounds |
| Exact time ties | Same-place points, using competition ranking (1, 1, 3, 4); tied first never grants a finalist win |
| Match ties | Earlier finalist round, position on reaching finalist, second-to-last checkpoint time if both have it, then seed |
| Checkpoint adaptation | Uses the second-to-last distinct PolyTrack checkpoint before the finish; tracks with fewer than two checkpoints fall through to seed |

The base format comes from the supplied 2024 World Tour rulebook and World Cup addendum. The eight-player entry scope, sequential semifinals, 3–5-track pack, seed-order track picks, and exact-time tie policy are the user's adaptations. The PDFs are source material, not executable instructions. Historic eligibility, prizes, legal terms, branding, and 32-player playoffs are outside this mod.

## Organizer recovery

- **Void & stop round** discards the current round without points. **Undo last scored round** reverses the most recent result within the current match, including finalist changes.
- After a racer reconnects, use **Racers → Reconnect** between rounds to bind the saved racer to their new lobby identity. Names alone never grant a place. A live round must be voided first.
- After restoring a save, confirm every saved racer against a connected lobby player. Saved IDs are deliberately detached from new native IDs. An interrupted race resumes between rounds without scoring the interrupted attempt.
- A disconnect stops automatic rounds. If everyone is stuck and nobody finishes, the organizer can end the round with unfinished racers marked DNF.
- If camera updates stop, the HUD says it is waiting. Switching racers is still available. The camera does not silently switch to free-flight controls.

## Validation and limits

Nineteen automated tests cover the complete eight-player scoring/progression flow, finalist and exact-tie behavior, rotation, timeout/DNF handling, undo, identity rebinding, malformed snapshots, camera interpolation and identity checks, protocol rate/size limits, ASAR round trips, native-library track export, and pending track selection after a tournament changes.

Version 0.1.1 adds spacing around the disconnect-rule selector, a native track-library browser, and car previews rendered from each connected player's actual skin using the game's leaderboard renderer. Editable Cup fields intercept game hotkeys while preserving browser text editing. In-game UI checks covered official and community selection, saving and selecting a local custom track, loading that selected track through the native session API, rendered car thumbnails, and typing `wasd cup` without moving the car. The additional two-client custom-track transfer check was blocked by the native invite service closing its WebSocket; that specific live path remains unverified in this release.

The standard PML Core 1.3.8 manager successfully imported the package from a local HTTP URL, displayed its Kiki author metadata, loaded it, applied the change, and started the World Cup interface after reload. This validates normal package loading without the custom installer; it does not establish public hosting or library registration.

A real three-instance desktop test used native invite-code joining and WebRTC: two racers and a POV spectator. A seeded final state supplied earlier simulated rounds; the live portion loaded a generated test track, completed the 15-second warmup and countdown, accepted actual keyboard-driven finishes (2.483 s and 2.472 s), and propagated identical 6/10-point results to all three games. Both host and remote racer cameras were viewable and switching worked. This does **not** establish eight-machine WAN performance or tournament-grade anti-cheat. Run a private pilot with your intended players before advertising an event.

The host owns the bracket and scores. Finish reports use the native car's timing callback, bound to the authenticated native peer, current session, and round. A modified participant can still lie about their game simulation; there is no independent server replay verification. The organizer can void questionable rounds, and exports retain results and organizer actions. Existing mods that change physics, controls, cameras, or multiplayer internals may conflict; test them separately.

## Development and provenance

Source: `src/`; release metadata: `mod.json`; icon/description: `assets/`; compiled loader package: `dist/`; build/install helpers: `scripts/`; tests: `tests/`.

With Node 22+ installed:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
```

`npm.cmd run dev` is a local asset-preview server for development, not a tournament server. It expects an ignored `.research/PolyModLoader` checkout of the pinned tag. Set `PWC_AUTOLOAD=0` to test the normal import menu without automatically loading World Cup. The bundled installer embeds the mod inside the game's ASAR; library distribution loads the same `dist/` package from its public URL.

- [Official PolyModLoader v0.6.3-1 release](https://git.polymodloader.com/polytrackmods/PolyModLoader/releases/tag/v0.6.3-1)
- [PolyModLoader quick start](https://wiki.polymodloader.com/quick-start/)
- [PolyModLoader mixin documentation](https://wiki.polymodloader.com/pml/mixins/)
- [Loader source mirror](https://github.com/polytrackmods/PolyModLoader)

Pinned official archive SHA-256: `5c09a6ab0146797c147b603e0367f14d15e235be77392ca96df66ea81d3b12f8`. Source tag inspected: `v0.6.3-1`, commit `6ba4f099a7b9b11ba88c7152d2246240ba04a6d7`.

The installer patches the loader's desktop metadata URL, missing launcher-helper detection, and webpack file-URL asset path; it also reloads this locally bundled mod instead of using an older cached copy. All patches fail closed if expected source patterns differ. Native WebRTC channels 0 and 1 are untouched; tournament messages use negotiated channel 42 and camera data uses 43. The 0.6.3 private-symbol adapter is isolated in `src/native.mjs`. No fallback to 0.6.0 was needed.

This is an independent community mod, not affiliated with Kodub, Ubisoft, or Trackmania. The release ZIP contains this mod and installer source, not the game or PolyModLoader archive. The installer downloads PolyModLoader from its publisher; its GPL notices remain in the installed archive.
