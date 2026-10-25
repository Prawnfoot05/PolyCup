# Publishing PolyCup 0.4.0

Build and verify a candidate before changing public delivery. The client version is repeated in mod.json, package.json/package-lock.json, src/cup.ts and supabase/ranked-launch-config.json. The build checks the package/mod/protocol versions. The queue accepts one exact client version.

## Candidate

1. Run npm ci, npm test, npm run typecheck and npm run format:check.
2. Run npm run build:release. This writes output/release-candidate/dist without changing the stable manifest.
3. Test the final bundle in isolated fresh and upgraded native profiles, then test normal-client queue/accept/draft/native handoff with a controlled backend gate. Restore the original gate and remove only the identified QA data afterward.
4. Prepare a clean publication checkout from current origin/main. Copy reviewed source and only the new dist/0.4.0 folder plus manifest.json/polylib.json. Do not modify old release folders. Build from a clean install and compare the final bundle SHA-256.
5. Exclude output, .research, node_modules, credentials, Supabase .temp, generated input-review reference corpus and generated shared input-review.mjs. Those backend artifacts must be regenerated privately before a backend deployment. Optional browser harnesses require their documented local prerequisites.

## Publication

- Confirm the publication branch is still based on current origin/main. Review the complete staged change and verify the candidate hash.
- Ensure no queue seats or active ranked matches remain. Pause new queue entry by setting polycup_queue_config.enabled=false during cutover; keep result and input-review processing enabled.
- Publish the reviewed commit and immutable 0.4.0 files. Verify the public version.json and main.mod.js bytes through the actual delivery URL, and verify the latest manifest advertises 0.4.0. The CDN may cache the old latest manifest; explicit 0.4.0 selection must resolve to the tested bytes.
- Run supabase/release/activate-0.4.0.sql only after that verification. It refuses an unexpected version or active queue/matches. It enables the queue for exactly 0.4.0; it does not change rank thresholds, the catalog or existing results.
- Smoke-test installation through the public URL and queue entry with 0.4.0. Check that old versions receive the update prompt. Do not announce ranked availability before this passes.

The auth return page lives on the separate gh-pages branch and the two backend workers are already deployed. A client publication does not require republishing them. Never publish an operator working directory or a test profile.

## Rollback

Disable new ranked queue entry first if a release fault appears. Allow existing result and input-review work to finish. Do not delete matches, reverse ratings or revert database migrations as a client rollback.

If necessary, restore the stable distribution manifest/library metadata to the preceding release in a new commit; preserve the immutable 0.4.0 folder for diagnostics. Leave ranked unavailable to older clients unless their compatibility with the current backend has been separately verified. Repair the issue in a new patch version, repeat the checks and coordinate its version gate.

## Known scope

Races remain peer-hosted. A closed host race cannot be reconstructed; abandonment/result processing handles that limitation. Input comparisons are advisory copied-input evidence, not authoritative anti-cheat. Automated native Cup completion is not a human playtest. PML v0.6.3-1 can show its own outdated-loader notice at boot; do not suppress it or treat it as a PolyCup failure.
