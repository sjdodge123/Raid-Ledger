# Tech Debt Backlog

Working document for reviewer findings that don't warrant immediate fixes. Appended by `/build`, `/dispatch`, and `/fix-batch` reviewer reports. Operator triages: file Linear stories for items worth doing, delete the rest.

**Why this exists:** findings used to be auto-filed as Linear `tech-debt:` stories, which created a self-perpetuating queue (reviewer flags items → Lead files story → next batch picks up the story → reviewer flags more items → loop). Findings now land here instead. Nothing in this file should be acted on by an agent without an explicit operator instruction.

## Format for new entries

Append to the bottom under a new dated section. The Lead does this as part of the batch's commits — no separate PR.

```
### 2026-05-03 — fix/batch-2026-05-02 (PR #XXX)

- **[low]** `path/to/file.ts:42` — short description.
  Suggested: one-line fix idea (optional).
- **[med]** `path/other.tsx` — description.
```

Severities: `crit` should never land here (those are auto-fixed during review or sent back to dev). Use `high` / `med` / `low` / `nit`.

## Operator workflow

1. Read new entries when reviewing the PR diff.
2. For each entry: file a Linear story manually, OR delete the entry, OR leave it for later.
3. Pruning is part of triage — old or duplicate items should be removed, not left to bloat.

## Format for skills that parse this file

A future triage skill (or operator-invoked agent) can rely on:

- Each batch is a level-3 heading: `### YYYY-MM-DD — <branch> (PR #<num>)`. Date is ISO. PR ref optional if the PR doesn't exist yet.
- Each finding is a single bullet starting with `- **[<sev>]**` where `<sev>` ∈ {`high`, `med`, `low`, `nit`}.
- File path follows in single backticks; `path:line` is preferred over `path` alone.
- Description is the rest of the bullet up to optional `Suggested:` line indented two spaces.
- The append marker (`<!-- agents append below this line -->`) divides header from entries — skills should read from there forward.

A skill's job is typically: parse → group duplicates by file path → propose Linear stories grouped by area label → present for operator approval. Never auto-file.

---

<!-- agents append below this line -->

### 2026-05-03 — rok-1067-public-shareable-lineup (ROK-1067)

- **[low]** `api/src/drizzle/migrations/0135_lineup_public_share.sql:6-14` — Migration is unsafe under rolling/blue-green deploys: ADD COLUMN nullable → backfill → SET NOT NULL has a window where old app instances can insert NULL slugs and trip the `SET NOT NULL` step. Not applicable to RL's current single-instance Synology Docker topology (Watchtower stops old container before starting new), but worth documenting if we ever move to multi-instance / k8s.
  Suggested: phased migration (separate PRs for backfill vs `SET NOT NULL`) or DB-side default that the new app code overwrites.
- **[low]** `nginx/monolith.conf.template:75-84` and `nginx/default.conf:52-61` — The existing ROK-393 `/i/:code` crawler block also lacks `proxy_set_header X-Real-IP` / `X-Forwarded-For`, so the invite-OG endpoint's rate-limit buckets all crawlers under the upstream IP too. Same class of bug as the ROK-1067 finding (fixed for `/p/lineup/:slug` in this PR); the invite block was the precedent and inherited the gap.
  Suggested: mirror the four `proxy_set_header` lines in the `/i/:code` location block.

### 2026-05-09 — rok-1225-stabilize-lineups (PR #751)

- **[low]** `api/src/itad/itad-price-sync.service.ts:25` — keeps `export { extractErrorDetail }` re-export shim because `itad-price-sync.service.adversarial.spec.ts:17` still imports from the old path. CLAUDE.md frowns on re-export shims; two-line fix in a follow-up chore.
  Suggested: update the spec import to `from '../common/pg-error.helpers'` and delete the re-export.
- **[low]** `api/src/lineups/lineups-bandwagon.helpers.ts:48` — insert uses pre-check + `ConflictException` for the 409 UX path. Could be replaced with `.onConflictDoNothing().returning({ id })` and treat empty-returning as "already a member" — cleaner but a behavior change for the 409 response.
  Suggested: spike a follow-up to confirm the UX impact before touching.
- **[low]** `community_lineup_schedule_slots.match_id` and `community_lineup_schedule_votes.slot_id` FKs declared in 0113 — verify presence on prod via DB probe (this PR fixes only the empirically-missing one on `community_lineup_match_members.match_id`).
  Suggested: one-off operator psql probe; if missing, file a focused follow-up like ROK-1225.
- **[low]** Production DB likely has the same orphan rows on `community_lineup_match_members` — migration's `DELETE FROM ... WHERE NOT EXISTS` will clean them on next deploy (Watchtower 5AM); pre-deploy probe optional but informative.
  Suggested: operator-run psql `SELECT COUNT(*) FROM community_lineup_match_members m WHERE NOT EXISTS (SELECT 1 FROM community_lineup_matches WHERE id = m.match_id);` against prod before tomorrow's 5AM pull.

### 2026-05-09 — rok-1247-smoke-api-polling

- **[med]** `scripts/smoke/scheduling-poll.smoke.spec.ts:904` voter-avatars (D, 1 test) — migration's `pollSchedulingPollHasSlot({ withVote: true })` resolves on **any** slot vote, but the test asserts `[data-testid="schedule-slot"][data-voted="true"]` which is current-user-scoped. Vote-toggle flow may end with admin's vote toggled off; pre-existing flakiness uncovered by the migration.
  Suggested: redesign the test — either tighten the poll to current-user vote (poll for `data.slots.some(s => s.votes?.some(v => v.userId === adminUserId))`), or assert on the lower-bound `[data-testid="schedule-slot"]` having ANY avatar group.
- **[med]** `scripts/smoke/standalone-scheduling-poll.smoke.spec.ts:217` AC9 (D, 1 test) — migration's `pollPollPageHasMatch` resolves but post-navigation the `<h1>Scheduling Poll</h1>` never renders. Page snapshot shows layout chrome + Discord join banner only. Possible navigation race or the page chrome renders before the match query resolves.
  Suggested: instrument the navigation step in isolation — add a console listener for fetch errors during nav, or capture network requests to determine if the standalone poll API call succeeds post-nav.
- **[low]** `scripts/smoke/api-helpers.ts:303-330` `pollForCondition` — JSDoc could explicitly document the truthy-vs-null caller contract so future callers don't pass a `Promise<number>` and trip on `0` (which the current `if (last)` treats as "not yet ready"). Implicit-but-correct today; one-line addition would prevent confusion.
  Suggested: add `@example` showing the `data?.foo?.length ? data : null` pattern.
- **[low]** `scripts/smoke/api-helpers.ts` `pollBackups` / `pollLogs` — currently resolve on any non-null object (`data ? data : null`). Acceptable today because tests assert "table OR empty-state" panels. If a future test seeds a row and asserts on its presence, those polls must be tightened to require `total > 0`.
  Suggested: tighten when a row-asserting test is added; not in scope for this story.
- **[nit]** Test-infra observation: ROK-1209's worktree acquired the env-lock 4 minutes into ROK-1247's lease (PID 0 / heartbeat-based liveness — bug-prone). Re-acquiring with `priority: operator` recovered, but suggests the env-lock heartbeat semantics may need a refresh while a Playwright suite is running.
  Suggested: investigate adding a heartbeat refresh inside `npx playwright test` (or the deploy_dev wrapper) to prevent mid-run preemption when the lease holder is busy but not actively pinging the MCP. (Addressed by ROK-1209 commit `chore(env-lock): re-anchor deploy_dev.sh lease to API PID` — re-anchors lease to long-lived API server PID at end of `start_dev()`.)

### 2026-05-09 — rok-1209-confirmation-pattern (PR pending)

- **[med]** `scripts/smoke/lineup-confirmation-pills.smoke.spec.ts` — smoke harness has no non-admin fixture user, so all four ROK-1209 smoke tests run with admin-as-creator → `organizer` persona. This means invitee-not-acted, invitee-acted (waiting-tone hero flip), and the per-row ✓ on `LeaderboardRow` for someone-other-than-you cases are NOT exercised at the browser level. Vitest unit tests for `useLineupHero`, `getLineupPersona`, `hasUserActedInPhase`, `getLineupHeroCopy`, and each phase component cover the invitee personas exhaustively, so AC coverage is maintained — but a real persona × phase × phaseState matrix run in a real browser would catch any DOM-level regression vitest's jsdom misses (e.g., IntersectionObserver-driven mobile compact, real CSS sticky behavior under invitee data).
  Suggested: add a smoke-fixture endpoint (e.g., `POST /admin/test/seed-fixture-user` returning `{ userId, jwt }`) plus a `getInviteeToken()` helper in `scripts/smoke/api-helpers.ts`, then add a separate `lineup-confirmation-pills-invitee.smoke.spec.ts` that runs the same matrix from the invitee side. Sized as a small follow-up; not blocking ROK-1209 ship.

### 2026-05-11 — rok-1253-grace-and-pause (ROK-1253, PR pending)

- **[med]** `api/src/lineups/lineup-auto-advance-grace.integration.spec.ts:863-920` REWORK-4 — test asserts the failed-grace catch path (clear `pendingAdvanceAt` + cancel job + no deadlock) but does **not** deterministically reproduce the replacement-job race that Codex round 3 P2 closed. REWORK-4 calls `processGraceAdvance()` in isolation; it never injects a competing vote/`maybeAutoAdvance` between the cancel and the clear inside the catch block, so it would also pass with the old buggy `clear → cancel` ordering. Runtime fix at `lineup-phase.processor.ts:175-176` is correct + reviewable from the code; the integration suite just doesn't prove the race window is closed.
  Suggested: add a competing-mutation race test using either (a) a test-only hook in the catch block (`process.env.ROK_1253_RACE_HOOK` await pattern), or (b) `Promise.race` orchestration where REWORK-4 fires a vote on the same lineup mid-failure and asserts a fresh `lineup-grace-<id>` job survives. Defer until someone adds the test infra to inject hooks cleanly — flaky race tests are worse than the gap.
- **[low]** `api/src/lineups/queue/lineup-phase.processor.ts:142-178` — `runGraceTransition`'s catch swallows ALL errors with the same hygiene path (cancel + clear). Right thing for `ConflictException` and `TIEBREAKER_REQUIRED`; questionable for unrelated runtime exceptions (DB outage, etc.) where retrying might be preferable to giving up the claim. Pragmatically the BullMQ retry semantics already handle transient failures upstream (`attempts: 3, backoff: exponential`), so the catch only fires after retries are exhausted — acceptable.
  Suggested: only revisit if real-world flakes show grace-windows being lost to transient DB hiccups.

### 2026-05-11 — fix/batch-2026-05-11 (ROK-1259 review)

- **[low]** `web/src/components/notifications/NotificationItem.test.tsx:60-75` — Test fixtures use `type: 'lineup_vote_reminder'` (etc.) but the backend dispatches lineup reminders with `type: 'community_lineup'` and `payload.subtype: 'lineup_vote_reminder'` (see `api/src/lineups/lineup-reminder-dispatch.helpers.ts:30-36`). The click handler is payload-driven only, so the tests still verify navigation correctly — but the test fixture's `type` field misrepresents the wire shape.
  Suggested: switch fixtures to `type: 'community_lineup'` + `payload.subtype: 'lineup_vote_reminder'`, OR add an inline comment noting that `handleClick` ignores `notification.type` and only uses `payload`.
- **[low]** `api/src/lineups/lineup-reminder-dispatch.helpers.ts:52` — `lineup_scheduling_reminder` is dispatched with `{ subtype, matchId }` only (no `lineupId`). After ROK-1259's fallback, these clicks still no-op because neither the matchId+lineupId branch nor the lineupId-only branch matches. AC3 of ROK-1259 assumed the backend sends both; the test fixtures reflect the spec's expectation rather than the wire shape.
  Suggested: add `lineupId` to the scheduling-reminder dispatch payload in a follow-up so users can actually click through. Pre-existing dispatch gap, not a ROK-1259 regression.
