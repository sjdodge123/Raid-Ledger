#!/usr/bin/env bash
# ROK-1331 M1 — task-start tests
# Covers AC-M1-1 (returns within 1s), AC-M1-2 (state file exists), validation rules.

set -uo pipefail

CURRENT_TEST_FILE="test_task_start.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# AC-M1-1: task-start returns within 1s and emits valid JSON with required keys.
test_task_start_returns_fast() {
    CURRENT_TEST_NAME="AC-M1-1: returns within 1s with valid JSON"
    local task_id="abc12345"
    local start_ns end_ns
    start_ns=$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)
    local out exit_code
    out=$("$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 5 2>&1)
    exit_code=$?
    end_ns=$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)
    local delta_ms=$((end_ns - start_ns))

    assert_exit_code "$exit_code" "0" "task-start should exit 0"
    assert_le "$delta_ms" "1500" "task-start should return in <1.5s (wallclock incl. fork overhead)"

    # JSON shape on stdout.
    local ok task_id_out log_path started_at
    ok=$(echo "$out" | jq -r '.ok' 2>/dev/null || echo "parse_err")
    task_id_out=$(echo "$out" | jq -r '.task_id' 2>/dev/null || echo "parse_err")
    log_path=$(echo "$out" | jq -r '.log_path' 2>/dev/null || echo "parse_err")
    started_at=$(echo "$out" | jq -r '.started_at' 2>/dev/null || echo "parse_err")

    assert_eq "$ok" "true" "JSON .ok == true"
    assert_eq "$task_id_out" "$task_id" "JSON .task_id matches input"
    assert_contains "$log_path" "$task_id.log" "JSON .log_path ends in <task_id>.log"
    assert_neq "$started_at" "parse_err" ".started_at must be parseable ISO string"

    # Cleanup: try to kill any lingering sleep.
    pkill -f "/bin/sleep 5" 2>/dev/null || true
}

# AC-M1-2: state file exists immediately after task-start returns.
test_task_start_state_file_created() {
    CURRENT_TEST_NAME="AC-M1-2: JSON + log file created before return"
    local task_id="bcd23456"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 5 >/dev/null 2>&1 || true

    assert_file_exists "$RL_TASKS_DIR/$task_id.json" "task JSON file must exist"
    assert_file_exists "$RL_TASKS_DIR/$task_id.log" "task log file must exist (may be empty)"

    local status
    status=$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "parse_err")
    assert_eq "$status" "running" "status should be 'running' immediately after spawn"

    pkill -f "/bin/sleep 5" 2>/dev/null || true
}

# Validation: invalid task_id format rejected.
test_task_start_rejects_invalid_task_id() {
    CURRENT_TEST_NAME="validation: invalid task_id format rejected"
    local out exit_code
    # Uppercase + special chars violate ^[a-z0-9]{8,32}$
    out=$("$BIN_DIR/task-start" "BAD-ID" --tool manual --slot 1 -- /bin/true 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "2" "should exit 2 on invalid task_id"
    assert_contains "$out" "invalid_task_id" "stderr should mention invalid_task_id"
}

# Validation: short task_id (< 8 chars) rejected.
test_task_start_rejects_short_task_id() {
    CURRENT_TEST_NAME="validation: task_id shorter than 8 chars rejected"
    local out exit_code
    out=$("$BIN_DIR/task-start" "abc" --tool manual --slot 1 -- /bin/true 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "2" "should exit 2 on too-short task_id"
}

# Validation: invalid --tool name rejected.
test_task_start_rejects_invalid_tool() {
    CURRENT_TEST_NAME="validation: invalid --tool name (spaces) rejected"
    local out exit_code
    out=$("$BIN_DIR/task-start" "validtask" --tool "bad name" --slot 1 -- /bin/true 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "2" "should exit 2 on invalid tool name"
    assert_contains "$out" "invalid_tool_name" "stderr should mention invalid_tool_name"
}

# Validation: missing -- separator / no command after --.
test_task_start_rejects_missing_cmd() {
    CURRENT_TEST_NAME="validation: missing wrapped cmd rejected"
    local out exit_code
    out=$("$BIN_DIR/task-start" "validtask" --tool manual --slot 1 -- 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "2" "should exit 2 when -- has no following cmd"
    assert_contains "$out" "missing_cmd" "stderr should mention missing_cmd"
}

# Validation: task_id collision rejected.
test_task_start_rejects_duplicate_task_id() {
    CURRENT_TEST_NAME="validation: duplicate task_id collision rejected"
    local task_id="dupe12345"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 5 >/dev/null 2>&1 || true
    # Second invocation with the same id should reject.
    local out exit_code
    out=$("$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/true 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "2" "second task-start with same id should exit 2"
    assert_contains "$out" "task_id_exists" "stderr should mention task_id_exists"

    pkill -f "/bin/sleep 5" 2>/dev/null || true
}

# Detach semantics: parent returns even though child still running.
test_task_start_detach() {
    CURRENT_TEST_NAME="detach: parent returns while child runs"
    local task_id="detach123"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 30 >/dev/null 2>&1 || true

    # The PID written into the task JSON should still be alive (or briefly null).
    # Wait up to 2s for pid to populate.
    local pid="" attempts=0
    while [[ -z "$pid" || "$pid" == "null" ]] && (( attempts < 20 )); do
        pid=$(jq -r '.pid // "null"' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "null")
        attempts=$((attempts + 1))
        sleep 0.1
    done
    assert_neq "$pid" "null" "pid should be written to JSON within 2s"
    if [[ "$pid" != "null" && -n "$pid" ]]; then
        # The wrapped process should still be alive.
        if kill -0 "$pid" 2>/dev/null; then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: wrapped pid not alive")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapped pid $pid not alive after detach"
        fi
        kill -TERM "$pid" 2>/dev/null || true
    fi
    pkill -f "/bin/sleep 30" 2>/dev/null || true
}

# Run all tests.
run_test "ac-m1-1" test_task_start_returns_fast
run_test "ac-m1-2" test_task_start_state_file_created
run_test "invalid-task-id" test_task_start_rejects_invalid_task_id
run_test "short-task-id" test_task_start_rejects_short_task_id
run_test "invalid-tool" test_task_start_rejects_invalid_tool
run_test "missing-cmd" test_task_start_rejects_missing_cmd
run_test "duplicate-task-id" test_task_start_rejects_duplicate_task_id
run_test "detach" test_task_start_detach

print_test_summary
