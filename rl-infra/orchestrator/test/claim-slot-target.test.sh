#!/usr/bin/env bash
# claim --slot targeting (2026-06-02).
#
# The default slot picker takes the LOWEST free slot, which silently
# branch-mismatch-destroys any preserved env parked on a lower-numbered slot
# (the rok-1208 hazard surfaced during the stale-build sync-guard verification).
# `--slot N` pins the claim to exactly one slot so a caller can leave such an
# env alone: the claim only ever lands on (or enqueues for) slot N, never another.
#
# Fleet is 2 slots in test (RUNNER_SLOTS defaults to 2 via _state.sh).

set -uo pipefail

CURRENT_TEST_FILE="claim-slot-target.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Prime claims.json with an explicit per-slot claimed state. Pass "free"/"busy"
# for slot 1 then slot 2. A "busy" slot is held by a placeholder other-agent so
# the calling agent can never grab it.
_seed_claims() {
    local s1="$1" s2="$2"
    local claims="$RL_STATE_DIR/claims.json"
    local t; t="$(date -u +%FT%TZ)"
    jq -n --arg t "$t" --arg s1 "$s1" --arg s2 "$s2" '
        def row($slot; $state):
            if $state == "busy"
            then {slot:$slot, claimed:true, agent_id:"holder-\($slot)", branch:"feat-\($slot)", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0}
            else {slot:$slot, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false, expires_at:null, extends_count:0}
            end;
        [row(1; $s1), row(2; $s2)]
    ' > "$claims"
}

_slot_claimed() {
    # echo true/false for whether claims.json[slot N] is claimed.
    local n="$1"
    jq -r --argjson n "$n" '.[] | select(.slot==$n) | .claimed' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "parse_err"
}

# --slot 2 on a fully-free fleet grants slot 2, NOT the lowest free slot (1).
test_slot_targets_requested_free_slot() {
    CURRENT_TEST_NAME="--slot 2 grants slot 2 on a free fleet (not lowest slot 1)"
    _seed_claims free free
    export RL_AGENT_ID="targeter-1"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch feat-target --slot 2 2>&1) || exit_code=$?

    assert_exit_code "$exit_code" "0" "claim --slot 2 against a free slot must succeed"
    local slot
    slot=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$slot" "2" "claim must grant the REQUESTED slot 2, not lowest-free slot 1"
    assert_eq "$(_slot_claimed 1)" "false" "slot 1 must remain free (claim never touched it)"
    assert_eq "$(_slot_claimed 2)" "true" "slot 2 must be claimed"
}

# --slot 2 when slot 2 is busy but slot 1 is free ENQUEUES on slot 2 — it must
# NOT fall back to grabbing the free slot 1 (that's the whole point: leave slot 1).
test_slot_enqueues_on_requested_when_busy_not_other_free() {
    CURRENT_TEST_NAME="--slot 2 (busy) enqueues on slot 2, does NOT grab free slot 1"
    _seed_claims free busy
    export RL_AGENT_ID="targeter-2"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch feat-wait --slot 2 2>&1) || exit_code=$?

    assert_exit_code "$exit_code" "0" "claim --slot on a busy slot must enqueue (exit 0), not error"
    local enqueued enqueued_slot granted
    enqueued=$(echo "$out" | jq -r '.enqueued // false' 2>/dev/null || echo "parse_err")
    enqueued_slot=$(echo "$out" | jq -r '.enqueued_slot // empty' 2>/dev/null || echo "parse_err")
    granted=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "parse_err")

    assert_eq "$enqueued" "true" "response must be enqueued, not a grant"
    assert_eq "$enqueued_slot" "2" "must enqueue on the REQUESTED slot 2"
    assert_eq "$granted" "" "must NOT have granted any slot (esp. not free slot 1)"
    assert_eq "$(_slot_claimed 1)" "false" "free slot 1 must stay untouched"
}

# An out-of-range --slot fails loud (exit 2, error:invalid_slot) rather than
# silently enqueueing on a slot that doesn't exist.
test_slot_out_of_range_errors() {
    CURRENT_TEST_NAME="--slot 9 (>RUNNER_SLOTS) errors with invalid_slot, exit 2"
    _seed_claims free free
    export RL_AGENT_ID="targeter-3"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch feat-bad --slot 9 2>&1) || exit_code=$?

    assert_exit_code "$exit_code" "2" "out-of-range --slot must exit 2"
    local err
    err=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$err" "invalid_slot" "error code must be invalid_slot"
    # Nothing was claimed.
    assert_eq "$(_slot_claimed 1)" "false" "no slot may be claimed on a rejected request"
}

# A non-numeric --slot is rejected before the range check.
test_slot_non_numeric_errors() {
    CURRENT_TEST_NAME="--slot abc (non-numeric) errors with invalid_slot, exit 2"
    _seed_claims free free
    export RL_AGENT_ID="targeter-4"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch feat-bad --slot abc 2>&1) || exit_code=$?

    assert_exit_code "$exit_code" "2" "non-numeric --slot must exit 2"
    local err
    err=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$err" "invalid_slot" "error code must be invalid_slot"
}

# Regression guard: WITHOUT --slot, the picker still takes the lowest free slot.
test_no_slot_keeps_lowest_first() {
    CURRENT_TEST_NAME="no --slot still grants lowest free slot (1) — unchanged default"
    _seed_claims free free
    export RL_AGENT_ID="targeter-5"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch feat-default 2>&1) || exit_code=$?

    assert_exit_code "$exit_code" "0" "default claim must succeed on a free fleet"
    local slot
    slot=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$slot" "1" "default (no --slot) must still grant lowest-free slot 1"
}

# A VALID zero-padded slot (e.g. 02) must normalize to the canonical form and
# grant that slot — not skip it as "02" != "2" and fall through (Codex P2).
test_slot_zero_padded_grants() {
    CURRENT_TEST_NAME="--slot 02 (valid, zero-padded) normalizes and grants slot 2"
    _seed_claims free free
    export RL_AGENT_ID="zp-grant"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch feat-zp --slot 02 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "valid zero-padded --slot must succeed"
    local slot
    slot=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$slot" "2" "--slot 02 must normalize to and grant slot 2"
}

# A zero-padded enqueue must land in the CANONICAL lease-queue/2.json (which
# releases advance), never lease-queue/02.json (which would strand the waiter).
test_slot_zero_padded_enqueues_canonical() {
    CURRENT_TEST_NAME="--slot 02 (busy) enqueues on canonical lease-queue/2.json, not 02.json"
    _seed_claims free busy
    export RL_AGENT_ID="zp-enq"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch feat-zp2 --slot 02 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "zero-padded --slot on a busy slot must enqueue"
    local enqueued_slot
    enqueued_slot=$(echo "$out" | jq -r '.enqueued_slot // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$enqueued_slot" "2" "enqueued_slot must be canonical 2, not 02"
    assert_file_exists "$RL_STATE_DIR/lease-queue/2.json" "canonical lease-queue/2.json must be written"
    assert_file_not_exists "$RL_STATE_DIR/lease-queue/02.json" "no noncanonical lease-queue/02.json may be created"
}

# claim-wait must FORWARD --slot: a pinned single-shot grant on a free fleet
# must land on the requested slot, not the lowest free one (Codex P1).
test_claim_wait_forwards_slot_grant() {
    CURRENT_TEST_NAME="claim-wait --slot 2 grants slot 2 on a free fleet (forwards the pin)"
    _seed_claims free free
    export RL_AGENT_ID="cw-grant"
    local out exit_code=0
    out=$("$BIN_DIR/claim-wait" --slot 2 --branch feat-cw --timeout 5 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "claim-wait --slot on a free fleet grants immediately"
    local slot
    slot=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$slot" "2" "claim-wait must forward --slot and grant slot 2 (not lowest)"
}

# claim-wait with a bad --slot must surface invalid_slot and NOT enter the
# (otherwise unresolvable) long-poll.
test_claim_wait_bad_slot_bails() {
    CURRENT_TEST_NAME="claim-wait --slot 99 surfaces invalid_slot + exits 2 (no hang)"
    _seed_claims free free
    export RL_AGENT_ID="cw-bad"
    local out exit_code=0
    out=$("$BIN_DIR/claim-wait" --slot 99 --branch feat-cw --timeout 5 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "2" "invalid --slot must exit 2 from claim-wait, not poll"
    local err
    err=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$err" "invalid_slot" "claim-wait must surface invalid_slot from the inner claim"
}

run_test "slot-targets-requested-free" test_slot_targets_requested_free_slot
run_test "slot-enqueues-on-requested-busy" test_slot_enqueues_on_requested_when_busy_not_other_free
run_test "slot-out-of-range-errors" test_slot_out_of_range_errors
run_test "slot-non-numeric-errors" test_slot_non_numeric_errors
run_test "no-slot-keeps-lowest-first" test_no_slot_keeps_lowest_first
run_test "slot-zero-padded-grants" test_slot_zero_padded_grants
run_test "slot-zero-padded-enqueues-canonical" test_slot_zero_padded_enqueues_canonical
run_test "claim-wait-forwards-slot-grant" test_claim_wait_forwards_slot_grant
run_test "claim-wait-bad-slot-bails" test_claim_wait_bad_slot_bails

print_test_summary
