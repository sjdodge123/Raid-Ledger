#!/usr/bin/env bash
# ROK-1331 M1 — PATTERN_STEP_RESULT regex tests
# Covers AC-M1-4 + AC-M1-5: validate-ci PASS/FAIL/SKIPPED parsing,
# including ANSI color escape handling.
#
# This file exercises the regex IN ISOLATION by sourcing whatever the dev agent
# ships at orchestrator/bin/_parser.sh OR an exported PATTERN_STEP_RESULT
# constant inside task-start. The dev agent decides the exact extraction point;
# the contract is: the regex matches every line below, captures
# BASH_REMATCH[2]=<name>, BASH_REMATCH[3]=<status>.

set -uo pipefail

CURRENT_TEST_FILE="test_pattern_regex.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Locate the regex. M1 spec § Notes/Open Questions #4 says NOT to source via a
# helper, but the contract is a single source of truth — accept either a
# `_parser.sh` exporting PATTERN_STEP_RESULT OR a grep'd constant from
# `task-start` (`PATTERN_STEP_RESULT='...'`). Both shapes are TDD-acceptable.
load_pattern() {
    if [[ -f "$BIN_DIR/_parser.sh" ]]; then
        # shellcheck disable=SC1091
        source "$BIN_DIR/_parser.sh"
        return 0
    fi
    if [[ -f "$BIN_DIR/task-start" ]]; then
        local line
        line=$(grep -E "^PATTERN_STEP_RESULT=" "$BIN_DIR/task-start" || true)
        if [[ -n "$line" ]]; then
            eval "$line"
            return 0
        fi
    fi
    return 1
}

# Each regex test asserts a match (or non-match) on a sample line.
assert_pattern_matches() {
    local line="$1" expected_name="$2" expected_status="$3" message="${4:-}"
    if [[ "$line" =~ $PATTERN_STEP_RESULT ]]; then
        local name="${BASH_REMATCH[2]}" status="${BASH_REMATCH[3]}"
        assert_eq "$name" "$expected_name" "$message: name capture"
        assert_eq "$status" "$expected_status" "$message: status capture"
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: regex did not match")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] regex did not match line: $line"
    fi
}

assert_pattern_no_match() {
    local line="$1" message="${2:-}"
    if [[ "$line" =~ $PATTERN_STEP_RESULT ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: regex matched but should not have")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] line matched regex but shouldn't: $line"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
}

# Bootstrap: ensure the pattern can be loaded. If not, every downstream test is
# also doomed; we still record the fundamental failure here.
test_pattern_load() {
    CURRENT_TEST_NAME="pattern load"
    if load_pattern; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: PATTERN_STEP_RESULT not found in bin/_parser.sh or bin/task-start")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] no PATTERN_STEP_RESULT — implementation missing"
    fi
}

# AC-M1-4: plain (no-color) lines parse.
test_pattern_plain_pass() {
    CURRENT_TEST_NAME="AC-M1-4: plain 'Build (all workspaces): PASS' matches"
    load_pattern || return
    assert_pattern_matches "Build (all workspaces): PASS" "Build (all workspaces)" "PASS" "plain PASS"
}

test_pattern_plain_fail() {
    CURRENT_TEST_NAME="AC-M1-4: plain 'Lint (all): FAIL' matches"
    load_pattern || return
    assert_pattern_matches "Lint (all): FAIL" "Lint (all)" "FAIL" "plain FAIL"
}

test_pattern_plain_skipped() {
    CURRENT_TEST_NAME="AC-M1-4: plain 'Unit tests + coverage: SKIPPED' matches"
    load_pattern || return
    assert_pattern_matches "Unit tests + coverage: SKIPPED" "Unit tests + coverage" "SKIPPED" "plain SKIPPED"
}

# AC-M1-5: ANSI-colored lines parse (the real validate-ci.sh output shape).
test_pattern_ansi_pass() {
    CURRENT_TEST_NAME="AC-M1-5: ANSI-colored 'Build (all workspaces): PASS' matches"
    load_pattern || return
    local line=$'\x1b[0;32mBuild (all workspaces): PASS\x1b[0m'
    assert_pattern_matches "$line" "Build (all workspaces)" "PASS" "ANSI PASS"
}

test_pattern_ansi_fail() {
    CURRENT_TEST_NAME="AC-M1-5: ANSI-colored 'TypeScript (all): FAIL' matches"
    load_pattern || return
    local line=$'\x1b[0;31mTypeScript (all): FAIL\x1b[0m'
    assert_pattern_matches "$line" "TypeScript (all)" "FAIL" "ANSI FAIL"
}

# Real validate-ci.sh step names — these MUST all parse.
test_pattern_real_step_names() {
    CURRENT_TEST_NAME="all validate-ci.sh step names parse"
    load_pattern || return
    local names=(
        "Build (all workspaces)"
        "TypeScript (all)"
        "Lint (all)"
        "Unit tests + coverage"
        "Integration tests (api)"
        "Migration validation"
        "Container startup"
        "Playwright (desktop + mobile)"
        "Discord smoke (companion bot)"
    )
    for n in "${names[@]}"; do
        local line="$n: PASS"
        assert_pattern_matches "$line" "$n" "PASS" "real step name '$n'"
    done
}

# Negative cases: lines that should NOT match.
test_pattern_rejects_non_status() {
    CURRENT_TEST_NAME="non-status lines don't match"
    load_pattern || return
    assert_pattern_no_match "Running tests..." "informational lines should not match"
    assert_pattern_no_match "Build (all workspaces): INFO" "non-status terminal word should not match"
    assert_pattern_no_match "lowercase: PASS" "name starting lowercase should not match"
    assert_pattern_no_match "[14:00:00] Build (all workspaces): PASS" "leading timestamp should not match (anchored to ^)"
}

# Negative: trailing garbage after PASS should fail anchor.
test_pattern_anchored() {
    CURRENT_TEST_NAME="regex is line-anchored"
    load_pattern || return
    assert_pattern_no_match "Build (all workspaces): PASS extra-garbage" "trailing text after PASS should not match"
}

run_test "load" test_pattern_load
run_test "plain-pass" test_pattern_plain_pass
run_test "plain-fail" test_pattern_plain_fail
run_test "plain-skipped" test_pattern_plain_skipped
run_test "ansi-pass" test_pattern_ansi_pass
run_test "ansi-fail" test_pattern_ansi_fail
run_test "real-step-names" test_pattern_real_step_names
run_test "rejects-non-status" test_pattern_rejects_non_status
run_test "anchored" test_pattern_anchored

print_test_summary
