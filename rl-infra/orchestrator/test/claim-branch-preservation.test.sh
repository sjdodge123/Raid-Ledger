#!/usr/bin/env bash
# ROK-1331 M4 — claim re-entry preserves persisted branch on the idempotent path.
# Covers AC9: when a claim already exists and the caller passes --branch unknown
# (or empty), the orchestrator returns the PERSISTED branch in the JSON result,
# not "unknown".
#
# Strategy:
#  1. Seed RL_STATE_DIR/claims.json with one slot claimed by RL_AGENT_ID with
#     branch="rok-foo".
#  2. Invoke `bin/claim --branch unknown`.
#  3. Parse stdout JSON → .branch must equal "rok-foo", NOT "unknown".
#  4. Same with `--branch ''` (empty string) — must also fall back to persisted.
#  5. Sanity: when caller passes an EXPLICIT real branch like "rok-bar" on
#     re-claim, response uses the passed value (operator override).

set -uo pipefail

CURRENT_TEST_FILE="claim-branch-preservation.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Seed claims.json with one claimed slot.
seed_existing_claim() {
    local branch="$1"
    local slot=1
    jq -n --arg agent "$RL_AGENT_ID" --arg branch "$branch" --argjson slot "$slot" '
        [
            {slot: $slot, claimed: true, agent_id: $agent, branch: $branch,
             started_at: "2026-05-20T00:00:00Z", last_heartbeat: "2026-05-20T00:00:00Z",
             keep_alive: false},
            {slot: 2, claimed: false, agent_id: null, branch: null,
             started_at: null, last_heartbeat: null}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    echo "[]" > "$RL_STATE_DIR/queue.json"
    echo "[]" > "$RL_STATE_DIR/env-registry.json"
}

# AC9: idempotent re-claim with --branch unknown returns persisted "rok-foo".
test_ac9_unknown_returns_persisted() {
    CURRENT_TEST_NAME="AC9: --branch unknown on idempotent path returns persisted branch"
    test_setup
    seed_existing_claim "rok-foo"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch unknown 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "idempotent claim should exit 0"

    local branch
    branch=$(echo "$out" | jq -r '.branch' 2>/dev/null || echo parse_err)
    assert_eq "$branch" "rok-foo" ".branch must be the persisted value, not 'unknown'"
    # Also confirm it's NOT 'unknown'.
    if [[ "$branch" == "unknown" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: branch leaked through as 'unknown'")
    fi
    test_teardown
}

# AC9: idempotent re-claim with empty --branch '' also returns persisted.
test_ac9_empty_returns_persisted() {
    CURRENT_TEST_NAME="AC9: --branch '' on idempotent path returns persisted branch"
    test_setup
    seed_existing_claim "rok-bar"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch "" 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "idempotent claim with empty branch should exit 0"
    local branch
    branch=$(echo "$out" | jq -r '.branch' 2>/dev/null || echo parse_err)
    assert_eq "$branch" "rok-bar" "empty --branch falls back to persisted"
    test_teardown
}

# AC9 sanity: explicit real --branch <real> on re-claim wins as operator override.
# The spec is explicit: "preserves operator behavior (explicit --branch foo on
# re-claim still works as override; only the implicit/unknown case falls back
# to persisted)."
test_ac9_explicit_real_branch_overrides() {
    CURRENT_TEST_NAME="AC9 sanity: explicit --branch <real-name> overrides persisted on re-claim"
    test_setup
    seed_existing_claim "rok-old"
    local out exit_code=0
    out=$("$BIN_DIR/claim" --branch rok-new 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "explicit override re-claim should exit 0"
    local branch
    branch=$(echo "$out" | jq -r '.branch' 2>/dev/null || echo parse_err)
    assert_eq "$branch" "rok-new" "explicit real --branch must win over persisted"
    test_teardown
}

# AC9: _state.sh exports a state::branch_for_agent helper (introduced by M4).
test_ac9_state_branch_for_agent_helper_exists() {
    CURRENT_TEST_NAME="AC9: _state.sh defines state::branch_for_agent helper"
    local state_sh="$BIN_DIR/_state.sh"
    if [[ ! -f "$state_sh" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: _state.sh not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] _state.sh not found"
        return
    fi
    if grep -qE '^state::branch_for_agent[[:space:]]*\(' "$state_sh"; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: state::branch_for_agent missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] state::branch_for_agent not defined in _state.sh"
    fi
}

run_test "ac9-unknown-returns-persisted" test_ac9_unknown_returns_persisted
run_test "ac9-empty-returns-persisted" test_ac9_empty_returns_persisted
run_test "ac9-explicit-override" test_ac9_explicit_real_branch_overrides
run_test "ac9-state-helper-exists" test_ac9_state_branch_for_agent_helper_exists

print_test_summary
