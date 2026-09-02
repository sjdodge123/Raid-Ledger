#!/usr/bin/env bash
# ROK-1469 D6 — `rl settings push` argument/precondition contract.
#
# The push is the operator-side half of the laptop-independence fix: it
# encrypts the shared API keys into /srv/rl-infra/settings/bundle.enc so
# env-spin can seed them without the laptop DB. These assertions cover the
# guards that run BEFORE any docker/ssh work, so the suite needs neither.
#
# Why guards matter here: pushing without RL_SETTINGS_BUNDLE_KEY would either
# write an unencrypted bundle or one the VM cannot decrypt — both silently
# produce keyless envs later, far from the cause.

set -uo pipefail

CURRENT_TEST_FILE="cli-settings-push.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RL_CLI="$(cd "$TEST_DIR/../../cli" && pwd)/rl"

PASS=0; FAIL=0; FAILED=()
check() {
    if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); else
        FAIL=$((FAIL+1)); FAILED+=("$1"); echo "FAIL [$CURRENT_TEST_FILE] $1"
        echo "  expected: $3"; echo "  actual:   $2"
    fi
}
contains() {
    if [[ "$2" == *"$3"* ]]; then PASS=$((PASS+1)); else
        FAIL=$((FAIL+1)); FAILED+=("$1"); echo "FAIL [$CURRENT_TEST_FILE] $1"
        echo "  expected to contain: $3"; echo "  actual: $2"
    fi
}

export RL_TARGET=remote   # never probe SSH from a unit test

OUT=$(RL_SETTINGS_BUNDLE_KEY= "$RL_CLI" settings 2>&1); RC=$?
check "bare 'settings' exits 2" "$RC" "2"
contains "bare 'settings' prints usage" "$OUT" "settings push"

OUT=$(RL_SETTINGS_BUNDLE_KEY= "$RL_CLI" settings bogus 2>&1); RC=$?
check "unknown subcommand exits 2" "$RC" "2"

OUT=$(RL_SETTINGS_BUNDLE_KEY= LOCAL_JWT_SECRET=x "$RL_CLI" settings push 2>&1); RC=$?
check "push without a bundle key exits 2" "$RC" "2"
contains "the error names RL_SETTINGS_BUNDLE_KEY" "$OUT" "RL_SETTINGS_BUNDLE_KEY"

echo "--- $CURRENT_TEST_FILE: $PASS pass, $FAIL fail ---"
if (( FAIL > 0 )); then printf '  - %s\n' "${FAILED[@]}"; exit 1; fi
