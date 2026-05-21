#!/usr/bin/env bash
# ROK-1331 M5a — release --preserve-envs + lease-advance + branch-match handoff
# Covers AC2 (branch-match handoff), AC3 (branch-mismatch synchronous destroy),
# AC8 (synchronous destroy ordering), STRICT preserve-task-cancel-cascade.
#
# These tests are TDD-red — `release` today destroys envs unconditionally and
# does NOT call lease-advance. M5a adds --preserve-envs (agent default ON),
# env-registry mutation, and a fire-and-forget lease-advance call.

set -uo pipefail

CURRENT_TEST_FILE="release-preserve-envs.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Seed an active claim for the calling agent on slot 1 with an env in registry.
_seed_active_claim_with_env() {
    local agent="$1" branch="$2" slug="$3"
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg a "$agent" --arg b "$branch" --arg t "$now" '
        [
            {slot:1, claimed:true, agent_id:$a, branch:$b, started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    jq -n --arg slug "$slug" --arg b "$branch" --arg t "$now" '
        [{slug:$slug, slot:1, image:"test", ttl:"24h", created_at:$t, last_touched:$t,
          public_domain:"x.lan", pinned:false, claimable_by_next:false, created_for_branch:$b}]
    ' > "$RL_STATE_DIR/env-registry.json"
}

# AC2 — `release --preserve-envs` clears claim but env-registry keeps the env
#        with claimable_by_next=true + created_for_branch
test_release_preserve_envs_marks_claimable() {
    CURRENT_TEST_NAME="AC2: release --preserve-envs marks env claimable_by_next + retains created_for_branch"
    _seed_active_claim_with_env "agent-A" "feat-shared" "shared-env"
    export RL_AGENT_ID="agent-A"

    "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true

    local claimed claimable_by_next created_for_branch
    claimed=$(jq -r '.[] | select(.slot==1) | .claimed' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "parse_err")
    claimable_by_next=$(jq -r '.[0].claimable_by_next' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "parse_err")
    created_for_branch=$(jq -r '.[0].created_for_branch' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "parse_err")

    assert_eq "$claimed" "false" "claim must be cleared (claimed=false)"
    assert_eq "$claimable_by_next" "true" "env-registry[slug].claimable_by_next must be true"
    assert_eq "$created_for_branch" "feat-shared" "created_for_branch must be retained from the claim's branch"
}

# AC2 — `release --preserve-envs` reports preserved_envs[] and DOES NOT destroy
test_release_preserve_envs_reports_preserved() {
    CURRENT_TEST_NAME="AC2: release --preserve-envs JSON reports preserved_envs and cleared_lease"
    _seed_active_claim_with_env "agent-B" "feat-keep" "keep-env"
    export RL_AGENT_ID="agent-B"

    local out
    out=$("$BIN_DIR/release" --preserve-envs 2>&1) || true

    local preserved cleared_lease destroyed
    preserved=$(echo "$out" | jq -r '.preserved_envs // empty | tostring' 2>/dev/null || echo "parse_err")
    cleared_lease=$(echo "$out" | jq -r '.cleared_lease // empty' 2>/dev/null || echo "parse_err")
    destroyed=$(echo "$out" | jq -r '.destroyed_envs // empty | tostring' 2>/dev/null || echo "parse_err")

    assert_contains "$preserved" "keep-env" "preserved_envs must include the slug"
    assert_eq "$cleared_lease" "true" "cleared_lease must be true when claim was active"
    # destroyed_envs should be [] when preserve mode used
    case "$destroyed" in
        ""|"[]"|"null") TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)) ;;
        *)
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: destroyed_envs not empty: $destroyed")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] destroyed_envs should be empty under --preserve-envs, got=$destroyed"
            ;;
    esac
}

# AC2 — branch-match handoff: next claim for SAME branch inherits the env
test_branch_match_handoff_inherits_env() {
    CURRENT_TEST_NAME="AC2: branch-match handoff returns inherited_envs and DOES NOT destroy"
    _seed_active_claim_with_env "agent-prev" "feat-match" "match-env"
    # Mark env as claimable (post-release-preserve state) directly.
    jq '.[0].claimable_by_next = true' "$RL_STATE_DIR/env-registry.json" > "$RL_STATE_DIR/env-registry.json.tmp" \
        && mv "$RL_STATE_DIR/env-registry.json.tmp" "$RL_STATE_DIR/env-registry.json"
    # Clear claim slot 1 so new claim can grab.
    jq '(.[] | select(.slot==1)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null)' \
        "$RL_STATE_DIR/claims.json" > "$RL_STATE_DIR/claims.json.tmp" \
        && mv "$RL_STATE_DIR/claims.json.tmp" "$RL_STATE_DIR/claims.json"

    export RL_AGENT_ID="agent-next"
    local out
    out=$("$BIN_DIR/claim" --branch feat-match 2>&1) || true

    local inherited_first slot destroyed
    inherited_first=$(echo "$out" | jq -r '.inherited_envs[0].slug // empty' 2>/dev/null || echo "parse_err")
    slot=$(echo "$out" | jq -r '.slot // empty' 2>/dev/null || echo "")
    destroyed=$(echo "$out" | jq -r '.destroyed_envs // empty | tostring' 2>/dev/null || echo "")

    assert_eq "$slot" "1" "claim must grant slot 1"
    assert_eq "$inherited_first" "match-env" "inherited_envs must include match-env"
    # destroyed_envs must be empty on branch-match.
    case "$destroyed" in
        ""|"[]"|"null") TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)) ;;
        *)
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: destroyed_envs not empty on branch-match: $destroyed")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] branch-match must NOT destroy, got=$destroyed"
            ;;
    esac

    # claimable_by_next must be cleared after grant.
    local still_claimable
    still_claimable=$(jq -r '.[0].claimable_by_next' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "parse_err")
    assert_eq "$still_claimable" "false" "claimable_by_next must be cleared after inherited grant"
}

# AC3 — branch-mismatch synchronous destroy: env-destroy runs BEFORE claim returns
test_branch_mismatch_destroys_synchronously() {
    CURRENT_TEST_NAME="AC3/AC8: branch-mismatch destroys env synchronously BEFORE claim response"
    _seed_active_claim_with_env "agent-prev" "feat-X" "mismatch-env"
    # Move env to claimable state, clear claim.
    jq '.[0].claimable_by_next = true' "$RL_STATE_DIR/env-registry.json" > "$RL_STATE_DIR/env-registry.json.tmp" \
        && mv "$RL_STATE_DIR/env-registry.json.tmp" "$RL_STATE_DIR/env-registry.json"
    jq '(.[] | select(.slot==1)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null)' \
        "$RL_STATE_DIR/claims.json" > "$RL_STATE_DIR/claims.json.tmp" \
        && mv "$RL_STATE_DIR/claims.json.tmp" "$RL_STATE_DIR/claims.json"

    export RL_AGENT_ID="agent-new"
    local out
    out=$("$BIN_DIR/claim" --branch feat-Y 2>&1) || true

    local destroyed_first inherited
    destroyed_first=$(echo "$out" | jq -r '.destroyed_envs[0] // empty' 2>/dev/null || echo "parse_err")
    inherited=$(echo "$out" | jq -r '.inherited_envs // empty | tostring' 2>/dev/null || echo "")

    assert_eq "$destroyed_first" "mismatch-env" "destroyed_envs must list mismatch-env on branch mismatch"
    case "$inherited" in
        ""|"[]"|"null") TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)) ;;
        *)
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: inherited_envs not empty on mismatch: $inherited")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] branch-mismatch must have empty inherited_envs, got=$inherited"
            ;;
    esac

    # Env must be removed from registry (synchronous destroy must complete BEFORE response).
    local env_count
    env_count=$(jq 'length' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "parse_err")
    assert_eq "$env_count" "0" "env-registry must have 0 entries after synchronous destroy"
}

# AC8 — audit log ordering: env-destroy must precede lease-advance granted
test_audit_log_destroy_before_grant() {
    CURRENT_TEST_NAME="AC8: audit log records env-destroy BEFORE lease-advance/claim grant"
    _seed_active_claim_with_env "agent-prev" "feat-Z" "audit-env"
    jq '.[0].claimable_by_next = true' "$RL_STATE_DIR/env-registry.json" > "$RL_STATE_DIR/env-registry.json.tmp" \
        && mv "$RL_STATE_DIR/env-registry.json.tmp" "$RL_STATE_DIR/env-registry.json"
    jq '(.[] | select(.slot==1)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null)' \
        "$RL_STATE_DIR/claims.json" > "$RL_STATE_DIR/claims.json.tmp" \
        && mv "$RL_STATE_DIR/claims.json.tmp" "$RL_STATE_DIR/claims.json"

    export RL_AGENT_ID="agent-audit"
    "$BIN_DIR/claim" --branch feat-mismatch >/dev/null 2>&1 || true

    # Find line numbers of env-destroy + claim acquired/granted in audit.log
    local destroy_line grant_line
    destroy_line=$(grep -n 'env-destroy' "$RL_STATE_DIR/audit.log" 2>/dev/null | head -1 | cut -d: -f1)
    grant_line=$(grep -nE 'claim.*acquired|lease-advance.*granted' "$RL_STATE_DIR/audit.log" 2>/dev/null | head -1 | cut -d: -f1)

    if [[ -z "$destroy_line" || -z "$grant_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: missing destroy_line=$destroy_line or grant_line=$grant_line")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] audit log missing destroy or grant entry"
    elif (( destroy_line < grant_line )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: destroy at line $destroy_line, grant at $grant_line (destroy must come first)")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected destroy BEFORE grant"
    fi
}

# STRICT (architect 2026-05-20) — release preserves M1's task-cancel cascade
test_release_preserves_task_cancel_cascade() {
    CURRENT_TEST_NAME="STRICT: release scans tasks/*.json for owner==slot+status=running and calls task-cancel BEFORE lease-advance"
    _seed_active_claim_with_env "agent-tasks" "feat-tasks" "tasks-env"
    export RL_AGENT_ID="agent-tasks"
    # Seed a running task owned by slot 1.
    mkdir -p "$RL_STATE_DIR/tasks"
    jq -n --arg t "$(date -u +%FT%TZ)" '
        {task_id:"runningtask01", tool:"manual", slot:1, status:"running",
         pid:99999, started_at:$t}
    ' > "$RL_STATE_DIR/tasks/runningtask01.json"

    # Install a fake task-cancel that records its invocation.
    local sentinel="$RL_STATE_DIR/task-cancel.invoked"
    local fake_bin_dir
    fake_bin_dir=$(mktemp -d -t rl-fake-bin.XXXXXX)
    cat > "$fake_bin_dir/task-cancel" <<EOF
#!/usr/bin/env bash
echo "task-cancel called with: \$*" >> "$sentinel"
exit 0
EOF
    chmod +x "$fake_bin_dir/task-cancel"
    # Same for lease-advance so we can check ordering.
    cat > "$fake_bin_dir/lease-advance" <<EOF
#!/usr/bin/env bash
echo "lease-advance called with: \$*" >> "$sentinel"
exit 0
EOF
    chmod +x "$fake_bin_dir/lease-advance"

    # Run release with PATH prefixed so dispatched siblings hit fakes.
    # release calls "$(dirname "$0")/lease-advance" so we also need to shim into BIN_DIR.
    # Use a temporary symlink in BIN_DIR if missing; otherwise we rely on the
    # implementation discovery — for the TDD red phase, the SENTINEL just needs
    # to be reachable. Symlink the fakes alongside release so dirname resolution
    # finds them.
    local link_lc="$BIN_DIR/task-cancel"
    local link_la="$BIN_DIR/lease-advance"
    local restore_lc="" restore_la=""
    if [[ -e "$link_lc" || -L "$link_lc" ]]; then
        restore_lc="$(mktemp -u "${link_lc}.backup.XXXX")"
        mv "$link_lc" "$restore_lc"
    fi
    if [[ -e "$link_la" || -L "$link_la" ]]; then
        restore_la="$(mktemp -u "${link_la}.backup.XXXX")"
        mv "$link_la" "$restore_la"
    fi
    ln -s "$fake_bin_dir/task-cancel" "$link_lc"
    ln -s "$fake_bin_dir/lease-advance" "$link_la"

    PATH="$fake_bin_dir:$PATH" "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true

    # Cleanup symlinks before assertions (don't leave artifacts on failure).
    rm -f "$link_lc" "$link_la"
    [[ -n "$restore_lc" && -f "$restore_lc" ]] && mv "$restore_lc" "$link_lc"
    [[ -n "$restore_la" && -f "$restore_la" ]] && mv "$restore_la" "$link_la"

    if [[ ! -f "$sentinel" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: neither task-cancel nor lease-advance was invoked")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] sentinel file never created"
    else
        # Order: task-cancel line must appear BEFORE lease-advance line.
        local tc_line la_line
        tc_line=$(grep -n 'task-cancel' "$sentinel" | head -1 | cut -d: -f1)
        la_line=$(grep -n 'lease-advance' "$sentinel" | head -1 | cut -d: -f1)
        if [[ -z "$tc_line" ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: task-cancel never invoked for running task")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] task-cancel must be called for tasks owned by released slot"
        elif [[ -z "$la_line" ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: lease-advance never invoked")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] lease-advance must be called after clearing claim"
        elif (( tc_line < la_line )); then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: task-cancel at $tc_line, lease-advance at $la_line (must call task-cancel FIRST)")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] task-cancel must be called BEFORE lease-advance"
        fi
    fi

    rm -rf "$fake_bin_dir"
}

run_test "ac2-preserve-marks-claimable" test_release_preserve_envs_marks_claimable
run_test "ac2-preserve-reports-preserved" test_release_preserve_envs_reports_preserved
run_test "ac2-branch-match-inherits" test_branch_match_handoff_inherits_env
run_test "ac3-branch-mismatch-destroys" test_branch_mismatch_destroys_synchronously
run_test "ac8-audit-destroy-before-grant" test_audit_log_destroy_before_grant
run_test "strict-task-cancel-cascade" test_release_preserves_task_cancel_cascade

print_test_summary
