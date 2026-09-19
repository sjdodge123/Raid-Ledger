# ROK-1624 — EVENT CREATED embed names the rostered players

Branch `fix/rok-1624`, cut from `origin/main` @ `6d3e1e037`.

## What shipped

`resolveEventRosterNames` (new, `api/src/lineups/lineup-notification-event-roster.helpers.ts`)
reads the event's own signups (`event_signups` ⋈ `users`, `ACTIVE_SIGNUP_STATUSES`,
`activeUsersFilter`) and hands the EVENT CREATED card exactly those names.
`orchestrateEventCreated` (`lineup-notification-public-dispatch.helpers.ts:270`)
calls it in place of `members.map((m) => m.displayName)`.

* **AC1** — the Players field and its header count are the roster. Done.
* **AC2** — `buildEventCreatedEmbed` has exactly one production caller
  (`eventCreatedBuilder`, same file). The only remaining path that passes a
  group-wide list is the `eventId === undefined` branch, where no linked event
  exists to read a roster from; documented in the helper's doc comment rather
  than changed. The DM fan-out (`fanOutEventCreatedDMs`) deliberately still
  reaches the whole match group — the group hears a time was locked in; only
  the public card narrows.
* **AC3** — `lineup-notification-event-roster.helpers.spec.ts`, 12-person group
  vs 5-person roster (the operator's names), asserting the seven non-voters are
  absent by name, not just that a count came out right.
* **AC4** — NOT implemented. See below.

## AC4 — pending operator ruling

Undecided as of 2026-09-19: whether the card should also say something like
*"5 of 12 from the group"*, or simply drop the other names (current behaviour).
No copy was invented. When the ruling lands, it is one argument and one line:

1. `api/src/lineups/lineup-notification-public-dispatch.helpers.ts:270` —
   `members` (the whole match group, from `findMatchMemberUsers`) and
   `rosterNames` are both in scope. Pass `members.length` into
   `eventCreatedBuilder` (`:216`) and on into `buildEventCreatedEmbed`.
2. `api/src/lineups/lineup-notification-embed.helpers.ts:263-268` — the
   `if (memberNames?.length)` block that adds the `👥 Players (N)` field.
   The ruled copy goes on the field `name` (e.g. `Players (5 of 12)`) or as a
   line appended to `value` after `formatRoster(memberNames)`.

Nothing else needs to move: no signature outside those two functions changes.

## Verification run (all local, this worktree)

| Command | Result |
| --- | --- |
| `npm run test -w api -- lineup-notification-event-roster` | 5/5 pass |
| `npm run test -w api -- lineup-notification` | 15 suites, 300 tests pass |
| `npm run build -w packages/contract && npx tsc --noEmit -p api/tsconfig.json` | clean |
| `npx eslint` on the three changed files | 0 errors (4 pre-existing `max-lines-per-function` warnings, all four orchestrators in that file) |

**Mutation evidence.** Fix committed as `b95f6808e` first, then
`resolveEventRosterNames` was mutated back to `groupMembers.map(...)`: 4 of 5
tests failed, and the rendered field came out as the operator's screenshot
verbatim — `👥 Players (12)` … `+6 more`. Restored with
`git checkout -- <file>` (committed code, so nothing was discarded) and
re-ran green.

## Not done / notes for the Lead

* **No companion-bot smoke test added.** Nothing in `tools/test-bot/src/smoke`
  asserts this embed today (the one `Event Created` match is the `/event
  create` slash-command reply, a different embed), so no assertion was weakened
  or deleted. Reaching this card from the bot needs a full lineup → match →
  schedule-poll → lock-in flow with M < N voters; there is no fixture hook for
  it, and `reschedule-poll-lockin.test.ts` drives the standalone-poll path,
  which does not post this embed. Flagged rather than half-built.
* **No integration test.** `raid-ledger-db` on :5432 is held by another lane
  (`rl-rok1109`) and the integration harness calls `truncateAllTables`, so
  running one locally would have wiped a live env. GitHub CI is the gate for
  that tier.
* Only `createLockedInEvent` (`scheduling-event.helpers.ts:180`) fires this
  notification, and it `await`s `autoSignupSlotVoters` before
  `fireEventCreated` — the signups exist by the time the roster is read. The
  standalone-poll path signs up voters fire-and-forget but does NOT post this
  embed, so no race was introduced there.
