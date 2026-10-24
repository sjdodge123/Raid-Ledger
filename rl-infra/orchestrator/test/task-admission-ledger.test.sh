#!/usr/bin/env bash
# 2026-10-22 no-RAM memory plan, item 3 — the admission LEDGER.
#
# On 2026-10-22 03:20Z four claims, an image build, an env deploy, several
# --static gates and jest runs were all admitted at once and stalled the VM:
# the MemAvailable floor is read once at launch and a reservation only counted
# for a 90s settle window. These tests pin the stricter contract:
#   L1  a reservation is held for the task's WHOLE life (settle window = 0 here),
#       so a second heavy that would overflow RL_ADMISSION_BUDGET_MB queues
#   L2  RL_MAX_HEAVY_CONCURRENT: an image build + 2 heavies queue the 3rd heavy,
#       while a medium (--static) still admits
#   L3  RL_MAX_IMAGE_BUILDS: a second image build queues; an admitted build is
#       recorded as kind=image_build with the build reservation
#   L4  a holder that died (dead pid / terminal task JSON) is pruned on read
#   L5  status counters: categories, env charge, committed vs budget; live envs
#       count against the budget
#   L6  FIFO: a medium that fits is refused while an OLDER heavy waiter would
#       no longer fit beside it (no starvation of heavies by a stream of statics)
#   L6b the same FIFO holds on an EMPTY ledger; the oldest waiter still admits
#   L7  a holder SIGKILLed while others wait is pruned on the waiter's next poll
#   L8  a ledger wait uses RL_LEDGER_ADMISSION_TIMEOUT_SECONDS, not the floor's
#   L9  that longer limit is sticky through a later floor-only poll
#   L10 ROK-1902: a ballooned-down MemTotal lowers the effective budget
#       (min(budget, MemTotal - RL_ADMISSION_RESERVE_MB)) and refuses a heavy
#       that no longer fits; at the full 16 GiB the same heavy admits
#
# Pure bash + jq, no docker: /proc/meminfo is faked via RL_MEMINFO_PATH.

set -uo pipefail

CURRENT_TEST_FILE="task-admission-ledger.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ADMISSION_JSON=""
HOST_NAME="$(hostname 2>/dev/null || echo unknown)"

ledger_env() {
    local avail_mb="$1"
    cat > "$RL_STATE_DIR/meminfo" <<MEM
MemTotal:       16777216 kB
MemAvailable:   $(( avail_mb * 1024 )) kB
MEM
    export RL_MEMINFO_PATH="$RL_STATE_DIR/meminfo"
    ADMISSION_JSON="$RL_STATE_DIR/admission.json"
    export RL_HEAVY_TASK_POLL_SECONDS=1
    export RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS=2
    export RL_LEDGER_ADMISSION_TIMEOUT_SECONDS=2
    export RL_HEAVY_TASK_MIN_FREE_MB=5120
    export RL_MEDIUM_TASK_MIN_FREE_MB=2560
    export RL_HEAVY_TASK_SETTLE_SECONDS=0
    export RL_HEAVY_TASK_RESERVE_MB=5632
    export RL_MEDIUM_TASK_RESERVE_MB=3072
    export RL_IMAGE_BUILD_RESERVE_MB=3072
    export RL_ENV_RESERVE_MB=1024
    export RL_ADMISSION_BUDGET_MB="${2:-12288}"
    export RL_MAX_HEAVY_CONCURRENT="${3:-2}"
    export RL_MAX_IMAGE_BUILDS="${4:-1}"
    export RL_ADMISSION_RESERVE_MB=2048
    export RL_DISK_GATE=0
}

# set_mem_total <MB> — rewrite the fixture's MemTotal, keeping MemAvailable.
set_mem_total() {
    local avail_kb
    avail_kb=$(awk '/^MemAvailable:/ {print $2}' "$RL_MEMINFO_PATH")
    printf 'MemTotal:       %d kB\nMemAvailable:   %d kB\n' $(( $1 * 1024 )) "$avail_kb" > "$RL_MEMINFO_PATH.tmp"
    mv "$RL_MEMINFO_PATH.tmp" "$RL_MEMINFO_PATH"
}

# Seed the ledger with live holders (pid = this shell, so prune_dead keeps them).
# seed_running '<jq array expression of {key, weight, kind, reserve_mb}>'
seed_running() {
    jq -n --argjson now "$(date +%s)" --argjson pid "$$" --arg host "$HOST_NAME" "($1) as \$e"' | {
        heavy_running: [ $e[] | . + {task_id: .key, admitted_at: "x", admitted_epoch: $now,
                                     mb: 5120, pid: $pid, host: $host} ],
        heavy_waiting: []
    }' > "$ADMISSION_JSON"
}

wait_terminal() {
    local id="$1" budget="${2:-15}" st="missing" i
    for (( i = 0; i < budget * 10; i++ )); do
        st=$(jq -r '.status // "missing"' "$RL_TASKS_DIR/$id.json" 2>/dev/null || echo missing)
        case "$st" in succeeded|failed|cancelled) break ;; esac
        sleep 0.1
    done
    echo "$st"
}

wait_admitted() {
    local id="$1" i
    for (( i = 0; i < 60; i++ )); do
        [[ "$(jq -r '.admission_state // ""' "$RL_TASKS_DIR/$id.json" 2>/dev/null)" == "admitted" ]] && return 0
        sleep 0.1
    done
    return 1
}

start_task() {  # start_task <id> <weight> <tool> <cmd...>
    local id="$1" w="$2" tool="$3"; shift 3
    bash "$BIN_DIR/task-start" "$id" --tool "$tool" --slot 1 --weight "$w" -- "$@" >/dev/null 2>&1 || true
}

# L1 — held past the settle window until the holder is terminal.
test_reservation_held_for_task_lifetime() {
    CURRENT_TEST_NAME="L1: a heavy reservation is held for the task's whole life, not a settle window"
    ledger_env 20000 8000
    start_task "lllla111" heavy manual /bin/sleep 6
    wait_admitted "lllla111" || true
    assert_eq "$(jq -r '.admission_state' "$RL_TASKS_DIR/lllla111.json")" "admitted" "first heavy admitted"
    sleep 1  # past RL_HEAVY_TASK_SETTLE_SECONDS=0: the old gate would forget A here
    start_task "lllla222" heavy manual /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal lllla222 15)" "failed" "2nd heavy must QUEUE (5632+5632 > 8000 budget) although MemAvailable=20000"
    assert_eq "$(jq -r '.failure_reason' "$RL_TASKS_DIR/lllla222.json")" "admission_timeout" "queued heavy times out as admission_timeout"
    assert_contains "$(cat "$RL_TASKS_DIR/lllla222.log")" "blocked_by=budget 5632MB tasks" "wait line names the budget"
    assert_eq "$(wait_terminal lllla111 20)" "succeeded" "first heavy finishes"
    assert_eq "$(jq -r '.heavy_running | length' "$ADMISSION_JSON")" "0" "terminal task released its reservation"
    start_task "lllla333" heavy manual /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal lllla333 15)" "succeeded" "after release the next heavy admits"
}

# L2 — image build + 2 heavies running: the 3rd heavy queues, a medium does not.
test_heavy_cap_queues_third_heavy() {
    CURRENT_TEST_NAME="L2: image build + 2 heavy running -> 3rd heavy queues on RL_MAX_HEAVY_CONCURRENT"
    ledger_env 30000 0 2 1
    seed_running '[{key:"h1",weight:"heavy",kind:"task",reserve_mb:5632},
                   {key:"h2",weight:"heavy",kind:"task",reserve_mb:5632},
                   {key:"b1",weight:"heavy",kind:"image_build",reserve_mb:3072}]'
    start_task "llllb111" heavy rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllb111 15)" "failed" "3rd heavy must queue (cap 2), budget off, memory plentiful"
    assert_contains "$(cat "$RL_TASKS_DIR/llllb111.log")" "blocked_by=heavy_cap 2/2" "wait line names the heavy cap"
    start_task "llllb222" medium rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllb222 15)" "succeeded" "a medium (--static) is not bound by the heavy cap"
}

# L3 — image builds have their own cap and reservation.
test_image_build_cap_and_kind() {
    CURRENT_TEST_NAME="L3: RL_MAX_IMAGE_BUILDS=1 queues a 2nd build; a build records kind=image_build"
    ledger_env 30000 0 2 1
    start_task "llllc111" heavy rl_env_build_image_from_runner /bin/sleep 4
    wait_admitted "llllc111" || true
    assert_eq "$(jq -r '[.heavy_running[] | select(.key=="llllc111") | "\(.kind)/\(.reserve_mb)"] | first' "$ADMISSION_JSON")" \
        "image_build/3072" "admitted build carries kind + build reservation"
    start_task "llllc222" heavy rl_env_build_image_from_runner /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllc222 15)" "failed" "2nd image build must queue on the build cap"
    assert_contains "$(cat "$RL_TASKS_DIR/llllc222.log")" "blocked_by=image_build_cap 1/1" "wait line names the build cap"
    start_task "llllc333" heavy rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllc333 15)" "succeeded" "a build does not use a heavy-cap slot"
    wait_terminal llllc111 20 >/dev/null
}

# L4 — dead holders are pruned on read.
test_dead_holders_pruned() {
    CURRENT_TEST_NAME="L4: a dead-pid holder and a terminal-task holder are pruned; a live one stays"
    ledger_env 9000
    local now; now=$(date +%s)
    jq -nc '{task_id:"deadjson1", status:"failed"}' > "$RL_TASKS_DIR/deadjson1.json"
    jq -n --argjson now "$now" --argjson live "$$" --arg host "$HOST_NAME" '{
        heavy_running: [
          {key:"deadpid1", task_id:"deadpid1", admitted_epoch:$now, mb:5120, weight:"heavy", pid:999999, host:$host},
          {key:"deadjson1", task_id:"deadjson1", admitted_epoch:$now, mb:5120, weight:"heavy", pid:$live, host:$host},
          {key:"other1", task_id:"other1", admitted_epoch:$now, mb:5120, weight:"heavy", pid:999999, host:"another-host"},
          {key:"live1", task_id:"live1", admitted_epoch:$now, mb:5120, weight:"heavy", pid:$live, host:$host}],
        heavy_waiting: [{key:"deadwait1", task_id:"deadwait1", since_epoch:$now, pid:999999, host:$host}]
    }' > "$ADMISSION_JSON"
    local out; out=$(bash "$BIN_DIR/lease-status" 2>/dev/null)
    assert_eq "$(jq -r '[.heavy_running[].key] | join(",")' "$ADMISSION_JSON")" "other1,live1" \
        "dead pid + terminal JSON dropped; a pid from another host is never judged"
    assert_eq "$(jq -r '.heavy_waiting | length' "$ADMISSION_JSON")" "0" "a dead waiter is dropped too"
    assert_eq "$(echo "$out" | jq -r '.heavy_running')" "2" "status counts only live holders"
}

# L5 — status counters + env charge against the budget.
test_status_counters_and_env_charge() {
    CURRENT_TEST_NAME="L5: status reports categories, env charge, committed/budget; envs count against budget"
    ledger_env 30000 9000
    jq -n '[{slug:"e1"},{slug:"e2"}]' > "$RL_STATE_DIR/env-registry.json"
    seed_running '[{key:"m1",weight:"medium",kind:"task",reserve_mb:3072},
                   {key:"b1",weight:"heavy",kind:"image_build",reserve_mb:3072}]'
    local out; out=$(bash "$BIN_DIR/lease-status" 2>/dev/null)
    assert_eq "$(echo "$out" | jq -c '.admission.categories')" '{"heavy":0,"medium":1,"image_build":1}' "per-category counts"
    assert_eq "$(echo "$out" | jq -r '.admission.env_reserved_mb')" "2048" "2 envs x 1024"
    assert_eq "$(echo "$out" | jq -r '.admission.committed_mb')" "8192" "6144 tasks + 2048 envs"
    assert_eq "$(echo "$out" | jq -r '"\(.admission.budget_mb)/\(.admission.max_heavy_concurrent)/\(.admission.max_image_builds)"')" \
        "9000/2/1" "budget + caps surfaced"
    start_task "lllle111" medium rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal lllle111 15)" "failed" "8192 + 3072 > 9000: a static queues because of the live envs"
    assert_eq "$(jq -r '.heavy_waiting | length' "$ADMISSION_JSON")" "0" "the timed-out waiter is released"
}

# Wait until <key> shows up in heavy_waiting (max ~6s).
wait_waiting() {
    local key="$1" i
    for (( i = 0; i < 60; i++ )); do
        jq -e --arg k "$key" 'any((.heavy_waiting // [])[]; .key == $k)' "$ADMISSION_JSON" >/dev/null 2>&1 && return 0
        sleep 0.1
    done
    return 1
}

# L6 — FIFO across weights.
test_fifo_older_heavy_waiter_blocks_medium() {
    CURRENT_TEST_NAME="L6: an older heavy waiter blocks a medium that fits now but leaves it no room"
    ledger_env 30000 12288
    jq -n '[{slug:"e1"},{slug:"e2"},{slug:"e3"},{slug:"e4"}]' > "$RL_STATE_DIR/env-registry.json"
    seed_running '[{key:"m1",weight:"medium",kind:"task",reserve_mb:3072}]'
    # 3072 running + 4096 envs + 5632 heavy = 12800 > 12288: the heavy is parked.
    jq --argjson since "$(( $(date +%s) - 30 ))" --argjson pid "$$" --arg host "$HOST_NAME" \
        '.heavy_waiting = [{key:"hw1", task_id:"hw1", since_epoch:$since, weight:"heavy", kind:"task",
                            reserve_mb:5632, blocked_by:"budget", pid:$pid, host:$host}]' \
        "$ADMISSION_JSON" > "$ADMISSION_JSON.tmp" && mv "$ADMISSION_JSON.tmp" "$ADMISSION_JSON"
    # 3072 + 4096 + 3072 = 10240 fits alone, but 10240 + 5632 does not.
    start_task "llllf111" medium rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllf111 15)" "failed" "medium must NOT leapfrog the older parked heavy"
    assert_contains "$(cat "$RL_TASKS_DIR/llllf111.log")" "blocked_by=fifo 1 older waiter(s) need 5632MB first" \
        "wait line names the FIFO block"
    jq '.heavy_waiting = []' "$ADMISSION_JSON" > "$ADMISSION_JSON.tmp" && mv "$ADMISSION_JSON.tmp" "$ADMISSION_JSON"
    start_task "llllf222" medium rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllf222 15)" "succeeded" "with no older waiter the same medium admits"
}

# L6b — FIFO holds on an EMPTY ledger too (the old `$n > 0` guard let every
# waiter race the moment the last holder left).
test_fifo_holds_on_empty_ledger() {
    CURRENT_TEST_NAME="L6b: on an empty ledger a newcomer medium is refused behind an older heavy waiter, which admits"
    ledger_env 30000 12288
    jq -n '[{slug:"e1"},{slug:"e2"},{slug:"e3"},{slug:"e4"}]' > "$RL_STATE_DIR/env-registry.json"
    jq -n --argjson since "$(( $(date +%s) - 30 ))" --argjson pid "$$" --arg host "$HOST_NAME" \
        '{heavy_running: [], heavy_waiting: [{key:"llllf333", task_id:"llllf333", since_epoch:$since,
            weight:"heavy", kind:"task", reserve_mb:5632, blocked_by:"budget", pid:$pid, host:$host}]}' \
        > "$ADMISSION_JSON"
    # 0 running + 4096 envs + 3072 medium fits alone; + the heavy's 5632 = 12800 > 12288.
    start_task "llllf444" medium rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllf444 15)" "failed" "newcomer medium must not take the empty ledger from the older heavy"
    assert_contains "$(cat "$RL_TASKS_DIR/llllf444.log")" "blocked_by=fifo 1 older waiter(s) need 5632MB first" \
        "wait line names the FIFO block on an empty ledger"
    start_task "llllf333" heavy manual /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllf333 15)" "succeeded" "the oldest waiter has nobody ahead, so it admits (no deadlock)"
}

# L7 — a SIGKILLed holder is reclaimed while another task waits on it.
test_dead_holder_reclaimed_during_wait() {
    CURRENT_TEST_NAME="L7: a SIGKILLed holder's reservation is pruned on the waiter's next poll"
    ledger_env 30000 8000
    export RL_LEDGER_ADMISSION_TIMEOUT_SECONDS=8
    /bin/sleep 60 &
    local holder=$!
    jq -n --argjson now "$(date +%s)" --argjson pid "$holder" --arg host "$HOST_NAME" '{
        heavy_running: [{key:"victim1", task_id:"victim1", admitted_at:"x", admitted_epoch:$now, mb:5120,
                         weight:"heavy", kind:"task", reserve_mb:5632, pid:$pid, host:$host}],
        heavy_waiting: [] }' > "$ADMISSION_JSON"
    start_task "llllg111" heavy manual /bin/sh -c "exit 0"
    wait_waiting "llllg111" || true
    assert_eq "$(jq -r '.heavy_waiting[0].key // "none"' "$ADMISSION_JSON")" "llllg111" "waiter parked on the live holder"
    kill -9 "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
    assert_eq "$(wait_terminal llllg111 15)" "succeeded" "dead holder pruned mid-wait, so the waiter admits"
    assert_eq "$(jq -r '[.heavy_running[].key] | index("victim1") // "gone"' "$ADMISSION_JSON")" "gone" "victim entry removed"
}

# L8 — the ledger wait budget is the long one.
test_ledger_wait_uses_ledger_timeout() {
    CURRENT_TEST_NAME="L8: a budget wait times out on RL_LEDGER_ADMISSION_TIMEOUT_SECONDS, not the floor timeout"
    ledger_env 30000 8000
    export RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS=1
    export RL_LEDGER_ADMISSION_TIMEOUT_SECONDS=3
    seed_running '[{key:"h1",weight:"heavy",kind:"task",reserve_mb:5632}]'
    start_task "llllh111" heavy manual /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllh111 15)" "failed" "budget-blocked heavy eventually times out"
    assert_contains "$(cat "$RL_TASKS_DIR/llllh111.log")" "admission_timeout after 3s" "ledger wait got the 3s ledger budget"
}

# L9 — the ledger limit is sticky: a heavy that waited on the ledger longer
# than the floor timeout must not time out on the poll where its holder leaves
# but memory has not been reclaimed yet.
test_ledger_limit_sticky_through_floor_poll() {
    CURRENT_TEST_NAME="L9: after a ledger wait longer than the floor timeout, one floor-failing poll does not time out"
    ledger_env 30000 8000
    export RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS=1
    export RL_LEDGER_ADMISSION_TIMEOUT_SECONDS=12
    /bin/sleep 60 &
    local holder=$!
    jq -n --argjson now "$(date +%s)" --argjson pid "$holder" --arg host "$HOST_NAME" '{
        heavy_running: [{key:"hold9", task_id:"hold9", admitted_at:"x", admitted_epoch:$now, mb:5120,
                         weight:"heavy", kind:"task", reserve_mb:5632, pid:$pid, host:$host}],
        heavy_waiting: [] }' > "$ADMISSION_JSON"
    start_task "lllli111" heavy manual /bin/sh -c "exit 0"
    wait_waiting "lllli111" || true
    sleep 3   # wait on the ledger past the 1s floor timeout
    # Holder leaves while memory is still low: the next poll fails the floor only.
    printf 'MemTotal:       16777216 kB\nMemAvailable:   %d kB\n' $(( 1000 * 1024 )) > "$RL_MEMINFO_PATH.tmp"
    mv "$RL_MEMINFO_PATH.tmp" "$RL_MEMINFO_PATH"
    kill -9 "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
    local i
    for (( i = 0; i < 60; i++ )); do
        grep -q 'available=1000MB' "$RL_TASKS_DIR/lllli111.log" 2>/dev/null && break
        sleep 0.1
    done
    printf 'MemTotal:       16777216 kB\nMemAvailable:   %d kB\n' $(( 30000 * 1024 )) > "$RL_MEMINFO_PATH.tmp"
    mv "$RL_MEMINFO_PATH.tmp" "$RL_MEMINFO_PATH"
    assert_eq "$(wait_terminal lllli111 15)" "succeeded" "kept the ledger limit through the floor-failing poll"
    assert_eq "$(grep -c 'admission_timeout' "$RL_TASKS_DIR/lllli111.log")" "0" "no timeout on the poll its turn arrived"
    assert_contains "$(cat "$RL_TASKS_DIR/lllli111.log")" "available=1000MB" "a floor-failing poll was actually observed"
}

# L10 — ROK-1902: the budget follows the guest's live MemTotal.
test_effective_budget_follows_mem_total() {
    CURRENT_TEST_NAME="L10: a shrunken MemTotal lowers the effective budget and refuses a heavy that no longer fits"
    ledger_env 7000 12288
    seed_running '[{key:"m1",weight:"medium",kind:"task",reserve_mb:3072}]'
    # Normal case: 16384 - 2048 = 14336 > 12288, so the configured budget rules
    # and 3072 + 5632 = 8704 fits.
    local out; out=$(bash "$BIN_DIR/lease-status" 2>/dev/null)
    assert_eq "$(echo "$out" | jq -r '"\(.admission.budget_mb)/\(.admission.effective_budget_mb)/\(.admission.mem_total_mb)/\(.admission.reserve_mb)"')" \
        "12288/12288/16384/2048" "full guest: effective budget = configured budget"
    start_task "llllj111" heavy rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllj111 15)" "succeeded" "full guest: 3072 + 5632 <= 12288 admits"
    # Balloon down to 8 GiB: effective = 8192 - 2048 = 6144 < 8704.
    set_mem_total 8192
    out=$(bash "$BIN_DIR/lease-status" 2>/dev/null)
    assert_eq "$(echo "$out" | jq -r '"\(.admission.budget_mb)/\(.admission.effective_budget_mb)/\(.admission.mem_total_mb)"')" \
        "12288/6144/8192" "ballooned guest: effective budget = MemTotal - reserve"
    start_task "llllj222" heavy rl_validate_ci /bin/sh -c "exit 0"
    assert_eq "$(wait_terminal llllj222 15)" "failed" "ballooned guest: 3072 + 5632 > 6144 must queue"
    assert_eq "$(jq -r '.failure_reason' "$RL_TASKS_DIR/llllj222.json")" "admission_timeout" "queued heavy times out as admission_timeout"
    assert_contains "$(cat "$RL_TASKS_DIR/llllj222.log")" "blocked_by=budget 3072MB tasks + 0MB envs + 5632MB > 6144MB" \
        "wait line names the effective budget"
}

run_test "l1-lifetime-reservation" test_reservation_held_for_task_lifetime
run_test "l2-heavy-cap" test_heavy_cap_queues_third_heavy
run_test "l3-image-build-cap" test_image_build_cap_and_kind
run_test "l4-dead-holders" test_dead_holders_pruned
run_test "l5-status-env-charge" test_status_counters_and_env_charge
run_test "l6-fifo" test_fifo_older_heavy_waiter_blocks_medium
run_test "l6b-fifo-empty-ledger" test_fifo_holds_on_empty_ledger
run_test "l7-dead-holder-mid-wait" test_dead_holder_reclaimed_during_wait
run_test "l8-ledger-timeout" test_ledger_wait_uses_ledger_timeout
run_test "l9-sticky-ledger-limit" test_ledger_limit_sticky_through_floor_poll
run_test "l10-effective-budget-memtotal" test_effective_budget_follows_mem_total

print_test_summary
