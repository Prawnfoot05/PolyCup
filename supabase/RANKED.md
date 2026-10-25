# Ranked backend

## 0.4.0 release candidate — 2026-10-25

The final 0.4.0 bundle passed normal-client live queue, acceptance, draft and native multiplayer handoff. Its exact version gate was temporarily enabled for the check, then restored to 0.4.0-dev.1. Publication must coordinate the 0.4.0 gate; see RELEASING.md and release/activate-0.4.0.sql.

Settlement wake fixes and the result/input-review workers are deployed. The later two-client full Cup recorded 30 native finish uploads and reviews, two unique rating events and visible result popups; settlement followed the final transcript by 1.235 seconds in that sample. Profile-picture RPC verification also passed after the latest migration. Earlier dated checkpoints below describe historical state, including findings since resolved. They are not the current release checklist.


## Full bundled-track Cup and menu guidance — 2026-10-23

Four packaged clients completed 15 rounds against live Supabase and native
signalling. Selected from the complete configured pool: Winter 5, ShardMir,
Summer 2, and Re : Akina. All rules/timers were unchanged, all first-visit
warmups ran fully, and a returning track did not repeat its warmup. A test-only
input driver supplied public verified input recordings to the native simulation;
the bundled tracks, WASM physics, scoring and finish detection were unchanged.
Native leaderboard uploads were blocked. This is repeatable clean-run QA, not
a representative human playtest. The same racer won every round.

Evidence: `output/live-results/full-real-cup-summary.json`, the raw report it
summarizes, and screenshots under its referenced `output/playwright/` folder.

- Queue to match found: 5.914 seconds.
- Queue to confirmed settlement: 25 minutes 34.996 seconds.
- First warmup to final transcript: 24 minutes 29.531 seconds.
- First warmup to settlement: 24 minutes 50.846 seconds.
- Last transcript to settlement: 21.315 seconds.
- Rating popups observed 1.831–5.434 seconds after settlement (sampled UI timing).
- Four distinct rating events; all four first-rating popups appeared. These were
  new provisional test accounts. All 3,252 captured client HTTP responses were
  below 400. All QA accounts, matches and rating events were removed afterward;
  one real profile remains, with zero ranked matches, queue seats and events.

The user accepted this duration for the long-track selection and explicitly kept
the current rules/full pool. No match-length changes were made.

Open settlement finding: the immediate wake did not dispatch this result. Cron
at 13:34:09.070 UTC dispatched the only recorded request, and settlement committed
at 13:34:09.660 UTC. The installed wake trigger falls back silently on errors and
the dispatcher can return busy on global advisory-lock contention; the exact
cause of this occurrence is not logged. The 21-second wait is not Edge processing
time and must not be presented as an immediate-settlement success. No hosted
backend changes were deployed during this task.

The local 0.4 menu now has a one-time welcome per saved game profile and a
rectangular ranked-help button. Its tier graph uses the approved launch config,
badge artwork, six rating intervals, five placement markers and a top-ten Master
GM distinction. Browser checks cover persisted welcome dismissal, guide opening,
Escape dismissal, narrow layout and button/badge spacing. The 292 app tests and
typecheck pass. Stable 0.3.3 remains unchanged.

## Approved configuration and normal client matchmaking — 2026-10-23

Hosted ranked and queue flags are enabled for `0.4.0-dev.1`, with the approved
five provisional Cups, tier floors, and all 87 bundled tracks below. The mod
remains local; the stable manifest still points to unchanged 0.3.3.

Four packaged clients used actual UI queue joins against live Supabase, without
administrative roster reservation, shortened clocks, fake API responses, or a
local native multiplayer relay. Verified cancellation, four-player formation
and decline, real 60-second three-player and 120-second two-player fallback,
acceptance expiry, visible all-accepted confirmation, eight bans/eight picks,
and native multiplayer warmup with the lobby closed on all four clients.
The catalog IDs/categories/content hashes agree across two clients.

Evidence: `output/live-results/release-matchmaking-audit.json` and its referenced
screenshots/raw report. All 610 captured Supabase responses were below HTTP 400.
The original harness incorrectly expected 17 joins; the scenarios total 14
(1 + 4 + 3 + 2 + 4). Corrected assertions verify the recorded responses, including
per-client counts of 5/4/3/2. The original failing report is retained. This is
not a claim of a second native run. Disposable QA accounts and matches were
removed; one real profile, zero ranked matches/queue entries/rating events remain.
QA Auth sessions were provisioned for the test; Discord OAuth was not retested.
The test ended at warmup and did not drive a complete realistic ranked Cup.

## Catalog caching and bounded settlement batches — 2026-10-23

Migration `20261023050000_ranked_static_snapshot.sql` is applied and the hosted
result function is version 3. The 0.4 mod remains local; see the current checkpoint
above for ranked enablement.
Earlier checkpoint sections below are historical, not current release gates.

The game supplies bundled official/community track data locally. The new
`polycup_ranked_session_v2` endpoint returns the frozen catalog and rules once;
subsequent calls provide a content fingerprint and omit those fields when they
match. The client keeps only the latest static snapshot, reuses it across Cups,
and refreshes it on a catalog/rules change or fresh process. A late response uses
the cache captured by its request. Room, member, chat, and draft state are never
cached as static data. Membership and action checks precede cache negotiation.
The original endpoint remains compatible; the client falls back only on a
missing-function error, never by repeating an ambiguously completed action.

The Edge worker handles up to four Cups per invocation, limited to eight seconds
for starting work and 2,000 finish observations. Large transcripts run alone.
Per-Cup transactions, retry backoff, immediate continuation, and Cron fallback
are preserved. See `worker/EDGE.md` for resource testing and deployment details.

Live comparison: `output/live-results/static-batch-verification.json` exercised
the real cached client adapter with 40 authenticated simulated players and ten
four-player Cups. Average racing snapshots fell from 15,792 to 3,850 decoded bytes
(75.6%). Last-of-ten settlement fell from 10,771 to 3,377 ms; actual Edge replies
reported 4, 4, and 2 completions. Forty rating events remained unique after repeat
submissions. The short verification plus its cleaned-up harness setup retry used
6.00 MB of decoded response data. All QA accounts/matches/events were removed;
only the user's real account remains. This is backend simulation, not native
physics or a rendered-client test. The stable 0.3.3 artifact remains unchanged.

The approved launch settings are five rated provisional Cups and tier floors
0 / 5,000 / 10,000 / 15,000 / 20,000 / 25,000, with GM retaining the top-ten
eligible-Master rule. `ranked-launch-config.json` records this decision.
`catalogs/polytrack-0.6.3.json` records all 17 official/main and 70 community
tracks extracted from the packaged game's native library, including stable IDs
and SHA-256 hashes of native exports. Both settings and the complete 87-track
catalog are configured on the hosted backend; no custom tracks are included.
The catalog agrees across two independent normal client instances.

The bundled-track duration check above is complete and the user accepted the
long-track outcome. The missed immediate settlement wake remains an open finding.
Peer hosting and consensus-based result validation remain deliberate
limitations; this is not authoritative physics anti-cheat.

## Hosted result processing checkpoint — 2026-10-23

The result worker is deployed to the existing Supabase project as `polycup-results`.
Public ranked matchmaking remains disabled and the 0.4 mod remains local.
Migrations through `20261023040000_ranked_immediate_dispatch.sql` are applied.

Normal result completion now wakes Edge immediately after the final required
transcript commits. Acknowledgement drains the next ready Cup. The 30-second Cron
job is a fallback for retries, missed wake-ups, expiry and abandonment maintenance.
This replaces the earlier Cron-only normal settlement delay.

Hosted evidence in `output/live-results/`:

- `parallel-verification.json`: four packaged clients drove two separate Cups
  concurrently through native signalling and live Supabase, with 15 actual native
  rounds each. One scoped settlement failure rolled back its awards while the
  other Cup settled; Cron recovered the failure. Repeated concurrent function
  calls did not duplicate ratings.
- `abandonment-verification.json`: a second pair of native Cups exercised a
  closed host and closed guest, real 120-second grace, a retried host loss,
  unchanged innocent guest rating, completed surviving Cup, and an offline loss
  notification delivered once across fresh profiles. The surviving native Cup
  settled 356.634 ms after its final transcript.
- `immediate-verification.json`: with Cron paused, two backend fixture matches
  settled in about one second overall (314.695 ms and 200.403 ms by database
  timestamps). These used remapped evidence from the native race, not a second
  physical race. Cron was restored.

- `acceptance-verification.json`: both packaged clients displayed all green acceptance
  checks for 655 ms before opening the draft.
- `final-state.json`: deployed function version 2 active; dispatcher idle with zero
  failures, no unfinished jobs, both Cron jobs enabled. Eight QA accounts and seven
  QA matches removed; the original 13 profiles remain. Local test profile folder
  removal was blocked by automatic approval review, so those folders remain.

The test rosters were reserved administratively so global matchmaking could stay
disabled. Isolated confirmed test accounts and generated short tracks were used;
these results do not establish matchmaking load capacity, public OAuth coverage,
real-track match duration, or physical replay anti-cheat.

Two local UI fixes accompany the backend: delayed result popups keep checking
rather than stopping after a minute, and all-accepted popups retain the complete
row of green checks for 650 ms before draft entry. See the corresponding browser
regressions in `tests/browser/ranked-result-retry.mjs` and
`tests/browser/ranked-acceptance-confirmation.mjs`.


## Current local checkpoint: Supabase Edge and conditional Cron (2026-10-23)

`polycup-results` is a deployable Edge Function sharing the existing settlement
code. Migration `20261023020000_ranked_edge_schedule.sql` adds a disabled private
dispatcher; `worker/install-edge-cron.sql` installs a 30-second conditional check
and scoped Cron-history cleanup when explicitly applied. No hosted changes have
been made.

Cron invokes Edge only for due work. Requests carry short-lived HMAC signatures
computed from a Vault secret, never the reusable secret itself. HTTP failures
back off independently of job retries; overlapping calls retain the existing
atomic, duplicate-safe settlement. A real local Supabase Postgres/Edge Runtime
test exercised Cron, pg_net, pgcrypto, Vault, retry rollback, both abandonment
paths, signature recovery, and 1,000-round evidence under Free-plan resource
limits. See [Edge deployment and QA](worker/EDGE.md).


## Current local checkpoint: durable result worker (2026-10-23)

The deployable Node job is in `supabase/worker`. Migration
`20261023010000_ranked_result_worker.sql` adds private durable jobs, a restricted
NOLOGIN capability role, and preservation of complete evidence during worker
downtime. No credentials, schedule, deployment or ranked enablement were created.

The worker uses transaction row claims, atomic settlement/job completion, bounded
batches, capped retry backoff and aggregate-only health output. Confirmed host
abandonment charges only the host; surviving racers remain unchanged. Both the
PGlite fixture and a real local PostgreSQL 16 test use the restricted role.
The PostgreSQL tests additionally kill an active settlement connection, restart
the executable and verify no duplicate rating events.

See [worker operations and validation](worker/README.md) for setup, scheduling,
retry handling and the unchanged peer-attestation trust boundary. The previous
offline-notification checkpoint below remains in place.

## Current local checkpoint: offline result notifications (2026-10-23)

Migration `20261023000000_ranked_result_notifications.sql` adds private,
account-scoped result delivery receipts. Only completed matches with a committed
rating event enter the inbox, including abandonment losses. Installation marks
existing history seen so enabling this feature does not replay old Cups.

Claiming a result does not mark it seen. A two-minute delivery lease keeps separate
installations from presenting the same account's unread result concurrently; the
same installation can recover its claim immediately after a restart. The game
marks a result seen only after the confirmed rating change has rendered in a
visible popup. Loading, failed reads, hidden rendering and closing before display
leave it unread. The acknowledgement is saved locally before sending, retried
idempotently, and synchronized to the account. A lost response does not redisplay
an already-rendered result. An acknowledgement from one account cannot consume
another account's result. These endpoints cannot change ratings.

Checks run on sign-in/startup, opening PolyCup and connectivity recovery, with
inbox reads bounded to once per minute otherwise and deferred during active Cups
or other dialogs. Closing an unavailable/unread popup snoozes it until a later
explicit wake or restart rather than reopening it immediately. Saved pre-Cup
profiles allow offline promotion animation only when the existing consistency
checks still match that exact result. Public history remains independently usable.

The packaged offline-result test completed 15 real native rounds, paused only the
local result worker, closed the guest before any rating event existed, and then
settled while the guest was offline. First reopen displayed -279 (12500 to 12221).
After closing without pressing Continue, the second reopen displayed no popup.
A fresh installation for the same account also displayed none. One committed
acknowledgement response was deliberately dropped and retried; rating events
remained exactly two, one per racer. Evidence is in
`output/playwright/ranked-offline-result/verification.json`.
The separate browser check covers close/reopen event ordering, loading dismissal,
hidden rendering and closing during a delayed claim. All tests use local services
and synthetic accounts. No hosted migration or 0.4 publication was performed.

## Previous local checkpoint: result settlement (2026-10-22)

The local game now records its own native finishes, builds a complete account-ID
transcript at Cup completion, persists it before sending, and retries identical
submissions after lost responses/restarts. Ranked completion snapshots include
all scored rounds; ordinary racing snapshots remain compact. Account rebinds
therefore preserve both old scores and the result evidence.

Migration 20261022070000_ranked_settlement.sql adds immutable per-racer transcripts,
a private validation ledger, the member-only result status endpoint, and a guarded
settlement transaction. It retires the older client scoreboard-only report RPC.
The local worker in ranked-validator.ts independently reconstructs the Cup using
the reserved rules/draft: schedule membership and rotation, complete roster,
finish bounds, elapsed time, points, 140-point finalist eligibility, finalist win,
and placements. All continuing accounts must submit matching transcripts; each normal client
first compares its own claimed finishes with its durable native-finish journal.
Missing or invalid race evidence never awards a competitive win. Confirmed abandonment has its own server-owned loss path.
The existing Bradley–Terry transaction applies the whole batch once, with an
immutable event per match/player. Repeated workers and lost client responses do
not increment rated_matches again. A host loss after all receipts are stored does
not cancel review; a confirmed host abandonment before complete receipts applies only the host loss.

This is a **local result-integrity validator**, not a native replay/anti-cheat
verifier. It cannot prove honest physical execution against colluding or modified
clients. No replay verifier, production worker, service credentials, hosted
migration or public ranked enablement has been deployed. Do not treat local
peer-attested settlement as a production anti-cheat guarantee.

The result screen reads only committed rating events. Successful settlement
invalidates cached profile/stats and leaderboard data. Terminal unrated results
show that no rating changed. The UI's existing promotion/reduced-motion behavior
is preserved. Leaderboards now lives in the ranked activity row; Requests section
strips share the Friends section styling.

Migration 20261022080000_ranked_abandonment.sql adds racing abandonment. A detected
individual disconnect starts a 120-second server grace; a voluntary Leave starts
it immediately. The normal missing-heartbeat detector waits 35 seconds first.
Returning before expiry clears the grace. Queue polling cannot renew a voluntarily
left seat; expired racers cannot reclaim a native connection ticket. Detection
requires another active backend participant, so a shared backend outage is not
retroactively treated as mass abandonment.

Confirmed leavers are placed below continuing racers. The worker can settle from
matching continuing-player transcripts without waiting for the leaver to approve
their loss. Every leaver's Bradley-Terry calculation treats all opponents as ahead
of them, so ties between leavers cannot turn abandonment into a rating gain. The
loss is committed with the final Cup result, and the account claim stays locked
until settlement. A lost host interrupts the Cup: only confirmed leavers get a
loss event; innocent guests receive no rating change or fabricated win. Native
connection loss keeps guest backend presence alive to distinguish those guests
from the disappeared host. A closed host process cannot currently restore its
native race authority. This rule applies after racing starts; pre-race queue/draft
dodging penalties remain a separate policy.

The dedicated-host option is exploratory only. No spectator bot, dedicated host,
host migration or paid infrastructure has been created.

Local automated verification: 283 application tests and 84 SQL tests pass.
A native 15-round Cup, including a guest close/rejoin and DNF, settled from two
complete matching transcripts. Subsequent client restarts, six authenticated
identical resubmissions and five worker retries kept exactly one event per player.
The test fixture seeds ratings at 12,500 and 20 prior rated matches without old
history rows; the completed Cup produced 12,780 and 12,221, with one actual history
entry each. This seed explains why rated_matches=21 and the UI history count=1.
The packaged two-client full-Cup test now passes in one run: 15 real native rounds,
one guest close/rejoin with a DNF, dropped committed response recovery, result
popup, one history row, repeated worker settlement, and restart persistence.
The separate host-close test used a real 120-second grace after detection (159.36s
from process close to verification); only the host lost 279 points, and the guest
returned to the finder with unchanged rating. Both tests used local signalling,
local migrated PostgreSQL and synthetic accounts, not hosted services.

The earlier sections below describe previous checkpoints and are superseded by
this section for result submission/settlement. The user previously confirmed the
foundation and rating/history migrations on Supabase; subsequent work remains local.


Local 0.4 work. Migration `20261021070000_ranked_foundation.sql` follows the
account, presence, waiting-room, single-Cup and friend-invitation migrations.
It is additive apart from extending the existing admission wrapper. The follow-up
`20261022000000_ranked_rating_history.sql` implements the selected rating model and
public match details. Neither migration has been applied to the hosted project.
Ranked starts **disabled**; no queue, validator worker, thresholds or public website
are deployed here.
Normal custom Cups and guest browsing remain available.

## Fixed match contract

The server snapshots rules, ordered roster (first player is host), rating model
version and the eligible track catalog when a trusted worker reserves a match.
Only 2–4 distinct, non-anonymous accounts are eligible. Four is the target; the
future queue must enforce the longer wait before forming two/three-player games.
The reservation RPC itself does not enforce queue wait times.

Rules: two bans and two picks per racer, official/community tracks only, three
rounds per track, 140 points to enter finalist mode, then a round win to finish.
Remaining timing/scoring settings use the existing Standard preset, snapshotted
in rules version 1. There is no reset/decay process. Tests compare the entire
client preset to the SQL snapshot so later Standard edits cannot silently drift.

Track entries have `id`, `category` and a SHA256 `digest` of the track content.
The future trusted catalog publisher must verify these; clients cannot nominate
custom tracks by relabeling them. At least four unique pool entries per racer are
required. Each racer makes two distinct picks; different racers may pick the same
track, matching current Cup behavior. The draft RPC checks ownership, counts,
pool membership, unique bans and exclusion of banned picks. It freezes the draft
before racing. It does not yet enforce turn-by-turn draft actions: the future
trusted drafting coordinator must do that before submitting the final draft.

## Authority and lifecycle

- `polycup_ranked_reserve`: **service_role only**, idempotent match UUID, locks
  accounts in deterministic order using the same admission lock as custom Cups.
- `polycup_ranked_current`: signed-in participant's active match ID for recovery.
- `polycup_ranked_member`: participant-only accept, poll/reconnect or decline.
  An instance can be replaced after 35 seconds without a heartbeat. An old
  instance cannot heartbeat or report once replaced. Writes are throttled to ten
  seconds; the future client should heartbeat about every 20 seconds.
- `polycup_ranked_advance`: **service_role only**, reserved → drafting after all
  accept, drafting → racing after a valid draft and fresh racers, or cancel/unrate.
- `polycup_ranked_report`: fixed roster only, current instance, one immutable
  normalized report per racer; exact retries and reordered standings are safe.
- `polycup_ranked_rate`: **service_role only**, takes only a validated match ID,
  checks complete matching reports and calculates the selected model in PostgreSQL.
  Calls the internal `polycup_ranked_finalize`; compare-and-set checks all prior ratings,
  match counts and model states. Any failure rolls back the entire batch. A retry
  of the same batch is harmless; a changed batch is rejected. Ledger rows retain
  before/after ratings, match counts and model uncertainty/state for auditing.

Reports contain `{digest, rounds, standings:[{player_id, place, points}]}`. There
must be exactly one first-place finisher at 140 points. This is structural
validation, **not proof of a valid finalist win or legitimate physics**. Client
agreement is also not cheat prevention. The future trusted validator must receive
the canonical transcript and verify rounds/draft/rules/finalist victory before
calling `polycup_ranked_rate`. No game client receives a service key. The follow-up
migration revokes direct service-role execution of the arbitrary-batch finalizer.

The first report starts a ten-minute review window. Conflicting reports mark the
match disputed; incomplete/disputed results cannot be rated. Reserved matches
expire after five minutes, drafts after fifteen minutes, and racing has a six-hour
hard limit. Host absence for 120 seconds during drafting/racing cancels or un-rates
the match. These are initial operational limits, not queue wait thresholds.
Expiry releases all seats without adjusting ratings. Reconnecting retains the
same seat. Declining before drafting cancels the reservation for everyone; leaving
afterward cannot unlock another Cup. No disconnect penalty is invented here.

`polycup_ranked_expire` runs lazily on admission/member/report calls and must also
be scheduled by the future worker. Do not enable ranked without that worker.
Completed/cancelled/unrated matches never reactivate on retry.

## UI boundaries

Ranked is not a writable custom waiting room with a flag added. Its record cannot
be joined by room code or friend invite, and hosts cannot change the roster,
settings or rating result. The existing room RPC rejects accounts with a ranked
seat. The later race adapter must connect this authority to native multiplayer;
the current custom-room handoff is not yet a ranked game flow.

`rankedLobbyControls()` is the UI allowlist for that later integration: friends
viewing, chat, rules, appropriate draft/accept actions. Hide invitation buttons,
room codes, visibility switches, preset editors, racer administration, return to
setup, track/score edits and host start/end controls. Decline is only available
before acceptance closes. Friends remain accessible, but inviting into this match
is not. These controls are not yet rendered because the ranked lobby UI is future
work; custom Cup controls remain untouched.

## Public leaderboard and Grandmaster

Public RPCs are callable with the publishable key using the anonymous role, with
no login required. Read pages through `polycup_leaderboard(page_size,page_offset)`;
fetch a player's rank through `polycup_ranked_profile(player_key)` and their rated
results through `polycup_ranked_history(player_key,page_size,page_offset)`.
Page sizes are capped at 100 and offsets at 10,000. Profile returns no row for an
unrated player or before ladder configuration exists; the client maps this to null.
No room codes, Discord metadata, presence, reports, lease IDs or model state are
public. History exposes only completed rated results and rating changes.

Configure six increasing `tier_floors` (Bronze, Silver, Gold, Platinum, Diamond,
Master), a positive provisional match count and model version before enabling.
No numerical thresholds are prescribed by this migration. Test values are fixtures
only. Qualifying players are sorted by rating descending, then time of latest
rating achievement ascending, then account UUID. Positions are unique and computed
before pagination. Equal ratings therefore cannot create an eleventh GM.

GM means **currently at/above Master**, past provisionals, and in leaderboard
positions 1–10. If only three players meet Master, only three are GMs. Falling
below Master or out of the top ten removes GM immediately; no stale stored GM flag.
Provisionals have a profile but no leaderboard position and cannot displace a GM.
There is no lifetime-Master eligibility or activity-decay rule.

Responses separate `leaderboard_position`, `gm_position`, `rating` and `tier`.
`rankBadgeText()` gives a GM `RANK N` as the primary line and rating underneath,
matching the supplied artwork. Other tiers use rating as their primary text.
PNG assets are in `assets/ranks`; rendering them in the UI is the later presentation
step. A public website can consume the same RPCs without exposing privileged data.
The account header's history icon and expanded friend/search-result profiles now
open paginated match histories. Selecting a match shows all final placements and
rating changes via `polycup_ranked_match(match_key)`. First results display
"First rating" instead of falsely treating an unranked player as starting at zero.

## Verification

Run `node --test --test-concurrency=1 supabase/tests/*.test.mjs`, `npm.cmd test`,
and `npm.cmd run build`. Ranked tests exercise the actual SQL under authenticated,
anonymous and service roles, including rollback, retries, stale instances, expiry,
cross-Cup admission and GM boundaries. These use local PGlite PostgreSQL; its
single connection does not prove multi-connection advisory-lock contention.
Live migration/RPC testing, true concurrent-worker tests and end-to-end ranked
racing remain gates before enabling ranked. No live rating data is changed here.

## Offline model experiment (2026-10-22)

`scripts/simulate-ranked.py` runs OpenSkill 6.2.0 against 96,000 synthetic Cups
across 20 seeds, plus same-opponent stress sequences and controlled single-Cup
examples. Dependencies are pinned in `scripts/requirements-ranked-sim.txt`.
Use an isolated Python environment; run from the repository with
`python scripts/simulate-ranked.py`. Outputs are under `output/rating-sim/`:
`summary.json`, `raw-results.json`, `rating-scenarios.png` and
`badge-scale-scenarios.png`. The script has no backend or account access.

The experiment compares Plackett-Luce and Bradley-Terry Full, default dynamics
and more responsive settings, with simple pairwise Elo and placement-only
baselines on the population sequences. All models see the same generated results.
Synthetic races include track affinities, two bans/picks each, three rounds per
track, DNF chances and the 140-point finalist rule. They are not native physics
replays or measured player behaviour. Tied final placements share rating rank;
the existing scoreboard's display-only join-order fallback is not skill evidence.

The experiment's candidate was Bradley-Terry Full with tau=0.25; the user selected
it afterward (implementation below). Defaults adapted slowly after an extreme skill jump;
tau=0.5 adapted faster with more volatility. Static-skill ordering was recovered
well by all candidates, so this test does not establish one model as universally
more accurate. Repeated deterministic wins against the same opponents still
stretch ratings; no model here is an anti-farming or anti-collusion system.

Raw `500 * mu` can become negative. A tested positive display transform is
`12500 * softplus(mu/10) / softplus(2.5)`; divide by ten for a compact scale.
It is strictly increasing before display rounding, starts at 12,500 and leaves
the internal model untouched. It is not capped at 30,000. The user selected this
five-digit display afterward. Rank floors and provisional eligibility remain open.
All output uncertainty bands describe the synthetic seeds, not calibrated
confidence intervals for real PolyCup players. No decay or reset was introduced.

## Selected model implementation (2026-10-22)

Model version: `btf-6.2.0-t025-softplus-v1`. One-player teams, mu=25, sigma=25/3,
beta=25/6, tau=.25, kappa=.0001; default gamma, no weights/margins/score bonuses.
The SQL implementation calculates every player's new mu/sigma from the same prior
snapshot, stores both privately, and rounds the positive display transform to a
whole number. There is no inactivity-driven update. Rank thresholds are separate
from this display conversion; Grandmaster remains a top-ten eligible-Master rule.

`scripts/ranked-rating-fixtures.py` regenerates 243 pinned OpenSkill 6.2.0 cases.
The SQL conformance test checks mu/sigma to 1e-10 and displayed ratings exactly,
including 2/3/4 racers, ties, negative means and unequal uncertainties. End-to-end
database tests cover initial/continued ratings, idempotency, stale-state rollback,
public pagination and detail privacy. Existing ratings without matching internal
state require an explicit migration; they are never silently reinitialized.

Apply migration 70000 first if not already applied, then the 20261022 rating/history
migration in Supabase SQL Editor. This creates the endpoints but leaves ranked
disabled, with no rank floors or provisional length chosen. Local mod bundles are
under `dist/0.4.0-dev.1` and `output/dev-mod`; stable 0.3.3 remains untouched.

Browser QA uses `node tests/browser/ranked-history-preview.mjs` and Playwright CLI
`run-code --filename tests/browser/ranked-history.check.js`. It tests the real
account/friends/history components with synthetic intercepted RPC replies, not
live account data. Screenshots are in `output/playwright/ranked-history-*.png`.


## Local queue and acceptance (2026-10-22)

The queue migration is `20261022010000_ranked_queue.sql`; configuration,
permissions and local reproduction instructions are in [README.md](README.md#ranked-queue-local-development-only).
The normal build remains disabled. This implementation ends at the accepted
roster; the ranked draft/race adapter and trusted final-result path still need
integration before players can complete ranked Cups.

Validation: 267 application tests and 57 SQL tests passed. Four packaged Electron
clients passed queue cancellation, four-player formation, acceptance by every
player, closing/replacing a client into the same roster, three-player fallback
and decline, and two-player fallback and acceptance expiry. The last run used
185 fixture requests. This is a bounded functional run, not a quota/load estimate.
The rank badge and acceptance popup screenshots were visually inspected.

A separate repeated in-place page reload probe (`PWC_QUEUE_PROBE=1`) stalled in
loader startup before the PolyCup root appeared. The test harness dismisses PML's
outdated-version alert, but that did not resolve this additional reload stall.
Do not count the page reload probe as passed. Closing and reopening a client into
its existing ranked roster did pass. No hosted migrations or mod releases were
published for this stage.


The local `20261022020000_ranked_profile_stats.sql` migration adds
`polycup_ranked_stats(player_key)`: completed rated match count, first-place wins,
and win percentage rounded to one decimal. Provisional rated Cups count;
cancelled, unrated, pending and disputed Cups do not. Zero completed matches
returns a null win rate. It exposes no reports or private rating model state.
This migration is prepared locally, not applied to the hosted project. The UI
uses a dash when stats are unavailable and caches profile/stats reads for a
minute, without adding a continuously polling stats request.

## Local draft-to-race adapter and social views (2026-10-22)

Local migrations 20261022030000 through 20261022060000 add the ranked session,
cached lobby rank batch, public-friend game activity/join lookup, and friends
leaderboard. None is applied to the hosted project by this implementation.
Normal ranked configuration remains disabled.

Accepted matches now enter the existing draft UI. The database validates the
fixed roster, two bans and two picks per racer, all-ready grace, invitation
publication, per-account connection tickets, and transition to racing. The
native race keeps three rounds per track, the 140-point finalist threshold and
automatic rounds. Ranked setup hides custom host controls, invitations, room
codes, visibility, and spectator registration. Failed pre-race connections keep
the choices and require a fresh ready/start attempt. Old attempt IDs and tickets
cannot bind a returning racer. A host process restarted after racing ends the
interrupted match unrated; it does not recreate a new race under an old match.

Two- and four-client packaged Electron tests use the native game, real WebRTC,
a locally migrated PGlite database, synthetic authentication, and local signalling.
They do not verify hosted Supabase deployment or the public signalling service.
The browser acceptance fixture now covers the actual draft and race handoff,
not just the accepted roster. See output/playwright/ranked-race-2 and -4 for the
bounded runs and screenshots. Model tests separately exercise round-boundary
reassignment, preserving the account name and score after a reconnect.

The adapter does not finalize trusted race evidence or invoke rating settlement.
A playable local start/reconnect flow is not a complete production ranked mode.
Queue dodging penalties remain unimplemented/disabled while recovery is tested.

Lobby badges use a membership-bound batch read cached for 60 seconds. Friends
activity is returned with the existing presence refresh, and join clicks recheck
accepted friendship, public visibility, host/member freshness, capacity and
blocking. Private/ranked rooms are not exposed as joinable public friend games.
The friends/global leaderboards use paginated on-open reads cached for 60 seconds,
with no new background leaderboard polling. Global access is anonymous; friends
standings require authentication and include the viewer plus accepted friends.

The local result presentation opens on native Cup completion and reads only the
confirmed public match result. It displays signed deltas, before/after ratings,
and a short count-up. A rank reveal/promotion animation requires matching before
and after server profiles from exactly one rated match; stale profiles cannot
create a promotion. Reduced motion skips animation. Missing settlement remains
explicitly pending, with bounded reads only while the panel is open. This UI does
not submit trusted evidence or settle ratings; that integration is still pending.
