#!/usr/bin/env bash
# ROK-1331 M1 — end-to-end steps[] parsing integration tests
# Covers AC-M1-4 (Bug B #1 structured steps via task-start regex parser)
# and AC-M1-5 (color-coded lines).
#
# These tests actually run task-start with a wrapped cmd that prints fake
# validate-ci output lines, then verify task-status returns the parsed steps[].

set -uo pipefail

CURRENT_TEST_FILE="test_steps_integration.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Wait for terminal status with a timeout.
wait_for_terminal() {
    local task_id="$1" timeout_ms="${2:-5000}"
    local elapsed=0 status=""
    while (( elapsed < timeout_ms )); do
        status=$(jq -r '.status // "running"' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "running")
        if [[ "$status" == "succeeded" || "$status" == "failed" || "$status" == "cancelled" ]]; then
            return 0
        fi
        sleep 0.1
        elapsed=$((elapsed + 100))
    done
    return 1
}

# AC-M1-4: plain (no-color) step lines are parsed.
test_steps_plain_lines() {
    CURRENT_TEST_NAME="AC-M1-4: plain validate-ci lines parsed into steps[]"
    local task_id="stepsplain"
    "$BIN_DIR/task-start" "$task_id" --tool rl_validate_ci --slot 1 -- \
        /bin/sh -c "printf 'Build (all workspaces): PASS\nLint (all): FAIL\nUnit tests + coverage: SKIPPED\n'" \
        >/dev/null 2>&1 || true

    if ! wait_for_terminal "$task_id" 5000; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: task didn't terminate")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] task didn't terminate"
        return
    fi
    # Give parser a moment to finish appending after exit (M1 spec heuristic ≤2s).
    sleep 2.5

    local len
    len=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps | length' 2>/dev/null || echo "0")
    assert_eq "$len" "3" "steps[] should have 3 entries"

    local s0 n0 s1 n1 s2 n2
    n0=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[0].name' 2>/dev/null || echo "")
    s0=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[0].status' 2>/dev/null || echo "")
    n1=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[1].name' 2>/dev/null || echo "")
    s1=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[1].status' 2>/dev/null || echo "")
    n2=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[2].name' 2>/dev/null || echo "")
    s2=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[2].status' 2>/dev/null || echo "")
    assert_eq "$n0" "Build (all workspaces)" "step[0].name"
    assert_eq "$s0" "PASS" "step[0].status"
    assert_eq "$n1" "Lint (all)" "step[1].name"
    assert_eq "$s1" "FAIL" "step[1].status"
    assert_eq "$n2" "Unit tests + coverage" "step[2].name"
    assert_eq "$s2" "SKIPPED" "step[2].status"

    local task_status
    task_status=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")
    assert_eq "$task_status" "succeeded" "task status should be 'succeeded'"
}

# AC-M1-5: ANSI-colored lines are also parsed.
test_steps_ansi_lines() {
    CURRENT_TEST_NAME="AC-M1-5: ANSI-colored validate-ci lines parsed"
    local task_id="stepsansi1"
    "$BIN_DIR/task-start" "$task_id" --tool rl_validate_ci --slot 1 -- \
        /bin/sh -c "printf '\033[0;32mBuild (all workspaces): PASS\033[0m\n'" \
        >/dev/null 2>&1 || true

    wait_for_terminal "$task_id" 5000 || true
    sleep 2.5

    local len name status
    len=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps | length' 2>/dev/null || echo "0")
    assert_eq "$len" "1" "ANSI-colored line should produce 1 step entry"
    name=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[0].name' 2>/dev/null || echo "")
    status=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[0].status' 2>/dev/null || echo "")
    assert_eq "$name" "Build (all workspaces)" "name should strip ANSI"
    assert_eq "$status" "PASS" "status should strip ANSI"
}

# duration_s left null per spec.
test_steps_duration_null() {
    CURRENT_TEST_NAME="duration_s defaults to null"
    local task_id="durnull01"
    "$BIN_DIR/task-start" "$task_id" --tool rl_validate_ci --slot 1 -- \
        /bin/sh -c "printf 'Lint (all): PASS\n'" \
        >/dev/null 2>&1 || true
    wait_for_terminal "$task_id" 5000 || true
    sleep 2.5
    local duration
    duration=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps[0].duration_s' 2>/dev/null || echo "")
    assert_eq "$duration" "null" "duration_s should be null (M1 best-effort)"
}

# Non-matching output lines do NOT pollute steps[].
test_steps_no_false_positives() {
    CURRENT_TEST_NAME="non-status lines do NOT pollute steps[]"
    local task_id="nofalse01"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- \
        /bin/sh -c "printf 'Running tests...\nHello world\n+ npm test\n'" \
        >/dev/null 2>&1 || true
    wait_for_terminal "$task_id" 5000 || true
    sleep 2.5
    local len
    len=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps | length' 2>/dev/null || echo "0")
    assert_eq "$len" "0" "non-status output should leave steps[] empty"
}

run_test "ac-m1-4-plain" test_steps_plain_lines
run_test "ac-m1-5-ansi" test_steps_ansi_lines
run_test "duration-null" test_steps_duration_null
run_test "no-false-positives" test_steps_no_false_positives

print_test_summary
