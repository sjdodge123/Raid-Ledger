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

Both findings from this section are now tracked in Linear: BullMQ socket-leak carrier in [[ROK-1268]] (cross-batch evidence appended); auth-state leak in [[ROK-1321]] (new story, distinct cluster from socket-leak).

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
- **[med]** Prod recovery required manually marking 0140 as applied in `drizzle.__drizzle_migrations` before the new image could boot. This pattern (insert hash row to skip a failed migration) is not documented anywhere — operator had to derive it. Add a `scripts/recover-stuck-migration.sh` runbook.
  Suggested: a script that takes a migration tag, looks up its hash from `meta/_journal.json`, inserts the journal row, and prints next-steps. Idempotent.

(The `run-migrations.ts` divergence bullet that originally lived here is now tracked in [[ROK-1322]].)

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

### 2026-05-15 — rok-1036-allinone-privilege-drop (surfaced during ROK-1036 validate-ci)

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

### 2026-05-16 — rok-1294-journey-hero (surfaced while fixing the ROK-1292 PR 2 branding regression)

The ROK-1292 PR 2 regression was patched in this PR (commit `55475fb1`) by adding a `RAID_LEDGER_BRANDING_DIR` env override and sandboxing the integration spec to `os.tmpdir()`. Two related foot-guns remain in the codebase — not blocking, worth filing.

- **[med]** `api/src/users/avatar.service.ts:44` and `api/src/main.ts:53-58` — same `process.cwd()/uploads/avatars` anti-pattern as the pre-fix branding code. Currently SAFE because no existing avatar spec writes/unlinks against that dir. If a future avatar integration spec copies the pre-fix branding pattern (`path.join(process.cwd(), 'uploads', 'avatars')` + `unlinkSync` in `afterEach`), it will wipe the operator's real local avatar webps in main repo `api/uploads/avatars/`.
  Suggested: harden defensively — either (a) rename the existing `AVATAR_UPLOAD_DIR` override to match the new `RAID_LEDGER_*` convention and document both, OR (b) make the dev default for both branding + avatars resolve to a non-`process.cwd()`-anchored path so `npm run test -w api` cwd assumptions can't collide with the dev-served dir.
- **[low]** Root-cause-vs-symptom: the production `getBrandingDir()` still returns `process.cwd()/uploads/branding` in dev. Any future spec / seed / script that doesn't honor `RAID_LEDGER_BRANDING_DIR` can re-introduce the wipe. A real fix would either anchor the dev path off something non-`process.cwd()`-relative (e.g. a fixed `~/.raid-ledger/dev-uploads/` location) OR refuse destructive writes when `NODE_ENV !== 'production'` and the target path matches the static-asset-served dir.
  Suggested: defer until/unless another team member's spec re-trips the same bug. The env-var override + new regression test (added in this PR) is the minimum-effective fix.

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

### 2026-05-16 — fix/batch-2026-05-16b (reviewer findings, sonnet)

Reviewer verdict PASS WITH NOTES on the batch diff. 0 critical/high/medium, 6 low/nit. Chrome MCP gate PASS for ROK-1305 (chip + modal + label-update verified in browser). None block ship.

- ~~**[low]** `web/src/components/calendar/calendar-filter-chip.tsx:11-15` — `formatChipLabel` ambiguous for "0 selected" state.~~ **RESOLVED in this same batch.** Codex pre-push surfaced that this was actually a P2 correctness bug, not a [low] cosmetic — `CalendarView.tsx:92-93` filters out ALL events when `selectedGames` is defined but empty, so the chip's "Filter: All games" was the literal opposite of reality. Fixed by adding an explicit `selectedCount === 0 → "Filter: No games"` branch; test in `calendar-page.test.tsx:247` updated to assert the corrected label.
- **[low]** `web/src/components/calendar/calendar-styles.css:614-631` — new `.calendar-filter-chip` rule lives only in the dark-theme block; no light-theme override under `:is([data-scheme="light"], ...)`. On light themes (`light`, `quest-log`, `sky`, `dawn`, `holy`, `celestial`) the chip renders with dark slate colors on a light surface — readable but visually inconsistent with the sibling `.sidebar-action-btn` which DOES have a light override at line 1390.
  Suggested: add a 4-line light override mirroring `.sidebar-action-btn` (background `rgba(226, 232, 240, 0.6)`, border `rgba(203, 213, 225, 0.5)`, color `#334155`).
- **[low]** `web/src/pages/calendar-page.tsx:108,164-170` — `CalendarSidebar` still declares `toggleGame`, `selectAllGames`, `deselectAllGames`, `likedSlugs` props even though only `allKnownGames`, `selectedGames`, `onShowFilterModal` are consumed. Unused props forwarded via `{...filterProps}` keep TS happy but over-promise the type contract.
  Suggested: narrow `CalendarSidebar`'s prop type to the 3 it consumes.
- **[low]** `web/src/pages/calendar-page.tsx:113-117` — `GameItem` is locally re-declared with `{ slug, name, coverUrl }` even though `GameInfo` is already exported from `../stores/game-filter-store` (used by `calendar-filter-chip.tsx`). Same shape; duplication invites drift.
  Suggested: import `GameInfo` from `../stores/game-filter-store` and replace local `GameItem`.
- **[nit]** `api/src/admin/games-dedup-union-find.helpers.ts:173-178` — sort uses `Number(a) - Number(b)` for `igdb`/`steam`. Currently safe (columns are `integer`), but a future schema change loosening the column type would produce `NaN` ordering.
  Suggested: add a one-line comment noting numeric strings are guaranteed by the integer column type.
- **[nit]** `api/src/admin/games-dedup-audit.service.spec.ts:172-178,431-434` — `.orderBy()` thenable extension is structurally identical in two mock blocks. Will rot if the load query gains another chain step.
  Suggested: extract a `mockLoadGameRowsChain(loadRows)` helper when next touching this file.

### 2026-05-16 — rok-1296-submit-bar (surfaced during ROK-1296 validate-ci.sh sweep)

`validate-ci.sh --full` against `rok-1296-submit-bar` (commit `34727e88`) failed integration tests with 16 cascading failures in a single suite — `beforeAll` hook timeout → every `it` then fails with `TypeError: Cannot read properties of undefined (reading 'post')` because `request` was never bound. Standalone runs of the same suite are clean (16/16 in 6.25s); full standalone `npm run test:integration -w api` is also clean (1056/1056 in 458s). Failure only manifests under `validate-ci.sh` after the unit-tests-with-coverage phase. Classic carrier-load fingerprint — same class as the `backup.integration.spec.ts:502` entry documented earlier today and as ROK-1250's BullMQ/ioredis socket-leak class (memory `reference_bullmq_ioredis_test_carrier.md`).

- **[med]** `api/src/taste-profile/taste-profile.integration.spec.ts:33,39` (via `api/src/common/testing/integration-setup.ts:73-78`) — `beforeAll` hook exceeds 120s timeout on first execution after the coverage phase. The `loginAsAdmin` helper then fails because `request` is `undefined`. ROK-1296 work does not touch taste-profile, integration-setup, or any auth path; standalone taste-profile run passes 16/16 in 6 seconds.
  Suggested: continue the ROK-1250 socket cleanup. Specific next step — instrument `bootstrapTestApp` to log time spent in each init phase (Drizzle pool, BullMQ Redis connect, NestJS module bootstrap) so the carrier suite under load can be identified by which init step blows the budget. The current "taste-profile" carrier might just be alphabetical-order roulette — any suite that runs first after coverage is at risk.

- ~~**[low]** `web/src/components/calendar/calendar-filter-chip.tsx:11-15` — `formatChipLabel` ambiguous for "0 selected" state.~~ **RESOLVED in this same batch.** Codex pre-push surfaced that this was actually a P2 correctness bug, not a [low] cosmetic — `CalendarView.tsx:92-93` filters out ALL events when `selectedGames` is defined but empty, so the chip's "Filter: All games" was the literal opposite of reality. Fixed by adding an explicit `selectedCount === 0 → "Filter: No games"` branch; test in `calendar-page.test.tsx:247` updated to assert the corrected label.
- **[low]** `web/src/components/calendar/calendar-styles.css:614-631` — new `.calendar-filter-chip` rule lives only in the dark-theme block; no light-theme override under `:is([data-scheme="light"], ...)`. On light themes (`light`, `quest-log`, `sky`, `dawn`, `holy`, `celestial`) the chip renders with dark slate colors on a light surface — readable but visually inconsistent with the sibling `.sidebar-action-btn` which DOES have a light override at line 1390.
  Suggested: add a 4-line light override mirroring `.sidebar-action-btn` (background `rgba(226, 232, 240, 0.6)`, border `rgba(203, 213, 225, 0.5)`, color `#334155`).
- **[low]** `web/src/pages/calendar-page.tsx:108,164-170` — `CalendarSidebar` still declares `toggleGame`, `selectAllGames`, `deselectAllGames`, `likedSlugs` props even though only `allKnownGames`, `selectedGames`, `onShowFilterModal` are consumed. Unused props forwarded via `{...filterProps}` keep TS happy but over-promise the type contract.
  Suggested: narrow `CalendarSidebar`'s prop type to the 3 it consumes.
- **[low]** `web/src/pages/calendar-page.tsx:113-117` — `GameItem` is locally re-declared with `{ slug, name, coverUrl }` even though `GameInfo` is already exported from `../stores/game-filter-store` (used by `calendar-filter-chip.tsx`). Same shape; duplication invites drift.
  Suggested: import `GameInfo` from `../stores/game-filter-store` and replace local `GameItem`.
- **[nit]** `api/src/admin/games-dedup-union-find.helpers.ts:173-178` — sort uses `Number(a) - Number(b)` for `igdb`/`steam`. Currently safe (columns are `integer`), but a future schema change loosening the column type would produce `NaN` ordering.
  Suggested: add a one-line comment noting numeric strings are guaranteed by the integer column type.
- **[nit]** `api/src/admin/games-dedup-audit.service.spec.ts:172-178,431-434` — `.orderBy()` thenable extension is structurally identical in two mock blocks. Will rot if the load query gains another chain step.
  Suggested: extract a `mockLoadGameRowsChain(loadRows)` helper when next touching this file.

### 2026-05-16 — rok-1295 (surfaced during ROK-1295 validate-ci.sh --full)

- **[med]** `api/src/community-insights/community-insights.integration.spec.ts:349` — `Community Insights (ROK-1099) › operator role hierarchy › allows operator role with 200 on every GET endpoint and POST /refresh` fails with `Expected: 200 / Received: 401`. The assertion loops a list of GET URLs with `operatorToken`; one of them rejects the operator role. Branch diff has zero overlap with `api/src/community-insights/**` or the auth/role machinery — ROK-1295 only adds `api/src/games-lookup/**` and a new contract schema. Reproduces on a clean integration run in this worktree.
  Suggested: check whether ROK-1099's role-hierarchy decorators on the community-insights routes still treat operator as a covered role, OR whether a recent guard change tightened the gate.

Other ROK-1295 integration suites (including the new `games-lookup.integration.spec.ts` — 10/10 passing) succeed on the same DB run, so this is isolated to the community-insights operator-role path.

### 2026-05-16 — batch/2026-05-16 (surfaced during ROK-1288 M2-B reproduction sweep)

ROK-1288 M2-B ran the full integration suite 3× back-to-back (`npm run test:integration -w api` × 3, `--runInBand`) to attempt cross-file reproduction of the Testcontainers port-bind flake. Result: 0 / 3 port-bind hits — flake did not reproduce. ROK-1288 closed as Canceled (Won't Do). However, Run 3 surfaced an unrelated isolation flake in the backup integration suite. Recording so the next agent doesn't re-discover.

- **[med]** `api/src/backup/backup.integration.spec.ts:502` (via `api/src/common/testing/integration-helpers.ts:305`) — `loginAsAdmin failed: expected 200 but got 404 — {}`. Surfaced ONLY on Run 3 of a 3-run back-to-back sweep (Runs 1 + 2 clean 1048 / 1048). Carrier test: `GET /admin/backups/:type/:filename/download (integration, ROK-1279) › returns 404 (no leak) on path traversal: absolute path`. The `afterEach` truncates all tables → re-seeds → calls `loginAsAdmin` (POSTs `/auth/local`); the POST returned 404 instead of 200. The `/auth/local` route is verified registered at `api/src/auth/local-auth.controller.ts:52`, so a 404 means the underlying HTTP server is either gone (closed `testApp` instance leaking across describes) or some interceptor short-circuited. Hypothesis: a prior describe in the suite ran `closeTestApp()` but a sibling describe held the stale supertest agent — `truncateAllTables` continues working because it uses a direct DB connection, not the HTTP layer, so failure only manifests on the next HTTP request. Same class as `feedback_smoke_polling_for_async_writes.md` but on the integration side: load-dependent state pollution that only surfaces on sustained re-runs.
  Suggested: (a) audit `backup.integration.spec.ts` for `closeTestApp` / `testApp` lifecycle in nested describes, especially the boundary between the seeding describes and the path-traversal describe; (b) consider hardening `loginAsAdmin` to detect a closed app and emit a clearer error than a bare 404; (c) reproduce by running the full integration suite N≥3 times sequentially on a clean checkout. Logs at `/tmp/rok-1288-m2b/run-3.log` for the 2026-05-16 reproduction.

### 2026-05-16 — rok-1296-submit-bar (surfaced during ROK-1296 validate-ci.sh sweep)

`validate-ci.sh --full` against `rok-1296-submit-bar` (commit `34727e88`) failed integration tests with 16 cascading failures in a single suite — `beforeAll` hook timeout → every `it` then fails with `TypeError: Cannot read properties of undefined (reading 'post')` because `request` was never bound. Standalone runs of the same suite are clean (16/16 in 6.25s); full standalone `npm run test:integration -w api` is also clean (1056/1056 in 458s). Failure only manifests under `validate-ci.sh` after the unit-tests-with-coverage phase. Classic carrier-load fingerprint — same class as the `backup.integration.spec.ts:502` entry documented earlier today and as ROK-1250's BullMQ/ioredis socket-leak class (memory `reference_bullmq_ioredis_test_carrier.md`).

- **[med]** `api/src/taste-profile/taste-profile.integration.spec.ts:33,39` (via `api/src/common/testing/integration-setup.ts:73-78`) — `beforeAll` hook exceeds 120s timeout on first execution after the coverage phase. The `loginAsAdmin` helper then fails because `request` is `undefined`. ROK-1296 work does not touch taste-profile, integration-setup, or any auth path; standalone taste-profile run passes 16/16 in 6 seconds.
  Suggested: continue the ROK-1250 socket cleanup. Specific next step — instrument `bootstrapTestApp` to log time spent in each init phase (Drizzle pool, BullMQ Redis connect, NestJS module bootstrap) so the carrier suite under load can be identified by which init step blows the budget. The current "taste-profile" carrier might just be alphabetical-order roulette — any suite that runs first after coverage is at risk.

### 2026-05-17 — rok-1307-steam-sync-400-and-private (surfaced during validate-ci --full)

Full integration suite (`npm run test:integration -w api`) on the ROK-1307 worktree surfaced 6 failures across 2 specs (`backup/backup.integration.spec.ts` x3, `game-taste/game-taste.integration.spec.ts` x3). All 6 specs pass in isolation against the same HEAD (verified: `npx jest --testPathPatterns="game-taste"` → 27/27 pass; `npx jest --testPathPatterns="backup"` → 21/21 pass). Failure shapes match documented cross-suite flake classes (`feedback_smoke_polling_for_async_writes.md`, `reference_bullmq_ioredis_test_carrier.md`). Zero file overlap with the ROK-1307 diff (sentry/instrument.ts, steam/* services + controller, web hooks + components). Not blocking ROK-1307 ship; recording so they aren't re-discovered.

- **[low]** `api/src/backup/backup.integration.spec.ts` — 3 cases (`createDailyBackup keeps non-excluded table data`, `restored dump has 0 rows in the 4 sanitized tables`, `createMigrationSnapshot also excludes data`) fail with `read ECONNRESET` only when run inside the full integration suite. Same socket-leak carrier class as ROK-1250 / ROK-1264. Passes 21/21 in isolation.
  Suggested: belongs to the BullMQ ioredis carrier follow-up; not in scope here.
- **[low]** `api/src/game-taste/game-taste.integration.spec.ts:381` — `AdminGuard › POST /games/similar returns 403 for non-admin` returns 404 instead of 403 only inside the full suite (passes 27/27 in isolation). Smells like cross-suite seed bleed: the non-admin user OR the target game row is mutated by an earlier-running spec, so the route 404s before the AdminGuard fires. Same pattern as the lineup fixture-bleed entries above.
  Suggested: harden the test's seed setup (re-fetch target gameId after seeding, or use a non-1 sentinel ID); separately worth checking whether the AdminGuard ordering changed recently in router config.

### 2026-05-17 — rok-1307-steam-sync-400-and-private (surfaced during Playwright desktop+mobile)

`npx playwright test` (both projects) on the ROK-1307 worktree, deployed locally with `deploy_dev.sh --ci --rebuild`: 640 passed, 10 failed. ROK-1307's diff is `api/src/steam/**` + `api/src/sentry/instrument*` + `web/src/hooks/use-steam-link*` + `web/src/pages/profile/identity-sections*` — none of the failing tests visit those surfaces. Most-likely upstream: recent Cycle 4 commits on main (`23aac93c ROK-1294` JourneyHero, `8c7e1f20 ROK-1295` Game Research Drawer) changed DOM around lineup/events/onboarding components.

- **[med]** `scripts/smoke/lineup-confirmation-pills-invitee.smoke.spec.ts:127,180,210` — three cases fail across BOTH desktop and mobile (six total): hero-tone flips after nomination, per-row checkmark, waiting-tone after one vote. Asserts on `data-voted='true'` markers and `text=/sit tight/i` copy that aren't present in the rendered DOM. Pattern matches a recently-changed lineup page layout.
  Suggested: re-check selectors against current `web/src/pages/lineup-page` markup; likely a Cycle 4 hero-component refactor moved the data attributes.
- **[med]** `scripts/smoke/events.smoke.spec.ts:370` — desktop: `attendance dashboard light mode › attendance tracker uses theme-aware backgrounds in light mode` fails. Theme-token assertion against rendered CSS.
  Suggested: confirm light-mode tokens still resolve on `/events/:id` after the JourneyHero migration.
- **[med]** `scripts/smoke/onboarding.smoke.spec.ts:330` — desktop: `Onboarding wizard game-time step (ROK-1011) › game-time step renders compact GameTimeGrid on all viewports` fails. Likely a layout-breakpoint regression from a recent UI change.
- **[med]** `scripts/smoke/community-lineup.smoke.spec.ts:416` — mobile: `Community Lineup responsive layout › banner is visible on mobile viewport` fails. Mobile-specific.
- **[med]** `scripts/smoke/lineup-carryover.smoke.spec.ts:165` — mobile: `creating a new lineup auto-populates entries from prior decided suggested matches` fails.

Net: 640/650 smoke passing. ROK-1307's manual-sync flow is not exercised by any Playwright test today; coverage is via Chrome MCP e2e in this build pass.

### 2026-05-17 — pre-existing Steam-link cosmetic + dev-env collision (surfaced during ROK-1307 Chrome MCP)

Operator hit `ConflictException: This Steam account is already linked to another user` during a Link Steam test on the ROK-1307 deploy. **Not introduced by ROK-1307** — the Link flow is untouched by this story. Two surfaces:

- **[low]** Pre-existing cosmetic bug in `web/src/pages/profile/identity-sections.tsx:153` (or wherever the Link Steam button is wired). `<button onClick={linkSteam}>` binds the React `MouseEvent` SyntheticEvent as the function's first argument — and `linkSteam(returnTo?: string)` then `encodeURIComponent`s the SyntheticEvent object, producing `?returnTo=%5Bobject%20Object%5D` in the URL. The backend allowlist (`SteamAuthController.RETURN_TO_ALLOWLIST`) silently normalizes to `/profile`, so no functional impact, but the URL is wrong and confusing in logs. Confirmed in `api.log` 2026-05-17 18:50:04/44 entries.
  Suggested: wrap the handler — `onClick={() => linkSteam()}` — or change `linkSteam`'s signature to accept `unknown` and reject non-strings. The Discord link button at `:64` has the same shape and likely the same issue.
- **[dev-env-only, NOT tech-debt]** Clone-prod-to-local DB carries the operator's prod `users.steam_id` on the `roknua` user row (id=1). When the operator authenticates as the local `admin@local` user (id=115) and tries to Link Steam through OpenID with their real Steam ID, the `users_steam_id_unique` constraint correctly throws Conflict. Solution for dev testing: `UPDATE users SET steam_id = NULL WHERE id = 1;` before attempting the link, or test as `roknua` directly. Documenting in case other agents are confused by the same symptom.

### 2026-05-17 — fix/batch-2026-05-17 (surfaced during ROK-1312 rebase onto origin/main)

ROK-1312 was generated with migration index 0141 against `origin/main` at `8c7e1f20` (pre-ROK-1296). Concurrent merge of PR #804 added `0141_late_wrecking_crew.sql` (community_lineup_user_submissions) before this batch landed. Manually renumbered to `0142_feedback_client_logs` during rebase and updated `_journal.json` to keep both entries. Migration applies correctly (`drizzle-kit migrate` is content-driven, not snapshot-driven), but the `0142_snapshot.json` was emitted by drizzle-kit assuming the pre-ROK-1296 base — so it lacks origin's `community_lineup_user_submissions` table.

- **[low]** `api/src/drizzle/migrations/meta/0142_snapshot.json` — snapshot is missing `community_lineup_user_submissions` (added by 0141_late_wrecking_crew). Doesn't affect `drizzle-kit migrate` or runtime. Will surface on the next `db:generate` against the `feedback` schema (and possibly produce spurious deltas for unrelated tables). Self-resolves after one clean `db:generate` cycle against a DB that includes both 0141 + 0142.
  Suggested: next agent touching `feedback` schema OR running `db:generate` should re-emit `0142_snapshot.json` from a freshly-migrated DB. No urgency — runtime + CI both green.

### 2026-05-17 — fix/batch-2026-05-17 (surfaced during local `tsc --noEmit -p api/tsconfig.json` on rebased batch)

11 pre-existing TS errors in `api/**/*.spec.ts` on `origin/main` at `68cf2512` (PR #805 ROK-1307 just merged). CI does NOT catch these because GitHub `nest build` uses `tsconfig.build.json` which excludes `**/*.spec*.ts` — `validate-ci.sh` runs `tsc --noEmit -p api/tsconfig.json` which includes them. Reproduced on a clean `/tmp/raid-mainonly` clone at the same SHA with `npm run build -w packages/contract` then `npx tsc --noEmit -p api/tsconfig.json`. Zero overlap with `fix/batch-2026-05-17` diff (feedback + use-want-to-play + migration only).

- **[med]** `api/src/games-lookup/games-lookup.integration.spec.ts:306` — `Cannot find module './games-lookup.controller'` on a dynamic `import('./games-lookup.controller')`. The file exists (ROK-1295 wired it up at `api/src/games-lookup/games-lookup.controller.ts`). Spec comment claims "until ROK-1295 wires up GamesLookupController this import + reflection MUST throw" — the spec is stale-by-design after ROK-1295 shipped and now trips TS at compile time.
  Suggested: delete the negative-import block at lines 297-322 (the controller exists; the "MUST throw" assertion is wrong post-ROK-1295) OR convert to a positive `expect(GamesLookupController).toBeDefined()`.
- **[med]** `api/src/admin/games-dedup-audit.integration.spec.ts:386` — `Type '"user"' is not assignable to type '"member" | "operator" | "admin"'`. The `users.role` column tightened to those 3 values somewhere; the spec passes literal `"user"`.
  Suggested: update the seed to use `"member"` (or the appropriate enum value); confirm against `api/src/drizzle/schema/users.ts`.
- **[med]** `api/src/admin/games-dedup-audit.service.spec.ts:443` — `'tx' is referenced directly or indirectly in its own type annotation`. A self-referential transaction type annotation; tsc bails. Likely needs an explicit type annotation break.
  Suggested: extract the transaction parameter type to a named type alias and reference it explicitly in the lambda signature.
- **[med]** `api/src/admin/games-dedup-merge.integration.spec.ts:139,149,160` — 3 `TS2352` errors: drizzle-orm row results are now camelCase (`totalSeconds`, `gameId`) but the spec converts to snake_case (`total_seconds`, `game_id`) without going through `unknown` first. Snake-case probably came from raw SQL `select` shape; new drizzle version returns camelCase.
  Suggested: replace `as { snake_case }` casts with `as unknown as { snake_case }` OR (better) update the assertions to use the camelCase property names returned by drizzle.
- **[med]** `api/src/lineups/lineup-deadline-vote-race.integration.spec.ts:186` — drizzle-orm `SQL<unknown>` not assignable to `SQLWrapper`. Two copies of `drizzle-orm` exist in the type graph (one with `resolution-mode: "import"`, one without); `shouldInlineParams` is on a private property so the structural types diverge. Symptom of a `node_modules` deduplication issue OR a version drift.
  Suggested: `npm dedupe` or pin drizzle-orm via `overrides` in root `package.json` to a single version.
- **[low]** `api/src/lineups/lineup-notification.service.private-visibility.spec.ts:108,114,120,126` — 4 `TS2556` errors: "spread argument must either have a tuple type or be passed to a rest parameter". The spec is destructuring a mock return shape into a non-rest position. Cosmetic fix.
  Suggested: tighten the mock's return type annotation OR cast the spread argument as a tuple.

Net: GitHub CI green on origin/main (build excludes specs); local `validate-ci.sh --full` red. Operator-only impact (until CI tightens). Documenting here so the next agent running `validate-ci.sh` doesn't waste time bisecting.

### 2026-05-17 — fix/batch-2026-05-17 (surfaced during reviewer pass)

- **[low]** `api/src/feedback/feedback.controller.ts:81` — `attachSlowQueryContext` receives untrimmed `clientLogs` from `parsed.data` instead of `truncatedClientLogs`. Functionally harmless (the method only uses it as a truthiness gate; Zod already caps at 50_000), but semantically inconsistent with line 75 which correctly persists the trimmed value. ROK-1312 reviewer surfaced.
  Suggested: pass `truncatedClientLogs` for consistency, OR rename the parameter to `hasClientLogs: boolean` to make the gate intent explicit.
### 2026-05-17 — env-lock semantics: `deploy_dev.sh --down` is the real release, not `env_lock_release` (surfaced during ROK-1307 backup)

When `deploy_dev.sh --ci --rebuild` runs, it reasserts the env lock under its own PID with TTL 240min, **replacing** any MCP-acquired entry. After that point, calling `mcp__mcp-env__env_lock_release` from the original acquirer is a no-op — it returns `was_holder: false` because the deploy-script-anchored entry doesn't match the caller. The lock stays held until the deploy-anchored PID dies, the 240min TTL expires, OR `deploy_dev.sh --down` is run.

This bit ROK-1307: the lock was held for ~43 minutes after the operator gave the code-review verdict (the chrome-mcp playbook says release IMMEDIATELY after writing the summary). A queued agent (ROK-1299) waited the whole time. The release call at 23:05 returned `was_holder: false` and I didn't notice the signal — assumed "call returned" meant "released."

- **[low]** `.claude/skills/_shared/chrome-mcp-e2e.md` "Step 8: Release env lock" — add a note that after `deploy_dev.sh`-based deploys, `env_lock_release` is insufficient on its own; callers must `deploy_dev.sh --down` to release the script-anchored lock. Or check `was_holder: true` before treating release as successful. Tracked alongside [[ROK-1318]] (the `tools/mcp-env` semantics fix).

### 2026-05-17 — rok-1299 migration-drift incident (converted to Linear stories)

After rebasing rok-1299-decided-composite onto an updated origin/main (which had landed migration 0141 from ROK-1296), `./scripts/deploy_dev.sh --ci --rebuild` did **not** apply 0140 / 0141 to the local DB. The API came up healthy on the new code, but `community_lineup_user_submissions` (created by 0141) did not exist. Every `POST /lineups/:id/vote` then 500'd. Manual `node scripts/reconcile-migrations.mjs` made it worse — `Mode: trust (schemaRestored=true)` silently marked 0140 / 0141 + two older migrations as `trusted` without probing. Recovery required direct `docker exec psql` to apply `0141_late_wrecking_crew.sql` by hand.

All three findings from this incident are now tracked in Linear:

- [[ROK-1319]] (High) — reconcile-migrations trust-mode bug (cause + test coverage AC)
- [[ROK-1320]] (High) — deploy_dev.sh missing-migration drift probe (failure surface)
- [[ROK-1322]] (Med) — align legacy `run-migrations.ts` with `run-migrations-with-sentry.ts` (related boot-time / restore-time divergence from ROK-1281 postmortem)

### 2026-05-17 — /readlogs groom (consolidated carriers from prior batches)

This section is the result of cluster-grouping + Linear cross-reference per the new `/readlogs` 3a.iv + 3a.viii steps. Three multi-batch noise classes were rolled up into single bullets pointing at the existing Linear coverage; individual bullets in earlier sections have been removed. The class IS the signal — the recurrence is documented here so the next `/readlogs` doesn't rediscover the same lines.

- **[med]** **Cross-worker Playwright smoke-flake carrier** (modal-materialise + cross-worker active-lineup bleedover + 15s TanStack `staleTime` cached snapshot). Flagged across **2026-05-12 (ROK-1068), -14 (ROK-1242), -15 (ROK-1292-pr2), -16 (fix/batch + batch/2026-05-16), -16b (fix/batch-2026-05-16b)** — ~28 distinct `spec:line` combos in 6 carrier files (`lineup-confirmation-pills*`, `community-lineup`, `lineup-decided`, `lineup-admin-abort-phases`, `lineup-tiebreaker*`, `lineup-abort`). Last surfaced 2026-05-16. **Tracked in [[ROK-1286]] (Todo, cycle)** — cross-batch evidence appended via Linear comment 2026-05-17. The narrower [[ROK-1251]] (Backlog) covers the modal-materialise sub-case specifically.
  Suggested: a dedicated fix-batch story on the fixture infrastructure — `scripts/smoke/api-helpers.ts` + the `?test=open-lineup-modal` pattern + 15s staleTime defeat. Per-worker prefix isolation (ROK-1147 / ROK-1227 pattern) is the proven primitive. Estimated 2-4h, suitable for `/build` (not `/bulk` since it touches test infrastructure across many files). _Carrier pattern — likely needs a dedicated fix-batch story rather than continued tech-debt deferral._
  _Note: the 2026-05-17 ROK-1307 Playwright section (above) flags 5 additional [med] entries on the SAME carrier files but with operator notes pointing at **suspected real Cycle 4 DOM regressions** (JourneyHero / Game Research Drawer). Those stay in their own section — verify they're regressions vs. carrier noise BEFORE folding them in here._

- **[med]** **BullMQ/ioredis integration-suite socket-leak carrier**. Flagged across **2026-05-13 (fix/batch-2026-05-13 CI gate), -16 (ROK-1296 batch — taste-profile.integration.spec.ts), -17 (ROK-1307 — backup.integration.spec.ts ×3)**. Failure shapes: mid-suite `socket hang up` / `read ECONNRESET` / post-coverage `beforeAll` timeout > 120s. Standalone runs always pass; only `validate-ci.sh --full` reproduces. Carrier-load fingerprint per memory `reference_bullmq_ioredis_test_carrier.md`. **Tracked in [[ROK-1268]]** (Backlog) — cross-batch evidence appended via Linear comment 2026-05-17.
  Suggested: instrument `bootstrapTestApp` to log time spent in each init phase (Drizzle pool, BullMQ Redis connect, NestJS module bootstrap) so the carrier suite under load can be identified by which init step blows the budget. The current carrier might just be alphabetical-order roulette — any suite running first after the coverage phase is at risk.

- **[med]** **Pre-existing `tsc --noEmit -p api/tsconfig.json` errors on `origin/main` spec files**. Flagged across **2026-05-15 (ROK-1036 — 10 errors in 5 spec files, ROK-1292-pr1 — 2 spec files with TS2593/TS2304), -16 (ROK-1294 — same 10 errors re-documented)**. CI doesn't catch this because GitHub Actions uses `tsconfig.build.json` (which excludes specs), but `scripts/validate-ci.sh::run_typecheck` uses the full `tsconfig.json` and trips. Every `validate-ci.sh --full` run sees a noisy "regression" that isn't theirs. **Tracked in [[ROK-1284]]** (Todo, cycle).
  Suggested: align the spec casts to drizzle's camelCase return shape; dedupe `drizzle-orm` in `package-lock.json` for the SQL nominal drift; rewrite spread-argument assertions to pass an inline tuple. The pure `types: ['jest']` config drift for `version.controller.spec.ts` / `app.e2e-spec.ts` is a one-line tsconfig fix.

### 2026-05-17 — /readlogs triage outcomes (new stories filed)

For provenance only — these stories were created from log + backlog cross-reconciliation today. Backlog entries that motivated them have been removed; surface them here so the next `/readlogs` knows they exist.

- **[high]** **[[ROK-1316]]** `perf: /lineups/:id/suggestions blocks 10-62s on Gemini cache miss (UX-breaking)`. Log evidence: 18 slow calls + 3 client `499` disconnects on lineup #9 during 03:00 hour 2026-05-17. Voter-set hash cache key invalidates on every nomination/vote/invitee change → users pay full Gemini round-trip every visit.
- **[med]** **[[ROK-1317]]** `fix: useAiFeatures hook polls /admin/ai/features for non-admin users (78× 403/30min)`. Log evidence: 78 unique 403s in ~30min from one non-admin client. Hook gates on `enabled: !!getAuthToken()` only — needs admin-role gate.
- **[med]** **[[ROK-1318]]** `tech-debt: env_lock_release silently no-ops after deploy_dev.sh re-anchors the lease`. Backlog evidence: today's 2026-05-17 entry, bit ROK-1307 with a 43min phantom-hold.
- **[high]** **[[ROK-1319]]** `fix: scripts/reconcile-migrations.mjs trust mode silently marks unapplied migrations as applied`. Backlog evidence: 2026-05-17 ROK-1299 [high] — bit during Step 3 validate, required manual `docker exec psql` recovery.
- **[high]** **[[ROK-1320]]** `fix: deploy_dev.sh should detect migration drift before starting the API`. Sibling of ROK-1319; closes the failure surface (silent boot on drift-stricken DB) that exposed the reconcile bug.
- **[med]** **[[ROK-1321]]** `tech-debt: auth-state leak between integration specs pre-empts admin session (signups-roster carrier)`. Backlog evidence: 2026-05-13 full-suite flakes — distinct from BullMQ socket-leak class, no prior Linear coverage.
- **[med]** **[[ROK-1322]]** `tech-debt: align api/src/scripts/run-migrations.ts with the instrumented boot runner (ROK-1281 follow-up)`. Closes boot-time vs restore-time invariant divergence left over from 2026-05-14 prod outage postmortem.

Also appended fresh evidence to **[[ROK-1103]]** (ITAD HTTP client retry-5xx) — prod 521 cluster + 115s wrap reproduced today, recommending escalation.

### 2026-05-17 — rok-1299 Codex review findings (deferred MEDIUM)

Two Codex-review findings deferred because they're MEDIUM/correctness-non-blockers and the operator approved the live UI without seeing them. P1 (matchThreshold-as-player-count) and the bandwagon-leftover-bug were both fixed inline in commits 33efb14f + b4e00332.

- **[med]** `web/src/components/lineups/decided/DecidedView.tsx:129-136` — `useLineupMatches()` is async; on first render `data` is `undefined`, so the hero text briefly shows `"No matches were generated from voting results."` / `"You're not in any matches yet."` even for lineups that DO have matches. The old `DecidedMatchesView` rendered a loading skeleton instead. UX-jarring during the network roundtrip.
  Suggested: gate the composite root on `useLineupMatches().isLoading` — render a hero-only loading state (or reuse the prior skeleton) until `data` resolves. Codex flagged as P2 during ROK-1299 review.
- **[med]** `packages/contract/src/lineup-match.schema.ts::MatchDetailResponseSchema` — does not expose a per-match player cap, but the Decided-composite wireframe wants `"X of Y players · group is full"`. The cap lives on `games.defaultPlayerCap` (`api/src/drizzle/schema/games.ts:127`); `GroupedMatchesResponseDto.matchThreshold` is a 0–100 percentage for the grouping algorithm — NOT a player count. ROK-1299 shipped personal-context-only copy (`You + N others` / `Just you so far` / `N players`) as a faithful fallback.
  Suggested: extend `MatchDetailResponseSchema` with `playerCap: z.number().int().nullable()`; populate from `games.defaultPlayerCap` in `lineups-match-response.helpers.ts`; restore a `threshold` prop on `MatchCard` and re-add the `"X of Y players · group is full"` sub-line under a non-null guard.
- **[med]** `web/src/components/lineups/decided/MatchCard.tsx` — when a match has `linkedEventId !== null` (event already created from the scheduling poll), the deleted `AlmostThereCard` rendered `"View Event →"` linking to `/events/${linkedEventId}`. The ROK-1299 rewrite collapsed all per-card CTAs to `"Pick a time →"` and lost the event-link branch. Members in a fully-scheduled match now bounce back to the scheduling poll instead of jumping to the event.
  Suggested: in `MatchCard::PickATimeCta`, branch on `match.linkedEventId`: if set, render `<Link to="/events/${linkedEventId}">View Event →</Link>`; else keep the schedule-poll link. Add a Vitest guard for the `linkedEventId` set branch.

### 2026-05-17 — fix/batch-2026-05-17 (surfaced during ROK-1315 viability tsc)

`validate-ci.sh` runs `npx tsc --noEmit -p api/tsconfig.json` which includes `*.spec.ts` files. CI workflow uses `tsconfig.build.json` (specs excluded) so these are invisible there but block local pre-push validation. Confirmed on `origin/main` (commit 3a76cd1e) after stashing my work — none of these files are touched by ROK-1315.

- **[med]** `api/src/admin/games-dedup-audit.integration.spec.ts:386` — `error TS2769: No overload matches this call.` Likely drizzle/postgres-js typing drift after a recent dependency bump.
  Suggested: inspect the call site; if the spread is over a tuple type the function expects a rest parameter — wrap as `as const`.
- **[med]** `api/src/admin/games-dedup-audit.service.spec.ts:443` — `error TS2502: 'tx' is referenced directly or indirectly in its own type annotation.` Self-referential type from a destructured tx callback.
  Suggested: extract the tx callback signature to a named type alias.
- **[med]** `api/src/admin/games-dedup-merge.integration.spec.ts:139,149,160` — three `error TS2352` row-shape mismatches (`RowList<{ totalSeconds }>` vs `{ total_seconds }`). Camelcase/snake_case raw-SQL drift after drizzle bump.
  Suggested: cast through `unknown` or align the result row interface to what postgres-js actually returns.
- **[high]** `api/src/games-lookup/games-lookup.integration.spec.ts:306` — `error TS2307: Cannot find module './games-lookup.controller'`. The integration test imports a controller that no longer exists at that relative path (likely renamed or moved during a recent refactor).
  Suggested: locate the new controller location and update the import, or delete the orphaned test if the controller was intentionally removed.
- **[med]** `api/src/lineups/lineup-deadline-vote-race.integration.spec.ts:186` — `error TS2345: Argument of type 'SQL<unknown>' is not assignable to parameter of type 'string | SQLWrapper'`. Drizzle SQL-template typing drift.
  Suggested: wrap with `sql.raw()` or assert the SQLWrapper interface.
- **[med]** `api/src/lineups/lineup-notification.service.private-visibility.spec.ts:108,114,120,126` — four `error TS2556` "spread argument must have tuple type or rest parameter". Mock/spy invocations spreading a non-tuple array.
  Suggested: type the spread source `as const` or accept the rest-arg call signature on the mock.

### 2026-05-17 — fix/batch-2026-05-17 (surfaced during validate-ci.sh run on ROK-1315)

- **[high]** `scripts/validate-ci.sh::run_typecheck` silently masks api failures. The function runs `npx tsc -p api/tsconfig.json` then `npx tsc -p web/tsconfig.json` back-to-back. Inside `run_step`, `"$@" || rc=$?` disables `set -e` for the LHS, and the function's exit status is the last command's — so when api tsc fails (exit 1) but web tsc passes (exit 0), `run_typecheck` returns 0 and validate-ci reports "TypeScript (all): PASS" even with 11 active api errors. Demonstrated 2026-05-17 22:05: direct `npx tsc -p api/tsconfig.json` → exit 1, 11 errors; same checkout under `./scripts/validate-ci.sh --no-e2e` → PASS. Explains why prior batches (#806, #807) shipped over the pre-existing API spec errors without local pre-push catching them. `run_lint` and `run_unit_tests` have the same multi-command shape and likely the same masking behavior — audit all of them.
  Suggested: split each tsc invocation into its own `run_step` (cleanest), OR convert `run_typecheck` to `local rc=0; npx tsc … || rc=$?; npx tsc … || rc=$?; return $rc`. Apply the same fix to `run_lint`, `run_unit_tests`, and any other multi-command `run_*` helper.
