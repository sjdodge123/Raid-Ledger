# rl-infra fleet — shared playbook

Heavy compute (build, jest, vitest, playwright, allinone image build, dev env
stack) runs on a Proxmox VM called `rl-infra` instead of the laptop. The laptop
keeps editing, MCPs (Discord/Chrome), Linear/GitHub network calls, and git refs.

Full design + runbook: `rl-infra/README.md`. This file is the tl;dr that
other skills reference.

## When this applies

`rl-infra/cli/rl doctor` resolves `RL_TARGET`:

- `remote` — Proxmox VM is reachable. Use the runner fleet.
- `local`  — airplane mode / VM down. Fall back to today's local model
  (`deploy_dev.sh`, MCP env lock, `validate-ci.sh` on localhost).

You don't have to choose by hand. `RL_TARGET=auto` (default) probes
`nc -z $RL_PROXMOX_HOST 22` and picks. To force local, export `RL_TARGET=local`.

## Remote-mode flow (the default when Proxmox is up)

```bash
rl claim --branch $(git branch --show-current)   # acquires a slot 1..4 (may enqueue with queue_position=N)
# → starts Mutagen sync (laptop ↔ /srv/rl-infra/runners/slot-N/worktree)
# → starts a 60s heartbeat daemon (missed >5min → slot auto-released)
# Output gives: slot number, web URL (slot-N.rl.lan), debug URL, shell command.
# When all slots are busy, prints `enqueued queue_position=N` instead — use
# the rl_claim_wait MCP tool (or `rl claim-wait --timeout 600` CLI) to block.

rl shell                                          # tmux attach into the runner

rl env spin <slug> [--image tag]                  # spin per-env allinone+PG
rl env list
rl env destroy <slug>

rl validate-ci [...args]                          # runs validate-ci.sh INSIDE the runner
rl db <slug> [--web]                              # psql or pgweb
rl logs [filter]                                  # open Grafana with Loki filter
rl top                                            # ctop live resource view

rl release                                        # destroy child envs, prune, drop claim
```

## What scripts/agents must do differently in remote mode

1. **Replace the env-lock dance with a slot claim.** Instead of
   `mcp__mcp-env__env_lock_acquire`, run `rl claim` (queues with
   `queue_position=N` when slots are held; `rl claim_wait` blocks until
   queue head and may surface `inherited_envs[]` from the previous holder).
   The slot IS the lease, and there are 4 of them, so contention is rare.
2. **Don't `cd` into the worktree manually** — Mutagen mirrors files into the
   runner's `/workspace`. Edit on the laptop, the runner sees changes within ~1s.
3. **Shell out to the runner for compute-heavy commands**:
   - `npm run build -w api` → `rl validate-ci`, or
     `mcp__mcp-rl-fleet__rl_run_on_runner({ command: 'npm run build -w api', worktree_path: '<abs>' })`
     for a single targeted invocation. Agents MUST use the MCP path — direct
     SSH as `rl-agent` is closed (ROK-1338 PR-3).
   - `./scripts/deploy_dev.sh` → `rl env spin <slug>` (built artifacts, prod-like)
   - `npm run test:integration` → wrap with `rl validate-ci --no-e2e`
   - `npx playwright test` → wrap with `rl validate-ci --only-e2e`
4. **Point browser tests at the slot hostname**, not localhost:
   `PLAYWRIGHT_BASE_URL=https://slot-N.rl.lan npx playwright test`.
5. **DB introspection commands** become `rl db <slug>` instead of
   `docker exec raid-ledger-db psql ...`.
6. **Sentry/Linear/GitHub stay local** — those are network calls, not compute.
7. **Discord smoke + Chrome MCP** stay local — they need physical Discord
   Electron and Chrome with CDP on the laptop. They point at the remote env URL.

## What to do at the end of a session

1. `rl release` — destroys child envs spun by your slot, prunes images/volumes
   scoped to your slot label, resets the slot record. Same idea as the
   end-of-session env-lock release.
2. The gc-sweeper runs every 15min anyway, so a missed release just delays
   reclaim by up to 5min (heartbeat timeout) + the next sweep cycle.

## Local-mode fallback (airplane)

`rl <cmd>` notices `RL_TARGET=local` and either:

- Maps to the existing local equivalent (`rl status` → `deploy_dev.sh --status`,
  `rl claim` (and its queue/`rl_claim_wait` companion) → "use env-lock.sh acquire" message — historical behavior preserved), or
- Refuses with a clear "remote-only" message (e.g. `rl env spin`).

So skills that already use `deploy_dev.sh` + the MCP env lock work unchanged
when `RL_TARGET=local`. The remote path is purely additive.

## MCP tools (preferred for agents)

Agents should use the `mcp__mcp-rl-fleet__*` tools instead of shelling out
to `rl <cmd>` via Bash. The MCP server forces `rl-agent` identity (no
operator elevation possible) and returns structured JSON. Full reference
in CLAUDE.md under "`mcp-rl-fleet`". Common flows:

| Task | MCP tool |
| ---- | -------- |
| Start session, claim a runner (may enqueue — `rl_claim_wait` blocks on queue head) | `rl_claim` |
| Spin a prod-like env for testing | `rl_env_spin` (slug=foo) |
| Seed API keys/config into the env | `rl_env_sync_from_local` (slug, mode='settings') |
| Realistic prod-shaped data | `rl_env_clone_prod` (slug) |
| Run build/test inside the runner | `rl_run_on_runner` (command='npm test') |
| Run full local CI in the runner | `rl_validate_ci` |
| Check fleet state | `rl_status` / `rl_env_list` |
| Get Postgres URL for an env | `rl_db_url` (slug) |
| Open Grafana with a Loki filter | `rl_logs_url` (query) |
| Clean up | `rl_env_destroy` (slug) → `rl_release` (default preserves child envs for next queued agent) |

**Bounded waits (ROK-1362):** `rl_validate_ci`, `rl_run_on_runner` (`>120s`),
`rl_env_deploy`, and `rl_env_clone_prod` are async — they return a `task_id`
(VM ids for validate/run; `local-…` laptop ids for deploy/clone). Poll with
`rl_task_status` (cheap one-shot, every 60–90s) or `rl_task_wait` (blocks ≤120s,
then returns a `{status:'still_running', current_step, steps[]}` snapshot to
narrate — re-call with the same `task_id` to keep waiting). No fleet MCP call
blocks longer than 120s; walk away via the background push-notify pattern, never
a blocking wait.

The mobile dashboard at `http://fleet.rl.lan` (LAN) or
`http://fleet.gamernight.net` (external) shows the same state visually.

## Quick reference for skill authors

When writing/updating a skill, prefer MCP tools (agents) or the `rl` CLI
(shell scripts). Both handle remote+local fallback automatically.

| Today (local-only)                          | Agent-facing replacement              |
| ------------------------------------------- | ------------------------------------- |
| `mcp__mcp-env__env_lock_acquire`            | `mcp__mcp-rl-fleet__rl_claim` (queues on contention; pair with `rl_claim_wait`) |
| `mcp__mcp-env__env_lock_release`            | `mcp__mcp-rl-fleet__rl_release` (preserves envs by default for next queued holder) |
| `./scripts/deploy_dev.sh --ci --rebuild`    | `mcp__mcp-rl-fleet__rl_env_spin`      |
| `./scripts/deploy_dev.sh --status`          | `mcp__mcp-rl-fleet__rl_status`        |
| `./scripts/validate-ci.sh --full`           | `mcp__mcp-rl-fleet__rl_validate_ci`   |
| `docker exec raid-ledger-db psql …`         | `mcp__mcp-rl-fleet__rl_db_url`        |
| `npx playwright test`                       | `rl_validate_ci` (args=['--only-e2e']) |
| `./scripts/clone-prod-to-local.sh`          | `mcp__mcp-rl-fleet__rl_env_clone_prod` (target is a test env) |

For shell scripts that can't call MCP tools (build pipelines, CI), use the
`rl` CLI at `rl-infra/cli/rl`. Setting `RL_TARGET=local` (or being on a
plane) makes every `rl` call transparently dispatch to the local equivalent.
