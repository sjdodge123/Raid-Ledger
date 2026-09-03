# Handover — A3 fix 2 (task-cancel kills runner-side children)

Written 2026-09-03 by `dev-a3-fix2`, branch `a3-fleet-gaps`,
worktree `/Users/sdodge/Documents/Projects/Raid-Ledger--a3-fleet-gaps`.

## Status: COMPLETE and green. Nothing red. Not pushed (per brief).

Commit `c67116bc` — `chore(config): task-cancel kills runner-side children by
RL_TASK_ID marker`.

## What changed
- `rl-infra/orchestrator/bin/task-start:212-218` — supervisor exports
  `RL_TASK_ID="$TASK_ID"` so the wrapped command + all descendants inherit it.
- `rl-infra/orchestrator/bin/run-on-runner-with-heartbeat:88-101,193-200` and
  `rl-infra/orchestrator/bin/run-on-runner:25-31,34-42` — forward the marker
  with `docker exec -e RL_TASK_ID=...`; flag omitted when the var is unset.
- `rl-infra/orchestrator/bin/task-cancel:37-121,166-190` — `runner_sweep()` +
  `cancel_runner_children()`: `docker exec rl-runner-<slot>` scans
  `/proc/<pid>/environ` for `RL_TASK_ID=<this task id>`, SIGTERM → grace
  (`RL_TASK_CANCEL_RUNNER_GRACE_SECONDS`, default 5) → SIGKILL only if the TERM
  sweep matched something. Envelope gains `runner_processes_signalled`.
- `rl-infra/orchestrator/test/task-cancel-runner-children.test.sh` — new spec
  (7 cases / 15 assertions), registered in `run-tests.sh`.

## Verification done on the laptop
- `bash -n` clean on all 5 touched scripts; `shellcheck -S warning` clean (only
  pre-existing info-level SC1091/SC2016/SC2329 at default severity).
- New spec: 15 pass / 0 fail.
- Revert-verification: with the four `bin/` scripts restored to `6a72c4a1` the
  spec fails 6/15 — not vacuous.
- Regression: `test_task_cancel`, `test_task_start`, `test_task_status`,
  `release-runner-cleanup`, `heartbeat-emitter`, `test_release_integration`,
  `task-admission`, `test_steps_integration`, `test_concurrent_steps`,
  `test_sweeper` — all pass.

## What is NOT done (next owner)
1. **Fleet proof of assertion (a)** — PARKED, operator-run. The exact numbered
   commands are in the "Parked — live verification of assertion (a)" section at
   the bottom of THIS file. Requires the orchestrator `bin/` deploy to the VM
   FIRST; the marker only exists for tasks dispatched after that deploy.
2. Fix 3 (one-claim-per-tree) — separate spawn, untouched here.
3. `rl-infra/README.md` intentionally not updated (explicitly out of scope).

## Parked — live verification of assertion (a) (run AFTER the orchestrator bin deploy)

**PRECONDITION (read first):** step 1 must be dispatched **AFTER**
`rl-infra/orchestrator/bin` is deployed to the VM. `rl-infra/deploy.sh` SSHes as
the operator, a path closed to agents by ROK-1338 PR-3, so this is an operator
step. A task dispatched before the deploy carries **no** `RL_TASK_ID` marker:
the sweep then matches nothing, the cancel looks clean, and the test produces a
**false pass**.

Slot 3 assumed throughout — substitute your claimed slot in every
`rl-runner-3`. Substitute the dispatched id for every `<TASK_ID>`.

### 1. Dispatch a cancellable run

```
rl_validate_ci({ worktree_path: "/Users/sdodge/Documents/Projects/Raid-Ledger--a3-fleet-gaps", args: ["--no-e2e"], wait: false })
```

Expected: `{ task_id: "<TASK_ID>", log_url: ..., started_at: ... }` within ~1s.
Record `<TASK_ID>`.

### 2. Confirm the run is live AND carries the marker (~90s after dispatch)

Live processes:

```
docker exec rl-runner-3 sh -c 'ps -eo args | grep -E "validate-ci\.sh|jest" | grep -v grep | wc -l'
```

Expected: **≥ 2** (a bare `0` here means the run has not reached jest yet — wait
and re-run; do NOT proceed, a zero here would make step 4 vacuous).

Marked processes (this is the mechanism under test):

```
docker exec rl-runner-3 sh -c 'c=0; for d in /proc/[0-9]*; do tr "\000" "\n" < $d/environ 2>/dev/null | grep -qx "RL_TASK_ID=<TASK_ID>" && c=$((c+1)); done; echo marked=$c'
```

Expected: **`marked=<N>` with N > 0**. `marked=0` means the deploy precondition
was not met — STOP, deploy, re-dispatch.

### 3. Cancel

```
rl_task_cancel({ task_id: "<TASK_ID>", reason: "a3-fix2 verification" })
```

Expected: `ok: true`, `killed: true`, and **`runner_processes_signalled` > 0**
(the new field; it is the sweep's own count of what it signalled).

### 4. THE ASSERTION — zero runner-side survivors (wait ~15s after step 3)

```
docker exec rl-runner-3 sh -c 'ps -eo args | grep -E "validate-ci\.sh|jest|vitest" | grep -v grep | wc -l'
```

Expected: **`0`**.

```
docker exec rl-runner-3 sh -c 'c=0; for d in /proc/[0-9]*; do tr "\000" "\n" < $d/environ 2>/dev/null | grep -qx "RL_TASK_ID=<TASK_ID>" && c=$((c+1)); done; echo marked=$c'
```

Expected: **`marked=0`**.

Any non-zero in step 4 is a FAIL — capture `docker exec rl-runner-3 ps -ef`
before killing anything by hand.

### 5. Cross-task negative control (the sweep must not cross tasks)

Dispatch two tasks on the SAME runner (`timeout_seconds > 120` routes each as a
VM task rather than a sync exec):

```
rl_run_on_runner({ command: "bash -c 'sleep 600'", timeout_seconds: 300, worktree_path: "/Users/sdodge/Documents/Projects/Raid-Ledger--a3-fleet-gaps" })   # → TASK_A
rl_run_on_runner({ command: "bash -c 'sleep 600'", timeout_seconds: 300, worktree_path: "/Users/sdodge/Documents/Projects/Raid-Ledger--a3-fleet-gaps" })   # → TASK_B
```

Cancel ONLY the first:

```
rl_task_cancel({ task_id: "<TASK_A>", reason: "negative control" })
```

Then:

```
docker exec rl-runner-3 sh -c 'ps -eo args | grep "sleep 600" | grep -v grep'
rl_task_status({ task_id: "<TASK_B>" })
```

Expected: **exactly one** surviving `sleep 600`, and `<TASK_B>` still
`running`. Two survivors = the cancel did nothing; zero survivors = the sweep
crossed tasks (the failure mode a cmdline `pkill -f` would have had).

Clean up: `rl_task_cancel({ task_id: "<TASK_B>", reason: "cleanup" })`.

### 6. Idempotency re-cancel

Re-run step 3 verbatim against the SAME `<TASK_ID>`:

```
rl_task_cancel({ task_id: "<TASK_ID>", reason: "a3-fix2 verification" })
```

Expected: **`ok: true`, `killed: false`, `previous_status: "cancelled"`, exit 0,
no stderr, no error field.** It re-sweeps the runner (finding nothing) rather
than erroring — that is the documented idempotency contract.
