#!/usr/bin/env bash
# ROK-2289 — the fleet must never offer a slot that has no runner.
#
# The live claims.json carried rows 1-4 (slots 3-4 were rowed when the
# `extra-slots` compose profile was once enabled; state::init never shrinks
# the file) while only rl-runner-1/2 existed. `claim` picked from the ROWS and
# `status` printed the rows, so `rl_status` showed slots 3/4 FREE and an
# unpinned claim on a busy 1+2 landed on slot 3 — whose dispatch then died
# with the runner-dir check's exit 96. RUNNER_SLOTS (default 2) is the cap.

set -uo pipefail

CURRENT_TEST_FILE="slot-cap.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# 4 rows, slots 1+2 busy; $1 = a slot above 2 that is ALSO busy, or 0.
_seed4_busy12() {
    export RL_CLAIMS_FILE="$RL_STATE_DIR/claims.json"
    local t; t="$(date -u +%FT%TZ)"
    jq -n --arg t "$t" --argjson extra "$1" '[range(1;5) as $s
        | (($s <= 2) or ($s == $extra)) as $busy
        | {slot:$s, claimed:$busy, agent_id:(if $busy then "holder-\($s)" else null end),
           branch:(if $busy then "feat-\($s)" else null end), started_at:$t,
           last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0}]' \
        > "$RL_CLAIMS_FILE"
}

test_claim_never_grants_uncapped_row() {
    CURRENT_TEST_NAME="C1: RUNNER_SLOTS=2 + rows 1-4, slots 1-2 busy — claim enqueues, never grants slot 3"
    _seed4_busy12 0
    export RUNNER_SLOTS=2 RL_AGENT_ID="capped-agent"
    local out; out=$(bash "$BIN_DIR/claim" --branch feat-cap 2>&1)
    assert_eq "$(jq -r '.slot // "none"' <<<"$out" 2>/dev/null)" "none" \
        "no slot granted (got: $out)"
    assert_eq "$(jq -r '.[] | select(.slot==3) | .claimed' "$RL_CLAIMS_FILE")" "false" \
        "slot 3 (no runner) stays unclaimed"
    assert_eq "$(ls "$RL_STATE_DIR/lease-queue/" 2>/dev/null | grep -cE '^[34]\.json$')" "0" \
        "nothing queued on a runnerless slot"
    unset RUNNER_SLOTS
}

test_offered_claims_hides_free_uncapped_rows() {
    CURRENT_TEST_NAME="C2: state::offered_claims (what status prints) hides free slots 3-4"
    _seed4_busy12 0
    export RUNNER_SLOTS=2
    # shellcheck disable=SC1091
    source "$BIN_DIR/_state.sh"
    assert_eq "$(state::offered_claims | jq -c '[.[].slot]')" "[1,2]" "only slots with a runner are listed"
    unset RUNNER_SLOTS
}

test_offered_claims_keeps_claimed_uncapped_row() {
    CURRENT_TEST_NAME="C3: a CLAIMED slot above the cap stays visible until released"
    _seed4_busy12 4
    export RUNNER_SLOTS=2
    # shellcheck disable=SC1091
    source "$BIN_DIR/_state.sh"
    assert_eq "$(state::offered_claims | jq -c '[.[] | "\(.slot):\(.claimed)"]')" \
        '["1:true","2:true","4:true"]' "slot 4's holder is still shown; free slot 3 is not"
    unset RUNNER_SLOTS
}

test_status_uses_offered_claims() {
    CURRENT_TEST_NAME="C4: bin/status builds its slot list from state::offered_claims, not the raw file"
    assert_eq "$(grep -c '^CLAIMS=\$(state::offered_claims)$' "$BIN_DIR/status")" "1" \
        "status reads the capped slot list"
}

test_default_cap_is_two() {
    CURRENT_TEST_NAME="C5: with RUNNER_SLOTS unset the cap is the two default runners"
    unset RUNNER_SLOTS
    _seed4_busy12 0
    # shellcheck disable=SC1091
    source "$BIN_DIR/_state.sh"
    assert_eq "$RUNNER_SLOTS" "2" "RUNNER_SLOTS defaults to 2 (compose default profile = runner-1/2)"
    assert_eq "$(state::offered_claims | jq -c '[.[].slot]')" "[1,2]" "default never offers 3/4"
    unset RUNNER_SLOTS
}

test_borrow_never_picks_uncapped_row() {
    CURRENT_TEST_NAME="C6: borrow::try never borrows a free slot above RUNNER_SLOTS"
    _seed4_busy12 0
    mkdir -p "$RL_STATE_DIR/lease-queue"
    export RL_MEMINFO_PATH="$RL_STATE_DIR/meminfo"
    printf 'MemTotal: 16000000 kB\nMemAvailable: 16000000 kB\n' > "$RL_MEMINFO_PATH"
    export RUNNER_SLOTS=2
    # shellcheck disable=SC1091
    source "$BIN_DIR/_state.sh"; source "$BIN_DIR/_admission.sh"; source "$BIN_DIR/_borrow.sh"
    local got rc=0; got=$(borrow::try 1 "task-cap" "") || rc=$?
    assert_eq "$rc:$got" "1:" "no free slot within the cap (borrowed: '$got')"
    assert_eq "$(jq -c '[.[] | select(.slot > 2) | .claimed]' "$RL_CLAIMS_FILE")" "[false,false]" \
        "slots 3-4 (no runner) stay unclaimed"
    # Positive control: raise the cap to 3 and the same fleet borrows slot 3.
    RUNNER_SLOTS=3
    rc=0; got=$(borrow::try 1 "task-cap" "") || rc=$?
    assert_eq "$rc:$got" "0:3" "with RUNNER_SLOTS=3 slot 3 is borrowable"
    unset RUNNER_SLOTS RL_MEMINFO_PATH
}

test_invalid_runner_slots_fails_loudly() {
    CURRENT_TEST_NAME="C7: a non-numeric RUNNER_SLOTS makes status and claim fail loudly"
    _seed4_busy12 0
    local bin out rc
    for bin in status claim; do
        rc=0; out=$(RUNNER_SLOTS=two RL_AGENT_ID=bad-cap bash "$BIN_DIR/$bin" 2>&1 >/dev/null) || rc=$?
        assert_eq "$rc" "2" "$bin exits 2 on RUNNER_SLOTS=two"
        assert_eq "$(jq -r '.error' <<<"$out" 2>/dev/null)" "invalid_runner_slots" \
            "$bin names the bad setting (stderr: $out)"
    done
    rc=0; RUNNER_SLOTS=0 bash "$BIN_DIR/status" >/dev/null 2>&1 || rc=$?
    assert_eq "$rc" "2" "RUNNER_SLOTS=0 is rejected too"
    assert_eq "$(jq -r '.[] | select(.slot==3) | .claimed' "$RL_CLAIMS_FILE")" "false" "nothing was claimed"
}

test_lease_advance_refuses_uncapped_slot() {
    CURRENT_TEST_NAME="C8: lease-advance --slot above RUNNER_SLOTS is refused and grants nothing"
    _seed4_busy12 0
    mkdir -p "$RL_STATE_DIR/lease-queue"
    jq -nc --arg t "$(date -u +%FT%TZ)" '[{agent_id:"waiter-3", branch:"feat-w", enqueued_at:$t, last_heartbeat:$t}]' \
        > "$RL_STATE_DIR/lease-queue/3.json"
    local out rc=0
    out=$(RUNNER_SLOTS=2 bash "$BIN_DIR/lease-advance" --slot 3 2>&1) || rc=$?
    assert_eq "$rc" "2" "lease-advance exits 2 for slot 3 with RUNNER_SLOTS=2"
    assert_eq "$(jq -r '.error' <<<"$out" 2>/dev/null)" "slot_out_of_range" "error names the cap (got: $out)"
    assert_eq "$(jq -r '.[] | select(.slot==3) | .claimed' "$RL_CLAIMS_FILE")" "false" "slot 3 not granted"
}

run_test "c1-claim-capped" test_claim_never_grants_uncapped_row
run_test "c2-offered-hides" test_offered_claims_hides_free_uncapped_rows
run_test "c3-offered-keeps-claimed" test_offered_claims_keeps_claimed_uncapped_row
run_test "c4-status-wired" test_status_uses_offered_claims
run_test "c5-default-two" test_default_cap_is_two
run_test "c6-borrow-capped" test_borrow_never_picks_uncapped_row
run_test "c7-invalid-runner-slots" test_invalid_runner_slots_fails_loudly
run_test "c8-lease-advance-capped" test_lease_advance_refuses_uncapped_slot

print_test_summary
