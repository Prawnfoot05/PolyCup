# PolyCup 0.4.1 release notes

Release date: 2026-10-26. The deployment procedure below coordinates the client and seasonal backend.

## Ranked format

Season 0 freezes the 17 main tracks and 10 CT 0.6.3 tracks (27 total). The native bundled collection metadata identifies the CT group; older community collections are excluded. `supabase/catalogs/season-1.json` contains the exact IDs and digests. The reservation selects one track on the server. Accepting the match starts the connection flow without a ban/pick draft or a second ready gate. Connection retries and reconnects retain that track.

The opening warmup lasts 30 seconds and cannot be ended early by one racer. Scored rounds award 10/7/4/2 points; DNF awards zero. Reach 30 points and then win a round. Round breaks are three seconds. Every round remains on the selected track until the winner is decided. This targets a shorter match, not a guaranteed five-minute duration on long tracks.

Season activation preserves rating/model state, placements progress and lifetime history. Only players with rated activity in the current season receive a current leaderboard position or GM placement. Archived season standings derive from immutable rating events attributed to that season, retaining their final ratings after future rating changes. The leaderboard supports active and archived seasons, globally or among accepted friends.

## Menu and defaults

The finder header displays the number of signed-in accounts active within the last 90 seconds. Multiple sessions from one account count once. The client refreshes the aggregate at most every 30 seconds while the finder is open; no presence identities are exposed.

Leaderboard uploads default to on for new casual Cups and the seasonal ranked rules. Casual hosts can disable them. Explicit settings in saved/imported presets remain unchanged. Native leaderboard eligibility still applies. Automated test clients block external leaderboard traffic.

The full lobby is blurred and dimmed beneath a Loading overlay after the countdown, through native handoff. Failed starts reveal the lobby and recovery controls. Private/Public choices use explicit square check indicators instead of native radio controls distorted by shared input styling.

## Fixes and compatibility audit

- Live ranked chat uses server ticket-bound account identities instead of the skipped casual reconnect handshake. Unbound peers remain blocked; reconnects retain chat identity and duplicate protection.
- Finish submission, settlement receipt and input-review metadata use the native finish-crossing time instead of the later simulation clock.
- Ranked lobby members publish their garage name, country and car style, while account IDs remain authoritative for ratings and membership. Account avatars remain outside Cup gameplay.
- The ranked lobby shows the selected track and connection state without stale ban/pick controls or a second ready button. Connection failures have a retry action.
- The host leave warning explains that the hosted race cannot be restored. Guest reconnect wording retains the two-minute grace.
- Ranked chat hides the casual host-mute menu consistently before and during racing.
- Fixed client snapshot validation for single-track matches beyond the first round; the old rotating-track boundary rejected subsequent valid standings.
- The menu can resolve the native track library directly when returning with a saved profile, without requiring the ordinary track selector to open first.
- Old casual preset imports without the new optional single-track field remain valid. Existing 0.4 draft matches retain their captured rules and remain settleable by the updated worker.

## Deployment sequence

1. Apply `20261026000000_ranked_seasons.sql`, `20261026010000_ranked_single_track_session.sql`, `20261026020000_ranked_season_standings.sql`, `20261026030000_ranked_active_season_ranks.sql`, and `20261026040000_online_player_count.sql`. Season 0 is inserted inactive; these migrations do not switch the production queue.
2. Build/deploy the updated result-processing Edge Function. It validates both the legacy draft format and the seasonal single-track format. No input-review processor change is needed for the subset of the existing corpus.
3. Prepare/publish the reviewed 0.4.1 distribution and verify the CDN bytes; update the PML library's independent latest mapping as well as the hosted manifest.
4. Pause new ranked entry, let queued/active/unsettled matches drain, then run `supabase/release/activate-0.4.1.sql`. It refuses a cutover with outstanding queue seats or matches. Do not remove live matches to bypass this gate.
5. Verify ordinary-client queue, acceptance, warmup, race and settlement against the hosted backend. None of the local synthetic-account tests establishes hosted deployment readiness by itself.

Future seasons use a new season row and the same guarded activation endpoint. Started season pool/rules cannot be edited. Host migration and authoritative physics validation remain outside this release.

## Local verification

- 323 application tests passed; TypeScript and formatting checks passed.
- 134 database tests: 131 passed, 3 environment-dependent tests skipped, no failures. Seasonal tests cover random-track reservation stability, fixed rules, garage ownership, connection retries, duplicate settlement, season archives and online-count privacy/deduplication.
- Two actual packaged Electron clients completed the new ranked flow through native WebRTC and native physics. The guest was closed and reopened during warmup, rebound to its account and finished subsequent rounds. Both clients received rating results; a deliberately lost result response was retried, and repeated settlement produced exactly two rating events. Ratings and match history survived reopening.
- Native QA used an isolated migrated local database, synthetic accounts, local signalling and 16 generated straight test tracks. External game-server traffic was blocked. This verifies flow and recovery, not five-minute pacing on the real 27-track pool or hosted deployment readiness.
- Client screenshots verify the online indicator, corrected Private/Public controls, loading overlay, garage identities/chat, and both rating results. Evidence: `output/playwright/ranked-season-041/verification.json` and `settlement.json`.
