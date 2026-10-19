#!/usr/bin/env bash
# ROK-1793 S2 — bin/_borrow.sh: borrow only a FREE slot (unclaimed, empty
# lease queue, not excluded), never enqueue, release advances the queue, and
# the real agent's own slot lookup is untouched by the borrow row.
set -uo pipefail

CURRENT_TEST_FILE="borrow.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Seed a 4-slot fleet: slot 1 owned by the real agent, the rest per $1..$3
# ("free" | "busy"). Fake meminfo with $4 MB available (default 16000).
_seed() {
    export RUNNER_SLOTS=4
    export RL_MEMINFO_PATH="$RL_STATE_DIR/meminfo"
    printf 'MemTotal: 16000000 kB\nMemAvailable: %s kB\n' "$(( ${4:-16000} * 1024 ))" > "$RL_MEMINFO_PATH"
    local t; t=$(date -u +%FT%TZ)
    jq -n --arg t "$t" --arg s2 "$1" --arg s3 "$2" --arg s4 "$3" '
        def row($n; $st; $a):
            if $st == "busy"
            then {slot:$n, claimed:true, agent_id:$a, branch:"b\($n)", started_at:$t, last_heartbeat:$t, expires_at:null, keep_alive:false, extends_count:0}
            else {slot:$n, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, expires_at:null, keep_alive:false, extends_count:0}
            end;
        [row(1; "busy"; "real-agent"), row(2; $s2; "other-2"), row(3; $s3; "other-3"), row(4; $s4; "other-4")]
    ' > "$RL_STATE_DIR/claims.json"
    mkdir -p "$RL_STATE_DIR/lease-queue"
}

_lib() {
    unset RL_CLAIMS_FILE RL_ENVS_FILE RL_QUEUE_FILE RL_AUDIT_LOG RL_PERF_LOG RL_LEASE_QUEUE_DIR RL_ADMISSION_FILE
    # shellcheck disable=SC1091
    source "$BIN_DIR/_state.sh"; source "$BIN_DIR/_admission.sh"; source "$BIN_DIR/_borrow.sh"
}

_row() { jq -c --argjson n "$1" '.[] | select(.slot == $n) | {claimed, agent_id, borrowed_for, borrowed_by}' "$RL_STATE_DIR/claims.json"; }

test_free_slot_is_borrowed() {
    CURRENT_TEST_NAME="free slot is borrowed with a borrow-<parent> row"
    _seed busy free free; _lib
    local got rc=0
    got=$(borrow::try 1 parentaaa1 "") || rc=$?
    assert_exit_code "$rc" "0" "borrow::try must succeed with a free slot"
    assert_eq "$got" "3" "lowest free non-owner slot (3) is borrowed"
    assert_eq "$(_row 3)" '{"claimed":true,"agent_id":"borrow-parentaaa1","borrowed_for":"parentaaa1","borrowed_by":"real-agent"}' "borrow row shape"
    assert_eq "$(state::slot_for_agent real-agent)" "1" "real agent's slot lookup still = A"
}

test_queued_slot_is_skipped() {
    CURRENT_TEST_NAME="slot with a non-empty lease queue is never borrowed"
    _seed busy free busy; _lib
    echo '[{"agent_id":"waiter","branch":"w","requested_at":"x","preempt":false,"last_heartbeat":null}]' > "$RL_STATE_DIR/lease-queue/3.json"
    local got rc=0
    got=$(borrow::try 1 parentaaa2 "") || rc=$?
    assert_exit_code "$rc" "1" "no free slot -> exit 1 (never enqueue)"
    assert_eq "$got" "" "nothing echoed"
    assert_eq "$(_row 3 | jq -r .claimed)" "false" "queued slot stays unclaimed for its waiter"
}

test_excluded_slot_is_skipped() {
    CURRENT_TEST_NAME="excluded (live Mutagen) slot is skipped"
    _seed free busy free; _lib
    local got
    got=$(borrow::try 1 parentaaa3 "2,4") || true
    assert_eq "$got" "" "both free slots excluded -> nothing borrowed"
    got=$(borrow::try 1 parentaaa3 "2") || true
    assert_eq "$got" "4" "only the non-excluded free slot is borrowed"
}

test_claimed_slot_and_recheck() {
    CURRENT_TEST_NAME="claimed slot is never taken; second borrower loses the re-check"
    _seed busy busy free; _lib
    local first second rc=0
    first=$(borrow::try 1 parentaaa4 "") || true
    second=$(borrow::try 1 parentaaa5 "") || rc=$?
    assert_eq "$first" "4" "first borrower gets the only free slot"
    assert_exit_code "$rc" "1" "second borrower finds no free slot"
    assert_eq "$(_row 4 | jq -r .agent_id)" "borrow-parentaaa4" "row still the first borrower's"
    rc=0; borrow::_claim_if_free 4 parentaaa5 real-agent b1 || rc=$?
    assert_exit_code "$rc" "1" "re-check inside the lock rejects an already-claimed slot"
}

test_concurrent_try_single_winner() {
    CURRENT_TEST_NAME="two concurrent borrow::try on one free slot -> one winner"
    if ! type -P flock >/dev/null 2>&1; then
        echo "  (skip: no flock(1) on this host — covered by the sequential re-check case)"; return 0
    fi
    _seed busy busy free; _lib
    ( borrow::try 1 parentccc1 "" > "$RL_STATE_DIR/o1" ) & ( borrow::try 1 parentccc2 "" > "$RL_STATE_DIR/o2" ) & wait
    assert_eq "$(cat "$RL_STATE_DIR/o1" "$RL_STATE_DIR/o2" | grep -c .)" "1" "exactly one borrower wins"
}

test_memory_gate() {
    CURRENT_TEST_NAME="low host memory -> exit 3, nothing borrowed"
    _seed free free free 6000; _lib
    local got rc=0
    got=$(borrow::try 1 parentaaa6 "") || rc=$?
    assert_exit_code "$rc" "3" "6000MB < heavy+medium -> memory fallback"
    assert_eq "$(jq '[.[] | select(.borrowed_for)] | length' "$RL_STATE_DIR/claims.json")" "0" "no borrow row written"
}

test_release_advances_queue() {
    CURRENT_TEST_NAME="release resets the row and advances the lease queue"
    _seed busy busy free; _lib
    borrow::try 1 parentaaa7 "" >/dev/null
    local t; t=$(date -u +%FT%TZ)
    echo "[{\"agent_id\":\"waiter-4\",\"branch\":\"wb\",\"requested_at\":\"$t\",\"preempt\":false,\"last_heartbeat\":\"$t\"}]" > "$RL_STATE_DIR/lease-queue/4.json"
    borrow::release 4 parentaaa7
    assert_eq "$(_row 4 | jq -r .agent_id)" "waiter-4" "lease-advance grants the freed slot to the queue head"
    assert_eq "$(_row 4 | jq -r '.borrowed_for // "none"')" "none" "borrow fields removed"
    bash "$BIN_DIR/borrow-release" --slot 4 --parent parentaaa7 >/dev/null
    assert_eq "$(_row 4 | jq -r .agent_id)" "waiter-4" "release is idempotent and never frees someone else's row"
}

run_test "free-slot-borrowed" test_free_slot_is_borrowed
run_test "queued-slot-skipped" test_queued_slot_is_skipped
run_test "excluded-slot-skipped" test_excluded_slot_is_skipped
run_test "claimed-slot-recheck" test_claimed_slot_and_recheck
run_test "concurrent-single-winner" test_concurrent_try_single_winner
run_test "memory-gate" test_memory_gate
run_test "release-advances-queue" test_release_advances_queue

print_test_summary
