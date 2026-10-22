#!/usr/bin/env bash
# slots-resize — the operator's flocked way to take a runner slot out of
# claims.json (README "Memory hardening" step 4) and to put it back.
# `claim` picks from the claims.json ROWS, and init-state never shrinks the
# file, so changing RUNNER_SLOTS alone leaves a stopped slot claimable.

set -uo pipefail

CURRENT_TEST_FILE="slots-resize.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

_seed4() {  # _seed4 <claimed-slot-or-0>
    export RL_CLAIMS_FILE="$RL_STATE_DIR/claims.json"
    jq -n --argjson c "$1" '[range(1;5) | {slot: ., claimed: (. == $c),
        agent_id: (if . == $c then "holder" else null end), branch: null,
        started_at: null, last_heartbeat: null}]' > "$RL_CLAIMS_FILE"
}

test_shrink_drops_slot_4() {
    CURRENT_TEST_NAME="S1: slots-resize 3 removes slot 4's row and keeps a claim on slot 1"
    _seed4 1
    local out; out=$(bash "$BIN_DIR/slots-resize" 3 2>&1)
    assert_eq "$(jq -c '[.[].slot]' "$RL_CLAIMS_FILE")" "[1,2,3]" "slot 4 is no longer claimable"
    assert_eq "$(jq -r '.[0].agent_id' "$RL_CLAIMS_FILE")" "holder" "existing claim on slot 1 untouched"
    assert_eq "$(echo "$out" | jq -c '.slots')" "[1,2,3]" "reports the new slot list"
}

test_shrink_refuses_claimed_slot() {
    CURRENT_TEST_NAME="S2: slots-resize 3 refuses while slot 4 is claimed and leaves the file untouched"
    _seed4 4
    local before; before=$(cat "$RL_CLAIMS_FILE")
    bash "$BIN_DIR/slots-resize" 3 >/dev/null 2>&1
    assert_eq "$?" "1" "exit 1 on a claimed slot"
    assert_eq "$(cat "$RL_CLAIMS_FILE")" "$before" "claims.json byte-identical"
}

test_shrink_refuses_queued_slot() {
    CURRENT_TEST_NAME="S3: slots-resize 3 refuses while slot 4 has a lease-queue waiter"
    _seed4 0
    mkdir -p "$RL_STATE_DIR/lease-queue"
    echo '[{"agent_id":"waiter"}]' > "$RL_STATE_DIR/lease-queue/4.json"
    bash "$BIN_DIR/slots-resize" 3 >/dev/null 2>&1
    assert_eq "$?" "1" "exit 1 on a queued slot"
    assert_eq "$(jq 'length' "$RL_CLAIMS_FILE")" "4" "slot 4 kept"
}

test_grow_restores_slot_4() {
    CURRENT_TEST_NAME="S4: slots-resize 4 after 3 adds an unclaimed slot 4; a repeat is a no-op"
    _seed4 2
    bash "$BIN_DIR/slots-resize" 3 >/dev/null 2>&1
    bash "$BIN_DIR/slots-resize" 4 >/dev/null 2>&1
    assert_eq "$(jq -c '[.[] | "\(.slot):\(.claimed)"]' "$RL_CLAIMS_FILE")" \
        '["1:false","2:true","3:false","4:false"]' "slot 4 back, unclaimed; slot 2's claim kept"
    bash "$BIN_DIR/slots-resize" 4 >/dev/null 2>&1
    assert_eq "$?" "0" "resizing to the current count succeeds"
}

run_test "s1-shrink" test_shrink_drops_slot_4
run_test "s2-claimed" test_shrink_refuses_claimed_slot
run_test "s3-queued" test_shrink_refuses_queued_slot
run_test "s4-grow" test_grow_restores_slot_4

print_test_summary
