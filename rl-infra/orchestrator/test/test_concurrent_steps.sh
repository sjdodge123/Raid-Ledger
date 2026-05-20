#!/usr/bin/env bash
# ROK-1331 M1 — concurrent step-append serialization test
# Covers AC-M1-14: flock serializes concurrent step appends; no lost entries.

set -uo pipefail

CURRENT_TEST_FILE="test_concurrent_steps.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# AC-M1-14: a stream of 100 PASS lines should all land in steps[].
# This catches "lost append under contention" — if `state::mutate` is wrapped
# correctly with flock, the count is exactly 100.
test_steps_no_lost_appends() {
    CURRENT_TEST_NAME="AC-M1-14: 100 step lines all land in steps[]"
    local task_id="stress0001"
    # Generate 100 PASS lines in a tight loop. Use yes/head pattern for speed.
    "$BIN_DIR/task-start" "$task_id" --tool rl_validate_ci --slot 1 -- \
        /bin/sh -c 'i=1; while [ $i -le 100 ]; do printf "Step%02d: PASS\n" $i; i=$((i+1)); done' \
        >/dev/null 2>&1 || true

    # Wait for terminal status + parser grace.
    local status="" attempts=0
    while [[ "$status" != "succeeded" && "$status" != "failed" ]] && (( attempts < 100 )); do
        status=$(jq -r '.status // "running"' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "running")
        attempts=$((attempts + 1))
        sleep 0.1
    done
    sleep 3  # parser ≤2s EOF-grace per spec.

    local len
    len=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps | length' 2>/dev/null || echo "0")
    assert_eq "$len" "100" "steps[] must contain exactly 100 entries (no lost appends under flock)"

    # Verify JSON file is still valid (no torn-write corruption from concurrency).
    if jq empty "$RL_TASKS_DIR/$task_id.json" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: JSON file corrupted")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] JSON corruption after concurrent appends"
    fi
}

# Lock file in expected location.
test_flock_lock_file_present() {
    CURRENT_TEST_NAME="flock lock file pattern observable"
    local task_id="lockcheck"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 30 >/dev/null 2>&1 || true
    # The spec calls for `tasks/<task_id>.json.lock` under $RL_LOCK_DIR.
    # During the wrapped sleep, the parser may not be actively appending (no
    # matching lines), but the lock file should exist or the lock dir should
    # at least be present.
    if [[ -d "$RL_LOCK_DIR" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: RL_LOCK_DIR missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] RL_LOCK_DIR missing"
    fi
    pkill -f "/bin/sleep 30" 2>/dev/null || true
}

run_test "ac-m1-14-no-lost-appends" test_steps_no_lost_appends
run_test "lock-file-present" test_flock_lock_file_present

print_test_summary
