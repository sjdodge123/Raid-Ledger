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
| Bundle size budget (`lint` job, after Build web) | `node scripts/check-bundle-size.mjs` — gzip budget per web chunk; runs in `--static` and `--full`. Reading the table, raising a budget, `npm run analyze -w web`: [bundle-budget.md](bundle-budget.md) | `validate-ci.sh` |
| TypeScript | `npx tsc --noEmit` (api, web app + node + specs, smoke specs) | `validate-ci.sh` |
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
  - **Fleet runs match GitHub CI's smoke settings (ROK-1689).** Inside a fleet runner (`/workspace` bind-mount or `RL_TARGET=remote` — the same signal as the Redis sidecar and the slot channel set), `run_discord_smoke` reads `SMOKE_CONCURRENCY`, `SMOKE_RETRY_COUNT`, `SMOKE_TIMEOUT_MS`, `DISCORD_API_TIMEOUT_MS` and `SMOKE_SKIP_VOICE_JOIN` from `.github/workflows/discord-smoke.yml`'s job `env:` at run time and prints one `Discord smoke CI parity: …` line. A value you export first wins; an unreadable workflow or missing key is a yellow warning, not a failure. Laptop runs keep the test-bot defaults (concurrency 5, 0 retries, 60s, real voice joins). `DISCORD_API_TIMEOUT_MS` is read by the **API**, not the companion bot, so the runner-shell export can't reach it; `rl-infra/orchestrator/bin/env-spin` sets `-e DISCORD_API_TIMEOUT_MS=15000` on the env's API container instead (the spec pins it to the workflow's value). That takes effect on envs spun after the next rl-infra deploy. Because a CI-parity run holds `/state-locks/discord.lock` much longer, a sibling slot now waits up to 45 min for it (was 10). One gap remains: CI runs one process per `SMOKE_CATEGORY` (embed, flow, dm, command, voice) while the fleet runs one unfiltered `npm run smoke`. **Proof run:** fleet task `050a2d64afba` (HEAD `645c0d9de`, before the env-spin change) → Discord smoke 124/126 passed; the 2 failures (ROK-1084 AI Chat poll timeout 8000ms; ROK-1253 `POST /lineups → 404 Unknown user id(s)`) are documented fleet-only pre-existing failures. Fleet gates before ROK-1689 showed 14–19 failures. GitHub comparison: run `36172718366` on main `f6d192187` (green).

## Gate / e2e flags

- `--static`: **lite gate (default for most stories)** — build + typecheck + lint + conditional migration/container only. Defers unit, integration, Playwright, and Discord smoke to GitHub CI. ~3–4 min.
- `--full` (or no flag): complete local suite — adds unit, integration, and auto-scoped e2e on top of `--static`. Use for migration/infra/deps/large changes and **breaking** contract changes; additive contract changes use `--static` + the story's new integration specs on the fleet (CLAUDE.md, operator ruling 2026-10-07).
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

**`--fleet` skips the unchanged workspace's suites (ROK-1793).** It narrows only when EVERY changed path (committed diff against `origin/main` plus untracked, non-ignored files) is under `api/` or `web/`. Any other path runs every suite: api jest guards read `README.md`, `.env.example` and `rl-infra/**`, and `fleet-first-login-admin.prod-guard.spec.ts` scans every tracked file, so no path outside the two workspaces is provably inert. An api-only diff skips web vitest. A web-only diff skips the api integration suite and narrows api jest to the specs that read `web/` or scan every tracked file (found at run time: a spec naming a `'web/` path or calling `git ls-files`). A web diff under `web/src/components/admin/` or `web/src/pages/admin/` runs everything, because `discord-bot-permissions-literal.guard.spec.ts` scans those directories. A diff that crosses workspaces, or an empty diff, runs every suite. Each skip is its own summary row that says what ran, e.g. `Integration tests (api)  SKIPPED — web-only diff (--fleet scope): not run by this gate`. GitHub's `api` job does not fire on `web/**` either, so nothing else runs a skipped api suite on a web-only PR. `--full` and `--static` never scope this way.

**Integration shards can run two at a time (ROK-1793, opt-in).** The integration step runs `INTEGRATION_SHARDS` jest processes (default 4), serially by default. `INTEGRATION_PARALLEL=2` runs them in waves of two (1+2, then 3+4). On the fleet pass `--integration-parallel=2` instead (`rl_validate_ci` `args`): the runner does not inherit laptop env vars. Each parallel shard gets `INTEGRATION_PARALLEL_HEAP_MB` (default 2560, against 4096 serial, so two shards plus their parents stay under the runner's 6 GB) and its own Redis db index on the sidecar (`redis://rl-test-redis-…:6379/<shard>`). Each jest process already starts its own Postgres Testcontainer (the jest config's `globalSetup`), and BullMQ keys carry a per-process `test-<pid>-` prefix, so shards share no state. Values above 2 are capped at 2. A non-number falls back to serial. `CI=true` with `DATABASE_URL` set also forces serial, because then every shard would use the same database. A failed shard fails the tier and stops its still-running wave partner (SIGTERM to its process tree; its row in `Shard results` reads `STOPPED`). The next wave never starts, and the never-ran spec report still prints, including the stopped shard's specs. On bash ≥ 4.3 (the runner) `wait -n` catches whichever shard fails first; macOS bash 3.2 waits in shard order, so a later shard's failure is noticed only when the earlier one ends. Parallel output is prefixed `[shard i/N]`. The default stays 1 until a fleet run measures the 2560 MB heap. ROK-1268 saw OOMs at 3 GB under sustained runs, so raise `INTEGRATION_SHARDS` (e.g. 6) if a parallel shard OOMs.

## Scoping the Playwright tier

`rl_validate_ci({e2e_scope})` — `auto` (default) / `all` / `none` — forwards `E2E_SCOPE` to `validate-ci.sh`. Under `auto` it runs only the specs `scripts/smoke/scope-specs.sh` maps the branch diff to.

**Explicit spec list (ROK-1792) — the default fleet Playwright gate.** `rl_validate_ci({args:["--only-e2e"], e2e_specs:[…], against_env_slug, base_url})` forwards `e2e_specs` as `E2E_SPECS`; locally, `E2E_SPECS="scripts/smoke/a.smoke.spec.ts,scripts/smoke/b.smoke.spec.ts" BASE_URL=… ./scripts/validate-ci.sh --only-e2e` (space- or comma-separated). The tier then runs exactly those specs on desktop + mobile (never `--project`), bypasses the changed-files gate, and FAILs (not SKIPs) when the target env is down. Every path must be `scripts/smoke/<name>.spec.ts`, contain no `..`, and exist; the MCP tool caps the list at 20. A bad path, or pairing it with `e2e_scope` other than `auto`, `--static` or `--no-e2e`, is rejected at the MCP boundary (`error: invalid_e2e_specs`) and by the script (exit 2). The summary row reads `Playwright (desktop + mobile, explicit: N specs)` — same prefix, so a PASS writes the sentinel with `gate_tier: playwright`.

`none` skips the tier in every mode (including `--fleet`) except an explicit `--with-e2e`, and a Playwright FAIL no longer suppresses the Discord smoke row: the FAIL is recorded, Discord smoke still runs, and the gate exits 1.

`scope-specs.sh` maps `git diff --name-only origin/main...HEAD` to the matching `scripts/smoke/*.smoke.spec.ts` files (by page / component / route token) and prints them. It prints `ALL` — run the full suite — when the diff touches a shared surface: `web/src/components/layout/**`, `web/src/components/ui/**`, `web/src/index.css`, `web/src/App.tsx`, `web/src/routes*`, `playwright.config.*`, `scripts/smoke/base.ts`, `scripts/smoke/*helpers*`, or when it cannot map a changed file to any spec.

It prints `NONE` (ROK-1792) when every changed web file is known to be covered by no smoke spec — a `/dev/**` (DEMO_MODE wireframe) route, or a new `components/ui/**` file nothing imports yet. `validate-ci.sh` then **SKIPS** the tier with the row `Playwright (desktop + mobile, no specs in scope)  SKIPPED`; it never runs `npx playwright test NONE`. A SKIPPED row writes no `gate_tier: playwright` sentinel (only a PASS does); a green static run still writes the static one. An explicit `E2E_SPECS` list still runs that list, and `E2E_SCOPE=all` still runs the full suite. A failing or empty `scope-specs.sh`, and a mixed specs-plus-`ALL` output, still fall back to the full suite.

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
