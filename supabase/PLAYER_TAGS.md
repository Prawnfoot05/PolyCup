# Player tags for 0.4

The first deterministic policy is implemented in `functions/_shared/player-tags.ts`.
It is intentionally not connected to client-reported results or published as an
endpoint yet: authenticated identity does not make match evidence trustworthy.
The match validation service must supply complete recent history and lifetime count.

Display at most three tags in a player's profile, with the explanation available on
hover, focus, and tap. Use a muted gold treatment for activity and green for positive
performance. Do not infer emotion, cheating, smurfing, or personality from results.

| Tag | Rule |
| --- | --- |
| Fresh wheels | Fewer than five completed Cups. |
| Waking up | Current Cup is the first after an eight-hour break. |
| Back on track | Current Cup is the first after a week away; replaces Waking up. |
| On a roll | Won the latest three completed Cups. |
| Consistent | Finished 95% of rounds across at least 10 Cups and 50 rounds. |
| Podium regular | Top three in 60% of at least 10 Cups with four or more racers. |
| Fast starter | Won the first round in 40% of at least 10 Cups with four or more racers. |

Performance uses the latest 20 completed, validated Cups. Activity uses server
timestamps and the active Cup, not the player's local clock or midnight. Activity
labels reveal no exact last-active timestamp. Account age is not skill: Fresh wheels
describes experience on this account only. Tags never change rating. A short history
must never be treated as proof of consistency or specialist skill.

Next integration: trusted match result ingestion, complete server history queries,
server-side tag derivation, then profile/friends/lobby display. Track specialist and
late-round comeback tags require additional per-track/per-round evidence and are
deliberately not guessed from overall placements.
