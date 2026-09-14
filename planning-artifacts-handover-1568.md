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

## Review fixes

Verdict BLOCK addressed on the same branch: `0edbd52e` (shell + compose),
`c6305859` (TS). All 11 findings closed, none deferred.

| # | Finding | Fix |
|---|---|---|
| B1 | sweep.sh resolved the lib under `/orchestrator/bin`, which compose deliberately does not mount → cluster A was a permanent no-op | resolves under `${DISCORD_SWEEP_LIB_DIR:-/orchestrator-lib}`; test A-f now resolves the path the way sweep.sh does (with compose's own value) and asserts the mount provides the file |
| B2 | nested single quotes broke the remote `bash -c` for every call | script built as plain bash, shipped base64-encoded; new `fleet-prune-script.spec.ts` runs real `bash -n` on it (no child_process mock) |
| M3 | denied prunes silent (proxy allowPOST + `"0B"` success) | added `/build/prune`, `/images/prune`, `/volumes/prune` to allowPOST; each rung records `exit_code` + `stderr`; a non-zero rung → `ok:false, error:'prune_rung_failed'` |
| M4 | `label!=rl.role=runner` was inert (image vs container label) | `LABEL rl.role=runner` in `rl-infra/runner/Dockerfile` |
| M5 | nested builds ungated via `RL_ADMISSION_HELD` | separate `RL_ADMISSION_DISK_HELD`, set only by the disk gate; source-scan guard test A-i |
| M6 | df pipelines aborted a `set -e` caller before the fallback | `|| true` on both legs; test A-g drives a BSD-style df |
| 7 | volume prune could take named volumes on older engines | `--filter label!=com.docker.compose.project=rl-infra` |
| 8 | two exit codes for disk_pressure | 76 everywhere (75 stays the memory admission_timeout) |
| 9 | dry run overwrote the state file | state write skipped when dry; asserted in A-e |
| 10 | `disk` read /srv, `disk_free_gb` read / | single `DISK_FS` for both |
| 11 | descriptions never mentioned the disk park | `rl_status` + `rl_task_status` descriptions updated |

**Non-vacuity check on the B2 fix.** `bash -n` on the OUTER command passes even
for the broken v1 (the quotes rebalance at that level), so the discriminating
assertion is the one over the INNER script. Extracted what the remote `bash -c`
actually received from the pre-fix command via a `bash` shim: it was truncated
at `--format {{json` and fails `bash -n` with ``unexpected EOF while looking for
matching `)'`` — the reviewer's exact error, and exactly what
`parseCheck(buildRemoteScript(…))` catches.

**Test-stub bug found while fixing M6.** A-g's `unset -f df` teardown deleted the
file-level stub for every later test, which silently sent A-h at the real `/`
filesystem (it read ~40% used, fell below the threshold, and reported zero
rungs). Both overrides are now subshell-scoped; nothing calls `unset -f` on a
shared stub.

**Re-run after the fixes:** `disk-pressure-guard.test.sh` 47/47 (was 32, +A-g/A-h/A-i
and a tightened A-f/A-e); `task-admission.test.sh` 51/51; `tools/mcp-rl-fleet`
`npx vitest run` 40 files / 416 tests (was 39/410); `npx tsc --noEmit` clean;
`bash -n` clean on every edited shell file; `docker-compose.yml` parses as YAML.

**Still unverified on the VM** (unchanged from above, and now the main residual
risk): that `rl-agent` actually gets through the proxy on the three new prune
routes. The code no longer *hides* a denial — a 403 surfaces as
`prune_rung_failed` with the rung named — but nobody has watched it succeed.
The proxy change also needs `docker compose up -d docker-proxy` on the VM, and
the runner `LABEL` only applies to images rebuilt after this lands.
