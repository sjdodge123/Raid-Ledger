#!/usr/bin/env bash
# ROK-1331 M1 — task-list tests
# Covers AC-M1-9 (list filters by --slot / --status / --limit).

set -uo pipefail

CURRENT_TEST_FILE="test_task_list.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Helper: hand-roll a task JSON file directly (bypasses task-start) so we have
# deterministic mixed-state fixtures for list filtering. This is safe because
# task-list is a pure reader; it doesn't care how the JSONs got there.
make_fixture_task() {
    local task_id="$1" slot="$2" status="$3" started_at="$4"
    cat > "$RL_TASKS_DIR/$task_id.json" <<EOF
{
  "task_id": "$task_id",
  "tool": "manual",
  "slot": $slot,
  "agent_id": "fixture",
  "args_summary": "",
  "cmd": ["/bin/true"],
  "log_path": "$RL_TASKS_DIR/$task_id.log",
  "pid": null,
  "status": "$status",
  "script_exit_code": null,
  "started_at": "$started_at",
  "finished_at": null,
  "cancel_reason": null,
  "steps": []
}
EOF
    touch "$RL_TASKS_DIR/$task_id.log"
}

# AC-M1-9 part 1: --status running filters to only running tasks.
test_task_list_status_running() {
    CURRENT_TEST_NAME="AC-M1-9a: --status running filter"
    make_fixture_task "runn00001" 1 "running" "2026-05-20T14:00:00Z"
    make_fixture_task "succ00001" 1 "succeeded" "2026-05-20T13:00:00Z"
    make_fixture_task "canc00001" 1 "cancelled" "2026-05-20T12:00:00Z"

    # task-list emits the MCP envelope {ok:true, tasks:[...]} (ROK-1331
    # Session 4 dogfood), NOT a bare array — assert against .tasks accordingly.
    local out ok len
    out=$("$BIN_DIR/task-list" --slot 1 --status running 2>&1)
    ok=$(echo "$out" | jq -r '.ok' 2>/dev/null || echo "parse_err")
    assert_eq "$ok" "true" "response must be the {ok:true, tasks:[...]} envelope"
    len=$(echo "$out" | jq '.tasks | length' 2>/dev/null || echo "parse_err")
    assert_eq "$len" "1" "should return exactly 1 running task"

    local first_status first_id
    first_status=$(echo "$out" | jq -r '.tasks[0].status' 2>/dev/null || echo "parse_err")
    first_id=$(echo "$out" | jq -r '.tasks[0].task_id' 2>/dev/null || echo "parse_err")
    assert_eq "$first_status" "running" "task's status should be 'running'"
    assert_eq "$first_id" "runn00001" "should be the runn00001 fixture"
}

# AC-M1-9 part 2: --status succeeded filters to only succeeded tasks.
test_task_list_status_succeeded() {
    CURRENT_TEST_NAME="AC-M1-9b: --status succeeded filter"
    make_fixture_task "runn00002" 1 "running" "2026-05-20T14:00:00Z"
    make_fixture_task "succ00002" 1 "succeeded" "2026-05-20T13:00:00Z"
    make_fixture_task "canc00002" 1 "cancelled" "2026-05-20T12:00:00Z"

    local out len
    out=$("$BIN_DIR/task-list" --slot 1 --status succeeded 2>&1)
    len=$(echo "$out" | jq '.tasks | length' 2>/dev/null || echo "parse_err")
    assert_eq "$len" "1" "should return exactly 1 succeeded task"
}

# AC-M1-9 part 3: no --status filter returns all tasks for slot.
test_task_list_no_status_filter() {
    CURRENT_TEST_NAME="AC-M1-9c: --slot N without --status returns all"
    make_fixture_task "runn00003" 1 "running" "2026-05-20T14:00:00Z"
    make_fixture_task "succ00003" 1 "succeeded" "2026-05-20T13:00:00Z"
    make_fixture_task "canc00003" 1 "cancelled" "2026-05-20T12:00:00Z"

    local out len
    out=$("$BIN_DIR/task-list" --slot 1 2>&1)
    len=$(echo "$out" | jq '.tasks | length' 2>/dev/null || echo "parse_err")
    assert_eq "$len" "3" "should return all 3 tasks for slot 1"
}

# Slot filtering: tasks for other slots are excluded.
test_task_list_slot_isolation() {
    CURRENT_TEST_NAME="slot isolation: --slot N excludes other slots"
    make_fixture_task "slot1aaaa" 1 "running" "2026-05-20T14:00:00Z"
    make_fixture_task "slot2bbbb" 2 "running" "2026-05-20T14:00:00Z"
    make_fixture_task "slot1cccc" 1 "succeeded" "2026-05-20T13:00:00Z"

    local len
    len=$("$BIN_DIR/task-list" --slot 1 2>&1 | jq '.tasks | length' 2>/dev/null || echo "parse_err")
    assert_eq "$len" "2" "slot 1 filter should return 2 tasks (excluding slot 2)"

    len=$("$BIN_DIR/task-list" --slot 2 2>&1 | jq '.tasks | length' 2>/dev/null || echo "parse_err")
    assert_eq "$len" "1" "slot 2 filter should return 1 task"
}

# --limit caps the returned list.
test_task_list_limit() {
    CURRENT_TEST_NAME="--limit caps the returned list"
    for i in 1 2 3 4 5; do
        make_fixture_task "limit000$i" 1 "succeeded" "2026-05-20T${i}0:00:00Z"
    done
    local len
    len=$("$BIN_DIR/task-list" --slot 1 --limit 3 2>&1 | jq '.tasks | length' 2>/dev/null || echo "parse_err")
    assert_eq "$len" "3" "--limit 3 should return at most 3 tasks"
}

# Sort order: descending by started_at.
test_task_list_sort_desc() {
    CURRENT_TEST_NAME="output sorted descending by started_at"
    make_fixture_task "old000001" 1 "succeeded" "2026-05-20T10:00:00Z"
    make_fixture_task "newer0001" 1 "succeeded" "2026-05-20T12:00:00Z"
    make_fixture_task "newest001" 1 "succeeded" "2026-05-20T14:00:00Z"

    local first second third
    first=$("$BIN_DIR/task-list" --slot 1 2>&1 | jq -r '.tasks[0].task_id' 2>/dev/null || echo "")
    second=$("$BIN_DIR/task-list" --slot 1 2>&1 | jq -r '.tasks[1].task_id' 2>/dev/null || echo "")
    third=$("$BIN_DIR/task-list" --slot 1 2>&1 | jq -r '.tasks[2].task_id' 2>/dev/null || echo "")
    assert_eq "$first" "newest001" "[0] should be newest"
    assert_eq "$second" "newer0001" "[1] should be middle"
    assert_eq "$third" "old000001" "[2] should be oldest"
}

# Output is always the {ok:true, tasks:[]} envelope (even when no tasks match).
test_task_list_empty_array() {
    CURRENT_TEST_NAME="empty result returns []"
    local out type len ok
    out=$("$BIN_DIR/task-list" --slot 1 2>&1)
    ok=$(echo "$out" | jq -r '.ok' 2>/dev/null || echo "parse_err")
    assert_eq "$ok" "true" "empty result must still be the ok-envelope"
    type=$(echo "$out" | jq -r '.tasks | type' 2>/dev/null || echo "parse_err")
    assert_eq "$type" "array" ".tasks must be a JSON array"
    len=$(echo "$out" | jq '.tasks | length' 2>/dev/null || echo "parse_err")
    assert_eq "$len" "0" "empty fixture set should produce an empty tasks array"
}

run_test "ac-m1-9a-running" test_task_list_status_running
run_test "ac-m1-9b-succeeded" test_task_list_status_succeeded
run_test "ac-m1-9c-no-filter" test_task_list_no_status_filter
run_test "slot-isolation" test_task_list_slot_isolation
run_test "limit" test_task_list_limit
run_test "sort-desc" test_task_list_sort_desc
run_test "empty-array" test_task_list_empty_array

print_test_summary
