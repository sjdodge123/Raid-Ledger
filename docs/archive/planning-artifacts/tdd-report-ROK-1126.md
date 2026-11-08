# TDD Report — ROK-1126

**Worktree:** `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1126`
**Branch:** `rok-1126-lineup-reminders`
**Mode:** TDD_WRITE_FAILING
**Failure mode summary:** all new tests are RED. The two unit specs both
fail-by-construction (helper module missing → cannot resolve import). The
integration spec fails-by-construction (`checkNominationReminders` does not
exist on `LineupReminderService` — TypeScript compile error in ts-jest).
A standalone re-run with a stub helper file confirms 25 of 40 unit tests
fail on assertion (the remaining 15 are unmodified tiebreaker tests + skip /
no-op edge cases that legitimately remain green post-implementation).

## Files

| File | Status | Lines |
|------|--------|-------|
| `api/src/lineups/lineup-reminder-target.helpers.spec.ts` | new | 222 |
| `api/src/lineups/lineup-reminder.integration.spec.ts` | new | 424 |
| `api/src/lineups/lineup-reminder.service.spec.ts` | edited | +220 / -75 |

## Per-AC trace

| AC | Description | Spec(s) covering it | Initial state |
|----|-------------|---------------------|---------------|
| 1 | `checkVoteReminders` decorated `@Cron(EVERY_5_MINUTES)` + `executeWithTracking` | `lineup-reminder.service.spec.ts › vote reminders › checkVoteReminders wraps execution in cronJobService.executeWithTracking` | RED |
| 2 | `checkSchedulingReminders` ditto | `lineup-reminder.service.spec.ts › scheduling reminders › checkSchedulingReminders wraps execution in cronJobService.executeWithTracking` | RED |
| 3 | `checkNominationReminders` ditto, fires on building lineups | `lineup-reminder.service.spec.ts › nomination reminders › *` (10 cases: 24h, 1h, dedup key shape, helper delegation, building filter, null deadline, out-of-window, expired, dedup, subtype, executeWithTracking) | RED (fails-by-construction; method missing) |
| 4 | `resolveLineupReminderTargets` returns correct set per (visibility, action) | `lineup-reminder-target.helpers.spec.ts` (12 cases: ReminderAction type, return type, private+nominate/vote/schedule, no invitees, all-participated, public+nominate/vote/schedule, no participants, all-nominated, missing lineup row) | RED (fails-by-construction; module missing) |
| 5 | private + voting + 1h → invitees ∪ creator minus voters; subtype `lineup_vote_reminder`; dedup key `lineup-reminder-1h:{lineupId}:{userId}` | `lineup-reminder.integration.spec.ts › AC #5 — private voting + 1h-out deadline` | RED |
| 5b | private + decided (scheduling) + 1h → match members minus schedule-voters | `lineup-reminder.integration.spec.ts › AC #5b — private decided (scheduling) + 1h-out deadline` | RED |
| 6 | public + voting + 1h → only nominators ∪ voters minus already-voted | `lineup-reminder.integration.spec.ts › AC #6 — public voting + 1h-out deadline` | RED |
| 7 | private + building + 1h → invitees ∪ creator minus existing nominators; subtype `lineup_nominate_reminder` | `lineup-reminder.integration.spec.ts › AC #7 — private building + 1h-out deadline` | RED |
| 8 | public + building + 1h → all Discord-linked users minus nominators | `lineup-reminder.integration.spec.ts › AC #8 — public building + 1h-out deadline` | RED |
| 9 | Notifications routed through `userNotificationPreferences` (community_lineup type) | Implicitly verified — every test asserts `type: 'community_lineup'` | RED (downstream coverage) |
| 10 | Dedup prevents duplicate DMs across cron firings within window | `lineup-reminder.integration.spec.ts › AC #10 — dedup prevents duplicate DMs across cron firings` | RED |

## Test runner output (post-stub)

To validate that the assertions are *meaningful* failures (not just import errors), I temporarily wrote a no-op stub
`api/src/lineups/lineup-reminder-target.helpers.ts` exporting `resolveLineupReminderTargets` and the `ReminderAction` type, then re-ran the service spec.

```text
Test Suites: 1 failed, 1 total
Tests:       25 failed, 15 passed, 40 total
```

The 15 passing are the 10 unmodified tiebreaker tests + 5 short-circuit
edge cases (no lineups → no-op, null deadline → skip, dedup-true → skip)
whose semantics survive the rewrite.

The 25 failures cover every new behavior: `@Cron` wiring,
`executeWithTracking`, helper delegation with correct args, dedup key
shapes, building-status filter, all 10 nomination tests.

The stub file was deleted before commit.

## Confirmed RED runs

```text
$ cd api && npx jest --testPathPatterns=lineup-reminder-target.helpers --no-coverage
FAIL src/lineups/lineup-reminder-target.helpers.spec.ts
  ● Test suite failed to run

    Cannot find module './lineup-reminder-target.helpers' from
    'lineups/lineup-reminder-target.helpers.spec.ts'

Test Suites: 1 failed, 1 total
Tests:       0 total

$ cd api && npx jest --testPathPatterns=lineup-reminder.service.spec --no-coverage
FAIL src/lineups/lineup-reminder.service.spec.ts
  ● Test suite failed to run

    Cannot find module './lineup-reminder-target.helpers' from
    'lineups/lineup-reminder.service.spec.ts'

Test Suites: 1 failed, 1 total
Tests:       0 total
```

Integration spec fails to compile (ts-jest):

```text
src/lineups/lineup-reminder.integration.spec.ts(268,29): error TS2339:
  Property 'checkNominationReminders' does not exist on type 'LineupReminderService'.
src/lineups/lineup-reminder.integration.spec.ts(310,29): error TS2339:
  Property 'checkNominationReminders' does not exist on type 'LineupReminderService'.
src/lineups/lineup-reminder.integration.spec.ts(420,35): error TS2339:
  Property 'checkNominationReminders' does not exist on type 'LineupReminderService'.
```

## Notes for the dev agent

- **Helper signature is fixed** by the unit spec. Mock pattern: tests
  queue 3 `db.execute` results in order: (1) lineup row, (2) candidate
  user list, (3) participants-to-subtract. The dev's helper internals
  may differ — only the public signature and final filter logic are
  pinned. The "candidate set" query for public + vote may instead use
  a single union; the test still passes as long as the result excludes
  already-voted users.
- **Dedup key for nominate** is `lineup-nominate-remind:{lineupId}:{userId}:{window}` (window = `'24h'` or `'1h'`).
- **Scheduling restructure:** the existing `getSchedulingNonVoters` SQL
  used a single query joining match members with `NOT EXISTS` schedule
  votes. The spec now expects the service to first fetch
  `(lineupId, matchId)` pairs for scheduling-status matches, then call
  `resolveLineupReminderTargets(db, lineupId, 'schedule', matchId)` per
  match — so the helper does the per-match user resolution.
- **`@Cron` decorators** don't actually fire in the unit test (no
  `ScheduleModule.forRoot()` in the test module). Tests call
  `service.checkVoteReminders()` etc. directly. The
  `executeWithTracking` mock implementation calls its `fn` argument
  immediately, so the inner `runX` body still runs.
- The integration spec's AC #8 asserts `expect.arrayContaining(...)`
  rather than equality with the new users only, because the seeded
  admin user from `truncateAllTables` also has a discord_id and
  participates in the public-branch fan-out. Don't tighten this to
  exact-set equality without removing the admin from the candidate
  pool first.
