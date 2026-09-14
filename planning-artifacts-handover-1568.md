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

## Codex fixes

Three findings from the Codex pass on the pre-fix commit that the first review
did not cover. All applied in `30b74e1d`; nothing deferred.

| # | Finding | Fix | Test |
|---|---|---|---|
| P1 | `bin/status:40` — bare `jq -c .` on `disk-pressure.json` under `set -euo pipefail` aborts the whole status script when the file is absent (every deploy before the first sweep) or truncated | `\|\| echo null` + a `jq -e` validity check for a fragment jq exits 0 on | A-k, three cases: absent / garbage / valid |
| P2 | `task-start:293` — a build cancelled while parked on the DISK gate proceeded to build once space freed | `admission::acquire_disk` takes the same abort predicate `admission::acquire` has (re-evaluated every poll, rc 2 = aborted); task-start passes `json_status_terminal` and re-checks after admit | AC3-d |
| P2 | `_disk_pressure.sh:54` — `free_gb` echoed `0` when both df probes failed, so an unreadable disk read as permanently full and parked every build for its whole budget | echoes nothing and returns 1; blank = UNKNOWN, gate still fails OPEN; `guard` passes jq a literal `null` | A-j (library) + AC3-e (gate admits ungated) |

**Non-vacuity, by reverting each fix** (per the standing rule — a passing
regression test proves nothing until it has been seen to fail):

- P1 reverted → A-k fails 4 assertions, including "a missing state file must not
  abort the status script".
- P2 (free_gb) reverted → A-j fails both assertions; AC3-e fails "an unmeasurable
  disk must not block the build".
- P2 (cancel) reverted → AC3-d fails "the disk loop must abort on a cancelled
  task, not admit it".
- Restored: both suites green again.

AC3-d polls `admission_state`, not `.status`: `task-cancel` makes the status
terminal instantly, so waiting on status would read back before the disk loop
has decided anything and pass vacuously. Same reasoning as the ROK-1470 memory
tests (AC2-j/AC2-k) it mirrors.

**Re-run after these fixes:** `disk-pressure-guard.test.sh` 58/58 (was 47),
`task-admission.test.sh` 58/58 (was 51), `fleet-prune*.spec.ts` 10/10,
`npx tsc --noEmit` clean.

The VM-side residual risk is unchanged and still the thing to check first when
this reaches the fleet: whether `rl-agent` gets through the docker proxy on the
three new prune routes (needs `docker compose up -d docker-proxy`), and that
the runner `LABEL` only applies to images rebuilt after this lands.

## Merge with main

`git merge origin/main` (main at `1fc566fa`, ROK-1567) — ONE conflict, in
`tools/mcp-rl-fleet/src/index.ts`.

**What conflicted and how it was resolved.** Both sides appended a different
sentence to the same `TASK_STATUS_DESC` string: main added the ROK-1567
brief/redaction note, this branch added the ROK-1568 disk-park note. Neither
supersedes the other, so the resolution keeps the shared base plus BOTH
additions in that order. Nothing was dropped.

Everything else auto-merged. Verified present after the resolution, since an
"ours/theirs" resolution on this file is exactly how a registration goes
missing:

- `rl_fleet_prune` — import, schema and `registerTool` (index.ts:45/525/531).
- main's `brief` param on `taskStatusSchema` (index.ts:355) — it sits outside
  the conflicted hunk and survived intact.
- `status.ts` `host.disk_free_gb` / `host.disk_pressure` and both description
  additions (ROK-1470 memory axis + ROK-1568 disk axis).
- The whole shell side (`_disk_pressure.sh`, `disk-pressure-guard.test.sh`,
  the admission/task-start/build-image edits) — untouched by the merge.

`git diff --check` clean (no conflict-marker or whitespace residue).

**Post-merge test counts** — main's suites all pass with the new tool registered:

| Suite | Result |
|---|---|
| `tools/mcp-rl-fleet` `npx tsc --noEmit` | clean |
| `tools/mcp-rl-fleet` `npx vitest run` (whole package) | **42 files / 456 tests passed** (pre-merge: 40 / 416 — the delta is main's ROK-1566/1567 specs) |
| `rl-infra/orchestrator/test/run-tests.sh` (full suite) | **ALL TEST FILES PASSED — 800 assertions, 0 fail** |
| of which `disk-pressure-guard.test.sh` | 58 pass, 0 fail |
| of which `task-admission.test.sh` | 58 pass, 0 fail |

Main also brought a migration (`0184_friendly_vulcan.sql`) and api/web changes
that this branch does not touch; no api/web tests were run here (out of scope
for this worktree, and GitHub CI is the gate for them).

Not pushed.
