# ROK-1480 — audit user-facing text for PII, sensitive details, and ticket references

Branch `tech-debt/rok-1480`. Audit complete; the clear-cut set is fixed and guarded.
Everything deliberately left is listed below **with its reason** — the cap is not silent.

## Method

Source scan of `web/src`, `api/src`, `packages/contract/src`, `tools/test-bot/src` for
`ROK-\d+` with comments stripped, then a per-hit check of whether the string actually
reaches a human. Raw `grep ROK-` returns **1895** hits; **~1700 are `describe()` names in
spec files** and the rest are overwhelmingly comments, JSDoc and logger calls. A blind
find-and-replace here would have been a disaster — ticket ids are this repo's provenance
convention and must stay in comments.

## Class 1 — leaked ticket references in rendered copy (FIXED)

| Surface | file:line | Was |
|---|---|---|
| Admin → Scheduled Jobs | `api/src/cron-jobs/cron-job.constants.ts` ×7 | `… (ROK-1451)`, `… (ROK-1353)`, `… (ROK-1374)`, `… (ROK-1282)`, `… (ROK-1352)` ×2, and the story's example `… default 12) — ROK-1240.` |
| Admin → Co-Optimus | `web/src/components/admin/CooptimusForm.tsx:15` | `Email them (see the ROK-275 spike) and request…` |
| Admin → General | `web/src/pages/admin/general-panel.tsx:99` | `…before users must log in again (ROK-1353).` |
| Admin → Settings (GitHub, deprecated) | `api/src/admin/settings.controller.ts:297,307,317` | `…replaced by Sentry error tracking (ROK-306).` — these are `message` fields returned to and rendered by the admin UI |

The recruitment-reminder description also read as pseudo-code
(`start - created < RECRUITMENT_SHORT_NOTICE_HOURS, default 12`); it now reads as admin
English. The env var name is **kept deliberately** — it is a knob an operator can act on,
not an internal leak.

No spec asserted on any changed string (`cron-job.constants.spec.ts` only checks
descriptions are non-empty); `scripts/smoke/` and the web specs were grepped for each one.

## Class 2 — PII / sensitive detail in user-facing output (NONE FOUND)

- No raw emails in shipped copy. The only email literals are `test@example.com` in
  `web/src/test/mocks/handlers.ts` (MSW fixture) and the Sentry DSN host.
- No internal hostnames or IPs in rendered copy. The `192.168.*` / `gamernight.net` /
  `.lan` sweep hit only comments plus `api/src/discord-bot/commands/register-commands.fleet.ts:78`
  (`fix RL_SLOT_<N>_DISCORD_* in /srv/rl-infra/.env`) — a **fleet-only startup log line**,
  never rendered, and its whole value is telling the operator which file to edit.
- Discord user ids / internal user ids appear in `logger.*` calls only, not in embeds.

## Class 3 — secrets (NONE REQUIRING ROTATION — but read this)

**No committed credential was found.** The secret-shaped-literal sweep returned nothing.

One item to be aware of, deliberately **not** treated as an incident: a hardcoded Sentry
DSN in `web/src/sentry.ts:9` and `api/src/sentry/instrument.ts:10`. A Sentry DSN is
public by design — the web one is compiled into the browser bundle and served to every
visitor — and both files document it as intentional maintainer telemetry with an opt-out
(`VITE_DISABLE_TELEMETRY` / `DISABLE_TELEMETRY`). It is an ingest-only write key, not a
credential. **No rewrite was committed and nothing was scrubbed**, since a commit that
"fixes" a secret still leaves it in git history — that call is the operator's.

## Regression guards (both verified to FAIL before being committed green)

- `web/src/test/user-facing-copy.guard.test.ts` — source-scans every shipped web file,
  excluding `web/src/dev/**`. Verified by injecting `ROK-9999` into `general-panel.tsx`:
  failed naming that exact line, then reverted.
- `api/src/cron-jobs/cron-job.constants.guard.spec.ts` — asserts on `CORE_JOB_METADATA`
  description **values**, so provenance comments in the same file cannot trip it.
  Verified by injecting `ROK-9999` into a description: failed naming that job.

Comment stripping is **quote-aware**. The first version produced seven false hits because
an apostrophe in JSX text (`Don't`) opened a string literal that swallowed every comment
after it; single and double quotes now reset at a newline (only a template literal spans
lines), with its own assertion. Per the ROK-1314 lesson, both guards are written so their
own explanatory prose — which names the forbidden pattern — cannot fail them.

## Deliberately left (with reasons)

1. **Ticket refs in comments and JSDoc, repo-wide.** Deliberate provenance convention.
2. **~1700 ticket refs in spec `describe()` names.** Not user-facing; they are how the
   suite is navigated.
3. **Ticket refs in `logger.*` calls** (≈60, concentrated in `api/src/events/signup*`
   ROK-459, `api/src/notifications/*` ROK-1260, `api/src/users/users-moderation-*`
   ROK-313). Server logs are operator-facing and the ids are the fastest route from a log
   line to the story that explains it. Removing them would destroy real debugging value.
4. **`web/src/dev/**`** — DEMO_MODE-gated wireframes and design galleries that name their
   own story on purpose. Nothing there ships. Explicitly excluded from the guard.
5. **`api/src/admin/demo-test-*` fixture names** (`ROK-1525 Solo Player Fixture`,
   `ROK-1398 Co-Op Enriched Fixture`, `ROK-1260 smoke test`, …). DEMO_MODE-only seed data,
   and **smoke specs assert on these exact names** — renaming them breaks the suite for no
   user-visible gain.
6. **`tools/test-bot/**` assertion messages.** Test output, read only by agents/operator.
7. **`api/src/lineups/common-ground-presentation.helpers.ts:58`** — `throw new Error('ROK-1297
   invariant violated: …')`. An internal invariant; Nest returns a generic 500 to the
   client and the message goes to logs/Sentry. Left as provenance. *Borderline — flag if
   you disagree.*
8. **No Discord-copy source guard.** `embeds/`, `commands/`, `lfg-board/`, `lfm/`,
   `lfg-now/` were scanned and are **already clean**, but a source-scanning guard over
   those directories would false-positive the moment someone adds a legitimate `logger.*`
   line carrying a ticket id — and a guard that fires on correct code teaches people to
   disable it. Audited-clean, intentionally unguarded.

## Verification run (exact commands, exact results)

- `npx vitest run src/test/user-facing-copy.guard.test.ts` (from `web/`) — **3 passed**
- `npx jest --silent src/cron-jobs/cron-job.constants.guard.spec.ts` (from `api/`) — **2 passed**
- `npx tsc --noEmit -p api/tsconfig.json` — **clean** (typechecks specs)
- `npm run build -w web` — **clean**
- `npx eslint` on every changed file — **clean**

`packages/contract` had to be built first; a fresh worktree ships it unbuilt and both
typechecks fail with `Cannot find module '@raid-ledger/contract'` until you run
`npm run build -w packages/contract`. Pre-existing environment state, not a code failure,
so no `TECH-DEBT-BACKLOG.md` entry.

**Not run:** the full api/web suites and Playwright (fleet-only per CLAUDE.md). No fleet
gate, no push, no PR — those are the Lead's.
