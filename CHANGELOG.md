# PolyCup releases

## 0.6.5 - 2026-11-14

- Strengthened shared chat filtering across community, private messages and match chat, including obfuscated slurs.
- Prepared Season 1 end-of-season rank reward artwork.

- Season 1 preparation: revised ranked progression, the community-voted 30-track pool and season selectors for archived competitive statistics. Season 1 launches after the scheduled Season 0 drain.

- Full profile track-performance and opponent lists, with searchable, sortable ranked statistics and recorded times.
- Ranked connection recovery tolerates brief interruptions, reports reconnection clearly, and stops local driving when the connection has ended. Delayed finish delivery retains the original valid finish-time cutoff.
- Browser context menus no longer interrupt gameplay when using the Context Menu key as a driving control.
- Community mentions, clearer message replies and match chat during loading, with improved postgame typing and gameplay-message avatars.
- More reliable casual and friendly starts and round changes, with synchronized readiness and recovery from failed loading.
- Consistent full-row interactions and result alignment, reply notifications, and better replay retention for disconnected racers.

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
