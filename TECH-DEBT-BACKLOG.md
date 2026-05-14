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

### 2026-05-13 — rok-1277-dedup-audit-union-find (ROK-1277)

- **[med]** `api/src/admin/games-dedup-union-find.helpers.ts:142-176` (`strongestSharedKey`) — when a connected component contains more than one shared value at the strongest key tier (e.g. component spans two pairs A↔B sharing `steam:123` and C↔D sharing `steam:456`, joined transitively by a name match), the returned `matchKey` depends on iteration order of `rows`. `loadGameRows()` has no `ORDER BY`, so Postgres heap-order changes (autovacuum, updates, large insert activity) could flip `matchKey` between consecutive runs over unchanged data. Idempotency test (`'is idempotent — calling POST twice replaces the snapshot'`) currently passes because heap order is stable within a single test run; on prod with 1906 rows the practical impact is low but non-zero. Surfaced by Codex review (P2).
  Suggested: in `strongestSharedKey`, sort the candidate values lexicographically (or numerically for igdb/steam) before picking the first count ≥ 2. ~3 lines. Alternative: add `ORDER BY id ASC` to `loadGameRows()` SELECT, which also fixes the latent issue more broadly.

### 2026-05-13 — rok-1279-prod-clone (ROK-1279) — Testcontainers port-bind flake

- **[med]** `api/src/common/testing/test-app.ts:114` — `PostgreSqlContainer.start()` flakes intermittently with `Timed out after 10000ms while waiting for container ports to be bound to the host` when the full integration suite runs back-to-back. Two specs reliably surface it under Docker pressure: `api/src/settings/reencrypt-settings.integration.spec.ts` and `api/src/availability/availability.integration.spec.ts` (the only two that spawn their own Testcontainers Postgres; all others reuse `DATABASE_URL` against the shared `raid-ledger-db` container). Both pass cleanly in isolation (28 tests in ~12s). Surfaced during ROK-1279's second `validate-ci.sh --full` run (first run was clean 1005/1005).
  Suggested: bump the 10s port-bind timeout. Testcontainers reads `TESTCONTAINERS_HOST_OVERRIDE` and respects a `withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(30_000))` on the container builder. Adding `.withWaitStrategy(...)` to the `PostgreSqlContainer` instance in `provisionDatabase` would extend it without affecting the existing `withStartupTimeout(60_000)` (which is the overall container-start timeout, not the port-bind retry). ~3 lines. Alternative: serialize back-to-back full-suite runs with a `docker stop` cooldown between, which is more an operator-workflow fix than a code one.

### 2026-05-13 — rok-1279-prod-clone (ROK-1279) — Codex review findings (non-blocking)

- **[med]** `api/src/backup/backup.controller.ts:54` — `fs.createReadStream(absPath).pipe(res)` has no `.on('error', ...)` handler. TOCTOU between `existsSync` and stream open: if the file is deleted between resolution and stream open (race with rotation cron or operator DELETE), the read stream emits `error` after headers are already sent → client sees 200 + truncated body, Node may surface an unhandled error. Low practical risk (rotation cron only deletes >30d files; admin DELETE flow is operator-only) but cheap to harden.
  Suggested: attach `stream.on('error', err => { this.logger.warn(...); res.destroy(err); })` before the pipe. ~3 lines.
- **[med]** `api/src/backup/backup.integration.spec.ts:316` — `getSchemaTables` test helper regex `/^\s*\d+;\s+\d+\s+\d+\s+TABLE\s+\S+\s+(\S+)/` matches both `TABLE public games admin` AND `TABLE DATA public games admin` (because `\S+` consumes `DATA` and the capture takes the schema name `public`). Current assertions still pass because they only assert `expect(schemaTables).toContain('app_settings')` and the genuine `TABLE` line is present — but the helper name is misleading and could mask a real regression where ONLY `TABLE DATA` lines exist and someone refactors the helper to actually mean what its name says.
  Suggested: tighten to `/^\s*\d+;\s+\d+\s+\d+\s+TABLE\s+(?!DATA\s)\S+\s+(\S+)/` (negative lookahead). ~1 line.
- **[low]** `scripts/clone-prod-to-local.sh:165` — `prod_get_safe` glob `[[ "$pth" != "$PROD_GET_ALLOWED_PREFIX"/*/download ]]` is looser than strict-whitelist intent. Bash `[[ ]]` glob `*` matches `/`, so a path like `/admin/backups/a/b/c/download` passes the bash check. Server-side AdminGuard + path-traversal regex still block any real damage, but cosmetic strictness would close the gap.
  Suggested: replace bash glob with regex check: `[[ ! "$pth" =~ ^/admin/backups/(daily|migration)/[A-Za-z0-9_.-]+/download$ ]]` and the exact list-endpoint match. ~3 lines.
- **[low]** Two backup-path helpers exist for similar intent: `BackupService.getBackupFilePath` (new in ROK-1279; 404-only on traversal) and `BackupService.resolveBackupPath` (existing; uses 400 for traversal — feeds restore/delete). Unify on the 404-only behavior to reduce info leak surface across all path-validated routes. Non-urgent; both are admin-only.

### 2026-05-13 — pre-existing `tsc --noEmit` errors on `origin/main` (surfaced during fix/batch-2026-05-13 viability gate)

10 TypeScript errors fire on `npx tsc --noEmit -p api/tsconfig.json` against a clean `origin/main` checkout (commit `9461559c`). All are in `*.spec.ts` files and do NOT block Jest runs (ts-jest is more permissive than `tsc --noEmit`) — but they leak into agent worktrees as red herrings when devs/leads gate on a clean type-check before starting work. Group by file:

- **[med]** `api/src/lineups/lineup-notification.service.private-visibility.spec.ts:108,114,120,126` — TS2556 "spread argument must have a tuple type or be passed to a rest parameter". The spec is intentional TDD scaffolding (file header at lines 100-102 says *"the dev's job is to widen the signatures to accept the lineup/visibility parameter"*), but the gate it scaffolds (private-visibility on notification dispatch) was never implemented. Either complete the visibility gate (widen `notifyNominationMilestone` / `notifyMatchesFound` / `notifySchedulingOpen` / `notifyEventCreated` to accept a `lineup` or `visibility` argument), OR delete the spec, OR mark it `xdescribe` so it stops leaking errors.
  Suggested: triage whether private-visibility on notifications is still desired post-ROK-1067; if not, delete the spec — the test-only `AnyArgs = unknown[]` trick papers over a feature that no longer needs the test.
- **[med]** `api/src/admin/games-dedup-audit.integration.spec.ts:386` — TS2769 "no overload matches this call". Likely landed alongside the ROK-1277 union-find work; the audit assertion shape may have drifted from the underlying helper signature.
- **[med]** `api/src/admin/games-dedup-audit.service.spec.ts:432` — TS2502 "'tx' is referenced directly or indirectly in its own type annotation". Drizzle transaction-callback type recursion — fixable with an explicit annotation on `tx`.
- **[med]** `api/src/admin/games-dedup-merge.integration.spec.ts:139,149,160` — TS2352 three `as` cast errors. Spec is casting Drizzle `RowList<{ camelCase }[]>` directly to `{ snake_case }[]`. Either case-correct the assertions or wrap the cast through `unknown` (per TS's own remediation hint in the error).
- **[low]** `api/src/lineups/lineup-deadline-vote-race.integration.spec.ts:186` — TS2345 `SQL<unknown>` not assignable to `string | SQLWrapper`. Drizzle helper signature drift; one-line fix to wrap or annotate the SQL fragment.

**Why this matters:** `validate-ci.sh --full` runs `tsc --noEmit` and these 10 errors will appear on every full CI run from now until cleaned up. Agents that gate on "type-check is clean before I start" will hit a false-positive blocker. Same applies to `/build`, `/fix-batch`, `/dispatch` viability gates.

Suggested triage path: one chore-labeled story to triage + fix the 5 files (or delete the private-visibility spec if obsolete). Estimated 30-60 min. Alternative: change `validate-ci.sh` to compare against an `origin/main` baseline and only fail on net-new errors — more durable, but heavier to build.

### 2026-05-13 — pre-existing vitest test-order flakes (surfaced during fix/batch-2026-05-13 ROK-1207 verification)

Two web-workspace vitest tests pass cleanly in isolation but fail when run as part of the full suite (`npx vitest run --coverage` from `web/`). Surfaced by `dev-rok-1207` agent during their pre-commit verification — neither file was touched by the ROK-1207 change. Suggests test-order dependency or shared module state that leaks across files.

- **[med]** `web/src/pages/invite-page.test.tsx` — fails in full suite, passes 21/21 in isolation. Likely msw handler state or React Query cache singleton bleeding from an earlier test file.
  Suggested: bisect the full-suite order to find the polluting predecessor (`vitest --reporter=verbose | head -n <position>`), then either add `beforeEach` cleanup in the predecessor or move the predecessor's mocks into local `vi.mock()` calls scoped to its `describe`.
- **[med]** `web/src/components/health/EngagementHealthSection.test.tsx` — fails in full suite, passes in isolation. Same class of issue.
  Suggested: same bisect approach. May share a common predecessor with `invite-page.test.tsx` — worth checking if both fail on the same upstream pollutant.

**Why this matters:** masks net-new regressions during fix-batch / build validation gates. The Lead currently has to manually compare "did my changes cause this?" by re-running the file in isolation, which costs ~30s per false alarm. Cleaning the test-isolation primitives (likely in `web/src/test/setup.ts` or a shared mock factory) removes that toil for every future batch.

Suggested triage path: one chore-labeled story. First task is the bisect — once the polluting file is named, the fix is usually a one-liner (move a `vi.mock` from top-level into a `beforeEach` or add an `afterEach(() => vi.resetModules())`).

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

### 2026-05-13 — Playwright cross-project flakes (surfaced during fix/batch-2026-05-13 smoke gate)

3 smoke tests failed in the full Playwright sweep (632 passed / 3 failed / 200 skipped / 5 did not run). None of the 3 failing files are in the batch's 24-file diff. The failure signatures are cross-project (each fails on ONE viewport — desktop OR mobile — and passes on the other), strongly suggesting test-data state pollution rather than functional regression.

- **[med]** `scripts/smoke/lineup-admin-abort-phases.smoke.spec.ts:121` (desktop only, 17ms instant fail) — `expect(before?.status).toBe(phase)` failed because the lineup fixture wasn't in the expected phase when the API check ran. Mobile equivalent test passes in 470ms. The 17ms duration on desktop = fixture state was already wrong before the test body executed. Likely a previous desktop test left the same lineup ID in a different phase.
  Suggested: add `beforeEach` that asserts/forces lineup-into-phase state via the seed API, or scope each phase test to its own seeded lineup ID rather than sharing a fixture.
- **[med]** `scripts/smoke/community-lineup.smoke.spec.ts:416` (mobile only, 6.5s — hit the 5s timeout) — asserts the "COMMUNITY LINEUP" banner + "Nominate" button on `/games`. This is the GamesPage's LineupBanner/StandalonePollBanner (NOT lineup-detail-page.tsx, which ROK-1207 changed). Mobile-only failure with the banner showing but the Nominate button not appearing within 5s. Possibly a fixture lineup with no Nominate CTA on mobile or a render race.
  Suggested: bump the Nominate-button timeout to match the COMMUNITY-LINEUP-text timeout (15s), or assert on a state-stable signal first (e.g., banner CTAs visible) before per-button.
- **[low]** `scripts/smoke/events.smoke.spec.ts:370` (desktop only) — Regression test for ROK-784 (attendance dashboard light mode theme). Completely unrelated to this batch's diff. Pre-existing theme/contrast intermittent.
  Suggested: stabilize with explicit `prefers-color-scheme: light` media emulation, or `page.emulateMedia({ colorScheme: 'light' })` at test start.

**Verdict for this batch:** all 3 failures unrelated to the 24-file diff. ROK-1207's own regression tests (`scripts/smoke/lineup-abort.smoke.spec.ts:219`, `:276`) PASSED on BOTH desktop and mobile (4 of 4 ROK-1207 regression cases green). GitHub CI has been consistently green on `main` (last 5 merges, including PR #787 mid-session). Proceeding to ship per operator approval; flakes documented for follow-up triage.
