#!/usr/bin/env bash
# ROK-1331 M5a — lease-status + claim-wait tests
# Covers AC9 (claim-wait blocks until grant) and lease-status read shape.
#
# These tests are TDD-red — lease-status and claim-wait do not exist yet.

set -uo pipefail

CURRENT_TEST_FILE="lease-status.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

_seed_full_state() {
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg t "$now" '
        [
            {slot:1, claimed:true, agent_id:"holder-1", branch:"feat-a", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:"2099-12-31T00:00:00Z", extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    mkdir -p "$RL_STATE_DIR/lease-queue"
    jq -n --arg t "$now" '
        [{agent_id:"waiter-X", branch:"feat-x", requested_at:$t, preempt:false, last_heartbeat:$t}]
    ' > "$RL_STATE_DIR/lease-queue/1.json"
    jq -n --arg t "$now" '
        [{slug:"pinned-env", slot:1, image:"x", ttl:"24h", created_at:$t, last_touched:$t,
          public_domain:"x.lan", pinned:true, claimable_by_next:false, created_for_branch:"feat-a"},
         {slug:"claimable-env", slot:1, image:"x", ttl:"24h", created_at:$t, last_touched:$t,
          public_domain:"x.lan", pinned:false, claimable_by_next:true, created_for_branch:"feat-a"}]
    ' > "$RL_STATE_DIR/env-registry.json"
}

test_lease_status_binary_exists() {
    CURRENT_TEST_NAME="lease-status binary exists in orchestrator/bin/"
    assert_file_exists "$BIN_DIR/lease-status" "lease-status must be a NEW binary"
}

test_claim_wait_binary_exists() {
    CURRENT_TEST_NAME="claim-wait binary exists in orchestrator/bin/"
    assert_file_exists "$BIN_DIR/claim-wait" "claim-wait must be a NEW binary"
}

# lease-status with no args dumps all slots
test_lease_status_all_slots_shape() {
    CURRENT_TEST_NAME="lease-status (no args) returns {ok:true, slots:[...]} with required keys per slot"
    _seed_full_state
    local out exit_code
    out=$("$BIN_DIR/lease-status" 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "0" "lease-status must exit 0"

    local ok slots_len
    ok=$(echo "$out" | jq -r '.ok // empty' 2>/dev/null || echo "parse_err")
    slots_len=$(echo "$out" | jq '.slots | length' 2>/dev/null || echo "parse_err")
    assert_eq "$ok" "true" "ok must be true"
    assert_eq "$slots_len" "2" "slots array must have RUNNER_SLOTS entries"

    # Slot 1: holder + queue + pinned_envs + claimable_envs
    local slot1_holder slot1_queue_len slot1_pinned slot1_claimable
    slot1_holder=$(echo "$out" | jq -r '.slots[] | select(.slot==1) | .current_holder // empty' 2>/dev/null || echo "")
    slot1_queue_len=$(echo "$out" | jq '.slots[] | select(.slot==1) | .queue | length' 2>/dev/null || echo "")
    slot1_pinned=$(echo "$out" | jq -r '.slots[] | select(.slot==1) | .pinned_envs | tostring' 2>/dev/null || echo "")
    slot1_claimable=$(echo "$out" | jq -r '.slots[] | select(.slot==1) | .claimable_envs | tostring' 2>/dev/null || echo "")

    assert_eq "$slot1_holder" "holder-1" "slot 1 current_holder must be holder-1"
    assert_eq "$slot1_queue_len" "1" "slot 1 queue must have 1 entry"
    assert_contains "$slot1_pinned" "pinned-env" "pinned_envs must list pinned-env"
    assert_contains "$slot1_claimable" "claimable-env" "claimable_envs must list claimable-env"
}

# lease-status --slot 1 returns only slot 1
test_lease_status_single_slot() {
    CURRENT_TEST_NAME="lease-status --slot 1 returns only slot 1"
    _seed_full_state
    local out
    out=$("$BIN_DIR/lease-status" --slot 1 2>&1) || true
    local slots_len first_slot
    slots_len=$(echo "$out" | jq '.slots | length' 2>/dev/null || echo "parse_err")
    first_slot=$(echo "$out" | jq -r '.slots[0].slot // empty' 2>/dev/null || echo "")
    assert_eq "$slots_len" "1" "single-slot query returns 1-entry array"
    assert_eq "$first_slot" "1" "first slot must be slot 1"
}

# lease-status --slot 99 (non-existent) returns empty slots array
test_lease_status_unknown_slot() {
    CURRENT_TEST_NAME="lease-status --slot 99 returns empty slots array (no error)"
    _seed_full_state
    local out exit_code
    out=$("$BIN_DIR/lease-status" --slot 99 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "0" "unknown slot must still exit 0"
    local slots_len
    slots_len=$(echo "$out" | jq '.slots | length' 2>/dev/null || echo "parse_err")
    assert_eq "$slots_len" "0" "slots array must be empty for unknown slot"
}

# AC9 — claim-wait single-shot: if slot free, returns immediately with grant
test_claim_wait_immediate_grant_on_free_slot() {
    CURRENT_TEST_NAME="AC9: claim-wait returns immediately when a slot is already free"
    # Fresh state — both slots free.
    export RL_AGENT_ID="immediate-grantee"
    local out exit_code
    out=$("$BIN_DIR/claim-wait" --timeout 30 --branch foo 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "0" "claim-wait must exit 0 on grant"
    local slot wait_timed_out
    slot=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "")
    wait_timed_out=$(echo "$out" | jq -r '.wait_timed_out // empty' 2>/dev/null || echo "")
    assert_neq "$slot" "" "claim-wait must populate .slot on grant"
    assert_neq "$wait_timed_out" "true" "claim-wait must NOT timeout when grant happens immediately"
}

# AC9 — claim-wait emits queue_position when enqueued (single-shot then long-poll)
test_claim_wait_enqueues_when_busy() {
    CURRENT_TEST_NAME="AC9: claim-wait with all-busy fleet returns enqueued or grants after wait"
    # Seed both busy.
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg t "$now" '
        [
            {slot:1, claimed:true, agent_id:"h1", branch:"x", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0},
            {slot:2, claimed:true, agent_id:"h2", branch:"y", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    export RL_AGENT_ID="wait-caller"
    # Short timeout so test doesn't hang forever (the binary doesn't exist yet → test fails fast).
    local out exit_code
    out=$(timeout 8 "$BIN_DIR/claim-wait" --timeout 5 --branch z 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "0" "claim-wait must exit 0 on timeout (queued)"
    local wait_timed_out enqueued
    wait_timed_out=$(echo "$out" | jq -r '.wait_timed_out // empty' 2>/dev/null || echo "")
    enqueued=$(echo "$out" | jq -r '.enqueued // empty' 2>/dev/null || echo "")
    # Either timed out (still queued) OR shows enqueued=true. Both acceptable.
    if [[ "$wait_timed_out" == "true" || "$enqueued" == "true" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: expected wait_timed_out=true or enqueued=true after 5s on busy fleet")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected wait_timed_out or enqueued. Output: $out"
    fi
}

run_test "lease-status-binary-exists" test_lease_status_binary_exists
run_test "claim-wait-binary-exists" test_claim_wait_binary_exists
run_test "lease-status-all-slots" test_lease_status_all_slots_shape
run_test "lease-status-single-slot" test_lease_status_single_slot
run_test "lease-status-unknown-slot" test_lease_status_unknown_slot
run_test "ac9-claim-wait-immediate" test_claim_wait_immediate_grant_on_free_slot
run_test "ac9-claim-wait-enqueues" test_claim_wait_enqueues_when_busy

print_test_summary
