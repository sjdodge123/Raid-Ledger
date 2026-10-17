#!/usr/bin/env bash
# ROK-1331 M5b — scripts/validate-ci.sh must:
#   1. Use `RL_TARGET=remote` (NOT the typo `runner`) to gate the jest --verbose path.
#   2. Pass `--verbose` to jest when RL_TARGET=remote.
#
# Per spec (updated 2026-05-20): the integration-tests step's
# RL_TARGET branch must read `remote`, not the historical `runner` typo
# from the spec's first draft. Grep-level assertions only — we don't
# actually drive jest here.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-integration.test.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/test_helpers.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VALIDATE_CI="$REPO_ROOT/scripts/validate-ci.sh"

validate_ci_exists() {
    assert_file_exists "$VALIDATE_CI" "scripts/validate-ci.sh must exist"
}

run_integration_uses_rl_target_remote() {
    # The run_integration_tests function MUST branch on RL_TARGET="remote" (the
    # corrected spec value), not the typo "runner". Grep the function body.
    if [[ ! -f "$VALIDATE_CI" ]]; then return 0; fi
    local func_body
    func_body="$(awk '/^run_integration_tests\(\) *\{/,/^\}/' "$VALIDATE_CI")"
    if [[ -z "$func_body" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: run_integration_tests function not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] run_integration_tests not found"
        return 0
    fi
    # Must contain a "remote" branch.
    if echo "$func_body" | grep -qE 'RL_TARGET[^=]*=[^=]*remote|"\$\{RL_TARGET:-local\}"[^=]*=[^"]*"remote"'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: run_integration_tests must branch on RL_TARGET=remote")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected RL_TARGET=remote branch in run_integration_tests"
        echo "  body:"
        echo "$func_body" | sed 's/^/    /'
    fi
    # Must NOT contain the typo "runner" comparison (it's a different value).
    if echo "$func_body" | grep -qE '"\$\{RL_TARGET:-local\}"[[:space:]]*=[[:space:]]*"runner"'; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: run_integration_tests still contains spec typo 'runner' branch")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] found typo: RL_TARGET=runner branch should be 'remote'"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
}

run_integration_passes_jest_verbose() {
    # When RL_TARGET=remote, jest must be invoked with --verbose. Grep for
    # "--verbose" inside run_integration_tests.
    if [[ ! -f "$VALIDATE_CI" ]]; then return 0; fi
    local func_body
    func_body="$(awk '/^run_integration_tests\(\) *\{/,/^\}/' "$VALIDATE_CI")"
    if echo "$func_body" | grep -q -- '--verbose'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: run_integration_tests must pass --verbose to jest on remote path")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected '--verbose' in run_integration_tests body"
    fi
}

run_test "validate_ci_exists" validate_ci_exists
run_test "run_integration_uses_rl_target_remote" run_integration_uses_rl_target_remote
run_test "run_integration_passes_jest_verbose" run_integration_passes_jest_verbose

print_test_summary
