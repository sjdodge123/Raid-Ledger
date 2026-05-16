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

- **[low]** `scripts/smoke/api-helpers.ts:303-330` `pollForCondition` — JSDoc could explicitly document the truthy-vs-null caller contract so future callers don't pass a `Promise<number>` and trip on `0` (which the current `if (last)` treats as "not yet ready"). Implicit-but-correct today; one-line addition would prevent confusion.
  Suggested: add `@example` showing the `data?.foo?.length ? data : null` pattern.
- **[low]** `scripts/smoke/api-helpers.ts` `pollBackups` / `pollLogs` — currently resolve on any non-null object (`data ? data : null`). Acceptable today because tests assert "table OR empty-state" panels. If a future test seeds a row and asserts on its presence, those polls must be tightened to require `total > 0`.
  Suggested: tighten when a row-asserting test is added; not in scope for this story.
- **[nit]** Test-infra observation: ROK-1209's worktree acquired the env-lock 4 minutes into ROK-1247's lease (PID 0 / heartbeat-based liveness — bug-prone). Re-acquiring with `priority: operator` recovered, but suggests the env-lock heartbeat semantics may need a refresh while a Playwright suite is running.
  Suggested: investigate adding a heartbeat refresh inside `npx playwright test` (or the deploy_dev wrapper) to prevent mid-run preemption when the lease holder is busy but not actively pinging the MCP. (Addressed by ROK-1209 commit `chore(env-lock): re-anchor deploy_dev.sh lease to API PID` — re-anchors lease to long-lived API server PID at end of `start_dev()`.)

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

### 2026-05-11 — rok-1260-deactivate-discord-leavers (ROK-1260, PR pending)

- **[low]** `api/src/notifications/discord-notification.service.ts` (399 lines, over the 300-line STRICT limit but `warn`-level). ROK-1260 added `deactivateUser()` (~30 lines of ModuleRef-based DI plumbing — required to break a 3-way Notification↔Users↔Events cycle that crashed boot via `RosterNotificationBufferService`) plus `isUserDeactivated()` (~15 lines for Codex P2). The actual deactivation orchestration is already extracted to `discord-notification-deactivate.helpers.ts` (106 lines); only the DI shim remained inline because it needs access to the service's injected `moduleRef`. Architect POST_REVIEW: suggested extracting a `DiscordDeactivationService` that owns the cross-module ModuleRef calls, leaving the notification service lean (~330 lines).
  Suggested: new `DiscordDeactivationService` provider in `notifications.module.ts`; move `deactivateUser` and `isUserDeactivated` over; `DiscordNotificationService.deactivateUser` becomes a 1-line passthrough OR is dropped entirely and the processor calls `DiscordDeactivationService` directly. Architect estimated ~70-line drop on the main service.
- **[low]** `api/src/discord-bot/listeners/pug-invite.listener.ts:90-95` — same gateway-reconnect listener leak Codex P3 flagged on `guild-member-add.listener.ts` (fixed for ROK-1260 in commit `74912008`). `handleBotDisconnected()` clears the registration flags but never calls `client.off(Events.GuildMemberAdd, this.boundGuildMemberAddHandler)` or `client.off(Events.InteractionCreate, this.boundInteractionHandler)`. On every reconnect, pug-invite stacks another handler. Not bundled with ROK-1260 because pug-invite has 2 listeners + an interaction surface — bigger blast radius than the new file. Operator's call whether to fix in a follow-up chore or leave for the next batch.
  Suggested: mirror the `client.off()` call pattern from `guild-member-add.listener.ts:60-67`. Two lines per handler. Verify with a Discord-bot reconnect smoke (if there is one — there may not be coverage for the reconnect cycle today).

### 2026-05-12 — rok-1068-lineup-prelaunch-validation (ROK-1068)

Findings from pre-launch validation of the Community Lineup feature (33 runbook ACs + 35 original Linear sub-ACs cross-checked). Runbook landed at `docs/runbooks/lineup-prelaunch-validation.md`. Chrome MCP + Playwright + companion bot all driven against deployed dev env.

**Test-infra debt surfaced:**

- **[med]** `scripts/smoke/lineup-creation.smoke.spec.ts:147`, `scripts/smoke/community-lineup.smoke.spec.ts:184,548`, `scripts/smoke/lineup-votes-per-player.smoke.spec.ts:114`, `scripts/smoke/lineup-tiebreaker.smoke.spec.ts:597` — five lineup specs intermittently fail when the worker can't get the `?test=open-lineup-modal` modal to materialise. Manual Chrome MCP drive of the same flows during ROK-1068 confirms every feature works end-to-end (Start Lineup modal opens with all sliders + Match Threshold 35% + Votes per Player 3 + Tiebreaker Mode selector); the failure is the fixture's cross-worker race against the global "active lineup" banner state. 9 specs fail on a single run while 200+ pass.
  Suggested: extend the existing per-worker title-prefix isolation pattern (ROK-1147 / ROK-1227) so every Start Lineup modal test archives sibling-worker lineups by prefix before navigating, OR gate the `?test=open-lineup-modal` codepath so it force-opens the modal regardless of active-lineup banner state.

**Coverage gaps (uncovered by smoke + integration + Chrome MCP):**

- **[low]** `api/src/lineups/lineup-notification-channel.helpers.ts` lifecycle dispatcher when `channel_bindings.lineup` is null — no smoke or integration coverage exercises the no-bound-channel path. Every test fixture uses a channel-bound community. Regression would be silent in CI; only surfaces when an operator self-hosts without binding a channel before starting their first lineup. AC 33 in the ROK-1068 runbook is explicitly logged as a gap because DEMO_MODE does not expose channel-unbind.
  Suggested: either (a) integration test that asserts `LineupNotificationService.dispatch*` returns gracefully and emits the `channel-unbound` log line when `channelBindings.lineup === null`, or (b) companion-bot smoke that creates a lineup in a guild with no bound channel and `assertConditionNeverMet` on any channel embed for the full lineup lifecycle.

**Phase F (2026-05-12) covered the following three runbook ACs that had originally landed here; the entries are removed because the ACs are now covered:**

- AC 34 (Steam-unlinked-nominator warning) — Chrome MCP drive of `SteamNudgeBanner` against the live env (existing vitest `SteamNudgeBanner.test.tsx` covers copy + visibility logic).
- AC 35 (vote-at-deadline race) — `api/src/lineups/lineup-deadline-vote-race.integration.spec.ts`.
- AC 36 (abort-with/without-reason variance) — `abortReasonVarianceWalkthrough` test in `tools/test-bot/src/smoke/tests/lineup-abort.test.ts`.

### 2026-05-12 — fix/batch-2026-05-12b (ROK-1237 + ROK-1271 + ROK-1267 review)

- **[low]** `web/src/lib/api/fetch-api.ts:50` — inline structural type for `schema` parameter (`{ safeParse: ... }`) duplicates Zod's interface and types `result.error.issues` as `unknown[]`. Consider importing `ZodType<T>` from `zod` so the generic narrows automatically and Sentry's `issues` extra carries proper Zod issue typing for future debugging.
  Suggested: change to `schema?: ZodType<T>` and let TypeScript infer. Two-line change. Defer until the next API-layer touch.
- **[low]** `api/src/admin/games-dedup-audit.helpers.ts:106-189` — `buildDirectCountQueries` is 84 lines (function-length `warn` rule is 30). It's a flat list of 16 count queries; a small `countDirect(table, col)` helper would cut it to ~20 lines and remove the brittle "order must match destructure" coupling at `computeBlastRadiusForId:220-241`. Mediated by the new unit-spec assertion on all 17 fields (committed in `fa16e2a1`) — destructure swap is now test-detectable.
  Suggested: refactor in a follow-up when ROK-1270 Phase 1 extends `BlastRadiusRow` (the merge migration will likely add more counts).
- **[low]** `api/src/admin/games-dedup-audit.service.ts:99-101` — outer `Promise.all(dupIds.map(...))` × inner `Promise.all([...17 queries])` = up to 17N concurrent DB queries. Fine for Phase 0 (operator-only, prod has <100K games), but if a large guild ends up with N > 20 dup ids the endpoint could spike Postgres `max_connections`.
  Suggested: wrap the outer `Promise.all` with `pLimit(8)` (or similar) if telemetry shows N > 20 on prod. Currently no metrics; defer.
- **[low]** `packages/contract/src/roster.schema.ts:66` — `signupStatus` is now `.optional()` after referencing canonical `SignupStatusSchema`. Widening the contract to accept `undefined` from the server. Acceptable for forward-compat, but call sites (`RosterSlot.tsx:73-78`, `EventDetailRoster`) compare `===` against literals, so undefined falls through to default treatment. Confirm this is the intended fallback for legacy/missing payloads, or tighten back to non-optional.
  Suggested: review the read-side query helpers — if signupStatus is always present in practice, drop `.optional()`. Spike before next contract refactor.

### 2026-05-12 — rok-1270-games-dedup-audit (ROK-1270 Phase 1)

- **[low]** `api/src/admin/games-dedup-unique-conflicts.helpers.ts:79-118` — `countCompositeConflicts` and `countSingleColumnConflict` use `sql.raw` with template-literal interpolation of `tableName`, `otherCols`, `input.canonicalId`, and `input.dupIds.join(',')`. Safe today: all interpolations are compile-time string literals or typed `number` / `number[]` values from `games.id` (typed FK column). The pattern is fragile — if `UniqueConflictInput` ever accepted external/user input (helper reused outside the admin surface, or a future bulk-import flow), the SQL-injection guarantee silently regresses.
  Suggested: refactor to drizzle `sql` template with `${}` placeholders for the dynamic-arity case, OR add a runtime assertion at the helper entry: `Number.isInteger(input.canonicalId) && input.dupIds.every(Number.isInteger)`.
- **[nit]** `api/src/admin/games-dedup-extra-counts.helpers.ts:21` — doc comment references `extendedBlastRadiusKeys` which doesn't exist as an export in this file. The lockstep contract is actually documented via inline comments on each Promise in the array. Minor doc drift from an earlier draft.
  Suggested: edit the comment to drop the dangling reference.
- **[nit]** `api/src/drizzle/schema/games-dedup-audit.ts:35-37` — `uniqueConflicts` is typed `jsonb.$type<Record<string, number>>()`. Importing `UniqueConflictCounts` from `games-dedup-unique-conflicts.helpers.ts` would tighten the schema-level type to match the helper's output shape. No functional bug; consumers cast at read time today.
  Suggested: tighten on the next touch to either file.

### 2026-05-12 — rok-1158-csp-security-headers (ROK-1158)

- **[low]** `nginx/monolith.conf.template:44-54` and `nginx/default.conf:35-45` — `proxy_hide_header` strips 7 helmet headers (CSP/HSTS/XCTO/XFO/Referrer/Permissions/XXP) but six additional helmet 8.1 defaults pass through to the public surface: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: cross-origin` (override, intentional), `Origin-Agent-Cluster: ?1`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`. All are security-positive (no conflict with nginx's set), but the in-code comment "nginx owns the authoritative public-surface header set" is overstated.
  Suggested: either lock helmet posture explicitly in `api/src/main.helpers.ts::buildHelmetOptions` (`crossOriginOpenerPolicy: false`, `originAgentCluster: false`, `xDnsPrefetchControl: false`, `xDownloadOptions: false`, `xPermittedCrossDomainPolicies: false`), or extend the `proxy_hide_header` list in both nginx files to cover them. Either choice gives the operator one source of truth for the public-surface header posture.
- **[low]** `nginx/monolith.conf.template:38-39` and `nginx/default.conf:29-30` — no comment near the server-scope `include /etc/nginx/snippets/security-headers.conf` warning future devs that any NEW `location` block with its own `add_header` must re-include the snippet (otherwise all 6 security headers are silently dropped on that path). The static-asset block carries the warning; server scope does not.
  Suggested: prepend the include with a one-line comment "NOTE: new locations with custom add_header must re-include this snippet — nginx kills inheritance on the first child add_header. See architect-ROK-1158.md §2."
- **[med]** `api/src/csp-report/csp-report.controller.ts` + `api/src/main.ts:82-88` — spec edge case #2 (malformed JSON → 204) is not honored. `body-parser@2.2.2` default `strict: true` rejects malformed JSON with HTTP 400 before the controller runs, surfaces as 400 not 204. Real-world impact is low (browsers programmatically construct CSP reports, don't produce malformed JSON), but the 60/min `@RateLimit('public')` won't suppress probing by a hostile client and the 400-spam will land in nginx access logs.
  Suggested: add a small express middleware mounted BEFORE the `bodyParser.json({ type: [...] })` call that catches parse failures for the two CSP content-types and short-circuits with `res.status(204).end()`. ~5 lines. Or accept the deviation by amending the spec.
- **[info]** `nginx/snippets/security-headers.conf:7` — HSTS `max-age=31536000; includeSubDomains` pins browsers to HTTPS for 1 year at the prod host (raid.gamernight.net) and all subdomains. Operator should confirm DNS lists no HTTP-only `*.raid.gamernight.net` subdomain (legacy admin tools, image hosts, etc.) before deploy. Operator informed in `planning-artifacts/review-ROK-1158.md` §8; non-blocking.

### 2026-05-12 — /triage (GH #778, RAID-LEDGER-ALERTS-3A)

- **[low]** `api/src/sentry/instrument.ts` `beforeSend` filter — add a CSP-report noise drop, parallel to the existing `no_snapshot_yet` / `ThrottlerException` patterns. GH #778 was a single curl-driven test of `POST /csp-report` with placeholder data (`document-uri: https://example/`, `blocked-uri: https://evil.example/foo.js`, `User-Agent: curl/8.7.1`) yet still produced a production Sentry issue. Once **ROK-1158** (CSP rollout) leaves report-only mode, a few of these test-pattern reports will keep landing whenever the operator probes the endpoint.
  Suggested: drop events when `tags.source === 'csp_report'` AND any of (`user-agent matches /curl|wget|python-requests/i`, `document-uri matches /^https?:\/\/(example|test|localhost)/i`, `blocked-uri matches /evil\.example/i`). Optional: add `@nestjs/throttler` to `POST /csp-report` so a noisy browser can't flood Sentry either. Fold into ROK-1158 if still in flight; otherwise tiny stand-alone PR after it ships.

### 2026-05-13 — rok-1279-prod-clone (ROK-1279) — Codex review findings (non-blocking)

- **[med]** `api/src/backup/backup.controller.ts:54` — `fs.createReadStream(absPath).pipe(res)` has no `.on('error', ...)` handler. TOCTOU between `existsSync` and stream open: if the file is deleted between resolution and stream open (race with rotation cron or operator DELETE), the read stream emits `error` after headers are already sent → client sees 200 + truncated body, Node may surface an unhandled error. Low practical risk (rotation cron only deletes >30d files; admin DELETE flow is operator-only) but cheap to harden.
  Suggested: attach `stream.on('error', err => { this.logger.warn(...); res.destroy(err); })` before the pipe. ~3 lines.
- **[low]** `scripts/clone-prod-to-local.sh:165` — `prod_get_safe` glob `[[ "$pth" != "$PROD_GET_ALLOWED_PREFIX"/*/download ]]` is looser than strict-whitelist intent. Bash `[[ ]]` glob `*` matches `/`, so a path like `/admin/backups/a/b/c/download` passes the bash check. Server-side AdminGuard + path-traversal regex still block any real damage, but cosmetic strictness would close the gap.
  Suggested: replace bash glob with regex check: `[[ ! "$pth" =~ ^/admin/backups/(daily|migration)/[A-Za-z0-9_.-]+/download$ ]]` and the exact list-endpoint match. ~3 lines.
- **[low]** Two backup-path helpers exist for similar intent: `BackupService.getBackupFilePath` (new in ROK-1279; 404-only on traversal) and `BackupService.resolveBackupPath` (existing; uses 400 for traversal — feeds restore/delete). Unify on the 404-only behavior to reduce info leak surface across all path-validated routes. Non-urgent; both are admin-only.

### 2026-05-13 — scheduling-banner queryKey mismatch (surfaced during ROK-1235 review)

- **[low]** `web/src/hooks/use-standalone-poll.ts:29` invalidates `queryClient.invalidateQueries({ queryKey: ['scheduling-banner'] })` but the actual key declared in `web/src/lib/hooks/use-scheduling.ts:28` is `['scheduling', 'banner']` (two-element tuple). TanStack Query matches by prefix array equality, so the invalidation never matches anything → after creating a standalone poll, the events-page scheduling banner is not invalidated and the user must reload or wait for `staleTime` to refresh. Out of scope for ROK-1235 (which fixed the 400-route-shadow); pre-existing.
  Suggested: change line 29 to `queryKey: ['scheduling', 'banner']`. One-line fix. Confirm by triggering "create standalone poll" and watching network for the immediate `/scheduling/banner` refetch.

### 2026-05-13 — full-suite integration test flakes (surfaced during fix/batch-2026-05-13 CI gate)

`./scripts/validate-ci.sh --full` against the batch base produced 2 failures out of 1009 integration tests, neither in any file changed by the batch (24 file diff, neither file present in diff). Both pass 3/3 cleanly in isolation via `./scripts/spec-loop.sh`. Cross-suite carrier flake, NOT caused by this batch.

- **[med]** `api/src/lineups/lineups-matches.integration.spec.ts:GET /lineups/:id/matches › places thresholdMet=true matches in scheduling tier` — fails mid-suite with `socket hang up`. Classic BullMQ/ioredis socket-leak carrier pattern; matches the documented signature in memory `reference_bullmq_ioredis_test_carrier.md` (ROK-1250 / PR #760). Passes 3/3 isolated.
  Suggested: continue the ROK-1250 socket-leak cleanup — the carrier surface keeps surfacing the same class of mid-suite hang. Specific lead: snapshot remote sockets in `closeTestApp` and destroy any held by ioredis when the test app shuts down.
- **[med]** `api/src/events/signups-roster.integration.spec.ts:Signups — admin remove › should allow admin to remove a signup` — fails mid-suite with `createFutureEvent failed: 401 — Unauthorized`. This is a different pattern from the socket leak — admin cookie / JWT state appears to be pre-empted by a sibling spec's auth flow. Passes 3/3 isolated.
  Suggested: bisect the full-suite order to find which spec leaves auth state mutated. Likely candidates: anything that calls `logout` or sets a different-user session and doesn't reset. Add `beforeEach` cookie/JWT reset in the test app factory.

**Why this matters:** `validate-ci.sh --full` will fail on the batch base today, blocking every fix-batch / build / dispatch that runs the full integration gate. Existing memory `reference_bullmq_ioredis_test_carrier.md` documents the socket-leak class; the auth-state-leak (signups-roster) class is new and worth its own slot.

Suggested triage path: two stories — (1) continue ROK-1250 socket cleanup with the new carrier evidence, (2) new auth-state-isolation chore. Estimated 1-3h each. Cheap-experiments-first applies (memory `feedback_cheap_experiments_first`): start with bisect, don't pay for instrumented full-suite loops until the bisect names the polluting predecessor.

### 2026-05-13 — fix/batch-2026-05-13 reviewer findings (medium/low/nitpick — non-blocking)

Findings from senior-code-review on the batch diff. Critical + high were fixed inline (commit c90f98af). Operator deferred the [med] participantCount=1 UX call to ship-as-is.

- **[med]** ROK-1255 / `api/src/lineups/common-ground-context.helpers.ts:119-129` — For a brand-new public lineup with no nominations or votes yet, `participantCount = 1` (just the creator). The auto-set effect in `CommonGroundFilters` then pins the player-count filter to "1 player" on first entry to nomination, filtering the panel to solo games only. The contract definition (nominators ∪ voters ∪ creator) matches the implementation, but the UX is likely surprising for community lineups. Tests cover N=0 fallback but not N=1.
  Suggested: clamp `participantCount` to `Math.max(2, count)` in `resolveParticipantCount` (returns 0 when count is 1, triggers existing fallback), OR skip the auto-set in `CommonGroundFilters` useEffect when `participantCount === 1`. Either approach is a one-line change. Operator approved ship-as-is 2026-05-13; file a follow-up if it surfaces in real use.
- **[low]** ROK-1235 / `api/src/lineups/scheduling/scheduling-banner.integration.spec.ts:42` — Empty-body assertion `expect(res.text === '' || res.body === null || res.body === '').toBe(true)` is fragile. Supertest returns `res.body = {}` for an empty 200, not `null`. Test passes today because of Nest config coincidence; intent is "body is empty/null-ish."
  Suggested: rewrite to `const bodyEmpty = res.text === '' || res.text === 'null' || Object.keys(res.body ?? {}).length === 0; expect(bodyEmpty).toBe(true);`.
- **[low]** ROK-1235 / `api/src/lineups/scheduling/scheduling.controller.ts:38` — `SchedulingController` still declares `@Controller('lineups')` with parametric routes (`:lineupId/schedule/...`). If a future author adds a literal-segment route there (e.g. `@Get('archive')`), the same Nest route-shadow bug recurs because `LineupsController` registers first with `@Get(':id') + ParseIntPipe`.
  Suggested: add a one-line guard comment at the top of `SchedulingController` ("literal-segment routes are forbidden on this controller — only `:lineupId/schedule/...` patterns"), OR migrate the remaining 8 scheduling routes to a `/scheduling/lineups/:lineupId/...` prefix in a future cleanup story.
- **[low]** ROK-1207 / `web/src/lib/lineup-aborted.ts:26-33` — `useMemo` keyed on `data` (full timeline response). Any timeline update (vote, nomination, phase change) re-scans every activity entry. O(n) per refetch — acceptable today (logs are small).
  Suggested: switch to `.find(e => e.action === 'lineup_aborted')` working backwards from end of array if logs ever grow >50 entries. Verify newest-tends-to-be-last ordering first.
- **[low]** ROK-1255 / `api/src/lineups/common-ground-context.helpers.ts:119-129` — `buildScoringContext` already calls `findLineupVoterIds(db, lineup.id)` on line 61. For public lineups, the new `resolveParticipantCount` call is a DUPLICATE of the same query — both fetch the same data, no caching between them.
  Suggested: thread the existing `voterIds` array from `buildScoringContext` through `runCommonGroundForBuildingLineup` so the public path computes `participantCount = voterIds.length` without re-querying. Saves one query per common-ground call on public lineups.
- **[low]** ROK-1255 / `web/src/components/lineups/CommonGroundFilters.tsx:110-117` — `didInitPlayersRef` is set to `true` even when `filters.maxPlayers` was already set (the early-return after marking the ref consumed). Behavior is correct ("capture intent once per known participantCount") but reads like a bug to future maintainers — the name implies "we've successfully auto-set" rather than "we've seen a non-zero count."
  Suggested: rename ref to `participantCountSeenRef` (or `intentCapturedRef`). Mechanical clarification, no behavior change.
- **[nit]** ROK-1235 / `api/src/lineups/scheduling/scheduling-banner.controller.ts:1-8` — Block comment explains the historical bug verbosely. Trim to one line ("Banner endpoint moved out of /lineups/* to avoid ParseIntPipe shadow — see ROK-1235") once the fix has aged. Doc-only.
- **[nit]** ROK-1207 / `web/src/components/lineups/LineupAbortedBanner.tsx:23-26` — `role="status"` with `aria-live="polite"` is correct for live-updating regions, but the banner is painted once on render. Screen readers will announce on first render (intended), but `aria-live` implies subsequent updates that don't happen.
  Suggested: drop `aria-live="polite"` (let `role="status"` carry the polite announcement), or switch to `role="alert"` for a stronger announcement. UX/a11y polish.

### 2026-05-14 — ROK-1281 (prod incident postmortem)

- **[high]** ROK-1278 prod migration 0140 failed on the `games_steam_app_id_unique` partial index creation. Container went FATAL, prod down ~30 min. Root cause: 0140 assumed `games_dedup_audit` was pre-populated by the ROK-1277 union-find cron, but prod's audit had 1 stale row from ROK-1270's original pre-union-find detection. The Slay-2/II steam dup (`steam_app_id=2868840`) was uncatalogued, step 3's DELETE missed it, step 5's CREATE UNIQUE INDEX collided. Local mirror had 17 audit rows because the operator ran the audit cron manually before testing — bug was masked.
  Fixed in ROK-1281 by extracting boot-time migration into `api/src/scripts/run-migrations-with-sentry.ts` which refreshes the audit from scratch via union-find BEFORE drizzle migrate runs.
- **[high]** Sentry never captured the prod migration error. Three gaps: (1) `api/src/scripts/run-migrations.ts` doesn't import `instrument.ts`; (2) the runner uses sync `process.exit(1)` without `Sentry.flush(2000)`; (3) the ACTUAL prod path was an inline `node -e` block in `api/scripts/docker-entrypoint.sh:26-73`, which had no Sentry import at all.
  Fixed in ROK-1281 by routing all boot-time migrations through the new instrumented runner. The legacy `run-migrations.ts` (still used by `backup.service.ts` for restore flows) should follow up — it still has the gap but isn't on the deploy critical path.
- **[med]** `api/src/scripts/run-migrations.ts` is now divergent from the prod path. Either migrate `backup.service.ts` to call `runBootMigrations` from the new runner, or document that `run-migrations.ts` is restore-only. Pick one to avoid a future agent treating them as interchangeable.
  Suggested: replace `runMigrations` in `api/src/backup/backup.helpers.ts:124` with a call to `runBootMigrations(databaseUrl)` from the new runner. Restore flows benefit from the audit refresh + Sentry capture for free.
- **[med]** Prod recovery required manually marking 0140 as applied in `drizzle.__drizzle_migrations` before the new image could boot. This pattern (insert hash row to skip a failed migration) is not documented anywhere — operator had to derive it. Add a `scripts/recover-stuck-migration.sh` runbook.
  Suggested: a script that takes a migration tag, looks up its hash from `meta/_journal.json`, inserts the journal row, and prints next-steps. Idempotent.

### 2026-05-14 — fix/rok-1283 (ROK-1283 follow-up)

- **[low]** `api/scripts/seed-games.ts` — sibling of `seed-igdb-games.ts` audited as part of ROK-1283. Same shape (`ON CONFLICT (slug) DO NOTHING`), same NULL-distinct vulnerability in principle. Practically dormant in prod: its slugs match `seed-igdb-games.ts` AND post-ROK-1278 cleanup left no name dups for this seed's names to collide with. Was NOT fixed in ROK-1283 because the file already exceeds `max-lines` (302/300) on `origin/main` and applying the same fix would push it further over; CI lint would fail. Apply the name-dedup guard the next time this file is touched, alongside breaking up the `GAMES_SEED` constant (move to a sibling `seed-games.data.ts`) to bring the file back under 300 effective lines.
  Suggested: extract `GAMES_SEED` to `api/scripts/seed-games.data.ts` (no logic, just data) and apply the same `findGameByNormalizedName` pre-check pattern used in `seed-igdb-games.ts::upsertSeedGames`.

### 2026-05-14 — fix/batch-2026-05-14 (PR pending — ROK-1282 + ROK-1283)

- **[low]** `api/src/users/guild-reconciliation.service.ts:107-109` — dead-code `rows.filter((r): r is { id: number; discordId: string } => r.discordId !== null)`. SQL already guarantees `isNotNull(discordId)` so the filter never drops a row.
  Suggested: drop the filter and tighten the return type via a non-null assertion or Drizzle column-level non-null inference.
- **[low]** `api/src/users/guild-reconciliation.service.ts:113-123` — `deactivateGap` runs deactivations sequentially. Fine at current scale (~5–10 leavers per run on a 500-user guild), but a post-outage run with hundreds of leavers serialises per-row cascades (cancel signups + admin notification).
  Suggested: keep sequential for now (audit-trail simplicity); revisit if a single run ever exceeds ~50 deactivations.
- **[low]** `api/src/users/guild-reconciliation.service.ts:93-106` — `loadActiveDbUsers` has no index on `deactivated_at` and full-scans `users` daily. Acceptable at current user volume; index becomes relevant past several thousand rows.
  Suggested: revisit if cron duration exceeds ~1s on prod.


### 2026-05-14 — fix/batch-2026-05-14 (post-Codex reviewer pass)

- **[low]** `api/src/common/testing/test-app.ts:122` vs `api/src/common/testing/integration-setup.ts:64` — inconsistent CI gating. `test-app.ts` uses strict `process.env.CI === 'true'` after the post-clone audit fix; `integration-setup.ts` uses loose `!process.env.CI`. Both behave correctly under GitHub Actions (`CI=true`) but a developer setting `CI=1` locally would get DATABASE_URL deleted by integration-setup yet ignored anyway by test-app (Testcontainers fires).
  Suggested: align both to `process.env.CI === 'true'`. ~5-line change in `integration-setup.ts`.
- **[low]** `api/scripts/seed-igdb-games.ts:181-194` — extra DB roundtrip via `rowExistsWithIgdbId` per orphan-match row. Acceptable at boot-time (~hundreds of rows, single-threaded). Could fold into a single SQL CTE if seed counts grow into the thousands.
  Suggested: no action unless seed perf becomes a bottleneck.
- **[low]** `api/src/users/guild-reconciliation.service.integration.spec.ts:137-146` — the "Discord API errors bubble up" test calls `runReconciliation()` directly, not via `CronJobService.executeWithTracking`. Confirms the throw bubbles but doesn't assert the cron wrapper records a failed run vs. healthy heartbeat (which is the actual P2 motivation). Integration with `executeWithTracking` is likely already covered by existing cron-service tests but not explicitly asserted in this regression spec.
  Suggested: add one spec that mocks `cronJobService.executeWithTracking` and asserts `failedRun` was recorded when `listAllGuildMemberIds` throws.


### 2026-05-14 — fix/rok-1243 worktree (surfaced during ROK-1243 implementation)

- **[nit]** `tools/test-bot/scripts/no-sleep-lint.sh` flags the *comment* on `tools/test-bot/src/smoke/tests/lineup-abort.test.ts:26` (`Use \`pollForEmbed\` (NEVER \`sleep()\`) to look for the channel`). The grep pattern is too coarse — it matches `sleep()` anywhere in source files including doc comments. Reproduces on a clean `origin/main` checkout; unrelated to ROK-1243.
  Suggested: tighten the lint pattern to exclude single- and multi-line comment lines, or update the lineup-abort.test.ts comment to escape the `sleep()` token (e.g. backticks already there but the script doesn't honor them). Easiest fix: rewrite the comment as "Use pollForEmbed instead of fixed delays."

### 2026-05-14 — fix/batch-2026-05-14 (surfaced during ROK-1242 smoke validation)

- **[low]** Playwright full-suite flakes during ROK-1242 batch run (`scripts/smoke/events.smoke.spec.ts:370` Regression-ROK-784 light-mode attendance + `scripts/smoke/scheduling-poll.smoke.spec.ts:771` "Your Other Scheduling Polls"). Neither touches the ROK-1242 / ROK-1243 changed surface. Symptom matches the cross-cutting full-suite contention pattern already documented under the 2026-05-14 rok-1252-lineup-banner-counts section (line 316+).
  Suggested: same as the ROK-1252 grouping — bump per-test timeouts OR split the 840-test suite into smaller parallel-friendly chunks. Five other flakes in the same ROK-1242 run (community-lineup:491, navigation:22/161, notifications:20, lineup-carryover:165) match the existing documented set exactly; no new entries needed.

### 2026-05-15 — rok-1036-allinone-privilege-drop (surfaced during ROK-1036 validate-ci)

- **[med]** `npx tsc --noEmit -p api/tsconfig.json` errors in 5 spec files (10 errors total) on `origin/main` — reproduces on a clean stash of the ROK-1036 changes, so unrelated to this story:
  - `api/src/admin/games-dedup-audit.integration.spec.ts:386` — TS2769 (no overload matches `db.execute(sql\`...\`)` call shape).
  - `api/src/admin/games-dedup-audit.service.spec.ts:432` — TS2502 (`tx` referenced directly or indirectly in its own type annotation).
  - `api/src/admin/games-dedup-merge.integration.spec.ts:139,149,160` — TS2352 (drizzle `RowList<{ totalSeconds }>` vs hand-written `{ total_seconds }` cast mismatch; snake_case vs camelCase column mapping).
  - `api/src/lineups/lineup-deadline-vote-race.integration.spec.ts:186` — TS2345 (`SQL<unknown>` from one drizzle copy not assignable to `SQLWrapper` from another copy — duplicate drizzle-orm in node_modules causing nominal-type drift).
  - `api/src/lineups/lineup-notification.service.private-visibility.spec.ts:108,114,120,126` — TS2556 (spread argument needs tuple type — `expect.objectContaining(...args)` shape after recent type bump).
  Suggested: align the merge-integration test casts to drizzle's camelCase return shape (rename `.total_seconds`→`.totalSeconds`, `.game_id`→`.gameId` in the local cast types); for the SQL nominal drift, dedupe `drizzle-orm` in `package-lock.json` (npm dedupe + commit lock) so a single copy is resolved; for the spread errors, rewrite the assertion call sites to pass an inline tuple. All four files are integration/spec — not blocking CI lint, but `--noEmit` typecheck fails locally and on CI's lint job.

- **[nit]** `tools/test-bot/scripts/no-sleep-lint.sh` still flags the comment on `tools/test-bot/src/smoke/tests/lineup-abort.test.ts:26` (same entry under fix/rok-1243 worktree) — reproduces on origin/main, still unresolved.

### 2026-05-16 — security-review 2026-05-14 PR 3 defense-in-depth (Group C deferred from ROK-1292)

ROK-1292 closed 2026-05-16. PR 1 (Group A — 4 docker-compose / allinone JWT-guard items + BANNED_SECRETS symmetry + CI negative-path test) shipped as PR #795 + #796. PR 2 (Group B — drop SVG from branding `ALLOWED_TYPES` + boot-time legacy `logo.svg` eviction + `bestEffortInit` classification) shipped as PR #797. Group C below is the remaining 10 app-code defense-in-depth items + 2 sibling/completeness findings, originally planned as PR 3. Operator decision to leave PR 3 in the backlog rather than carry an open Linear story for it — items will be triaged into a future fix-batch or build when convenient. Source reports preserved at `planning-artifacts/security-review-7bec0fb2-fullrepo.md` + `planning-artifacts/security-review-7bec0fb2-summary.md`.

**Group C — App-code defense-in-depth:**

- **[med]** `api/src/ai/ai-providers.controller.ts:60-73, 234-250` — `@Body() body: AiProviderConfigDto` is a TS type alias only; no `ValidationPipe`, no Zod parse. `body.apiKey` / `body.url` / `body.model` persisted via `settings.set()` as-is. Admin-gated so external impact is low, but data-integrity / settings-cache corruption / log tampering possible from inside an admin session.
  Suggested: add `AiProviderConfigSchema` to `packages/contract` and `.parse(body)` at controller, OR convert DTO to class-validator with paired `ValidationPipe`.
- **[med]** `api/src/main.ts:23-46` (`installAutoClientUrlDetection`) — When `CORS_ORIGIN === 'auto'` and `CLIENT_URL` unset, first request writes `process.env.CLIENT_URL` from unverified `Host` + `X-Forwarded-Proto` headers. No allow-list. In direct-access deployment (no nginx normalization), one crafted request poisons `CLIENT_URL` for process lifetime — flows into OG-embed redirects, OAuth callbacks, Discord magic-link bodies. Synology + nginx mitigates in practice; code doesn't enforce the contract.
  Suggested: in `auto` mode, require `ALLOWED_HOSTS` env var (comma-separated allow-list) and reject non-matching `Host` headers before mutating env. Better: derive `CLIENT_URL` per-request via request-scoped helper instead of mutating `process.env`.
- **[med]** `api/src/auth/magic-link.service.ts:36-49` + `web/src/App.tsx:42-56` — 15-min JWT shipped as `?token=` in URL sent to Discord. Frontend strips query AFTER page load (already too late — Discord link-tracker, browser history, HTTPS proxies, Referer headers may have logged it). `magicLink: true` claim NOT enforced downstream — JWT interchangeable with a normal login token. No single-use enforcement: captured magic link grants 15 min of full account impersonation.
  Suggested: store `jti` in Redis at issue (`setex(jti, 900, '1')`), `getdel` on consumption, reject if absent. Add magic-link-only guard requiring `magicLink === true` and refusing write endpoints. Best long-term: server-side `/auth/redeem-magic-link` POST instead of GET-with-query.
- **[med]** `api/src/settings/encryption.util.ts:32-37` (`deriveKey`) — Salt built as `Buffer.from(secret.slice(0, 32).padEnd(32, '0'))`. Salt derived deterministically from the secret defeats the salt's purpose. Acceptable for per-process JWT_SECRET use-case in isolation; dangerous if reused for password hashing. Short JWT_SECRET values get padded with literal `'0'` chars, weakening entropy.
  Suggested: persist a process-local random 32-byte salt in `app_settings` (`encryption_salt`), pass explicitly. At minimum add a code comment marking this pattern as JWT-secret-only and forbidding reuse for password storage.
- **[low]** `api/src/steam/steam-auth.controller.ts:233-255` + `api/src/steam/steam-http.util.ts:49-81` — Steam-OpenID nonce replay protection currently relies on Steam (`mode=check_authentication`). We don't cache `openid.response_nonce` ourselves. Replay risk low (only re-links the same Steam ID to the same user); layered-defense story missing.
  Suggested: after successful link, `redis.setex(`steam-openid:${nonce}`, 86400, '1')` and reject if already present.
- **[low]** `api/src/auth/jwt.strategy.ts:28` — `process.env.JWT_SECRET!` non-null assertion at construction. If env var missing in prod, passport-jwt receives `undefined` as `secretOrKey` and may either crash at boot or accept tokens signed with an empty key.
  Suggested: throw at module init if `JWT_SECRET` missing or < 32 chars (fail-closed).
- **[low]** `api/src/auth/auth.controller.ts:48-67` (`exchangeCode`) — `redis.get` then `redis.del` is not atomic. Two simultaneous requests with the same code could both retrieve, both `del`, both succeed. Single-use semantics claimed in code comment but not enforced.
  Suggested: replace with `redis.getdel(key)` (Redis 6.2+) or wrap in `MULTI/EXEC`.
- **[low]** `api/src/csp-report/csp-report.controller.ts:14-32` — Logs full CSP report payload to structured logger. 64kb body limit caps abuse but an attacker producing CSP violations can spam logs with arbitrary content reaching the configured log sink.
  Suggested: cap and redact (`JSON.stringify(report).slice(0, 4096)`), or rely on Sentry tags + sampling and skip the second log line.
- **[low]** `api/src/plugins/wow-common/blizzard-equipment.helpers.ts:25-52` (`fetchSingleIconUrl`) — Sends `Bearer ${token}` Authorization header to a URL pulled from parent Blizzard JSON response (`equipped_items[].media.key.href`) without host validation. If a future Blizzard endpoint returns a non-Blizzard URL (or MITM injects one), bearer leaks to third-party host.
  Suggested: assert `new URL(mediaHref).hostname.endsWith('blizzard.com') || .endsWith('battle.net')` before fetch.
- **[low]** `api/src/version/version-check.service.ts:144` → `web/src/components/admin/UpdateBanner.tsx:48` — `latestReleaseUrl` flows from GitHub's `body.html_url` through `app_settings` to a JSX `<a href={href}>`. Zod's `z.string().url()` allows `javascript:` URLs (uses URL constructor which accepts them), so contract doesn't block scheme-based XSS. Trusted source today; defense-in-depth one-liner.
  Suggested: validate `href.startsWith('https://github.com/')` either at storage step in `storeVersionCheckResults` (reject otherwise, store empty) OR at render time in `BannerContent`.

**Sibling/completeness findings (surfaced by `/validate` + `/code-review` over PR 1):**

- **[low]** `docker-compose.test.yml` (sibling to `docker-compose.yml`) binds `5433:5432` for the test Postgres — same wide-open `0.0.0.0` exposure as the main compose file before PR 1. Out of scope for the PR1 framing but the obvious sibling to harden.
  Suggested: change to `"127.0.0.1:5433:5432"`. Same risk profile, same one-line fix.
- **[nit]** `api/scripts/reencrypt-settings.ts:116` — recovery-instructions help text bakes the literal `raid-ledger-default-secret-change-in-production` into a `console.log` example. Not in `BANNED_SECRETS` scope (it's documentation), but if the literal naming is ever rotated this is a 4th replication site to update (alongside `Dockerfile.allinone`, `docker-entrypoint.sh`, `encryption.util.ts`).
  Suggested: leave for now; flag if anyone proposes renaming the legacy literal.

### 2026-05-15 — rok-1292-pr1-local-env-hardening (surfaced during validate-ci.sh typecheck)

- **[low]** `api/src/version/version.controller.spec.ts:15+` and `api/test/app.e2e-spec.ts:7+` — `npx tsc --noEmit -p api/tsconfig.json` fails with `TS2593: Cannot find name 'describe'/'it'/'beforeEach'` and `TS2304: Cannot find name 'expect'/'jest'`. Reproduces on a clean `origin/main` checkout (verified via `git stash` + retry). Jest types resolve fine when running the specs (`npm run test -w api -- <spec>` works), so the issue is config-only — these spec files aren't picked up by the same `types: ['jest']` resolution that other specs use. CI doesn't catch this because GitHub Actions uses `tsconfig.build.json` (which excludes specs), but `scripts/validate-ci.sh::run_typecheck` (line 112) uses the full `tsconfig.json` and trips. Result: anyone running `./scripts/validate-ci.sh --full` locally sees a noisy "regression" that isn't theirs.
  Suggested: add `"types": ["jest", "node"]` to `api/tsconfig.json` (or move the spec includes into a tsconfig that picks up `@types/jest`). One-line fix per file once the right tsconfig is identified.


### 2026-05-15 — rok-1292-pr2-branding-svg-xss (surfaced during npx playwright test)

5 Playwright smoke failures on the deployed worktree env. None touch branding, admin, or any file my 4-file PR 2 diff (`branding.controller.ts` + 3 frontend `accept=` attrs) modifies. Classified pre-existing per the diff-scope-mismatch heuristic; not re-running against `origin/main` because the carrier files are all in lineup code that PR 2 doesn't touch.

- **[med]** `scripts/smoke/community-lineup.smoke.spec.ts:491` (both desktop + mobile) — `Voting phase › leaderboard renders sorted by vote count descending` fails with `expect(locator).toBeVisible() Timeout: 15000ms / element(s) not found`. Same `?test=open-lineup-modal` modal-materialise flake class as the existing 2026-05-12 ROK-1068 entry (line 97 above), at a new line. Same suggested fix applies.
- **[med]** `scripts/smoke/lineup-admin-abort-phases.smoke.spec.ts:121` (both desktop + mobile) — `Admin abort from {building,voting} › POST /lineups/:id/abort succeeds and flips status to archived` fails at `expect(before?.status).toBe(phase)` — the lineup fixture isn't in the expected phase before the abort call. Classic worker-isolation race with the cross-worker active-lineup state; matches the ROK-1068 root cause but on a different spec file.
  Suggested: gate the abort spec on the same per-worker prefix isolation pattern used by ROK-1147 / ROK-1227, OR seed the lineup directly via the DEMO_MODE test API to skip the fixture race entirely.
- **[low]** `scripts/smoke/lineup-confirmation-pills-invitee.smoke.spec.ts:127` (mobile only) — `Building phase — invitee hero variants › invitee-acted: hero flips to waiting tone after nomination` fails with `data-tone` returning `"action"` after 14 polls instead of expected `"waiting"` (5s timeout). Hero-tone state is derived from the lineup's invitee snapshot — likely the same cross-worker bleedover. Desktop passes.
  Suggested: poll for the underlying nomination state via API before asserting the derived `data-tone`, OR isolate the invitee fixture per worker so the snapshot isn't racing the global lineup state.

### 2026-05-16 — rok-1294-journey-hero (surfaced while fixing the ROK-1292 PR 2 branding regression)

The ROK-1292 PR 2 regression was patched in this PR (commit `55475fb1`) by adding a `RAID_LEDGER_BRANDING_DIR` env override and sandboxing the integration spec to `os.tmpdir()`. Two related foot-guns remain in the codebase — not blocking, worth filing.

- **[med]** `api/src/users/avatar.service.ts:44` and `api/src/main.ts:53-58` — same `process.cwd()/uploads/avatars` anti-pattern as the pre-fix branding code. Currently SAFE because no existing avatar spec writes/unlinks against that dir. If a future avatar integration spec copies the pre-fix branding pattern (`path.join(process.cwd(), 'uploads', 'avatars')` + `unlinkSync` in `afterEach`), it will wipe the operator's real local avatar webps in main repo `api/uploads/avatars/`.
  Suggested: harden defensively — either (a) rename the existing `AVATAR_UPLOAD_DIR` override to match the new `RAID_LEDGER_*` convention and document both, OR (b) make the dev default for both branding + avatars resolve to a non-`process.cwd()`-anchored path so `npm run test -w api` cwd assumptions can't collide with the dev-served dir.
- **[low]** Root-cause-vs-symptom: the production `getBrandingDir()` still returns `process.cwd()/uploads/branding` in dev. Any future spec / seed / script that doesn't honor `RAID_LEDGER_BRANDING_DIR` can re-introduce the wipe. A real fix would either anchor the dev path off something non-`process.cwd()`-relative (e.g. a fixed `~/.raid-ledger/dev-uploads/` location) OR refuse destructive writes when `NODE_ENV !== 'production'` and the target path matches the static-asset-served dir.
  Suggested: defer until/unless another team member's spec re-trips the same bug. The env-var override + new regression test (added in this PR) is the minimum-effective fix.

### 2026-05-16 — rok-1294-journey-hero (surfaced during npx tsc --noEmit -p api/tsconfig.json)

10 pre-existing TypeScript errors in `api/src` test files. None caused by ROK-1294's diff. The dev's CI proof for ROK-1294 ran `npx tsc --noEmit -p web/tsconfig.json` (web only) + `npm run build -w api` (which uses `nest build` and excludes `*.spec.ts` per `tsconfig.build.json`), so these never surfaced — they only appear when typechecking the full `api/tsconfig.json` including specs. Worth deciding whether the api/CI step should compile specs.

- **[low]** `api/src/admin/games-dedup-audit.integration.spec.ts:386` — `TS2769: No overload matches this call`. Drizzle query builder type mismatch.
- **[low]** `api/src/admin/games-dedup-audit.service.spec.ts:432` — `TS2502: 'tx' is referenced directly or indirectly in its own type annotation`. Recursive type in transaction mock.
- **[low]** `api/src/admin/games-dedup-merge.integration.spec.ts:139,149,160` (3 errors) — `TS2352: Conversion of type 'RowList<{...}>' to type '{...}' may be a mistake`. Test-side type assertion mismatches between Drizzle's camelCase result and snake_case fixture shape.
- **[low]** `api/src/lineups/lineup-deadline-vote-race.integration.spec.ts:186` — `TS2345: Argument of type 'SQL<unknown>' is not assignable to parameter of type 'string | SQLWrapper'`. Cross-package drizzle-orm version mismatch in private types (`shouldInlineParams`).
- **[low]** `api/src/lineups/lineup-notification.service.private-visibility.spec.ts:108,114,120,126` (4 errors) — `TS2556: A spread argument must either have a tuple type or be passed to a rest parameter`. Type narrowing failure on a generic mock.
  Suggested: most are 1-2 line fixes (add `as { ... }[]` cast or narrow the mock signature). The drizzle-orm cross-package mismatch may be a workspace nohoist issue.

### 2026-05-16 — fix/batch-2026-05-16 (surfaced during Playwright sweep on batch)

Pre-existing Playwright failures confirmed independent of batch (ROK-1258 + ROK-1306) changes. The `lineup-confirmation-pills-invitee.smoke.spec.ts` failures reproduced verbatim on `origin/main` (`git switch --detach origin/main` + targeted re-run, 3 desktop failures identical). `navigation.smoke.spec.ts:22` PASSED in isolation on the batch (`--workers=1`), proving cross-worker race not regression. ROK-1258 frontend changes are gated on `visibility === 'private'`; the failing community-lineup specs use public fixtures and never enter that codepath. ROK-1306 is backend-only (lineup matching + scheduling route guard) and doesn't touch the failing UI surfaces.

- **[low]** `scripts/smoke/lineup-confirmation-pills-invitee.smoke.spec.ts:127` (desktop — expansion of the prior 2026-05-15 mobile-only entry) — `Building phase — invitee hero variants › invitee-acted: hero flips to waiting tone after nomination` fails with `data-tone='action'` instead of `'waiting'` even in `--workers=1` isolation on `origin/main`. The carrier is the fixture: `apiPost(.../nominate)` returns, `awaitProcessing` drains BullMQ, but the subsequent navigation+reload still reads a snapshot where the invitee's nomination hasn't propagated to the `hasUserActedInPhase` branch. Not workers race — likely the lineup-detail query's 15s `staleTime` (memory `feedback_smoke_polling_for_async_writes.md`) serving the pre-nomination cache, OR the auto-advance grace job changing the lineup phase mid-test.
  Suggested: in the `beforeEach`/`beforeAll` that runs the nomination, also poll `apiGet(.../lineups/:id)` until `entries.some(e => e.nominatedBy.id === invitee.userId)` returns true before navigating the page; OR add `?nocache=...` query param to defeat TanStack staleTime on the navigation. Same suggestion applies to :180 and :210.
- **[low]** `scripts/smoke/lineup-confirmation-pills-invitee.smoke.spec.ts:180` (both projects, also reproduces on `origin/main`) — `Voting phase — per-row checkmark for invitee › invitee's voted row renders ✓ marker and data-voted='true'` fails with `locator('[data-testid="leaderboard-row"][data-voted="true"]')` resolving to 0 elements. Same underlying race as :127 — the vote landed, but the page render reads a stale detail snapshot before the vote propagates.
- **[low]** `scripts/smoke/lineup-confirmation-pills-invitee.smoke.spec.ts:210` (both projects, also reproduces on `origin/main`) — `invitee-acted: voting hero flips to waiting tone after one vote` fails with `data-tone='action'` instead of `'waiting'`. Identical fixture race to :127 / :180.
- **[low]** `scripts/smoke/community-lineup.smoke.spec.ts:506` (desktop) — `Voting phase › clicking a game row toggles vote with emerald accent and filled checkmark` fails with `[data-testid="voting-leaderboard"]` not visible after 15s. Same modal-materialise + cross-worker race class as the documented `:491` entry (2026-05-15 above) and the prior `:184/:548/:316` entries (2026-05-12 ROK-1068). New line number; same root cause.
- **[low]** `scripts/smoke/community-lineup.smoke.spec.ts:316` (mobile) — `Community Lineup detail page › shows nomination grid or empty state` fails with `getByRole('heading', { name: /Smoke Lineup|Lineup — / })` not found. The page snapshot shows `Next: Nothing to do — this lineup was cancelled.` — cross-worker bleedover where another worker archived the active lineup mid-test. Same root cause as the 2026-05-12 ROK-1068 entries.
- **[low]** `scripts/smoke/navigation.smoke.spec.ts:22` (desktop) — `Navigation (desktop) › nav links navigate to correct pages` fails with `expect(page).toHaveURL(/\/calendar$/)` because the actual URL is `http://localhost:5173/calendar?date=2026-05-16` — the Calendar page auto-appends a `?date=` query param on mount (visible in error context: route header reads `/calendar` but the URL has the query string). The test's regex anchor `$` doesn't allow the query string. Passes in isolation (`--workers=1` on the batch), so it's an interaction with the auto-append timing under full-suite load. ROK-1247's previous fix didn't account for the date query param.
  Suggested: change the regex to `/\/calendar(\?|$)/` or drop the `$` anchor; this is a 1-line test fix.

### 2026-05-16 — fix/batch-2026-05-16 (surfaced by code review of ROK-1258 + ROK-1306)

Reviewer (sonnet, devedup-rl:reviewer) verdict PASS WITH NOTES on the batch diff. No critical/high findings. Browser validation also clean (see `planning-artifacts/chrome-mcp-summary-fix-batch-2026-05-16.md`). The 7 low items below are nits/cleanup; none block ship.

- **[low]** `api/src/lineups/lineups-matching.helpers.ts:36,76,106` — Comments claim `decided`/`scheduled`/`archived` match rows are preserved, but `communityLineupMatches.status` enum is `suggested|scheduling|scheduled|archived` (no `decided`). The word `decided` here refers to the lineup status, not the match status. Code is correct (wipe only deletes `suggested`/`scheduling`); the wording is misleading for the next reader.
  Suggested: drop `decided` from the preserved-list in the three comments.
- **[low]** `api/src/lineups/quorum/quorum-voters.helpers.ts:62` — `Date.now() < deadline.getTime()` is TZ-safe because `phaseDeadline`/`votingDeadline` are `timestamp` columns (UTC epoch) and both sides compare as ms-since-epoch. Worth a one-line note so the next reader doesn't worry.
  Suggested: add `// UTC ms vs UTC ms — TZ-safe`.
- **[low]** `packages/contract/src/lineup.schema.ts:241` ↔ `web/src/pages/lineup-detail-page.tsx:274` — `stillWaitingOnVoters` is non-optional in the contract, but the page reads it with `?.length ?? 0`. Either tighten the frontend (`.length > 0`) or mark the contract field `.default([])` for forward-compat with cached older responses.
  Suggested: drop the `?.` in the page since the contract guarantees the array.
- **[low]** `api/src/lineups/lineups-response.helpers.ts:154-176` — `loadStillWaitingOnVoters` runs an extra `GROUP BY userId` aggregate on every `GET /lineups/:id` when status=voting+private. Selective (filtered by `lineupId`, backed by `uq_lineup_vote_user_game`'s leading column) so not a hotspot today, but it's serial after the parallel batch.
  Suggested: fold into the existing `Promise.all` batch in `buildDetailResponse`.

### 2026-05-16 — rok-1272-smoke-shard (surfaced during actionlint sweep)

`actionlint .github/workflows/ci.yml` reports 3 pre-existing shellcheck warnings, all unrelated to the ROK-1272 timeout/retry/cache edits. Reproduces on `origin/main` verbatim. Documenting per the STRICT pre-existing-failures rule; not in-scope to fix here.

- **[nit]** `.github/workflows/ci.yml:274` — SC2034 from shellcheck: `i appears unused. Verify use (or export if used externally)`. The `for i in $(seq 1 60); do ... done` API-readiness wait loop uses `$i` only inside the success branch (`exit 0` before the echo runs), so on the failing path `i` is genuinely unused. Cosmetic; the loop is correct.
  Suggested: rename `i` to `_` (bash convention for unused loop var) or echo `$i` in the final timeout message (`echo "API failed to start within ${i}s"`).
- **[nit]** `.github/workflows/ci.yml:416` — SC2034 same pattern as line 274, this time on the Postgres-readiness wait loop (`for i in $(seq 1 30)`). Same fix.
- **[nit]** `.github/workflows/ci.yml:742` — SC2126 from shellcheck: `Consider using 'grep -c' instead of 'grep|wc -l'`. Stylistic; behavior identical.
  Suggested: replace `grep ... | wc -l` with `grep -c ...` (single fork instead of two).
- **[low]** `api/src/lineups/lineups-response.helpers.ts:161` — `lineup.maxVotesPerPlayer ?? 3` duplicates the `3` default that already lives in `mapLineupCore` (line 104).
  Suggested: extract `DEFAULT_MAX_VOTES_PER_PLAYER` or read the mapped value.
- **[low]** `api/src/lineups/lineups.service.ts:370` — `maybeAutoAdvance` fires on every invitee removal even when status is `decided`/`archived` (cheap internal no-op, but a wasted round-trip).
  Suggested: short-circuit on lineup status before the call, or document that `maybeAutoAdvance` already gates by status.
- **[low]** `api/src/lineups/quorum/quorum-voters.helpers.ts:65-72` — `findDistinctVoters`/`findDistinctNominators` re-queried serially after `loadPrivateExpectedVoters`. Two sequential round-trips where one combined query would do.
  Suggested: run roster + participant fetch in `Promise.all`.
