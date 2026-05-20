#!/usr/bin/env bash
# ROK-1331 M5a — extend binary tests
# Covers AC6 (claim duration + extend) and AC7 (operator can extend any claim).
#
# These tests are TDD-red — `extend` does not exist yet.

set -uo pipefail

CURRENT_TEST_FILE="extend-claim.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

_seed_holder_with_expires() {
    local agent="$1" expires_at_iso="$2"
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg a "$agent" --arg t "$now" --arg e "$expires_at_iso" '
        [
            {slot:1, claimed:true, agent_id:$a, branch:"feat", started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:$e, extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ]
    ' > "$RL_STATE_DIR/claims.json"
}

test_extend_binary_exists() {
    CURRENT_TEST_NAME="extend binary exists in orchestrator/bin/"
    assert_file_exists "$BIN_DIR/extend" "extend must be a NEW binary"
}

# AC6 — `extend --hours N` sets expires_at = NOW + N*3600 (not additive)
test_extend_sets_expires_at_from_now() {
    CURRENT_TEST_NAME="AC6: extend --hours 12 sets expires_at = NOW + 12h (NOT additive on existing)"
    # Seed claim with expires_at 1h from now.
    local one_hour_iso
    one_hour_iso=$(date -u -d '+1 hour' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    _seed_holder_with_expires "holder-1" "$one_hour_iso"
    export RL_AGENT_ID="holder-1"

    local out exit_code
    out=$("$BIN_DIR/extend" --hours 12 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "0" "extend should exit 0"

    local ok new_expires extended_by
    ok=$(echo "$out" | jq -r '.ok // empty' 2>/dev/null || echo "parse_err")
    new_expires=$(echo "$out" | jq -r '.expires_at // empty' 2>/dev/null || echo "")
    extended_by=$(echo "$out" | jq -r '.extended_by_hours // empty' 2>/dev/null || echo "")
    assert_eq "$ok" "true" "ok must be true"
    assert_eq "$extended_by" "12" "extended_by_hours must echo input"

    # new_expires should be ~12h from NOW (not 13h, which would be additive on existing 1h)
    if [[ -n "$new_expires" ]]; then
        local exp_epoch now_epoch delta
        exp_epoch=$(date -u -d "$new_expires" +%s 2>/dev/null \
            || python3 -c "import datetime; print(int(datetime.datetime.fromisoformat('$new_expires'.replace('Z','+00:00')).timestamp()))" 2>/dev/null || echo 0)
        now_epoch=$(date -u +%s)
        delta=$((exp_epoch - now_epoch))
        # 12h = 43200s; allow ±10s slack
        if (( delta >= 43190 && delta <= 43210 )); then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: delta=${delta}s, expected ~43200 (12h from NOW, NOT 46800 additive)")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expires_at delta ${delta}s, expected ~43200"
        fi
    fi

    # claims.json must reflect new expires_at and extends_count=1
    local stored_expires stored_count
    stored_expires=$(jq -r '.[] | select(.slot==1) | .expires_at' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    stored_count=$(jq -r '.[] | select(.slot==1) | .extends_count' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    assert_eq "$stored_expires" "$new_expires" "claims.json expires_at must match response"
    assert_eq "$stored_count" "1" "extends_count must be incremented to 1"
}

# AC6 — extend --hours 25 (> 24) rejected
test_extend_rejects_over_24_hours() {
    CURRENT_TEST_NAME="AC6: extend --hours 25 rejected with hours_out_of_range"
    local one_hour_iso
    one_hour_iso=$(date -u -d '+1 hour' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    _seed_holder_with_expires "holder-1" "$one_hour_iso"
    export RL_AGENT_ID="holder-1"

    local out
    out=$("$BIN_DIR/extend" --hours 25 2>&1) || true
    local ok err
    ok=$(echo "$out" | jq -r '.ok // empty' 2>/dev/null || echo "parse_err")
    err=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || echo "")
    assert_eq "$ok" "false" "ok must be false"
    assert_contains "$err" "hours_out_of_range" "error must mention hours_out_of_range"
}

# Extend allows recurrence (no cap on calls)
test_extend_allows_recurrence() {
    CURRENT_TEST_NAME="extend can be called repeatedly (unlimited recurrence); extends_count bumps each call"
    local one_hour_iso
    one_hour_iso=$(date -u -d '+1 hour' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    _seed_holder_with_expires "holder-1" "$one_hour_iso"
    export RL_AGENT_ID="holder-1"

    "$BIN_DIR/extend" --hours 1 >/dev/null 2>&1 || true
    "$BIN_DIR/extend" --hours 1 >/dev/null 2>&1 || true
    "$BIN_DIR/extend" --hours 1 >/dev/null 2>&1 || true

    local count
    count=$(jq -r '.[] | select(.slot==1) | .extends_count' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    assert_eq "$count" "3" "extends_count must be 3 after three calls"
}

# AC7 — operator (RL_PROXMOX_USER=rl) can extend ANY claim with --slot
test_extend_operator_can_extend_any_slot() {
    CURRENT_TEST_NAME="AC7: operator can extend any claim with --slot, by=operator in response"
    local one_hour_iso
    one_hour_iso=$(date -u -d '+1 hour' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    _seed_holder_with_expires "other-holder" "$one_hour_iso"

    export RL_AGENT_ID="rl-operator-xyz"
    export RL_PROXMOX_USER="rl"
    local out
    out=$("$BIN_DIR/extend" --slot 1 --hours 4 2>&1) || true
    unset RL_PROXMOX_USER

    local ok by
    ok=$(echo "$out" | jq -r '.ok // empty' 2>/dev/null || echo "parse_err")
    by=$(echo "$out" | jq -r '.by // empty' 2>/dev/null || echo "")
    assert_eq "$ok" "true" "operator must be authorized"
    assert_eq "$by" "operator" "by field must be 'operator'"
}

# AC7 — holder path emits by=holder
test_extend_holder_path_by_holder() {
    CURRENT_TEST_NAME="AC7: holder path returns by=holder"
    local one_hour_iso
    one_hour_iso=$(date -u -d '+1 hour' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    _seed_holder_with_expires "the-holder" "$one_hour_iso"
    export RL_AGENT_ID="the-holder"
    local out
    out=$("$BIN_DIR/extend" --hours 2 2>&1) || true
    local by
    by=$(echo "$out" | jq -r '.by // empty' 2>/dev/null || echo "")
    assert_eq "$by" "holder" "holder-issued extend must return by=holder"
}

# Extend with no claim → no_claim error
test_extend_no_claim_returns_error() {
    CURRENT_TEST_NAME="extend with no claim returns ok:false error:no_claim"
    # Fresh state — no claim.
    export RL_AGENT_ID="nobody-1"
    local out
    out=$("$BIN_DIR/extend" --hours 1 2>&1) || true
    local err
    err=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || echo "")
    assert_eq "$err" "no_claim" "error must be no_claim"
}

run_test "binary-exists" test_extend_binary_exists
run_test "ac6-sets-expires-from-now" test_extend_sets_expires_at_from_now
run_test "ac6-rejects-over-24h" test_extend_rejects_over_24_hours
run_test "extend-recurrence" test_extend_allows_recurrence
run_test "ac7-operator-can-extend" test_extend_operator_can_extend_any_slot
run_test "ac7-holder-by-holder" test_extend_holder_path_by_holder
run_test "no-claim-error" test_extend_no_claim_returns_error

print_test_summary
