# Supabase-hosted result processing

Deployed to the existing `polycup-dev` Supabase project on 2026-10-23.
The 0.4 mod remains local, and public ranked matchmaking remains disabled.
The deployed worker uses a restricted login, verified pooler TLS, Vault-backed
request signatures, and conditional Cron dispatch.

## Architecture

The last required transcript schedules a signed Edge request immediately, after
its database transaction commits. Incomplete evidence and rolled-back submissions
do not invoke Edge. After a batch commits, the worker acknowledges that dispatch's
nonce and schedules the next due Cup immediately. This drains simultaneous Cup
results without imposing a 30-second pause between successful settlements.

Supabase Cron calls `public.polycup_ranked_dispatch_tick()` every 30 seconds as a
fallback for missed wake-ups, retry deadlines, stale invocations, and abandonment
maintenance. Idle ticks return without an HTTP request or Edge invocation. Racing
Cups without complete evidence are not sent to Edge.

When work is due, `pg_net` calls `polycup-results`. The dedicated 32-byte token is
read from Vault and used to sign a timestamp and random nonce with HMAC-SHA256.
Only `x-polycup-time`, `x-polycup-nonce` and `x-polycup-signature` are sent. The
reusable secret never enters the extension-owned HTTP queue. Signatures expire
after 90 seconds, with ten seconds of future-clock tolerance. An outstanding request blocks
redispatch for up to 90 seconds. Failed/expired HTTP requests back off from 30
seconds to 15 minutes; a successful response resets that transport backoff. The
result jobs independently retain their existing per-match retry schedule. SQL
row locks and atomic job/rating commits protect against duplicate settlement even
if a timed-out invocation is still finishing when another invocation arrives.

The Edge handler authenticates before connecting to Postgres. User JWTs, anon
keys and publishable keys are insufficient. `verify_jwt = false` in config.toml
allows the internal request through the gateway; the handler's signature
check is mandatory and must not be removed. Missing configuration fails closed.
The request body is ignored: callers cannot choose matches, ratings or batch size.

Each invocation processes **up to four Cups**, with an eight-second budget for
starting work and a 2,000-finish-observation budget (rounds times roster size).
The cost is checked under the actual job lock before settlement. An oversized
first job runs alone so it can still make progress; remaining jobs stay durable
for the next immediately dispatched batch. Each Cup has its own transaction and
retry receipt, so a failed Cup does not roll back other Cups in the batch.
In-flight transactions may finish after the wall budget. Resource tests enforce
the Free-plan 2-second CPU limit, including 1,000-round two-player transcripts and
a 600-round four-player transcript within the existing 250 KB submission cap.
Four maximum-size transcripts in a single invocation exceeded the resource limit;
the work-size budget prevents that combination. Wall-clock database I/O is a
different limit. Jobs remain durable if the runtime terminates.
The connection adapter uses the same restricted `polycup_result_worker` role as
the Node job. Verified TLS is mandatory for remote database connections.

Only the restricted worker role can acknowledge a dispatch. A stale nonce cannot
clear a newer invocation. Acknowledgement happens after result transactions commit;
if it fails or the process dies, Cron recovers the request and durable job.

The deployment module in `functions/_shared/ranked-worker.mjs` is generated from
the shared worker, validator, forfeit and Cup-rule sources. It is not a second
hand-maintained settlement implementation. Rebuild it whenever those sources
change. The Node executable remains useful for local tests/manual backend work.

## Build and local verification

From the project root:

```text
npm ci --prefix supabase/worker
npm run build:edge --prefix supabase/worker
node --import tsx --test supabase/tests/ranked-edge-schedule.test.mjs supabase/worker/edge-handler.test.mjs
node supabase/worker/tests/run-edge-qa.mjs
```

The last command requires Docker and free loopback ports 55439 and 8831. It builds
the current module, creates disposable Supabase Postgres 17.6.1.136 and Edge
Runtime v1.77.4 containers pinned by digest, then removes those containers and its
temporary token file. It stages only function code and the QA supervisor, not
the workspace or credentials. The user worker is limited to 256 MB, 2,000 ms CPU
and 150 seconds wall time. The supervisor is test-only and is never deployed.

The fixture uses synthetic auth and loopback-only trust connections. Its owner
temporarily permits a local HTTP destination; the production schema only permits
an HTTPS `https://<project-ref>.supabase.co/functions/v1/polycup-results` URL.
These fixture changes must never be applied to a hosted project. Evidence is
written to `output/edge-runtime-tests.log` and `output/edge-runtime-verification.json`.

## Deployment sequence

1. Apply the ordinary migrations in order, through
   `20261023050000_ranked_static_snapshot.sql`. The preceding result-worker and
   notification migrations are also required. The dispatch row starts disabled;
   no extension or schedule is installed by this migration.
2. Provision the restricted backend LOGIN described in `README.md`. Set its
   password privately, grant it database CONNECT and `polycup_result_worker`
   membership, and use its Supabase pooler connection URL. Do not use a public
   project key or put a database credential in the mod. The adapter pins each
   transaction to one connection and uses no session locks or named prepares.
3. Generate one cryptographically random 32-byte token, encoded as 64 lowercase
   hex characters. Store the same value in a Vault secret named
   `polycup_result_cron_token` and the Edge secret `POLYCUP_RESULT_CRON_TOKEN`.
   Configure the other Edge secrets:

   - `POLYCUP_RESULT_WORKER_ENABLED=1`
   - `POLYCUP_RESULT_DATABASE_URL`: the restricted login's connection URL, with
     no `ssl*` query overrides; URL-encode password characters as needed.
   - `POLYCUP_RESULT_CA_PEM`: optional trusted database CA contents if required.

   Do not configure `POLYCUP_RESULT_LOCAL_TEST` on the hosted function. Do not put
   secrets into SQL files, Cron commands, shell history, screenshots, or Git.
   Use the Supabase secret/Vault UI or a private environment file for provisioning.
4. Deploy only `polycup-results`, using `supabase/config.toml` and the generated
   module. Do not deploy any test fixture or publish the 0.4 mod. Before scheduling,
   verify that a request with no valid signature gets 401 and an internally signed
   request succeeds using the hosted TLS connection and restricted grants. A smoke
   request must be signed with the same timestamp/nonce format as the dispatcher.
5. Apply `worker/install-edge-cron.sql`. It installs Cron, pg_net, pgcrypto and Vault if
   needed and creates two named jobs.
   The installer is idempotent and the dispatch row is still disabled. The tested pg_net version grants PUBLIC reads
   on its extension-owned queue; the normal project role cannot reliably revoke
   those grants. Short-lived signatures avoid exposing a reusable credential.
   Replaying a signed call within its short window can only run the bounded job
   processor again; transaction locks and receipts still prevent duplicate awards.
6. As the database operator, set `polycup_ranked_dispatch.function_url` to the
   project's HTTPS endpoint. Enable dispatch only after the function/secret check:

   ```sql
   update public.polycup_ranked_dispatch
   set enabled=true, next_dispatch_at=now()
   where singleton;
   ```

7. Verify a finished test Cup traverses Cron → pg_net → Edge → settlement and that
   subsequent idle checks do not increase Edge invocations. Inspect retry handling
   and a confirmed abandonment before enabling ranked for ordinary users.

To pause processing, set `enabled=false` and deactivate `polycup-result-dispatch`
in Cron. An invocation already in flight may finish safely. Job records and rating
events are retained. For token rotation, pause dispatch, update Vault and the Edge
secret together, verify authentication, then resume. Never reset rating events to
retry an operation.

## Operations and free-tier behavior

At the fallback cadence there are up to 86,400 scheduled checks in 30 days; idle
checks do not invoke Edge. Normal results wake processing immediately and ready
work continues in bounded batches of up to four Cups per invocation. The previous two-Cups-per-minute Cron-only
throughput limit no longer applies. Actual capacity is still bounded by database
work, request duration, and platform quotas, and needs a load test before claims
about large concurrent populations. Invocation volume follows completed Cups and
retries rather than per-frame racing traffic.

The private dispatch row records check/success timestamps, last HTTP status,
failure count, outstanding request ID and backoff time. Jobs record durable
attempt counts and SQLSTATE codes. Neither contains the token or raw HTTP error
bodies. The Edge response/log contains aggregate counts only. For per-job failure
inspection and retry semantics see `README.md`.

Alert on overdue checks, persistent HTTP failures, old due jobs or `attention>0`.
The function's 200 response acknowledges a completed batch, not that every match
was settled: individual job failures remain queued with their own backoff. Fatal
connection/configuration errors return 503. Investigate any persistent 401 as a
token mismatch, rather than rapidly reinvoking the function.

The installer removes only our two jobs' Cron history older than seven days.
It does not remove other jobs' history, player history, rating events, notification
receipts or transcripts. Raw transcript retention remains a separate decision.

## References and remaining boundary

- [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Custom handler authentication](https://supabase.com/docs/guides/functions/auth)
- [Cron history cleanup](https://supabase.com/docs/guides/cron/quickstart)

Local tests exercise the real runtime and extensions. The hosted deployment
additionally verifies the public gateway, restricted-role TLS, and Cron dispatch.
These checks do not establish sustained-load capacity or future usage quotas. Result validation is still account-attested transcript validation; this
does not add native replay anti-cheat verification or a dedicated racing host.

## Local acceptance (2026-10-23)

The signed-call path passed nine actual Supabase container checks, including
normal and 1,000-round evidence within the enforced Free-plan CPU/memory limits,
rollback after rating writes, duplicate calls, host and nonhost abandonment,
idempotent extension/schedule installation, zero calls when idle, and real HTTP
401 backoff followed by recovery after a Vault secret correction. The unit tests
also reject expired signatures, future timestamps and modified nonces.

Real extensions were used for Cron, pg_net, pgcrypto and Vault. The fixture used
loopback HTTP, so hosted gateway and TLS verification remain deployment checks.

## Hosted compatibility

The shared pooler requires the Supabase Root 2021 CA in `POLYCUP_RESULT_CA_PEM`;
certificate and hostname verification remain enabled. The certificate is public,
while the database password and Cron signing token are backend secrets.

Hosted PostgREST enables `safeupdate`. Migration `20261023030000` adds an explicit
predicate to the intentional disabled-queue cleanup so queue polling can recover
reserved matches without disabling this protection. The Supabase-container suite
loads the actual library and tests both rejection of an unqualified DELETE and
successful authenticated polling while ranked is disabled.

## Hosted immediate dispatch verification (2026-10-23)

With the live Cron dispatcher temporarily paused, two isolated backend fixture
Cups settled in about one second overall. Their database timestamps measured
314.695 ms and 200.403 ms from the final transcript to settlement. Fixtures used
remapped transcripts from the earlier real native races; this timing check did
not repeat native driving. Duplicate submissions still produced only four rating
events. Cron was restored afterward. See `output/live-results/immediate-verification.json`.

The SQL tests cover deferred-commit dispatch, incomplete evidence, rollback,
continuation, stale acknowledgements, and client-role denial. Docker Desktop did
not start successfully after the laptop reboot, so the new continuation case has
not yet been rerun in the local container suite. It has been tested against the
live hosted function, pg_net, Vault, and database instead.
