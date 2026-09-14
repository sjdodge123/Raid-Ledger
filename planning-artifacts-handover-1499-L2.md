# ROK-1499 layer 2 — Handover (dev-1499-L2)

Branch `feat/rok-1499-room-recap`. Working tree clean, everything committed, **not pushed**.
Layer 2 is COMPLETE and green. **No migration was generated** — see "What the Lead must do" below.

## Files touched

| File | State |
|---|---|
| `api/src/drizzle/schema/discord-channel-presence-occupancy.ts` | NEW — the table |
| `api/src/drizzle/schema.ts` | `export *` added next to the presence-messages line |
| `api/src/discord-bot/services/channel-presence-occupancy.helpers.ts` | NEW — `diffOccupancy` / `reconcileOccupancy` / `closeAllOccupancy` / `listOccupancy` |
| `api/src/discord-bot/services/channel-presence-occupancy.helpers.spec.ts` | NEW — 10 cases |
| `api/src/discord-bot/services/channel-presence-room-recap.hydrate.ts` | NEW — `loadRoomActivities` / `hydrateRoomRecap` |
| `api/src/discord-bot/services/channel-presence-room-recap.hydrate.spec.ts` | NEW — 7 cases |
| `api/src/discord-bot/services/channel-presence-flush.ts` | WIRED — `recordOccupancy` / `roomRecapFor`; `openMessage` now returns the row id it owns |
| `api/src/discord-bot/services/channel-presence-flush.occupancy.spec.ts` | NEW — 8 cases, the wiring |
| `api/src/discord-bot/services/channel-presence-room.helpers.ts` | `ResolvedRoom.members` (id → display name), filled from `source.names` |
| `api/src/discord-bot/services/channel-presence-embed.service.spec.ts` | occupancy + hydrate modules mocked; `room()` gains `members` |

Commits: `f9da7c84` (cluster A), `d6df9b84`-ish (cluster B), then cluster C/D. `git log --oneline -4`.

## Verification

- `npx jest src/discord-bot/services/channel-presence src/drizzle/constraint-name-length.spec.ts` —
  **12 suites / 185 tests pass**.
- `npx eslint` on every touched file — 0 errors. The only warnings left are the THREE
  pre-existing `max-lines-per-function` arrow warnings in `channel-presence-embed.service.spec.ts`
  (lines 324 / 486 / 806); they were there before this branch and I did not touch those describes.
- `npx tsc --noEmit -p api/tsconfig.json` **from the repo root** — 0 errors.
  (Running it with cwd inside `api/` prints ~48k bogus errors — layer 1's gotcha, still true.)

## Revert-checks (two, both real assertion failures — not vacuous)

1. Removed the `or(ended_at IS NULL, ended_at > opened_at)` half of the activity predicate:
   `Expected substring: "\"ended_at\" is null or" / Received: "... and \"game_activity_sessions\".\"ended_at\" is null"`.
2. Commented out BOTH `recordOccupancy(...)` in `flushLive` and `closeAllOccupancy(...)` in
   `flushEmpty`: `Expected: {}, "row-1", Map {"u1" => "Ada", …} / Number of calls: 0` and
   `Expected: {}, "row-1", 2026-09-13T20:00:00.000Z / Number of calls: 0`.
   Restored with `git checkout --` (files were committed first); 8/8 green again.

## Design notes the next layer should not re-litigate

- **One row per continuous STAY, not per human.** A re-join is a second row; `summariseRoom`
  merges them and the hydrate path de-duplicates the id list before querying activities. Do NOT
  pre-merge in SQL — the gap between two stays is real.
- **`diffOccupancy` keys on `discordUserId` only.** A mid-session rename must keep ONE stay.
- **Activity predicate is an OVERLAP**, not "started inside the window". The normal case is
  "launch the game, then join voice", so `started_at >= opened_at` would drop the evening's game.
- **`empty_since`, never `now`** is the span end everywhere (`closeAllOccupancy`, `hydrateRoomRecap`),
  for the same S-5 reason `RecapInput.endedAt` already has: a growing span moves the payload hash
  and re-edits the recap every five seconds for the whole grace window.
- **`ResolvedRoom.members` is optional on the interface but REQUIRED on `resolveRoom`'s return**
  (`ResolvedRoomFromSource`) — the same idiom `channelResolved` already uses, so hand-built spec
  rooms stay terse while the one real producer cannot omit it.
- `openMessage` / `recordOpenedMessage` now return `string | null`: the id of the row WE own, or
  `null` when another writer won the race. A lost race must NOT write occupancy — the winner's
  flush owns its ledger just as it owns its payload hash.

## What the Lead must do next

1. **Generate the migration** once PR #1203 has landed (it owns `0184`):
   `npm run db:generate -w api` → expect `0185_*.sql` creating `discord_channel_presence_occupancy`
   with the FK `channel_presence_occupancy_message_id_fk` (ON DELETE CASCADE) and the two indexes
   `idx_channel_presence_occupancy_msg` + the partial `idx_channel_presence_occupancy_open`.
   Then `./scripts/fix-migration-order.sh --check` and `./scripts/validate-migrations.sh`.
   The FK name is explicit because drizzle's default is 89 chars and Postgres truncates at 63;
   `constraint-name-length.spec.ts` already passes with it.
2. **Layer 3 — the smoke assertion.** In
   `tools/test-bot/src/smoke/tests/voice-activity.test.ts::assertRecapRender`, assert
   `/\d+ in voice/` on the lead embed's description once the D12 seam's members have been in the
   room. The seam works for free: `resolveRoom` fills `members` from `source.names`, which the
   snapshot path populates exactly as the Discord path does, so a snapshot-driven flush writes
   real occupancy rows.

## Not done / out of scope by brief

Migration, push, PR, fleet, any integration test against a real DB. `web` untouched.

## Review fixes

Applied against `planning-artifacts/review-ROK-1499.md` (SHIP WITH FIXES). All 8 findings closed.
Commit: `fix(discord-bot): ROK-1499 — review fixes`. Still **not pushed**, migration untouched.

| # | Fix |
|---|---|
| MAJOR 1 | `closeAllOccupancy` folded into `closeRow` itself (`channel-presence-store.helpers.ts`), so `empty` / `stale` / `unbound` / `missing` AND the reaper all stamp the stays. New 4th param `at: Date = new Date()`; the empty path passes `empty_since`. Idempotent behind the ladder's earlier stamp (`left_at IS NULL` predicate). Two new unit cases in the store spec. |
| MAJOR 2 | `ChannelFlush.roomRecaps` — an optional `Map<rowId, {endedAt, recap}>` owned by the SERVICE (`ChannelPresenceEmbedService.roomRecaps`), consulted by `roomRecapFor`, dropped the moment the row closes. |
| MINOR 3 | `closeUnbound` passes `room: null` when `empty_since` is null. The occupancy stamp still uses `now` there (the stays really did end); only the recap SPAN is withheld. |
| MINOR 4 | Cascade integration case gained a pre-DELETE `toHaveLength(1)`. |
| MINOR 5 | `MAX_SESSION_LOOKBACK_MS` (24 h) floor on `started_at` in `overlapsSpan`, + a unit case pinning the rendered bound and its param. |
| MINOR 6 | `recordOccupancy` warns and writes NOTHING when `room.members` is undefined, instead of reconciling an empty map (which would close every stay). |
| NIT 7 | `loadRoomActivities` filters null `discord_id` rows via a `hasDiscordId` type guard; `toSegment` now takes a non-null id. |
| NIT 8 | Integration activities are 90 min vs 60 min and asserted as whole objects, so name→duration is pinned. |

### Why MAJOR 2 is a memo and not "skip the publish"

The review offered either. Skipping the recap edit on later empty ticks would have regressed a
behaviour the service spec already pins — *"re-renders the recap when `onEventEnded` fires for the
binding"*: a session that completes during the grace must still fold into the card. So the render
runs every tick and only the READ is skipped. Reuse is sound for exactly the reason the review's
own "Verified (a)" gives: the stays are closed at `empty_since`, the span ends at `empty_since`, and
a game session that closes mid-grace clamps back — the value is provably constant for a given
`(row, empty_since)`. The memo is keyed on both, so a span that moves re-reads (pinned by a test).
State lives on the service, which already owns the dirty set; `flushChannel` stays a function of its
inputs, and a flush handed no map simply hydrates every time.

### Incidental refactor (not a review finding)

`channel-presence-flush.ts` crossed the 300-line ESLint cap once `closeIfDue` was extracted, so
`recordOccupancy` + `roomRecapFor` moved to a new `channel-presence-flush.occupancy.ts`. Behaviour
identical; the import of `ChannelFlush` back into it is type-only, so there is no runtime cycle.

### Verification after the fixes

- `npx jest src/discord-bot/services/channel-presence src/drizzle/constraint-name-length.spec.ts`
  — **12 suites / 192 tests pass** (was 185; +7 new cases).
- `npx tsc --noEmit -p api/tsconfig.json` from the repo root — **0 errors**.
- `npx eslint` across `src/discord-bot/services/` — **0 errors**. Remaining warnings are
  `max-lines-per-function` on pre-existing spec describes (incl. layer 3's 154-line integration
  describe), none introduced here.
- The two `*.integration.spec.ts` files were NOT run — they need a live Postgres, which this lane
  has no lock on. The Lead should run them with the migration.
