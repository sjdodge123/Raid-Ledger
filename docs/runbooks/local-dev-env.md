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

`./scripts/clone-prod-to-local.sh` triggers a sanitized prod backup, downloads it, restores into the local DB, resets the local admin password, and preserves your local `app_settings` (API keys) across clones. Destructive — operator-authorized only. Full runbook (`.env.clone` format, settings-cache bounce, verification): memory `reference_clone_prod_runbook.md`.

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

The full legacy→remote mapping table (env lock → `rl claim`/`rl release`, deploy → `rl env spin`, validate-ci, psql, playwright) lives in `.claude/skills/_shared/rl-infra-fleet.md`. Design + runbook: `rl-infra/README.md`.

Chrome MCP, Discord MCP (companion bot + mcp-discord), Sentry, Linear and GitHub stay on the laptop — they're network or display-bound, not compute-heavy.
