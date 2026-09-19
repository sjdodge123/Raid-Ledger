# ROK-1617 — anti-vote — lane handover

Branch `feat/rok-1617`, cut from `origin/main` @ 6d3e1e037.
Commits: `63cd78b68` (schema + API), `6e834bd95` (tests).

## BRIEF/STORY MISMATCH — read this first

My brief's "useful precomputed context" and two of its three "settled rulings"
belong to a DIFFERENT story. The brief pointed me at
`api/src/discord-bot/lfg-now/` + `LFG_NOW_SPAWN_THRESHOLD`, and asserted
"`Tonight` does NOT count toward the now-spawn threshold" and "existing
`now:60` rows expire in place". ROK-1617 in Linear is the **community-lineup
scheduling poll** anti-vote (`community_lineup_schedule_votes`,
`scheduling.service.ts::toggleVote`, the poll grid). Nothing in it touches
LFG-now. Those two rulings appear to belong to the sibling lane (lane-1612).

I followed the Linear issue, which my brief named as the source of truth, and
applied the one ruling that IS ROK-1617's: **net score (`yes - no`)**.
No LFG-now file was touched.

## What is DONE and green (AC1, AC2, AC3-backend, AC7)

- **AC1 schema+migration.** `stance text NOT NULL DEFAULT 'yes'` on
  `community_lineup_schedule_votes`. Migration
  `api/src/drizzle/migrations/0188_melted_lilandra.sql`.
  `fix-migration-order.sh --check` → PASS (188 entries in order).
  **Hand-edit, documented in the commit:** the `CHECK (stance IN ('yes','no'))`
  is appended by hand — Drizzle's `text({ enum })` is type-level only and
  emits no DB-level constraint, so AC1's guarantee would otherwise live only
  in TypeScript.
- **AC2 toggle carries a stance.** `ToggleScheduleVoteSchema.stance` defaults
  to `'yes'`, so a pre-stance client is byte-for-byte unchanged.
  `resolveStanceAction` (`scheduling-stance.helpers.ts`) is the pure rule;
  `SchedulingService.applyStance` performs INSERT / UPDATE / DELETE. Never a
  second row — insert-first keeps ROK-1017's race fix and a conflict becomes
  an UPDATE or DELETE.
- **AC3 leading — ONE place.** `packages/contract/src/scheduling-slot-order.ts`
  now orders by `slotNetScore` (`voteCount - (noCount ?? 0)`). Every consumer
  (web `scheduling-leader.ts`, Discord embed, lock-in, poll-expiry,
  poll-state) already routes through this module, so both surfaces read the
  same rule by construction. Tie-break (earliest time, then id) untouched.
- **AC7 expired/locked.** The ROK-1607 past-slot guard now blocks *answering*
  (cast OR change) while still allowing a withdrawal. Lock-in/cancel guards
  unchanged.
- Response shape: `votes` stays **YES-ONLY** (deliberate — every surface
  reading `votes.length` as the vote count predates the column and would
  otherwise be inflated by the very `no`s meant to push a slot down). New
  `noVotes[]` and `myNoSlotIds[]`.

### Verification actually run (from `api/`)
- `npx tsc --noEmit -p api/tsconfig.json` → **clean**.
- `npx jest src/lineups/scheduling/ src/discord-bot/services/discord-embed-scheduling.slot-order.spec.ts`
  → **20 suites / 246 tests PASS**.
- `npx eslint src/lineups/scheduling/` → **0 errors** (38 warnings, all
  pre-existing `max-lines-per-function`).

## NOT DONE — next lane picks this up

- **AC4 / AC5 / AC6 — the entire web surface.** No file under `web/src` was
  touched. The grid does not render a third state, there is no "doesn't work"
  control, and the "N of M picked this time" copy has not been revisited.
  Needs `docs/design-system.md` (`--color-*` tokens only) and both
  `default-dark` and `default-light` via `/dev/design-system`. The API already
  serves everything the UI needs (`noVotes`, `myNoSlotIds`, and the toggle
  accepts `stance`).
- **`noCount` is not yet populated at any call site.** The comparator accepts
  it and defaults it to 0, so ordering today is IDENTICAL to pre-stance
  behaviour. Until each call site maps `noVotes.length` into `noCount`,
  AC3 is plumbed but not yet active. Call sites to wire:
  `web/src/components/lineups/cycle-4/scheduling-leader.ts`,
  `api/src/discord-bot/services/discord-embed-scheduling.helpers.ts`,
  `api/src/lineups/scheduling/scheduling-poll-state.helpers.ts`,
  `scheduling-lock-in.helpers.ts`, `scheduling-poll-expiry.helpers.ts`.
  **This is the single most important follow-up** — without it the anti-vote
  is recorded but does not affect leading.
- **Integration test** (story asks for one: round-trips a stance, never a
  second row). Not written. Unit coverage is in place.
- **Discord embed** does not render `no` counts.
- `validate-ci.sh --full` NOT run (migration + `packages/contract/**` → the
  story mandates `--full`, not `--static`). Lead owns the fleet gate.

## Nothing is red
No failing test, no type error, no lint error on this branch.

## Question for the operator
The grid (AC4) is unbuilt, so the `no` is currently castable only via the API.
Confirm the next lane should both build the grid AND wire `noCount` into the
five call sites above, since shipping the column without the wiring means a
`no` is stored but silently ignored by the leading calculation.
