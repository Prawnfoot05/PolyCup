# Ranked result processor

**Preferred Supabase deployment:** see [Edge Function and conditional Cron](EDGE.md).
The Node executable below remains the local/portable runner; both use the same
settlement implementation.

The shared processor is deployed as a Supabase Edge Function; see `EDGE.md`.
This Node entry point remains available for local or portable operation. The build
itself does not deploy or enable ranked. The game still uses peer-hosted races,
and the 0.4 mod remains local.

## What runs

`main.ts` runs a bounded batch (20 jobs, 20-second dispatch budget) and exits.
`--loop` runs batches with a 15-second pause, draining the current transaction on
SIGINT/SIGTERM. A dispatch budget stops starting new jobs; an in-flight job may
finish afterwards. PostgreSQL statements time out after 15 seconds, lock waits
after 3 seconds and abandoned idle transactions after 30 seconds.

Each batch performs presence/expiry maintenance and discovers ready results.
Only complete evidence or server-confirmed interrupted abandonment is queued.
Incomplete racing Cups are not repeatedly downloaded. Complete durable evidence
survives worker downtime instead of expiring after 30 minutes.

Each job is claimed with `FOR UPDATE SKIP LOCKED` inside a pinned database
transaction. There is no separately committed in-progress flag or fragile lease.
Job completion, validation, rating events, model state, match completion and claim
release commit together. A crash releases the lock and rolls back any partial
updates. A lost COMMIT response is safe: the next run sees either a completed job
or the original unprocessed job. Existing `(match_id, player_id)` rating-event
uniqueness remains the final duplicate guard.

A savepoint isolates ordinary per-match failures. It rolls back all settlement
writes and records a retry with delays of 15, 30, 60, 120, 240, 480, then 900
seconds. Retries continue at that cap; failures never erase an abandonment loss
or hold up the rest of a batch. Invalid/conflicting complete evidence resolves
unrated through the validator; operational/model-state errors remain retryable.

The worker respects the existing 120-second reconnect grace and witness rules.
Confirmed host abandonment penalizes the host only. Innocent guests receive no
rating event. A nonhost who abandons a completed Cup is placed last, with their
rating calculated as a loss. Shared backend outages are not interpreted as mass
abandonment. This job does not create a verdict where the server has no reliable
abandonment evidence.

## Build and run

Node 22 or later:

```text
cd supabase/worker
npm ci
npm run build
npm start
```

The worker exits disabled unless `POLYCUP_RESULT_WORKER_ENABLED=1`. It needs
`POLYCUP_RESULT_DATABASE_URL`, injected by a backend secret store. No service key,
database password or worker endpoint belongs in the game or its distribution.
There is no public HTTP endpoint to protect or invoke.

Production connections require verified TLS. An optional
`POLYCUP_RESULT_CA_FILE` supplies the database CA; verification is never disabled.
SSL query parameters in the URL are rejected so they cannot override the secure
driver configuration. `POLYCUP_RESULT_LOCAL_TEST=1` permits plain connections only
to loopback and is strictly for disposable local databases.

Use a direct Supabase database connection, or the session pooler when the runtime
requires IPv4. Transactions use one checked-out connection; there are no named
prepared statements or session advisory locks. Connection guidance:
[Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[node-postgres transactions](https://node-postgres.com/features/transactions).

## Deployment steps (not performed)

1. Apply migrations through `20261023010000_ranked_result_worker.sql` in order.
   It creates a **NOLOGIN** capability role, `polycup_result_worker`, and private
   job records. It does not create credentials or enable ranked.
2. Provision a separate backend-only LOGIN role with no superuser, database/role
   creation, or RLS-bypass permissions. Grant it `polycup_result_worker` and
   database CONNECT permission. Use this login in the secret connection URL.
   Do not grant the worker role to `authenticator`, `anon`, `authenticated`, or
   `service_role`. Every worker transaction explicitly switches to the restricted
   role. The role can settle ratings, but cannot read auth records or change
   ranked configuration.
3. Install the built job and production dependencies in the chosen Node runtime.
   Schedule `node dist/main.mjs` once per minute, or supervise
   `node dist/main.mjs --loop` for faster processing. The executable and pg
   dependencies live together under `supabase/worker`; do not copy only the
   bundle. Overlapping invocations are safe. No hosting provider or paid runtime
   is provisioned by this implementation.
4. Check TLS and the actual hosted login's grants, then exercise settlement on a
   nonproduction database with the same configuration. Local PostgreSQL tests
   do not verify Supabase pooler/network configuration or hosted permissions.
5. Configure the scheduler/supervisor to alert on missing heartbeats, nonzero
   one-shot exits, `ranked_result_batch_failed`, or `attention > 0`. Keep ranked
   disabled until hosted integration and the separate launch checks pass.

The log emits aggregate counts and SQLSTATE codes, never transcripts, player
identifiers, connection URLs or database error messages. Loop mode emits at most
one idle health summary per minute. `backlog` counts discovered unfinished jobs;
`attention` counts jobs with five failures or age over ten minutes. The one-shot
process exits nonzero on errors or attention. Pending jobs are retained until
recovery; finished receipts remain for audit.

An operator may inspect `match_id`, `attempts`, `next_attempt_at`, `outcome` and
`last_error_code` in `polycup_ranked_result_jobs` using an authorized backend
connection. Repair the cause before retrying. For an immediate retry, move only
the affected unfinished job's `next_attempt_at` to `now()`. Never delete rating
events, reset ratings, or clear finished job receipts to retry a settlement.

## Validation boundary

The validator recomputes draft/track order, rounds, finalist scoring and placements
from immutable account-attested transcripts. It is not native replay verification:
colluding modified clients can still fabricate matching race observations. Moving
the processor to a backend does not remove that limitation.

## Tests

From the project root, after installing worker dependencies:

```text
node --import tsx --test supabase/tests/ranked-worker.test.mjs supabase/worker/config.test.mjs
node --import tsx --test --test-concurrency=1 supabase/tests/*.test.mjs
```

The default suite uses PGlite. For actual connection concurrency, commit/rollback
and executable tests, use an **empty disposable local PostgreSQL database** named
`polycup_worker_test` and set `POLYCUP_WORKER_TEST_DATABASE_URL` to its loopback
owner connection. The suite creates its own roles and migrations; it refuses
non-loopback addresses and any other database name. Recreate the disposable
database/cluster before another run. The test-only owner connection must never
be used as the deployed worker login.

The real PostgreSQL suite also tests a restricted `worker_login`, simultaneous
workers, locking/recovery, injected SQL failures, capped retry backoff, interrupted
host losses, guest preservation, lost COMMIT acknowledgement and termination of
the executable's connection in the middle of rating inserts. A fresh executable
must recover and still produce exactly one event per eligible player.

`supabase/tests/waiting-room-api.mjs` now uses the same processor with the restricted
role for packaged-client QA. Its synthetic authentication and `/test/*` controls
remain local-only and must never be deployed.

## Local acceptance, 2026-10-23

- Worker build and dedicated TypeScript check passed.
- Real PostgreSQL 16 worker suite: 16 passed, zero skipped.
- Full SQL suite: 104 passed, three PostgreSQL-only cases skipped in PGlite; all
  three ran successfully in the real database suite above.
- Worker configuration/log-redaction checks: two passed.
- Application regression suite: 288 passed.
- Packaged-client integration: 15 real native rounds through the durable job
  processor with local PGlite and local signalling/actual WebRTC. Guest closed
  before settlement, reopened to -279 once, then no repeat after another reopen
  or fresh profile. Lost acknowledgement retried; exactly two rating events
  remained after repeated processing. Evidence: `../../output/playwright/ranked-offline-result/verification.json`.

Fault-injection and abandonment verdicts were exercised against real local
PostgreSQL, including actual backend connection termination during a rating
insert. Network loss of the COMMIT reply was simulated at the adapter boundary.
Hosted Supabase connectivity/TLS, scheduled hosting and cross-network races were
not part of this local acceptance. Temporary test services were stopped afterward.
