#!/usr/bin/env bash
# ROK-1509 — the fleet e2e path exports SMOKE_CHANNEL_SET=slot-N so companion
# smoke discovers the slot's own channels.
#
# ROK-1469 gave each fleet slot its own channel set (slot-N-fleet / slot-N-alt /
# slot-N-voice) and taught tools/test-bot to narrow discovery when
# SMOKE_CHANNEL_SET is set — but nothing on the validate-ci path ever exported
# it, so a slot's smoke discovered the whole guild (incl. orphaned ephemeral
# voice channels; fleet task 2a94d5bc2d24 resolved its default channel to a
# leftover ⏰ channel and failed 19/124).
#
# smoke_channel_set_for_slot is the pure decision: "slot-${RL_SLOT}" when
# inside a fleet runner (same predicate as the Redis sidecar: /workspace mount
# OR RL_TARGET=remote) with a numeric RL_SLOT and no pre-set value; the pre-set
# value when SMOKE_CHANNEL_SET is already configured; empty otherwise. Tested
# by extracting the function from validate-ci.sh and sourcing it, so no suite,
# docker or Discord connection is involved.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-smoke-channel-set.test.sh"
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
    local actual="$1" expected="$2" message="$3"
    if [[ "$actual" == "$expected" ]]; then pass; else
        fail "$message"
        echo "  expected: '$expected'"
        echo "  actual:   '$actual'"
    fi
}

FN_FILE=$(mktemp -t rl-smoke-channel-set.XXXXXX)
sed -n '/^smoke_channel_set_for_slot()/,/^}/p' "$VALIDATE_CI_PATH" > "$FN_FILE"
if [[ ! -s "$FN_FILE" ]]; then
    echo "FAIL [$CURRENT_TEST_FILE] smoke_channel_set_for_slot() not found in validate-ci.sh"
    rm -f "$FN_FILE"
    exit 1
fi
# shellcheck disable=SC1090
source "$FN_FILE"
rm -f "$FN_FILE"

# The /workspace half of the inside-runner predicate cannot be faked on a
# laptop (root-owned mount point), so these cases drive the RL_TARGET=remote
# half. The two are OR'd in the predicate, exactly as for the Redis sidecar.
unset SMOKE_CHANNEL_SET RL_SLOT RL_TARGET

CURRENT_TEST_NAME="RL_SLOT=3 inside runner → slot-3"
out="$(RL_TARGET=remote RL_SLOT=3 smoke_channel_set_for_slot)"
assert_eq "$out" "slot-3" "a fleet runner on slot 3 must narrow smoke to the slot-3-* channels"

CURRENT_TEST_NAME="RL_SLOT unset → empty"
out="$(RL_TARGET=remote smoke_channel_set_for_slot)"
assert_eq "$out" "" "no slot number means no channel set to derive"

CURRENT_TEST_NAME="pre-set SMOKE_CHANNEL_SET=custom respected"
out="$(RL_TARGET=remote RL_SLOT=3 SMOKE_CHANNEL_SET=custom smoke_channel_set_for_slot)"
assert_eq "$out" "custom" "an operator-configured channel set must win over the slot default"

CURRENT_TEST_NAME="blank pre-set value is not a channel set"
out="$(RL_TARGET=remote RL_SLOT=3 SMOKE_CHANNEL_SET='   ' smoke_channel_set_for_slot)"
assert_eq "$out" "slot-3" "whitespace SMOKE_CHANNEL_SET must fall through to the slot default"

CURRENT_TEST_NAME="non-numeric RL_SLOT → empty, no crash"
out="$(RL_TARGET=remote RL_SLOT=foo smoke_channel_set_for_slot 2>/dev/null)"
rc=$?
assert_eq "$rc" "0" "a non-numeric RL_SLOT must not abort the smoke step"
assert_eq "$out" "" "a non-numeric RL_SLOT must not produce a slot-foo channel set"

if [[ ! -d /workspace ]]; then
    CURRENT_TEST_NAME="laptop (no /workspace, RL_TARGET=local) → empty even with RL_SLOT"
    out="$(RL_TARGET=local RL_SLOT=3 smoke_channel_set_for_slot)"
    assert_eq "$out" "" "local runs must keep whole-guild discovery"
fi

CURRENT_TEST_NAME="smoke step exports the set before the lock decision"
smoke_body="$(sed -n '/^run_discord_smoke()/,/^}/p' "$VALIDATE_CI_PATH")"
export_line="$(grep -n '_export_smoke_channel_set' <<<"$smoke_body" | head -1 | cut -d: -f1)"
lock_line="$(grep -n '_discord_lock_required' <<<"$smoke_body" | head -1 | cut -d: -f1)"
if [[ -n "$export_line" && -n "$lock_line" && "$export_line" -lt "$lock_line" ]]; then pass; else
    fail "run_discord_smoke must call _export_smoke_channel_set (line ${export_line:-none}) before _discord_lock_required (line ${lock_line:-none})"
fi

CURRENT_TEST_NAME="exporter sets SMOKE_CHANNEL_SET in the environment"
if grep -q 'export SMOKE_CHANNEL_SET=' "$VALIDATE_CI_PATH"; then pass; else
    fail "validate-ci.sh must export SMOKE_CHANNEL_SET so npm run smoke inherits it"
fi

echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    printf '  - %s\n' "${TEST_FAIL_NAMES[@]}"
    exit 1
fi
