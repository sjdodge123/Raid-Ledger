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
# shellcheck disable=SC1091
source "$TEST_DIR/drain_shim.sh"

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
jq -n --arg id "$id" --arg st "$st" --argjson s "$slot" '{task_id:$id, status:$st, slot:$s, script_exit_code:({succeeded:0, failed:1}[$st])}' > "$RL_TASKS_DIR/$id.json"
echo "{\"ok\":true,\"task_id\":\"$id\"}"
SH
    cat > "$SHIM_DIR/task-cancel" <<'SH'
#!/usr/bin/env bash
echo "cancel $1 reason=${2:-}" >> "$CALLS"
f="$RL_TASKS_DIR/$1.json"; [[ -f "$f" ]] && jq '.status = "cancelled"' "$f" > "$f.t" && mv "$f.t" "$f"
exit 0
SH
    cat > "$SHIM_DIR/run-on-runner-with-heartbeat" <<'SH'
#!/usr/bin/env bash
echo "serial agent=${RL_AGENT_ID:-} $*" >> "$CALLS"; echo "Build: PASS"
[[ "${SHIM_SERIAL_HANG:-0}" == 1 ]] && exec sleep 20
exit "${SHIM_SERIAL_RC:-0}"
SH
    # docker: success; the runner-drain scan reports no marked process.
    printf '#!/usr/bin/env bash\n[[ " $* " == *" rl-drain "* ]] && echo drained=0\nexit 0\n' > "$SHIM_DIR/docker"
    printf '#!/usr/bin/env bash\necho "MERGED $1"; exit 0\n' > "$SHIM_DIR/merge"
    chmod +x "$SHIM_DIR"/*
    export RL_GATE_MERGE="$SHIM_DIR/merge"
}

_fanout() {
    PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" \
        --inner-env "BASE_URL='https://slot-1.x' " --a-args "--fleet --no-e2e" --b-args "--only-e2e" \
        --serial-args "--fleet" "$@" 2>&1
}
# Like _fanout but bounded: a run still alive after ~10 s is TERMed (a broken
# fail-fast would otherwise wait on a hanging child forever).
_fanout_bounded() {
    PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" --inner-env "" \
        --a-args "--fleet --no-e2e" --b-args "--only-e2e" --serial-args "--fleet" "$@" >/dev/null 2>&1 &
    local pid=$! i
    for i in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -TERM "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    return 0
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

# Codex r6 P2: the serial fallback must honour --child-timeout like a child
# does — a hung serial run is TERMed at the deadline (exit 124), not left to
# P's 2×child+3300 s budget.
test_serial_fallback_bounded_by_child_timeout() {
    CURRENT_TEST_NAME="serial fallback (no free slot) is killed at --child-timeout"
    _seed busy; export SHIM_SERIAL_HANG=1 RL_FANOUT_KILL_GRACE_SECONDS=1
    local out rc=0 t0=$SECONDS; out=$(_fanout --child-timeout 1) || rc=$?
    local took=$((SECONDS - t0))
    assert_contains "$out" "[parallel] serial fallback timeout (1s) reached" "watchdog line printed"
    assert_exit_code "$rc" "124" "timed-out serial run exits 124"
    assert_eq "$(( took < 10 ))" "1" "serial run bounded by --child-timeout 1 (took ${took}s, hang is 20s)"
    unset SHIM_SERIAL_HANG RL_FANOUT_KILL_GRACE_SECONDS
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
    _fanout_bounded --fail-fast
    assert_contains "$(cat "$CALLS")" "cancel ${P}b reason=fail_fast" "sibling B cancelled by fail-fast (not by a kill)"
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

test_specs_env_only_reaches_e2e_children() {
    CURRENT_TEST_NAME="E2E_SPECS/E2E_SCOPE never reach child A (--no-e2e would exit 2); B and serial keep them"
    _seed free
    PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" \
        --inner-env "E2E_SCOPE='auto' E2E_SPECS='scripts/smoke/a.smoke.spec.ts' " --a-args "--fleet --no-e2e" \
        --b-args "--only-e2e" --serial-args "--fleet" >/dev/null 2>&1 || true
    local a b; a=$(grep 'role=a' "$CALLS"); b=$(grep 'role=b' "$CALLS")
    assert_contains "$a" "env -u E2E_SPECS -u E2E_SCOPE RL_GATE_E2E=deferred bash /workspace/scripts/validate-ci.sh --fleet --no-e2e" "A unsets both"
    assert_eq "$(grep -c 'env -u' <<<"$b")" "0" "B is not stripped"
    assert_contains "$b" "E2E_SPECS='scripts/smoke/a.smoke.spec.ts' RL_GATE_DISCORD=defer bash" "B keeps E2E_SPECS"
}

test_children_record_outcome() {
    CURRENT_TEST_NAME="children[] carries each child's terminal status + exit"
    _seed free; export SHIM_B=fail
    _fanout >/dev/null || true
    assert_eq "$(jq -c '[.children[] | {role, status, exit}]' "$RL_TASKS_DIR/$P.json")" \
        '[{"role":"a","status":"succeeded","exit":0},{"role":"b","status":"failed","exit":1}]' "status + exit per child"
}

test_force_serial() {
    CURRENT_TEST_NAME="--force-serial <reason> (MCP could not enumerate Mutagen slots) -> serial, nothing borrowed"
    _seed free
    local out rc=0; out=$(_fanout --force-serial "slot enumeration failed") || rc=$?
    assert_contains "$out" "[parallel] fallback: serial (slot enumeration failed)" "fallback line names the reason"
    assert_eq "$(grep -c '^start' "$CALLS")" "0" "no child dispatched"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "slot 2 never borrowed"
    assert_eq "$(jq -r '.parallel.mode' "$RL_TASKS_DIR/$P.json")" "serial_fallback" "P records serial_fallback"
    assert_exit_code "$rc" "0" "serial exit passes through"
}

test_b_released_when_b_finishes() {
    CURRENT_TEST_NAME="B terminal while A runs -> borrow released before A ends; final release is a no-op"
    _seed free; export SHIM_A=hang SHIM_B=pass
    PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" --inner-env "" \
        --a-args "--fleet --no-e2e" --b-args "--only-e2e" --serial-args "--fleet" >/dev/null 2>&1 &
    local pid=$! i released=no
    for i in $(seq 1 100); do
        if [[ "$(_children | jq length)" == "2" && "$(_slot2)" == '{"claimed":false,"agent_id":null}' ]]; then released=yes; break; fi
        sleep 0.1
    done
    assert_eq "$released" "yes" "slot 2 released while A still runs"
    assert_eq "$(jq -r .status "$RL_TASKS_DIR/${P}a.json")" "running" "A was still running at release"
    local f="$RL_TASKS_DIR/${P}a.json"; jq '.status = "succeeded" | .script_exit_code = 0' "$f" > "$f.t" && mv "$f.t" "$f"
    for i in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -TERM "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    assert_eq "$(jq -s '[.[] | select(.cmd == "borrow" and .outcome == "released")] | length' "$RL_STATE_DIR/audit.log")" "1" "exactly one borrow release audited (the post-wait + trap releases are no-ops)"
    unset SHIM_A SHIM_B
}

# Runner-side drain: `exec rl-runner-2 sh -c <scan> rl-drain …` goes to the
# shared drain fake (drain_shim.sh), which logs slot 2's claimed flag AT EACH
# call, so the order "drained, then released" is observable in $CALLS.
_drain_docker_shim() {
    write_drain_shim "$SHIM_DIR/drain-shim" "$CALLS"
    printf '#!/usr/bin/env bash\n[[ " $* " == *" rl-drain "* ]] && exec %q "$@"\nexit 0\n' "$SHIM_DIR/drain-shim" > "$SHIM_DIR/docker"
    chmod +x "$SHIM_DIR/docker"
    echo "${P}b" > "$RL_STATE_DIR/procs"
}

_run_b_done_a_ok() {
    PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" --inner-env "" \
        --a-args "--fleet --no-e2e" --b-args "--only-e2e" --serial-args "--fleet" >/dev/null 2>&1
}

test_b_drained_before_release() {
    CURRENT_TEST_NAME="B's runner-side processes are drained before the borrowed slot is released"
    _seed free; _drain_docker_shim; export SHIM_LINGER=1 RL_FANOUT_DRAIN_POLL_SECONDS=0.1
    _run_b_done_a_ok
    assert_eq "$(grep '^scan' "$CALLS" | head -2 | tr '\n' '|')" "scan claimed=true|scan claimed=true|" "slot 2 still borrowed while a B process lingers and at the all-clear poll"
    assert_eq "$(grep -c '^kill' "$CALLS")" "0" "no kill when the process exits on its own"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "slot 2 released after the drain"
    unset SHIM_LINGER RL_FANOUT_DRAIN_POLL_SECONDS
}

test_b_lingering_killed_before_release() {
    CURRENT_TEST_NAME="B's processes that outlive the drain window are killed, then the slot is released"
    _seed free; _drain_docker_shim; export SHIM_LINGER=999 RL_FANOUT_DRAIN_SECONDS=0.3 RL_FANOUT_DRAIN_POLL_SECONDS=0.1
    echo "otherproc01" >> "$RL_STATE_DIR/procs"
    _run_b_done_a_ok
    assert_eq "$(grep '^kill' "$CALLS" | head -1)" "kill claimed=true tids=${P}b" "lingering B processes killed by B's RL_TASK_ID marker while slot 2 is still borrowed"
    assert_eq "$(cat "$RL_STATE_DIR/procs")" "otherproc01" "an unmarked process on runner B is left alone"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "slot 2 released after the kill"
    unset SHIM_LINGER RL_FANOUT_DRAIN_SECONDS RL_FANOUT_DRAIN_POLL_SECONDS
}

# Codex r4 P2: the owner slot must be the DISPATCHING agent's claim — else an
# unclaimed agent would borrow B and copy another agent's workspace onto it.
test_owner_slot_not_callers_refused() {
    CURRENT_TEST_NAME="owner slot claimed by another agent (or no RL_AGENT_ID) -> refused before borrow/copy"
    local rc=0 rc2=0
    _seed free
    RL_AGENT_ID="intruder" PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" \
        --inner-env "" --a-args "--fleet" --b-args "--only-e2e" --serial-args "--fleet" >/dev/null 2>&1 || rc=$?
    assert_eq "$rc" "2" "foreign owner slot -> exit 2"
    assert_eq "$(_slot2)" '{"claimed":false,"agent_id":null}' "slot 2 never borrowed"
    assert_eq "$(wc -c < "$CALLS" | tr -d ' ')" "0" "no child, no serial run dispatched"
    RL_AGENT_ID="" PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" \
        --inner-env "" --a-args "--fleet" --b-args "--only-e2e" --serial-args "--fleet" >/dev/null 2>&1 || rc2=$?
    assert_eq "$rc2" "2" "no dispatching agent id -> exit 2 (no fallback to the slot's owner)"
    assert_eq "$(wc -c < "$CALLS" | tr -d ' ')" "0" "still nothing dispatched"
}

# Codex r5 P2: a drain that fails (exec error mid-scan, or marked survivors
# after SIGKILL) keeps the borrow reserved for the sweeper — never released.
test_b_drain_exec_error_keeps_borrow() {
    CURRENT_TEST_NAME="drain scan exec error -> borrow kept, failure printed"
    _seed free; _drain_docker_shim; export SHIM_SCAN_ERR=1
    local out; out=$(PATH="$SHIM_DIR:$PATH" bash "$BIN_DIR/gate-fanout" "$P" --owner-slot 1 --exclude-slots "" --inner-env "" \
        --a-args "--fleet --no-e2e" --b-args "--only-e2e" --serial-args "--fleet" 2>&1)
    assert_eq "$(_slot2)" "{\"claimed\":true,\"agent_id\":\"borrow-$P\"}" "borrow stays reserved"
    assert_contains "$out" "[parallel] drain failed — borrow kept for the sweeper" "failure is reported"
    unset SHIM_SCAN_ERR
}

test_b_survivors_after_kill_keep_borrow() {
    CURRENT_TEST_NAME="marked B processes survive SIGKILL -> borrow kept"
    _seed free; _drain_docker_shim; export SHIM_LINGER=999 SHIM_SURVIVE=1 RL_FANOUT_DRAIN_SECONDS=0.3 RL_FANOUT_DRAIN_POLL_SECONDS=0.1
    _run_b_done_a_ok
    assert_eq "$(grep -c '^kill' "$CALLS")" "1" "the kill was attempted once"
    assert_eq "$(_slot2)" "{\"claimed\":true,\"agent_id\":\"borrow-$P\"}" "survivors keep the borrow reserved"
    unset SHIM_LINGER SHIM_SURVIVE RL_FANOUT_DRAIN_SECONDS RL_FANOUT_DRAIN_POLL_SECONDS
}

run_test "b-drain-exec-error-keeps-borrow" test_b_drain_exec_error_keeps_borrow
run_test "b-survivors-after-kill-keep-borrow" test_b_survivors_after_kill_keep_borrow
run_test "owner-slot-not-callers-refused" test_owner_slot_not_callers_refused
run_test "b-drained-before-release" test_b_drained_before_release
run_test "b-lingering-killed-before-release" test_b_lingering_killed_before_release
run_test "force-serial" test_force_serial
run_test "b-released-when-b-finishes" test_b_released_when_b_finishes
run_test "specs-env-only-e2e-children" test_specs_env_only_reaches_e2e_children
run_test "children-record-outcome" test_children_record_outcome
run_test "fallback-no-free-slot" test_fallback_no_free_slot
run_test "fallback-memory" test_fallback_memory
run_test "serial-fallback-bounded-by-child-timeout" test_serial_fallback_bounded_by_child_timeout
run_test "parallel-two-children" test_parallel_two_children
run_test "phase2-child-c" test_phase2_child_c
run_test "copy-failure-falls-back" test_copy_failure_falls_back
run_test "fail-fast-cancels-sibling" test_fail_fast_cancels_sibling
run_test "term-cancels-both" test_term_cancels_both
run_test "merge-missing" test_merge_missing

print_test_summary
