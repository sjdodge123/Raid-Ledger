# ROK-1499 layer 3 — Handover (dev-1499-L3)

Branch `feat/rok-1499-room-recap`. Working tree clean, everything committed, **not pushed**.
Layer 3 is COMPLETE as far as it can be verified on the laptop: the integration specs were
written and typechecked but **never executed** — they need a real DB, which is the Lead's
fleet run. The migration was not touched.

## Files touched

| File | State |
|---|---|
| `api/src/discord-bot/services/channel-presence-occupancy.integration.spec.ts` | NEW — ledger SQL + hydrate + cascade (6 cases) |
| `api/src/discord-bot/services/channel-presence-recap-room.integration.spec.ts` | NEW — `flushChannel` end to end via the D12 seam (2 cases) |
| `tools/test-bot/src/smoke/tests/voice-activity.test.ts` | `assertRecapRender` now pins `/\d+ in voice/` on the lead description |

Commits: `cf389770` (cluster A), `c299a09d` (cluster B).

## What the Lead must run on the fleet

```
npm run test:integration -w api -- channel-presence-occupancy.integration channel-presence-recap-room.integration
```
or just let `validate-ci.sh --full` pick them up (`*.integration.spec.ts`, `maxWorkers: 1`).
**These two files have never been run.** Everything below is a prediction from reading the
source, not an observation — treat a first-run failure as a spec bug, not a product bug,
until the message says otherwise.

### Spec 1 — `channel-presence-occupancy.integration.spec.ts`

Real DB only; no module mocking (no other `*.integration.spec.ts` in this repo uses
`jest.mock`, so neither does this one).

1. `reconcileOccupancy` opens one stay per present member on the first call.
2. A second call with one member gone stamps only that row's `left_at`; the other stays open.
3. A rejoin opens a NEW row — two rows for that user, one closed, one open (the design's
   "one row per continuous STAY" rule, asserted against the real partial predicate).
4. `closeAllOccupancy` stamps every OPEN stay at the given instant and a second call is a
   no-op — the regression guard for "every stay collapses to zero" if the `left_at IS NULL`
   predicate is ever dropped.
5. `hydrateRoomRecap` over two members (one mapped game whose session STARTED BEFORE the room
   opened, one unmapped `discord_activity_name`) → `spanMs` 120m, both members clipped to
   90m, activities named `Deep Rock Galactic` / `Slay the Spire II`. This is the only place
   the `game_activity_sessions → users → games` join and the overlap predicate are exercised
   against real SQL.
6. Cascade: deleting the presence row removes its stays (proves the FK in `0185` really
   carries ON DELETE CASCADE, not just the TypeScript schema).

### Spec 2 — `channel-presence-recap-room.integration.spec.ts`

Drives `flushChannel` with the D12 `override` snapshot and a fake Discord client that records
payloads. Real DB, real grouping, real persistence, real render; the four edge services
(`clientService`, `channelBindingsService`, `settingsService`, `channelResolver`) and the
client are the only fakes. Split from spec 1 purely for the 300-line cap.

1. Live flush → presence row opened, one `send`, two OPEN occupancy rows. Then an empty flush
   at +45m → every stay closed at `empty_since` (asserted as the 45-minute DIFFERENCE from the
   stored `joined_at`), and the edited lead embed's description matches `/^2 in voice ·/`.
2. A second empty flush inside the grace produces NO second edit and a byte-identical recap
   (S-5). This holds only because `buildRecapEmbeds` uses `now` solely as the `clampTo`
   fallback and for per-SESSION embeds, and this fixture has no ad-hoc events — if someone
   later makes the recap lead read the clock, this is the test that will say so.

## Assertions I could NOT verify locally

- **Neither integration spec has been executed.** No DB on this lane.
- **The smoke assertion.** `tools/test-bot` has no `node_modules` in this worktree, and the
  brief forbade running the smoke suite. `npm run lint:no-sleep` passes (it is a shell grep).
  `npx tsc -p tools/test-bot/tsconfig.json` reports ONE error —
  `src/helpers/voice.ts(6,8): Cannot find module '@discordjs/voice'` — which is the missing
  install, not a repo failure, and is untouched by this branch. Zero errors in
  `voice-activity.test.ts`. Nothing filed to TECH-DEBT for it (an un-installed worktree is an
  environment artefact, not a pre-existing failure).

## Time-zone rule these specs follow (do not "simplify" it away)

`timestamp` columns carry no zone and nothing pins `TZ` in the api test env, so a stored
instant round-trips shifted by the local offset. Every fixture instant is therefore derived
from the presence row's `opened_at` **after** it comes back from the database, and every
assertion is a DIFFERENCE between two stored instants. An absolute
`expect(leftAt).toEqual(new Date('...'))` would pass on a UTC fleet runner and fail on a
laptop in CEST. If one of these ever gets "tidied" into an absolute comparison, that is why
it starts flaking by machine.

## Known lint warnings (pre-accepted, not errors)

`max-lines-per-function` warns on the three top-level `describe` arrows (157 / 61 / 86 lines,
cap 60). Every `describe` with a shared `beforeEach` trips this; splitting them would mean
duplicating the fixture setup across files. `max-lines-per-function` is `warn`, both files are
well under the 750-line test-file cap, and `npx eslint` reports **0 errors**.

## Not done / out of scope by brief

Migration (untouched — `0185_new_excalibur.sql` is the Lead's), push, PR, any fleet call,
running the smoke suite, running the integration specs.
