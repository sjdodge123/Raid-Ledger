#!/usr/bin/env bash
# ROK-1470 — dynamic fleet memory: heavy-task admission control.
#
# The VM stays at 15 GiB and the runners share it dynamically (6g cap /
# 2g reservation each) instead of being tiered. Over-subscription is made
# safe by an admission gate: a task started with `--weight heavy` waits
# until the HOST's MemAvailable is at or above RL_HEAVY_TASK_MIN_FREE_MB
# before its wrapped command is launched. Light tasks are never gated.
#
# These tests run LOCALLY on the operator's mac (no VM, no docker for the
# task-start cases). /proc/meminfo is faked via RL_MEMINFO_PATH.
#
# Covered:
#   AC2-a  task-start accepts --weight heavy|light (default light)
#   AC2-b  invalid --weight is rejected with exit 2
#   AC2-c  heavy proceeds immediately when MemAvailable >= floor
#   AC2-d  heavy waits below the floor and logs
#          `waiting for memory: available=…MB need=…MB (N heavy running)`
#   AC2-e  heavy fails with `admission_timeout` once the budget expires
#   AC2-f  light tasks are never gated
#   AC2-g  the heavy counter increments while running and decrements after
#          BOTH success and failure
#   AC2-h  lease-status surfaces heavy_running / heavy_waiting / mem_available_mb
#   AC2-i  run-on-runner-with-heartbeat accepts --weight and skips the gate
#          when an ancestor task already holds admission (RL_ADMISSION_HELD)

set -uo pipefail

CURRENT_TEST_FILE="task-admission.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ADMISSION_JSON=""

# Write a fake /proc/meminfo whose MemAvailable is <mb> megabytes, and point
# the orchestrator at it. Shape mirrors the real file (kB units, same keys).
fake_meminfo() {
    local mb="$1"
    local kb=$(( mb * 1024 ))
    cat > "$RL_STATE_DIR/meminfo" <<EOF
MemTotal:       15728640 kB
MemFree:          524288 kB
MemAvailable:   ${kb} kB
Buffers:          131072 kB
Cached:          2097152 kB
EOF
    export RL_MEMINFO_PATH="$RL_STATE_DIR/meminfo"
    ADMISSION_JSON="$RL_STATE_DIR/admission.json"
}

# Fast polling so the tests finish in seconds instead of the 10s/1800s defaults.
fast_admission_env() {
    export RL_HEAVY_TASK_POLL_SECONDS=1
    export RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS="${1:-3}"
    export RL_HEAVY_TASK_MIN_FREE_MB="${2:-5120}"
}

# Poll a task's JSON until .status is terminal (or timeout). Echoes the status.
wait_for_terminal_status() {
    local task_id="$1" budget="${2:-15}"
    local json="$RL_TASKS_DIR/$task_id.json"
    local waited=0 status="missing"
    while (( waited < budget * 10 )); do
        status=$(jq -r '.status // "missing"' "$json" 2>/dev/null || echo "missing")
        case "$status" in
            succeeded|failed|cancelled) echo "$status"; return 0 ;;
        esac
        sleep 0.1
        waited=$((waited + 1))
    done
    echo "$status"
}

# Echo the number of entries in a section of the admission state file.
admission_count() {
    local section="$1"
    jq -r --arg s "$section" '(.[$s] // []) | length' "$ADMISSION_JSON" 2>/dev/null || echo "missing"
}

# AC2-a: --weight is accepted and persisted; the default is light.
test_weight_flag_accepted_and_defaults_light() {
    CURRENT_TEST_NAME="AC2-a: task-start accepts --weight and defaults to light"
    fake_meminfo 12000
    fast_admission_env

    local out exit_code=0
    out=$("$BIN_DIR/task-start" "aaaa1111" --tool manual --slot 1 --weight heavy -- /bin/sh -c "exit 0" 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "--weight heavy must be accepted"
    local ok
    ok=$(echo "$out" | jq -r '.ok' 2>/dev/null || echo "parse_err")
    assert_eq "$ok" "true" "task-start must still emit {ok:true}"
    local weight
    weight=$(jq -r '.weight // "absent"' "$RL_TASKS_DIR/aaaa1111.json" 2>/dev/null || echo "parse_err")
    assert_eq "$weight" "heavy" "task JSON must persist weight=heavy"

    "$BIN_DIR/task-start" "aaaa2222" --tool manual --slot 1 -- /bin/sh -c "exit 0" >/dev/null 2>&1 || true
    weight=$(jq -r '.weight // "absent"' "$RL_TASKS_DIR/aaaa2222.json" 2>/dev/null || echo "parse_err")
    assert_eq "$weight" "light" "omitted --weight must default to light"
}

# AC2-b: a bogus weight is a hard validation error, not a silent downgrade.
test_invalid_weight_rejected() {
    CURRENT_TEST_NAME="AC2-b: invalid --weight rejected with exit 2"
    local out exit_code=0
    out=$("$BIN_DIR/task-start" "bbbb1111" --tool manual --slot 1 --weight enormous -- /bin/sh -c "exit 0" 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "2" "invalid weight must exit 2"
    assert_contains "$out" "invalid_weight" "stderr must name invalid_weight"
}

# AC2-c: above the floor, a heavy task runs straight through.
test_heavy_admitted_when_memory_available() {
    CURRENT_TEST_NAME="AC2-c: heavy task proceeds when MemAvailable >= floor"
    fake_meminfo 12000
    fast_admission_env 3 5120

    "$BIN_DIR/task-start" "cccc1111" --tool manual --slot 1 --weight heavy -- /bin/sh -c "exit 0" >/dev/null 2>&1 || true
    local status
    status=$(wait_for_terminal_status "cccc1111" 15)
    assert_eq "$status" "succeeded" "heavy task must run when memory is available"

    local log
    log=$(cat "$RL_TASKS_DIR/cccc1111.log" 2>/dev/null || echo "")
    assert_contains "$log" "admitted" "log must record the admission decision"
}

# AC2-d + AC2-e: below the floor it waits, logs the wait line, then fails
# with admission_timeout once the budget expires.
test_heavy_waits_then_times_out() {
    CURRENT_TEST_NAME="AC2-d/e: heavy task waits below the floor then admission_timeout"
    fake_meminfo 1000
    fast_admission_env 3 5120

    "$BIN_DIR/task-start" "dddd1111" --tool manual --slot 1 --weight heavy -- /bin/sh -c "exit 0" >/dev/null 2>&1 || true
    local status
    status=$(wait_for_terminal_status "dddd1111" 25)
    assert_eq "$status" "failed" "heavy task must fail once the admission budget expires"

    local reason
    reason=$(jq -r '.failure_reason // "absent"' "$RL_TASKS_DIR/dddd1111.json" 2>/dev/null || echo "parse_err")
    assert_eq "$reason" "admission_timeout" "task JSON must carry failure_reason=admission_timeout"

    local log
    log=$(cat "$RL_TASKS_DIR/dddd1111.log" 2>/dev/null || echo "")
    assert_contains "$log" "waiting for memory: available=1000MB need=5120MB" "log must show the wait line with both numbers"
    assert_contains "$log" "heavy running)" "wait line must report how many heavy tasks are running"
    assert_contains "$log" "admission_timeout" "log must name admission_timeout on give-up"
}

# AC2-f: a light task is never gated, even with the host nearly out of memory.
test_light_task_never_gated() {
    CURRENT_TEST_NAME="AC2-f: light tasks never wait for memory"
    fake_meminfo 100
    fast_admission_env 60 5120

    "$BIN_DIR/task-start" "eeee1111" --tool manual --slot 1 --weight light -- /bin/sh -c "exit 0" >/dev/null 2>&1 || true
    local status
    status=$(wait_for_terminal_status "eeee1111" 15)
    assert_eq "$status" "succeeded" "light task must run immediately below the floor"

    local log
    log=$(cat "$RL_TASKS_DIR/eeee1111.log" 2>/dev/null || echo "")
    if [[ "$log" == *"waiting for memory"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: light task must not log a memory wait")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] light task logged a memory wait"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
}

# AC2-g (success path): the counter goes up while running, back down after.
test_counter_increments_then_decrements() {
    CURRENT_TEST_NAME="AC2-g: heavy counter increments while running, decrements on success"
    fake_meminfo 12000
    fast_admission_env 5 5120

    "$BIN_DIR/task-start" "ffff1111" --tool manual --slot 1 --weight heavy -- /bin/sleep 3 >/dev/null 2>&1 || true

    local seen="0" waited=0
    while (( waited < 60 )); do
        seen=$(admission_count heavy_running)
        [[ "$seen" == "1" ]] && break
        sleep 0.1
        waited=$((waited + 1))
    done
    assert_eq "$seen" "1" "heavy_running must be 1 while the task runs"

    local status
    status=$(wait_for_terminal_status "ffff1111" 25)
    assert_eq "$status" "succeeded" "heavy task must succeed"
    assert_eq "$(admission_count heavy_running)" "0" "heavy_running must return to 0 after success"
}

# AC2-g (failure path): a failing command still releases its admission slot.
test_counter_decrements_on_failure() {
    CURRENT_TEST_NAME="AC2-g: heavy counter decrements when the task FAILS"
    fake_meminfo 12000
    fast_admission_env 5 5120

    "$BIN_DIR/task-start" "ffff2222" --tool manual --slot 1 --weight heavy -- /bin/sh -c "exit 1" >/dev/null 2>&1 || true
    local status
    status=$(wait_for_terminal_status "ffff2222" 20)
    assert_eq "$status" "failed" "the wrapped non-zero command must fail the task"
    assert_eq "$(admission_count heavy_running)" "0" "heavy_running must return to 0 after failure"
}

# AC2-h: lease-status exposes the admission numbers so agents can see pressure.
test_lease_status_reports_admission_fields() {
    CURRENT_TEST_NAME="AC2-h: lease-status reports heavy_running / heavy_waiting / mem_available_mb"
    fake_meminfo 7000
    fast_admission_env 3 5120
    # Live holders: a stale entry (older than RL_HEAVY_TASK_MAX_HOLD_SECONDS)
    # is pruned on read by design, so the fixture uses the current epoch.
    local now
    now=$(date +%s)
    jq -n --argjson now "$now" '{
        heavy_running: [{key:"t1", task_id:"t1", admitted_at:"2026-09-02T00:00:00Z", admitted_epoch:$now}],
        heavy_waiting: [{key:"t2", task_id:"t2", since:"2026-09-02T00:00:00Z", since_epoch:$now}]
    }' > "$RL_STATE_DIR/admission.json"

    local out exit_code=0
    out=$("$BIN_DIR/lease-status" 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "0" "lease-status must exit 0"
    assert_eq "$(echo "$out" | jq -r '.heavy_running // "absent"' 2>/dev/null)" "1" "heavy_running count"
    assert_eq "$(echo "$out" | jq -r '.heavy_waiting // "absent"' 2>/dev/null)" "1" "heavy_waiting count"
    assert_eq "$(echo "$out" | jq -r '.mem_available_mb // "absent"' 2>/dev/null)" "7000" "mem_available_mb from RL_MEMINFO_PATH"
}

# Build a docker shim so run-on-runner-with-heartbeat can be driven locally.
make_docker_shim() {
    local shim_dir
    shim_dir="$(mktemp -d -t rl-adm-docker-shim.XXXXXX)"
    cat > "$shim_dir/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "exec" ]]; then
    shift
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -i|-t|-it|-ti) shift ;;
            -e) shift 2 ;;
            -w) shift 2 ;;
            --) shift; break ;;
            -*) shift ;;
            *) shift; break ;;
        esac
    done
    exec "$@"
fi
exit 0
EOF
    chmod +x "$shim_dir/docker"
    echo "$shim_dir"
}

# AC2-i: the heartbeat wrapper accepts --weight, and does NOT re-gate when an
# ancestor task-start already holds admission (no double counting, no deadlock).
test_heartbeat_wrapper_weight_flag() {
    CURRENT_TEST_NAME="AC2-i: run-on-runner-with-heartbeat --weight honors RL_ADMISSION_HELD"
    fake_meminfo 100
    fast_admission_env 60 5120

    local shim_dir
    shim_dir="$(make_docker_shim)"
    local out exit_code=0
    out=$(PATH="$shim_dir:$PATH" RL_ADMISSION_HELD="held-by-parent" \
        rl_timeout 10 "$BIN_DIR/run-on-runner-with-heartbeat" \
        --heartbeat-interval=1 --weight heavy -- /bin/echo admitted-child 2>&1) || exit_code=$?
    rm -rf "$shim_dir"

    assert_exit_code "$exit_code" "0" "wrapper must accept --weight and run when admission is already held"
    assert_contains "$out" "admitted-child" "the wrapped command must actually run"
    if [[ "$out" == *"waiting for memory"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: wrapper re-gated despite RL_ADMISSION_HELD")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapper re-gated despite RL_ADMISSION_HELD"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
}

# AC2-j (Codex P2): a task cancelled WHILE waiting on the memory floor must
# never be started, even if memory frees up before the budget expires, and its
# reservation must be handed back.
test_cancel_during_wait_never_starts() {
    CURRENT_TEST_NAME="AC2-j: cancel during the memory wait never spawns the command"
    fake_meminfo 1000
    fast_admission_env 30 5120
    local sentinel="$RL_STATE_DIR/never-run.sentinel"

    "$BIN_DIR/task-start" "aaab1111" --tool manual --slot 1 --weight heavy \
        -- /bin/sh -c "touch $sentinel" >/dev/null 2>&1 || true

    # Wait until it is parked on the gate, then cancel it.
    local waited=0
    while (( waited < 100 )); do
        [[ "$(admission_count heavy_waiting)" == "1" ]] && break
        sleep 0.1
        waited=$((waited + 1))
    done
    assert_eq "$(admission_count heavy_waiting)" "1" "task must be parked on the gate before we cancel"
    "$BIN_DIR/task-cancel" "aaab1111" "operator cancelled" >/dev/null 2>&1 || true

    # Now free the memory: the supervisor must NOT take the freed headroom.
    fake_meminfo 12000

    # Deterministic barrier — .status went terminal the instant task-cancel ran,
    # so polling status would read back before the admission loop resolves
    # (vacuous pass). Poll .admission_state instead: it leaves "waiting" only
    # when the loop has decided, and the ONLY correct decision here is "aborted".
    local adm_state="waiting"
    waited=0
    while (( waited < 200 )); do
        adm_state=$(jq -r '.admission_state // "null"' "$RL_TASKS_DIR/aaab1111.json" 2>/dev/null || echo "parse_err")
        [[ "$adm_state" != "waiting" ]] && break
        sleep 0.1
        waited=$((waited + 1))
    done
    assert_eq "$adm_state" "aborted" "the loop must abort on a cancelled task, not admit it"

    # Give a would-be spawn a bounded chance to appear before asserting absence.
    waited=0
    while (( waited < 30 )); do
        [[ -f "$sentinel" ]] && break
        sleep 0.1
        waited=$((waited + 1))
    done
    local status
    status=$(jq -r '.status // "missing"' "$RL_TASKS_DIR/aaab1111.json" 2>/dev/null || echo "parse_err")
    assert_eq "$status" "cancelled" "a cancelled task must stay cancelled once memory frees"
    assert_file_not_exists "$sentinel" "the wrapped command must never run after a cancel"
    assert_eq "$(jq -r '.pid // "null"' "$RL_TASKS_DIR/aaab1111.json")" "null" "no process may be spawned"

    waited=0
    while (( waited < 50 )); do
        [[ "$(admission_count heavy_running)" == "0" && "$(admission_count heavy_waiting)" == "0" ]] && break
        sleep 0.1
        waited=$((waited + 1))
    done
    assert_eq "$(admission_count heavy_running)" "0" "cancel must release the heavy reservation"
    assert_eq "$(admission_count heavy_waiting)" "0" "cancel must clear the waiting entry"
}

# AC2-k (Codex P2): the admission timeout must never overwrite a terminal
# status — a cancelled task stays cancelled, it does not become
# failed/admission_timeout.
test_cancel_then_timeout_stays_cancelled() {
    CURRENT_TEST_NAME="AC2-k: admission_timeout never overwrites a cancelled status"
    fake_meminfo 1000
    fast_admission_env 4 5120

    "$BIN_DIR/task-start" "aaac1111" --tool manual --slot 1 --weight heavy \
        -- /bin/sh -c "exit 0" >/dev/null 2>&1 || true
    local waited=0
    while (( waited < 100 )); do
        [[ "$(admission_count heavy_waiting)" == "1" ]] && break
        sleep 0.1
        waited=$((waited + 1))
    done
    "$BIN_DIR/task-cancel" "aaac1111" "operator cancelled" >/dev/null 2>&1 || true

    # Deterministic wait for the ADMISSION LOOP to finish, not for .status:
    # task-cancel makes .status terminal instantly, so polling status alone
    # would read the JSON before the timeout branch ever runs (vacuous pass).
    # The loop releases its reservation on give-up, so an empty waiting list
    # is the signal that the give-up path has executed.
    local waited=0
    while (( waited < 200 )); do
        [[ "$(admission_count heavy_waiting)" == "0" ]] && break
        sleep 0.1
        waited=$((waited + 1))
    done
    assert_eq "$(admission_count heavy_waiting)" "0" "the admission loop must have given up by now"

    local status
    status=$(jq -r '.status // "missing"' "$RL_TASKS_DIR/aaac1111.json" 2>/dev/null || echo "parse_err")
    assert_eq "$status" "cancelled" "status must remain cancelled after the budget expires"
    local reason
    reason=$(jq -r '.failure_reason // "null"' "$RL_TASKS_DIR/aaac1111.json" 2>/dev/null || echo "parse_err")
    assert_neq "$reason" "admission_timeout" "a cancelled task must not be relabelled admission_timeout"
    assert_eq "$(jq -r '.cancel_reason // "null"' "$RL_TASKS_DIR/aaac1111.json")" "operator cancelled" "cancel_reason must survive"
}

run_test "ac2-a-weight-flag" test_weight_flag_accepted_and_defaults_light
run_test "ac2-b-invalid-weight" test_invalid_weight_rejected
run_test "ac2-c-heavy-admitted" test_heavy_admitted_when_memory_available
run_test "ac2-de-heavy-timeout" test_heavy_waits_then_times_out
run_test "ac2-f-light-never-gated" test_light_task_never_gated
run_test "ac2-g-counter-success" test_counter_increments_then_decrements
run_test "ac2-g-counter-failure" test_counter_decrements_on_failure
run_test "ac2-h-lease-status" test_lease_status_reports_admission_fields
run_test "ac2-i-heartbeat-weight" test_heartbeat_wrapper_weight_flag
run_test "ac2-j-cancel-during-wait" test_cancel_during_wait_never_starts
run_test "ac2-k-cancel-then-timeout" test_cancel_then_timeout_stays_cancelled

print_test_summary
