#!/usr/bin/env bash
# ROK-1793 S2 — gc-sweeper and borrow rows.
#
# A borrow row (claims[].borrowed_for = parent task id) is a parallel gate's
# temporary hold on a FREE second slot B. Two hazards are pinned here:
#   1. The dead-claim (§1) and hoarded-slot (§1b') reapers destroy every env
#      labelled rl.slot=B when they reap a row. B's envs belong to someone
#      else (a preserved claimable_by_next env), so a borrow row must NEVER go
#      through those reapers — not even with a long-lapsed heartbeat.
#   2. A borrow whose parent task is terminal or missing (P killed before its
#      trap ran) is an orphan: the sweeper frees the row WITHOUT destroying any
#      env, so slot B does not stay unclaimable forever.
set -uo pipefail

CURRENT_TEST_FILE="sweeper-borrow-orphan.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"
PARENT="parentbrw01"

_iso_ago() {
    local secs="$1"
    date -u -d "now - ${secs} seconds" +%FT%TZ 2>/dev/null \
        || date -u -v-"${secs}"S +%FT%TZ 2>/dev/null
}

# Slot 1 = the owner agent (fresh); slot 2 = borrow row for $PARENT with a
# heartbeat AND started_at 9h old (both §1 and §1b' would fire on a normal row).
_seed() {
    local now old
    now=$(date -u +%FT%TZ); old=$(_iso_ago 32400)
    jq -n --arg now "$now" --arg old "$old" --arg p "$PARENT" '[
        {slot:1, claimed:true, agent_id:"owner", branch:"f", started_at:$now, last_heartbeat:$now,
         expires_at:null, keep_alive:false, extends_count:0},
        {slot:2, claimed:true, agent_id:("borrow-" + $p), branch:"f", started_at:$old, last_heartbeat:$old,
         expires_at:null, keep_alive:false, extends_count:0, borrowed_for:$p, borrowed_by:"owner"}
    ]' > "$RL_STATE_DIR/claims.json"
    echo '[]' > "$RL_STATE_DIR/queue.json"
    echo '[]' > "$RL_STATE_DIR/env-registry.json"
    mkdir -p "$RL_TASKS_DIR"
}

# Parent task JSON on slot 1 (NOT slot 2, so the §1 running-task guard cannot
# be what saves slot 2). $1 = status; running gets a fresh pidfile.
_seed_parent() {
    jq -n --arg id "$PARENT" --arg st "$1" --arg t "$(date -u +%FT%TZ)" \
        '{task_id:$id, tool:"rl_validate_ci", slot:1, agent_id:"owner", status:$st, pid:4242,
          started_at:$t, finished_at:(if $st == "running" then null else $t end), steps:[]}' \
        > "$RL_TASKS_DIR/$PARENT.json"
    [[ "$1" == "running" ]] && echo 4242 > "$RL_TASKS_DIR/$PARENT.pid"
    return 0
}

# docker shim: every rl.slot=N query returns a preserved env on that slot.
_shim() {
    SHIM_DIR=$(mktemp -d -t rl-borrow-shim.XXXXXX); REAP_LOG="$RL_STATE_DIR/reap.log"; : > "$REAP_LOG"
    cat > "$SHIM_DIR/docker" <<SH
#!/usr/bin/env bash
case "\$1" in
    ps) [[ "\$*" == *"rl.slot="* ]] && echo "keepslug keepcid001" ;;
    inspect) case "\$*" in *Health.Status*) echo healthy ;; *StartedAt*) date -u +%FT%TZ ;; *Config.Labels*) echo '{}' ;; esac ;;
    rm|volume|image|container) echo "docker \$*" >> "$REAP_LOG" ;;
esac
exit 0
SH
    chmod +x "$SHIM_DIR/docker"
}

_sweep() {
    local sd="$RL_STATE_DIR" td="$RL_TASKS_DIR"
    PATH="$SHIM_DIR:$PATH" STATE_DIR="$sd" TASKS_DIR="$td" TASK_CANCEL_BIN="${TASK_CANCEL_BIN:-}" CLAIM_HEARTBEAT_TIMEOUT_SECONDS=120 \
        bash "$SWEEP_SCRIPT" >/dev/null 2>&1 || true
    rm -rf "$SHIM_DIR"
}

_row2() { jq -c '.[] | select(.slot == 2) | {claimed, agent_id, borrowed_for}' "$RL_STATE_DIR/claims.json"; }

test_live_borrow_left_alone() {
    CURRENT_TEST_NAME="live borrow (parent running) with stale heartbeat + age -> untouched, no env destroyed"
    _seed; _seed_parent running; _shim; _sweep
    assert_eq "$(_row2)" "{\"claimed\":true,\"agent_id\":\"borrow-$PARENT\",\"borrowed_for\":\"$PARENT\"}" \
        "§1/§1b' must skip a borrowed_for row while its parent runs"
    assert_eq "$(grep -c keepcid001 "$REAP_LOG")" "0" "slot B's preserved env must never be destroyed"
}

test_orphan_terminal_parent_released() {
    CURRENT_TEST_NAME="orphan borrow (parent succeeded) -> row freed, no env destroyed"
    _seed; _seed_parent succeeded; _shim; _sweep
    assert_eq "$(_row2)" '{"claimed":false,"agent_id":null,"borrowed_for":null}' "terminal parent -> borrow row released"
    assert_eq "$(grep -c keepcid001 "$REAP_LOG")" "0" "orphan release never destroys envs"
    assert_contains "$(cat "$RL_STATE_DIR/audit.log" 2>/dev/null)" "borrow_orphan_released" "audit line written"
}

test_orphan_missing_parent_released() {
    CURRENT_TEST_NAME="orphan borrow (parent JSON missing) -> row freed"
    _seed; _shim; _sweep
    assert_eq "$(_row2 | jq -r .claimed)" "false" "missing parent JSON -> borrow row released"
    assert_eq "$(jq -r '.[] | select(.slot == 1) | .agent_id' "$RL_STATE_DIR/claims.json")" "owner" "owner row untouched"
}

# Child task on borrowed slot 2. $1 = status, $2 = "listed" (in P's children[])
# or "linked" (only parent_task_id points at P). Running gets a fresh pidfile.
_seed_child() {
    local cid="${PARENT}b"
    jq -n --arg id "$cid" --arg st "$1" --arg p "$PARENT" --arg t "$(date -u +%FT%TZ)" \
        '{task_id:$id, tool:"rl_validate_ci", slot:2, agent_id:("borrow-" + $p), status:$st, pid:4343,
          parent_task_id:$p, started_at:$t, finished_at:(if $st == "running" then null else $t end), steps:[]}' \
        > "$RL_TASKS_DIR/$cid.json"
    [[ "$1" == "running" ]] && echo 4343 > "$RL_TASKS_DIR/$cid.pid"
    if [[ "${2:-listed}" == "listed" && -f "$RL_TASKS_DIR/$PARENT.json" ]]; then
        jq --arg id "$cid" '.children = [{task_id:$id, role:"b", slot:2, borrowed:true}]' \
            "$RL_TASKS_DIR/$PARENT.json" > "$RL_TASKS_DIR/p.tmp" && mv "$RL_TASKS_DIR/p.tmp" "$RL_TASKS_DIR/$PARENT.json"
    fi
    return 0
}

# task-cancel shim: records each call so the case can assert the cascade ask.
_cancel_shim() {
    CANCEL_LOG="$RL_STATE_DIR/cancel.log"; : > "$CANCEL_LOG"
    printf '#!/usr/bin/env bash\necho "$1" >> %q\n' "$CANCEL_LOG" > "$RL_STATE_DIR/task-cancel"
    chmod +x "$RL_STATE_DIR/task-cancel"
    export TASK_CANCEL_BIN="$RL_STATE_DIR/task-cancel"
}

test_orphan_with_running_child_kept_and_child_cancelled() {
    CURRENT_TEST_NAME="orphan borrow (parent failed) whose child still runs on B -> row kept, child cancelled"
    _seed; _seed_parent failed; _seed_child running listed; _cancel_shim; _shim; _sweep
    assert_eq "$(_row2)" "{\"claimed\":true,\"agent_id\":\"borrow-$PARENT\",\"borrowed_for\":\"$PARENT\"}" \
        "a running child keeps slot B borrowed"
    assert_eq "$(cat "$CANCEL_LOG")" "${PARENT}b" "the running child is cancelled through task-cancel"
    unset TASK_CANCEL_BIN
}

test_orphan_missing_parent_linked_child_running_kept() {
    CURRENT_TEST_NAME="orphan borrow (parent JSON missing) with a parent_task_id-linked running child -> row kept"
    _seed; _seed_child running linked; _cancel_shim; _shim; _sweep
    assert_eq "$(_row2 | jq -r .claimed)" "true" "a child found by parent_task_id keeps slot B borrowed"
    assert_eq "$(cat "$CANCEL_LOG")" "${PARENT}b" "the linked child is cancelled"
    unset TASK_CANCEL_BIN
}

test_orphan_all_children_terminal_released() {
    CURRENT_TEST_NAME="orphan borrow (parent failed) whose children are all terminal -> row freed, nothing cancelled"
    _seed; _seed_parent failed; _seed_child succeeded listed; _cancel_shim; _shim; _sweep
    assert_eq "$(_row2)" '{"claimed":false,"agent_id":null,"borrowed_for":null}' "all children terminal -> released"
    assert_eq "$(wc -c < "$CANCEL_LOG" | tr -d ' ')" "0" "no cancel for terminal children"
    unset TASK_CANCEL_BIN
}

test_stale_borrowed_for_on_new_owner_left_alone() {
    CURRENT_TEST_NAME="row re-claimed by a real agent with a stale borrowed_for -> orphan rule never frees it"
    _seed; _seed_parent succeeded
    jq '(.[] | select(.slot == 2)) |= (.agent_id = "new-owner" | .started_at = (now | todate) | .last_heartbeat = (now | todate))' \
        "$RL_STATE_DIR/claims.json" > "$RL_STATE_DIR/c.tmp" && mv "$RL_STATE_DIR/c.tmp" "$RL_STATE_DIR/claims.json"
    _shim; _sweep
    assert_eq "$(_row2 | jq -c '{claimed, agent_id}')" '{"claimed":true,"agent_id":"new-owner"}' "a non-borrow-<parent> agent's claim is never released by the orphan rule"
    assert_eq "$(grep -c borrow_orphan_released "$RL_STATE_DIR/audit.log" 2>/dev/null || true)" "0" "no orphan release audited"
}

run_test "stale-borrowed-for-new-owner" test_stale_borrowed_for_on_new_owner_left_alone
run_test "orphan-running-child-kept" test_orphan_with_running_child_kept_and_child_cancelled
run_test "orphan-linked-child-kept" test_orphan_missing_parent_linked_child_running_kept
run_test "orphan-children-terminal-released" test_orphan_all_children_terminal_released
run_test "live-borrow-left-alone" test_live_borrow_left_alone
run_test "orphan-terminal-parent-released" test_orphan_terminal_parent_released
run_test "orphan-missing-parent-released" test_orphan_missing_parent_released

print_test_summary
