#!/usr/bin/env bash
# ROK-1331 M6b MED-5 — validate-ci.sh `run_unit_tests` vitest fallback chain.
#
# When RL_TARGET=remote, the run_unit_tests step must implement a 3-step
# fallback chain (slot-2 retry → mutagen recursive `**/coverage/**` ignore →
# `--pool=forks --poolOptions.forks.singleFork=true`). If ALL THREE fail the
# script MUST exit with an explicit "PAUSED awaiting operator approval"
# status — NEVER silently degrade to a no-coverage run.
#
# Today validate-ci.sh:275-278 runs `npx vitest run --coverage` unconditionally
# with no remote-aware fallback. These tests assert the NEW shape.
#
# Strategy (structural + behavioral):
#   - Structural: grep the validate-ci.sh source for the new markers (chain
#     step constants, PAUSED message, --pool=forks invocation). Cheap, no
#     forks, robust against future env-quirks.
#   - Behavioral (when guard is present): source the script with
#     RL_VALIDATE_CI_DRY=1 so `main` short-circuits, then invoke
#     `run_unit_tests` directly against stubbed npm/npx. If the guard is
#     absent (today's red state), the behavioral block is SKIPPED and the
#     structural assertions ensure the test still fails red.
#
# These tests MUST fail today — neither the chain logic nor the dry-run
# guard exists.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-vitest-fallback.test.sh"
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

assert_grep() {
    local pattern="$1" file="$2" message="${3:-}"
    if grep -E -q -- "$pattern" "$file"; then
        pass
    else
        fail "$message (pattern not found in $file: $pattern)"
    fi
}

assert_not_grep() {
    local pattern="$1" file="$2" message="${3:-}"
    if grep -E -q -- "$pattern" "$file"; then
        fail "$message (pattern UNEXPECTEDLY present in $file: $pattern)"
    else
        pass
    fi
}

# Build stub bin dir for behavioral block (used only when DRY guard exists).
make_stub_bin() {
    local stub_dir
    stub_dir=$(mktemp -d -t rl-vitest-stub.XXXXXX)
    cat >"$stub_dir/npm" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"test:cov -w api"* ]]; then exit 0; fi
exit "${STUB_NPM_EXIT:-0}"
EOF
    cat >"$stub_dir/npx" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" != "vitest" ]]; then exit 0; fi
ATTEMPT=1
if [[ -n "${STUB_ATTEMPT_FILE:-}" && -f "${STUB_ATTEMPT_FILE:-}" ]]; then
    ATTEMPT=$(<"$STUB_ATTEMPT_FILE")
    ATTEMPT=$((ATTEMPT + 1))
fi
if [[ -n "${STUB_ATTEMPT_FILE:-}" ]]; then echo "$ATTEMPT" >"$STUB_ATTEMPT_FILE"; fi
if [[ -n "${STUB_ARGV_FILE:-}" ]]; then echo "ATTEMPT=$ATTEMPT ARGS=$*" >>"$STUB_ARGV_FILE"; fi
PASS_ON="${STUB_VITEST_PASS_ON:-99}"
if (( ATTEMPT >= PASS_ON )); then exit 0; fi
echo "stub-vitest: simulated coverage race failure on attempt $ATTEMPT" >&2
exit 1
EOF
    cat >"$stub_dir/mutagen" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$stub_dir/npm" "$stub_dir/npx" "$stub_dir/mutagen"
    echo "$stub_dir"
}

# Whether the dry-run guard is present (gates the behavioral block).
dry_run_guard_present() {
    grep -E -q 'RL_VALIDATE_CI_DRY' "$VALIDATE_CI_PATH"
}

# ===== Structural assertions =====
# These must hold AFTER the dev agent lands the fallback chain.

# AC-M6b-6: dry-run guard exists so tests can source the script.
CURRENT_TEST_NAME="AC-M6b-6: dry-run guard for sourceable tests"
assert_grep 'RL_VALIDATE_CI_DRY' "$VALIDATE_CI_PATH" "validate-ci.sh must add RL_VALIDATE_CI_DRY guard so run_unit_tests can be tested via source"

# AC-M6b-7: run_unit_tests must branch on RL_TARGET.
CURRENT_TEST_NAME="AC-M6b-7: run_unit_tests branches on RL_TARGET"
assert_grep 'RL_TARGET' "$VALIDATE_CI_PATH" "run_unit_tests must reference RL_TARGET to decide fallback"

# AC-M6b-8: step (c) — --pool=forks --poolOptions.forks.singleFork=true gated on remote.
CURRENT_TEST_NAME="AC-M6b-8: step (c) single-fork pool gated on remote"
assert_grep '--pool=forks' "$VALIDATE_CI_PATH" "run_unit_tests must invoke vitest with --pool=forks in the remote fallback"
assert_grep 'singleFork' "$VALIDATE_CI_PATH" "run_unit_tests must set poolOptions.forks.singleFork=true"

# AC-M6b-9: step (b) — recursive **/coverage/** mutagen ignore.
CURRENT_TEST_NAME="AC-M6b-9: step (b) mutagen recursive coverage ignore"
# The pattern lives EITHER in validate-ci.sh OR in a sync-template config
# under rl-infra/mutagen/. Probe both locations.
mutagen_pattern_found=0
if grep -E -q '\*\*/coverage/\*\*' "$VALIDATE_CI_PATH"; then mutagen_pattern_found=1; fi
if [[ -d "$REPO_ROOT/rl-infra/mutagen" ]]; then
    if grep -E -r -q '\*\*/coverage/\*\*' "$REPO_ROOT/rl-infra/mutagen"; then mutagen_pattern_found=1; fi
fi
# Also check rl-infra/cli/rl in case the inline ignore-list lives there.
if grep -E -q '\*\*/coverage/\*\*' "$REPO_ROOT/rl-infra/cli/rl" 2>/dev/null; then mutagen_pattern_found=1; fi
if (( mutagen_pattern_found == 1 )); then
    pass
else
    fail "expected recursive '**/coverage/**' ignore pattern in validate-ci.sh, rl-infra/mutagen/**, or rl-infra/cli/rl"
fi

# AC-M6b-10: PAUSED + operator marker on full-chain failure.
CURRENT_TEST_NAME="AC-M6b-10: PAUSED operator-approval marker on full-chain failure"
assert_grep 'PAUSED' "$VALIDATE_CI_PATH" "run_unit_tests must emit 'PAUSED' when all chain steps fail"
assert_grep 'operator' "$VALIDATE_CI_PATH" "PAUSED message must mention operator approval"

# AC-M6b-11: never silently drop --coverage in the remote fallback.
# Today's source has exactly ONE `vitest run --coverage`. After the chain
# lands, every leg must keep --coverage. We assert no `vitest run` invocation
# omits --coverage AND no `--coverage --no-coverage`-style downgrade exists.
CURRENT_TEST_NAME="AC-M6b-11: no silent no-coverage fallback"
assert_not_grep 'vitest run[^\n]*--no-coverage' "$VALIDATE_CI_PATH" "must not have a --no-coverage variant"
# Every `vitest run` line should still mention --coverage somewhere on that line.
# Use awk to find any `vitest run` line missing --coverage.
bad_lines=$(awk '/npx vitest run/ && !/--coverage/' "$VALIDATE_CI_PATH" || true)
if [[ -n "$bad_lines" ]]; then
    fail "found 'vitest run' invocation without --coverage: $bad_lines"
else
    pass
fi

# ===== Behavioral assertions (skipped if guard absent) =====
# These execute run_unit_tests in a controlled subshell with stubbed
# npm/npx/mutagen. Skipped when the dry-run guard is missing (today's red
# state) — the structural assertions above already ensure failure.

if ! dry_run_guard_present; then
    echo "[SKIP behavioral block — RL_VALIDATE_CI_DRY guard missing; structural assertions above carry the red signal]"
else
    # Behavioral: source script then invoke run_unit_tests with controlled env.
    stub_bin=$(make_stub_bin)
    attempt_file=$(mktemp -t rl-vitest-attempts.XXXXXX)
    argv_file=$(mktemp -t rl-vitest-argv.XXXXXX)

    CURRENT_TEST_NAME="AC-M6b-12: behavioral first-attempt-pass — no fallback applied"
    : >"$attempt_file" : >"$argv_file"
    out=$(
        # shellcheck disable=SC1090
        RL_VALIDATE_CI_DRY=1 source "$VALIDATE_CI_PATH" 2>/dev/null
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        STUB_ATTEMPT_FILE="$attempt_file" \
        STUB_ARGV_FILE="$argv_file" \
        STUB_VITEST_PASS_ON=1 \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; run_unit_tests" 2>&1
    )
    exit_code=$?
    if [[ "$exit_code" == "0" ]]; then pass; else fail "first-attempt-pass should exit 0, got $exit_code"; fi
    if ! grep -E -q -- '--pool=forks' "$argv_file"; then pass; else fail "should NOT apply --pool=forks when first attempt passes"; fi

    CURRENT_TEST_NAME="AC-M6b-13: behavioral all-three-fail PAUSES non-zero"
    : >"$attempt_file" : >"$argv_file"
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        STUB_ATTEMPT_FILE="$attempt_file" \
        STUB_ARGV_FILE="$argv_file" \
        STUB_VITEST_PASS_ON=99 \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; run_unit_tests" 2>&1
    )
    exit_code=$?
    if [[ "$exit_code" != "0" ]]; then pass; else fail "all-three-fail must exit non-zero (no silent degradation)"; fi
    if grep -E -q 'PAUSED' <<<"$out"; then pass; else fail "all-three-fail output must contain 'PAUSED'"; fi
    if grep -E -q 'operator' <<<"$out"; then pass; else fail "all-three-fail output must mention 'operator'"; fi

    CURRENT_TEST_NAME="AC-M6b-14: behavioral RL_TARGET=local skips fallback chain"
    : >"$attempt_file" : >"$argv_file"
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="local" \
        STUB_ATTEMPT_FILE="$attempt_file" \
        STUB_ARGV_FILE="$argv_file" \
        STUB_VITEST_PASS_ON=1 \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; run_unit_tests" 2>&1
    )
    exit_code=$?
    if [[ "$exit_code" == "0" ]]; then pass; else fail "RL_TARGET=local should exit 0 on clean vitest"; fi
    if ! grep -E -q -- '--pool=forks' "$argv_file"; then pass; else fail "RL_TARGET=local must not apply --pool=forks penalty"; fi

    rm -rf "$stub_bin" "$attempt_file" "$argv_file"
fi

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do
        echo "  - $f"
    done
    exit 1
fi
exit 0
