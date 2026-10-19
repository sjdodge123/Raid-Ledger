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
    PATH="$SHIM_DIR:$PATH" STATE_DIR="$sd" TASKS_DIR="$td" CLAIM_HEARTBEAT_TIMEOUT_SECONDS=120 \
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

run_test "live-borrow-left-alone" test_live_borrow_left_alone
run_test "orphan-terminal-parent-released" test_orphan_terminal_parent_released
run_test "orphan-missing-parent-released" test_orphan_missing_parent_released

print_test_summary
