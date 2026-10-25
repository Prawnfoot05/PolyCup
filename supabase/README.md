# PolyCup 0.4 backend

The backend provides accounts, friendships, Cup discovery and membership, ranked matchmaking, rating settlement, public history and background input review. Racing remains peer-hosted. The result and input-review Edge Functions run on conditional schedules; see the operation documents in this folder.

The client release is 0.4.0. Prepare it with `npm run build:release`; coordinate the exact `polycup_queue_config.version` gate with publication. Staging a bundle does not update that gate or deploy functions. Never publish test profiles, credentials or generated replay-reference corpora.

## Connection and sign-in

`client-config.json` contains a public project URL and publishable key, intended for
client applications. It grants no administrative access. Never place a service-role
key, secret API key, database password, or Discord client secret here or in the mod.

The project's Auth settings were checked on 2026-10-21: Discord and sign-ups were
enabled. The user subsequently confirmed a complete Discord login in Chrome. Its callback in the Discord
developer portal should match the callback displayed by Supabase's Discord provider
settings: `https://wqaipijoqqqrwyivajjg.supabase.co/auth/v1/callback`.

The login return page is live at `https://prawnfoot05.github.io/PolyCup/auth/`.
The user confirmed on 2026-10-21 that this is both the Supabase Site URL and an
allowed Redirect URL. Keep the Discord Developer Portal callback set to the
Supabase callback above, not the GitHub Pages URL.

The return page is published from the separate `gh-pages` branch (root directory).
Only `account-site/` contents belong there. The page has no Supabase credentials,
analytics, external scripts, or token exchange. It strips the callback query from
browser history and returns a one-use code to the initiating game window. A strict
origin/source check and per-attempt ID bind automatic return to the pending login.
The game exchanges the code using the SDK's S256 PKCE verifier, retained in that tab.

The bundled desktop adapter supports automatic return through a per-attempt local callback. Browser builds use their opener where available. If the launcher blocks automatic return, the sign-in panel offers a manual return-code fallback. Never navigate the game window away for OAuth.

The SDK stores the Supabase session in namespaced local storage and refreshes it.
PKCE verifiers and pending attempts use tab session storage. Discord provider tokens
are stripped before persistence. Browser PML and PolyLauncher have separate sessions.
Same-origin scripts/mods can read browser storage: HttpOnly cookies would require a
different server-mediated architecture. Sign-out is local to this client.

Discord name, username and avatar are shown in the account panel. Display-only
metadata never establishes permissions or grants tags/ranks. Avatar URLs are limited
to Discord CDN hosts and a failed image falls back to an initial. Rich Presence is
not part of OAuth login; it needs a supported Discord SDK/RPC integration, which
the existing launcher preload does not expose.

## Development builds and verification

Use `npm run build:release` to stage 0.4.0 without changing stable artifacts. Sign-in and profile actions live in the social sidebar of the main PolyCup menu. Sessions restore on startup; custom Cup play remains available without sign-in. Runtime public configuration in `src/account-config.ts` must agree with `client-config.json`.

`tests/account-flow.test.mjs` covers return-code binding, expiry, pending-flow restore,
token filtering, per-tab verifiers, and Discord metadata restrictions. Local browser
checks additionally used the real SDK against intercepted test endpoints to exercise
PKCE exchange, session reload, sign-out, stale-code rejection, and blocked popups.
These automated tests create no real Supabase accounts or leaderboard runs. The
user subsequently confirmed a real Discord login in Chrome and supplied a screenshot
showing the loaded PolyCup profile and unranked record. Native automatic return and the fallback are covered separately by desktop adapter tests. After that screenshot,
the adapter was corrected to read `custom_claims.global_name` and preserve full
Discord avatar URLs; the user subsequently confirmed the corrected avatar and display name visually.

Player-tag derivation and its match-validation dependency are described in
`PLAYER_TAGS.md`. No fabricated tags are displayed on real players.

## Step 1: in-game account integration

The Account dialog now edits the signed-in player's `profiles.display_name`, using
the existing self-update RLS policy and a request filtered to the account UUID.
Names are trimmed and limited to 32 Unicode code points, preserving styled names;
empty/invisible-only names and control characters are rejected before submission.
Only a successful server response updates the displayed name. Failed requests retain
the draft, and session-refresh events preserve draft text, focus, and selection.

The garage/profile naming decision is still open. Race and lobby names continue to
come from garage profiles. The editable PolyCup name appears in Account and friends lists. No
account edit changes an active Cup, garage save, or Discord identity.

Account is accessible in the actual game through F8, even before joining multiplayer.
Opening the modal clears held driving input; modal keyboard handling stops game
hotkeys, and F8 closes Account before closing the lobby underneath it.

For a local test build, run `npm run build`, then serve with `PWC_DEV_BUILD=1` and
`PWC_PORT=8796` using `node scripts/serve.mjs`. The manual mod source is
`http://127.0.0.1:8796/mod`. Load only one PolyCup version at a time. The published
0.3.3 distribution is not replaced.

Browser checks in `tests/browser/account-game.check.js` run through the actual local
PML game UI using Playwright CLI `run-code --filename=...`. The static callback test
server from `.research/account-preview-server.mjs` must also be available on port
8794. They intercept Supabase calls, allow only local assets and read-only loader
CDN requests, and block game WebSockets/leaderboard traffic. The checks cover name
editing, failed saves, Unicode validation, token-refresh focus preservation, modal
keys, session reload, sign-out, and manual OAuth return. The separate
`account-restore.check.js` checks expired and revoked saved sessions in fresh browser
contexts. This is controlled integration evidence, not a live multiplayer match.

The installed launcher was identified as PolyLauncher 0.2.1. Automatic approval
review rejected launching it with an isolated WebView profile/debugging (the only
reason returned was `blocked by policy`). No alternate automated launcher attempt
was made. The user reported a launcher black screen with PML profiles and explicitly deferred
launcher testing. Native launcher acceptance remains pending:
sign in, edit the PolyCup name, fully restart the launcher, verify restoration and
the saved name, then verify sign-out. Do not describe native launcher support as
fully accepted until that check completes.

## Apply the foundation

1. Open this project in Supabase and open **SQL Editor > New query**.
2. Paste the complete contents of
   `migrations/20261021000000_account_friends_foundation.sql` and run it once.
3. Confirm `profiles`, `player_ratings`, and `friendships` appear in Table Editor
   with RLS enabled. New sign-ups automatically create a profile and unranked record.

The migration is transactional and intended to run once on a project without these
tables. If it reports an error or conflicting tables, inspect the error before
changing anything. Do not drop existing account data to make it run.

If deploying with the Supabase CLI later, reconcile its migration history with this
manually applied migration before pushing. Do not apply the same migration twice.
Keep GitHub automatic production deployment and preview branching off during initial
setup. Working directory `.` is correct when this folder is at repository root.

## Data and permissions

- The Supabase user ID owns the account independently of PolyTrack garage profiles.
- Signed-in users can read display names and ratings. Names need not be unique;
  account identity is always the UUID. No emails or Discord tokens are copied here.
- Users may change only their own display name. Render it as text in the future UI.
- Players start unranked (`rating = NULL`, zero rated matches). Clients cannot change
  ratings. The eventual server-side match validator must own rating updates.
- A request is visible only to its two participants. Only its recipient can accept.
  Either participant can delete it to cancel, decline, or unfriend. Only one request
  or friendship can exist per pair; reverse requests do not auto-accept.
- Deleting the auth account cascades through its profile, rating, and friendships.

Blocking, account deletion UI, and invitations remain future work. Search, request
limits, and private presence are supplied by the second migration below.

## Local permission verification

Run `node supabase/tests/foundation.test.mjs` after installing the test-only dependency
with `npm.cmd install --prefix .research/supabase-validation @electric-sql/pglite`.
The suite runs the migration in an isolated PostgreSQL-compatible PGlite database,
with a minimal Supabase auth schema and role fixture. It checks actual grants, RLS,
signup initialization, and friendship transitions. It does not contact Supabase or
verify OAuth, deployed settings, or PostgREST behavior.


## Friends and presence (local 0.4)

The user confirmed successful application of
`migrations/20261021010000_friends_presence.sql` on 2026-10-21. It preserves
existing accounts and friendships. Do not rerun manually applied migrations.

The Account panel uses a portrait social layout: persistent avatar, PolyCup name,
Discord username, and three icon-and-label tabs. Friends is the signed-in default,
with separate Online and Offline sections. Requests handles received/sent requests;
Add friend searches by PolyCup name or exact friend code. Header icons edit the
PolyCup name and copy the friend code; Sign out stays in the bottom-right footer. Selecting a friend reveals Discord identity, rank and removal
controls. Only accepted friends can see each other's presence. Unknown network
status is shown as unavailable instead of claiming the friend is offline.

The client sends a server-timestamped heartbeat and refreshes friends every 30 seconds.
A presence session expires after 90 seconds without a heartbeat; other clients see
this on their next refresh (up to approximately 120 seconds after a crash). Explicit
sign-out removes that instance's session. Multiple game windows have independent
sessions, so closing one does not mark another active window offline. This is
PolyCup presence, not Discord online status or Discord Rich Presence.

The backend limits pending requests and request frequency, including cancelled
requests. Profile identity fields are populated server-side from Discord metadata;
clients cannot write those fields or ranks. Pending requests and search never reveal
presence. Raw session timestamps are not available to clients. Background request
failures preserve the list and offer Retry; unchanged heartbeats do not rebuild it.

Verification:
- `npm test`: 231 checks passed, including presence lifecycle, account switching,
  stale-response protection and search races.
- `node supabase/tests/friends-presence.test.mjs`: eight scenarios plus their parent
  passed against the actual migrations in isolated PostgreSQL/PGlite.
- `node supabase/tests/foundation.test.mjs`: ten scenarios plus their parent passed.
- `tests/browser/friends.check.js`: three isolated accounts through the actual PML
  game UI, with real SQL/RLS behind a local API adapter. Covers request lifecycle,
  privacy, multiple windows, expiry, reconnect and sign-out. Screenshots cover
  desktop and narrow layouts. Requires `.research/friends-api-server.mjs` on 8811.
- `tests/browser/account-layout.check.js`: nine synthetic players, desktop/390px/320px
  layouts, long names, group counts, fixed header, request badge and retained drafts.
- `tests/browser/account-transition.check.js`: 24 close/reopen cycles across the
  standalone preview and game, narrow/desktop widths and reduced-motion settings.
  Per-frame checks preserve vertical layout, centering and unsaved name drafts
  through rapid reopening. Closing dialogs keep their column layout during fading.
- Account browser checks passed PKCE/manual return, editing, saved-session restore,
  refresh, revocation, failed saves and popup fallback after the social layout change.

These checks use synthetic identities and make no live account writes or leaderboard
uploads. Real two-account testing on the hosted Supabase project remains separate
from these controlled integration checks. The mod build remains local under
`output/dev-mod/`; the published 0.3.3 distribution is unchanged.


## Lobby finder (local 0.4)

The user applied `20261021020000_lobby_directory.sql` and
`20261021030000_guest_lobby_access.sql` on 2026-10-21 and enabled anonymous sign-ins.
A read-only live check confirmed unauthenticated listing access and the enabled setting.

Open **F8 > Find lobby** in the local game preview (`http://127.0.0.1:8796/`).
Browse/search/Join require no sign-in and create no account. **Host lobby** opens
PolyTrack's native hosting screen; once a Cup is created, it is public by default.
The host's **List publicly** checkbox removes or restores its listing. A private
choice survives drafting/track changes within that Cup; new Cups default public.
Completing/ending the Cup or leaving its connection removes the listing.

Signed-in hosts publish using their account identity. Guest hosts acquire a saved
Supabase anonymous session only when needed for publication, under the separate
`polycup.lobby-guest.v1` storage key. It never becomes a Discord login or replaces
`polycup.account.v1`. Guest host labels follow the current garage name. Browsing
and joining use only public directory functions; they cannot mutate announcements.
Only the publisher can change its row, and a second active window cannot replace
its lease. This is discovery metadata reported by a host, not trusted competitive
evidence, verified capacity, geographic region or a latency measurement.

Listings refresh their server timestamp every 20 seconds while valid and public.
Other finders poll every 15 seconds while open, with an immediate Refresh button.
The server hides listings after 90 seconds without a heartbeat or on invite expiry.
A fresh join lookup checks the selected Cup ID, mod version, capacity and expiry
before returning its invite code. Native networking still owns actual connection
success, capacity races, incompatible mods and network errors. The directory is
limited to the first 100 live listings for this initial small-community version.

The native 0.6.3 navigation adapter reuses the game's menu, host/join and transition
paths. It waits for in-progress startup transitions and confirms the menu handoff
before dismissing the finder. It refuses to replace an existing multiplayer
connection. Those version-specific symbols must be revalidated for a game update.

Verification: 235 ordinary tests passed, including four directory lifecycle tests;
eight SQL checks (seven scenarios plus their parent) passed against the actual
migrations in isolated PostgreSQL/PGlite. `tests/browser/lobby-finder.check.js`
uses an isolated API/database and synthetic users to cover guest browse/join,
saved guest hosting, default/public/private behavior, search, incompatible/full
rows, expiry, Cup-end cleanup, desktop/narrow layout and actual native join/host
screen handoff. Native connection establishment is intercepted in this test; a
real two-player WebRTC game through the finder remains a separate manual check.
Account editing, saved login, refresh, revocation and sign-out browser regressions
also pass. No automated check created a live guest account or uploaded a run.

The isolated test server is `.research/lobby-api-server.mjs` (port 8812), with its
fixture UI built from `.research/lobby-preview.mjs`. It is never shipped in the mod.
Use only synthetic identities there; it deliberately emulates authentication for
local tests. The production mod and migration files contain no administrative key.

## Main-menu waiting rooms (local 0.4 development, 2026-10-21)

The new main-menu PolyCup tile sits between Multiplayer and Play. Native
Multiplayer keeps its own menu and handlers. The PolyCup hub embeds the existing
account/friends interface on the left, with the directory and hosting controls on
the right. Entering a room replaces that hub with the existing Cup lobby, rules,
draft and embedded chat. The in-game trophy launcher is removed; F8 and the held
Tab scoreboard remain available.

`20261021040000_waiting_rooms.sql` is a **new, unapplied local migration**. It does
not modify the previously applied account/friends/directory migrations. Do not
apply it to the hosted project as part of local testing. The development build
requires these new functions for waiting rooms; the live database still only has
the earlier directory functions until this migration is deliberately deployed.

The room is host-controlled, as existing Cups are. Authenticated members submit
actions with server-assigned actor IDs; only the host's current browser instance
can commit the setup snapshot. Guests use the existing separate anonymous session.
Browsing does not require creating an account. Membership and actions are private
behind RPCs, and direct table access is revoked. Public rooms are the default;
private rooms require their room code. Sixteen members can occupy a room, with
eight racer slots and the remainder spectating. Member IDs are never recycled
inside a room, so a newcomer cannot inherit a departed racer's selections.

The host starts a five-second grace period announced in chat. Queued edits change
the database revision immediately, invalidating an in-flight start commit. Native
multiplayer is created only after that grace period. Each member receives a private
connection ticket; the host binds tickets received over the native peer channel to
that peer's real ID. Racing cannot commit until every racer has a current-attempt
binding. All draft references are remapped together, without matching by nickname.
The existing Cup loading acknowledgements and round clock then take over.

Cancellation, missing racers and failed setup preserve the original draft. A new
attempt gets a new ID; stale completions cannot advance it. The host can cancel a
connection attempt, and attempts have a 90-second room timeout. Late spectators
can join a running Cup through its listing. Ending the Cup closes its room and
returns to the hub. Leaving locally remains possible if the backend is unavailable;
a late response cannot resurrect a room that was left.

Traffic is bounded for the initial small-community release. The finder refreshes
every 15 seconds while open. The host polls setup actions approximately once per
second; other foreground members poll every two seconds, and background guests
every eight. Racing clients retain only a 20-second room heartbeat. Database
heartbeat writes are throttled to ten seconds. Unchanged snapshots/player lists
and already-acknowledged actions are omitted. Custom track exports are fetched
separately by the host, not broadcast with each UI change. Chat retains 200 lines;
completed actions expire, and stale rooms are cleaned on subsequent room creation.

### Verification and limits

- `npm.cmd test`: 243 checks passed, including draft/start cancellation, ID
  remapping, aborted/late preparation, offline leave and in-flight poll cleanup.
- `node supabase/tests/waiting-rooms.test.mjs`: six SQL checks (five scenarios
  plus their parent) passed against the actual migration in PGlite/PostgreSQL.
  These cover access control, private codes, browser leases, revision conflicts,
  the grace period, ticket ownership, missing bindings, late spectators, ID reuse,
  track-export isolation, kicking and expiry.
- `tests/browser/waiting-room.check.js`: actual native game clients and WebRTC,
  with local database and signalling substitutes. Verified ordinary Multiplayer
  navigation, pre-race hosting/joining without a native session, draft, unready
  cancellation, deliberate connection failure, saved-draft retry, a delayed racer,
  warmup, timed racing, a late spectator and Cup-end directory cleanup. No browser
  exceptions in the successful run. Game API/leaderboard traffic was blocked.
- `tests/browser/cup-hub-layout.check.js`: embedded social controls, requests,
  clipboard, long names, fixed header/footer, name drafts, rapid close/reopen, and
  1100/390/320 px layouts with synthetic profiles.
- `tests/browser/cup-hub-account.check.js`: OAuth/PKCE with synthetic responses,
  saved-session reload, profile edits, failed saves, token refresh, sign-out and
  popup/manual-return fallbacks in the new hub.

One expanded three-client run (including failure/retry and spectator admission)
returned 179,074 bytes across 122 local API responses. A five-second idle interval
with the first two clients returned 784 bytes across four responses. These are
response-body measurements only, not wire traffic, a monthly forecast, or a hosted
compute/load benchmark. Friends/presence and different room sizes add usage.

For local reproduction, run `node supabase/tests/waiting-room-api.mjs` on port
8813 and the development game preview on 8796, then run the browser checks through
Playwright CLI. The API fixture deliberately emulates authentication and binds only
to loopback; it must never be deployed. It uses the same local PGlite dependency
as the other SQL tests. Screenshot and log artifacts are in `output/playwright/`.

The hosted migration, live Discord accounts, real matchmaking relay and
cross-network NAT/firewall behavior were **not** exercised by these local tests.
An internet test between two different networks remains a release gate. Stable
`dist/0.3.3/main.mod.js` remains byte-identical to the release checkout.


### Ranked queue (local development only)

`20261022010000_ranked_queue.sql` adds one server-owned queue. It is **disabled by
 default** and has not been applied to the hosted project by this implementation.
Both ranked and queue configuration must be enabled by the operator; a trusted
catalog must be configured first. Never enable the normal build until the drafting,
native racing handoff and trusted result submission are connected. This stage
stops at an accepted roster, explicitly labelled in the local UI.

Four players form a match immediately when mutually within tolerance. Every
selected player must have waited 60 seconds for three racers, or 120 seconds for
two racers. Tolerance starts at six raw model mu units, widens by 0.1 per second,
and becomes unrestricted after five minutes. These are operator configuration,
not client arguments. Each player's own wait is respected. A match has 30 seconds
to accept. All players must accept before entering the drafting state; declining
or expiry releases all claims without silently requeuing anyone.

The authenticated queue RPC owns entry, cancellation, heartbeats and formation;
players cannot nominate a roster, rating, catalog, host or match ID. Account and
queue locks serialize admission. Custom Cups and ranked are mutually exclusive.
Instance leases fence other windows and permit recovery after 35 seconds of
absence. A new queue attempt uses a new instance token. Lost responses retain
active intent, and an uncertain cancellation is retried until confirmed.

The finder has a separate Ranked row below Host Cup, including the supplied rank
badge. Grandmaster displays leaderboard rank above rating; unknown/provisional
ranks do not impersonate an earned tier. Rank reads are cached for a minute. Queue
polls run every five seconds while active, and every fifteen seconds while the
finder is visible and idle. There is no idle queue polling with the finder closed.
Heartbeat writes are throttled to ten seconds. Acceptance countdowns update locally.

For isolated Electron QA, first build and prepare the usual test clients. In a
separate PowerShell process set `POLYCUP_QA_PORT=8821` and `POLYCUP_QA_RANKED=1`, then
run `node supabase/tests/waiting-room-api.mjs`. Run
`node tests/browser/ranked-queue-electron.mjs` from the project directory. This
opens four fresh test profiles, uses synthetic Discord identities and a loopback
PGlite database with the actual migrations, and closes its own clients afterward.
Wait/lease expiry is accelerated by backdating fixture timestamps. The fixture
must never be deployed. It is not evidence of live Supabase, real OAuth, native
ranked racing or cross-network WebRTC behavior. Screenshots and the bounded result
are saved in `output/playwright/ranked-queue/`.

### Local ranked draft and racing verification

Keep migrations 20261022030000_ranked_session.sql,
20261022040000_lobby_ranks.sql, 20261022050000_friend_public_games.sql, and
20261022060000_friends_leaderboard.sql local until hosted rollout is explicitly
requested. They follow the existing local queue and profile-stats migrations.
The development bundle and usual test-client package contain the new UI, but
these endpoints must exist on the backend selected for testing.

After building and preparing test clients, start the isolated fixture with
POLYCUP_QA_RANKED=1 and POLYCUP_QA_PORT=8821, using
node supabase/tests/waiting-room-api.mjs. Then run
node tests/browser/ranked-race-electron.mjs 4 (four-player formation/draft recovery)
or use 2 for the duel fallback, active-race reconnect, and public-friend joining
checks. The fixture uses synthetic accounts and must never be deployed.
Native game uploads and external API traffic are blocked by the harness; WebRTC
uses locally exchanged signalling. All automatically opened clients are closed
when the test finishes. Do not replace game/resources/app.asar while test clients
are open; Start-Test-Clients.ps1 deliberately avoids doing so.

### Full local ranked settlement check

Apply the local migrations through 20261022070000_ranked_settlement.sql to the
isolated fixture (the fixture does this automatically). Start it with
POLYCUP_QA_RANKED=1, POLYCUP_QA_SETTLEMENT=1 and POLYCUP_QA_PORT=8821 using
node --import tsx supabase/tests/waiting-room-api.mjs. Build/prepare test clients,
then run node tests/browser/ranked-full-cup-electron.mjs.

This uses synthetic accounts and a local catalog of generated straight tracks,
real native driving/finish callbacks and WebRTC, unchanged 140-point finalist and
three-round rules, guest close/rejoin, a deliberately lost result response,
repeated settlement, match history and client restart. No scores, finishes or
clocks are injected. It is a local integration test, not a hosted deployment or
an anti-cheat proof. The fixture server must never be deployed.

### Reconnect decision and explicit abandonment (local, 2026-10-23)

`20261023070000_ranked_explicit_abandon.sql` adds an authenticated, match- and
instance-bound abandonment RPC, plus queue fields used by the reconnect dialog.
It is prepared locally; it is separate from the deployed settlement wake fix.
The client enables the new dialog only when the queue response advertises these
fields. A racing match is not automatically rejoined from the finder. Players
choose Reconnect, or confirm that they want to abandon and accept a loss.

Confirmed abandonment cannot be reversed, cannot replace a submitted finish
transcript, and delegates all rating writes to the existing settlement pipeline.
Repeated calls are safe. Host loss is presented separately: guests are not asked
to abandon, and a departed host is told that its native race cannot be restored.
An expired grace period does not lock an offline player out of the finder.

Validation: `node --import tsx --test supabase/tests/ranked-abandonment.test.mjs`,
`node tests/browser/ranked-reconnect-choice.mjs`, and the native
`tests/browser/polish-flow-electron.mjs` harness. The latter uses the local fixture
on port 8847, generated tracks, real WebRTC/physics, and cached PML assets;
`PWC_RANKED_ONLY=1` skips the separately exercised custom-room stress sequence.
