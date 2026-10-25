# Copied-input review

The Supabase input-review backend was deployed and verified on 2026-10-25. It
does not change ratings, reject results, ban players, or publish reference
recordings. Backend deployment is independent of publishing the client mod.
Generated corpus.json and the generated shared input-review.mjs are intentionally
excluded from the public source package. Regenerate them locally using the
reference cache and build-edge.mjs before deploying this function.

## Data and comparison

`node --import tsx scripts/cache-input-references.mjs` caches the top ten public
**verified** recordings on each of the 87 tracks in
`supabase/catalogs/polytrack-0.6.3.json`. Ranks 11–15 are a held-out comparison
cohort and are never indexed as references. Retrieval uses the public browser
path, with no account session or upload requests. Downloading is sequential,
paced, resumable per track, and capped at 500 requests / 20 MB. Existing complete
track snapshots are reused; no background refresh is scheduled.

The cache is under `output/input-review/references/`, excluded from distribution.
It records snapshot dates, source record IDs and ranks, game version, track digest,
and SHA-256 of the compressed recording. The collection ID binds matching-relevant
metadata as well as recording bytes. A different track digest or game version is
not comparable.

The parser implements the native five-channel uint24 delta-toggle format. Times
are native 1 ms simulation steps, not render frames or measured physical keypresses.
Evidence is obtained from the local native car's finished recording, not the
host's sampled input stream. Decompression, payload sizes and event counts are
bounded. Each player submits only their own recordings through an authenticated,
instance-bound RPC. An independent durable outbox retries after interruption;
unavailable uploads never block racing or rating settlement.

Policy `exact-inputs-pilot-v1` requires an exact sequence with at least:

- 24 consecutive state transitions;
- 8 seconds between the first and last matched transition;
- 3 distinct control states;
- 8 steering-state changes;
- 8 different inter-transition durations.

Matching uses a suffix automaton to find exact state/duration spans in linear
time, including repetitive input. There is no fuzzy timing tolerance. Redundant events are canonicalized. Simple throttle
and repetitive sequences do not qualify. These are pilot thresholds, not a
calibrated probability of cheating. Native clock offsets are mapped to Cup time;
only the recorded portion is checked, with full-run coverage never inferred for
an unrecorded prefix.

## Shared findings

`20261025000000_input_review_pilot.sql` creates an opt-in policy, private input
evidence, trusted processor findings, and a public summary RPC. The migration
defaults to disabled. Do not apply it to hosted Supabase as part of local testing.
`20261025010000_profile_pictures.sql` separately exposes bounded batches of current
account pictures for history/leaderboards. It does not change in-Cup garage
identities, cars or flags.

`processInputReviews()` runs locally after normal settlement, independently of the
rating processor. It requires the accepted transcript-validation method and checks
its digest. Interrupted-host forfeits do not publish rejected transcript rounds.
Database quotas cap evidence at 200 runs / 3.5 MB per player per Cup. Clients and
hosts cannot write findings. Raw recordings remain private; public results contain
only matching intervals, transition counts, reference IDs/ranks and provenance.

The public status is **Possible copied inputs detected**. Anyone viewing a rated
match's history sees the same finding, including outsiders and anonymous viewers.
The scoreboard stays contiguous, with input review collapsed below it. Other
states distinguish pending, unavailable, unsupported/invalid, absent reference
coverage, partial coverage and no qualifying reference match. Account pictures
are current pictures, not historical snapshots; missing/failed images use initials.
The old host review panel and its shortcut are removed.

Findings are client-reported evidence, not physical-input attestation. A copied
reference test does not accuse the reference author. Independent leaderboard
submissions are useful negative comparisons but are not proven human input.
Unknown recordings, novel scripts and falsified client evidence remain limitations.

## Reproduce locally

```powershell
node --import tsx scripts/cache-input-references.mjs
node --import tsx scripts/benchmark-input-review.mjs
node --import tsx --test tests/input-review.test.mjs
node --import tsx --test supabase/tests/input-review.test.mjs
node tests/browser/input-review-history.mjs
node tests/browser/profile-pictures.mjs
npm.cmd test
npm.cmd run build
```

The SQL tests use a disposable in-memory PostgreSQL-compatible database. They
write a sanitized public fixture for the UI test. No hosted dummy rows are made.

To exercise collection during a native Cup, run the existing local fixture with:

```powershell
$env:POLYCUP_QA_RANKED='1'
$env:POLYCUP_QA_SETTLEMENT='1'
$env:POLYCUP_QA_INPUT_REVIEW='1'
$env:POLYCUP_QA_PORT='8847'
node --import tsx supabase/tests/waiting-room-api.mjs
```

Then use `tests/browser/polish-flow-electron.mjs` with `PWC_RANKED_ONLY=1`,
`POLYCUP_QA_INPUT_REVIEW=1` and a separate `PWC_POLISH_OUTPUT` path. The harness
uses the prepared isolated QA runtime, local synthetic auth/database/signalling,
real WebRTC and native physics, generated short tracks, and blocks leaderboard
uploads. Generated tracks are intentionally reported as outside reference coverage.
The earlier pinned QA runtime preparation is `.research/prepare-polish-game.mjs`;
never replace an app archive while its test clients are running.

Artifacts are saved under `output/input-review/` and
`output/playwright/input-review-*`. The corpus benchmark separately tests copied
full runs and inserted segments on the real ranked track references. Neither test
alone claims end-to-end authoritative anti-cheat.

## Supabase Edge processing

The dedicated `polycup-input-review` function is independent of rating settlement.
It bundles 870 native compressed references for all 87 tracks. Only the selected
track's ten references decode, with a four-track LRU cache. No Storage bucket or
runtime leaderboard download is required. Refreshing references is an explicit
bounded operator step, followed by rebuilding the backend function.

Build and test from the project root:

```powershell
node supabase/worker/node_modules/typescript/bin/tsc -p supabase/input-review/tsconfig.json
node supabase/input-review/build-edge.mjs
node --test supabase/input-review/tests/limits.test.mjs
node supabase/input-review/tests/run-edge-qa.mjs
```

The integration test uses disposable local Postgres and actual Supabase Edge USER
workers with 2,000 ms CPU, 256 MB memory and 150 seconds wall time enforced. It uses
real pg_net, Vault and Cron, synthetic accounts and cached public replays. This is
backend traffic testing, not forty graphical game clients. No hosted quota is used.
Results: `output/input-edge-runtime-tests.log`,
`output/input-edge-runtime-verification.json`, `output/input-edge-load.json`.

### Processing and recovery

- Eight recordings maximum per request, with an eight-second wall budget for
  starting another transaction. Each recording commits independently.
- SKIP LOCKED claims prevent overlapping workers from writing twice. Findings
  and raw-recording disposal commit together; a crash rolls back an open
  transaction while already committed recordings stay complete.
- Match context transfers once per match per batch. Only settled, digest-validated
  peer transcripts qualify. Server-only abandonment does not expose invalid runs.
- Per-recording retries back off from 15 seconds to 15 minutes. Six failed attempts
  or raw inputs older than 48 hours expire with an unsupported status. Missing
  evidence is never labelled clean.
- Deferred input/settlement wakes execute after commit. A 30-second conditional
  Cron tick recovers missed wakes, due retries and stale requests. Idle ticks
  make no HTTP request or Edge invocation.
- Domain-separated HMAC signs timestamp/nonce. The current nonce must also be
  claimed atomically before processing: repeated, stale or arbitrary signed
  nonces do not run another batch. A crashed claim expires after 90 seconds;
  transport failures back off from 30 seconds to 15 minutes.
- Successful acknowledgements drain the next batch immediately. The reusable
  token never enters pg_net queues, public RPCs, logs or the mod.

### Storage and usage guardrails

Defaults are configurable, not promises of unlimited Free-tier use:

| Limit | Default |
|---|---:|
| Pending raw recordings, globally | 24 MiB |
| New recording bytes per UTC day | 16 MiB |
| New recordings per UTC day | 4,000 |
| Retained recording summaries, total | 24,000 |
| Scheduled Edge requests per UTC day | 5,000 |
| Evidence per player per Cup | 200 recordings / 3.5 MB |

Processed recordings are cleared immediately. Their immutable digest, original
byte size, track/finish identity and compact findings remain. Upload retries after
raw disposal remain idempotent. Temporarily capacity-limited client evidence is
retained, with a five-minute account-level retry delay. The existing 24-hour local
lifetime and 3.5 MB outbox limit still apply.

The 24,000-summary guard is a deliberate lifetime safety stop: about 400 Cups at
four racers x 15 recorded rounds. It never silently deletes historical flags.
Review the setting against actual database size well before that cap. Indefinite
history on finite storage eventually requires an explicit archival/deletion
policy or more capacity. This counter measures retained records, not allocated
PostgreSQL pages: reusable TOAST space does not permanently trip admission.
It is not a byte-accurate physical size guarantee; indexes, logs and other game
data also occupy storage.

5,000 scheduled requests/day bounds this scheduler to 155,000 in a 31-day month,
excluding manual calls or unauthorized traffic. Normal batching is cheaper: a
60-recording Cup needs about eight requests when evidence is available together.
Fragmented arrivals and retries add calls. Database transfer and other multiplayer
traffic share egress. The reference corpus does not cross the database connection
per run.

Official limits checked 2026-10-25: Free includes 500,000 Edge invocations/month,
500 MB database storage, 1 GB Storage and 5 GB egress. CPU is 2 seconds/request;
memory is 256 MB and Free wall time 150 seconds.
Sources: https://supabase.com/docs/guides/functions/limits ,
https://supabase.com/docs/guides/platform/billing-on-supabase ,
https://supabase.com/docs/guides/functions/pricing .
These are shared allowances. Local tests do not measure remaining hosted quota
or guarantee identical hosted network latency.

### Deployment procedure (completed 2026-10-25)

1. Apply pending preceding input-review migrations, then
   `20261025020000_input_review_edge.sql` and
   `20261025030000_input_review_dispatch.sql`. Collection and dispatch start
   disabled; the migrations install no Cron schedules.
2. Provision a separate NOINHERIT backend LOGIN with database CONNECT and only
   `polycup_input_worker` membership. Do not reuse the rating worker login.
   Use a pooler URL with verified TLS.
3. Put a new random 32-byte lowercase-hex token in Vault as
   `polycup_input_cron_token` and Edge secret `POLYCUP_INPUT_CRON_TOKEN`.
   Set `POLYCUP_INPUT_WORKER_ENABLED=1`, `POLYCUP_INPUT_DATABASE_URL` and
   `POLYCUP_INPUT_CA_PEM` if required. Never set LOCAL_TEST on the hosted function.
4. Build and deploy only `polycup-input-review`, never the QA router or mod.
   Unsigned requests must fail; signed requests without an active receipt must
   do no work. Existing result processing remains separate.
5. Apply `supabase/input-review/install-edge-cron.sql`, configure the dispatch
   HTTPS URL, then enable collection/dispatch for an authorized bounded live
   smoke test. Verify the real TLS/pooler/client path before calling deployment
   verified.
6. Monitor private counters, oldest pending input, attempts/last_error_code,
   dispatch last_success_at/failures and actual project size/egress. Use bounded
   rows rather than broad log scans. Cleanup removes only its own old Cron
   logs and expires raw recordings.

Pause collection through `polycup_input_review_config.enabled=false`; pause
wakes through `polycup_input_dispatch.enabled=false`. In-flight transactions
may finish safely. Do not clear retained hashes/findings to retry a job.
A corpus update affects future pending inputs only: disposed recordings cannot
be rescanned. Token rotation requires pausing dispatch and updating Vault and
Edge together.

### Verified locally on 2026-10-25

- 314 application tests passed, plus 10 Edge-runtime checks and 11 SQL/matcher checks.
- 40 simulated players / ten Cups / 600 finished recordings, using the full
  87-track match context: all processed once, no rating changes; backlog drained
  in 23.6 seconds. Typical request median 306 ms, p95 356 ms. Initial module
  startup reached 3.5 seconds wall time. CPU/memory limits were enforced, not
  inferred from Node timings; these wall times are not hosted latency guarantees.
- Eight maximum-event recordings and a 1,000-round context passed the same
  enforced CPU/memory limits.
- Retained row payload for the 600-recording flagged fixture: 441,600 bytes,
  excluding PostgreSQL indexes, allocated pages and WAL. Estimated recording
  plus match-context transfer: 1,704,320 bytes, excluding protocol/query metadata
  and retries; this is an estimate, not a Supabase billing-meter reading.
- Generated worker module: 555,885 bytes; generated reference JSON: 537,890 bytes.
  The external pinned pg dependency is additional deployment packaging.
- Corpus checks: 870/870 whole copies, 855/855 eligible segment copies, zero
  qualifying matches in 4,350 held-out and 3,915 independent-reference comparisons.
  An independent review also checked the suffix matcher against a brute-force
  oracle on 1,000 deterministic synthetic cases without a mismatch.
- Temporary QA containers and their synthetic database were removed. No hosted
  migration, function deployment, reference fetch or mod publication was performed.
  Stable 0.3.3 manifest and bundle hash were preserved.

Summary: `output/input-review/edge-readiness.json`. Hosted pooler/TLS verification is recorded below. Shared monthly quota headroom
was not queried through broad usage/log scans.

### Deployed and verified live on 2026-10-25

`polycup-input-review` version 1 is ACTIVE in the existing PolyCup Supabase
project. The input migrations 20261025000000, 20261025020000 and 20261025030000
were applied; the unrelated profile-picture migration was not part of this
deployment. Collection and conditional dispatch are enabled. Cron runs the
conditional tick every 30 seconds and the scoped cleanup daily at 03:27 UTC.

A separate restricted login passed verified TLS through the hosted pooler.
Unsigned requests returned 401. A signed request without a current dispatch
receipt returned a no-work response. The existing result function's deployed
code hash and the stable 0.3.3 manifest/bundle hash were unchanged. Only 0.4's
backend was enabled; the 0.4 mod was not published.

The bounded live test covered client outbox -> normal authenticated result
submission -> production settlement -> review -> real RankedHistoryUI with live
RPC responses. It used controlled cached replay fixtures, not a new physical
race. Two parallel QA Cups tested review rollback and automatic retry. A further
single QA Cup completed browser verification after correcting the harness's
Chrome installation path.

Across all runs: 90 recordings, 45 flagged copied-reference fixtures and
45 unflagged held-out controls. The first two Cups settled in 1.482 seconds;
the deliberately failed review write recovered automatically and full review
finished in 28.329 seconds. The normal UI verification Cup settled in 1.478
seconds and completed review in 6.622 seconds. These are bounded measurements,
not promised production latency.

Owner, opponent, unrelated account and anonymous viewers received identical
review flags and opened the actual history list/details in Chrome. Shared wording
was "Possible copied inputs detected". Raw-evidence reads and finding writes were
denied to an unrelated authenticated account. Retrying uploads after disposal,
dropping an upload response before outbox restart, and repeating result
submissions produced no duplicate findings or rating awards.

The scheduler made 13 review requests for the tests; idle Cron checks advanced
without increasing that count. Test REST response bodies totalled 630,871 bytes,
excluding CLI/SQL traffic, function responses, transport overhead and deployment.
90 recordings occupied 71,829 upload bytes. This is local request instrumentation,
not the Supabase organization billing meter.

All eight temporary auth accounts, three QA Cups, input blobs, checks, associated
rating data and the scoped fault-injection trigger were removed. Final state:
zero pending reviews, zero QA accounts/hooks, zero retained input summaries and
zero raw input bytes; dispatcher idle with no failures and last HTTP status 200.
Daily usage counters intentionally retain consumed test work.

Evidence: `output/live-input-review/deployment.json`,
`output/live-input-review/backend-verification.json`,
`output/live-input-review/ui-verification.json`,
`output/live-input-review/final-state.json`,
`output/live-input-review/verification.json`.
UI captures are under `output/playwright/live-input-review/`.

### Full native-client verification on 2026-10-25

A full live-backend Cup passed using two isolated packaged 0.4 clients on the
unchanged Summer 2 and Winter 5 tracks: normal matchmaking (two-player fallback),
acceptance, bans/picks, native signalling/WebRTC, warmup, 15 rounds, finalist win,
settlement, result popups and match history inside both actual clients.

Automated controls drove the real cars. Finishes and recordings were generated
by the native game, and the ordinary mod capture/outbox performed every upload.
No finish, transcript or input submission was injected through a QA backend API.
The test-only driver supplies known reference/held-out controls at the native
simulation input boundary. It is not a human playtest or physical-key attestation.
The shipped physics WASM and worker archive bytes were fingerprinted unchanged;
the test wrapper changes only control selection at runtime. Native leaderboard
uploads were blocked.

The decisive run independently verified 30 native finish callbacks, 30 uploads,
30 stored metadata/digest identities and 30 review results. It compared frozen
native finish times, Cup-clock offsets, track/player/round identities and expected
reference attribution, then compared complete public summaries between both
participants. Fifteen reference-driven runs were flagged. The held-out driver
had no qualifying matches: 13 partial statuses because of positive Cup-clock
offsets and two no_match statuses. Both clients displayed the same review details.

Measured server Cup duration: 630.092 seconds (10m30s). Queue fallback: 124.868s.
Settlement committed 1.235s after the final transcript submission. Final review
acknowledgement was 5.958s after submission. There were exactly two rating events,
both result popups were visible, and no unexpected browser errors occurred in the
successful verification run.

The earlier completed native Cup also uploaded/reviewed all 30 recordings, but
its polling observer missed finishes during near-simultaneous transitions. That
oracle was replaced with event callbacks and a second independent observer before
the successful rerun. Startup automation also now waits for PML settings readiness.
The only optional RPC errors in the final run were the undeployed profile-picture
endpoint returning 404; history correctly used initials.

All QA accounts, Cup data, recordings, findings and ratings were removed; no
test clients remain running. Final input backlog/raw bytes/retained rows are zero.
These two completed Cups used eight additional scheduled review invocations.
The stable 0.3.3 manifest and bundle hash remain unchanged; 0.4 was not published.

Summary: `output/live-input-review/native-verification.json`.
Full run, independent oracle and in-client screenshots:
`output/playwright/live-native-inputs-1792930286626/`.
