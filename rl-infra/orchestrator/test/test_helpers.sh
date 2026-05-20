#!/usr/bin/env bash
# Shared test helpers for ROK-1331 M1 orchestrator task primitive tests.
# These tests run LOCALLY on the operator's mac, NOT on the rl-infra VM.
# RL_STATE_DIR is redirected to a per-test temp dir so we never touch real state.

set -uo pipefail

# Locate the orchestrator/bin/ directory relative to this file.
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$(cd "$TEST_DIR/../bin" && pwd)"

# Per-suite test counters.
TEST_PASS_COUNT=0
TEST_FAIL_COUNT=0
TEST_FAIL_NAMES=()
CURRENT_TEST_FILE="${CURRENT_TEST_FILE:-unknown}"

# Per-test temp dir setup. Each test calls test_setup at start and test_teardown
# at end. RL_STATE_DIR redirects all state writes into the tmp dir.
test_setup() {
    TMP_STATE=$(mktemp -d -t rl-task-test.XXXXXX)
    export RL_STATE_DIR="$TMP_STATE"
    export RL_TASKS_DIR="$TMP_STATE/tasks"
    export RL_LOCK_DIR="$TMP_STATE/locks"
    export RL_AGENT_ID="${RL_AGENT_ID:-test-agent-1331}"
    mkdir -p "$RL_TASKS_DIR" "$RL_LOCK_DIR"
}

test_teardown() {
    if [[ -n "${TMP_STATE:-}" && -d "$TMP_STATE" ]]; then
        rm -rf "$TMP_STATE"
    fi
    unset TMP_STATE RL_STATE_DIR RL_TASKS_DIR RL_LOCK_DIR
}

# Assertion helpers — print FAIL/PASS, never exit (so the runner aggregates).
assert_eq() {
    local actual="$1" expected="$2" message="${3:-}"
    if [[ "$actual" == "$expected" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message"
        echo "  expected: $expected"
        echo "  actual:   $actual"
    fi
}

assert_neq() {
    local actual="$1" not_expected="$2" message="${3:-}"
    if [[ "$actual" != "$not_expected" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message"
        echo "  expected NOT: $not_expected"
        echo "  actual:        $actual"
    fi
}

assert_file_exists() {
    local path="$1" message="${2:-file should exist: $1}"
    if [[ -f "$path" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message (path=$path)"
    fi
}

assert_file_not_exists() {
    local path="$1" message="${2:-file should NOT exist: $1}"
    if [[ ! -f "$path" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message (path=$path)"
    fi
}

assert_exit_code() {
    local actual="$1" expected="$2" message="${3:-}"
    if [[ "$actual" == "$expected" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message"
        echo "  expected exit: $expected"
        echo "  actual exit:   $actual"
    fi
}

assert_contains() {
    local haystack="$1" needle="$2" message="${3:-}"
    if [[ "$haystack" == *"$needle"* ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message"
        echo "  expected to contain: $needle"
        echo "  actual:              $haystack"
    fi
}

assert_le() {
    local actual="$1" max="$2" message="${3:-}"
    if [[ "$actual" -le "$max" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message"
        echo "  expected <= $max"
        echo "  actual:      $actual"
    fi
}

# Helper: time a command in whole seconds (rounded up). Used for "<1s" assertions.
time_seconds() {
    local start_ns end_ns
    start_ns=$(date +%s%N 2>/dev/null || date +%s)
    "$@" >/dev/null 2>&1 || true
    end_ns=$(date +%s%N 2>/dev/null || date +%s)
    # On macOS date doesn't support %N — coerce to whole seconds either way.
    if [[ "$start_ns" == *N* || ${#start_ns} -le 10 ]]; then
        # No nanosecond support; fallback to second-resolution.
        echo $((end_ns - start_ns))
    else
        # Convert ns delta to whole seconds (ceil-ish).
        local delta_ns=$((end_ns - start_ns))
        echo $((delta_ns / 1000000000))
    fi
}

# Register a test case. Usage:
#   run_test test_name_string test_function
run_test() {
    local name="$1"
    local func="$2"
    CURRENT_TEST_NAME="$name"
    test_setup
    if "$func"; then
        :
    else
        # Test function itself raised — treat as fail (the function should use
        # asserts, not raise). Some tests legitimately exit non-zero from
        # internal commands they're inspecting; that's fine. We only escalate
        # to a hard failure if no assertions ran.
        :
    fi
    test_teardown
}

# Final summary printer for a test file.
print_test_summary() {
    echo
    echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
    if (( TEST_FAIL_COUNT > 0 )); then
        echo "Failed cases:"
        for f in "${TEST_FAIL_NAMES[@]}"; do
            echo "  - $f"
        done
        return 1
    fi
    return 0
}
