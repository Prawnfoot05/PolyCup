# PolyCup for PolyTrack 0.6.3

A simple live Cup for **2–8 racers**, hosted by the organizer’s game. By **Kiki**. Version **0.2.11**. Join, pick one track, race together, with controls integrated into the native game toolbar.

## PolyModLoader library distribution

The `dist/` folder is a standard PolyModLoader package: a root `manifest.json`, versioned JavaScript, version metadata, description, and icon. It can be hosted and installed through PolyModLoader's **Mods** menu without this project's desktop installer. Everyone in an event still needs PolyModLoader for PolyTrack 0.6.3 and the same PolyCup version.

**Library registration is pending moderator action.** The package is hosted in [Prawnfoot05/PolyCup](https://github.com/Prawnfoot05/PolyCup). Until registration, use **Mods → Add**, enter the following URL and version `0.2.11`, click **Import**, then select PolyCup and choose **Load → Apply**:

```text
https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist
```

After registration, players will find **PolyCup — Kiki** in **Mods → Mod Library → Open**. The [moderator handoff](library-submission/submission.txt) includes the exact import URL, registration payload, version payload, and file hashes. Registration and verification are separate moderator decisions; this repository does not claim either has happened.

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
3. Double-click `Install-PolyCup.cmd`. It downloads the pinned official **PolyModLoader v0.6.3-1**, verifies its SHA-256, and installs the bundled mod.
4. Launch `PolyTrack.exe`. Use the **PolyCup** button after the native in-game toolbar buttons, or press **F8**, to open the controls.

The installer uses the Node runtime already inside PolyTrack. No separate Node installation, tournament server, or account is required. Every participant and spectator installs the same mod version. Internet access and PolyTrack's existing multiplayer signaling/relay infrastructure are still required.

For another target location, run `Install-PolyCup.ps1 -GameDirectory "C:\path\to\PolyTrack"` in PowerShell. The batch launcher uses a process-only PowerShell execution-policy override; it does not change the machine policy.

The original game archive is preserved at `resources/app.asar.before-world-cup`, with hashes in `resources/world-cup-install.json`. The installer retains the PolyTrack application profile name so your ordinary settings and local tracks remain available. Double-click `Restore-Original.cmd` with the game closed to restore it. Backups are retained. If another tool has changed the installed archive, the restore script stops instead of overwriting it.

## Run a competition

### Test on one Windows computer

Double-click **Start-Test-Clients.cmd** to open two isolated, windowed clients first. To open all eight, run this from the mod folder:

```powershell
.\Start-Test-Clients.cmd -Count 8
```

To add six clients after starting the first two, use `Start-Test-Clients.cmd -StartFrom 3 -Count 6`. Each numbered client has its own persistent profile under `output/test-clients/profiles/`; launching an already-open number focuses that client. The helper makes a separate game copy under `output/test-clients/game/`, assigns each profile before the native single-instance check, and keeps your normal game/profile untouched. The first run downloads the pinned loader if it is not already cached. Close all test clients before rerunning the helper to rebuild them with a newer bundled mod.

Set distinct player names in the test clients. Host in client 1, share its native invite code with clients 2–8, and join as racers from each client; the host is one of the racers. Set low graphics settings and keep unused windows small. Eight live renderers can consume substantial memory/GPU resources; add them gradually. Double-click **Stop-Test-Clients.cmd** to stop only these test windows (profiles are retained).

This checks lobby and tournament behavior on one computer. It does not simulate eight independent Internet connections, and it does not provide bots to drive eight cars simultaneously. Native invite/signaling services must still be reachable.

### Organizer flow

1. Host a normal multiplayer room, set **Maximum Players to 16** for spectator space, and share the native invite code.
2. Click **PolyCup → Create Cup** in the native toolbar, or press **F8**. Each participating player clicks **Join as racer**. The organizer may race or remain a spectator.
3. Each racer chooses **one track** from their own Official, Community or Custom collection. Share codes remain an optional fallback. Custom picks are sent to the organizer automatically; other players do not need them installed. Picks can be changed until the start. Duplicate picks count once.
4. With any **2–8 racers** ready, click **Shuffle tracks & start Cup**. The track order is shuffled once and shared with everyone. There are no seeds, captains or semifinals.
5. Rounds advance automatically after five seconds. The organizer can switch this off, void a round, give unfinished racers DNF, undo results, or reconnect a racer through **Racers**.
6. The first finalist to win an outright round wins the Cup. A winner presentation leads into final standings. Save a results PNG, race again with fresh scores and a reshuffled pack, or choose new tracks with the same racers.

Disconnects default to **DNF**, with organizer void available. A disconnect stops automatic rounds so the organizer can reconnect the racer. A disconnect before racing voids that round. The alternative void-on-disconnect policy is under **Organizer settings**.

The native 16-person capacity includes racers, organizer and spectators. This mod does not remove that limit or provide host migration. The organizer stays connected. Autosave is local; eight large custom tracks may exceed browser storage, in which case use **Export tournament**.

Creating Cup mode opens the centered PolyCup menu for everyone already connected. Opening or hiding your own panel stays local. Menus close automatically for track loading, warmup and race starts; F8 can reopen them.

**Hide** dismisses only your panel. The organizer's **End Cup for everyone** asks for confirmation, returns everyone to normal multiplayer and shows a brief ended notice. Empty-state updates continue so clients can recover if they miss the first end message; older updates cannot revive an ended Cup. The last successful autosave remains available under **Restore autosave**.

The **Lobby code** and **Copy** button remain available in the PolyCup header. Expired codes offer **Renew**; failed creation offers **Retry**. The code and invite permissions come from the native game.

Press **G** to hide or show the other racers' ghosts locally. Rebind primary and secondary keys in **Settings → Controls → PolyCup → Toggle other players' ghosts**, then **Apply**. **H** still controls the native UI. The **Racers** tab also has a Hide/Show button displaying the current shortcut, and a brief hint appears when you first enter a race in each Cup. Your own car, or the racer you are spectating, stays visible. Visibility stays selected across rounds without changing other players' views or scoring; leaving Cup mode restores normal visibility.

### Rules

| Rule | Simple Cup |
|---|---|
| Racers | 2–8, all in one Cup |
| Points target | 140 |
| Finish points | 10 / 8 / 6 / 5 / 4 / 3 / 2 / 1; DNF = 0 |
| Finalist | Reach 140, then win a **later** round outright |
| Cup end | First finalist win; remaining standings use accumulated points and finalist tie breaks |
| Tracks | One choice per racer, duplicates merged, shuffled order |
| Rotation | Approximately four minutes of WR driving time per track: round(240 seconds / WR seconds), minimum one round; repeat the order |
| Missing WR | Four rounds when the native leaderboard has no valid record or does not respond within five seconds |
| Schedule | Host fetches WRs and freezes all round counts at Cup start; new WRs do not change a running Cup |
| Practice | First visit only: 1.5× WR, minimum 30 seconds; 90 seconds without a WR. Everyone Ready ends it early. |
| Finish window | Ten seconds after the first finish, with bounded network delivery grace |
| Exact time ties | Equal place points, e.g. 1, 1, 3; a tied first cannot win the Cup |
| Standings ties | Earlier finalist round, then finishing position and available second-to-last checkpoint time; otherwise stable join order for display |
| Restart | Checkpoint respawn allowed; full-restart key retires the racer (DNF) during a live round; normal restarts in practice |

Final standings with unresolved equal scores retain join order for display; that order never awards a finalist win. The organizer cannot add late entrants after the Cup starts. The Trackmania rulebooks inspired finalist scoring; this simplified format follows the organizer’s chosen PolyTrack adaptations and no longer reproduces the 2024 bracket.

## Race HUD and records

All panel text uses PolyTrack’s bundled italic ForcedSquare font, native kerning and letter spacing, with the same Arial/sans-serif fallback. Panels, tabs, fields and buttons use the native slanted geometry and navy palette; hover and disabled text stay readable. Visible branding is PolyCup; the stable loader ID and old installer shortcuts remain compatible.

Redundant setup instructions and leaderboard footers are removed. WR/TR/PB times use 24 px normal-weight text; race gaps use 20 px, and small labels use at least 18 px. Rules remain available in a collapsed section.

The panel starts closed on game launch and opens when the organizer creates a Cup. A centered **3 → 2 → 1 → GO** signal uses the shared start timestamp for each round; it clears 0.6 seconds after the start and never captures driving input.

The PolyCup launcher uses the supplied trophy SVG and sits after the existing in-game toolbar buttons and follows native scaling and auto-hide. Outside the game, a fallback launcher remains available; F8 works in either location. The 420-pixel leaderboard docks to the left edge as separate track, record, ranking and racer strips, each with a short slanted end. Transparent gaps replace the shared outer enclosure. The ranking heading is bold and centered, with a larger gap after the records. It reserves space while the top toolbar is visible, then slides into the top-left corner after its fade-out. It clears space immediately when the toolbar returns and follows track changes, wrapping and bottom-docked layouts. It highlights the leader, shows actual credited **+points** in green, green/red position changes at checkpoints and after scoring, **F** for finalists and a separate Cup winner strip. During racing, finished racers appear first; point gains are subdued while **provisional**. Unfinished racers rank by furthest checkpoint, then fastest cumulative lap time at that checkpoint; DNFs go last. The leader shows elapsed time from the start, and following racers show positive gaps against the fastest recorded time at their own checkpoint. Checkpoint times are cumulative, never segment times, and earlier readings are not compared against later checkpoints. Delayed faster reports correct the order and gaps. Position is updated at checkpoint passes, not continuously between checkpoints. Finish gaps use the fastest recorded finish; hover a time cell for its checkpoint or exact finish time. Checkpoint progress never awards points.

- **WR:** current overall leaderboard record. Official and community tracks use PolyTrack’s verified leaderboard; custom tracks use their public leaderboard. Queried through the game’s own API, cached for two minutes, and shown as unavailable if the service cannot answer.
- **TR:** fastest scored run on the current track across this Cup. Warmups are excluded. Voiding or undoing a round removes its contribution. A current-round best is provisional until that round is scored.
- **PB:** the watched racer’s overall best, including runs outside this Cup. Their mod combines their active profile’s saved record with their own online leaderboard record and shares the faster time. The strip identifies the profile/online source. Account tokens are not sent to the organizer or other players. PB reports are informational, reported by each player, and do not influence scoring.

Record strips distinguish loading, no record and service unavailable. PB identity comes from the native peer, never a nickname search. Local PB changes refresh every five seconds; online PB queries are cached for one minute. A leaderboard service failure can still leave a saved profile PB available.

## Spectating

Spectators follow a competitor’s actual driving-camera pose, including cockpit/chase switches. Use **[ / ]**, the buttons, or the racer selector to switch. The 44-pixel spectator dock sits flush at the bottom center: a white inset trapezoid holds only the racer selector, with square arrow-only previous/next buttons on either side. Bracket shortcuts remain in the button tooltips. Overall PB sits in a short bottom-right card; on narrow windows it rises just above the dock to avoid overlap. Camera and watched-car transforms travel together at up to 20 Hz with a **250 ms viewing buffer**, and both are applied before the frame is drawn. Interpolation preserves the driver’s camera-to-car distance and zoom through fast turns and loops; native physics, controls and scoring are unchanged. Network gaps can still cause pauses and low frame rates affect smoothness. Other cars retain native interpolation.

This renders the race in the spectator’s own game; it is not screen capture or a copy of the driver’s UI. No screen, microphone or webcam capture is used. All participants and spectators must update to **0.2.11** together.

Version 0.2.0 uses a new save format. Old PolyCup autosaves are preserved separately and old JSON exports remain readable, but their bracket cannot be resumed as a Simple Cup. Older published builds remain in `dist/` for deliberate rollback.

New Cups use the 140-point target and WR-based schedule. Restoring an already-started 0.2.0–0.2.7 Cup preserves its 100-point target and four rounds per track. The four-minute estimate excludes loading, warmups and the finish window; actual driving is usually slower than the WR. Short tracks offer more scoring rounds per visit. A 25-second WR gives 10 rounds, 30 seconds gives 8, and one minute gives 4. The Cup can end partway through a visit when a finalist wins.

Finished or retired racers automatically watch the remaining racers, returning to their own camera before the next round. Disable **Settings → PolyCup → Spectate after finishing** to stay with your car; **Watch remaining racers** remains available manually. Practice has a **Ready** button, and every racer must be Ready to shorten it. Later playlist visits skip practice. Already-started older saves retain their original warmups.

**Race again** keeps connected racers and their track picks, fetches current WRs, reshuffles the pack and resets scores, finalist status and TRs. **Choose new tracks** retains the roster but clears picks. Save the results before starting another Cup: autosave follows the current Cup. The PNG contains names, car previews and final points, with no lobby code or profile identifiers.

## Organizer recovery

- **Void & stop round** discards the current round without points. **Undo last scored round** reverses the most recent result within the current match, including finalist changes.
- After a racer reconnects, use **Racers → Reconnect** between rounds to bind the saved racer to their new lobby identity. Names alone never grant a place. A live round must be voided first.
- After restoring a save, confirm every saved racer against a connected lobby player. Saved IDs are deliberately detached from new native IDs. An interrupted race resumes between rounds without scoring the interrupted attempt.
- A disconnect stops automatic rounds. If everyone is stuck and nobody finishes, the organizer can end the round with unfinished racers marked DNF.
- If camera updates stop, the HUD says it is waiting. Switching racers is still available. The camera does not silently switch to free-flight controls.

## Validation and limits

Seventy automated tests cover completion with every racer count from 2 through 8, ties/finalists, all eight point places, track rotation, disconnects, void/undo, saved identity rebinding, packet validation, and existing buffered POV behavior. A paired-controller test sends a multi-chunk custom track from a remote racer, with server-side checks for stale Cup IDs, spectator uploads, limits, ordering and incomplete transfers. Record tests cover PB identity binding, stale asynchronous responses, and TR persistence despite compact network history.

The 0.2.11 checks cover native full-restart DNF, rebound key slots, checkpoint-reset priority, typing/menu/practice guards, host-confirmed retirement, cumulative checkpoint timing, same-checkpoint gaps, delayed updates, progress ordering, movement arrows, packet identity/round binding, bounded snapshots, finish scoring and round cleanup. A native-game fixture verifies T and Backspace retire with automatic POV, R/Enter do not retire, practice retains full restart, and real native checkpoint callbacks update cumulative times and position arrows. These are controlled local checks, not a new multi-computer race.

The 0.2.10 checks cover reversible native UI suppression, automatic/manual finish and retirement POV, next-round restoration and ending Cup mode during a native session transition. A native-game browser fixture triggers the real car finish callbacks and session-end UI: finish banners, retry hints and personal driving readouts disappear while watching; the Players panel remains accessible; driving readouts return next round; Session Results and its backdrop stay hidden during Cup transitions and return after leaving Cup mode. These are controlled local regression checks, not a new multi-computer race.

The 0.2.9 checks cover fresh rematches, retained rosters, first-visit practice timing, authenticated Ready votes, countdown transitions, finished-racer camera permissions, automatic/manual spectating, camera release and final standings. Native browser checks use controlled racers to exercise Ready, finish POV, winner presentation, PNG download and rematch loading.

The 0.2.8 checks cover the 140-point target, WR-based round schedules, wraparound, void/undo, saved schedules and legacy Cups, missing/failed/timed-out records, cancelled preparation and changed picks. A native-game browser check with a controlled 25-second WR verifies preparation feedback, automatic panel closure and readable ROUND 1/10 and 10/10 counters. This is not a fresh multi-computer race validation.

The 0.2.7 visual pass checks the 44-pixel name-only dock, white inset, square arrow-only controls and separate 34-pixel PB card. Native browser checks cover next-racer/PB synchronization, direct selection, bracket shortcuts, long names, missing/unavailable PBs and compact-screen separation. The spectator overlays hide while the Cup panel is open.

The 0.2.6 visual pass checks the centered bold ranking heading, 26-pixel record separation, eight-racer driving layout, and centered spectator dock at desktop and compact widths. Native browser checks cover clicking next, bracket shortcuts, Enter activation, direct racer selection, long names, available/missing/unavailable PBs, and disabled controls while waiting for racers. The displayed records and roster in these layout checks are controlled fixtures.

The 0.2.5 visual pass checks the separate left-docked strips, inset time cells, eight-racer layouts, toolbar show/hide movement and trophy icon at desktop and compact widths.

The 0.2.4 regression checks verify visibility and buffered transforms at the renderer draw boundary. Native browser checks used two real remote-car models, toggled G to hide and restore bodies and nameplates, and followed more than 6,600 looping frames with a constant six-unit camera distance and unchanged native car state, including target switching. Additional checks cover normalized native rotations, the synchronized 3–2–1–GO sequence and closed startup panels. The loop trajectory was controlled test data, not a new multi-computer network test. Earlier post-update checks did not catch the draw-order bug.

The 0.2.3 lifecycle tests cover one host and two clients, missed end messages, recovery through periodic state and handshake replies, stale-message rejection, personal panel independence, automatic start transitions and camera/audio restoration. Visual checks cover centered panels at desktop and compact widths, minute-based lap/record times, subdued provisional gains and inset time cells. Native browser checks verify Cup creation, ending back to the normal UI and restoring the autosave.

Browser acceptance uses the real PolyTrack 0.6.3/PML renderer and native track library; controlled eight-racer fixtures verify HUD layouts and recorded/provisional states. The 0.2.1 visual checks cover native toolbar attachment, keyboard opening, replacement after track changes, automatic HUD positioning, narrow layouts, native typography and readable hover/disabled controls. The 0.2.2 checks cover invite copy feedback, expiry/renewal, failure/retry, permissions, compact header layout, larger HUD text and removal of redundant subtext. The native Settings screen was used to rebind the ghost control and verify persistence after reload. Ghost visibility tests exercise the adapter, driver/spectator switching, replacement cars and restoration on exit. The brief shortcut hint is checked in a controlled race fixture. These fixtures do not establish an eight-computer Internet race. A prior three-instance desktop race verified native invite joining, two keyboard-driven finishes, scoring propagation and switchable POV. The 0.1.2 native-renderer test covered 1,643 simulated delayed/jittered frames without camera rewinds or model-position error. Those earlier checks are bounded evidence, not a full live acceptance of the new 0.2.0 flow.

Live leaderboard requests and the invite service failed in the browser test environment. The fallback states were verified; successful live WR/online-PB fetching remains unverified here. Adapter tests verify profile/online PB selection and the WR response path with controlled service responses.

The organizer trusts native-client finish reports; there is no independent replay anti-cheat. Mods that change physics, controls, cameras or multiplayer internals may conflict. Library registration remains pending the moderators.

## Development and provenance

Source: `src/`; release metadata: `mod.json`; icon/description: `assets/`; compiled loader package: `dist/`; build/install helpers: `scripts/`; tests: `tests/`.

With Node 22+ installed:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
```

`npm.cmd run dev` is a local asset-preview server for development, not a tournament server. It expects an ignored `.research/PolyModLoader` checkout of the pinned tag. Set `PWC_AUTOLOAD=0` to test the normal import menu without automatically loading PolyCup. The bundled installer embeds the mod inside the game's ASAR; library distribution loads the same `dist/` package from its public URL.

- [Official PolyModLoader v0.6.3-1 release](https://git.polymodloader.com/polytrackmods/PolyModLoader/releases/tag/v0.6.3-1)
- [PolyModLoader quick start](https://wiki.polymodloader.com/quick-start/)
- [PolyModLoader mixin documentation](https://wiki.polymodloader.com/pml/mixins/)
- [Loader source mirror](https://github.com/polytrackmods/PolyModLoader)

Pinned official archive SHA-256: `5c09a6ab0146797c147b603e0367f14d15e235be77392ca96df66ea81d3b12f8`. Source tag inspected: `v0.6.3-1`, commit `6ba4f099a7b9b11ba88c7152d2246240ba04a6d7`.

The installer patches the loader's desktop metadata URL, missing launcher-helper detection, and webpack file-URL asset path; it also reloads this locally bundled mod instead of using an older cached copy. All patches fail closed if expected source patterns differ. Native WebRTC channels 0 and 1 are untouched; tournament messages use negotiated channel 42 and camera data uses 43. The 0.6.3 private-symbol adapter is isolated in `src/native.mjs`. No fallback to 0.6.0 was needed.

The trophy emblem reuses the original P path, fill and stroke from PolyTrack 0.6.3 `images/icon.svg`, scaled into the cup.

This is an independent community mod, not affiliated with Kodub, Ubisoft, or Trackmania. The release ZIP contains this mod and installer source, not the game or PolyModLoader archive. The installer downloads PolyModLoader from its publisher; its GPL notices remain in the installed archive.

Toolbar trophy: the user-supplied `iconmonstr-trophy-13.svg`, preserved in `assets/toolbar-trophy.svg`. The bundle embeds the original vector; CSS renders it white at the native toolbar icon size.
