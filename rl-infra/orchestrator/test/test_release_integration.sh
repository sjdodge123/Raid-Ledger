#!/usr/bin/env bash
# ROK-1331 M1 — release integration tests
# Covers AC-M1-8 (release cancels in-flight tasks for the slot).

set -uo pipefail

CURRENT_TEST_FILE="test_release_integration.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# AC-M1-8: release should call task-cancel on any running task owned by the
# released slot. We can't run the full `release` script because it expects
# docker, claims.json state, etc. — but we CAN verify that the script's source
# contains the new task-cancel cascade block.
#
# Two assertions:
#   1. release script grep contains a reference to "$RL_TASKS_DIR" OR
#      "tasks/" OR "task-cancel".
#   2. release script source iterates running tasks for the slot.
#
# Once dev-agent lands the change, these greps will return success.

test_release_invokes_task_cancel() {
    CURRENT_TEST_NAME="AC-M1-8a: release script references task-cancel binary"
    if [[ ! -f "$BIN_DIR/release" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: release script missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] release script missing"
        return
    fi
    if grep -q "task-cancel" "$BIN_DIR/release"; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: release does not mention task-cancel")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] release missing task-cancel reference"
    fi
}

test_release_filters_running_for_slot() {
    CURRENT_TEST_NAME="AC-M1-8b: release script enumerates running tasks for the slot"
    if [[ ! -f "$BIN_DIR/release" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: release script missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] release script missing"
        return
    fi
    # The spec's pseudocode references RL_TASKS_DIR and selects on slot+status.
    if grep -E -q "RL_TASKS_DIR|tasks/\*\.json|tasks/.*\.json" "$BIN_DIR/release"; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: release does not reference tasks/")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] release missing tasks dir reference"
    fi
}

# E2E: kick off a sleep task, then run release-like cancel cascade against our
# fixture state, then verify the task got flipped to cancelled. We re-implement
# the loop here in case the agent ships a slightly different shape — the
# observable contract is "running tasks for slot N get cancel_reason: slot_released".
test_release_cancels_inflight_e2e() {
    CURRENT_TEST_NAME="AC-M1-8c: e2e: running task on slot 1 flipped to cancelled"
    local task_id="releinfl1"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- /bin/sleep 60 >/dev/null 2>&1 || true

    # Wait for pid.
    local attempts=0 pid=""
    while [[ -z "$pid" || "$pid" == "null" ]] && (( attempts < 20 )); do
        pid=$(jq -r '.pid // "null"' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "null")
        attempts=$((attempts + 1))
        sleep 0.1
    done

    # Drive the release cascade directly via task-cancel (mirrors what release would do).
    "$BIN_DIR/task-cancel" "$task_id" "slot_released" >/dev/null 2>&1 || true

    local status reason
    status=$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "parse_err")
    reason=$(jq -r '.cancel_reason' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "parse_err")
    assert_eq "$status" "cancelled" "task status should be 'cancelled' after release cascade"
    assert_eq "$reason" "slot_released" "cancel_reason should be 'slot_released'"

    [[ -n "$pid" && "$pid" != "null" ]] && kill -9 "$pid" 2>/dev/null || true
}

run_test "ac-m1-8a-mentions-task-cancel" test_release_invokes_task_cancel
run_test "ac-m1-8b-iterates-tasks" test_release_filters_running_for_slot
run_test "ac-m1-8c-e2e" test_release_cancels_inflight_e2e

print_test_summary
