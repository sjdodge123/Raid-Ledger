# TDD Failing-Tests Report — ROK-1219 (cancel-poll second-confirm modal, F-38)

**Task type:** TDD_WRITE_FAILING. Tests written BEFORE implementation; they must
fail (or fail-by-construction). Dev makes them pass without weakening assertions.

## Files created

| File | Kind | Tests | Status |
|------|------|-------|--------|
| `api/src/lineups/scheduling/scheduling-cancel.integration.spec.ts` | Jest integration (real DB) | 7 | 4 confirmed-failing, 3 vacuously-green guards (see notes) |
| `scripts/smoke/cancel-poll-modal.smoke.spec.ts` | Playwright smoke (desktop+mobile) | 3 (×2 projects) | fails-by-construction (no dev env; current button has no modal) |

## Jest integration — runner output

Run: `npm run test:integration -w api -- --testPathPatterns=scheduling-cancel.integration`
(DB + Redis containers were up — these ran against the real test DB.)

```
Tests:       4 failed, 3 passed, 7 total
```

### Per-AC table

| AC / edge | Test | Result | Why |
|-----------|------|--------|-----|
| AC4 — cancel w/ reason notifies members, excludes actor | `cancel with reason archives match + notifies each member except the actor` | **FAIL (correct)** | 0 notifications dispatched today (`cancelPoll` only flips status). |
| AC5 — cancel w/o reason, no "Reason:" suffix, payload null | `cancel without reason → no "Reason:" suffix and payload reason null` | **FAIL (correct)** | 0 notifications dispatched. |
| Edge — whitespace reason == no reason | `whitespace-only reason → treated as no reason` | **FAIL (correct)** | 0 notifications dispatched. |
| AC6 — reason >500 → 400 | `reason longer than 500 chars returns 400 and does not archive` | **FAIL (correct)** | Controller takes NO body / no `safeParse` → returns 200. |
| Edge — reason exactly 500 accepted | `reason exactly 500 chars is accepted (200)` | PASS (vacuous) | Endpoint ignores the body → 200 regardless. Still a valid post-impl regression guard. |
| Edge — actor-only match, zero notifications | `match whose only member is the actor → cancels with zero notifications` | PASS (vacuous) | No notifications exist at all yet. Valid post-impl guard (proves actor exclusion). |
| Guard — non-operator 403 (unchanged behavior) | `non-operator member POST returns 403 and does not archive` | PASS (intended) | Existing `RolesGuard @Roles('operator')` already enforces this; spec AC says "unchanged". |

**On the 3 green tests:** the 403 test is an intentional unchanged-behavior guard
(green now and after impl). The two edge tests pass today only because the feature
is absent (no body validation; no notifications); they will keep passing for the
RIGHT reason after impl, so they earn their keep as regression guards. The 4 core
feature ACs all fail correctly. No assertion was weakened to manufacture failure.

### Setup note (resolved, not a feature signal)

First run failed all 7 on a `public_slug` NOT-NULL violation in the lineup-insert
helper (setup bug, not feature). Fixed by importing `generatePublicSlug` from
`../public-lineup-slug.helpers` (same helper every sibling lineup integration spec
uses). After the fix the failures are purely feature-driven, as tabled above.

## Playwright smoke — fails-by-construction

`npx playwright test cancel-poll-modal.smoke --list` registers all 3 tests cleanly
(desktop + mobile). NOT executed: no dev env is deployed (fleet mode; brief says do
not deploy / do not acquire env lock).

Why they cannot pass today (construction argument): current
`web/src/components/lineups/cycle-4/SchedulingCancelAction.tsx:30` fires
`cancelPoll.mutate(...)` **directly onClick** — there is no modal. So:

- `clicking Cancel Poll opens the confirm modal and makes NO network call` — the
  modal/exact-copy/textbox assertions have no DOM to match, AND clicking the button
  fires the cancel POST immediately → the `cancelCalled === false` assertion fails.
- `modal Cancel closes the modal with NO network call and leaves the page` — there
  is no `[role="dialog"]` and no second "Cancel" affordance to dismiss.
- `confirming with a reason cancels the poll and redirects to /events` — there is no
  reason textbox to fill.

Exact copy asserted verbatim per AC1:
`"Cancel this poll? Voters will be notified. This cannot be undone."`

No `sleep()` used — waits are `expect(...).toBeVisible`, `waitForURL`, and the
shared `pollForCondition` barrier (mirrors `standalone-scheduling-poll.smoke`).

## Patterns followed

- Integration spec mirrors `lineups-abort.integration.spec.ts` (ROK-1062 prior art):
  `getTestApp`, `truncateAllTables` + re-`loginAsAdmin` in `afterEach`, bcrypt
  member fixtures, direct-DB seeding + `testApp.request` POSTs, `community_lineup`
  notification subtype query.
- Smoke spec mirrors `standalone-scheduling-poll.smoke.spec.ts` (page route,
  `scheduling-composite` testid, `pollForCondition` staleTime barrier, API poll
  creation via `/scheduling-polls`) and `lineup-abort.smoke.spec.ts` (modal +
  `cannot be undone` copy + reason textbox + destructive confirm shape).

## Ready for dev: YES
