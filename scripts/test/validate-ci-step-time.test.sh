#!/usr/bin/env bash
# ROK-1793 S0 — validate-ci.sh `run_step` prints a machine-readable duration.
#
# Every step must print `[step-time] <name> <seconds>` BEFORE its
# "<name>: <STATUS>" row, so the orchestrator's steps[] parser (task-start,
# PATTERN_STEP_TIME) and the MCP log-tail backfill can fill
# rl_task_status steps[].duration_s, which was null on every task.
#
# Drives the real `run_step` by sourcing validate-ci.sh under
# RL_VALIDATE_CI_DRY=1 (same harness as validate-ci-skip-contract.test.sh).

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-step-time.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REPO_ROOT/scripts/validate-ci.sh"

TEST_PASS_COUNT=0
TEST_FAIL_COUNT=0
TEST_FAIL_NAMES=()
CURRENT_TEST_NAME=""

pass() { TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)); }
fail() {
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $1")
    echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $1"
}

# Three steps (PASS, SKIPPED, then a deferred FAIL so run_step does not exit).
out="$(
    (
        # shellcheck disable=SC1090
        RL_VALIDATE_CI_DRY=1 source "$VALIDATE_CI_PATH" >/dev/null 2>&1
        ok() { return 0; }
        skipper() { skip_step; return 0; }
        bad() { return 1; }
        run_step "Build (all workspaces)" ok 2>&1
        run_step "Lint (all)" skipper 2>&1
        RUN_STEP_DEFER_FAIL=1
        run_step "Playwright (desktop + mobile, scoped: 2 specs)" bad 2>&1
    ) | sed $'s/\033\\[[0-9;]*m//g'
)"
flat="$(echo "$out" | tr '\n' '|' | tail -c 400)"
TIME_RE='^\[step-time\] %s [0-9]+\.[0-9]$'

for name in "Build (all workspaces)" "Lint (all)" "Playwright (desktop + mobile, scoped: 2 specs)"; do
    CURRENT_TEST_NAME="a [step-time] line is printed for '$name'"
    esc="$(printf '%s' "$name" | sed 's/[][()+.*^$]/\\&/g')"
    # shellcheck disable=SC2059
    if echo "$out" | grep -Eq "$(printf "$TIME_RE" "$esc")"; then
        pass
    else
        fail "expected a line '[step-time] $name <s.d>' — got: $flat"
    fi
done

CURRENT_TEST_NAME="each [step-time] line comes right before its result row"
pairs="$(echo "$out" | grep -E '^\[step-time\] |: (PASS|FAIL|SKIPPED)$')"
expected="$(printf '%s\n' \
    '[step-time] Build (all workspaces) X' 'Build (all workspaces): PASS' \
    '[step-time] Lint (all) X' 'Lint (all): SKIPPED' \
    '[step-time] Playwright (desktop + mobile, scoped: 2 specs) X' \
    'Playwright (desktop + mobile, scoped: 2 specs): FAIL')"
actual="$(echo "$pairs" | sed -E 's/^(\[step-time\] .*) [0-9]+\.[0-9]$/\1 X/')"
if [ "$actual" = "$expected" ]; then
    pass
else
    fail "expected step-time/result pairs in order; got: $(echo "$actual" | tr '\n' '|')"
fi

echo ""
echo "[$CURRENT_TEST_FILE] passed=$TEST_PASS_COUNT failed=$TEST_FAIL_COUNT"
if [ "$TEST_FAIL_COUNT" -gt 0 ]; then
    printf '  - %s\n' "${TEST_FAIL_NAMES[@]}"
    exit 1
fi
exit 0
