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
rl claim --branch $(git branch --show-current)   # acquires a slot 1..4
# → starts Mutagen sync (laptop ↔ /srv/rl-infra/runners/slot-N/worktree)
# → starts a 60s heartbeat daemon (missed >5min → slot auto-released)
# Output gives: slot number, web URL (slot-N.rl.lan), debug URL, shell command.

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
   `mcp__mcp-env__env_lock_acquire`, run `rl claim`. The slot IS the lease,
   and there are 4 of them, so no contention.
2. **Don't `cd` into the worktree manually** — Mutagen mirrors files into the
   runner's `/workspace`. Edit on the laptop, the runner sees changes within ~1s.
3. **Shell out to the runner for compute-heavy commands**:
   - `npm run build -w api` → `rl validate-ci` (or
     `ssh proxmox-vm /srv/rl-infra/orchestrator/bin/run-on-runner -- npm run build -w api`)
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
  `rl claim` → "use env-lock.sh acquire" message), or
- Refuses with a clear "remote-only" message (e.g. `rl env spin`).

So skills that already use `deploy_dev.sh` + the MCP env lock work unchanged
when `RL_TARGET=local`. The remote path is purely additive.

## Quick reference for skill authors

When writing/updating a skill that previously called any of the below, prefer
the `rl` wrapper instead. It handles both remote and local automatically.

| Today (local-only)                          | Use instead                          |
| ------------------------------------------- | ------------------------------------ |
| `mcp__mcp-env__env_lock_acquire`            | `rl claim --branch <name>`           |
| `mcp__mcp-env__env_lock_release`            | `rl release`                         |
| `./scripts/deploy_dev.sh --ci --rebuild`    | `rl env spin <slug>` (NAS-like)      |
| `./scripts/deploy_dev.sh --status`          | `rl status`                          |
| `./scripts/validate-ci.sh --full`           | `rl validate-ci --full`              |
| `docker exec raid-ledger-db psql …`         | `rl db <slug>`                       |
| `npx playwright test`                       | `rl validate-ci --only-e2e`          |

Setting `RL_TARGET=local` (or being on a plane) makes every `rl` call
transparently dispatch to the local-only equivalent.
