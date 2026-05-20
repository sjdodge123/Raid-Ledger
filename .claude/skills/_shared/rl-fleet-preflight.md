# rl-fleet Preflight — shared mode-detect protocol

Skills that touch the test infrastructure (`/build`, `/fix-batch`, `/bulk`, anything that calls `deploy_dev.sh`, `validate-ci.sh --only-e2e`, or `rl_env_*` MCP tools) MUST run this preflight once at session start, persist the result, and branch all subsequent test-infra steps on it.

Why: the fleet (Proxmox VM at `rl-infra`) is the preferred path — faster, parallelism-friendly, no laptop contention. BUT it has real failure modes (VM down, network partition, operator away from the fleet network, intentional `RL_TARGET=local` override). Without an explicit preflight, agents either silently hang on SSH timeouts mid-step or wrongly assume the fleet is up.

## When to run

ONCE per skill invocation, BEFORE the first step that needs a backend (CI runs that hit `validate-ci.sh --no-e2e` don't need a backend; `deploy_dev.sh` / `rl_env_deploy` does). For `/build`, run at the end of Step 1 setup so MODE is committed to `build-state.yaml` before any dev agent spawns.

## Protocol

1. **Honor explicit override first.** If the operator's shell has `RL_TARGET=local` exported, the preflight is short-circuited: `MODE=local`, skip the probe, announce the override. If `RL_TARGET=remote`, force `MODE=fleet` and skip the probe (the operator is telling you "trust me, the VM is up — if it's down, fail loud, don't silently degrade").

2. **Otherwise probe.** Call `mcp__mcp-rl-fleet__rl_status({})`. The MCP tool internally times out the SSH probe at ~3s. Decide:
   - Response includes `ok: true` and a populated `slots` array → `MODE=fleet`.
   - Any error, exception, or `ok: false` with `error: "fleet_unreachable"` (or similar) → `MODE=local`.

3. **Persist.** Write to `<worktree>/build-state.yaml` under `pipeline.test_infra_mode: fleet | local` so post-compaction recovery and subsequent steps see the same value. Also record `pipeline.test_infra_mode_reason` (one of `"override"`, `"probe_ok"`, `"probe_failed: <error>"`).

4. **Announce.** Single line, no ceremony: `Running in FLEET mode (probe ok)` or `Running in LOCAL mode (fleet unreachable: <reason>; fall back to deploy_dev.sh / env_lock)`.

5. **Mid-session failover is NOT automatic.** If a fleet call fails mid-build (VM crashed, etc.), the affected step fails loud with the actual error AND the one-line recovery hint: "Set `RL_TARGET=local` and re-invoke this step to fall back." Do not silently switch modes — silent failover masks real fleet bugs and leaves the operator unclear about what got tested where.

## Subsequent step branching

Every step that touches the test infra reads `pipeline.test_infra_mode` from `build-state.yaml` and branches:

```
if MODE=fleet:
  use rl_claim (may enqueue with queue_position N — see rl_claim_wait) / rl_env_deploy / rl_env_destroy / rl_release
  # When all slots are held, rl_claim returns {enqueued, queue_position} —
  # use rl_claim_wait to block on queue head OR proceed with non-env work
  # and retry. inherited_envs[] surface child envs from the previous holder.
  cleanup urgency: release at session end (Step 5 cleanup)
  spun env auto-reaps at TTL (24h default) if not destroyed manually

if MODE=local:
  use mcp__mcp-env__env_lock_acquire / deploy_dev.sh / mcp__mcp-env__env_lock_release
  cleanup urgency: release env_lock ASAP after operator verdict (single-resource contention)
  no spun env to clean up
```

Both paths' shell-script calls (`validate-ci.sh --full`, `validate-ci.sh --only-e2e`) self-dispatch via `RL_TARGET=auto` inside the script — no skill-level branching needed for those. The branching is for the env-lock / slot / deploy-vs-spin distinction only.

## What scripts/skills should NOT do

- **Never call `rl_status` per step.** The preflight result is the source of truth for the session. Re-probing per step burns SSH RTTs and risks getting a different answer mid-session.
- **Never `try fleet → except → local` cascade silently.** That's the silent failover trap. Either honor the session's mode or fail loud.
- **Never mix `rl_claim` (which may return `enqueued queue_position=N`) with `env_lock_acquire` in the same session.** Each is its own lock-discipline universe; the cleanup rules are different. Pick one at preflight time and stick with it.

## State file shape

After preflight, `build-state.yaml` carries:

```yaml
pipeline:
  test_infra_mode: fleet           # or local
  test_infra_mode_reason: probe_ok # or override | probe_failed: <reason>
  test_infra_mode_set_at: 2026-05-18T21:42:00Z
  # ... existing pipeline keys
```

Subsequent steps can read this with a single yaml-fetch — no re-probe.

## Quick reference for skill authors

| Today's local step | Fleet-mode equivalent | Shared shell entrypoint |
|---|---|---|
| `mcp__mcp-env__env_lock_acquire` | `mcp__mcp-rl-fleet__rl_claim({ worktree_path })` — may return `{enqueued, queue_position}`; use `rl_claim_wait({ slot, timeout_seconds })` to block on queue head | n/a |
| `./scripts/deploy_dev.sh --ci --rebuild` | `mcp__mcp-rl-fleet__rl_env_deploy({ slug, worktree_path, clone_prod? })` | n/a |
| Chrome MCP nav to `localhost:5173` | Chrome MCP nav to `https://<slug>test.gamernight.net` | n/a |
| `./scripts/validate-ci.sh --full` | (same — script self-dispatches) | `RL_TARGET=auto ./scripts/validate-ci.sh --full` |
| `./scripts/validate-ci.sh --only-e2e` | `rl_validate_ci({ args: ["--only-e2e"], against_env_slug })` (when ready) | (same — for now) |
| `mcp__mcp-env__env_lock_release` (urgent) | `rl_release({ worktree_path })` (at session end only) | n/a |

When in doubt: read the operator-facing memory `feedback_env_lock_minimal_hold.md`. It's mode-aware — local mode keeps the original "release ASAP" rule; fleet mode says "release at session end, sweeper safety-nets after that."
