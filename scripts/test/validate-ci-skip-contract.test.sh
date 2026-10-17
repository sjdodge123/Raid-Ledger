#!/usr/bin/env bash
# validate-ci.sh `run_step` skip contract.
#
# REGRESSION GUARD. `run_step` used to read **exit code 2** as SKIPPED. That
# overloaded a code real tools return for real failures: `npm run build -w web`
# runs `tsc -b && vite build`, and `tsc -b` exits 2 on a type error. A branch
# that did not compile was therefore printed in full, recorded as
# `Build (all workspaces): SKIPPED`, and the run still ended on a green
# "All checks passed!" with exit 0 — a gate that waves through broken code.
#
# The contract now: a step declares "not applicable" EXPLICITLY via `skip_step`
# AND must exit cleanly. Intent and failure can no longer collide.
#
# These tests exercise the real `run_step` by sourcing validate-ci.sh under
# RL_VALIDATE_CI_DRY=1 (the existing harness guard), not a reimplementation.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-skip-contract.test.sh"
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

# --- Structural: the old sentinel must be gone -----------------------------

CURRENT_TEST_NAME="no bare 'return 2' skip sentinel remains"
if grep -nE '^\s*return 2\b' "$VALIDATE_CI_PATH" >/dev/null 2>&1; then
    fail "validate-ci.sh still uses 'return 2' as a skip signal; a tool exiting 2 (tsc -b on a type error) would be misread as SKIPPED"
else
    pass
fi

CURRENT_TEST_NAME="run_step no longer branches on exit code 2"
if grep -nE '"\$rc" -eq 2' "$VALIDATE_CI_PATH" >/dev/null 2>&1; then
    fail "run_step still maps exit code 2 to SKIPPED"
else
    pass
fi

CURRENT_TEST_NAME="skip_step helper is defined"
if grep -qE '^skip_step\(\)' "$VALIDATE_CI_PATH"; then
    pass
else
    fail "skip_step() is not defined in validate-ci.sh"
fi

# --- Behavioral: drive the real run_step ------------------------------------

# `run_step` calls `exit 1` on failure, so each case runs in a subshell and we
# read the printed status line rather than a return value.
run_case() {
    local fn_body="$1"
    (
        # shellcheck disable=SC1090
        RL_VALIDATE_CI_DRY=1 source "$VALIDATE_CI_PATH" >/dev/null 2>&1
        eval "probe_step() { $fn_body; }"
        run_step "Probe" probe_step 2>&1
    )
}

CURRENT_TEST_NAME="a step returning 2 WITHOUT declaring a skip is FAIL"
out="$(run_case 'return 2')"
if echo "$out" | grep -q "Probe: FAIL"; then
    pass
elif echo "$out" | grep -q "Probe: SKIPPED"; then
    fail "REGRESSION: exit code 2 was reported as SKIPPED — this is the exact bug (a broken 'tsc -b' build would pass the gate)"
else
    fail "expected FAIL, got: $(echo "$out" | tr '\n' ' ' | tail -c 200)"
fi

CURRENT_TEST_NAME="a step that declares a skip and exits cleanly is SKIPPED"
out="$(run_case 'skip_step; return 0')"
if echo "$out" | grep -q "Probe: SKIPPED"; then
    pass
else
    fail "expected SKIPPED, got: $(echo "$out" | tr '\n' ' ' | tail -c 200)"
fi

CURRENT_TEST_NAME="a plain successful step is PASS"
out="$(run_case 'return 0')"
if echo "$out" | grep -q "Probe: PASS"; then
    pass
else
    fail "expected PASS, got: $(echo "$out" | tr '\n' ' ' | tail -c 200)"
fi

CURRENT_TEST_NAME="a step that declares a skip but then FAILS is still FAIL"
out="$(run_case 'skip_step; return 1')"
if echo "$out" | grep -q "Probe: FAIL"; then
    pass
else
    fail "a declared skip must not mask a non-zero exit; got: $(echo "$out" | tr '\n' ' ' | tail -c 200)"
fi

CURRENT_TEST_NAME="a skip does not leak into the next step"
out="$(
    (
        # shellcheck disable=SC1090
        RL_VALIDATE_CI_DRY=1 source "$VALIDATE_CI_PATH" >/dev/null 2>&1
        skipper() { skip_step; return 0; }
        plain() { return 0; }
        run_step "First" skipper 2>&1
        run_step "Second" plain 2>&1
    )
)"
if echo "$out" | grep -q "Second: PASS"; then
    pass
else
    fail "STEP_SKIPPED leaked into the following step; got: $(echo "$out" | tr '\n' ' ' | tail -c 200)"
fi

# --- Summary ---------------------------------------------------------------

echo ""
echo "[$CURRENT_TEST_FILE] passed=$TEST_PASS_COUNT failed=$TEST_FAIL_COUNT"
if [ "$TEST_FAIL_COUNT" -gt 0 ]; then
    printf '  - %s\n' "${TEST_FAIL_NAMES[@]}"
    exit 1
fi
exit 0
