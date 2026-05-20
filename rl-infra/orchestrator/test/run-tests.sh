#!/usr/bin/env bash
# ROK-1331 M1 — test runner entry point.
# Sources each test file; aggregates pass/fail counts and exits non-zero if any failed.
#
# Usage:
#   ./rl-infra/orchestrator/test/run-tests.sh
#   ./rl-infra/orchestrator/test/run-tests.sh test_task_start.sh   # single file
#
# Tests run LOCALLY (no SSH); they redirect RL_STATE_DIR to per-test temp dirs.
# Requires: jq, bash 4+, /bin/sleep, /bin/sh.

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
        "$TEST_DIR/lease-advance.test.sh"
        "$TEST_DIR/lease-status.test.sh"
        "$TEST_DIR/extend-claim.test.sh"
        "$TEST_DIR/pin-env.test.sh"
        "$TEST_DIR/release-preserve-envs.test.sh"
        "$TEST_DIR/sweeper-pin-safety.test.sh"
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
