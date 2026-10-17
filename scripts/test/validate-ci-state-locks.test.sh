#!/usr/bin/env bash
# The Discord smoke step fails loud when a fleet runner lacks /state-locks.
#
# run_discord_smoke used to infer "unsynchronized is fine" from a missing lock
# directory. On a runner shipped without the bind mount that meant smoke ran
# against a shared bot token with no serialization and still reported success.
# _check_state_locks_mount delegates to rl-infra/runner/check-state-locks.sh
# (exit 98 on a runner without the mount) but only on a runner — decided by
# the same /workspace-or-RL_TARGET=remote predicate smoke_channel_set_for_slot
# uses — so a laptop that happens to export RL_SLOT is not broken.
#
# Tested by extracting the helper from validate-ci.sh and sourcing it, so no
# suite, docker or Discord connection is involved.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-state-locks.test.sh"
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
assert_eq() {
    if [[ "$1" == "$2" ]]; then pass; else fail "$3 (expected '$2', got '$1')"; fi
}

FN_FILE=$(mktemp -t rl-state-locks.XXXXXX)
sed -n '/^_check_state_locks_mount()/,/^}/p' "$VALIDATE_CI_PATH" > "$FN_FILE"
if [[ ! -s "$FN_FILE" ]]; then
    echo "FAIL [$CURRENT_TEST_FILE] _check_state_locks_mount() not found in validate-ci.sh"
    rm -f "$FN_FILE"
    exit 1
fi
# shellcheck disable=SC1090
source "$FN_FILE"
rm -f "$FN_FILE"

SCRATCH="$(mktemp -d -t rl-state-locks-dir.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT
MISSING_DIR="$SCRATCH/not-mounted"
WRITABLE_DIR="$SCRATCH/mounted"
mkdir -p "$WRITABLE_DIR"

CURRENT_TEST_NAME="runner (RL_TARGET=remote, RL_SLOT=2) without the mount → exit 98"
out="$(RL_TARGET=remote RL_SLOT=2 _check_state_locks_mount "$MISSING_DIR" 2>&1)"
rc=$?
assert_eq "$rc" "98" "a runner missing /state-locks must fail with the reserved exit code"
if grep -q 'FATAL slot 2' <<<"$out"; then pass; else
    fail "the failure must name the slot in a FATAL line; got: $out"
fi

CURRENT_TEST_NAME="runner (RL_TARGET=remote, RL_SLOT=2) with a writable mount → 0"
out="$(RL_TARGET=remote RL_SLOT=2 _check_state_locks_mount "$WRITABLE_DIR" 2>&1)"
rc=$?
assert_eq "$rc" "0" "a mounted, writable lock dir must pass; output: $out"

CURRENT_TEST_NAME="RL_TARGET=remote with RL_SLOT unset → 0 (not a fleet runner)"
out="$(unset RL_SLOT; RL_TARGET=remote _check_state_locks_mount "$MISSING_DIR" 2>&1)"
rc=$?
assert_eq "$rc" "0" "without RL_SLOT the missing dir is by design; output: $out"

if [[ ! -d /workspace ]]; then
    CURRENT_TEST_NAME="laptop (no /workspace, RL_TARGET=local, RL_SLOT=3) → 0, check skipped"
    out="$(RL_TARGET=local RL_SLOT=3 _check_state_locks_mount "$MISSING_DIR" 2>&1)"
    rc=$?
    assert_eq "$rc" "0" "a laptop exporting RL_SLOT must not fail smoke"
    assert_eq "$out" "" "the laptop path must not even invoke check-state-locks.sh"
fi

CURRENT_TEST_NAME="smoke step checks the mount after exporting the set, before the lock test"
smoke_body="$(sed -n '/^run_discord_smoke()/,/^}/p' "$VALIDATE_CI_PATH")"
export_line="$(grep -n '_export_smoke_channel_set' <<<"$smoke_body" | head -1 | cut -d: -f1)"
check_line="$(grep -n '_check_state_locks_mount ' <<<"$smoke_body" | head -1 | cut -d: -f1)"
dir_line="$(grep -n 'if \[\[ -d "\$lock_dir" \]\]' <<<"$smoke_body" | head -1 | cut -d: -f1)"
if [[ -n "$export_line" && -n "$check_line" && -n "$dir_line" \
      && "$export_line" -lt "$check_line" && "$check_line" -lt "$dir_line" ]]; then
    pass
else
    fail "run_discord_smoke must order _export_smoke_channel_set (line ${export_line:-none}) < _check_state_locks_mount (line ${check_line:-none}) < the lock-dir test (line ${dir_line:-none})"
fi

CURRENT_TEST_NAME="smoke step aborts when the mount check fails"
if grep -q '_check_state_locks_mount "\$lock_dir" || return 1' <<<"$smoke_body"; then pass; else
    fail "run_discord_smoke must return non-zero when _check_state_locks_mount fails"
fi

echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    printf '  - %s\n' "${TEST_FAIL_NAMES[@]}"
    exit 1
fi
