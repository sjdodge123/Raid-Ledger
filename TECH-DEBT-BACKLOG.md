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
