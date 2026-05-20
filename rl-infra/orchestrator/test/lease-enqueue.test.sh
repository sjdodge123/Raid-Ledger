#!/usr/bin/env bash
# ROK-1331 M5a — lease queue enqueue + claim contract tests
# Covers AC1 (lease queue enqueue), AC14 (no 409 in claim), and the
# response-shape fields: enqueued, queue_position, queue_ahead, expires_at.
#
# These tests are TDD-red — the orchestrator's `claim` binary still emits
# the legacy {queued, position, queue_length} shape and writes only to
# queue.json. M5a adds lease-queue/<slot>.json + new response fields.

set -uo pipefail

CURRENT_TEST_FILE="lease-enqueue.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Helper: prime claims.json so both slots are BUSY held by other agents.
_busy_both_slots() {
    local claims="$RL_STATE_DIR/claims.json"
    jq -n --arg t "$(date -u +%FT%TZ)" '
        [
            {slot:1, claimed:true, agent_id:"holder-1", branch:"feat-a", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0},
            {slot:2, claimed:true, agent_id:"holder-2", branch:"feat-b", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0}
        ]
    ' > "$claims"
}

# AC1 — claim against fully-busy fleet enqueues and returns {enqueued:true, queue_position}
test_claim_enqueues_when_all_busy() {
    CURRENT_TEST_NAME="AC1: claim enqueues with enqueued:true + queue_position when all slots busy"
    _busy_both_slots
    export RL_AGENT_ID="waiter-1"
    local out exit_code
    out=$("$BIN_DIR/claim" --branch waiter-branch 2>&1) || exit_code=$?
    : "${exit_code:=0}"

    assert_exit_code "$exit_code" "0" "claim must NOT return non-zero when slots busy (no 409)"

    local enqueued queue_position
    enqueued=$(echo "$out" | jq -r '.enqueued // false' 2>/dev/null || echo "parse_err")
    queue_position=$(echo "$out" | jq -r '.queue_position // empty' 2>/dev/null || echo "parse_err")

    assert_eq "$enqueued" "true" "response.enqueued must be true"
    assert_neq "$queue_position" "" ".queue_position must be present (numeric, 0-based)"
    assert_neq "$queue_position" "parse_err" ".queue_position must parse"
}

# AC1 — queue_ahead array populated when multiple waiters present
test_claim_returns_queue_ahead() {
    CURRENT_TEST_NAME="AC1: queue_ahead lists earlier waiters with {agent_id, branch, requested_at}"
    _busy_both_slots
    # Seed the per-slot lease-queue file directly so we know the head identity.
    mkdir -p "$RL_STATE_DIR/lease-queue"
    jq -n --arg t "$(date -u +%FT%TZ)" '
        [{agent_id:"early-bird", branch:"feat-early", requested_at:$t, preempt:false, last_heartbeat:$t}]
    ' > "$RL_STATE_DIR/lease-queue/1.json"

    export RL_AGENT_ID="latecomer"
    local out
    out=$("$BIN_DIR/claim" --branch feat-late 2>&1) || true

    local ahead_len ahead_first_agent
    ahead_len=$(echo "$out" | jq '.queue_ahead | length' 2>/dev/null || echo "parse_err")
    ahead_first_agent=$(echo "$out" | jq -r '.queue_ahead[0].agent_id // empty' 2>/dev/null || echo "parse_err")

    assert_neq "$ahead_len" "parse_err" ".queue_ahead must be array-shaped"
    # Latecomer should see at least 1 ahead of them (early-bird). Position depends on slot pick.
    case "$ahead_len" in
        0|"")
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: queue_ahead empty but early-bird was seeded")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] queue_ahead must be non-empty when an early waiter exists"
            ;;
        *)
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
            ;;
    esac
    # Each entry must carry the expected fields.
    case "$ahead_first_agent" in
        "early-bird")
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
            ;;
        *)
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: first queue_ahead entry should be early-bird, got: $ahead_first_agent")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected queue_ahead[0].agent_id=early-bird, got=$ahead_first_agent"
            ;;
    esac
}

# AC1 — FIFO ordering: per-slot lease-queue/<slot>.json should be a JSON array
test_claim_writes_lease_queue_file() {
    CURRENT_TEST_NAME="AC1: claim writes to per-slot lease-queue/<slot>.json (not just legacy queue.json)"
    _busy_both_slots
    export RL_AGENT_ID="filewriter-1"
    "$BIN_DIR/claim" --branch foo >/dev/null 2>&1 || true

    # At least one lease-queue/<slot>.json should now exist and contain this agent.
    local found=0
    for slot in 1 2; do
        local f="$RL_STATE_DIR/lease-queue/${slot}.json"
        if [[ -f "$f" ]]; then
            if jq -e --arg a "filewriter-1" 'any(.[]; .agent_id == $a)' "$f" >/dev/null 2>&1; then
                found=1
                break
            fi
        fi
    done
    if (( found == 1 )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: no lease-queue/<slot>.json contains filewriter-1")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected agent in lease-queue/<slot>.json under $RL_STATE_DIR/lease-queue/"
    fi
}

# AC14 — claim source MUST NOT emit 409/conflict anywhere
test_claim_source_has_no_409() {
    CURRENT_TEST_NAME="AC14: claim binary contains no '409' or 'conflict' literals"
    local matches
    matches=$(grep -nE '409|conflict' "$BIN_DIR/claim" 2>/dev/null | grep -v '^[[:space:]]*#' || true)
    if [[ -z "$matches" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: claim binary still contains 409/conflict literals")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] grep hits:"
        echo "$matches"
    fi
}

# AC6 — newly-granted claim populates expires_at (~24h after started_at)
test_claim_grant_populates_expires_at() {
    CURRENT_TEST_NAME="AC6: granted claim returns expires_at ~24h after now"
    # Fresh state (state::init from sourcing already wrote empty arrays).
    export RL_AGENT_ID="grantee-1"
    local out
    out=$("$BIN_DIR/claim" --branch feat-x 2>&1) || true

    local slot expires_at started_at
    slot=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "")
    expires_at=$(echo "$out" | jq -r '.expires_at // empty' 2>/dev/null || echo "")
    started_at=$(echo "$out" | jq -r '.started_at // empty' 2>/dev/null || echo "")

    assert_neq "$slot" "" "claim must have granted a slot on fresh state"
    assert_neq "$expires_at" "" "claim response must include expires_at"
    # Roughly 24h * 3600s ahead of started_at (or NOW if started_at not in response).
    if [[ -n "$expires_at" && -n "$started_at" ]]; then
        local exp_epoch start_epoch delta
        exp_epoch=$(date -u -d "$expires_at" +%s 2>/dev/null || python3 -c "import datetime; print(int(datetime.datetime.fromisoformat('$expires_at'.replace('Z','+00:00')).timestamp()))" 2>/dev/null || echo 0)
        start_epoch=$(date -u -d "$started_at" +%s 2>/dev/null || python3 -c "import datetime; print(int(datetime.datetime.fromisoformat('$started_at'.replace('Z','+00:00')).timestamp()))" 2>/dev/null || echo 0)
        delta=$((exp_epoch - start_epoch))
        # 24h = 86400. Allow ±10s slack.
        if (( delta >= 86390 && delta <= 86410 )); then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: expires_at delta=$delta, expected ~86400")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expires_at - started_at = ${delta}s (expected ~86400)"
        fi
    fi
    # Verify the claim record itself carries expires_at + extends_count.
    local claim_expires extends_count
    claim_expires=$(jq -r --argjson s "$slot" '.[] | select(.slot==$s) | .expires_at // empty' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    extends_count=$(jq -r --argjson s "$slot" '.[] | select(.slot==$s) | .extends_count // empty' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    assert_neq "$claim_expires" "" "claims.json[slot].expires_at must be populated"
    assert_eq "$extends_count" "0" "fresh claim has extends_count=0"
}

run_test "ac1-enqueues-when-busy" test_claim_enqueues_when_all_busy
run_test "ac1-queue-ahead-shape" test_claim_returns_queue_ahead
run_test "ac1-writes-lease-queue-file" test_claim_writes_lease_queue_file
run_test "ac14-no-409-in-claim" test_claim_source_has_no_409
run_test "ac6-expires-at-on-grant" test_claim_grant_populates_expires_at

print_test_summary
