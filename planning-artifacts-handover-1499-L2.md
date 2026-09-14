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
