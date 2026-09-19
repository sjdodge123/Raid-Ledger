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


---

# ROK-1617 — FOLLOW-UP LANE (wiring + grid)

Commits `7227dd59c` (wiring) and `6dc052878` (grid), on top of the three above.

## Coordinator constraints honoured
- **No local dev env, no DB, no integration tests, no `validate-migrations.sh`,
  no `db:migrate`** were run in this lane. Every proof below is unit-level.
- **No `npm run db:generate`, no `_journal.json` edit, no renumber.** The
  migration on this branch is still exactly `0188_melted_lilandra.sql` as the
  first lane left it. The schema change lives in
  `api/src/drizzle/schema/community-lineup-matches.ts` and is committed, so the
  Lead's rebase-to-`0189` is mechanical. **Nothing was regenerated since the
  first lane's commit.**

## 1. `noCount` is wired — and the call-site list was RIGHT, but incomplete

The handover named five call sites. `git grep sortSchedulingSlots` confirms
exactly those five are the only production consumers. But two things it did
not say turned out to matter more than the missing `noCount`:

**The three API paths were actively WRONG, not merely inert.** Each tallied
`counts.set(slotId, counts.get(slotId) + 1)` over a vote-row list that now
carries `no` rows — so a `no` counted as a vote FOR the slot it rejected. On a
3-yes/2-no slot the old arithmetic reported 5 votes and could lock in the very
time its voters had just said does not work. Same in `buildEmbedSlots`: the
card's "N votes" and its voter-name list both included anti-voters.

One shared tally now backs all of them — `tallyStancesBySlot` /
`stanceTallyFor` in `api/src/lineups/scheduling/scheduling-stance.helpers.ts`:

| call site | what it got |
| --- | --- |
| `scheduling-lock-in.helpers.ts::findLeadingLockableSlot` | stance-split tally; `LockInVoteRef` is now `StanceVoteRef` |
| `scheduling-poll-expiry.helpers.ts::pickLeadingFutureSlot` | same |
| `scheduling-poll-state.helpers.ts::resolveLockedInTime` | same (`countVotesBySlot` deleted) |
| `scheduling-poll-embed.helpers.ts::buildEmbedSlots` | `voteCount`/`voterNames` are YES-only; `noCount` added |
| `web/.../scheduling-leader.ts::sortSlots` | `noCount: noCountOf(slot)` |

Two deliberate rulings inside that:
- **Lockability still requires ≥1 YES.** A slot carrying only `no`s is never
  offered, however its net score compares.
- **"Tied" means tied on NET score**, on both the embed (`topSlotsAreTied`)
  and the web (`deriveSchedulingLeader`). The tie copy is the comparator's, so
  it must not fire for a pair the comparator never considered level.

**The web reads `noVotes` defensively** (`slot.noVotes?.length ?? 0`). The poll
response is consumed as raw JSON on that path — there is no zod parse — so a
payload cached by a pre-stance client arrives without the array.

### Revert-proof (the wiring actually changes ordering)
`api/src/lineups/scheduling/scheduling-stance-wiring.spec.ts` is built so each
case fails if a call site drops `noCount`. Proved by reverting the tally to
row-counting (`tally.voteCount += 1` for every row) and re-running:

```
Tests: 4 failed, 1 passed, 5 total
● findLeadingLockableSlot › picks the lower-yes slot once anti-votes sink the other
    expect(received).toBe(expected)
    Expected: 2
    Received: 1
```

The wiring was then restored and the file re-verified byte-identical. The web
side has the same shape in `scheduling-leader.test.ts` → `describe('net score
(ROK-1617)')`: 3-yes/2-no must lose to 2-yes/0-no.

## 2. The grid (AC4 / AC5 / AC6)

- `scheduling-api.ts::toggleScheduleVote` takes `stance` (default `'yes'`).
- `use-scheduling.ts` optimistic patch is three-state and mirrors the server's
  `resolveStanceAction`; the viewer is removed from BOTH lists before being
  put back on the side the tap landed on (one row per member per slot).
- `use-scheduling-ladder.ts` routes both affordances through one `pressStance`
  so they share the per-slot in-flight guard.
- `SchedulingSlotRow.tsx`: a `Doesn't work` button per votable future row, a
  `✕` mark on the viewer's own anti-vote, `data-no-voted`, and the tally
  rendered as its own clause — `3 votes · 2 can't`.
- Fixtures gained `myNoSlotIds` and `noVotersBySlot` overrides.

**New pattern: the "doesn't work" control — nothing in the `components/ui`
inventory is a negative-stance toggle, and the affirmative `+ Vote` pill
cannot carry the third state.** It is token-only on purpose:
`--color-overlay` / `--color-edge-strong` / `--color-muted`. There is no
`--color-danger` token yet (design-system §423 lists it as a *suggestion*, not
shipped), and a raw `red-*`/`rose-*` would be wrong in fourteen of the fifteen
themes. The pressed state therefore reads through SHAPE and GLYPH, not hue —
which makes it identical in `default-light` and `default-dark` by construction
and keeps it legible to a colour-blind viewer.

## Exactly what was run, and what it said
From `api/`:
- `npx jest src/lineups/scheduling/ src/discord-bot/services/discord-embed-scheduling.slot-order.spec.ts src/discord-bot/services/discord-embed-scheduling.spec.ts`
  → **21 suites / 251 tests PASS**
- `npx jest src/lineups/scheduling/scheduling-stance-wiring.spec.ts` → **5 PASS**
  (and **4 FAIL** on the deliberate revert, message quoted above)

From the worktree root:
- `npx tsc --noEmit -p api/tsconfig.json` → **clean**
- `npm run build -w web` → **clean** (tsc + vite)
- `npx eslint api/src/lineups/scheduling/ api/src/discord-bot/services/` → **0 errors**
- `npx eslint web/src/components/lineups/cycle-4/ web/src/hooks/use-scheduling.ts web/src/lib/api/scheduling-api.ts` → **0 errors**

From `web/`:
- `npx vitest run src/components/lineups/cycle-4/__tests__/ src/hooks/__tests__/use-scheduling-optimistic.test.tsx`
  → **37 files / 360 tests PASS**

**Not run here (out of scope for this lane, by the coordinator's instruction):**
any integration spec, any migration validation, `validate-ci.sh` in any mode,
the fleet gate, Playwright, and the Discord companion smoke suite.

## Still open for the Lead
- **`--full` fleet gate** (migration + `packages/contract/**`). Lead owns it.
- **Migration renumber to `0189`** after ROK-1109 merges. Lead owns it.
- **Integration test** the story asks for (round-trips a stance; never a second
  row). Not written — it needs a real DB, which this lane could not touch.
- **Both-theme visual check.** The control is token-only so it cannot be wrong
  in one family and right in the other, but no browser rendered it in this
  lane; it wants a look on the deployed env / `/dev/design-system`.
- **The Discord card still does not RENDER the `no` count.** It now orders and
  counts correctly, and anti-voters no longer appear in the voter names — but
  no "N can't" clause was added to the embed, deliberately: changing embed
  output pulls in the companion-bot smoke suite, which this lane could not run.
- **"N of M picked this time" copy (AC5 adjacent)** was not revisited; the
  tally lives on the row, not in the leader-card sentence.
