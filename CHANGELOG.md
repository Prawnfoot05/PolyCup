# PolyCup releases

## 0.7.1 - 2026-11-17

- Flying and double-tap standing respawns now work in ranked and casual races as well as solo Practice. Use R or your checkpoint-reset binding.
- Clean runs keep native personal bests and official leaderboard uploads; using a respawn disables them for that attempt, and a fresh run restores eligibility.
- Ranked replays preserve the complete elapsed run, failed attempts and both respawn types while retaining older replay support.
- Reset the chase camera after start-line recovery and preserve cockpit view and car visibility after respawns.

## 0.7.0 - 2026-11-16

- Flying checkpoint respawns in solo Practice on official, community and imported tracks: tap once for flying recovery, twice for a standing reset.
- Run estimate shows your surviving run time and checkpoint splits against the selected record, with a rear camera and translucent car during recovery.
- Full local replays retain failed attempts and both respawn types; native Watch, save and load are supported.
- Clean practice runs keep normal PolyTrack leaderboard submission. Attempts using a respawn stay local and cannot replace native personal bests.

- Vote between three random ranked tracks after everyone accepts. Each vote is one lottery ticket; account portraits show votes, and split votes reveal the chosen track with an animated highlight and check stamp.
- Live race standings show each racer's checkpoint progress alongside their name.

## 0.6.10 - 2026-11-16

- Bigger rewards for genuine ranked upsets, with an underdog payout multiplier up to 2.5x. The favourite's loss formula and existing rating caps stay unchanged.
- Withdrawal wins preserve existing win streaks; verified finished wins still extend them, including against opponents who DNF or leave.
- Wait for a recent clock-sync reply and rendered game frames before race readiness, reducing unfair late starts.
- Recover delayed ranked finishes through the authenticated HTTP path, prioritise current finish uploads, and seal input evidence at the finish crossing.
- Keep the driving-time cutoff fixed while allowing a bounded confirmation phase for delayed finish delivery.

## 0.6.9 - 2026-11-16

- Ranked personal bests now save and submit through the native PolyTrack leaderboard path, with official replay validation and no delay to match results.

## 0.6.8 - 2026-11-15

- Improve phone keyboard activation in postgame chat with a direct request during a trusted tap.
- Keep chat editable during slow sends and preserve newer drafts when a send completes.

- Faster official PolyTrack placement comparisons with shared caching and a top-10,000 cutoff; ties retain their exact placement.
- Restore loading-screen match chat and recover from temporary chat access failures, with improved mobile composer gestures.
- Stabilize fitted profile titles during refreshes and resizing.
- Improve mobile race transitions and starts: clear stale race overlays and garage editors, release held controls at GO, and preserve native drawing if a PolyCup frame hook fails.
- Show finish times and gaps in friendly 1v1 results so close races can be compared after the finish.

## 0.6.7 - 2026-11-14

- Restore ranked multiplayer compatibility across patch releases and prevent cancelled loading attempts from reopening.

## 0.6.6 - 2026-11-14

- Season 1 launch polish: remove the expired Season 0 countdown panel from the hub.
- Restore the Mythic achievement tiers in the release reward catalogue.
- Season reward badges show the player's final seasonal leaderboard position.
- More reliable official PolyTrack placements, including million-entry leaderboards and automatic retries after temporary lookup failures.
- Keep leaderboard row highlights contained on Safari.

## 0.6.5 - 2026-11-14

- Season 1: fresh placements and revised ratings that separate skill estimates from visible progression, making isolated losses less punishing without penalizing repeat opponents. DNFs cannot gain rating.
- A community-voted 30-track ranked pool: 15 Fullspeed and 15 Tech tracks, with 20 seconds to finish after the first racer.
- Season 0 remains viewable through season selectors, with permanent rank badges revealed on your next hub visit. XP and existing unlocks carry over.
- Expanded profile statistics, official verified PolyTrack placement comparisons beside ranked times, and smoother chat, connections, retirement/spectating and casual/friendly match transitions.

## 0.6.4 - 2026-11-13

- Added a Season 1 countdown to the Browser hub.
- Added Mythic achievement badges for long-term ranked wins, Fullspeed/Tech wins and win streaks.

### 0.6.3 server hotfix - 2026-11-11

- Fixed ranked result delivery getting stuck on older unread matches. Ratings continue to settle normally; confirmation now follows the current match, including for older clients.

## 0.6.3 - 2026-11-10

- Replies in DMs and community chat, plus in-game chat carried into postgame.
- New level-reward profile banners and a top-three track record showcase.
- Cleaner, more consistent profiles, leaderboards and player presentation.
- More reliable match transitions and result delivery, with a 45-second loading timeout.
- In-game patch notes with release history, available from the hub.

## 0.6.2 - 2026-11-09

- Finish times in ranked match histories, including your time in the list and every racer's time in individual results.
- Separate page arrows and previous/next-track navigation on track leaderboards.
- Consistent rectangular track controls, square player avatars and a cleaner individual match header.
- The PolyCup boot P is now the site's favicon, with SVG and PNG support.
- Compatibility fallback for older browser engines missing `checkVisibility`, fixing repeated menu and queue-control errors.
- Bounded error reporting, graphics-context failure/restoration diagnostics and active-match frame timing for investigating crashes and slow gameplay.

## 0.6.1

- Friendly 1v1 challenges from online friends, delivered as actionable DM invitations. Player-hosted, one random track, one round, no warmup, with no ranked progression or dedicated-host usage.
- Saved casual results under a Ranked/Casual switch in match history, retaining departed racers and verified reconnect identities.
- A sortable Level column on the player leaderboard.
- Ranked rounds can end as soon as everyone remaining is done after a departure. Automatic spectating chooses the leading unfinished racer.
- Hide UI remains available after finishing; repeated postgame requeue/cancel no longer duplicates level chips.
- Postgame track records preserve results and queue state, and yield to a new match offer.
- The legendary win-streak medal requires 15 consecutive wins.
- Restored the main-menu disclaimer beneath the logo and made DM invitation actions rectangular.

Casual history starts with this release; earlier casual results were not stored.
