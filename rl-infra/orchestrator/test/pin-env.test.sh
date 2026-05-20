#!/usr/bin/env bash
# ROK-1331 M5a — env-pin / env-unpin binary tests
# Covers the pin/unpin authz + env-registry mutation; AC4 (pin defeats reaper)
# is exercised at the sweeper layer in sweeper-pin-safety.test.sh.
#
# These tests are TDD-red — env-pin and env-unpin do not exist yet.

set -uo pipefail

CURRENT_TEST_FILE="pin-env.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

_seed_claim_and_env() {
    local agent="$1" slot="$2" slug="$3"
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg a "$agent" --arg t "$now" --argjson s "$slot" '
        [
            {slot:1, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ] | map(if .slot == $s then .claimed=true | .agent_id=$a | .branch="feat" | .started_at=$t | .last_heartbeat=$t else . end)
    ' > "$RL_STATE_DIR/claims.json"
    jq -n --arg slug "$slug" --argjson s "$slot" --arg t "$now" '
        [{slug:$slug, slot:$s, image:"x", ttl:"24h", created_at:$t, last_touched:$t,
          public_domain:"x.lan", pinned:false, claimable_by_next:false, created_for_branch:"feat"}]
    ' > "$RL_STATE_DIR/env-registry.json"
}

test_env_pin_binary_exists() {
    CURRENT_TEST_NAME="env-pin binary exists in orchestrator/bin/"
    assert_file_exists "$BIN_DIR/env-pin" "env-pin must be a NEW binary"
}

test_env_unpin_binary_exists() {
    CURRENT_TEST_NAME="env-unpin binary exists in orchestrator/bin/"
    assert_file_exists "$BIN_DIR/env-unpin" "env-unpin must be a NEW binary"
}

# Holder of env's slot can pin it
test_env_pin_by_slot_holder_succeeds() {
    CURRENT_TEST_NAME="env-pin succeeds when caller holds the env's slot's claim"
    _seed_claim_and_env "agent-pin" 1 "my-env"
    export RL_AGENT_ID="agent-pin"

    local out exit_code
    out=$("$BIN_DIR/env-pin" --slug my-env 2>&1) || exit_code=$?
    : "${exit_code:=0}"
    assert_exit_code "$exit_code" "0" "env-pin must exit 0 for slot holder"

    local ok pinned
    ok=$(echo "$out" | jq -r '.ok // empty' 2>/dev/null || echo "parse_err")
    pinned=$(echo "$out" | jq -r '.pinned // empty' 2>/dev/null || echo "")
    assert_eq "$ok" "true" "response.ok must be true"
    assert_eq "$pinned" "true" "response.pinned must be true"

    local stored
    stored=$(jq -r '.[0].pinned' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "")
    assert_eq "$stored" "true" "env-registry[slug].pinned must be true after pin"
}

# Non-holder cannot pin
test_env_pin_unauthorized_for_non_holder() {
    CURRENT_TEST_NAME="env-pin rejected for non-holder agent (different slot)"
    _seed_claim_and_env "agent-A" 1 "env-of-slot-1"
    # Agent B holds slot 2.
    local now
    now=$(date -u +%FT%TZ)
    jq --arg b "agent-B" --arg t "$now" '
        (.[] | select(.slot==2)) |= (.claimed=true | .agent_id=$b | .branch="feat-b" | .started_at=$t | .last_heartbeat=$t)
    ' "$RL_STATE_DIR/claims.json" > "$RL_STATE_DIR/claims.json.tmp" \
        && mv "$RL_STATE_DIR/claims.json.tmp" "$RL_STATE_DIR/claims.json"

    export RL_AGENT_ID="agent-B"
    local out
    out=$("$BIN_DIR/env-pin" --slug env-of-slot-1 2>&1) || true
    local err
    err=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || echo "")
    assert_eq "$err" "unauthorized" "non-holder must get error:unauthorized"

    # Pinned still false.
    local pinned
    pinned=$(jq -r '.[0].pinned' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "")
    assert_eq "$pinned" "false" "pin must not mutate state on unauthorized"
}

# Operator can pin any env
test_env_pin_operator_can_pin_any() {
    CURRENT_TEST_NAME="env-pin succeeds for operator (RL_PROXMOX_USER=rl) regardless of slot ownership"
    _seed_claim_and_env "some-agent" 1 "operator-target"

    export RL_AGENT_ID="rl-op"
    export RL_PROXMOX_USER="rl"
    local out
    out=$("$BIN_DIR/env-pin" --slug operator-target 2>&1) || true
    unset RL_PROXMOX_USER

    local ok pinned
    ok=$(echo "$out" | jq -r '.ok // empty' 2>/dev/null || echo "parse_err")
    pinned=$(echo "$out" | jq -r '.[0].pinned' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "")
    assert_eq "$ok" "true" "operator must be authorized to pin any env"
}

# Pin a slug that doesn't exist
test_env_pin_missing_slug_errors() {
    CURRENT_TEST_NAME="env-pin missing slug returns error:slug_not_found"
    _seed_claim_and_env "agent-x" 1 "exists"
    export RL_AGENT_ID="agent-x"
    local out
    out=$("$BIN_DIR/env-pin" --slug nope 2>&1) || true
    local err
    err=$(echo "$out" | jq -r '.error // empty' 2>/dev/null || echo "")
    assert_eq "$err" "slug_not_found" "missing slug must produce slug_not_found"
}

# Unpin: holder can unpin
test_env_unpin_by_holder() {
    CURRENT_TEST_NAME="env-unpin clears pinned flag when called by slot holder"
    _seed_claim_and_env "agent-u" 1 "unpin-me"
    # Pre-mark as pinned.
    jq '.[0].pinned = true' "$RL_STATE_DIR/env-registry.json" > "$RL_STATE_DIR/env-registry.json.tmp" \
        && mv "$RL_STATE_DIR/env-registry.json.tmp" "$RL_STATE_DIR/env-registry.json"
    export RL_AGENT_ID="agent-u"
    "$BIN_DIR/env-unpin" --slug unpin-me >/dev/null 2>&1 || true
    local pinned
    pinned=$(jq -r '.[0].pinned' "$RL_STATE_DIR/env-registry.json" 2>/dev/null)
    assert_eq "$pinned" "false" "unpin must set pinned=false"
}

run_test "env-pin-binary-exists" test_env_pin_binary_exists
run_test "env-unpin-binary-exists" test_env_unpin_binary_exists
run_test "pin-by-slot-holder" test_env_pin_by_slot_holder_succeeds
run_test "pin-non-holder-unauthorized" test_env_pin_unauthorized_for_non_holder
run_test "pin-operator-can-any" test_env_pin_operator_can_pin_any
run_test "pin-missing-slug-error" test_env_pin_missing_slug_errors
run_test "unpin-by-holder" test_env_unpin_by_holder

print_test_summary
