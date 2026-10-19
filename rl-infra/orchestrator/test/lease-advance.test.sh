#!/usr/bin/env bash
# ROK-1331 M5a — lease-advance binary tests
# Covers AC10 (stale head eviction) and the lease-advance grant flow.
#
# These tests are TDD-red — `lease-advance` does not exist yet.

set -uo pipefail

CURRENT_TEST_FILE="lease-advance.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

_seed_free_slot_with_queue() {
    local entries_json="$1"
    jq -n --arg t "$(date -u +%FT%TZ)" '
        [
            {slot:1, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false, expires_at:null, extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false, expires_at:null, extends_count:0}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    mkdir -p "$RL_STATE_DIR/lease-queue"
    echo "$entries_json" > "$RL_STATE_DIR/lease-queue/1.json"
}

# lease-advance binary must exist
test_lease_advance_binary_exists() {
    CURRENT_TEST_NAME="lease-advance binary exists in orchestrator/bin/"
    assert_file_exists "$BIN_DIR/lease-advance" "lease-advance must be a NEW binary"
}

# Empty queue → no-op grant
test_lease_advance_empty_queue_noop() {
    CURRENT_TEST_NAME="lease-advance on empty queue is a no-op (ok:true, granted:false)"
    _seed_free_slot_with_queue '[]'
    local out exit_code
    out=$(bash "$BIN_DIR/lease-advance" --slot 1 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "0" "lease-advance exit 0 on empty queue"
    local granted
    granted=$(echo "$out" | jq -r '.granted // empty' 2>/dev/null || echo "parse_err")
    assert_eq "$granted" "false" "granted must be false when queue empty"
}

# Head granted → claim mutated, head removed from queue
test_lease_advance_grants_head() {
    CURRENT_TEST_NAME="lease-advance grants slot to fresh head, updates claims.json"
    local now
    now=$(date -u +%FT%TZ)
    _seed_free_slot_with_queue "$(jq -n --arg t "$now" '
        [{agent_id:"queue-head", branch:"feat-head", requested_at:$t, preempt:false, last_heartbeat:$t}]
    ')"

    local out
    out=$(bash "$BIN_DIR/lease-advance" --slot 1 2>&1) || true

    local granted granted_to
    granted=$(echo "$out" | jq -r '.granted // empty' 2>/dev/null || echo "parse_err")
    granted_to=$(echo "$out" | jq -r '.granted_to_agent // empty' 2>/dev/null || echo "")
    assert_eq "$granted" "true" "granted must be true when head is fresh"
    assert_eq "$granted_to" "queue-head" "granted_to_agent must match head"

    # Slot is now claimed by queue-head
    local claimed_agent
    claimed_agent=$(jq -r '.[] | select(.slot==1) | .agent_id // empty' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "parse_err")
    assert_eq "$claimed_agent" "queue-head" "claims.json[slot==1].agent_id must be queue-head"

    # Queue file must no longer contain head
    local remaining_len
    remaining_len=$(jq 'length' "$RL_STATE_DIR/lease-queue/1.json" 2>/dev/null || echo "parse_err")
    assert_eq "$remaining_len" "0" "head must be removed from queue after grant"

    # expires_at must be populated on the new claim
    local expires_at
    expires_at=$(jq -r '.[] | select(.slot==1) | .expires_at // empty' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    assert_neq "$expires_at" "" "claim must have expires_at populated on grant"
}

# AC10 — stale head eviction (>5min last_heartbeat) before grant
test_lease_advance_evicts_stale_head() {
    CURRENT_TEST_NAME="AC10: lease-advance evicts head with last_heartbeat >5min ago, promotes next"
    local stale_ts fresh_ts
    # 10 minutes ago
    stale_ts=$(date -u -d '10 minutes ago' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() - datetime.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    fresh_ts=$(date -u +%FT%TZ)

    _seed_free_slot_with_queue "$(jq -n --arg stale "$stale_ts" --arg fresh "$fresh_ts" '
        [
            {agent_id:"stale-head", branch:"feat-stale", requested_at:$stale, preempt:false, last_heartbeat:$stale},
            {agent_id:"alive-second", branch:"feat-alive", requested_at:$fresh, preempt:false, last_heartbeat:$fresh}
        ]
    ')"

    bash "$BIN_DIR/lease-advance" --slot 1 >/dev/null 2>&1 || true

    local claimed_agent
    claimed_agent=$(jq -r '.[] | select(.slot==1) | .agent_id // empty' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "parse_err")
    assert_eq "$claimed_agent" "alive-second" "stale head must be evicted, alive-second granted"

    # Audit log must contain lease_head_evicted
    if grep -q 'lease_head_evicted' "$RL_STATE_DIR/audit.log" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: audit log missing lease_head_evicted entry")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected audit::log lease_head_evicted"
    fi
}

# Race: lease-advance on still-claimed slot is a no-op
test_lease_advance_skips_when_already_claimed() {
    CURRENT_TEST_NAME="lease-advance on already-claimed slot is a no-op (race-safe)"
    local now
    now=$(date -u +%FT%TZ)
    # Slot 1 still claimed.
    jq -n --arg t "$now" '
        [
            {slot:1, claimed:true, agent_id:"current-holder", branch:"x", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    mkdir -p "$RL_STATE_DIR/lease-queue"
    jq -n --arg t "$now" '[{agent_id:"waiter", branch:"y", requested_at:$t, preempt:false, last_heartbeat:$t}]' \
        > "$RL_STATE_DIR/lease-queue/1.json"

    bash "$BIN_DIR/lease-advance" --slot 1 >/dev/null 2>&1 || true

    local agent
    agent=$(jq -r '.[] | select(.slot==1) | .agent_id' "$RL_STATE_DIR/claims.json" 2>/dev/null)
    assert_eq "$agent" "current-holder" "claim must stay with current-holder (race-safe)"

    # Queue still has the waiter (NOT prematurely popped)
    local q_len
    q_len=$(jq 'length' "$RL_STATE_DIR/lease-queue/1.json" 2>/dev/null)
    assert_eq "$q_len" "1" "queue must still contain waiter (not popped before grant)"
}

# 2026-10-19 incident — a claim with an empty branch destroyed the PINNED
# env valheim-mod. Seed slot 1 with one claimable env + a fresh queue head.
_seed_slot1_env_and_head() {
    local head_branch="$1" env_branch="$2" pinned="$3"
    local now
    now=$(date -u +%FT%TZ)
    _seed_free_slot_with_queue "$(jq -n --arg t "$now" --arg b "$head_branch" '
        [{agent_id:"queue-head", branch:$b, requested_at:$t, preempt:false, last_heartbeat:$t}]')"
    jq -n --arg t "$now" --arg b "$env_branch" --argjson p "$pinned" '
        [{slug:"slot1-env", slot:1, image:"test", ttl:"24h", created_at:$t, last_touched:$t,
          public_domain:"x.lan", pinned:$p, claimable_by_next:true, created_for_branch:$b}]
    ' > "$RL_STATE_DIR/env-registry.json"
}

test_lease_advance_pinned_mismatch_preserved() {
    CURRENT_TEST_NAME="pinned + branch mismatch → preserved, not destroyed, grant proceeds"
    _seed_slot1_env_and_head "feat-other" "feat-pinned" true
    local out
    out=$(bash "$BIN_DIR/lease-advance" --slot 1 2>/dev/null) || true
    assert_eq "$(jq -r '.granted // empty' <<<"$out" 2>/dev/null)" "true" "grant still proceeds"
    assert_eq "$(jq -c '.preserved_pinned' <<<"$out" 2>/dev/null)" '["slot1-env"]' "preserved_pinned lists the pinned env"
    assert_eq "$(jq -c '.destroyed_envs' <<<"$out" 2>/dev/null)" '[]' "pinned env is not reported destroyed"
    assert_eq "$(jq -c '[.[] | {slug, slot, claimable_by_next}]' "$RL_STATE_DIR/env-registry.json")" \
        '[{"slug":"slot1-env","slot":1,"claimable_by_next":true}]' "env row intact and still claimable_by_next"
    assert_eq "$(grep -c 'destroy_skipped_pinned' "$RL_STATE_DIR/audit.log" 2>/dev/null || echo 0)" "1" "audit line destroy_skipped_pinned"
}

test_lease_advance_pinned_match_inherited() {
    CURRENT_TEST_NAME="pinned + branch match → inherited as today"
    _seed_slot1_env_and_head "feat-pinned" "feat-pinned" true
    local out
    out=$(bash "$BIN_DIR/lease-advance" --slot 1 2>/dev/null) || true
    assert_eq "$(jq -r '.inherited_envs[0].slug // empty' <<<"$out" 2>/dev/null)" "slot1-env" "pinned matching env inherited"
    assert_eq "$(jq -c '.preserved_pinned' <<<"$out" 2>/dev/null)" '[]' "nothing preserved on a match"
}

test_lease_advance_unpinned_mismatch_destroyed() {
    CURRENT_TEST_NAME="unpinned + branch mismatch → destroyed as today"
    _seed_slot1_env_and_head "feat-other" "feat-old" false
    local out
    out=$(bash "$BIN_DIR/lease-advance" --slot 1 2>/dev/null) || true
    assert_eq "$(jq -c '.destroyed_envs' <<<"$out" 2>/dev/null)" '["slot1-env"]' "unpinned mismatch destroyed"
    assert_eq "$(jq 'length' "$RL_STATE_DIR/env-registry.json")" "0" "registry row removed"
}

test_lease_advance_empty_branch_refused_with_envs() {
    CURRENT_TEST_NAME="empty head branch + claimable envs → branch_required, no grant, env intact"
    _seed_slot1_env_and_head "" "feat-old" false
    local out
    out=$(bash "$BIN_DIR/lease-advance" --slot 1 2>/dev/null) || true
    assert_eq "$(jq -r '.error // empty' <<<"$out" 2>/dev/null)" "branch_required" "refuse with branch_required"
    assert_eq "$(jq -r '.[] | select(.slot==1) | .claimed' "$RL_STATE_DIR/claims.json")" "false" "slot not granted"
    assert_eq "$(jq 'length' "$RL_STATE_DIR/env-registry.json")" "1" "env not destroyed"
}

test_lease_advance_empty_branch_ok_without_envs() {
    CURRENT_TEST_NAME="empty head branch + no envs on slot → granted"
    _seed_slot1_env_and_head "" "feat-old" false
    echo "[]" > "$RL_STATE_DIR/env-registry.json"
    local out
    out=$(bash "$BIN_DIR/lease-advance" --slot 1 2>/dev/null) || true
    assert_eq "$(jq -r '.granted // empty' <<<"$out" 2>/dev/null)" "true" "empty branch on an env-less slot is fine"
}

run_test "binary-exists" test_lease_advance_binary_exists
run_test "empty-queue-noop" test_lease_advance_empty_queue_noop
run_test "grants-head" test_lease_advance_grants_head
run_test "ac10-evicts-stale-head" test_lease_advance_evicts_stale_head
run_test "race-skip-claimed" test_lease_advance_skips_when_already_claimed
run_test "pinned-mismatch-preserved" test_lease_advance_pinned_mismatch_preserved
run_test "pinned-match-inherited" test_lease_advance_pinned_match_inherited
run_test "unpinned-mismatch-destroyed" test_lease_advance_unpinned_mismatch_destroyed
run_test "empty-branch-refused-with-envs" test_lease_advance_empty_branch_refused_with_envs
run_test "empty-branch-ok-without-envs" test_lease_advance_empty_branch_ok_without_envs

print_test_summary
