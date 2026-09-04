#!/usr/bin/env bash
# ROK-1331 M1 — test runner entry point.
# Sources each test file; aggregates pass/fail counts and exits non-zero if any failed.
#
# Usage:
#   ./rl-infra/orchestrator/test/run-tests.sh
#   ./rl-infra/orchestrator/test/run-tests.sh test_task_start.sh   # single file
#
# Tests run LOCALLY (no SSH); they redirect RL_STATE_DIR to per-test temp dirs.
# Requires: jq, bash 3.2+ (macOS system bash), /bin/sleep, /bin/sh. GNU
# coreutils (timeout/flock) and inotify-tools are optional: tests detect their
# absence and use portable fallbacks or skip-with-reason (ROK-1361).

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Dependency probe.
if ! command -v jq >/dev/null 2>&1; then
    echo "FATAL: jq not installed; install with 'brew install jq'" >&2
    exit 127
fi

declare -a TEST_FILES
if (( $# > 0 )); then
    for arg in "$@"; do
        TEST_FILES+=("$TEST_DIR/$arg")
    done
else
    # Default suite — all test_*.sh files in order.
    TEST_FILES=(
        "$TEST_DIR/test_task_start.sh"
        "$TEST_DIR/test_task_status.sh"
        "$TEST_DIR/test_task_cancel.sh"
        "$TEST_DIR/test_task_list.sh"
        "$TEST_DIR/test_pattern_regex.sh"
        "$TEST_DIR/test_steps_integration.sh"
        "$TEST_DIR/test_sweeper.sh"
        "$TEST_DIR/test_release_integration.sh"
        "$TEST_DIR/test_concurrent_steps.sh"
        # ROK-1331 M5a — lease queue + claim duration + pin/unpin + sweeper safety.
        "$TEST_DIR/lease-enqueue.test.sh"
        # --slot targeting (avoids evicting a preserved env on a lower slot).
        "$TEST_DIR/claim-slot-target.test.sh"
        # ROK-1357 — env-spin recreate-on-image-mismatch + PG rollback +
        # unclaimed-slot reclaim.
        "$TEST_DIR/env-spin.test.sh"
        "$TEST_DIR/lease-advance.test.sh"
        "$TEST_DIR/lease-status.test.sh"
        # ROK-1361 — macOS/BSD coreutils compat: heartbeat clamp (timeout shim)
        # + env-destroy flock-warning paths. Registered here so the suite gate
        # (AC1) actually exercises the timeout/flock portability fixes.
        "$TEST_DIR/heartbeat-emitter.test.sh"
        "$TEST_DIR/test_env_destroy_m6a.sh"
        "$TEST_DIR/extend-claim.test.sh"
        "$TEST_DIR/pin-env.test.sh"
        "$TEST_DIR/release-preserve-envs.test.sh"
        "$TEST_DIR/sweeper-pin-safety.test.sh"
        # Fleet sync_settings RL_ENV_JWT_SECRET false-"missing" root-cause fix.
        "$TEST_DIR/sync-local-to-env-rl-agent.test.sh"
        "$TEST_DIR/sync-local-to-env-infra-read.test.sh"
        # ROK-1358 — DNS-fallback host resolution + diagnosable probe failures.
        "$TEST_DIR/sync-local-to-env-host-resolve.test.sh"
        # ROK-1470 — heavy-task admission control (dynamic fleet memory).
        "$TEST_DIR/task-admission.test.sh"
        # ROK-1469 — per-slot Discord bot identities (overlay + one-live-bot).
        "$TEST_DIR/env-settings-overlay.test.sh"
        "$TEST_DIR/env-spin-bot-identity.test.sh"
        "$TEST_DIR/bot-identity-visibility.test.sh"
        "$TEST_DIR/settings-bundle.test.sh"
        "$TEST_DIR/cli-settings-push.test.sh"
        # A3 fix 2 — task-cancel kills the runner-side child tree by RL_TASK_ID
        # marker (docker exec's in-container process outlives the exec client).
        "$TEST_DIR/task-cancel-runner-children.test.sh"
        # A3-B P1 — gc-sweeper must not reap a slot whose own task is still
        # running (lease heartbeats the agent, not the work).
        "$TEST_DIR/sweeper-running-task-guard.test.sh"
        # A3-B P2 — post-sync exec-bit restore (Mutagen's manual permissions
        # mode lands every synced script 0644 → bare exit 126 on the runner).
        "$TEST_DIR/runner-exec-bits.test.sh"
        "$TEST_DIR/cli-rl-exec-bits-wiring.test.sh"
        # A3-B — the flush-time repair does not survive a LATER sync. The
        # guarantee has to hold at the moment of execution, so run-on-runner
        # {,-with-heartbeat} re-assert it before dispatching anything.
        "$TEST_DIR/run-on-runner-exec-bits.test.sh"
        # A3-B P3 — extra-slots provisioning parity: the /state-locks mount
        # runners 3-4 never had, the slot worktree scaffold that never existed,
        # and a missing mount that must fail by NAME rather than silently run
        # Discord smoke unsynchronized.
        "$TEST_DIR/extra-slots-provisioning.test.sh"
        # A3-B P6 — env-spin threads the operator's Discord id into
        # bootstrap-admin (fresh + idempotent) so a fleet env can make him an
        # admin; the DEMO_MODE gate that keeps it out of production is pinned
        # here and in api/src/scripts/bootstrap-admin-fleet-operator.spec.ts.
        "$TEST_DIR/env-spin-fleet-operator.test.sh"
        # A3-B P5 — env-destroy must delete the slot bot's slash commands.
        # Discord keeps commands against the APPLICATION, not the container, so
        # a destroyed env used to leave a dead /bind in the test guild's picker.
        "$TEST_DIR/bot-command-deregister.test.sh"
    )
fi

GLOBAL_FAIL=0
for tf in "${TEST_FILES[@]}"; do
    if [[ ! -f "$tf" ]]; then
        echo "SKIP missing test file: $tf"
        continue
    fi
    echo
    echo "=== Running $(basename "$tf") ==="
    # Run each test file in a subshell so counters reset per file. The subshell's
    # exit code reflects per-file pass/fail (set by print_test_summary).
    bash "$tf"
    rc=$?
    if (( rc != 0 )); then
        GLOBAL_FAIL=1
    fi
done

echo
echo "============================================"
if (( GLOBAL_FAIL == 0 )); then
    echo "ALL TEST FILES PASSED"
    exit 0
else
    echo "ONE OR MORE TEST FILES FAILED"
    exit 1
fi
