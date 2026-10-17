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

# True when the task JSON has already reached a terminal status — i.e. someone
# (task-cancel, the sweeper) finished it while we were parked on the gate.
# Used as the abort predicate below so a cancelled task is never admitted,
# never started, and never relabelled.
admission::json_status_terminal() {
    local json_path="$1"
    [[ -f "$json_path" ]] || return 1
    local status
    status=$(jq -r '.status // "running"' "$json_path" 2>/dev/null || echo running)
    case "$status" in
        cancelled|failed|succeeded) return 0 ;;
        *) return 1 ;;
    esac
}

# Block until admitted. Returns:
#   0 — admitted, the caller may proceed
#   1 — admission_timeout (budget expired)
#   2 — aborted: the optional abort predicate fired (e.g. the task was
#       cancelled while waiting). The reservation is released either way.
#
# The abort predicate is re-evaluated on EVERY poll, so a cancel lands within
# one poll interval instead of being noticed only after admission — otherwise
# freed memory would start a command nobody is waiting for any more.
#
# admission::acquire <key> <task_id> [log_path] [abort_cmd]
admission::acquire() {
    local key="$1" task_id="$2" log_path="${3:-}" abort_cmd="${4:-}"
    local floor="$RL_HEAVY_TASK_MIN_FREE_MB"
    local poll="$RL_HEAVY_TASK_POLL_SECONDS"
    local deadline=$(( $(date +%s) + RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS ))
    admission::ensure_file
    local avail
    while :; do
        if [[ -n "$abort_cmd" ]] && eval "$abort_cmd"; then
            admission::release "$key"
            admission::_log "$log_path" \
                "[admission] aborted while waiting — task is already terminal; not starting"
            return 2
        fi
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

# ---------------------------------------------------------------------------
# ROK-1568 — DISK admission for image builds.
#
# The memory gate above answers "can this task fit in RAM". The 2026-09-14
# incident was the other axis: the host sat at 98% (240G/245G) and two
# parallel image builds ran for minutes before dying at `chmod -R` with
# ENOSPC — a dirty, expensive failure with a useless error. A build that
# cannot fit should PARK (and trigger one prune-ladder pass), and only fail
# with a named `disk_pressure` reason when the pressure never clears.
#
# Env knobs:
#   RL_BUILD_MIN_FREE_GB     20    free GB an image build needs to start
#   RL_BUILD_DISK_WAIT_S     600   how long it may park before failing
#   RL_DISK_POLL_SECONDS     10    re-check interval while parked
#   RL_DISK_GATE             auto  1 = always gate, 0 = never (auto = by tool)
# ---------------------------------------------------------------------------

RL_BUILD_MIN_FREE_GB="${RL_BUILD_MIN_FREE_GB:-20}"
RL_BUILD_DISK_WAIT_S="${RL_BUILD_DISK_WAIT_S:-600}"
RL_DISK_POLL_SECONDS="${RL_DISK_POLL_SECONDS:-10}"

# The ladder library is shared with the gc-sweeper (see _disk_pressure.sh).
# Sourcing is best-effort: without it every disk helper below fails OPEN.
_ADMISSION_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
if [[ -r "${_ADMISSION_LIB_DIR}/_disk_pressure.sh" ]]; then
    # shellcheck disable=SC1090,SC1091
    source "${_ADMISSION_LIB_DIR}/_disk_pressure.sh"
fi

# Which tasks are disk-gated. Image builds copy the whole workspace and write
# a multi-GB image; everything else (jest, vitest, playwright) writes little,
# and gating those would turn a tight host into a stalled fleet.
admission::disk_gate_applies() {
    local tool="${1:-}"
    case "${RL_DISK_GATE:-auto}" in
        1) return 0 ;;
        0) return 1 ;;
    esac
    case "$tool" in
        *build*) return 0 ;;
        *) return 1 ;;
    esac
}

# Record the park on the task JSON so `rl_task_inspect` explains the delay.
admission::_mark_waiting_disk() {
    local json_path="$1" free="$2" need="$3"
    [[ -n "$json_path" && -f "$json_path" ]] || return 0
    state::mutate "$json_path" --argjson f "$free" --argjson n "$need" \
        '.admission_state = "waiting_disk"
         | .disk_admission = ((.disk_admission // {}) + {free_gb_at_entry: (.disk_admission.free_gb_at_entry // $f), need_gb: $n, free_gb: $f})' \
        2>/dev/null || true
}

# Block until at least RL_BUILD_MIN_FREE_GB is free. Returns:
#   0 — admitted, the caller may proceed
#   1 — disk_pressure (budget expired)
#   2 — aborted: the optional abort predicate fired (e.g. the task was
#       cancelled while parked). Mirrors admission::acquire's contract.
# Fails OPEN when df is unreadable or the ladder library is absent.
#
# The predicate is re-evaluated on EVERY poll, so a cancel lands within one
# interval instead of being noticed only after the disk frees — otherwise a
# cancelled image build would start the moment a prune succeeded (Codex P2).
#
# admission::acquire_disk <task_id> [json_path] [log_path] [abort_cmd]
admission::acquire_disk() {
    local task_id="$1" json_path="${2:-}" log_path="${3:-}" abort_cmd="${4:-}"
    declare -F disk_pressure::free_gb >/dev/null 2>&1 || return 0
    local need="$RL_BUILD_MIN_FREE_GB" free pruned=0
    local deadline=$(( $(date +%s) + RL_BUILD_DISK_WAIT_S ))
    while :; do
        if [[ -n "$abort_cmd" ]] && eval "$abort_cmd"; then
            admission::_log "$log_path" \
                "[admission] aborted while waiting for disk — task is already terminal; not starting"
            return 2
        fi
        free="$(disk_pressure::free_gb)" || free=""
        if [[ -z "$free" || ! "$free" =~ ^[0-9]+$ ]]; then
            admission::_log "$log_path" "[admission] free disk unreadable — build admitted ungated"
            return 0
        fi
        (( free >= need )) && return 0
        admission::_mark_waiting_disk "$json_path" "$free" "$need"
        admission::_log "$log_path" "[admission] waiting for disk: free=${free}GB need=${need}GB"
        if (( pruned == 0 )); then
            pruned=1
            admission::_log "$log_path" \
                "[admission] disk ladder: $(disk_pressure::force_ladder 2>/dev/null || echo '{}')"
            continue
        fi
        if (( $(date +%s) + RL_DISK_POLL_SECONDS > deadline )); then
            admission::_log "$log_path" \
                "[admission] disk_pressure after ${RL_BUILD_DISK_WAIT_S}s: free=${free}GB need=${need}GB"
            return 1
        fi
        sleep "$RL_DISK_POLL_SECONDS"
    done
}
