#!/usr/bin/env bash
# _ensure_test_bot_deps builds the contract when its entry is missing.
#
# tools/test-bot imports @raid-ledger/contract, whose package main is
# dist/index.js. A fresh runner or worktree — or an --only-e2e run, which skips
# run_build — has no dist/, so the Discord smoke step and the render-rule
# self-test died at import. The helper now builds the contract after the
# test-bot install whenever dist/index.js is absent.
#
# Tested by extracting the helper from validate-ci.sh and sourcing it against a
# throwaway REPO_ROOT with a stub ensure-runner-deps.sh and a fake `npm` that
# logs its arguments, so nothing is installed or built for real.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-test-bot-deps-contract.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REAL_REPO_ROOT/scripts/validate-ci.sh"

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
assert_eq() {
    if [[ "$1" == "$2" ]]; then pass; else fail "$3 (expected '$2', got '$1')"; fi
}

FN_FILE=$(mktemp -t rl-test-bot-deps.XXXXXX)
sed -n '/^_ensure_test_bot_deps()/,/^}/p' "$VALIDATE_CI_PATH" > "$FN_FILE"
if [[ ! -s "$FN_FILE" ]]; then
    echo "FAIL [$CURRENT_TEST_FILE] _ensure_test_bot_deps() not found in validate-ci.sh"
    rm -f "$FN_FILE"
    exit 1
fi
# shellcheck disable=SC1090
source "$FN_FILE"
rm -f "$FN_FILE"
YELLOW=""
NC=""

SCRATCH="$(mktemp -d -t rl-test-bot-deps-root.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT
REPO_ROOT="$SCRATCH/repo"
NPM_LOG="$SCRATCH/npm.log"
mkdir -p "$REPO_ROOT/scripts/ci" "$REPO_ROOT/tools/test-bot" "$SCRATCH/bin"
# Stub installer: exit code chosen per case via STUB_DEPS_RC.
cat > "$REPO_ROOT/scripts/ci/ensure-runner-deps.sh" <<'EOF'
exit "${STUB_DEPS_RC:-0}"
EOF
# Fake npm: log the args, exit per FAKE_NPM_RC.
cat > "$SCRATCH/bin/npm" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$NPM_LOG"
exit "\${FAKE_NPM_RC:-0}"
EOF
chmod +x "$SCRATCH/bin/npm"
PATH="$SCRATCH/bin:$PATH"
export NPM_LOG

reset_case() {
    rm -rf "$REPO_ROOT/packages/contract/dist"
    : > "$NPM_LOG"
}
npm_log() { cat "$NPM_LOG"; }

CURRENT_TEST_NAME="dist/index.js missing → builds the contract and returns 0"
reset_case
STUB_DEPS_RC=0 FAKE_NPM_RC=0 _ensure_test_bot_deps >/dev/null 2>&1
rc=$?
log="$(npm_log)"
assert_eq "$rc" "0" "a successful contract build must leave the helper green"
if grep -q 'run build -w packages/contract' <<<"$log"; then pass; else
    fail "expected 'npm run build -w packages/contract' when dist/index.js is missing; npm log: '${log}'"
fi

CURRENT_TEST_NAME="npm ci fails, npm install fallback succeeds, dist missing → still builds"
reset_case
STUB_DEPS_RC=1 FAKE_NPM_RC=0 _ensure_test_bot_deps >/dev/null 2>&1
rc=$?
log="$(npm_log)"
assert_eq "$rc" "0" "the fallback path must succeed when install and build both succeed"
if grep -q '^install$' <<<"$log" && grep -q 'run build -w packages/contract' <<<"$log"; then pass; else
    fail "the npm install fallback must be followed by the contract build; npm log: '${log}'"
fi

CURRENT_TEST_NAME="dist/index.js present → no build"
reset_case
mkdir -p "$REPO_ROOT/packages/contract/dist"
touch "$REPO_ROOT/packages/contract/dist/index.js"
STUB_DEPS_RC=0 FAKE_NPM_RC=0 _ensure_test_bot_deps >/dev/null 2>&1
rc=$?
log="$(npm_log)"
assert_eq "$rc" "0" "a built contract needs nothing more"
assert_eq "$log" "" "no npm call is expected when deps and contract are both ready"

CURRENT_TEST_NAME="contract build fails → non-zero"
reset_case
STUB_DEPS_RC=0 FAKE_NPM_RC=1 _ensure_test_bot_deps >/dev/null 2>&1
rc=$?
if [[ "$rc" -ne 0 ]]; then pass; else
    fail "a failed contract build must fail the helper (got rc 0)"
fi

echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    printf '  - %s\n' "${TEST_FAIL_NAMES[@]}"
    exit 1
fi
