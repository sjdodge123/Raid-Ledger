# ROK-1568 — disk-pressure guard: handover

Branch `chore/rok-1568-disk-pressure-guard` in `/Users/sdodge/Documents/Projects/Raid-Ledger--infra-1568`.
Three commits, all green, NOT pushed, no PR, no fleet/VM touched.

| commit | cluster |
|---|---|
| `dfde3721` | A — sweeper disk ladder |
| `100e566b` | B — build admission on free disk |
| `df5d8e0a` | C — `rl_fleet_prune` + `rl_status` disk fields + README |

## What shipped

**A.** New sourceable library `rl-infra/orchestrator/bin/_disk_pressure.sh`
(`disk_pressure::guard`, `::force_ladder`, `::used_pct`, `::free_gb`). Ordered ladder
builder-prune → aged image-prune → volume-prune, re-reading `df` after each rung, stopping
below `RL_DISK_TARGET_PCT`. Writes `state/disk-pressure.json`. `sweep.sh` calls it as step
3b (the old stale `3b` task-retention pointer comment was renumbered `3c`).

**B.** `_admission.sh` gained `admission::acquire_disk` + `admission::disk_gate_applies`.
`task-start`'s supervisor runs it after the memory gate for tasks whose `--tool` matches
`*build*` (`RL_DISK_GATE=1|0` forces/disables): park as `waiting_disk` → one ladder pass →
re-check → fail `disk_pressure` / exit 76 after `RL_BUILD_DISK_WAIT_S`. Same pre-flight in
`build-image-on-runner`, skipped when `RL_ADMISSION_HELD` is set.

**C.** `tools/mcp-rl-fleet/src/tools/fleet-prune.ts` + registration in `index.ts`;
`status.ts` host type gained `disk_free_gb` + `disk_pressure`; `orchestrator/bin/status`
emits both. README: ladder bullet under gc-sweeper + `rl_fleet_prune` row.

## Decisions worth a reviewer's eye

1. **Shared library, not a trigger file.** The brief offered either. A sourceable lib under
   `orchestrator/bin/` is reachable from the sweeper (it already mounts that dir for
   `runner-testcontainers-reap` via `$ORCHESTRATOR_BIN_DIR`) and from the orchestrator, and
   two processes can't race on it the way they could on a touch-file.
2. **Runner-image guard is `--filter label!=rl.role=runner` + docker's own
   running-container rule.** Documented LIMITATION in the lib header: a runner image built
   WITHOUT that label is protected only by being in use by a running container.
   `RL_RUNNER_IMAGE` cannot be expressed as a prune filter (docker has no repo exclusion).
3. **`RL_DISK_PRUNE_PCT=0` for forced passes** (build gate + `rl_fleet_prune`) — the
   stop-at-target rule still bounds the work, so a forced prune never over-reclaims.
4. **Disk gate is tool-scoped, not weight-scoped.** Gating every heavy task on disk would
   turn a tight host into a stalled fleet; a jest run writes almost nothing.
5. Everything fails **OPEN** — unreadable `df`, missing library, missing docker → admit.

## Verification

- `tools/mcp-rl-fleet`: `npx tsc --noEmit` clean; `npx vitest run` → 39 files / 410 tests pass
  (4 new in `fleet-prune.spec.ts`, confirmed red before the tool existed).
- `bash -n` clean on every edited shell file.
- Shell suites run individually (all pass): `disk-pressure-guard` (32, new),
  `task-admission` (51, +8 new), `test_sweeper` (16), `sweeper-pin-safety` (8),
  `gc-sweeper-ephemeral-sweep` (33), `sweeper-running-task-guard` (12),
  `build-image-commit-sha` (12), `test_task_start` (20).
- The full `run-tests.sh` was NOT run end-to-end (turn budget); `disk-pressure-guard.test.sh`
  IS registered in its default list. Nothing in the diff is VM-only, but a full
  `run-tests.sh` pass is the obvious next gate.

## Next / not done

- No push, no PR (per brief).
- Not validated on the VM: `rl_fleet_prune`'s SSH path assumes the library at
  `/srv/rl-infra/orchestrator/bin/_disk_pressure.sh` and `DOCKER_HOST=tcp://127.0.0.1:2375`
  (mirrors `fleet-health.ts`). **The Lead should confirm `rl-agent` can run
  `docker builder prune` through the docker proxy** — if the proxy denies the prune verbs,
  rung 1/3 will no-op and the tool will report a 0-reclaim run rather than erroring.
- `disk-pressure.json` lands in `$STATE_DIR`; the dashboard does not read it yet.
