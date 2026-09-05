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

rl validate-ci [...args]                          # runs `bash scripts/validate-ci.sh` INSIDE the runner
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

## Heavy runs share the VM dynamically (ROK-1470)

The VM is 15 GiB and the four runners **share it** — each is `mem_limit: 6g`
with a `mem_reservation: 2g` floor, deliberately over-subscribed. There is **no
manual "serialize jest / never two full test runs at once" rule any more**;
do not re-introduce one, and do not hand-stagger heavy work.

Instead, the orchestrator admits heavy tasks against host memory:

- `rl_validate_ci` (any suite-running mode), `rl_env_build_image_from_runner`,
  and `rl_run_on_runner` commands matching jest / vitest / playwright /
  validate-ci / docker build are dispatched `--weight heavy` automatically.
- A heavy task **waits** until host `MemAvailable` >= `RL_HEAVY_TASK_MIN_FREE_MB`
  (5120 default), polling every 10s for up to 30 min. Its log shows
  `[admission] waiting for memory: available=…MB need=…MB (N heavy running)`.
- If two agents fire heavy runs at once, the second one queues on the gate and
  starts when the first frees memory. That is expected, not a bug.
- A `--static`-only validate-ci run, and every short `rl_run_on_runner` probe,
  is `light` and never waits.
- `rl_status` reports `heavy_running`, `heavy_waiting`, `mem_available_mb`,
  `heavy_task_min_free_mb`. **Check these before assuming a heavy task hung** —
  a task can sit in `running` for minutes while parked on the gate.
- A task that gives up returns `status: failed` with
  `failure_reason: "admission_timeout"`. That is a busy host, not a red suite:
  re-dispatch later, or pass `weight: 'light'` if you genuinely know the run is
  small.

## Each slot has its own Discord bot (ROK-1469)

Every fleet env runs as ITS SLOT's Discord application, not one shared bot.
Consequences for agents:

- **One live env per slot may hold the identity.** `rl_env_spin` on a slot
  whose bot is already attached to another running env returns
  `{"ok":false,"error":"bot_identity_in_use","held_by":"<slug>"}`. That is a
  correct refusal, not a fleet fault: destroy the named holder (only it — a
  slot release would take every env with it) or use another slot. Re-spinning
  the holder itself is always allowed.
- **Check who an env posts as** with `rl_env_inspect`-adjacent state:
  `rl_status` → `envs[].bot_identity` = `{slot, client_id, app_name,
  configured}`. `configured:false` means that slot has no identity in the VM's
  `.env` and the env fell back to the operator's shared bot — two such envs
  CAN still collide.
- **Never ask for, print, or paste a bot token or client secret.** They live
  only in `/srv/rl-infra/.env`; no tool returns them and none should.
- **Concurrent Discord smoke is allowed** when each run has a per-slot channel
  set (`SMOKE_CHANNEL_SET=slot-N`, guild channels named `slot-N-*`). Without
  one, `validate-ci.sh` still serializes on the fleet Discord lock.
- **Deploys no longer need the operator's laptop DB.** The VM-side bundle
  (`/srv/rl-infra/settings/bundle.enc`, refreshed by the operator with
  `RL_OPERATOR=1 rl settings push`) seeds the shared API keys; `rl_env_deploy`
  succeeds with Docker Desktop off as long as the overlay applied keys. If an
  env is missing API keys, check the deploy's `settings_overlay` step and the
  overlay's `bundle_warning` before blaming sync_settings.

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
| Run full local CI in the runner | `rl_validate_ci` (auto `--weight heavy`; queues on host memory) |
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

**Exec bits on a runner are restored for you — do NOT chmod by hand.** The
Mutagen session is created `--permissions-mode=manual --default-file-mode-beta=0644`
(deliberate, Bug S / ROK-1326: `portable` mode propagated macOS xattr-driven perms
as 0600/0700 and broke `docker COPY` in the allinone build), so it propagates no
source permission at all — executability included — and every synced script lands
on the runner at 0644. Since A3-B P2, `rl-infra/cli/rl::flush_mutagen` runs
`rl-infra/runner/restore-exec-bits.sh` inside the runner after every sync flush,
which repairs the known-executable set (`rl-infra/orchestrator/bin/*`,
`rl-infra/cli/rl`, `rl-infra/orchestrator/test/*.sh`, repo-root `scripts/*.sh`, …)
and **hard-fails with a named `rl-exec-bits:` error** if it can't. `rl validate-ci`
aborts rather than spending a gate on a tree in that state.

The retired incantation — "copy the tree out of the Mutagen path, then
`chmod -R a+x` all of `rl-infra` (don't forget `cli/rl`) plus repo-root
`scripts/`" — is obsolete. Don't reintroduce it; it was also wrong twice (agents
lost a run to each half), and a blanket `-R a+x` marks every source file
executable.

Still prefer `bash scripts/foo.sh` over `./scripts/foo.sh` for anything
long-running — not as ritual, but because the sync keeps running: if you edit
that file on the laptop mid-run, Mutagen rewrites it at 0644 after the restore
already passed. `rl validate-ci` / `rl_validate_ci` already do this. If you ever
DO see a bare `126`, it is now a bug in the restore, not a known condition to
work around — report it.

For shell scripts that can't call MCP tools (build pipelines, CI), use the
`rl` CLI at `rl-infra/cli/rl`. Setting `RL_TARGET=local` (or being on a
plane) makes every `rl` call transparently dispatch to the local equivalent.
