#!/usr/bin/env bash
# ROK-1331 M1 — task-cancel tests
# Covers AC-M1-6 (cancel mid-run SIGTERM-then-SIGKILL) and AC-M1-7 (cancel terminal noop).

set -uo pipefail

CURRENT_TEST_FILE="test_task_cancel.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# AC-M1-6: cancel mid-run flips status, kills process, sets cancel_reason.
test_task_cancel_mid_run() {
    CURRENT_TEST_NAME="AC-M1-6: cancel mid-run flips status to 'cancelled'"
    local task_id="cancmid12"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 60 >/dev/null 2>&1 || true

    # Wait for pid to be recorded so we can verify kill.
    local pid="" attempts=0
    while [[ -z "$pid" || "$pid" == "null" ]] && (( attempts < 20 )); do
        pid=$(jq -r '.pid // "null"' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "null")
        attempts=$((attempts + 1))
        sleep 0.1
    done

    local cancel_out exit_code
    cancel_out=$("$BIN_DIR/task-cancel" "$task_id" "operator_test" 2>&1)
    exit_code=$?
    assert_exit_code "$exit_code" "0" "task-cancel should exit 0"

    local ok killed prev
    ok=$(echo "$cancel_out" | jq -r '.ok' 2>/dev/null || echo "parse_err")
    killed=$(echo "$cancel_out" | jq -r '.killed' 2>/dev/null || echo "parse_err")
    prev=$(echo "$cancel_out" | jq -r '.previous_status' 2>/dev/null || echo "parse_err")
    assert_eq "$ok" "true" ".ok should be true"
    assert_eq "$killed" "true" ".killed should be true for live task"
    assert_eq "$prev" "running" ".previous_status should be 'running'"

    # Verify final state.
    local status reason finished
    status=$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "parse_err")
    reason=$(jq -r '.cancel_reason' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "parse_err")
    finished=$(jq -r '.finished_at' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "parse_err")
    assert_eq "$status" "cancelled" "JSON status should be 'cancelled'"
    assert_eq "$reason" "operator_test" "JSON cancel_reason should reflect input"
    assert_neq "$finished" "null" "JSON finished_at must be set after cancel"

    # PID should be gone within 11s (SIGTERM grace 10s + buffer).
    if [[ -n "$pid" && "$pid" != "null" ]]; then
        local waited=0
        while kill -0 "$pid" 2>/dev/null && (( waited < 110 )); do
            sleep 0.1
            waited=$((waited + 1))
        done
        if kill -0 "$pid" 2>/dev/null; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: pid still alive after cancel grace")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] pid $pid still alive after 11s"
            kill -9 "$pid" 2>/dev/null || true
        else
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        fi
    fi
}

# AC-M1-7: cancel already-terminal task is a noop, returns killed:false.
test_task_cancel_terminal_noop() {
    CURRENT_TEST_NAME="AC-M1-7: cancel terminal task is noop"
    local task_id="cancdone1"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sh -c "exit 0" >/dev/null 2>&1 || true

    # Wait for terminal status.
    local status="" attempts=0
    while [[ "$status" != "succeeded" && "$status" != "failed" ]] && (( attempts < 50 )); do
        status=$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "")
        attempts=$((attempts + 1))
        sleep 0.1
    done
    [[ "$status" == "succeeded" ]] || {
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: precondition failed (task did not reach 'succeeded')")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] precondition status=$status"
        return
    }

    local snapshot_before
    snapshot_before=$(cat "$RL_TASKS_DIR/$task_id.json")

    local out exit_code
    out=$("$BIN_DIR/task-cancel" "$task_id" "too-late" 2>&1)
    exit_code=$?
    assert_exit_code "$exit_code" "0" "cancel of terminal task exits 0 (noop)"

    local killed prev
    killed=$(echo "$out" | jq -r '.killed' 2>/dev/null || echo "parse_err")
    prev=$(echo "$out" | jq -r '.previous_status' 2>/dev/null || echo "parse_err")
    assert_eq "$killed" "false" ".killed should be false for terminal task"
    assert_eq "$prev" "succeeded" ".previous_status should be 'succeeded'"

    # JSON file unchanged.
    local snapshot_after
    snapshot_after=$(cat "$RL_TASKS_DIR/$task_id.json")
    assert_eq "$snapshot_after" "$snapshot_before" "JSON unchanged after terminal cancel"
}

# Validation: bad task_id format.
test_task_cancel_rejects_invalid_id() {
    CURRENT_TEST_NAME="validation: task-cancel rejects bad task_id"
    local exit_code=0
    "$BIN_DIR/task-cancel" "BAD@ID" "reason" >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "2" "should exit 2 on invalid id"
}

# Validation: missing file.
test_task_cancel_rejects_missing_file() {
    CURRENT_TEST_NAME="validation: task-cancel rejects unknown task_id"
    local exit_code=0
    "$BIN_DIR/task-cancel" "missing12" "reason" >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "2" "should exit 2 when JSON file missing"
}

run_test "ac-m1-6" test_task_cancel_mid_run
run_test "ac-m1-7" test_task_cancel_terminal_noop
run_test "invalid-id" test_task_cancel_rejects_invalid_id
run_test "missing-file" test_task_cancel_rejects_missing_file

print_test_summary
