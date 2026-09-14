# ROK-1555 handover — "Find a better time" sheet: the heatmap becomes the ballot

**Worktree:** `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1555`
**Branch:** `spike/rok-1555-heatmap-ballot` (3 commits, NOT pushed — no PR opened)

| Commit | What |
|---|---|
| `6913d8b0` | D1 + D3 — new section in `docs/spikes/rok-1540-scheduling-poll-audit.md` |
| `b62da0c7` | D2 — `web/src/dev/scheduling-wireframes/LayoutBSheetBallot.tsx` + switcher + tests |
| `9d21d18c` | Lint-cap split of the test file |

**State: green.** `npx vitest run src/dev/scheduling-wireframes` → 3 files / 133 tests passed.
`npm run build -w web` clean, `npm run lint -w web` → 0 errors and **0 warnings in any file this
branch touches**. `package-lock.json` drift from `npm install` was reverted; `git status` clean.
No Playwright change: `scripts/smoke/` has no wireframes spec at all (the `/dev/*` routes are
DEMO_MODE-only and uncovered), so the brief's "extend it if it exists" did not apply.

**Panel:** "B · sheet — grid is the ballot" on `/dev/wireframes/scheduling` (DEMO_MODE),
`LayoutBSheetBallot` — desktop + 375px frames, all 11 audited states, mocked data only.

## Headline recommendation (the doc's §"Find a better time")

- **Model:** per cell `availableCount` (fresh only) / `staleCount` / `unknownCount` /
  `proposedSlotIds` / `votes` / `mine`. **Stale templates render as unknown — hatched, never
  counted as available.** Down-weighting was considered and rejected: "3.5 of 9 free" is not a
  sentence. Freshness window = the 7 days `isGameTimeStale` already uses.
- **Tap:** empty cell → propose + vote in ONE idempotent call; proposed → vote; mine → withdraw
  (slot survives); past / locked / cancelled / expired → inert; private non-member → the sheet is
  not reachable at all.
- **Staleness:** keep `GameTimeRefreshModal` as the page-level auto-open; add an **inline strip
  inside the sheet** ("Your availability is 41 days old — most of this grid is guesswork.
  Refresh →") that opens the same modal. No painter nested inside an overlay.
- **Found a live defect (H-2, high):** `scheduling-availability.helpers.ts::aggregateToCells`
  passes `game_time_templates.dayOfWeek` (0=Mon) straight into a 0=Sun contract/grid, while the
  sibling `api/src/events/event-availability.helpers.ts:137` does `(t.dayOfWeek + 1) % 7`. **The
  poll heatmap paints one day off today.** Not fixed here — needs its own `fix:` story.

## Open questions for the operator (doc §h)

Q-1 withdraw-the-last-vote: orphan the slot or delete it? · Q-2 does the grid replace the ladder
or feed it (spike assumes *feed*) · Q-3 add `gameTimeConfirmedAt`/`ageDays` to the poll DTO so the
strip can say "41 days" · Q-4 freshness window 7 days (3 of 9 fresh) vs 30 (5 of 9) · Q-5 confirm
H-2 against prod.

---

## D4 — stories to file (ready to paste; no Linear access from this spike)

### 1. web

**Title:** `feat(scheduling): the "Find a better time" grid is the ballot — one tap proposes and votes`
**Labels:** `Scheduling` · **Type:** feat · **Tier:** standard · **Depends on:** story 2 (api/contract), ROK-1543 (the shipped sheet)

Implements `docs/spikes/rok-1540-scheduling-poll-audit.md` §"Find a better time — heatmap as the
ballot (spike ROK-1555)". Reference wireframe: **B · sheet** on `/dev/wireframes/scheduling`
(`web/src/dev/scheduling-wireframes/LayoutBSheetBallot.tsx`) — implement that target, do not
redesign it. Layout B stays the page; the poll header is untouched (operator ruling 2026-09-13).

AC:
1. Inside `SchedulingBetterTimeSheet`, a cell tap on an **empty** cell proposes that time and casts
   the viewer's vote in ONE request; `SchedulingSuggestForm` (the `datetime-local` input) is removed
   from the sheet.
2. A tap on a cell that already carries a slot votes; a tap on one the viewer voted for withdraws.
   Approval voting is preserved — marking a second cell does not clear the first.
3. Cell shading is **fresh availability only**; stale/unknown members render as a hatch and are
   never counted as available. A legend names both channels.
4. Past cells, and every cell in a locked / cancelled / expired / read-only poll, are inert
   (`disabled` + an accessible label saying why) — no affordance that will 403 or 400.
5. A member whose game time is stale (or absent) sees an inline strip in the sheet naming the age
   and opening the existing `GameTimeRefreshModal`; the page-level auto-open is unchanged.
6. 375px: 44px minimum cell height, all 7 days reachable by horizontal scroll with the hour gutter
   pinned, one breakpoint (768px, the sheet's existing `useMediaQuery`) — closes F-14 on this surface.
7. Tokens only, verified in `default-dark` AND `default-light`.
8. Tests: vitest for the tap semantics per cell state + the strip's two branches; a Playwright smoke
   case (desktop + mobile) that opens the sheet, taps an empty cell and asserts the new slot appears
   on the ladder without a form.

Out of scope: the ladder, the header, Discord parity (ROK-1549), live updates (phase 3).

### 2. api + contract

**Title:** `feat(scheduling): cell-level availability (fresh vs stale) + one idempotent cell-vote endpoint`
**Labels:** `Scheduling` · **Type:** feat · **Tier:** standard (touches `packages/contract/**`)

Contract sketch in the same doc section §g.

AC:
1. New `ScheduleAvailabilityResponseSchema` in `packages/contract` for
   `GET /lineups/:lineupId/schedule/:matchId/availability`: `matchId`, `totalMembers`,
   `freshnessDays`, `untemplatedMembers`, `viewerGameTimeAgeDays`, and cells carrying
   `availableCount` (fresh only) / `staleCount` / `unknownCount` / `proposedSlotIds` / `votes` /
   `mine`. The events aggregate endpoint is untouched.
2. Freshness is computed from `users.game_time_confirmed_at` against the same 7-day rule as
   `game-time.service.ts::isGameTimeStale` — one definition of stale in the product.
3. `POST /lineups/:lineupId/schedule/:matchId/cells/:dayOfWeek/:hour/vote` with
   `{ weekStart, intent: 'vote' | 'withdraw' }` → `{ slotId, created, votes, mine }`. `vote` on an
   empty cell creates the slot and the vote in one transaction; on an existing cell it votes only;
   re-sending is a no-op returning the same body. Same `assertCallerMayVote` guard as `suggest`.
   `POST …/suggest` is retained for Discord/API callers and off-hour times.
4. Past cells → 409; non-member of a private lineup → 403; poll not in `scheduling` → 400.
5. The endpoint fires the embed re-render exactly as `suggestSlot`/`toggleVote` do today.
6. Integration tests (real DB): create-and-vote in one call, idempotent replay, withdraw leaves the
   slot, fresh vs stale counts split correctly, and the guard matrix.

### 3. fix (file separately, do not fold into the above)

**Title:** `fix(scheduling): poll availability heatmap is shifted one day (0=Mon templates into a 0=Sun grid)`
**Labels:** `Scheduling` · **Type:** fix · **Tier:** trivial (one source file + its test)

`api/src/lineups/scheduling/scheduling-availability.helpers.ts::aggregateToCells` emits
`game_time_templates.dayOfWeek` (0=Mon) as `AggregateGameTimeCell.dayOfWeek` (0=Sun); the sibling
`api/src/events/event-availability.helpers.ts:137` applies `(t.dayOfWeek + 1) % 7` and this one does
not, so Monday's availability paints the Sunday column on the poll page. AC: apply the remap, add a
unit assertion pinning Monday → column 1, and confirm against prod before closing (doc Q-5).
