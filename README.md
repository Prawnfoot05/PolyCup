# PolyCup

Live Cups for **2 to 8 racers** in PolyTrack **0.6.3**. By **Kiki**.

## Install

Install [PolyModLoader](https://wiki.polymodloader.com/quick-start/) for PolyTrack 0.6.3. Install PolyCup from the **Mod Library**, or import this URL through **Mods > Add** with the latest version, then choose **Load > Apply**:

```text
https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist
```

All players and spectators need the same PolyCup version. Leaving the version empty uses the CDN's cached latest manifest, which may lag behind a release. Enter **0.3.1** explicitly if an older release is selected.

For the bundled Windows installer, place this project folder beside PolyTrack.exe, close the game and run **Install-PolyCup.cmd**. **Restore-Original.cmd** restores the original installation; run it before switching from the bundled installer to a normal PML installation.

## Play

1. Host a multiplayer lobby and open **PolyCup** from the toolbar or **F8**.
2. Create a Cup, share the lobby code, and join as racers.
3. Choose **Standard**, **Quickplay**, or a saved preset in the lobby. Edit the rules directly below the preset selector; valid changes apply automatically.
4. Standard runs bans, then picks in the same panel. Quickplay starts directly on a random map.
5. **Start Cup**. Rounds advance automatically until someone wins.

| Preset | Rounds per map | Target | Finalist | Tracks | Warmup | Mid-Cup racer changes |
| --- | --- | --- | --- | --- | --- | --- |
| Standard | 4 | 140 | On | 1 ban + 1 pick each | First visit | Off |
| Quickplay | 3 | 100 | Off | Random map every three rounds | Off | On |

Both use main and community tracks. **Allow custom tracks** adds saved custom tracks and, during drafting, share-code entry. Presets also control points per place, bans/picks, warmup timing, the finish window and round breaks. Custom tracks are available only when bans per racer is zero; enabling bans turns custom tracks off. Rules lock when drafting starts; **Reopen setup** clears bans and picks.

**Upload leaderboard times** enables the game’s Casual mode for Cup rounds and warmups. Leave it unchecked for Competitive mode with session-only times (the default). Native account and track eligibility rules still apply.

Editing a rule changes the preset name to **Custom**. Use the pencil button to name it, then the save icon to keep it. The adjacent import/export icons share rules only.

The organizer must stay connected. Native room capacity includes spectators. **Hide** closes your panel; **End Cup** ends Cup mode for the whole lobby.

Rejoining the lobby with the same PolyTrack profile automatically recovers your racer slot and points at the next round boundary, subject to available racer slots. When **Allow mid-Cup racer changes** is enabled, spectators can join the next round at zero points and racers can leave without rehosting; returning racers keep their score. Profile ownership is checked with a Cup-specific signature; account tokens stay local. Disconnected racers sit out after a short grace period without blocking the Cup. Restored autosaves still require the organizer to identify their saved racers.

## Rules and controls

- With **Finalist** enabled, reach the preset’s target, then win a later round outright. Without it, the highest score at or above the target wins; a tied lead continues.
- Default points are **10 / 8 / 6 / 5 / 4 / 3 / 2 / 1**; DNF awards zero. Exact finish ties share place points. A finalist must finish first outright to win.
- Rounds per track are fixed by the preset. Drafted playlists repeat; random rotation chooses another map after each block.
- Standard first-visit practice lasts **1.5× WR, minimum 30 seconds** (90 seconds without a WR). Everyone choosing Ready ends practice early.
- **G** toggles other players’ ghosts; rebind it in Settings → Controls → PolyCup.
- **[ / ]** switch spectator targets. The native free-camera key is available to spectators when the preset allows it; an eye counter shows how many spectators are following you. Automatic spectating after finishing can be disabled in settings.
- Your **full restart** key means DNF during a live round. **Checkpoint reset** returns you to the start before the first checkpoint, keeping your elapsed Cup time; after that it uses the normal checkpoint respawn.

Host round controls and run review are in the main Cup panel. Use the arrow beside a player in the lobby or scoreboard to manage their racer slot or kick them. Restore the local autosave from the Cup start screen. Removing a track excludes it for the rest of the Cup and rolls back only the current visit; earlier visits keep their scores. If no drafted track remains, a replacement is drawn from the preset’s pool. Private review flags and physics-binary mismatch warnings use client-reported data and are not proof of cheating. Physics warnings are visible only to the host and do not block racing.

## Development

Requires Node.js 22+.

```sh
npm ci
npm test
npm run format:check
npm run build
```

Edit TypeScript in **src/**, release metadata in **mod.json**, and artwork/description in **assets/**. The build type-checks and bundles **dist/** for PML; do not edit generated JavaScript. Published version folders are immutable; put each release in a new version folder. Development scripts and tests use JavaScript.

For local multiplayer testing, run **Start-Test-Clients.cmd -Count 2** (up to 8) and **Stop-Test-Clients.cmd** to close them.

Independent community mod. PolyTrack artwork belongs to Kodub; toolbar trophy: iconmonstr-trophy-13. The installer downloads PolyModLoader separately and preserves its license notices.

### Chat

During setup, chat sits below the player list. During a Cup, use **Chat** in the panel header, or press **Y** (rebindable in PolyCup controls). Enter sends; Escape leaves the message box. Racers and spectators share one chat. The full filtered history stays with the Cup and is included in the organizer's local autosave. Older messages remain scrollable; previews can be hidden.

Common slurs and explicit hate phrases are masked with asterisks; ordinary profanity is allowed. The organizer can click a name in chat to mute or unmute that participant. Mutes follow verified profiles when they reconnect.
