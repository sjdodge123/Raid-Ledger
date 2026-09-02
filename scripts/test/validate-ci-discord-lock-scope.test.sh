#!/usr/bin/env bash
# ROK-1469 D5 — the fleet-wide Discord lock is narrowed to shared-channel runs.
#
# The lock exists because every slot used to run smoke as the SAME Discord bot
# in the SAME channels: two concurrent runs fought over one gateway session.
# With per-slot bot identities (D1) and per-slot channel sets (D5) neither
# condition holds, and serializing costs ~3 min of wall clock per extra slot.
#
# The narrowing is deliberately keyed on SMOKE_CHANNEL_SET, not on "we're on
# the fleet": a run that has NOT been given a disjoint channel set still shares
# channels with its sibling and MUST still serialize. Absent variable → lock.
#
# Tested by extracting the decision function from validate-ci.sh and sourcing
# it, so no suite, docker or Discord connection is involved.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-discord-lock-scope.test.sh"
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

FN_FILE=$(mktemp -t rl-lock-scope.XXXXXX)
sed -n '/^_discord_lock_required()/,/^}/p' "$VALIDATE_CI_PATH" > "$FN_FILE"
if [[ ! -s "$FN_FILE" ]]; then
    echo "FAIL [$CURRENT_TEST_FILE] _discord_lock_required() not found in validate-ci.sh"
    rm -f "$FN_FILE"
    exit 1
fi
# shellcheck disable=SC1090
source "$FN_FILE"
rm -f "$FN_FILE"

CURRENT_TEST_NAME="no channel set → still serialize"
unset SMOKE_CHANNEL_SET
if _discord_lock_required; then pass; else fail "must take the lock when channels are shared"; fi

CURRENT_TEST_NAME="blank channel set → still serialize"
SMOKE_CHANNEL_SET="   " 
if _discord_lock_required; then pass; else fail "whitespace must not count as a channel set"; fi

CURRENT_TEST_NAME="per-slot channel set → no fleet lock"
SMOKE_CHANNEL_SET="slot-2"
if _discord_lock_required; then fail "a disjoint channel set must not serialize"; else pass; fi

CURRENT_TEST_NAME="explicit override forces the lock back on"
SMOKE_CHANNEL_SET="slot-2"
RL_DISCORD_LOCK_ALWAYS=1
if _discord_lock_required; then pass; else fail "RL_DISCORD_LOCK_ALWAYS=1 must re-arm serialization"; fi
unset RL_DISCORD_LOCK_ALWAYS SMOKE_CHANNEL_SET

CURRENT_TEST_NAME="smoke step consults the helper"
if grep -q '_discord_lock_required' "$VALIDATE_CI_PATH" \
   && [[ "$(grep -c '_discord_lock_required' "$VALIDATE_CI_PATH")" -ge 2 ]]; then
    pass
else
    fail "the Discord smoke step must call _discord_lock_required, not test the dir alone"
fi

echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    printf '  - %s\n' "${TEST_FAIL_NAMES[@]}"
    exit 1
fi
