# Local CI gate — reference

> Extracted from `CLAUDE.md` on 2026-09-18 to keep the always-loaded project
> instructions small. **The rules still live in CLAUDE.md** ("## Testing" →
> "Local CI — lite gate by default", "Smoke Test Verification"). This file is
> the reference you consult once you already know the rule exists: the CI job
> mapping, the conditional-step path lists, the flag inventory, and the
> failure-triage checklists. Not independent — do not add rules here.

## GitHub CI job → local equivalent

| GitHub CI Job | Local Equivalent | Script |
|---------------|------------------|--------|
| Build | `npm run build` (all workspaces) | `validate-ci.sh` |
| TypeScript | `npx tsc --noEmit` (api + web) | `validate-ci.sh` |
| Lint | `npm run lint` (api + web) | `validate-ci.sh` |
| Unit tests | `npm run test:cov -w api`, `vitest run --coverage` (web) | `validate-ci.sh` |
| Integration tests | `npm run test:integration -w api` | `validate-ci.sh` |
| Migration validation | Postgres container + programmatic migrator (`run-migrations-with-sentry.ts`) | `validate-migrations.sh` (conditional) |
| Container startup | Build + start allinone image, health checks | `validate-ci.sh` (conditional) |
| Playwright (desktop + mobile) | `npx playwright test $(bash scripts/smoke/scope-specs.sh)` — the local/fleet run is SCOPED to the touched surfaces (ROK-1565); its summary row reads `Playwright (desktop + mobile, scoped: N specs)`. GitHub still runs the full suite. | `validate-ci.sh` (conditional + env-gated) |
| Discord smoke (companion bot) | `cd tools/test-bot && npm run smoke` | `validate-ci.sh` (conditional + env-gated) |

## Conditional steps — what triggers each expensive job

`validate-ci.sh` auto-scopes based on `git diff` against `origin/main` and the local dev env state:

- **Migrations:** run iff `drizzle/migrations/**` changed.
- **Container startup:** run iff `Dockerfile*`, `nginx/**`, or `docker-entrypoint*` changed.
- **Playwright:** run iff diff touches `web/**`, `api/src/auth/**`, `api/src/admin/demo-test*`, `playwright.config.*`, or `scripts/smoke/**` AND `:3000/health` + `:5173` both answer. SKIPPED otherwise (with a clear reason in the summary).
- **Discord smoke:** run iff diff touches `api/src/discord-bot/**`, `api/src/notifications/**`, `api/src/events/signups*`, `api/src/events/event-lifecycle*`, `api/src/lineups/standalone-poll/**`, `api/src/lineups/scheduling/**`, `api/src/admin/demo-test*`, `tools/test-bot/src/smoke/**`, or `tools/test-bot/src/helpers/polling.ts` AND env is up.

## Gate / e2e flags

- `--static`: **lite gate (default for most stories)** — build + typecheck + lint + conditional migration/container only. Defers unit, integration, Playwright, and Discord smoke to GitHub CI. ~3–4 min.
- `--full` (or no flag): complete local suite — adds unit, integration, and auto-scoped e2e on top of `--static`. Use for migration/infra/contract/deps/large changes.
- Default (auto, when running `--full`): e2e is diff + env gated. Backend-only branches pass through in seconds; UI/bot branches get the right coverage automatically.
- `--no-e2e`: run build/tsc/lint/unit/integration but skip Playwright + smoke (pre-deploy static checks where you'll run e2e separately).
- `--with-e2e`: force-run e2e even if the diff detector says no triggering files changed (paranoid pre-push, or shared-component changes the detector won't flag).
- `--only-e2e`: skip everything except the e2e steps (post-deploy gates where static checks already ran upstream).

**Env-down behavior:** in default/auto mode, missing env produces SKIPPED + a "run `deploy_dev.sh` first if you need e2e coverage" message. `--with-e2e` against a missing env fails fast.

## Backup integration tests

`api/src/backup/backup.integration.spec.ts` shells out to `pg_dump` / `pg_restore`, gated by `SKIP_BACKUP_INTEGRATION`:

- Locally: `validate-ci.sh` checks for `pg_dump` on PATH. If missing, it prints a yellow warning, sets `SKIP_BACKUP_INTEGRATION=1`, and the suite skips. Install `postgresql-client` (e.g. `brew install libpq` on macOS) to run them.
- In CI: pass `--ci` to `validate-ci.sh`. Missing `pg_dump` then hard-fails instead of skipping, so CI never silently misses these tests.

## The pre-push sentinel — how it actually works

The `git push` hook in `.claude/settings.json` runs `scripts/smoke/push-gate.sh`, which denies the push unless `/tmp/.playwright-verified-<surfacehash>` exists and is younger than 24h.

**The sentinel is keyed to the WEB SURFACE, not to HEAD (ROK-1566).** `scripts/smoke/surface-hash.sh` hashes the branch's diff (binary content included) against `origin/main` over `web/`, `scripts/smoke/`, `playwright.config.*`, `packages/contract/src/`, `api/src/auth/` and `api/src/admin/demo-test*` — the same set `validate-ci.sh` uses to trigger Playwright. So a follow-up commit touching only docs, unrelated api code or tests — and GitHub's identical-tree "merge main" rewrite of a remote branch — KEEPS a green gate, while any edit to those paths correctly invalidates it. A surface that cannot be computed (no git, unresolvable `origin/main`) DENIES — the gate never fails open. `nosurface` (the branch changes nothing Playwright exercises) is allowed outright.

`rl_validate_ci` records that hash alongside the synced worktree HEAD at dispatch, and when the task is observed TERMINAL the `mcp-rl-fleet` server writes the sentinel itself. Results carry `gate_verified` / `gate_sentinel` / `gate_tier` / `surface_hash`, with `playwright_verified` / `playwright_sentinel` kept as aliases.

**A green fleet `--static` run is enough (ROK-1565):** terminal + `succeeded` with `Build`, `TypeScript` and `Lint` all PASS and **no `FAIL` row anywhere** writes the sentinel with `gate_tier: static`. A Playwright PASS writes it with `gate_tier: playwright`. A **FAILED** Playwright tier (or any other `FAIL` row) writes nothing. A **SKIPPED** one no longer blocks the sentinel — GitHub runs the full suite before the merge.

## Scoping the Playwright tier

`rl_validate_ci({e2e_scope})` — `auto` (default) / `all` / `none` — forwards `E2E_SCOPE` to `validate-ci.sh`. Under `auto` it runs only the specs `scripts/smoke/scope-specs.sh` maps the branch diff to.

`scope-specs.sh` maps `git diff --name-only origin/main...HEAD` to the matching `scripts/smoke/*.smoke.spec.ts` files (by page / component / route token) and prints them. It prints `ALL` — run the full suite — when the diff touches a shared surface: `web/src/components/layout/**`, `web/src/components/ui/**`, `web/src/index.css`, `web/src/App.tsx`, `web/src/routes*`, `playwright.config.*`, `scripts/smoke/base.ts`, `scripts/smoke/*helpers*`, or when it cannot map a changed file to any spec.

A scoped PASS is a valid pre-push result for the mapped surfaces; GitHub still blocks the merge on the full suite. Measured 2026-09-14, running the tier on a 5-line web fix cost 15–25 min queued behind two branches and found nothing GitHub's full suite would not have found ~45 min later — hence the "only when `scope-specs.sh` prints `ALL`, or the operator asks" rule in CLAUDE.md.

## If you DO run Playwright locally

1. Deploy locally (`./scripts/deploy_dev.sh --ci`), then run `./scripts/validate-ci.sh --only-e2e` (or `--with-e2e` to force it for a shared-component change the diff detector won't flag).
2. If the summary shows `Playwright: SKIPPED — Dev env not responding`, the env is down — bring it up and re-run.
3. If any test fails, fix it BEFORE pushing — do NOT use CI as a debugger.
4. Run BOTH projects (desktop + mobile). New components on shared pages (layout, nav, Games page) break selectors in OTHER test files.

## When smoke tests fail in CI — triage order

1. Check the ACTUAL error message — is it "element not found", "strict mode", or "timeout"?
2. "Element not found" = the selector is wrong or the UI differs in CI (missing data, unconfigured services).
3. "Strict mode" = selector matches 2+ elements (new DOM from your changes collided with existing selectors).
4. "Timeout" with a correct selector = CI runner is slow; increase timeout or add retry.
5. **NEVER re-run CI hoping it passes** — investigate the failure first.
