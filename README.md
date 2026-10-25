# PolyCup

Custom and ranked Cups for **PolyTrack 0.6.3**, by **Kiki**. Version **0.4.0**.

## Install

Install [PolyModLoader](https://wiki.polymodloader.com/quick-start/) for PolyTrack 0.6.3. Find PolyCup in the **Mod Library**, or import this URL through **Mods > Add**, then choose **Load > Apply**:

```text
https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist
```

All participants need the same PolyCup version. Enter **0.4.0** explicitly if the CDN still selects an older cached version. Restart the game after updating.

For the bundled Windows installer, place this project folder beside PolyTrack.exe, close the game and run **Install-PolyCup.cmd**. **Restore-Original.cmd** restores the original installation; run it before switching from the bundled installer to a normal PML installation. Installation preserves the game's existing profile and backs up its original application archive.

## Start from the main menu

Open **PolyCup** on the game's main menu. You can host a custom Cup, browse public Cups, join using a room code, or sign in with Discord to use friends and ranked matchmaking. Custom Cups support **2–8 racers** and do not require a Discord account.

Name your Cup and choose **Host Cup**, then select public or private before creating it. Private is the default. Share its room code or invite accepted friends from the lobby's **Friends** button. Public Cups also appear in the browser. Your garage name, flag and car remain your identity during the Cup; account profiles appear in social menus, leaderboards and match history.

Choose a preset and edit its rules before starting the draft. Bans happen before picks. Each racer locks their picks with **Ready up**; the host starts the Cup when everyone is ready. Rounds then advance automatically. The **Rules** button keeps the locked rules accessible during play.

Custom presets can change scoring, finalist target, bans and picks, rounds per track, random rotation, warmups, timing, spectator camera and mid-Cup racer changes. Custom tracks require zero bans. Save, rename, import or export presets using the controls beside the preset name. **Leaderboard uploads** is off by default; enabling it uses the native game's Casual mode and its usual account and track eligibility rules.

## Ranked

Sign in, then choose **Find ranked**. Matchmaking aims for four racers and can form smaller Cups after a longer wait. A **Match found** popup lets everyone accept or decline before entering the lobby. Invitations, roster changes and custom rule editing are unavailable in ranked Cups.

| Ranked rules | Value |
| --- | --- |
| Racers | Target 4; 3 or 2 after a longer wait |
| Track pool | All bundled main and community tracks |
| Draft | 2 bans and 2 picks per racer |
| Rounds per track | 3 |
| Finalist target | 140 points, then win a subsequent round outright |
| Provisional period | 5 completed rated matches |

Ratings use an opponent-aware Bradley–Terry Full model. The ranked panel shows your badge, matches and win rate; **?** shows tier thresholds. **Leaderboards** includes global and friends standings. Grandmaster is reserved for the top ten qualifying Master players. Ratings persist without seasonal resets or decay.

When a Cup settles, the result shows your rating change. If you close the game first, the result is delivered after reopening it. Match histories are publicly readable, including results and any **Possible copied inputs detected** flags. These flags compare submitted inputs with reference replays; they do not automatically impose penalties or prove how a player produced a run.

Leaving a ranked Cup opens a reconnect-or-abandon prompt. Racers have a **two-minute reconnect grace period** while the host's race remains available. If the host closes the race, that race cannot be restored; the backend checks the result and any abandonment instead. Explicitly abandoning, or failing to return within the grace period, counts as an abandonment loss. Leaving is not a way to cancel an unfavorable result. Ranked uses a participating player as its race host, so host connection quality still matters; there is no dedicated race server.

## Friends and sign-in

Discord sign-in opens a browser and returns to the game automatically when the launcher supports it. PolyLauncher opens your external browser and uses the return code shown after sign-in; paste it into the visible form in the game. A copyable sign-in link remains available if opening the browser is blocked. Sessions persist until you sign out; signing out affects this instance. Multiple sign-ins are allowed, but one account cannot participate in two Cups at once.

Add friends using their player code. The chevron beside a friend opens their actions, including match history and joining an available public Cup. Private Cups use invitations. The friends panel is also available from custom Cup lobbies.

## Racing and controls

- Default place points are **10 / 8 / 6 / 5 / 4 / 3 / 2 / 1**; DNF earns zero. Exact ties share place points. A finalist must finish first outright to win.
- Drafted playlists repeat after the selected number of rounds per track. Warmup readiness can end practice early.
- **G** toggles other players' ghosts; **Y** opens Cup chat. Rebind these under Settings → Controls → PolyCup.
- **[ / ]** switch spectator targets. The native free-camera key works when allowed by the rules. Automatic spectating after finishing can be disabled in settings.
- Your **full restart** key means DNF during a live round. **Checkpoint reset** returns you to the start before the first checkpoint while keeping elapsed Cup time; later it uses normal checkpoint respawn.
- Chat is shared by racers and spectators. Enter sends and Escape leaves the message box. Chat previews can be hidden. Common slurs and explicit hate phrases are filtered; ordinary profanity is allowed.

Keep the host connected for normal custom Cup play. Rejoining with the same identity recovers your racer slot where the Cup's rules allow it. When mid-Cup racer changes are enabled, new racers enter at zero points and returning racers keep their score.

## Development

Requires Node.js 22+.

```sh
npm ci
npm test
npm run typecheck
npm run build:release
```

Edit TypeScript in **src/**, metadata in **mod.json** and **package.json**, the protocol version in **src/cup.ts**, and artwork in **assets/**. **build:release** stages a candidate in **output/release-candidate/dist/** without changing the advertised stable version. **npm run build** writes stable versions to **dist/**; prereleases go to **output/dev-mod/**. Never modify a published version folder.

Set **PWC_MOD_ROOT** to a staged distribution when preparing installer test clients. **Start-Test-Clients.cmd -Count 2** starts isolated clients (up to eight); **Stop-Test-Clients.cmd** closes them. Test profiles, credentials, output, downloaded replay corpora and generated backend reference bundles must not enter a public release.

Backend setup and operations are documented under **supabase/**. Publishing the mod and changing the ranked queue's exact client-version gate are coordinated release steps; building a candidate does neither.

Independent community mod. PolyTrack artwork belongs to Kodub; toolbar trophy: iconmonstr-trophy-13. The installer downloads PolyModLoader separately and preserves its license notices.
