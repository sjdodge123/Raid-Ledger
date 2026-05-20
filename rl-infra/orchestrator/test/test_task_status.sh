#!/usr/bin/env bash
# ROK-1331 M1 — task-status tests
# Covers AC-M1-3 (status read-back mid-run + final).

set -uo pipefail

CURRENT_TEST_FILE="test_task_status.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# AC-M1-3 part 1: status returns running mid-execution.
test_task_status_mid_run() {
    CURRENT_TEST_NAME="AC-M1-3a: status returns 'running' mid-execution"
    local task_id="status123"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 5 >/dev/null 2>&1 || true

    local out exit_code
    out=$("$BIN_DIR/task-status" "$task_id" 2>&1)
    exit_code=$?
    assert_exit_code "$exit_code" "0" "task-status should exit 0"

    local status finished_at elapsed
    status=$(echo "$out" | jq -r '.status' 2>/dev/null || echo "parse_err")
    finished_at=$(echo "$out" | jq -r '.finished_at' 2>/dev/null || echo "parse_err")
    elapsed=$(echo "$out" | jq -r '.elapsed_seconds' 2>/dev/null || echo "parse_err")

    assert_eq "$status" "running" "mid-run status should be 'running'"
    assert_eq "$finished_at" "null" "mid-run finished_at should be null"
    # elapsed_seconds should be 0 or positive int.
    if [[ "$elapsed" =~ ^[0-9]+$ ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: elapsed_seconds not integer")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] elapsed_seconds should be int, got: $elapsed"
    fi

    pkill -f "/bin/sleep 5" 2>/dev/null || true
}

# AC-M1-3 part 2: status returns succeeded after cmd exits cleanly.
test_task_status_succeeded_terminal() {
    CURRENT_TEST_NAME="AC-M1-3b: status returns 'succeeded' after clean exit"
    local task_id="succ12345"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sh -c "exit 0" >/dev/null 2>&1 || true

    # Wait up to 5s for the bookkeeping writer to flip status.
    local status="" attempts=0
    while [[ "$status" != "succeeded" && "$status" != "failed" ]] && (( attempts < 50 )); do
        status=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")
        attempts=$((attempts + 1))
        sleep 0.1
    done
    assert_eq "$status" "succeeded" "post-exit status should be 'succeeded' for exit 0 cmd"

    local exit_code finished_at
    exit_code=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.script_exit_code' 2>/dev/null || echo "")
    finished_at=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.finished_at' 2>/dev/null || echo "")
    assert_eq "$exit_code" "0" "script_exit_code should be 0"
    assert_neq "$finished_at" "null" "finished_at must be set after exit"
}

# AC-M1-3: failed-task status reflection.
test_task_status_failed() {
    CURRENT_TEST_NAME="AC-M1-3c: status returns 'failed' for non-zero exit"
    local task_id="failtsk12"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sh -c "exit 7" >/dev/null 2>&1 || true

    local status="" attempts=0
    while [[ "$status" != "succeeded" && "$status" != "failed" ]] && (( attempts < 50 )); do
        status=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")
        attempts=$((attempts + 1))
        sleep 0.1
    done
    assert_eq "$status" "failed" "post-exit status should be 'failed' for exit 7 cmd"

    local exit_code
    exit_code=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.script_exit_code' 2>/dev/null || echo "")
    assert_eq "$exit_code" "7" "script_exit_code should be 7"
}

# AC-M1-3: log_tail field is present.
test_task_status_log_tail() {
    CURRENT_TEST_NAME="AC-M1-3d: log_tail returns recent output"
    local task_id="logtail99"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sh -c "echo hello-from-task; exit 0" >/dev/null 2>&1 || true

    # Wait for terminal status.
    local status="" attempts=0
    while [[ "$status" != "succeeded" && "$status" != "failed" ]] && (( attempts < 50 )); do
        status=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")
        attempts=$((attempts + 1))
        sleep 0.1
    done

    local log_tail
    log_tail=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.log_tail' 2>/dev/null || echo "")
    assert_contains "$log_tail" "hello-from-task" "log_tail should include cmd stdout"
}

# Validation: invalid task_id format → exit 2.
test_task_status_rejects_invalid_id() {
    CURRENT_TEST_NAME="validation: task-status rejects bad task_id"
    local exit_code=0
    "$BIN_DIR/task-status" "BAD@ID" >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "2" "task-status should exit 2 on invalid id"
}

# Validation: not-found task_id → exit 2.
test_task_status_rejects_missing_file() {
    CURRENT_TEST_NAME="validation: task-status rejects unknown task_id"
    local exit_code=0
    "$BIN_DIR/task-status" "ghostmiss" >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "2" "task-status should exit 2 when JSON file missing"
}

# AC-M1-4 partial: steps[] field is initialized as empty array on JSON.
test_task_status_steps_field_present() {
    CURRENT_TEST_NAME="AC-M1-4 init: .steps is an array (initially empty)"
    local task_id="stepsfld1"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 0.5 >/dev/null 2>&1 || true

    local steps_type
    steps_type=$("$BIN_DIR/task-status" "$task_id" 2>/dev/null | jq -r '.steps | type' 2>/dev/null || echo "missing")
    assert_eq "$steps_type" "array" ".steps must be an array"
}

run_test "ac-m1-3a" test_task_status_mid_run
run_test "ac-m1-3b" test_task_status_succeeded_terminal
run_test "ac-m1-3c" test_task_status_failed
run_test "ac-m1-3d" test_task_status_log_tail
run_test "invalid-id" test_task_status_rejects_invalid_id
run_test "missing-file" test_task_status_rejects_missing_file
run_test "steps-field-init" test_task_status_steps_field_present

print_test_summary
