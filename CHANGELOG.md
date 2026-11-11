# PolyCup releases

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
