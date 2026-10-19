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
    out=$(bash "$BIN_DIR/claim" --branch unknown 2>&1) || exit_code=$?
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
    out=$(bash "$BIN_DIR/claim" --branch "" 2>&1) || exit_code=$?
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
    out=$(bash "$BIN_DIR/claim" --branch rok-new 2>&1) || exit_code=$?
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

# 2026-10-19 incident — the DIRECT claim path (free slot, no queue) also runs
# branch-match-or-destroy. Seed free slot 1 holding one claimable env.
seed_free_slot_with_env() {
    local env_branch="$1" pinned="$2"
    jq -n '[{slot:1, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null}]' \
        > "$RL_STATE_DIR/claims.json"
    echo "[]" > "$RL_STATE_DIR/queue.json"
    jq -n --arg b "$env_branch" --argjson p "$pinned" '
        [{slug:"pinned-env", slot:1, image:"test", ttl:"24h", created_at:"2026-10-19T00:00:00Z",
          last_touched:"2026-10-19T00:00:00Z", public_domain:"x.lan", pinned:$p,
          claimable_by_next:true, created_for_branch:$b}]' > "$RL_STATE_DIR/env-registry.json"
}

test_direct_claim_preserves_pinned_mismatch() {
    CURRENT_TEST_NAME="direct claim: pinned + branch mismatch → preserved, not destroyed"
    test_setup
    seed_free_slot_with_env "feat-pinned" true
    local out
    out=$(bash "$BIN_DIR/claim" --branch feat-other --slot 1 2>/dev/null) || true
    assert_eq "$(jq -r '.slot // empty' <<<"$out" 2>/dev/null)" "1" "claim still granted"
    assert_eq "$(jq -c '.preserved_pinned' <<<"$out" 2>/dev/null)" '["pinned-env"]' "preserved_pinned lists the env"
    assert_eq "$(jq -c '.destroyed_envs' <<<"$out" 2>/dev/null)" '[]' "pinned env not reported destroyed"
    assert_eq "$(jq -c '[.[] | {slug, claimable_by_next}]' "$RL_STATE_DIR/env-registry.json")" \
        '[{"slug":"pinned-env","claimable_by_next":true}]' "env row intact and still claimable"
    test_teardown
}

test_direct_claim_destroys_unpinned_mismatch() {
    CURRENT_TEST_NAME="direct claim: unpinned + branch mismatch → destroyed as today"
    test_setup
    seed_free_slot_with_env "feat-old" false
    local out
    out=$(bash "$BIN_DIR/claim" --branch feat-other --slot 1 2>/dev/null) || true
    assert_eq "$(jq -c '.destroyed_envs' <<<"$out" 2>/dev/null)" '["pinned-env"]' "unpinned mismatch destroyed"
    assert_eq "$(jq 'length' "$RL_STATE_DIR/env-registry.json")" "0" "registry row removed"
    test_teardown
}

test_direct_claim_empty_branch_refused_with_envs() {
    CURRENT_TEST_NAME="direct claim: no --branch on a slot with claimable envs → branch_required"
    test_setup
    seed_free_slot_with_env "feat-old" false
    local out
    out=$(bash "$BIN_DIR/claim" --slot 1 2>/dev/null) || true
    assert_eq "$(jq -r '.error // empty' <<<"$out" 2>/dev/null)" "branch_required" "refuse with branch_required"
    assert_eq "$(jq -r '.[] | select(.slot==1) | .claimed' "$RL_STATE_DIR/claims.json")" "false" "slot not claimed"
    assert_eq "$(jq 'length' "$RL_STATE_DIR/env-registry.json")" "1" "env not destroyed"
    test_teardown
}

test_direct_claim_unknown_branch_refused_with_envs() {
    CURRENT_TEST_NAME="direct claim: --branch unknown on a slot with claimable envs → branch_required"
    test_setup
    seed_free_slot_with_env "feat-old" false
    local out
    out=$(bash "$BIN_DIR/claim" --branch unknown --slot 1 2>/dev/null) || true
    assert_eq "$(jq -r '.error // empty' <<<"$out" 2>/dev/null)" "branch_required" "unknown treated as empty"
    assert_eq "$(jq -r '.[] | select(.slot==1) | .claimed' "$RL_STATE_DIR/claims.json")" "false" "slot not claimed"
    assert_eq "$(jq 'length' "$RL_STATE_DIR/env-registry.json")" "1" "env not destroyed"
    test_teardown
}

# TOCTOU guard on the DIRECT path (mirrors lease-advance's 2026-06-07 guard):
# the destroy loop re-reads each row and destroys only an env STILL claimable
# on THIS slot. Extracts claim::env_still_claimable_here verbatim.
test_direct_claim_destroy_recheck_skips_moved_env() {
    CURRENT_TEST_NAME="direct claim TOCTOU: destroy re-check passes only envs still claimable on this slot"
    test_setup
    local fn_src
    fn_src=$(sed -n '/^claim::env_still_claimable_here() {/,/^}/p' "$BIN_DIR/claim")
    assert_neq "$fn_src" "" "claim::env_still_claimable_here defined in bin/claim"
    eval "$fn_src"
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    echo '[{"slug":"e1","slot":2,"claimable_by_next":true}]' > "$RL_ENVS_FILE"
    local r=0; claim::env_still_claimable_here e1 2 2>/dev/null || r=$?
    assert_eq "$r" "0" "still claimable here → destroy"
    echo '[{"slug":"e1","slot":1,"claimable_by_next":false}]' > "$RL_ENVS_FILE"
    r=0; claim::env_still_claimable_here e1 2 2>/dev/null || r=$?
    assert_eq "$r" "1" "moved slots → skip"
    echo '[]' > "$RL_ENVS_FILE"
    r=0; claim::env_still_claimable_here e1 2 2>/dev/null || r=$?
    assert_eq "$r" "1" "row gone → skip"
    local loop
    loop=$(sed -n '/done < <(jq -r .\.\[\] | \.slug. <<<"\$MISMATCHING")/q;p' "$BIN_DIR/claim" | grep -c 'claim::env_still_claimable_here "\$mslug"')
    assert_eq "$loop" "1" "direct-path destroy loop calls the re-check"
    test_teardown
}

# Codex r1 P2 — the IDEMPOTENT path partitions by branch: a preserved pinned
# env of another branch is preserved_pinned there too, never inherited.
test_idempotent_claim_partitions_preserved_pinned() {
    CURRENT_TEST_NAME="idempotent claim: wrong-branch pinned env → preserved_pinned, not inherited"
    test_setup
    unset RL_ENVS_FILE  # an earlier test exports it at a deleted tmp dir
    seed_existing_claim "feat-other"
    jq -n '[{slug:"pinned-env", slot:1, public_domain:"x.lan", pinned:true,
             claimable_by_next:true, created_for_branch:"feat-pinned"},
            {slug:"match-env", slot:1, public_domain:"x.lan", pinned:false,
             claimable_by_next:true, created_for_branch:"feat-other"}]' > "$RL_STATE_DIR/env-registry.json"
    local out
    out=$(bash "$BIN_DIR/claim" --branch feat-other 2>/dev/null) || true
    assert_eq "$(jq -c '[.inherited_envs[].slug]' <<<"$out" 2>/dev/null)" '["match-env"]' "only the branch match is inherited"
    assert_eq "$(jq -c '.preserved_pinned' <<<"$out" 2>/dev/null)" '["pinned-env"]' "wrong-branch pin reported preserved"
    test_teardown
}

# Codex r1 P2 — release must not re-stamp a preserved pinned env of another
# branch with the releasing claim's branch (else the next B inherits A's env).
test_release_keeps_preserved_pin_provenance() {
    CURRENT_TEST_NAME="B claims over pinned A, B releases → A keeps created_for_branch; next B preserves it again"
    test_setup
    unset RL_ENVS_FILE  # an earlier test exports it at a deleted tmp dir
    seed_free_slot_with_env "feat-a" true
    export RL_AGENT_ID="agent-b1"
    bash "$BIN_DIR/claim" --branch feat-b --slot 1 >/dev/null 2>&1 || true
    jq '. + [{slug:"b-env", slot:1, public_domain:"x.lan", pinned:false, claimable_by_next:false}]' \
        "$RL_STATE_DIR/env-registry.json" > "$RL_STATE_DIR/r.tmp" && mv "$RL_STATE_DIR/r.tmp" "$RL_STATE_DIR/env-registry.json"
    bash "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true
    assert_eq "$(jq -r '.[] | select(.slug=="pinned-env") | .created_for_branch' "$RL_STATE_DIR/env-registry.json")" "feat-a" "pinned A keeps its branch"
    assert_eq "$(jq -r '.[] | select(.slug=="b-env") | .created_for_branch' "$RL_STATE_DIR/env-registry.json")" "feat-b" "B's own env stamped B"
    export RL_AGENT_ID="agent-b2"
    local out
    out=$(bash "$BIN_DIR/claim" --branch feat-b --slot 1 2>/dev/null) || true
    assert_eq "$(jq -c '.preserved_pinned' <<<"$out" 2>/dev/null)" '["pinned-env"]' "next B preserves A again"
    assert_eq "$(jq -c '[.inherited_envs[].slug]' <<<"$out" 2>/dev/null)" '["b-env"]' "next B inherits only its own env"
    test_teardown
}

run_test "ac9-unknown-returns-persisted" test_ac9_unknown_returns_persisted
run_test "ac9-empty-returns-persisted" test_ac9_empty_returns_persisted
run_test "ac9-explicit-override" test_ac9_explicit_real_branch_overrides
run_test "ac9-state-helper-exists" test_ac9_state_branch_for_agent_helper_exists
run_test "direct-claim-pinned-preserved" test_direct_claim_preserves_pinned_mismatch
run_test "direct-claim-unpinned-destroyed" test_direct_claim_destroys_unpinned_mismatch
run_test "direct-claim-empty-branch-refused" test_direct_claim_empty_branch_refused_with_envs

run_test "direct-claim-unknown-branch-refused" test_direct_claim_unknown_branch_refused_with_envs
run_test "direct-claim-toctou-recheck" test_direct_claim_destroy_recheck_skips_moved_env
run_test "idempotent-claim-partitions-pinned" test_idempotent_claim_partitions_preserved_pinned
run_test "release-keeps-pin-provenance" test_release_keeps_preserved_pin_provenance
print_test_summary
