#!/usr/bin/env bash
# ROK-1470 — host-memory admission control for HEAVY fleet tasks.
#
# Why: the VM stays at 15 GiB and the four runners share it dynamically
# (`mem_limit: 6g` + `mem_reservation: 2g` each = over-subscribed caps, not
# tiers). A cap is only a ceiling; what actually protects the host is this
# gate. A task started with `--weight heavy` (jest / vitest / playwright /
# validate-ci / image build) waits until the HOST's MemAvailable is at or
# above RL_HEAVY_TASK_MIN_FREE_MB before its wrapped command launches.
# Light tasks (probes, greps, short builds) are NEVER gated.
#
# This replaces the manual "never two full jest runs at once" rule.
#
# Source AFTER _state.sh — it reuses state::mutate / state::mutate_with_
# precondition (flock + atomic rename) so concurrent supervisors can't both
# admit themselves into the same headroom.
#
# Env knobs (all overridable; tests point them at fixtures):
#   RL_MEMINFO_PATH                          /proc/meminfo
#   RL_ADMISSION_FILE                        $RL_STATE_DIR/admission.json
#   RL_HEAVY_TASK_MIN_FREE_MB                5120
#   RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS  1800
#   RL_HEAVY_TASK_POLL_SECONDS               10
#   RL_HEAVY_TASK_SETTLE_SECONDS             90    (see admission::_try_admit)
#   RL_HEAVY_TASK_MAX_HOLD_SECONDS           14400 (stale-entry pruning)

RL_MEMINFO_PATH="${RL_MEMINFO_PATH:-/proc/meminfo}"
RL_ADMISSION_FILE="${RL_ADMISSION_FILE:-${RL_STATE_DIR}/admission.json}"
RL_HEAVY_TASK_MIN_FREE_MB="${RL_HEAVY_TASK_MIN_FREE_MB:-5120}"
RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS="${RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS:-1800}"
RL_HEAVY_TASK_POLL_SECONDS="${RL_HEAVY_TASK_POLL_SECONDS:-10}"
RL_HEAVY_TASK_SETTLE_SECONDS="${RL_HEAVY_TASK_SETTLE_SECONDS:-90}"
RL_HEAVY_TASK_MAX_HOLD_SECONDS="${RL_HEAVY_TASK_MAX_HOLD_SECONDS:-14400}"

# Create the state file if absent, then drop entries whose holder plainly
# died (host reboot, SIGKILLed supervisor) so one leak can't wedge the gate
# forever. Written via jq so byte-for-byte identity holds for the
# mutate_with_precondition compare in admission::_try_admit.
admission::ensure_file() {
    if [[ ! -s "$RL_ADMISSION_FILE" ]]; then
        jq -n '{heavy_running: [], heavy_waiting: []}' > "$RL_ADMISSION_FILE.init.$$" 2>/dev/null || return 0
        mv -n "$RL_ADMISSION_FILE.init.$$" "$RL_ADMISSION_FILE" 2>/dev/null \
            || rm -f "$RL_ADMISSION_FILE.init.$$"
        chmod 664 "$RL_ADMISSION_FILE" 2>/dev/null || true
    fi
    admission::prune_stale
}

# Drop heavy_running entries older than RL_HEAVY_TASK_MAX_HOLD_SECONDS and
# heavy_waiting entries older than the admission timeout budget.
admission::prune_stale() {
    local now
    now=$(date +%s)
    state::mutate "$RL_ADMISSION_FILE" \
        --argjson now "$now" \
        --argjson hold "$RL_HEAVY_TASK_MAX_HOLD_SECONDS" \
        --argjson waitmax "$RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS" \
        '{
            heavy_running: [ (.heavy_running // [])[]
                | select(($now - (.admitted_epoch // $now)) < $hold) ],
            heavy_waiting: [ (.heavy_waiting // [])[]
                | select(($now - (.since_epoch // $now)) < ($waitmax + 60)) ]
        }' 2>/dev/null || true
}

# Echo the host's MemAvailable in MB, or nothing when the file is missing or
# has no MemAvailable line (macOS, a hostile container). Callers treat
# "nothing" as UNKNOWN and fail OPEN — the gate must never become the reason
# a task can't run.
admission::mem_available_mb() {
    [[ -r "$RL_MEMINFO_PATH" ]] || return 0
    awk '/^MemAvailable:/ {printf "%d", $2 / 1024; found=1; exit}
         END {if (!found) exit 1}' "$RL_MEMINFO_PATH" 2>/dev/null || true
}

admission::running_count() {
    jq -r '(.heavy_running // []) | length' "$RL_ADMISSION_FILE" 2>/dev/null || echo 0
}

admission::waiting_count() {
    jq -r '(.heavy_waiting // []) | length' "$RL_ADMISSION_FILE" 2>/dev/null || echo 0
}

# One JSON object with the numbers `status` / `lease-status` surface.
admission::snapshot() {
    admission::ensure_file
    local avail
    avail="$(admission::mem_available_mb)"
    [[ -n "$avail" ]] || avail="null"
    jq -nc \
        --argjson running "$(admission::running_count)" \
        --argjson waiting "$(admission::waiting_count)" \
        --argjson avail "$avail" \
        --argjson floor "$RL_HEAVY_TASK_MIN_FREE_MB" \
        --slurpfile state "$RL_ADMISSION_FILE" \
        '{
            heavy_running: $running,
            heavy_waiting: $waiting,
            mem_available_mb: $avail,
            heavy_task_min_free_mb: $floor,
            admission: {
                running: ($state[0].heavy_running // []),
                waiting: ($state[0].heavy_waiting // [])
            }
        }' 2>/dev/null || echo '{"heavy_running":0,"heavy_waiting":0,"mem_available_mb":null}'
}

# Try to claim a heavy slot atomically. Returns 0 when admitted, 1 when the
# host is too tight right now.
#
# The freshly-admitted-task reserve: a task admitted seconds ago has not yet
# allocated its memory, so MemAvailable still reports the headroom it is
# about to consume. Each admit inside RL_HEAVY_TASK_SETTLE_SECONDS therefore
# reserves one floor's worth of the reading — without it, two waiters wake on
# the same poll tick and both admit into the same 6 GiB (thundering herd).
admission::_try_admit() {
    local key="$1" task_id="$2" avail="$3"
    local now ts
    now=$(date +%s)
    ts=$(date -u +%FT%TZ)
    state::mutate_with_precondition "$RL_ADMISSION_FILE" \
        --arg k "$key" --arg t "$task_id" --arg ts "$ts" \
        --argjson now "$now" --argjson avail "$avail" \
        --argjson floor "$RL_HEAVY_TASK_MIN_FREE_MB" \
        --argjson settle "$RL_HEAVY_TASK_SETTLE_SECONDS" \
        'def recent: [ (.heavy_running // [])[]
             | select(($now - (.admitted_epoch // 0)) < $settle) ] | length;
         if ($avail - (recent * $floor)) >= $floor
         then {
             heavy_running: ((.heavy_running // [])
                 + [{key: $k, task_id: $t, admitted_at: $ts, admitted_epoch: $now}]),
             heavy_waiting: [ (.heavy_waiting // [])[] | select(.key != $k) ]
         }
         else . end'
}

# Register (idempotently) as a waiter so status/lease-status can show pressure.
admission::_mark_waiting() {
    local key="$1" task_id="$2"
    local now ts
    now=$(date +%s)
    ts=$(date -u +%FT%TZ)
    state::mutate "$RL_ADMISSION_FILE" \
        --arg k "$key" --arg t "$task_id" --arg ts "$ts" --argjson now "$now" \
        '.heavy_waiting = (if any((.heavy_waiting // [])[]; .key == $k)
             then (.heavy_waiting // [])
             else ((.heavy_waiting // []) + [{key: $k, task_id: $t, since: $ts, since_epoch: $now}])
             end)' 2>/dev/null || true
}

# Unconditional register — used when MemAvailable is unreadable (fail open) so
# the counters still reflect what is running.
admission::_register_running() {
    local key="$1" task_id="$2"
    local now ts
    now=$(date +%s)
    ts=$(date -u +%FT%TZ)
    state::mutate "$RL_ADMISSION_FILE" \
        --arg k "$key" --arg t "$task_id" --arg ts "$ts" --argjson now "$now" \
        '{
            heavy_running: ((.heavy_running // [])
                + [{key: $k, task_id: $t, admitted_at: $ts, admitted_epoch: $now}]),
            heavy_waiting: [ (.heavy_waiting // [])[] | select(.key != $k) ]
        }' 2>/dev/null || true
}

# Drop this key from BOTH lists. Idempotent — safe to call on every exit path.
admission::release() {
    local key="$1"
    [[ -s "$RL_ADMISSION_FILE" ]] || return 0
    state::mutate "$RL_ADMISSION_FILE" --arg k "$key" \
        '{
            heavy_running: [ (.heavy_running // [])[] | select(.key != $k) ],
            heavy_waiting: [ (.heavy_waiting // [])[] | select(.key != $k) ]
        }' 2>/dev/null || true
}

# Append one line to the task log (when given) and mirror it to stderr so an
# interactive caller sees the wait too.
admission::_log() {
    local log_path="$1" line="$2"
    if [[ -n "$log_path" ]]; then
        echo "$line" >> "$log_path" 2>/dev/null || true
    else
        echo "$line" >&2
    fi
}

# Block until admitted. Returns 0 when the caller may proceed, 1 on
# admission_timeout. Poll interval + budget come from the env knobs above.
#
# admission::acquire <key> <task_id> [log_path]
admission::acquire() {
    local key="$1" task_id="$2" log_path="${3:-}"
    local floor="$RL_HEAVY_TASK_MIN_FREE_MB"
    local poll="$RL_HEAVY_TASK_POLL_SECONDS"
    local deadline=$(( $(date +%s) + RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS ))
    admission::ensure_file
    local avail
    while :; do
        avail="$(admission::mem_available_mb)"
        if [[ -z "$avail" ]]; then
            admission::_log "$log_path" \
                "[admission] MemAvailable unreadable at $RL_MEMINFO_PATH — admitted ungated"
            admission::_register_running "$key" "$task_id"
            return 0
        fi
        if admission::_try_admit "$key" "$task_id" "$avail"; then
            admission::_log "$log_path" \
                "[admission] admitted: available=${avail}MB need=${floor}MB ($(admission::running_count) heavy running)"
            return 0
        fi
        admission::_mark_waiting "$key" "$task_id"
        admission::_log "$log_path" \
            "[admission] waiting for memory: available=${avail}MB need=${floor}MB ($(admission::running_count) heavy running)"
        if (( $(date +%s) + poll > deadline )); then
            admission::release "$key"
            admission::_log "$log_path" \
                "[admission] admission_timeout after ${RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS}s: available=${avail}MB need=${floor}MB"
            return 1
        fi
        sleep "$poll"
    done
}
