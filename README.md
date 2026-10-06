# PolyCup

Live Cups for **2–8 racers** in PolyTrack **0.6.3**. By **Kiki**.

## Install

Install [PolyModLoader](https://wiki.polymodloader.com/quick-start/) for PolyTrack 0.6.3. In **Mods → Add**, import this URL with version **0.2.18**, then choose **Load → Apply**:

```text
https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist
```

All players and spectators need the same PolyCup version.

For the bundled Windows installer, place this project folder beside PolyTrack.exe, close the game and run **Install-PolyCup.cmd**. **Restore-Original.cmd** restores the original installation; run it before switching from the bundled installer to a normal PML installation.

## Play

1. Host a multiplayer lobby and open **PolyCup** from the toolbar or **F8**.
2. Create a Cup, share the lobby code, and join as racers.
3. **Begin bans**: each racer bans one main/community track in a shuffled turn order.
4. Each racer picks one remaining main, community or custom track. Duplicate picks count once; the playlist is shuffled.
5. **Start Cup**. Practice and rounds advance automatically; the playlist repeats until someone wins.

The organizer must stay connected. Native room capacity includes spectators. **Hide** closes your panel; **End Cup for everyone** ends Cup mode for the whole lobby.

Rejoin the lobby with the same PolyTrack profile and choose **Rejoin Cup** to recover your racer slot. Profile ownership is checked with a Cup-specific signature; account tokens stay local. Recovery waits for the current round to end. The organizer restarts paused rounds; manual reconnect remains available for changed profiles or imported saves.

## Rules and controls

- Reach **140 points**, then win a later round outright to win the Cup.
- Places award **10 / 8 / 6 / 5 / 4 / 3 / 2 / 1** points; DNF awards zero. Exact ties share place points and cannot produce a Cup winner.
- Tracks run for roughly **four minutes of WR driving time**; missing WRs use four rounds.
- First-visit practice lasts **1.5× WR, minimum 30 seconds** (90 seconds without a WR). Everyone choosing Ready ends practice early.
- **G** toggles other players’ ghosts; rebind it in Settings → Controls → PolyCup.
- **[ / ]** switch spectator targets. Automatic spectating after finishing can be disabled in settings.
- Your **full restart** key means DNF during a live round. Checkpoint reset remains available.

Organizer controls include round recovery, autosave restoration, and Cup import/export. Exports contain Cup state and results, not game replays. Private review flags use client-reported data and are not proof of cheating.

## Development

Requires Node.js 22+.

```sh
npm ci
npm test
npm run format:check
npm run build
```

Edit TypeScript in **src/**, release metadata in **mod.json**, and artwork/description in **assets/**. The build type-checks and bundles **dist/** for PML; do not edit generated JavaScript. Development scripts and tests use JavaScript.

For local multiplayer testing, run **Start-Test-Clients.cmd -Count 2** (up to 8) and **Stop-Test-Clients.cmd** to close them.

Independent community mod. PolyTrack artwork belongs to Kodub; toolbar trophy: iconmonstr-trophy-13. The installer downloads PolyModLoader separately and preserves its license notices.
