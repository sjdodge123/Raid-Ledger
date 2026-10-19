#!/usr/bin/env bash
# ROK-1793 S2 — bin/gate-fanout: borrow a free second slot, copy the tree,
# dispatch child A (owning slot) + child B (borrowed slot) through task-start,
# relay their step lines, optional phase-2 child C, and release the borrow on
# EVERY exit path. task-start / task-cancel / run-on-runner-with-heartbeat /
# docker are PATH shims; no container is touched.
set -uo pipefail

CURRENT_TEST_FILE="gate-fanout.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

P="fanoutpar01"

# $1 = slot-2 state ("free"|"busy"), $2 = MemAvailable MB.
_seed() {
    export RUNNER_SLOTS=2 RL_MEMINFO_PATH="$RL_STATE_DIR/meminfo" RL_RUNNERS_DIR="$RL_STATE_DIR/runners"
    export RL_FANOUT_POLL_SECONDS=0.1 RL_AGENT_ID="real-agent" CALLS="$RL_STATE_DIR/calls.log"
    printf 'MemTotal: 32000000 kB\nMemAvailable: %s kB\n' "$(( ${2:-16000} * 1024 ))" > "$RL_MEMINFO_PATH"
    local t; t=$(date -u +%FT%TZ)
    jq -n --arg t "$t" --arg s2 "${1:-free}" '[
        {slot:1, claimed:true, agent_id:"real-agent", branch:"feat", started_at:$t, last_heartbeat:$t, expires_at:null, keep_alive:false, extends_count:0},
        (if $s2 == "busy" then {slot:2, claimed:true, agent_id:"other", branch:"o", started_at:$t, last_heartbeat:$t, expires_at:null, keep_alive:false, extends_count:0}
         else {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, expires_at:null, keep_alive:false, extends_count:0} end)
    ]' > "$RL_STATE_DIR/claims.json"
    mkdir -p "$RL_STATE_DIR/lease-queue" "$RL_TASKS_DIR" "$RL_RUNNERS_DIR/slot-1/worktree" "$RL_RUNNERS_DIR/slot-2/worktree"
    echo hi > "$RL_RUNNERS_DIR/slot-1/worktree/f.txt"
    jq -n --arg id "$P" '{task_id:$id, status:"running", slot:1, steps:[]}' > "$RL_TASKS_DIR/$P.json"
    : > "$CALLS"
    _shims
}

# Child behaviour per role (last char of the child id): SHIM_A / SHIM_B / SHIM_C
# = pass | fail | hang | defer.
_shims() {
    SHIM_DIR="$RL_STATE_DIR/shims"; mkdir -p "$SHIM_DIR"
    cat > "$SHIM_DIR/task-start" <<'SH'
#!/usr/bin/env bash
id="$1"; shift; slot=""; weight=""
while [[ $# -gt 0 ]]; do case "$1" in --slot) slot="$2"; shift 2;; --weight) weight="$2"; shift 2;; --) shift; break;; *) shift;; esac; done
role="${id: -1}"; mode_var="SHIM_$(echo "$role" | tr a-z A-Z)"; mode="${!mode_var:-pass}"
echo "start $id role=$role slot=$slot weight=$weight agent=${RL_AGENT_ID:-} parent=${RL_PARENT_TASK_ID:-} cmd=$*" >> "$CALLS"
st=succeeded; log=""
case "$mode" in
  pass)  log=$'[step-time] Build 1.0\nBuild: PASS\nnoise line' ;;
  fail)  st=failed; log=$'[step-time] Unit tests 2.0\nUnit tests: FAIL' ;;
  defer) log=$'[parallel] discord-deferred\nPlaywright: PASS' ;;
  hang)  st=running ;;
esac
printf '%s\n' "$log" > "$RL_TASKS_DIR/$id.log"
jq -n --arg id "$id" --arg st "$st" --argjson s "$slot" '{task_id:$id, status:$st, slot:$s}' > "$RL_TASKS_DIR/$id.json"
echo "{\"ok\":true,\"task_id\":\"$id\"}"
SH
    cat > "$SHIM_DIR/task-cancel" <<'SH'
#!/usr/bin/env bash
echo "cancel $1" >> "$CALLS"
f="$RL_TASKS_DIR/$1.json"; [[ -f "$f" ]] && jq '.status = "cancelled"' "$f" > "$f.t" && mv "$f.t" "$f"
exit 0
SH
    cat > "$SHIM_DIR/run-on-runner-with-heartbeat" <<'SH'
#!/usr/bin/env bash
echo "serial agent=${RL_AGENT_ID:-} $*" >> "$CALLS"; echo "Build: PASS"; exit "${SHIM_SERIAL_RC:-0}"
SH
    printf '#!/usr/bin/env bash\nexit 0\n' > "$SHIM_DIR/docker"
    printf '#!/usr/bin/env bash\necho "MERGED $1"; exit 0\n' > "$SHIM_DIR/merge"
    chmod +x "$SHIM_DIR"/*
    export RL_GATE_MERGE="$SHIM_DIR/merge"
}

_fanout() {
    PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" \
        --inner-env "BASE_URL='https://slot-1.x' " --a-args "--fleet --no-e2e" --b-args "--only-e2e" \
        --serial-args "--fleet" "$@" 2>&1
}
_slot2() { jq -c '.[] | select(.slot == 2) | {claimed, agent_id}' "$RL_STATE_DIR/claims.json"; }
_children() { jq -c '[(.children // [])[] | {role, slot, borrowed}]' "$RL_TASKS_DIR/$P.json"; }

test_fallback_no_free_slot() {
    CURRENT_TEST_NAME="no free slot -> serial fallback line, serial args on A, exit passthrough"
    _seed busy; export SHIM_SERIAL_RC=7
    local out rc=0; out=$(_fanout) || rc=$?
    assert_contains "$out" "[parallel] fallback: serial (no free slot)" "fallback line printed"
    assert_contains "$(cat "$CALLS")" "serial agent=real-agent" "serial run on the owner's slot"
    assert_contains "$(cat "$CALLS")" "validate-ci.sh --fleet" "serial args forwarded"
    assert_exit_code "$rc" "7" "serial exit code passes through"
    assert_eq "$(grep -c '^start' "$CALLS")" "0" "no child dispatched"
    unset SHIM_SERIAL_RC
}

test_fallback_memory() {
    CURRENT_TEST_NAME="low memory -> serial (memory) fallback, nothing borrowed"
    _seed free 4000
    local out; out=$(_fanout) || true
    assert_contains "$out" "[parallel] fallback: serial (memory)" "memory fallback line"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "slot 2 never borrowed"
}

test_parallel_two_children() {
    CURRENT_TEST_NAME="parallel: 2 children recorded, env contract per child, relay, merge, release"
    _seed free
    local out rc=0; out=$(_fanout) || rc=$?
    assert_eq "$(_children)" '[{"role":"a","slot":1,"borrowed":false},{"role":"b","slot":2,"borrowed":true}]' "children[] on P"
    local a b; a=$(grep 'role=a' "$CALLS"); b=$(grep 'role=b' "$CALLS")
    assert_contains "$a" "slot=1 weight=heavy agent=real-agent parent=$P" "child A dispatch"
    assert_contains "$a" "RL_GATE_E2E=deferred bash /workspace/scripts/validate-ci.sh --fleet --no-e2e" "child A env + args"
    assert_contains "$a" "BASE_URL='https://slot-1.x'" "inner env reaches child A"
    assert_contains "$b" "slot=2 weight=medium agent=borrow-$P parent=$P" "child B dispatch"
    assert_contains "$b" "RL_GATE_DISCORD=defer bash /workspace/scripts/validate-ci.sh --only-e2e" "child B env + args"
    assert_contains "$out" $'[step-time] Build 1.0\nBuild: PASS' "step lines relayed raw"
    assert_eq "$(grep -c 'noise line' <<<"$out")" "0" "non-step lines are not relayed"
    assert_contains "$out" "[parallel] borrowed slot 2" "borrow line"
    assert_contains "$out" "[parallel] copy slot 1→2" "copy line"
    assert_contains "$out" "MERGED $P" "merge exec'd with P"
    assert_exit_code "$rc" "0" "exit = merge's"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "borrow released"
    assert_eq "$(grep -c 'role=c' "$CALLS")" "0" "no phase 2 without the discord-deferred marker"
}

test_phase2_child_c() {
    CURRENT_TEST_NAME="B prints discord-deferred -> child C on A with RL_GATE_DISCORD=only"
    _seed free; export SHIM_B=defer
    _fanout >/dev/null || true
    assert_contains "$(grep 'role=c' "$CALLS")" "slot=1 weight=light agent=real-agent parent=$P" "child C dispatch"
    assert_contains "$(grep 'role=c' "$CALLS")" "RL_GATE_DISCORD=only bash /workspace/scripts/validate-ci.sh --only-e2e" "child C env"
    assert_eq "$(_children | jq -c '.[2]')" '{"role":"c","slot":1,"borrowed":false}' "C recorded"
    unset SHIM_B
}

test_copy_failure_falls_back() {
    CURRENT_TEST_NAME="copy failure -> release + serial (copy failed)"
    _seed free; rm -rf "$RL_RUNNERS_DIR/slot-2/worktree"
    local out; out=$(_fanout) || true
    assert_contains "$out" "[parallel] fallback: serial (copy failed)" "copy fallback line"
    assert_contains "$(cat "$CALLS")" "serial agent=real-agent" "serial run"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "borrow released after copy failure"
}

test_fail_fast_cancels_sibling() {
    CURRENT_TEST_NAME="--fail-fast: A FAILs -> B cancelled, borrow released"
    _seed free; export SHIM_A=fail SHIM_B=hang
    _fanout --fail-fast >/dev/null || true
    assert_contains "$(cat "$CALLS")" "cancel ${P}b" "sibling B cancelled"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "borrow released"
    unset SHIM_A SHIM_B
}

test_term_cancels_both() {
    CURRENT_TEST_NAME="TERM on P -> both children cancelled, borrow released"
    _seed free; export SHIM_A=hang SHIM_B=hang
    PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" --inner-env "" \
        --a-args "--fleet --no-e2e" --b-args "--only-e2e" --serial-args "--fleet" >/dev/null 2>&1 &
    local pid=$! i
    for i in $(seq 1 100); do [[ "$(_children | jq length)" == "2" ]] && break; sleep 0.1; done
    kill -TERM "$pid"; wait "$pid" 2>/dev/null
    assert_contains "$(cat "$CALLS")" "cancel ${P}a" "child A cancelled"
    assert_contains "$(cat "$CALLS")" "cancel ${P}b" "child B cancelled"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "borrow released on TERM"
    unset SHIM_A SHIM_B
}

test_merge_missing() {
    CURRENT_TEST_NAME="no _gate_merge.sh -> merge: not available, exit 1, borrow released"
    _seed free; export RL_GATE_MERGE="$RL_STATE_DIR/nope.sh"
    local out rc=0; out=$(_fanout) || rc=$?
    assert_contains "$out" "[parallel] merge: not available" "merge-missing line"
    assert_exit_code "$rc" "1" "exit 1"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "borrow released"
}

run_test "fallback-no-free-slot" test_fallback_no_free_slot
run_test "fallback-memory" test_fallback_memory
run_test "parallel-two-children" test_parallel_two_children
run_test "phase2-child-c" test_phase2_child_c
run_test "copy-failure-falls-back" test_copy_failure_falls_back
run_test "fail-fast-cancels-sibling" test_fail_fast_cancels_sibling
run_test "term-cancels-both" test_term_cancels_both
run_test "merge-missing" test_merge_missing

print_test_summary
