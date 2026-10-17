#!/usr/bin/env bash
# A3-B P2 — rl-infra/cli/rl wiring for the post-sync exec-bit restore.
#
# The repair itself is specced in runner-exec-bits.test.sh. This file asserts it
# is actually WIRED at the one chokepoint both consumers already pass through
# (flush_mutagen, called by cmd_claim and cmd_validate_ci), so no caller needs
# the hand-rolled `chmod -R a+x` incantation.
#
#   W1 — flush_mutagen invokes the restore inside the runner, through
#        run-on-runner, with an EXPLICIT `bash` interpreter.
#   W2 — a failed restore makes flush_mutagen fail with a named error and the
#        reserved exit 97 — not a silent success.
#   W3 — cmd_validate_ci ABORTS before dispatching validate-ci.sh when the
#        restore failed. This is the wasted-run case: burning a 15-minute gate
#        on a tree whose scripts cannot execute is exactly what cost two runs.
#   W4 — cmd_claim WARNS but does not abort. A claimed-but-degraded slot must
#        still be releasable; aborting mid-claim would leak the slot.
#
# Technique: the functions under test are sliced out of cli/rl with awk and
# eval'd inside a generated driver alongside shims for ssh_run / mutagen. That
# is a real behavioural test of the shipped source — not a grep for a string.
# The driver sets `set -euo pipefail` to match cli/rl:13 so errexit semantics
# are faithful.

set -uo pipefail

CURRENT_TEST_FILE="cli-rl-exec-bits-wiring.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
RL_CLI="$WORKTREE_ROOT/rl-infra/cli/rl"

readonly EXPECTED_FATAL_CODE=97

# Slice one top-level function body out of cli/rl (opening line through the
# first column-0 closing brace).
slice_fn() {
    local fn="$1"
    awk -v fn="^${fn}\\\\(\\\\)" '$0 ~ fn {f=1} f {print} f && /^\}$/ {exit}' "$RL_CLI"
}

# Build a driver that eval's the sliced functions with shimmed dependencies.
# ssh_run logs its full argv to $ARGV_LOG and returns RESTORE_RC for the
# restore call specifically, 0 for everything else.
write_driver() {
    local driver="$1"; shift
    local entry="$1"; shift
    {
        echo 'set -euo pipefail'
        echo 'ssh_run() {'
        echo '  printf "%s\n" "$*" >> "$ARGV_LOG"'
        echo '  case "$*" in'
        echo '    *restore-exec-bits.sh*) return "${RESTORE_RC:-0}" ;;'
        echo '  esac'
        echo '  return 0'
        echo '}'
        echo 'mutagen() { return 0; }'
        echo 'require_repo_root() { :; }'
        echo 'ensure_claim() { :; }'
        echo 'current_slot() { echo 3; }'
        echo 'ensure_runner_git() { :; }'
        echo 'cmd_release() { :; }'
        echo 'start_heartbeat_daemon() { :; }'
        echo 'scaffold_runner_git() { :; }'
        echo 'install_runner_deps() { :; }'
        echo 'git() { echo main; }'
        echo 'TARGET=remote'
        echo 'REPO_ROOT=/tmp/fake-repo'
        local fn
        for fn in "$@"; do
            slice_fn "$fn"
            echo
        done
        echo "$entry"
    } > "$driver"
}

cli_present() {
    if [[ -f "$RL_CLI" ]]; then
        return 0
    fi
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: rl CLI missing")
    echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] rl CLI not found"
    echo "  expected: $RL_CLI"
    echo "  actual:   no such file"
    return 1
}

# W1 — flush_mutagen dispatches the restore into the runner, with `bash`.
test_w1_flush_invokes_restore_with_bash() {
    CURRENT_TEST_NAME="W1: flush_mutagen runs restore-exec-bits.sh in the runner via bash"
    cli_present || return 0
    local driver="$TMP_STATE/driver.sh"
    export ARGV_LOG="$TMP_STATE/argv.log"
    : > "$ARGV_LOG"
    write_driver "$driver" 'flush_mutagen 3' flush_mutagen restore_runner_exec_bits

    bash "$driver" >/dev/null 2>&1
    local log
    log=$(cat "$ARGV_LOG")

    assert_contains "$log" "restore-exec-bits.sh" \
        "flush_mutagen must dispatch the post-sync exec-bit restore; without it every caller is back to the chmod folklore"
    assert_contains "$log" "run-on-runner" \
        "the restore must go through run-on-runner (rl-agent is not in the docker group, so a raw ssh docker exec cannot work)"
    assert_contains "$log" "bash /workspace/rl-infra/runner/restore-exec-bits.sh" \
        "the restore must be invoked with an EXPLICIT bash interpreter — it is synced through the same 0644 path it repairs and cannot rely on its own exec bit"
}

# W2 — a failed restore is loud and non-zero, not swallowed.
test_w2_failed_restore_is_loud_and_nonzero() {
    CURRENT_TEST_NAME="W2: a failed restore makes flush_mutagen fail with a named error"
    cli_present || return 0
    local driver="$TMP_STATE/driver.sh"
    export ARGV_LOG="$TMP_STATE/argv.log"
    : > "$ARGV_LOG"
    write_driver "$driver" 'flush_mutagen 3' flush_mutagen restore_runner_exec_bits

    local out rc=0
    out=$(RESTORE_RC=$EXPECTED_FATAL_CODE bash "$driver" 2>&1) || rc=$?

    assert_exit_code "$rc" "$EXPECTED_FATAL_CODE" \
        "flush_mutagen must propagate the reserved 97 when the runner's scripts cannot be made executable"
    assert_neq "$rc" 0 \
        "a failed exec-bit restore must NOT report success — silent success is how a bare 126 later masqueraded as a test failure"
    assert_contains "$out" "exec-bit restore failed" \
        "the failure must be named in words, naming the phase that failed"
    assert_contains "$out" "slot 3" \
        "the error must name the slot so the operator knows which runner is degraded"
}

# W3 — cmd_validate_ci refuses to dispatch the gate on a degraded tree.
test_w3_validate_ci_aborts_before_dispatch() {
    CURRENT_TEST_NAME="W3: cmd_validate_ci aborts before dispatching the gate when the restore failed"
    cli_present || return 0
    local driver="$TMP_STATE/driver.sh"
    export ARGV_LOG="$TMP_STATE/argv.log"
    : > "$ARGV_LOG"
    write_driver "$driver" 'cmd_validate_ci --static' \
        cmd_validate_ci flush_mutagen restore_runner_exec_bits

    local out rc=0
    out=$(RESTORE_RC=$EXPECTED_FATAL_CODE bash "$driver" 2>&1) || rc=$?
    local log
    log=$(cat "$ARGV_LOG")

    assert_neq "$rc" 0 \
        "validate-ci must not exit 0 when the runner's scripts are not executable"
    if [[ "$log" != *"validate-ci.sh"* ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: gate dispatched anyway")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] the gate was dispatched onto a tree whose scripts are not executable — this is the wasted run the fix exists to prevent"
        echo "  expected: no validate-ci.sh dispatch after a failed exec-bit restore"
        echo "  actual:   $log"
    fi
    assert_contains "$out" "exec-bit restore failed" \
        "the abort must explain itself as an environment problem, not leave the agent reading a bare 126"
}

# W4 — cmd_claim stays non-fatal (loud, but the slot remains claimed).
test_w4_claim_warns_but_does_not_abort() {
    CURRENT_TEST_NAME="W4: cmd_claim tolerates a failed restore rather than leaking a half-claimed slot"
    cli_present || return 0
    local body
    body=$(slice_fn cmd_claim)
    if [[ -z "$body" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: cmd_claim slice empty")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] could not slice cmd_claim out of $RL_CLI"
        echo "  expected: a cmd_claim() body; actual: empty"
        return
    fi
    # Under `set -e`, a bare `flush_mutagen "$SLOT"` inside cmd_claim would
    # abort the claim on a restore failure and leak the slot. It must carry an
    # explicit non-fatal handler.
    local call
    call=$(grep -nE '^[[:space:]]*flush_mutagen "\$SLOT"' <<<"$body" || true)
    if [[ "$call" == *"||"* ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: unguarded flush_mutagen in cmd_claim")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] cmd_claim calls flush_mutagen without a non-fatal handler; under set -e a failed exec-bit restore would abort the claim and leak the slot"
        echo "  expected: 'flush_mutagen \"\$SLOT\" || <warn>'"
        echo "  actual:   ${call:-<no flush_mutagen call found>}"
    fi
}

run_test "W1 flush dispatches restore"  test_w1_flush_invokes_restore_with_bash
run_test "W2 failed restore is loud"    test_w2_failed_restore_is_loud_and_nonzero
run_test "W3 validate-ci aborts"        test_w3_validate_ci_aborts_before_dispatch
run_test "W4 claim non-fatal"           test_w4_claim_warns_but_does_not_abort

print_test_summary
