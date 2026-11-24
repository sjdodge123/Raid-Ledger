# Local dev environment + env lock — reference

> Extracted from `CLAUDE.md` on 2026-09-18 to keep the always-loaded project
> instructions small. **The rules still live in CLAUDE.md** ("## Local Dev
> Environment"): acquire the lease before any env work, never start the API/web
> manually to skip the lock, release as soon as env-needing work ends. This file
> holds the flag inventory and the lease semantics. Not independent — do not add
> rules here.

## `./scripts/deploy_dev.sh`

Ensures Docker is up, runs migrations, seeds data, starts API + web in watch mode.

**Flags:** `--rebuild` (rebuild contract), `--fresh` (reset DB), `--reset-password`, `--branch <name>`, `--ci` (non-interactive, for agents), `--down`, `--status`, `--logs`, `--wait-for-env <minutes>` (block instead of erroring when the lease is held), `--operator` (preempt).

**Worktree-safe:** the script auto-detects worktrees, copies `.env` + `api/.env` from the main repo, and always uses the correct Docker volumes. Run `./scripts/deploy_dev.sh --ci --rebuild` from any worktree.

**Docker volume gotcha (handled automatically):** the script uses `docker start` by name first, falling back to `docker compose` from the main repo's compose file. This prevents worktrees from creating separate volumes with wrong directory prefixes.

**Ports:** API on `:3000`, Web on `:5173` (Vite may increment to `:5174` if `:5173` is in use — CORS allows both).

## Clone prod → local

`./scripts/clone-prod-to-local.sh` triggers a sanitized prod backup, downloads it to a temp dir, and restores it **straight into the `raid-ledger-db` container with `pg_restore`** — the local API does **not** need to be running, and it works the same whichever worktree `deploy_dev.sh` last ran from. It then resets the local admin password from `--tree <path>` (default: the git top-level of your current directory; a failed reset prints a `WARN` and the recovery command but does not fail the clone) and preserves your local `app_settings` (API keys). Destructive — operator-authorized only. A safety `pg_dump` of the local DB goes to `~/.cache/raid-ledger/pre-clone/` first (last 3 kept).

- **Env file** — first found wins: `$RL_ENV_CLONE_FILE` → **`~/.config/raid-ledger/env.clone`** (recommended: one file for every tree) → `<tree>/.env.clone` → the main checkout's `.env.clone`. Needs `PROD_URL`, `DATABASE_URL` (exactly `postgres[ql]://[user[:pass]@]localhost|127.0.0.1|[::1][:port]/<db>`, optionally `?sslmode=disable|allow|prefer|require`; any other query key, a unix-socket URL, a second `@`, a host list or a control character is refused, as are a non-local `PGHOST`/`PGHOSTADDR` and any `PGSERVICE`/`PGSERVICEFILE`) and **`PROD_BACKUP_TOKEN=rlbx_…`**, minted in prod Admin → Backups → Clone access tokens (it can only list, create and download backups). `PROD_BEARER_TOKEN` (short-lived JWT) and `PROD_ADMIN_EMAIL` + `PROD_ADMIN_PASSWORD` still work for one release with a deprecation warning. `LOCAL_URL` / `LOCAL_ADMIN_EMAIL` are no longer required.
- **Migration journal** — the restore keeps prod's `drizzle.__drizzle_migrations`, so a branch migration is pending afterwards and runs for real on the cloned data at the next `npm run db:migrate -w api` (or API boot) from your tree. The script warns when a branch migration is older than prod's newest and would be skipped.
- `./scripts/clone-prod-to-env.sh <slug> [--tree <path>]` runs the same clone, then pushes the local DB into a fleet env.

Settings-cache bounce and verification: memory `reference_clone_prod_runbook.md`.

## Env lock — the acquire/release cycle

State lives at `~/.raid-ledger/env-lock.json` (outside any worktree). The lease auto-expires when the holder's PID is dead OR when no heartbeat has arrived within the TTL (default 60min for MCP-acquired, 240min for `deploy_dev.sh`-acquired).

1. `mcp__mcp-env__env_lock_status` — see who holds it and who's queued. (`env_service_status` also includes lease state in its summary.)
2. `mcp__mcp-env__env_lock_acquire({ purpose: "<what you'll do>" })` — if `acquired: false`, you've been queued. Either come back later (it's idempotent), or pick non-env work in the meantime. Auto-defaults `branch` via git and `worktree` to the MCP server's cwd.
3. Run `./scripts/deploy_dev.sh --ci --rebuild`. The script re-acquires under your branch+worktree (idempotent if you already hold the lease) and registers its own PID for liveness tracking.
4. When done, call `mcp__mcp-env__env_lock_release` so the next queued agent can take it. `./scripts/deploy_dev.sh --down` also releases.

A stale lease (holder PID dead, no progress for >TTL) auto-clears on the next `acquire`. If something is genuinely stuck, ask the operator before calling `env_lock_force_release`.

## Operator priority (`/opt`)

`/opt` (and `deploy_dev.sh --operator`) always preempts — it cuts the queue, displaces the current holder to the **front** of the queue with `preempted: true`, and takes the env immediately. If you were preempted you'll see `preempted: true` on your queue entry; you get the env back when the operator releases, ahead of any normal-priority waiters. Don't fight it; let the operator test, then resume.

## Release matching (`env_lock_release` semantics, ROK-1318)

The release path matches in this order — (1) `agent_id` (a stable SHA1 of branch+worktree the MCP server stamps on every `acquire`), then (2) (branch, worktree) as a fallback. The agent_id predicate survives `deploy_dev.sh`'s mid-deploy re-anchor (which re-acquires under its own cwd to swap in the long-lived API PID) and any later cwd drift on the MCP side. The bare CLI (`./scripts/env-lock.sh release <branch> <worktree>`) works without `--agent-id` via the fallback.

`deploy_dev.sh --down` is a strict superset of `env_lock_release` — it tears down the dev env *and* clears the lease — so use it when you're done with the env entirely, and `env_lock_release` when you just want to hand off the lease.

## `mcp-env` tool index (`tools/mcp-env/`)

| Tool | Use When |
|------|----------|
| `env_check` | Before `deploy_dev.sh` or when builds fail due to missing env vars. |
| `env_copy` | Setting up a new worktree. |
| `env_service_status` | Verify local dev env is running; also reports lease state. |
| `env_lock_status` | Before any work that needs `:3000` / `:5173`. |
| `env_lock_acquire` | Before deploy. Pass `purpose`; optional `priority: "operator"` preempts. |
| `env_lock_release` | Always, as soon as env-needing work ends — don't hold through reviewer/push/PR. |
| `env_lock_force_release` | Operator-only override for a stuck lease — ask the operator first. |
| `story_status` | Resuming in-flight work to reconcile against origin. |

## Remote fleet mode

`RL_TARGET=auto` (the default — operator CLI only; agents don't probe SSH) makes the `rl` CLI probe `RL_PROXMOX_HOST` over SSH. Reachable → remote mode; unreachable / `RL_TARGET=local` → the local env above.

`scripts/validate-ci.sh` self-dispatches to `rl validate-ci` when `RL_TARGET=remote`, so `/push` / `/build` / `/fix-batch` work unchanged. Heartbeats fire every 60s while a claim is held; missed heartbeats > 30min auto-release the slot (gc-sweeper). Call `rl release` at end-of-session anyway so the slot returns immediately.

**Pinned envs and claims (2026-10-19):** a branch-mismatch claim never destroys a pinned env (`env-pin`) — it stays on the slot and is reported in `preserved_pinned`. `rl_claim` derives `branch` from `worktree_path` and refuses a detached HEAD (`claim_branch_unresolved`), so check out a branch (or pass `branch`) before claiming a slot that holds an env you mean to redeploy.

The full legacy→remote mapping table (env lock → `rl claim`/`rl release`, deploy → `rl env spin`, validate-ci, psql, playwright) lives in `.claude/skills/_shared/rl-infra-fleet.md`. Design + runbook: `rl-infra/README.md`.

Chrome MCP, Discord MCP (companion bot + mcp-discord), Sentry, Linear and GitHub stay on the laptop — they're network or display-bound, not compute-heavy.

## Moved from CLAUDE.md (ROK-2307)

> **Moved verbatim from `CLAUDE.md` on 2026-11-24 (ROK-2307)** to keep the always-loaded
> instructions small. CLAUDE.md keeps each rule's binding statement and points here; the text
> below is the full original rule, unchanged apart from heading levels. Change both together.

### Local Dev Environment

`./scripts/deploy_dev.sh --ci --rebuild` starts everything (Docker, migrations, seed, API `:3000` + web `:5173` in watch mode) and is worktree-safe. Flags, the Docker-volume gotcha, clone-prod-to-local and the full lease semantics: `docs/runbooks/local-dev-env.md`.

- **DEMO_MODE=true** in root `.env` enables the `/admin/test/*` fixture endpoints (still behind the JWT + admin guards) and demo-only UI affordances. **It is NOT an auth bypass and does NOT prefill credentials** — the login page's `placeholder="admin"` reads like a prefill but is empty. Agents driving a fleet env in a browser must obtain a session another way (Playwright's global-setup JWT via `rl_validate_ci`, or the operator's Discord OAuth); **never type a password into a form, and never copy a credential out of a tool result into a form or a file**. (Corrected 2026-09-12 after two verification lanes lost a cycle to this line.)

### Remote test fleet — `rl-infra` (STRICT — preferred path when reachable)

The `rl-infra` Proxmox VM hosts a 2-slot runner fleet so heavy compute (build, jest, vitest, playwright, allinone builds, per-env stacks) runs on the VM instead of the laptop, and agents work in parallel without env-lock contention. **Heavy test runs go to the fleet, not the laptop — the laptop's RAM is the operator's.** `scripts/validate-ci.sh` self-dispatches to `rl validate-ci` when `RL_TARGET=remote`, so `/push` / `/build` / `/fix-batch` work unchanged. Always `rl release` at end-of-session. Design + runbook: `rl-infra/README.md`; mode mapping: `docs/runbooks/local-dev-env.md` and `.claude/skills/_shared/rl-infra-fleet.md`.

### Env coordination across agents (STRICT — local-mode fallback)

The local dev env (Docker DB, API `:3000`, Vite `:5173`) is a single shared resource — multiple agents/worktrees cannot run it simultaneously, and `deploy_dev.sh` refuses to start if another worktree holds the lease.

**Before any work that needs the env** (smoke tests, browser testing, deploy): `env_lock_status` → `env_lock_acquire({ purpose })` → `deploy_dev.sh --ci --rebuild` → `env_lock_release` **as soon as env-needing work ends** (don't hold it through reviewer/push/PR). If `acquired: false` you're queued — come back later or pick non-env work.

**Never bypass:** do not start the API/web manually to "skip the lock." A stale lease auto-clears on the next `acquire`; ask the operator before calling `env_lock_force_release`.

**Operator priority (`/opt`)** always preempts and displaces you to the front of the queue (`preempted: true`). Don't fight it; let the operator test, then resume.
