# Sentry Audit — 2026 Q2 (ROK-1162)

This audit catalogues the noise sources reaching the Sentry inbox in production, the disposition applied in this story, and the items that still require operator-only Sentry-UI work to fully close out [ROK-1162](https://linear.app/roknua-projects/issue/ROK-1162).

## Method

Per-operator direction, this audit works from the noise classes named in the ROK-1162 issue body rather than a live top-30 export. Live tally is deferred to a follow-up tech-debt slice if needed. (The story body names `planning-artifacts/sentry-audit-2026-Q2.md`, but that directory is gitignored alongside `implementation-artifacts/`; this doc lives under `docs/` so it stays tracked.) Prior art: [ROK-1143](https://linear.app/roknua-projects/issue/ROK-1143) (`no_snapshot_yet` 503s), [ROK-668](https://linear.app/roknua-projects/issue/ROK-668) (`InternalOAuthError`), [ROK-1260](https://linear.app/roknua-projects/issue/ROK-1260) (DiscordAPIError 50278/50007).

## Noise classes & dispositions

### 1. `ConflictException` from `applyStatusUpdate` — DROPPED in `beforeSend`

- **Throw site:** `api/src/lineups/lineups-lifecycle.helpers.ts:126-128`
- **Sentry signature:** `event.exception.values[0].type === 'HttpException'` (NestJS surfaces `ConflictException` as its base `HttpException`), value matches `/status changed concurrently/`.
- **Category:** Expected behavior — race detection from [ROK-1118](https://linear.app/roknua-projects/issue/ROK-1118). The 409 is the correct response to a concurrent status flip.
- **Filter location:** `api/src/sentry/instrument.ts` (`beforeSend` block, ROK-1162 clause). 409 status is still logged by the NestJS HTTP access logger — no information is silently swallowed.
- **Why not `fingerprint` instead of drop:** the issue body's per-class action table lists "Expected behavior → `beforeSend` filter". A grouped fingerprint would still page the operator on first occurrence. Dropping is the correct disposition for *expected* behavior.

### 2. `AbortError` from cancelled fetches — DROPPED on both api and web

- **Origins (web):** TanStack Query passes `signal` to fetches (`web/src/hooks/use-community-insights.ts:40+`, `web/src/stores/connectivity-store.ts:20-22`); unmount/refetch triggers an `AbortController.abort()`.
- **Origins (api):** IGDB stream cancellation (`api/src/igdb/igdb-streams.helpers.ts:90`) and any other server-side `AbortSignal` consumer.
- **Sentry signature:** `type === 'AbortError'` OR `type === 'DOMException'` with `/abort/i` in the value.
- **Filter location:** `api/src/sentry/instrument.ts` *and* `web/src/sentry.ts` (the web side previously had no `beforeSend`; this story adds one).
- **Category:** Infra noise — never indicative of a bug.

### 3. Discord.js transient network errors — FINGERPRINT-GROUPED

- **Origin:** discord.js v14 retries internally; what bubbles out of the library to Sentry is retry-exhaustion (`DiscordAPIError` with 5xx HTTP status, or values containing `ECONNRESET`/`ETIMEDOUT`/`getaddrinfo`/`fetch failed`).
- **Sentry signature:** `type` starts with `'DiscordAPIError'` (discord.js v14 reports the bracketed `DiscordAPIError[<code>]` form in production — the original exact-equality match never fired; corrected in ROK-1354) with value matching `/\b5\d\d\b|ECONNRESET|ETIMEDOUT|getaddrinfo|fetch failed|\bnetwork\b/i` (the `\b` boundaries on `5\d\d` are load-bearing — Discord permanent application codes like 50013/50001 start with `500` and must not group as transient).
- **Disposition:** keep visible (these can still indicate a real Discord outage) but coalesce under a single fingerprint `['discord-api-transient']` so the inbox shows one issue instead of N.
- **Filter location:** `api/src/sentry/instrument.ts` (ROK-1162 fingerprint clause, runs after the existing 50278/50007 drop).

### 4. OAuth callback with malformed `state` — ALREADY HANDLED (no new code)

- **Investigation:** `verifyOAuthState` (`api/src/plugins/discord/discord-auth.helpers.ts:204-225`) returns `null` on invalid state; `DiscordAuthGuard.handleRequest` (`api/src/plugins/discord/discord-auth.helpers.ts:52-73`) redirects on failure (via `redirectOnOAuthFailure` — `/login?error=...`, silent-flow fall-through, or consent retry) rather than throwing. The only exception that reaches Sentry from the OAuth callback path is passport-oauth2's `InternalOAuthError`, which is **already dropped** by the ROK-668 filter at `api/src/sentry/instrument.ts:47-49`.
- **Action:** added a regression test in `api/src/sentry/instrument.spec.ts` asserting `InternalOAuthError` with a state-mismatch value is dropped.

### 5. Existing filters retained from prior stories

| Pattern | Story | File |
|---|---|---|
| `ThrottlerException` (rate limits) | original | `api/src/sentry/instrument.ts:43-45` |
| `InternalOAuthError` (passport-oauth2) | ROK-668 | `api/src/sentry/instrument.ts:47-49` |
| `no_snapshot_yet` 503s | ROK-1143 | `api/src/sentry/instrument.ts:55-60` |
| `DiscordAPIError` 50278 / 50007 / 10013 / no-mutual-guilds / Unknown User | ROK-1260, ROK-1354 | `api/src/sentry/instrument.ts:106-115` |
| `pg_catalog` spans (N+1 false positives) | ROK-366 | `api/src/sentry/instrument.ts` (`ignoreSpans`) |

### Addendum — filters added after this audit

Three `beforeSend` clauses shipped after this audit and are listed here so the tables above remain a complete filter inventory. ROK-1354 also fixed the dead `=== 'DiscordAPIError'` gate in both Discord clauses (see section 3).

| Pattern | Story | File |
|---|---|---|
| Synthetic CSP-report probes (`example.*` / curl UA) | ROK-1365 | `api/src/sentry/instrument.ts:25-39` |
| Steam-sync user-fixable 4xx (`Steam account not linked` / `Steam profile is private`) | ROK-1307 | `api/src/sentry/instrument.ts:61-79` |
| `cron_job_executions_cron_job_id_fkey` FK violations | ROK-1328 | `api/src/sentry/instrument.ts:80-94` |

## Code delivered

- `api/src/sentry/instrument.ts` — extended `beforeSend` with 3 new clauses (ConflictException drop, AbortError drop, Discord transient fingerprint).
- `api/src/sentry/instrument.spec.ts` — new test cases covering each new disposition (drop / fingerprint), cross-clause guards (concurrent-status vs `no_snapshot_yet`, 50278 vs transient-fingerprint ordering), and a regression test for the OAuth-state class.
- `web/src/sentry.ts` — new `beforeSend` callback (none existed previously) — drops AbortError / DOMException-abort events.
- `web/src/sentry.test.ts` — new Vitest spec covering the web filter.

## Out of scope — operator-only Sentry UI work

These ROK-1162 ACs cannot be delivered from code and were intentionally not attempted by this story. They are documented here so they aren't lost; operator can either close them when convenient via the Sentry UI or file follow-up tech-debt slices.

| AC | Why operator-only | Recommended action |
|---|---|---|
| Inbound Filters for DNS / `ECONNRESET` / bot user-agents | Sentry Inbound Filters live on the project settings page in the Sentry web UI — no API/SDK surface | Project Settings → Inbound Filters → enable "Filter out known web crawlers" and "Filter known errors from browser extensions" |
| Alert-rule pruning | Alert rules are configured in the Sentry UI; SDK has no influence | Project Settings → Alerts → review each rule, disable any that fire >1×/week without being actionable |
| Weekly "new issues" digest to Discord | Requires a Sentry Integration (Discord webhook) configured against the Sentry org | Project Settings → Integrations → Discord → wire a digest rule to the operator channel |
| Sentry inbox count drops measurably (week-over-week) | Measurement is observational; the code filters land first, then operator tracks post-deploy | After this PR ships, snapshot inbox event-count weekly for 2 weeks; expect a clear drop from ConflictException + AbortError filters |

## Follow-ups

- If post-deploy inbox is still noisy in 2 weeks, file a follow-up to do a real top-30 export and a second filter pass.
- If discord.js transient fingerprints page on a real outage but the grouped issue masks the cause, switch from `fingerprint` to `tags.discord_transient_kind` (rate-limit vs gateway-5xx vs network) so each kind has its own row.

## References

- Story: [ROK-1162](https://linear.app/roknua-projects/issue/ROK-1162)
- Parent epic: [ROK-1152](https://linear.app/roknua-projects/issue/ROK-1152)
- Prior `beforeSend` filter art: ROK-1143, ROK-668, ROK-1260
