# Raid Ledger

Monorepo: `api` (NestJS), `web` (React/Vite), `packages/contract` (shared types).

## Key References

- **Project context:** `project-context.md` — architecture, stack, conventions
- **Testing guide:** `TESTING.md` — patterns, anti-patterns, coverage thresholds, exemplary files
- **Tech debt backlog:** `TECH-DEBT-BACKLOG.md` — append reviewer findings here, do NOT auto-file Linear `tech-debt:` stories. Operator triages and files manually. See file header for format.

## Document pre-existing failures (STRICT — applies to ALL agents)

If you encounter a failure (TypeScript error, lint error, test failure, smoke flake, broken build step, etc.) on `origin/main` or a freshly-checked-out worktree that is **NOT caused by your changes**, you MUST append it to `TECH-DEBT-BACKLOG.md` under a dated section before continuing your work.

**Why:** pre-existing failures get re-discovered every cycle, distract agents from their actual story, and leak into reviewer reports as if they were new regressions. Capturing them once in tech-debt:

1. Stops the next agent from rediscovering the same noise.
2. Gives the operator a single triage list instead of finding errors via fire-drill.
3. Lets `validate-ci.sh` results be triaged as "your work" vs "pre-existing".

**How:**

1. Run the failing command on a clean batch worktree or `origin/main` checkout to confirm the failure is NOT caused by your branch's changes (`git stash` + retry, or check on the batch base).
2. Open `TECH-DEBT-BACKLOG.md` and append (do NOT prepend, do NOT edit existing entries) under a level-3 heading matching the file's format: `### YYYY-MM-DD — <branch-or-context> (surfaced during ...)`.
3. One bullet per distinct failure. Severity (`high` / `med` / `low` / `nit`), file:line in backticks, what the error says verbatim, why you think it's pre-existing, and a one-line `Suggested:` fix.
4. Group multiple errors in the same file under one bullet only if they share the same root cause; otherwise list separately.
5. The Lead commits the tech-debt addition as part of the batch — no separate PR. Use `chore(tech-debt): document pre-existing failures` or fold it into another `chore(config):` commit.

**When NOT to do this:**

- The failure is caused by your changes — fix it.
- The failure is already documented in `TECH-DEBT-BACKLOG.md` under a recent entry — don't duplicate.
- The failure is in a file you're already touching for the story — fix it as scope creep is justified.

**Scope guard:** documenting a pre-existing failure is NOT the same as fixing it. Don't expand your story to fix unrelated tech debt unless the operator approves. The doc entry is the deliverable.

## Post-merge planning artifact reconciliation (STRICT — applies to ALL agents)

After a PR merges (confirmed by `gh pr view ... --json state` = `MERGED`), the Lead reconciles `planning-artifacts/current-sprint.md` BEFORE ending the session. Linear's status flip alone is insufficient — the cycle plan rots until rollover otherwise.

1. **Story IS in the cycle plan** → strike-through the row (`~~ROK-XXXX~~ — ~~title~~`) and append `— **Shipped YYYY-MM-DD PR #N**.` to Notes. Don't delete; strike-through preserves the original commitment for the sprint-end retrospective.
2. **Story is NOT in the cycle plan** (out-of-cycle hotfix, reactive bug, unplanned follow-up) → append a row to `### Reactive shipments (filed + shipped mid-cycle)` near the file's bottom. Create the section once if absent. Row format: `| **ROK-XXXX** | <title> | <why pulled in>. **Shipped YYYY-MM-DD PR #N**. |`
3. **Strategic decision in the merge** (architecture / scope change / postmortem / new STRICT rule) → append a dated entry to the Active State Linear doc Strategic section (slug `7a4ddc5652c9`). Skip for routine fixes.

If `origin/main` moved by >1 PR since the doc's last Derived update, run `/status-report` from main as part of cleanup. Step refs: `/build` 5e.5, `/fix-batch` + `/bulk` 4d.5, `/handover` 4b. Skip for reverted PRs, `chore(release|config)` ride-alongs, and back-merges from main.

## Reference designs before coding (STRICT — applies to ALL agents)

Before writing implementation code for ANY feature/fix that has a visual or UX dimension, scan for design references that may already exist. The operator regularly approves simplified-flow targets, wireframes, or design specs ahead of implementation — agents picking up follow-up work should be **implementing the approved target, not redesigning it**.

Where designs live in this repo:

1. **Spike outputs** — `docs/spikes/*.md` and any DEMO_MODE-gated routes under `web/src/dev/**` (e.g. `/dev/wireframes/...`). Spikes commonly produce both an audit doc and previewable React routes.
2. **The Linear issue body** — read the WHOLE description. Operators frequently link Figma URLs, wireframe URLs, audit docs, or sibling tickets that carry the visual direction. Don't skim past inline links.
3. **Operator memory** — entries named `reference_*.md` (Figma URLs, design-system pointers, prior-art snapshots).
4. **Existing components/pages** that solve a similar problem — match the established pattern rather than introducing a parallel one.

If you can't find a design reference and the UX direction matters, **ask the operator before coding**. Don't guess at the target — implementations of the wrong target are more expensive to undo than asking up front.

## MCP Tools (registered in `.mcp.json`)

Three custom MCP servers provide tools for environment management, story tracking, and Discord testing. **Use these instead of manual shell commands.**

### `mcp-env` — Environment & Story Status (`tools/mcp-env/`)
| Tool | Use When |
|------|----------|
| `mcp__mcp-env__env_check` | Check .env files: existence, missing vars, worktree status. Use BEFORE `deploy_dev.sh` or when builds fail due to missing env vars. |
| `mcp__mcp-env__env_copy` | Copy .env files from main repo to worktree. Use when setting up worktrees. |
| `mcp__mcp-env__env_service_status` | Check Docker containers, ports, API health, AND env-lease state (who holds it, who's queued). Use to verify local dev environment is running. |
| `mcp__mcp-env__env_lock_status` | Show env-lease holder + queue. Use BEFORE acquiring or any work that needs `:3000`/`:5173`. |
| `mcp__mcp-env__env_lock_acquire` | Acquire the env lease (or get queued). Pass `purpose`, optional `priority: "operator"` to preempt. Auto-defaults branch + worktree. |
| `mcp__mcp-env__env_lock_release` | Release the env lease (or remove yourself from the queue). Always call when you're done. |
| `mcp__mcp-env__env_lock_force_release` | Operator-only override to clear a stuck lease. Ask the operator first. |
| `mcp__mcp-env__story_status` | Check delivery status of stories (git branches + PRs). Use when resuming in-flight work to reconcile state against origin. |

### `mcp-discord` — Discord UI Testing (`tools/mcp-discord/`)
| Tool | Use When |
|------|----------|
| `mcp__mcp-discord__discord_screenshot` | Take a screenshot of Discord. Use for visual debugging. |
| `mcp__mcp-discord__discord_read_messages` | Read messages from a Discord channel. |
| `mcp__mcp-discord__discord_verify_embed` | Verify embed content in a channel. |
| `mcp__mcp-discord__discord_navigate_channel` | Navigate to a specific channel. |
| `mcp__mcp-discord__discord_click_button` | Click a button on a Discord message. |
| `mcp__mcp-discord__discord_check_voice_members` | Check voice channel members. |
| `mcp__mcp-discord__discord_check_notification` | Check DM notifications. |

**Note:** `mcp-discord` requires Discord running with CDP (`./scripts/launch-discord.sh`). Local dev only.

### `mcp-rl-fleet` — rl-infra Remote Test Fleet (`tools/mcp-rl-fleet/`)
| Tool | Use When |
|------|----------|
| `mcp__mcp-rl-fleet__rl_claim` | Acquire a runner slot on the rl-infra VM. Starts Mutagen sync from laptop to runner. Idempotent — returns existing slot if this agent already holds one. Use at session start when you need a remote test env. |
| `mcp__mcp-rl-fleet__rl_release` | Release the runner slot held by this agent. Destroys child envs, prunes scoped resources. Call at session end. |
| `mcp__mcp-rl-fleet__rl_status` | Snapshot the fleet: per-slot claim state, active envs, host RAM/disk/load, per-runner CPU/mem. Use to check if your slot is still valid or before spinning a new env. |
| `mcp__mcp-rl-fleet__rl_env_spin` | Bring up a per-test env (allinone + sibling Postgres). Returns `{slug}.rl.lan` (internal) + `{slug}test.gamernight.net` (external if `RL_PUBLIC_DOMAIN` is set). |
| `mcp__mcp-rl-fleet__rl_env_destroy` | Tear down an env: containers + volume + Traefik route file + state entry. |
| `mcp__mcp-rl-fleet__rl_env_list` | List active test envs (slug, slot, ttl, last_touched). |
| `mcp__mcp-rl-fleet__rl_env_sync_from_local` | Copy data from operator's local raid-ledger-db into an env. mode=`settings` (default) syncs app_settings/local_credentials/consumed_intent_tokens. mode=`full` does full data dump. Requires `RL_ENV_JWT_SECRET` in `/srv/rl-infra/.env` for encrypted app_settings to decrypt at runtime. |
| `mcp__mcp-rl-fleet__rl_env_clone_prod` | Two-step: refresh operator's local DB from prod (sanitized backup), then push to env. Use `skip_local_refresh=true` for subsequent envs when local DB is already fresh. |
| `mcp__mcp-rl-fleet__rl_run_on_runner` | Execute a shell command inside the agent's claimed runner container (in `/workspace`). Use for `npm test`, `jest`, `npx playwright test`, etc. Captures stdout/stderr/exit_code. Requires `rl_claim` first. |
| `mcp__mcp-rl-fleet__rl_validate_ci` | Run the full validate-ci.sh pipeline inside the runner — far faster than running locally. Args: `["--no-e2e"]`, `["--only-e2e"]`, etc. |
| `mcp__mcp-rl-fleet__rl_db_url` | Get psql/pgweb URLs for an env's Postgres. Pure metadata — no remote call. |
| `mcp__mcp-rl-fleet__rl_logs_url` | Generate a Grafana Explore URL pre-filled with a Loki LogQL query (e.g. `{rl_slot="1"}` or `{rl_env="myslug"} \|= "error"`). |

**Note:** `mcp-rl-fleet` forces `RL_PROXMOX_USER=rl-agent` (limited identity) and `RL_OPERATOR=0` so an agent can never elevate to the operator user via these tools, even if the operator's shell exports `RL_OPERATOR=1`. Operator ops still use the `rl` CLI directly.

**Dashboard:** `http://fleet.rl.lan` (LAN) or `http://fleet.gamernight.net` (external, behind your proxy) — mobile-friendly fleet status page, no auth.

### Diagnosing offline MCP servers

If `mcp-discord` or `mcp-env` tools come back as offline:

1. **First check:** call `mcp__mcp-env__mcp_health` — diagnoses both local servers and reports `healthy | unhealthy | skipped` with error messages.
2. **Most common fix:** worktree missing `node_modules`. Run `npm install` from the worktree root, then restart the Claude session.
3. **Manual probe:** `npx tsx tools/mcp-discord/src/index.ts --self-check` (and same for mcp-env). Exit 0 = healthy.

## Pull Requests

- **Always enable auto-merge (squash)** after creating or pushing to a PR: `gh pr merge <branch> --auto --squash`
- This is safe to run whether the PR was just created or already existed — it's a no-op if already enabled.

## Operator Config Files (STRICT — applies to ALL agents)

The following paths are **operator-authored configuration**. They are intentionally bundled into whatever PR is open at the time, regardless of which story the PR is for:

- `.claude/skills/**` — slash commands and agent skills
- `.claude/agents/**` — agent definitions
- `.claude/settings.json`, `.claude/settings.local.json` — Claude Code harness config
- `CLAUDE.md` (this file) — project instructions
- `.mcp.json` — MCP server registrations
- `rl-infra/**` — Proxmox VM compose stack + orchestrator + runner image + local CLI (the remote test fleet)

**Rules:**

1. **Never cherry-pick around them.** If you encounter commits or staged changes touching these paths on a branch you're working on, treat them as in-scope and let them ride along.
2. **Never revert them** because "they look unrelated to my story." They are intentionally unrelated — the operator updates them opportunistically and they ship with the next PR that goes out.
3. **Never exclude them** from `git add` / `git commit` / `git push` / `git rebase` / cherry-pick / squash flows.
4. **When committing them**, use a `chore(config): ...` prefix in the commit message so they're easy to spot in PR diffs. Do NOT mention the active story ID — they're independent.
5. **`/push` (and any agent that pushes)** must check for unstaged or untracked changes under these paths and stage + commit them before pushing. Do not leave them in the working tree.

This rule exists because parallel agents kept seeing these commits, assuming "not my work," and cherry-picking around them — leaving operator config changes orphaned across batches.

## Local Dev Environment

- **Start everything:** `./scripts/deploy_dev.sh` — ensures Docker is up, runs migrations, seeds data, starts API + web in watch mode
- **Flags:** `--rebuild` (rebuild contract), `--fresh` (reset DB), `--reset-password`, `--branch <name>`, `--ci` (non-interactive, for agents), `--down`, `--status`, `--logs`
- **Worktree-safe:** The deploy script auto-detects worktrees, copies `.env` + `api/.env` from the main repo, and always uses the correct Docker volumes. Just run `./scripts/deploy_dev.sh --ci --rebuild` from any worktree.
- **Ports:** API on `:3000`, Web on `:5173` (Vite may increment to `:5174` if `:5173` is in use — CORS allows both)
- **DEMO_MODE=true** in root `.env` enables auth bypass with prefilled credentials
- **Docker volume gotcha (handled automatically):** The deploy script uses `docker start` by name first, falling back to `docker compose` from the main repo's compose file. This prevents worktrees from creating separate volumes with wrong directory prefixes.
- **Clone prod → local:** `./scripts/clone-prod-to-local.sh` triggers a sanitized prod backup, downloads it, restores into the local DB, resets the local admin password, and preserves your local `app_settings` (API keys) across clones. See **Cloning prod → local — agent runbook** below for the full step-by-step.

### Cloning prod → local — agent runbook (STRICT — gotchas baked in)

This procedure is destructive to the LOCAL DB (replaces every non-sanitized table with a sanitized copy of prod) — get explicit operator authorization before running.

1. **Hold the env lock and have the local API running.** `mcp__mcp-env__env_lock_acquire({ purpose: "..." })` → `./scripts/deploy_dev.sh --ci` from your worktree. If `npx tsc` errors with `command not found`, `npm install` in the worktree first (worktrees don't share `node_modules`). Re-run deploy.

2. **Create `.env.clone` at the worktree root.** Required vars:

   ```ini
   # Prod side
   PROD_URL=https://raid.gamernight.net/api      # /api prefix is REQUIRED — without it nginx serves the SPA, POST returns 405
   # Prod auth — pick ONE:
   PROD_BEARER_TOKEN=eyJhbGc...                  # preferred — paste from prod web session
   # OR
   # PROD_ADMIN_EMAIL=...
   # PROD_ADMIN_PASSWORD=...

   # Local side
   LOCAL_URL=http://localhost:3000
   LOCAL_ADMIN_EMAIL=admin@local
   LOCAL_ADMIN_PASSWORD=<current local admin pwd>  # needed for Step 5 local /auth/local login
   DATABASE_URL=postgresql://user:password@localhost:5432/raid_ledger
   ```

   - **`PROD_URL` must end in `/api`.** Without that the script POSTs to nginx's SPA route and gets 405.
   - **Bearer token is preferred** over storing the prod password. To grab one: in the browser logged into prod, DevTools console → `copy(localStorage.getItem('raid_ledger_token'))`. JWTs are short-lived (~24h) — one-shot use, then they expire.
   - **`LOCAL_ADMIN_PASSWORD`** is needed because the script calls `POST /auth/local` on the LOCAL API to authorize the restore. If you don't know it, run `./scripts/deploy_dev.sh --reset-password`, copy the printed password, set it here. (Step 7 of the script will reset it again at the end — that's fine.)

3. **Run the clone.** `./scripts/clone-prod-to-local.sh --fresh --yes` (or `--latest --yes --force` to reuse an existing prod backup). Operator authorization is captured by the `--yes` flag — only pass it after they've explicitly approved this clone.

4. **Bounce the API to invalidate the settings cache.** The settings service caches decrypted `app_settings` for 30 min on startup. After clone, the cache holds the pre-clone (now-deleted-and-replaced) entries until the cache TTL or process restart. UI surfaces will appear "wiped" (e.g. `/admin/settings/itad` returns `configured: false`) until the cache reloads. Quickest fix: `echo "" >> api/src/main.ts` to force the `nest start --watch` watcher to restart the process, then revert (`git checkout -- api/src/main.ts`).

5. **Verify success.**
   - `curl -fsS http://localhost:3000/health | jq` — both `db.connected` and `redis.connected` should be true.
   - `docker exec raid-ledger-db psql -U user -d raid_ledger -c "SELECT count(*) FROM games;"` — should be >>0 (prod-sized).
   - `docker exec raid-ledger-db psql -U user -d raid_ledger -c "SELECT count(*) FROM app_settings;"` — should be your local row count (preserved across the clone).
   - Hit a settings probe like `curl -sS http://localhost:3000/admin/settings/itad -H "Authorization: Bearer <local-token>"` — should return `configured: true` after the API restart in Step 4.

6. **Release the env lock when done** (`mcp__mcp-env__env_lock_release`).

**Sanitization (server-side) excludes ROW DATA for:** `app_settings`, `local_credentials`, `sessions`, `consumed_intent_tokens`. Schema preserved, rows empty after restore. The script then re-applies the LOCAL preserved `app_settings` rows (those were encrypted with the local `JWT_SECRET` so they decrypt correctly afterwards). `local_credentials`/`sessions`/`consumed_intent_tokens` stay empty — the local admin password gets regenerated by Step 7.

**Backups exclude the `drizzle` schema** (migration metadata is code, not data). If a restore appears to "skip" migrations, run `DATABASE_URL=... node scripts/reconcile-migrations.mjs` to mark already-applied migrations as such. `deploy_dev.sh` runs reconcile automatically after auto-restoring from `api/backups/daily/`.

### Remote test fleet — `rl-infra` (STRICT — preferred path when reachable)

The `rl-infra` Proxmox VM hosts a 4-slot runner fleet so heavy compute (build, jest, vitest, playwright, allinone builds, per-env stacks) runs on the VM instead of the laptop, and multiple agents work in parallel without env-lock contention. Full design + runbook: `rl-infra/README.md`. Operator-facing summary: `.claude/skills/_shared/rl-infra-fleet.md`.

**Default behavior:** `RL_TARGET=auto` (the default) probes `RL_PROXMOX_HOST` over SSH. Reachable → remote mode. Unreachable / `RL_TARGET=local` → fall through to the legacy local section below.

In remote mode, prefer the `rl` CLI over today's equivalents:

| Legacy local                                | Remote-mode replacement              |
| ------------------------------------------- | ------------------------------------ |
| `mcp__mcp-env__env_lock_acquire`            | `rl claim --branch <name>`           |
| `mcp__mcp-env__env_lock_release`            | `rl release`                         |
| `./scripts/deploy_dev.sh --ci --rebuild`    | `rl env spin <slug>` (allinone)      |
| `./scripts/deploy_dev.sh --status`          | `rl status`                          |
| `./scripts/validate-ci.sh --full`           | `rl validate-ci --full`              |
| `docker exec raid-ledger-db psql …`         | `rl db <slug>`                       |
| `npx playwright test`                       | `rl validate-ci --only-e2e`          |

`scripts/validate-ci.sh` already self-dispatches to `rl validate-ci` when
`RL_TARGET=remote`, so existing `/push` / `/build` / `/fix-batch` flows that call
it work unchanged once `RL_TARGET` is set. Heartbeats fire every 60s while a claim
is held; missed heartbeats > 5min auto-release the slot (gc-sweeper). Always call
`rl release` at end-of-session anyway so the slot returns immediately.

Chrome MCP, Discord MCP (companion bot + mcp-discord), Sentry, Linear, and GitHub
stay on the laptop — they're network or display-bound, not compute-heavy. Browser
tests point at `https://slot-N.rl.lan` (or `https://<slug>.rl.lan` for a spun env)
instead of `localhost:5173`.

### Env coordination across agents (STRICT — local-mode fallback)

The local dev env (Docker DB, API `:3000`, Vite `:5173`) is a single shared resource. Multiple agents/worktrees cannot run it simultaneously — `deploy_dev.sh` will refuse to start if another worktree holds the lease.

State lives at `~/.raid-ledger/env-lock.json` (outside any worktree). The lease auto-expires when the holder's PID is dead OR when no heartbeat has arrived within the TTL (default 60min for MCP-acquired, 240min for `deploy_dev.sh`-acquired).

**Before any work that needs the env (smoke tests, browser testing, deploy):**

1. `mcp__mcp-env__env_lock_status` — see who holds it and who's queued. (`env_service_status` also includes lease state in its summary.)
2. `mcp__mcp-env__env_lock_acquire({ purpose: "<what you'll do>" })` — if `acquired: false`, you've been queued. Either come back later (call `env_lock_acquire` again — it's idempotent), or pick non-env work in the meantime. Auto-defaults `branch` via git and `worktree` to the MCP server's cwd.
3. Run `./scripts/deploy_dev.sh --ci --rebuild` (or pass `--wait-for-env <minutes>` to block instead of erroring if it's still held). The script re-acquires under your branch+worktree (idempotent if you already hold the lease) and registers its own PID for liveness tracking.
4. When done, call `mcp__mcp-env__env_lock_release` so the next queued agent can take it. `./scripts/deploy_dev.sh --down` also releases.

**Never bypass:** do not start the API/web manually to "skip the lock." If you find a stale lease (holder PID dead, no progress for >TTL), it auto-clears on the next `acquire`. If something is genuinely stuck, ask the operator before calling `env_lock_force_release`.

**Operator priority (`/opt`):** `/opt` (and `deploy_dev.sh --operator`) always preempts — it cuts the queue, displaces the current holder to the **front** of the queue with `preempted: true`, and takes the env immediately. If you were preempted, you'll see `preempted: true` on your queue entry; you'll get the env back when the operator releases, ahead of any normal-priority waiters. Don't fight it; let the operator test, then resume.

## Code Size Limits (STRICT — enforced by ESLint)

- **Max 300 lines per file** (`max-lines: error`, skipBlankLines + skipComments) — CI lint fails on violations. Run `npm run lint -w api` AND `npm run lint -w web` locally before pushing; `./scripts/validate-ci.sh --full` runs both. Note: line counts are after stripping blanks + comments, so the raw file may exceed 300 (e.g. `wc -l` 360 → counted 295 is fine).
- **Max 30 lines per function** (`max-lines-per-function: warn`, skipBlankLines + skipComments) — will be upgraded to `error` once existing violations are resolved
- **Design small from the start** — do not write large files and refactor after. Plan focused modules, extract helpers/sub-services/child components proactively.
- Test files (`*.spec.ts`, `*.test.tsx`) have a relaxed **750-line** file limit (not 300).
- Migration files are exempt from both limits.

## Infrastructure Changes (STRICT — Dockerfiles, entrypoints, nginx)

**Two deployment topologies exist — understand BOTH before changing either:**
- `api/Dockerfile` — API-only image for docker-compose dev/test (user: `nestjs`, Redis via TCP)
- `Dockerfile.allinone` — Production monolith for Synology NAS (user: `app`, supervisor, Redis via Unix socket at `/tmp/redis.sock` with `770` perms)

**Mandatory before pushing ANY infrastructure change:**
1. Read BOTH Dockerfiles to understand what your change affects
2. Build the allinone image locally: `docker build -f Dockerfile.allinone -t rl:test .`
3. Start it: `docker run --rm -d --name rl-test -p 8080:80 rl:test`
4. Verify: `curl http://127.0.0.1:8080/api/health` returns `{"status":"ok"}`
5. Cleanup: `docker stop rl-test`

**Rules:**
- Infrastructure changes get their OWN PR — never bundle with code changes
- Never merge infrastructure PRs without CI passing (container-startup job)
- One fix per outage attempt. If a hotfix fails, REVERT to last known good state — do not stack more fixes
- The allinone entrypoint runs as root (supervisor manages child process users) — do NOT add privilege dropping to `docker-entrypoint.sh`

### Migration Generation Rules

- **Always run `./scripts/fix-migration-order.sh --check`** after generating a migration to verify journal timestamps are monotonically increasing. Concurrent branches can produce out-of-order timestamps that Drizzle silently skips.
- **Validate against a real Postgres instance** before pushing: `./scripts/validate-migrations.sh` spins up a temporary container, runs all migrations, and tears down. This is also run automatically by `validate-ci.sh` when migration files appear in the diff.
- **Never hand-edit migration SQL** unless fixing a known Drizzle codegen bug. If you must, document the edit in the commit message.
- **One migration per schema change.** Do not combine unrelated schema changes into a single migration file.
- **Migrations must be self-contained (STRICT — ROK-1281).** A migration MUST NOT depend on data populated by app-side code (cron jobs, manual admin endpoints, user actions). If a migration needs derived state (e.g. a deduplication audit), either compute it inline via SQL CTEs or wire a pre-step into the boot-time migration runner (`api/scripts/run-migrations-with-sentry.ts`) so the dependency is enforced by the deploy pipeline, not human memory. ROK-1278's 0140 violated this rule, assumed `games_dedup_audit` was populated by the ROK-1277 cron, and crashed prod for 30 min when prod's audit was stale.
- **Boot-time scripts must instrument errors via Sentry (STRICT — ROK-1281).** Any Node script that runs before NestJS bootstrap (migrations, bootstrap-admin, seed-igdb-games, re-encrypt-settings) must:
  1. Import `../src/sentry/instrument` as the first statement (init must happen before any throw).
  2. Wrap the script's main path in try/catch.
  3. On error: `Sentry.captureException(err, { tags: { context: '<phase>' } })`, then `await Sentry.flush(2000)`, then `process.exit(1)`.
  The pattern is implemented in `api/scripts/run-migrations-with-sentry.ts::reportBootFailure` — copy it. Boot-time scripts live in `api/scripts/` (not `api/src/scripts/`) because `nest build` compiles them to `api/dist/scripts/` which the allinone image's docker-entrypoint expects at `/app/dist/scripts/<name>.js`. Boot-time errors that exit synchronously WITHOUT flushing are invisible to alerting even when Sentry IS initialized — `process.exit` kills the event before the HTTP POST completes.

### Migration State Recovery

Backups exclude the `drizzle` schema (migration metadata is code, not data) to prevent cross-branch hash drift. When restoring a backup or unsticking a drifted dev DB:

- **`DATABASE_URL=... node scripts/reconcile-migrations.mjs`** — probes each journal entry, skips any whose effects already exist (treats `column already exists`, `relation already exists`, etc. as idempotent), runs anything truly missing, and records the hash row. Safe to re-run. Add `--dry-run` to preview.
- `deploy_dev.sh` calls reconcile automatically after an auto-restore from `api/backups/daily/`.
- **Symptom that means you need reconcile:** `drizzle-kit migrate` fails with `column/relation X already exists` on a migration whose hash isn't in `drizzle.__drizzle_migrations`.

### Games-table INSERT paths must use the name-dedup guard (STRICT — ROK-1113 / ROK-1283)

Postgres UNIQUE constraints treat NULL as never-equal, so `ON CONFLICT (igdb_id)` does NOT fire when an existing row has `igdb_id IS NULL`. Any new code that inserts into `games` MUST first call `findGameByNormalizedName(db, name)` (or the batch variant `findGameIdsByNormalizedName`) and merge into the existing row when one matches. Otherwise the next migration that collapses dups will be silently undone on the next deploy.

The 5 current INSERT-into-`games` paths, all of which use the name-dedup guard:

1. `api/src/steam/steam-itad-discovery.helpers.ts` — steam-itad discovery (ROK-1113).
2. `api/src/igdb/igdb-itad-upsert.helpers.ts` — IGDB+ITAD upsert path (ROK-1113).
3. `api/src/igdb/igdb-upsert.helpers.ts::upsertSingleGameRow` — single-row IGDB upsert (ROK-1113; canonical pattern).
4. `api/src/igdb/igdb-upsert.helpers.ts::upsertGamesFromApi` — batch IGDB upsert (ROK-1113).
5. `api/scripts/seed-igdb-games.ts::upsertSeedGames` — boot-time IGDB seed (ROK-1283).

A 6th path exists at `api/scripts/seed-games.ts` (boot-time game-registry seed) and uses `ON CONFLICT (slug) DO NOTHING`. It is theoretically vulnerable to the same NULL-as-distinct trap but practically safe: its slugs match the IGDB seed and prod data has no surviving name dups post-ROK-1278. The same fix should be applied when next touching that file — tracked in TECH-DEBT-BACKLOG.md under 2026-05-14 / ROK-1283.

When adding a NEW INSERT-into-`games` path, append it to this list. The reproduction that motivates the rule: prod 2026-05-14 — migration 0140 merged 21 BG3-like dups, then `seed-igdb-games.ts` immediately re-created the BG3 dup on the same boot because its `ON CONFLICT (igdb_id)` target ignored the NULL-keyed survivor row.

## Testing

- **Backend:** `npm run test -w api` (Jest). Coverage: `npm run test:cov -w api`
- **Frontend:** `npm run test -w web` (Vitest). Coverage: `cd web && npx vitest run --coverage`
- **Smoke tests:** `npx playwright test` (Playwright, requires DEMO_MODE=true for auth flows)
- **Read `TESTING.md` before writing or modifying any test file.**
- Shared test infra: `api/src/common/testing/` (drizzle-mock, factories), `web/src/test/` (MSW handlers, render helpers, factories)

### Cheap validation harness — `scripts/spec-loop.sh` (STRICT — cheap experiments first)

Per memory `feedback_cheap_experiments_first.md`: falsify hypotheses with N=1 deterministic experiments BEFORE paying for N=30 instrumented loops.

`./scripts/spec-loop.sh <spec-pattern> [N] [STOP_ON_FIRST=true|false]` loops a single Jest integration spec N times (default 50) and tabulates results. Single-file isolation is **7-15 s per run vs ~7 min** for the full suite. The script greps each run for flake-class patterns (`socket hang up`, `ECONNRESET`, `Parse Error`, `HPE_*`) — same set the runtime `socket-debug.ts::isFlakeError` matches.

**When to use:**
- **Pre-fix repro:** confirm a flake exists at a measurable rate before designing a fix. Saves rework on phantom bugs.
- **Post-fix validation:** 0/50 on the carrier spec is a strong signal the fix works at the per-file level. Pair with a full-suite run before shipping.
- **Mechanism discrimination:** intra-file (reproduces in isolation) vs cross-file (only on full suite) → narrows the search space cheaply.
- **Config A/B sweeps:** 3-5 runs each for several config values (e.g. `maxSockets: 1 / 2 / 5`) → discriminate trade-offs in minutes.
- **Hypothesis falsification:** if you suspect mechanism X, write a focused micro-test, run it 100× in seconds, and either confirm or eliminate the path.

**Output:** `/tmp/spec-loop-<pattern>-<ts>/summary.tsv` (run / exit / wallclock_s / flake_count / excerpt) plus per-run logs. Exit 0 = all clean; 1 = at least one flake hit or non-zero exit.

**Provenance:** the pattern emerged from ROK-1264's Tier-1 investigation. The history is captured in `docs/spikes/rok-1250-residual-layer-5.md` §2 (the original ad-hoc loops that produced the H4 identification + 0/50 post-fix validation + maxSockets sweep).

#### Flake-investigation protocol (STRICT — reproduce BEFORE designing a fix)

For ANY change presented as a fix for a flaky, intermittent, or non-deterministic integration test failure, an agent **MUST** establish empirical baseline rates BEFORE designing the fix. Skipping this step has cost the project multiple multi-hour spike cycles (ROK-1249, ROK-1250, ROK-1264 H2 false-positive — see `docs/spikes/rok-1250-residual-layer-5.md`).

**Required order:**

1. **Reproduce in isolation first** — `./scripts/spec-loop.sh <suspected-carrier-spec> [N]`. Default N=50. Two outcomes:
   - **Reproduces** (≥1 hit in 50 runs) → intra-file mechanism. Cheap iterative fix-validation is now unlocked.
   - **Does NOT reproduce** in 50+ runs → cross-file, environmental, or wrong carrier suspect. STOP and re-examine. Do not jump to a global fix on an unreproduced hypothesis.
2. **Design the fix** only AFTER step 1 gives you measurable signal.
3. **Validate the fix at the same per-spec scale** — `./scripts/spec-loop.sh <same-spec> 50`. Bar: **0 hits in 50 runs**. If the rate dropped but isn't zero, the fix is incomplete OR the wrong shape.
4. **Run the full integration suite** AFTER per-spec validation passes. This is where global-config changes (shared agents, server timeouts, env-level patches) reveal incompatibility with OTHER specs — the failure mode that bit ROK-1264's `maxSockets:1` wrap.

**Skipping any step:**
- Skip step 1 → no falsifiable baseline. Fix may address a phantom bug or the wrong mechanism. Operator and reviewer have no way to validate the diagnosis.
- Skip step 3 → no per-spec proof the fix actually does what's claimed.
- Skip step 4 → ship a regression to unrelated specs (the events.spec failure pattern this rule exists to prevent).

**When the protocol doesn't apply:**
- Pure unit tests (deterministic by design — they're either passing or buggy)
- Environmental flakes only reproducible on Render/CI (record this explicitly; spec-loop is local)
- Discord-bot or browser-UI flakes (use the companion bot or Playwright loops instead)

In ambiguous cases: run the protocol anyway. The cost is 7 minutes; the rework cost when skipped is days.

### Local CI

Run `./scripts/validate-ci.sh --full` before pushing any branch. This replaces manual per-step checks.

| GitHub CI Job | Local Equivalent | Script |
|---------------|------------------|--------|
| Build | `npm run build` (all workspaces) | `validate-ci.sh` |
| TypeScript | `npx tsc --noEmit` (api + web) | `validate-ci.sh` |
| Lint | `npm run lint` (api + web) | `validate-ci.sh` |
| Unit tests | `npm run test:cov -w api`, `vitest run --coverage` (web) | `validate-ci.sh` |
| Integration tests | `npm run test:integration -w api` | `validate-ci.sh` |
| Migration validation | Postgres container + `drizzle-kit migrate` | `validate-migrations.sh` (conditional) |
| Container startup | Build + start allinone image, health checks | `validate-ci.sh` (conditional) |
| Playwright (desktop + mobile) | `npx playwright test` | `validate-ci.sh` (conditional + env-gated) |
| Discord smoke (companion bot) | `cd tools/test-bot && npm run smoke` | `validate-ci.sh` (conditional + env-gated) |

**Conditional steps** — `validate-ci.sh` auto-scopes the expensive jobs based on `git diff` against `origin/main` and the local dev env state:

- **Migrations:** run iff `drizzle/migrations/**` changed.
- **Container startup:** run iff `Dockerfile*`, `nginx/**`, or `docker-entrypoint*` changed.
- **Playwright:** run iff diff touches `web/**`, `api/src/auth/**`, `api/src/admin/demo-test*`, `playwright.config.*`, or `scripts/smoke/**` AND `:3000/health` + `:5173` both answer. SKIPPED otherwise (with a clear reason in the summary).
- **Discord smoke:** run iff diff touches `api/src/discord-bot/**`, `api/src/notifications/**`, `api/src/events/signups*`, `api/src/events/event-lifecycle*`, `api/src/admin/demo-test*`, `tools/test-bot/src/smoke/**`, or `tools/test-bot/src/helpers/polling.ts` AND env is up.

**E2E flags:**

- Default (auto): diff + env gated as above. Backend-only branches pass through in seconds; UI/bot branches get the right coverage automatically.
- `--no-e2e`: skip Playwright + smoke (use for pre-deploy static checks where you'll run e2e separately).
- `--with-e2e`: force-run e2e even if diff detector says no triggering files changed (paranoid pre-push, or shared-component changes the detector won't flag).
- `--only-e2e`: skip everything except the e2e steps (use in post-deploy gates where static checks already ran upstream).

**Env-down behavior:** in default/auto mode, missing env produces SKIPPED + a "run `deploy_dev.sh` first if you need e2e coverage" message. `--with-e2e` against a missing env fails fast.

**Backup integration tests** (`api/src/backup/backup.integration.spec.ts`) shell out to `pg_dump` / `pg_restore`. They are gated by `SKIP_BACKUP_INTEGRATION`:

- Locally: `validate-ci.sh` checks for `pg_dump` on PATH. If missing, it prints a yellow warning, sets `SKIP_BACKUP_INTEGRATION=1`, and the suite skips. Install `postgresql-client` (e.g. `brew install libpq` on macOS) to run them.
- In CI: pass `--ci` to `validate-ci.sh`. Missing `pg_dump` then hard-fails instead of skipping, so CI never silently misses these tests.

### Smoke Test Verification (STRICT — learned from ROK-935 incident)

**CI runs BOTH desktop AND mobile Playwright projects.** Local verification MUST match CI. `validate-ci.sh` invokes `npx playwright test` with no `--project` filter, so both projects run automatically. If you invoke Playwright directly, never narrow it:

```bash
# WRONG — only tests desktop, mobile failures will surprise you in CI
npx playwright test --project=desktop

# RIGHT — tests both projects, matches CI exactly
npx playwright test
# OR (preferred — runs Discord smoke too if relevant, auto-skips if not)
./scripts/validate-ci.sh --only-e2e
```

**Before pushing ANY branch with UI changes:**
1. Deploy locally (`./scripts/deploy_dev.sh --ci`), then run `./scripts/validate-ci.sh --full` — it includes both desktop + mobile Playwright when web/auth/demo-test files changed.
2. If the validate-ci summary shows `Playwright: SKIPPED — Dev env not responding`, you skipped the deploy or the env is partly down. Bring it up and re-run.
3. If any test fails, fix it BEFORE pushing — do NOT use CI as a debugger.
4. New components on shared pages (layout, nav, Games page) break selectors in OTHER test files — run the FULL suite, not just your feature's tests. If your diff is in a shared component the auto-scope might miss, force-run with `--with-e2e`.

**When smoke tests fail in CI:**
1. Check the ACTUAL error message — is it "element not found", "strict mode", or "timeout"?
2. "Element not found" = the selector is wrong or the UI differs in CI (missing data, unconfigured services)
3. "Strict mode" = selector matches 2+ elements (new DOM from your changes collided with existing selectors)
4. "Timeout" with correct selector = CI runner is slow, increase timeout or add retry
5. **NEVER re-run CI hoping it passes** — investigate the failure first

### Test Failure Rules (STRICT — applies to ALL agents)

- **NEVER dismiss test failures as "pre-existing" or "unrelated to this change."** Every test failure must be investigated and either fixed or tracked in a Linear story with root cause. This rule was violated during ROK-935 and cost 6 hours — it exists for a reason.
- **NEVER use `sleep()` in smoke tests.** Use deterministic wait helpers (`waitForEmbedUpdate`, `pollForCondition`, etc.).
- **NEVER skip or weaken a test assertion to make CI pass.** Fix the code or fix the test infrastructure.
- **Every feature/fix MUST include an end-to-end test:**
  - UI changes → Playwright smoke test (desktop + mobile)
  - Discord bot/notification changes → Discord companion bot smoke test
  - API-only changes → Integration test (Jest, real DB)
  - Pure logic → Unit test

## Discord User Deactivation (ROK-1260, ROK-1282)

When a user leaves the Discord guild we must flip `users.deactivated_at` so they stop receiving DMs, get cancelled from upcoming signups, and disappear from the Players list. There is **no `GuildMemberRemove` listener** — ROK-1260's spec mentioned one but it was never shipped. Three layers cover the gap instead. Before adding a fourth, confirm one of the existing three is insufficient.

| Layer | Trigger | Where | Misses |
|-------|---------|-------|--------|
| 1. Reactive 50278 classifier | DM send fails with `DiscordAPIError[50278]` | `api/src/notifications/discord-notification.processor.ts` (~line 117) | Quiet users who never receive a notification |
| 2. `GuildMemberAdd` listener | User joins/rejoins the guild | `api/src/discord-bot/listeners/guild-member-add.listener.ts` | Only re-enables; nothing on the leave side |
| 3. Daily reconciliation cron | `@Cron('0 0 7 * * *')` — 07:00 UTC daily | `api/src/users/guild-reconciliation.service.ts` | Users gone for <24h (rare; layer 1 usually catches first DM) |

All three call into `DiscordNotificationService.deactivateUser(userId)` so the cancel cascade + admin notification path is identical. `deactivateUser` is idempotent (RETURNING-guarded UPDATE), so overlap between layers is safe.

## Discord Testing (tools/)

Two tools exist for testing Discord bot functionality. **Use these when testing any Discord-related feature** (events, attendance, notifications, embeds, voice).

### Launch Discord with CDP

```bash
./scripts/launch-discord.sh          # Launch with CDP on port 9222
./scripts/launch-discord.sh --kill   # Kill + relaunch with CDP
```

### Companion Bot (`tools/test-bot/`)

A discord.js v14 bot for **API-level testing** — CI-compatible, stable, uses official Discord APIs.

- **Config:** `tools/test-bot/.env` (token + guild ID are static; channel IDs are per-test)
- **Programmatic usage:** `import { connect, readLastMessages, joinVoice, ... } from '../tools/test-bot/src/index.js'`
- **Available helpers:**
  - Messages: `readLastMessages(channelId, count)`, `waitForMessage(channelId, predicate, timeout)`, `readDMs(count)`
  - Voice: `joinVoice(channelId)`, `leaveVoice()`, `moveToChannel(channelId)`, `getVoiceMembers(channelId)`
  - Interactions: `clickButton()`, `selectDropdownOption()` (limited — bots can't click other bots' buttons via Discord API)
  - **Deterministic polling** (replaces `sleep()`): `pollForEmbed(channelId, predicate, timeout)`, `waitForEmbedUpdate(channelId, predicate, timeout)`, `waitForDM(userId, predicate, timeout)`, `pollForCondition(check, timeout)` — see `tools/test-bot/src/helpers/polling.ts`
- **Key limitation:** Bots cannot interact with other bots' message components. Test button/interaction handlers directly in NestJS integration tests instead.

### MCP Discord Tools (`tools/mcp-discord/`)

Playwright-over-CDP tools for **UI-level verification** — local dev only, requires Discord running with CDP.

- **Registered in `.mcp.json`** as `mcp-discord` — tools are available as `mcp__mcp-discord__*`
- **7 tools:** `discord_screenshot`, `discord_read_messages`, `discord_navigate_channel`, `discord_verify_embed`, `discord_click_button`, `discord_check_voice_members`, `discord_check_notification`
- **When to use:** Visual verification of embeds, checking notification delivery in DMs, verifying voice channel membership shown in Discord UI, screenshots for debugging
- **Not for CI** — requires local Discord Electron with CDP enabled

### Discord Smoke Tests (MANDATORY)

Smoke tests in `tools/test-bot/src/smoke/tests/` validate real Discord behavior end-to-end: `cd tools/test-bot && npm run smoke`

**When modifying Discord bot code, you MUST:**
1. Run the smoke tests locally before pushing
2. If a test fails due to intentional behavior change, update the test to match the new behavior — do NOT delete or weaken the assertion
3. If adding new Discord functionality, add a corresponding smoke test
4. Never modify a smoke test just to make CI pass — investigate why it broke first
5. Run the no-sleep lint before pushing: `npm run lint:no-sleep` (from `tools/test-bot/`)

**Deterministic test framework:** All smoke tests use deterministic wait helpers instead of `sleep()`. See TESTING.md "Smoke Test Authoring Standards" for the full helper reference.

**Test-only API endpoints** (`/admin/test/*`, DEMO_MODE only): Used by smoke test fixtures for operations that require server-side coordination. Key endpoints:
- `POST /admin/test/await-processing` — drain all BullMQ queues before asserting
- `POST /admin/test/flush-embed-queue` — drain embed sync queue
- `POST /admin/test/flush-notification-buffer` — flush buffered notifications
- `POST /admin/test/flush-voice-sessions` — flush in-memory voice sessions to DB
- See `api/src/admin/demo-test.controller.ts` for the full list

**Test categories** map to files in `tools/test-bot/src/smoke/tests/*.test.ts` — see file names for current coverage areas.

**Files that trigger smoke test review:**
- `api/src/discord-bot/**` — bot listeners, embed factory, channel bindings, voice state
- `api/src/notifications/**` — notification dispatch, DM embeds, reminder services
- `api/src/events/signups*` — signup creation, auto-allocation, roster assignment
- `api/src/events/event-lifecycle*` — cancel, reschedule, delete flows
- `api/src/admin/demo-test*` — test-only API endpoints used by smoke tests
- `tools/test-bot/src/smoke/**` — the tests themselves
- `tools/test-bot/src/helpers/polling.ts` — deterministic wait helpers

### When to use which tool

| Scenario | Tool | Why |
|----------|------|-----|
| Verify bot sends correct embed content | Companion bot (`readLastMessages`) | API-level, reliable, CI-safe |
| Verify embed renders correctly in Discord | MCP (`discord_verify_embed`) | Needs visual/DOM inspection |
| Check who's in a voice channel (API) | Companion bot (`getVoiceMembers`) | Uses guild cache, fast |
| Check voice UI shows members correctly | MCP (`discord_check_voice_members`) | Reads Discord sidebar DOM |
| Test button click handlers | NestJS integration tests | Bots can't click other bots' buttons |
| Debug what Discord looks like right now | MCP (`discord_screenshot`) | Visual aid |
| Wait for bot to respond to a command | Companion bot (`waitForMessage`) | Event-based, reliable |
