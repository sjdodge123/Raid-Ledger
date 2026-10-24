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
#   RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS  1800  (waiting on the MemAvailable floor)
#   RL_LEDGER_ADMISSION_TIMEOUT_SECONDS      5400  (waiting on a cap / the budget / FIFO)
#   RL_HEAVY_TASK_POLL_SECONDS               10
#   RL_HEAVY_TASK_SETTLE_SECONDS             90    (see admission::_try_admit)
#   RL_HEAVY_TASK_MAX_HOLD_SECONDS           14400 (stale-entry pruning)

RL_MEMINFO_PATH="${RL_MEMINFO_PATH:-/proc/meminfo}"
RL_ADMISSION_FILE="${RL_ADMISSION_FILE:-${RL_STATE_DIR}/admission.json}"
RL_HEAVY_TASK_MIN_FREE_MB="${RL_HEAVY_TASK_MIN_FREE_MB:-5120}"
# ROK-1793 S2 — `medium` weight (a Playwright-only gate child): same gate,
# smaller floor. Each reservation records its `mb`; a legacy entry without one
# counts as the heavy floor.
RL_MEDIUM_TASK_MIN_FREE_MB="${RL_MEDIUM_TASK_MIN_FREE_MB:-2560}"
RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS="${RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS:-1800}"
# Ledger holds last a task's whole life (a full gate is 60-90 min), so a waiter
# parked behind a cap or the budget gets the long-gate budget, not 1800s.
RL_LEDGER_ADMISSION_TIMEOUT_SECONDS="${RL_LEDGER_ADMISSION_TIMEOUT_SECONDS:-5400}"
RL_HEAVY_TASK_POLL_SECONDS="${RL_HEAVY_TASK_POLL_SECONDS:-10}"
RL_HEAVY_TASK_SETTLE_SECONDS="${RL_HEAVY_TASK_SETTLE_SECONDS:-90}"
RL_HEAVY_TASK_MAX_HOLD_SECONDS="${RL_HEAVY_TASK_MAX_HOLD_SECONDS:-14400}"

# 2026-10-22 no-RAM plan item 3 — a LEDGER on top of the MemAvailable floor.
# The floor alone is read once at launch and a reservation only counted for
# RL_HEAVY_TASK_SETTLE_SECONDS, so on 2026-10-22 03:20Z an image build, an env
# deploy, several --static gates and jest runs all admitted and stalled the VM.
# Now every admitted task's reservation counts against RL_ADMISSION_BUDGET_MB
# for its WHOLE life (released at terminal / cancel / holder death), each live
# env counts RL_ENV_RESERVE_MB, and two hard caps bound the heaviest work.
#   RL_ADMISSION_BUDGET_MB      12288  Σ reservations + envs may not exceed it (0 = off)
#   RL_HEAVY_TASK_RESERVE_MB     5632  ledger reservation of a heavy task
#   RL_MEDIUM_TASK_RESERVE_MB    3072  ledger reservation of a medium task (--static)
#   RL_IMAGE_BUILD_RESERVE_MB    3072  ledger reservation of an image build
#   RL_ENV_RESERVE_MB            1024  ledger charge per live env in env-registry.json
#   RL_MAX_HEAVY_CONCURRENT         2  heavy tasks running at once (0 = no cap)
#   RL_MAX_IMAGE_BUILDS             1  image builds running at once (0 = no cap)
# The OLDEST waiter is always admitted on an empty ledger (memory floor still
# applies), so a mis-set budget can delay work but never wedge the fleet. The
# FIFO budget clause applies even on an empty ledger: otherwise every waiter
# (and any newcomer) races for it and a parked heavy can starve behind mediums.
RL_ADMISSION_BUDGET_MB="${RL_ADMISSION_BUDGET_MB:-12288}"
RL_HEAVY_TASK_RESERVE_MB="${RL_HEAVY_TASK_RESERVE_MB:-5632}"
RL_MEDIUM_TASK_RESERVE_MB="${RL_MEDIUM_TASK_RESERVE_MB:-3072}"
RL_IMAGE_BUILD_RESERVE_MB="${RL_IMAGE_BUILD_RESERVE_MB:-3072}"
RL_ENV_RESERVE_MB="${RL_ENV_RESERVE_MB:-1024}"
RL_MAX_HEAVY_CONCURRENT="${RL_MAX_HEAVY_CONCURRENT:-2}"
RL_MAX_IMAGE_BUILDS="${RL_MAX_IMAGE_BUILDS:-1}"

# ROK-1902 — the budget is capped by the guest's LIVE MemTotal. VM 200 runs
# with `balloon: 8192` under `memory: 16384`, so Proxmox can shrink the guest
# toward 8 GiB while a fixed 12288 MB budget keeps admitting as if 16 GiB were
# there (a gate was OOM-killed 2026-10-22). Every admit re-reads MemTotal from
# RL_MEMINFO_PATH and uses
#   effective budget = min(RL_ADMISSION_BUDGET_MB, MemTotal_mb - RL_ADMISSION_RESERVE_MB)
#   RL_ADMISSION_RESERVE_MB      2048  what the VM needs outside the ledger: the
#                                      kernel + sshd/dockerd/containerd/mutagen and
#                                      the compose sidecars (traefik, registry, loki,
#                                      promtail, grafana, dashboard, socket-proxy,
#                                      gc-sweeper — each tens to a few hundred MB)
# Budget 0 stays "off"; an unreadable MemTotal falls back to the configured
# budget (fail open, like the MemAvailable floor).
RL_ADMISSION_RESERVE_MB="${RL_ADMISSION_RESERVE_MB:-2048}"

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
    admission::prune_dead
}

# The longest any waiter may legitimately wait (either timeout).
admission::max_wait_seconds() {
    local a="$RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS" b="$RL_LEDGER_ADMISSION_TIMEOUT_SECONDS"
    if (( b > a )); then echo "$b"; else echo "$a"; fi
}

# Drop heavy_running entries older than RL_HEAVY_TASK_MAX_HOLD_SECONDS and
# heavy_waiting entries older than the longest admission timeout.
admission::prune_stale() {
    local now
    now=$(date +%s)
    state::mutate "$RL_ADMISSION_FILE" \
        --argjson now "$now" \
        --argjson hold "$RL_HEAVY_TASK_MAX_HOLD_SECONDS" \
        --argjson waitmax "$(admission::max_wait_seconds)" \
        '{
            heavy_running: [ (.heavy_running // [])[]
                | select(($now - (.admitted_epoch // $now)) < $hold) ],
            heavy_waiting: [ (.heavy_waiting // [])[]
                | select(($now - (.since_epoch // $now)) < ($waitmax + 60)) ]
        }' 2>/dev/null || true
}

# Drop entries whose holder is gone even though it never called release: its
# task JSON is already terminal (cancelled, swept as an orphan, finished) or the
# recorded holder pid no longer exists on THIS host. Without this a SIGKILLed
# supervisor would pin its reservation until the 4h max-hold prune.
admission::prune_dead() {
    [[ -s "$RL_ADMISSION_FILE" ]] || return 0
    local host key tid pid h json have_ps=0
    host="$(hostname 2>/dev/null || echo unknown)"
    # Without ps every pid would look dead; then only the terminal-JSON check runs.
    command -v ps >/dev/null 2>&1 && have_ps=1
    local -a dead=()
    while IFS=$'\t' read -r key tid pid h; do
        [[ -n "$key" ]] || continue
        json="${RL_TASKS_DIR:-/nonexistent}/${tid}.json"
        if [[ -n "$tid" && -f "$json" ]] && admission::json_status_terminal "$json"; then
            dead+=("$key"); continue
        fi
        if (( have_ps )) && [[ "$pid" =~ ^[0-9]+$ && "$h" == "$host" ]] && ! ps -p "$pid" >/dev/null 2>&1; then
            dead+=("$key")
        fi
    done < <(jq -r '((.heavy_running // []) + (.heavy_waiting // []))[]
        | [.key, (.task_id // ""), ((.pid // "") | tostring), (.host // "")] | @tsv' \
        "$RL_ADMISSION_FILE" 2>/dev/null)
    (( ${#dead[@]} > 0 )) || return 0
    local dead_json
    dead_json="$(printf '%s\n' "${dead[@]}" | jq -R . | jq -sc .)"
    state::mutate "$RL_ADMISSION_FILE" --argjson dead "$dead_json" \
        '{
            heavy_running: [ (.heavy_running // [])[] | select(.key as $k | ($dead | index($k)) == null) ],
            heavy_waiting: [ (.heavy_waiting // [])[] | select(.key as $k | ($dead | index($k)) == null) ]
        }' 2>/dev/null || true
}

# Which admission category a task tool falls in: `image_build` has its own cap
# and reservation; everything else is a plain `task` sized by its weight.
admission::kind_for_tool() {
    case "${1:-}" in
        rl_env_build_image_from_runner|*build_image*|*build-image*) echo image_build ;;
        *) echo task ;;
    esac
}

# admission::reserve_mb_for <weight> [kind] — the ledger reservation.
admission::reserve_mb_for() {
    if [[ "${2:-task}" == "image_build" ]]; then echo "$RL_IMAGE_BUILD_RESERVE_MB"
    elif [[ "$1" == "medium" ]]; then echo "$RL_MEDIUM_TASK_RESERVE_MB"
    else echo "$RL_HEAVY_TASK_RESERVE_MB"; fi
}

# MB charged for live envs (each one's allinone + PG run outside admission).
admission::env_reserved_mb() {
    local n
    n=$(jq -r 'if type == "array" then length else 0 end' "${RL_ENVS_FILE:-/nonexistent}" 2>/dev/null || echo 0)
    [[ "$n" =~ ^[0-9]+$ ]] || n=0
    echo $(( n * RL_ENV_RESERVE_MB ))
}

# Shared jq defs for the ledger: legacy entries (no weight/kind/reserve_mb)
# count as a heavy task holding the heavy floor.
_ADMISSION_JQ_DEFS='
def ents: (.heavy_running // []);
def wt: (.weight // "heavy");
def kd: (.kind // "task");
def heavy_n: [ents[] | select(wt == "heavy" and kd != "image_build")] | length;
def medium_n: [ents[] | select(wt == "medium" and kd != "image_build")] | length;
def build_n: [ents[] | select(kd == "image_build")] | length;
def reserved: [ents[] | (.reserve_mb // .mb // $floor)] | add // 0;
def waits: (.heavy_waiting // []);
def since_of($k; $now): (first(waits[] | select(.key == $k) | .since_epoch) // $now);
def ahead($k; $now): since_of($k; $now) as $s
    | [waits[] | select(.key != $k and (.since_epoch // $now) < $s)];
def ledger_reason($w; $kind; $reserve; $envmb; $k; $now):
    ahead($k; $now) as $a
    | ([$a[] | select(wt == "heavy" and kd != "image_build")] | length) as $ah
    | ([$a[] | select(kd == "image_build")] | length) as $ab
    | ([$a[] | (.reserve_mb // $floor)] | add // 0) as $ar
    | (ents | length) as $n
    | if ($kind != "image_build" and $w == "heavy" and $maxheavy > 0 and heavy_n >= $maxheavy)
      then "heavy_cap \(heavy_n)/\($maxheavy)"
      elif ($kind == "image_build" and $maxbuilds > 0 and build_n >= $maxbuilds)
      then "image_build_cap \(build_n)/\($maxbuilds)"
      elif ($budget > 0 and $n > 0 and (reserved + $envmb + $reserve) > $budget)
      then "budget \(reserved)MB tasks + \($envmb)MB envs + \($reserve)MB > \($budget)MB"
      elif ($kind != "image_build" and $w == "heavy" and $maxheavy > 0 and $ah > 0
            and (heavy_n + $ah + 1) > $maxheavy)
      then "fifo \($ah) older heavy waiter(s) need the heavy slot"
      elif ($kind == "image_build" and $maxbuilds > 0 and $ab > 0 and (build_n + $ab + 1) > $maxbuilds)
      then "fifo \($ab) older image build(s) waiting"
      elif ($budget > 0 and ($a | length) > 0
            and (reserved + $envmb + $ar + $reserve) > $budget)
      then "fifo \($a | length) older waiter(s) need \($ar)MB first"
      else "" end;
'

# Why the ledger refuses <weight>/<kind>/<reserve> right now ("" = it would
# admit on the ledger; the MemAvailable floor is checked separately).
# admission::ledger_block_reason <weight> <kind> <reserve> [key]
# With a key, waiters older than that key's own wait come first (FIFO).
admission::ledger_block_reason() {
    local weight="$1" kind="$2" reserve="$3" key="${4:-}" envmb
    envmb="$(admission::env_reserved_mb)"
    jq -r --arg w "$weight" --arg kind "$kind" --argjson reserve "$reserve" --arg k "$key" \
        --argjson envmb "$envmb" --argjson floor "$RL_HEAVY_TASK_MIN_FREE_MB" \
        --argjson now "$(date +%s)" --argjson budget "$(admission::effective_budget_mb)" \
        --argjson maxheavy "$RL_MAX_HEAVY_CONCURRENT" --argjson maxbuilds "$RL_MAX_IMAGE_BUILDS" \
        "$_ADMISSION_JQ_DEFS"'ledger_reason($w; $kind; $reserve; $envmb; $k; $now)' \
        "$RL_ADMISSION_FILE" 2>/dev/null || true
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

# Echo the guest's MemTotal in MB, or nothing when unreadable.
admission::mem_total_mb() {
    [[ -r "$RL_MEMINFO_PATH" ]] || return 0
    awk '/^MemTotal:/ {printf "%d", $2 / 1024; found=1; exit}
         END {if (!found) exit 1}' "$RL_MEMINFO_PATH" 2>/dev/null || true
}

# The configured budget / reserve as plain integers. A non-numeric value (a
# mis-set `2g`) falls back to the default instead of breaking the arithmetic
# (which would clamp the budget to 1 MB and fail closed) or the snapshot JSON.
admission::configured_budget_mb() {
    if [[ "$RL_ADMISSION_BUDGET_MB" =~ ^[0-9]+$ ]]; then echo "$RL_ADMISSION_BUDGET_MB"; else echo 12288; fi
}
admission::reserve_mb() {
    if [[ "$RL_ADMISSION_RESERVE_MB" =~ ^[0-9]+$ ]]; then echo "$RL_ADMISSION_RESERVE_MB"; else echo 2048; fi
}

# The budget the ledger actually enforces right now (see RL_ADMISSION_RESERVE_MB).
# Never below 1 MB while the budget is on, so a tiny guest still means "on".
admission::effective_budget_mb() {
    local budget total cap
    budget="$(admission::configured_budget_mb)"
    (( budget > 0 )) || { echo 0; return 0; }
    total="$(admission::mem_total_mb)"
    if [[ "$total" =~ ^[0-9]+$ ]]; then
        cap=$(( total - $(admission::reserve_mb) ))
        (( cap < 1 )) && cap=1
        (( cap < budget )) && budget=$cap
    fi
    echo "$budget"
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
    local avail total
    avail="$(admission::mem_available_mb)"
    [[ -n "$avail" ]] || avail="null"
    total="$(admission::mem_total_mb)"
    [[ -n "$total" ]] || total="null"
    # heavy_running / heavy_waiting keep their ROK-1470 meaning: every task
    # holding (or waiting for) an admission slot, whatever its weight. The
    # per-category split and the ledger totals live under `admission`.
    jq -nc \
        --argjson avail "$avail" \
        --argjson floor "$RL_HEAVY_TASK_MIN_FREE_MB" \
        --argjson envmb "$(admission::env_reserved_mb)" \
        --argjson budget "$(admission::configured_budget_mb)" \
        --argjson effbudget "$(admission::effective_budget_mb)" \
        --argjson memtotal "$total" \
        --argjson resv "$(admission::reserve_mb)" \
        --argjson maxheavy "$RL_MAX_HEAVY_CONCURRENT" \
        --argjson maxbuilds "$RL_MAX_IMAGE_BUILDS" \
        --slurpfile state "$RL_ADMISSION_FILE" \
        "$_ADMISSION_JQ_DEFS"'
        $state[0] as $st
        | ($st | heavy_n) as $h | ($st | medium_n) as $m | ($st | build_n) as $b
        | ($st | reserved) as $r
        | {
            heavy_running: ($st | ents | length),
            heavy_waiting: (($st.heavy_waiting // []) | length),
            mem_available_mb: $avail,
            heavy_task_min_free_mb: $floor,
            admission: {
                running: ($st.heavy_running // []),
                waiting: ($st.heavy_waiting // []),
                categories: {heavy: $h, medium: $m, image_build: $b},
                reserved_mb: $r,
                env_reserved_mb: $envmb,
                committed_mb: ($r + $envmb),
                budget_mb: $budget,
                effective_budget_mb: $effbudget,
                mem_total_mb: $memtotal,
                reserve_mb: $resv,
                max_heavy_concurrent: $maxheavy,
                max_image_builds: $maxbuilds
            }
        }' 2>/dev/null || echo '{"heavy_running":0,"heavy_waiting":0,"mem_available_mb":null}'
}

# admission::need_mb_for <weight> — the free-memory floor for a gated weight.
admission::need_mb_for() {
    if [[ "$1" == "medium" ]]; then echo "$RL_MEDIUM_TASK_MIN_FREE_MB"; else echo "$RL_HEAVY_TASK_MIN_FREE_MB"; fi
}

# Try to claim a heavy slot atomically. Returns 0 when admitted, 1 when the
# host is too tight right now.
#
# The freshly-admitted-task reserve: a task admitted seconds ago has not yet
# allocated its memory, so MemAvailable still reports the headroom it is
# about to consume. Each admit inside RL_HEAVY_TASK_SETTLE_SECONDS therefore
# reserves one floor's worth of the reading — without it, two waiters wake on
# the same poll tick and both admit into the same 6 GiB (thundering herd).
#
# On top of that floor, the ledger (caps + budget, see the knobs at the top)
# is evaluated in the SAME flock window, so two waiters can never both take
# the last heavy slot or the last of the budget. (The env charge, envmb, is
# read just before that window: a concurrent env-spin can overshoot the budget
# by one RL_ENV_RESERVE_MB, which is accepted.)
#
# FIFO: a newcomer whose admission would leave no room for an OLDER live
# waiter (its cap slot or its reservation) is refused, so a stream of mediums
# can never starve a parked heavy. The first task on an empty ledger is still
# always admitted (memory floor aside).
#
# admission::_try_admit <key> <task_id> <avail> [need] [weight] [kind] [pid]
admission::_try_admit() {
    local key="$1" task_id="$2" avail="$3" need="${4:-$RL_HEAVY_TASK_MIN_FREE_MB}"
    local weight="${5:-heavy}" kind="${6:-task}" pid="${7:-$$}"
    local now ts reserve envmb host
    now=$(date +%s)
    ts=$(date -u +%FT%TZ)
    reserve="$(admission::reserve_mb_for "$weight" "$kind")"
    envmb="$(admission::env_reserved_mb)"
    host="$(hostname 2>/dev/null || echo unknown)"
    state::mutate_with_precondition "$RL_ADMISSION_FILE" \
        --arg k "$key" --arg t "$task_id" --arg ts "$ts" \
        --arg w "$weight" --arg kind "$kind" --arg host "$host" --arg pid "$pid" \
        --argjson now "$now" --argjson avail "$avail" \
        --argjson floor "$RL_HEAVY_TASK_MIN_FREE_MB" \
        --argjson settle "$RL_HEAVY_TASK_SETTLE_SECONDS" \
        --argjson need "$need" --argjson reserve "$reserve" --argjson envmb "$envmb" \
        --argjson budget "$(admission::effective_budget_mb)" \
        --argjson maxheavy "$RL_MAX_HEAVY_CONCURRENT" --argjson maxbuilds "$RL_MAX_IMAGE_BUILDS" \
        "$_ADMISSION_JQ_DEFS"'
         def recent: [ ents[]
             | select(($now - (.admitted_epoch // 0)) < $settle)
             | (.mb // $floor) ] | add // 0;
         def ledger_ok: ledger_reason($w; $kind; $reserve; $envmb; $k; $now) == "";
         if ledger_ok and ($avail - recent) >= $need
         then {
             heavy_running: (ents
                 + [{key: $k, task_id: $t, admitted_at: $ts, admitted_epoch: $now, mb: $need,
                     weight: $w, kind: $kind, reserve_mb: $reserve,
                     pid: ($pid | tonumber? // null), host: $host}]),
             heavy_waiting: [ (.heavy_waiting // [])[] | select(.key != $k) ]
         }
         else . end'
}

# Register (idempotently) as a waiter so status/lease-status can show pressure.
admission::_mark_waiting() {
    local key="$1" task_id="$2" weight="${3:-heavy}" kind="${4:-task}" reason="${5:-}" pid="${6:-$$}"
    local now ts host reserve
    now=$(date +%s)
    ts=$(date -u +%FT%TZ)
    host="$(hostname 2>/dev/null || echo unknown)"
    reserve="$(admission::reserve_mb_for "$weight" "$kind")"
    state::mutate "$RL_ADMISSION_FILE" \
        --arg k "$key" --arg t "$task_id" --arg ts "$ts" --argjson now "$now" \
        --argjson reserve "$reserve" \
        --arg w "$weight" --arg kind "$kind" --arg r "$reason" --arg host "$host" --arg pid "$pid" \
        '.heavy_waiting = (if any((.heavy_waiting // [])[]; .key == $k)
             then [ (.heavy_waiting // [])[] | if .key == $k then .blocked_by = $r else . end ]
             else ((.heavy_waiting // []) + [{key: $k, task_id: $t, since: $ts, since_epoch: $now,
                   weight: $w, kind: $kind, reserve_mb: $reserve, blocked_by: $r,
                   pid: ($pid | tonumber? // null), host: $host}])
             end)' 2>/dev/null || true
}

# Unconditional register — used when MemAvailable is unreadable (fail open) so
# the counters still reflect what is running.
admission::_register_running() {
    local key="$1" task_id="$2" need="${3:-$RL_HEAVY_TASK_MIN_FREE_MB}"
    local weight="${4:-heavy}" kind="${5:-task}" pid="${6:-$$}"
    local now ts reserve host
    now=$(date +%s)
    ts=$(date -u +%FT%TZ)
    reserve="$(admission::reserve_mb_for "$weight" "$kind")"
    host="$(hostname 2>/dev/null || echo unknown)"
    state::mutate "$RL_ADMISSION_FILE" \
        --arg k "$key" --arg t "$task_id" --arg ts "$ts" --argjson now "$now" \
        --argjson need "$need" --argjson reserve "$reserve" \
        --arg w "$weight" --arg kind "$kind" --arg host "$host" --arg pid "$pid" \
        '{
            heavy_running: ((.heavy_running // [])
                + [{key: $k, task_id: $t, admitted_at: $ts, admitted_epoch: $now, mb: $need,
                    weight: $w, kind: $kind, reserve_mb: $reserve,
                    pid: ($pid | tonumber? // null), host: $host}]),
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
# The reservation taken here is held until admission::release (the
# supervisor's exit path) or admission::prune_dead (holder gone), NOT for a
# fixed settle window. The holder pid recorded is this shell's ($$).
#
# admission::acquire <key> <task_id> [log_path] [abort_cmd] [need_mb] [weight] [kind]
admission::acquire() {
    local key="$1" task_id="$2" log_path="${3:-}" abort_cmd="${4:-}"
    local floor="${5:-$RL_HEAVY_TASK_MIN_FREE_MB}"
    local weight="${6:-}" kind="${7:-task}" reason
    if [[ -z "$weight" ]]; then
        if [[ "$floor" == "$RL_MEDIUM_TASK_MIN_FREE_MB" ]]; then weight=medium; else weight=heavy; fi
    fi
    local poll="$RL_HEAVY_TASK_POLL_SECONDS" started limit="$RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS"
    started=$(date +%s)
    admission::ensure_file
    local avail
    while :; do
        # Every poll, not once: a holder SIGKILLed while only waiters are
        # active must not pin its reservation until they all time out.
        admission::prune_dead
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
            admission::_register_running "$key" "$task_id" "$floor" "$weight" "$kind" "$$"
            return 0
        fi
        if admission::_try_admit "$key" "$task_id" "$avail" "$floor" "$weight" "$kind" "$$"; then
            admission::_log "$log_path" \
                "[admission] admitted: available=${avail}MB need=${floor}MB ($(admission::running_count) heavy running)"
            return 0
        fi
        reason="$(admission::ledger_block_reason "$weight" "$kind" "$(admission::reserve_mb_for "$weight" "$kind")" "$key")"
        admission::_mark_waiting "$key" "$task_id" "$weight" "$kind" "${reason:-memory_floor}" "$$"
        admission::_log "$log_path" \
            "[admission] waiting for memory: available=${avail}MB need=${floor}MB ($(admission::running_count) heavy running)${reason:+ blocked_by=$reason}"
        # A ledger wait (cap / budget / fifo) waits out lifetime holds; a pure
        # memory-floor wait keeps the shorter budget. Sticky: once the task has
        # waited on the ledger it keeps the long limit, because `started` is
        # fixed — dropping back to the floor limit on the poll where its turn
        # arrives (memory not yet reclaimed) would time it out instantly.
        if [[ -n "$reason" ]]; then limit="$RL_LEDGER_ADMISSION_TIMEOUT_SECONDS"; fi
        if (( $(date +%s) + poll > started + limit )); then
            admission::release "$key"
            admission::_log "$log_path" \
                "[admission] admission_timeout after ${limit}s: available=${avail}MB need=${floor}MB${reason:+ blocked_by=$reason}"
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
