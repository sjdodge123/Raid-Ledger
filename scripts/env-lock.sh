#!/bin/bash
# =============================================================================
# env-lock.sh - Cross-worktree lease for the local dev environment
# =============================================================================
# Coordinates which agent / worktree owns the local dev env (Docker DB,
# API :3000, Vite :5173). Multiple agents in parallel cannot run the env
# simultaneously; this script is the chokepoint that enforces a lease.
#
# State lives at ~/.raid-ledger/env-lock.json (outside any worktree, so all
# worktrees share it). Atomicity: a sidecar mkdir mutex + atomic JSON writes.
#
# Usage:
#   env-lock.sh status
#   env-lock.sh acquire <branch> <worktree> <purpose> [--pid N] [--ttl-minutes N] [--priority normal|operator] [--agent-id ID]
#   env-lock.sh release <branch> <worktree> [--agent-id ID]
#   env-lock.sh heartbeat <branch> <worktree> [--agent-id ID]
#   env-lock.sh wait <branch> <worktree> <purpose> [--timeout-seconds N] [--pid N] [--ttl-minutes N] [--priority ...] [--agent-id ID]
#   env-lock.sh force-release
#
# --agent-id is the primary match predicate for release / heartbeat / refresh-self.
# When supplied, it identifies a holder across renames of branch or worktree path
# (e.g. deploy_dev.sh re-anchoring under a different cwd than the MCP server).
# When omitted on release, falls back to matching by (branch, worktree) — the
# legacy behavior — so bare CLI use (`env-lock.sh release <b> <w>`) keeps working.
#
# Subcommands always print a JSON result on stdout. Exit codes:
#   0  - operation succeeded (or env was free / lock acquired)
#   1  - acquire failed because env is held by someone else (caller enqueued)
#   64 - bad usage
#   124 - wait timed out
# =============================================================================

set -e

STATE_DIR="${RAID_LEDGER_STATE_DIR:-$HOME/.raid-ledger}"
STATE_FILE="$STATE_DIR/env-lock.json"
MUTEX_DIR="$STATE_DIR/.lock-mutex"
# Mutex contention is brief (a few jq invocations); 30 seconds is a generous
# upper bound that won't collide with any normal operation. We poll at 100ms,
# so 300 iterations × 100ms = 30s real time. Counted in iterations, not
# seconds, to keep the math correct (an earlier version mistakenly compared
# iteration count to seconds and timed out at ~0.5s).
MUTEX_MAX_ITERATIONS=300
MUTEX_POLL_SLEEP=0.1

# -----------------------------------------------------------------------------
# Bootstrap: ensure state dir + initial empty state exist.
# -----------------------------------------------------------------------------
init_state() {
    mkdir -p "$STATE_DIR"
    if [ ! -f "$STATE_FILE" ]; then
        echo '{"holder": null, "queue": []}' > "$STATE_FILE"
    fi
}

# -----------------------------------------------------------------------------
# Mutex: mkdir is atomic per POSIX. Held only for the JSON read-modify-write
# critical section (~ms), never across long operations.
# -----------------------------------------------------------------------------
mutex_lock() {
    # Pure spin-with-timeout. NEVER auto-clobber a held mutex — even after a
    # long wait, another instance may still be in the middle of its critical
    # section. Lost-update races would corrupt the lease state for every agent
    # at once. If the mutex is genuinely stuck (crashed prior invocation),
    # operators can clear it with: `rmdir ~/.raid-ledger/.lock-mutex`.
    local iterations=0
    while ! mkdir "$MUTEX_DIR" 2>/dev/null; do
        iterations=$((iterations + 1))
        if [ "$iterations" -ge "$MUTEX_MAX_ITERATIONS" ]; then
            echo "{\"error\": \"mutex_stuck\", \"hint\": \"check $MUTEX_DIR — if no env-lock.sh is running, rmdir it manually\"}" >&2
            exit 70
        fi
        sleep "$MUTEX_POLL_SLEEP"
    done
}

mutex_unlock() {
    rmdir "$MUTEX_DIR" 2>/dev/null || true
}

# Always release the mutex on exit (errors, signals, normal return).
trap 'mutex_unlock' EXIT

# -----------------------------------------------------------------------------
# State I/O: read whole JSON, write atomically via mktemp + mv.
# -----------------------------------------------------------------------------
read_state() {
    cat "$STATE_FILE"
}

write_state() {
    local new_state="$1"
    local tmp
    tmp=$(mktemp "$STATE_DIR/.env-lock.XXXXXX")
    echo "$new_state" > "$tmp"
    mv "$tmp" "$STATE_FILE"
}

# -----------------------------------------------------------------------------
# Liveness: a holder is stale if its PID is dead OR its heartbeat is older
# than ttl_minutes. PID 0 / empty means "no PID tracking" — TTL only.
# Checks run inside jq using `now` + `fromdateiso8601` for portability.
# -----------------------------------------------------------------------------
is_pid_alive() {
    local pid="$1"
    [ -z "$pid" ] && return 0          # no PID tracking → treat as alive
    [ "$pid" = "0" ] && return 0
    # `ps -p` is preferred over `kill -0`: on macOS, signaling another user's
    # process (e.g. PID 1 / launchd) returns EPERM, which kill -0 cannot
    # distinguish from ESRCH. ps just checks process-table presence.
    ps -p "$pid" >/dev/null 2>&1
}

# Returns "alive" or "stale:<reason>" based on the current holder.
holder_liveness() {
    local state="$1"
    local pid
    pid=$(echo "$state" | jq -r '.holder.pid // empty')
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
        if ! is_pid_alive "$pid"; then
            echo "stale:pid_dead"
            return
        fi
    fi
    local stale_by_time
    stale_by_time=$(echo "$state" | jq -r '
        if .holder == null then "no_holder"
        else
            (.holder.ttl_minutes // 60) as $ttl
            | (.holder.heartbeat_at // .holder.acquired_at) as $hb
            | if (now - ($hb | fromdateiso8601)) > ($ttl * 60)
              then "stale_ttl"
              else "alive"
              end
        end')
    case "$stale_by_time" in
        no_holder) echo "no_holder" ;;
        stale_ttl) echo "stale:heartbeat_ttl" ;;
        alive)     echo "alive" ;;
    esac
}

# Clear the holder if dead/stale; mutate state in place. Returns the cleanup
# reason (empty if no clearing happened).
auto_expire() {
    local state="$1"
    local liveness
    liveness=$(holder_liveness "$state")
    case "$liveness" in
        stale:*)
            local reason="${liveness#stale:}"
            STATE_OUT=$(echo "$state" | jq '.holder = null')
            EXPIRED_REASON="$reason"
            ;;
        *)
            STATE_OUT="$state"
            EXPIRED_REASON=""
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Identity helpers.
# -----------------------------------------------------------------------------
now_iso() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# True if (branch, worktree) matches the current holder. Legacy / fallback match.
is_holder_self() {
    local state="$1" branch="$2" worktree="$3"
    echo "$state" | jq -e --arg b "$branch" --arg w "$worktree" \
        '.holder != null and .holder.branch == $b and .holder.worktree == $w' >/dev/null
}

# True if agent_id (non-empty) matches the current holder's agent_id. Primary
# match predicate when both sides plumb --agent-id. Returns false (non-zero) when
# the supplied agent_id is empty so callers can fall through to is_holder_self.
is_holder_by_agent() {
    local state="$1" agent_id="$2"
    [ -z "$agent_id" ] && return 1
    echo "$state" | jq -e --arg a "$agent_id" \
        '.holder != null and (.holder.agent_id // "") != "" and .holder.agent_id == $a' >/dev/null
}

# True if (branch, worktree) is already in the queue.
is_in_queue() {
    local state="$1" branch="$2" worktree="$3"
    echo "$state" | jq -e --arg b "$branch" --arg w "$worktree" \
        '[.queue[] | select(.branch == $b and .worktree == $w)] | length > 0' >/dev/null
}

# -----------------------------------------------------------------------------
# Subcommand: status
# -----------------------------------------------------------------------------
cmd_status() {
    init_state
    mutex_lock
    local state
    state=$(read_state)
    auto_expire "$state"
    if [ -n "$EXPIRED_REASON" ]; then
        write_state "$STATE_OUT"
    fi
    mutex_unlock
    # Annotate output with `free` boolean and optional stale_cleared reason.
    echo "$STATE_OUT" | jq --arg reason "$EXPIRED_REASON" '
        . + {
            free: (.holder == null),
            stale_cleared: (if $reason == "" then null else { reason: $reason } end)
        }'
}

# -----------------------------------------------------------------------------
# Subcommand: acquire
# -----------------------------------------------------------------------------
cmd_acquire() {
    # Validate positional args BEFORE `shift 3` — under `set -e`, `shift N`
    # silently aborts when fewer than N args are present, swallowing our
    # own error messages.
    if [ $# -lt 3 ] || [ -z "${1:-}" ] || [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
        echo '{"error": "missing_required_args", "expected": "<branch> <worktree> <purpose>"}' >&2
        exit 64
    fi
    local branch="$1" worktree="$2" purpose="$3"
    shift 3
    local pid="" ttl_minutes=60 priority="normal" agent_id=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --pid)         pid="$2"; shift 2 ;;
            --ttl-minutes) ttl_minutes="$2"; shift 2 ;;
            --priority)    priority="$2"; shift 2 ;;
            --agent-id)    agent_id="$2"; shift 2 ;;
            *) echo "{\"error\": \"unknown_flag\", \"flag\": \"$1\"}" >&2; exit 64 ;;
        esac
    done
    case "$priority" in
        normal|operator) ;;
        *) echo "{\"error\": \"bad_priority\", \"value\": \"$priority\"}" >&2; exit 64 ;;
    esac

    init_state
    mutex_lock
    local state
    state=$(read_state)
    auto_expire "$state"
    state="$STATE_OUT"

    local now
    now=$(now_iso)
    local new_holder
    new_holder=$(build_holder_fragment "$branch" "$worktree" "$purpose" "$pid" "$ttl_minutes" "$priority" "$now" "$agent_id")

    # Idempotent re-acquire matches by agent_id (primary) OR branch+worktree
    # (fallback). The fallback covers deploy_dev.sh's re-anchor path, which
    # currently calls acquire without an --agent-id.
    if is_holder_by_agent "$state" "$agent_id" || is_holder_self "$state" "$branch" "$worktree"; then
        acquire_refresh_self "$state" "$new_holder"
        return 0
    fi

    if echo "$state" | jq -e '.holder == null' >/dev/null; then
        acquire_take_free "$state" "$new_holder"
        return 0
    fi

    if [ "$priority" = "operator" ]; then
        acquire_preempt "$state" "$new_holder" "$now"
        return 0
    fi

    acquire_enqueue "$state" "$branch" "$worktree" "$purpose" "$pid" "$priority" "$now"
    exit 1
}

# Build a JSON fragment representing the proposed new holder. Reused across
# all acquire branches so the shape stays consistent. agent_id is optional —
# empty string is normalized to "" in the JSON so downstream jq matches stay
# simple.
build_holder_fragment() {
    local branch="$1" worktree="$2" purpose="$3" pid="$4" ttl="$5" priority="$6" now="$7" agent_id="${8:-}"
    jq -n \
        --arg b "$branch" --arg w "$worktree" --arg p "$purpose" \
        --arg pid "$pid" --argjson ttl "$ttl" \
        --arg priority "$priority" --arg now "$now" \
        --arg agent_id "$agent_id" \
        '{
            branch: $b, worktree: $w, purpose: $p,
            pid: ($pid | if . == "" then 0 else (tonumber? // 0) end),
            priority: $priority,
            acquired_at: $now,
            heartbeat_at: $now,
            ttl_minutes: $ttl,
            preempted_from: null,
            agent_id: $agent_id
        }'
}

# Idempotent re-acquire by the current holder: refresh PID/purpose/ttl/heartbeat
# but preserve the original acquired_at and any preempted_from marker. If the
# caller didn't supply an agent_id, preserve the existing one (covers
# deploy_dev.sh's bare-CLI re-anchor — without this it would wipe the agent_id
# the MCP server stamped on initial acquire, defeating the whole point of
# adding agent_id-based release matching).
acquire_refresh_self() {
    local state="$1" new_holder="$2"
    state=$(echo "$state" | jq --argjson h "$new_holder" '
        ($h.agent_id // "") as $incoming_aid
        | (.holder.agent_id // "") as $existing_aid
        | .holder = ($h + {
            acquired_at: .holder.acquired_at,
            preempted_from: .holder.preempted_from,
            agent_id: (if $incoming_aid == "" then $existing_aid else $incoming_aid end)
          })
    ')
    write_state "$state"
    mutex_unlock
    emit_acquire_result "$state" true "" 0
}

# Free env: install ourselves as holder, dequeue ourselves if we were waiting.
acquire_take_free() {
    local state="$1" new_holder="$2"
    state=$(echo "$state" | jq --argjson h "$new_holder" \
        '.holder = $h | .queue = [.queue[] | select(.branch != $h.branch or .worktree != $h.worktree)]')
    write_state "$state"
    mutex_unlock
    emit_acquire_result "$state" true "" 0
}

# Operator preempt: push the current holder to the FRONT of the queue with
# preempted:true, then install ourselves as holder with preempted_from set
# so the displaced agent can see why they were bumped.
acquire_preempt() {
    local state="$1" new_holder="$2" now="$3"
    local preempted_holder
    preempted_holder=$(echo "$state" | jq -c '.holder')
    state=$(echo "$state" | jq --argjson h "$new_holder" --arg now "$now" '
        . as $orig
        | .queue = (
            [{
                branch: $orig.holder.branch,
                worktree: $orig.holder.worktree,
                pid: $orig.holder.pid,
                purpose: $orig.holder.purpose,
                priority: $orig.holder.priority,
                enqueued_at: $now,
                preempted: true
            }]
            + ($orig.queue | map(select(.branch != $h.branch or .worktree != $h.worktree)))
        )
        | .holder = ($h + {
            preempted_from: {
                branch: $orig.holder.branch,
                worktree: $orig.holder.worktree,
                purpose: $orig.holder.purpose
            }
          })
    ')
    write_state "$state"
    mutex_unlock
    emit_acquire_result "$state" true "$preempted_holder" 0
}

# Normal priority, held by another: append to queue if not already there.
# Caller exits 1 after we return.
acquire_enqueue() {
    local state="$1" branch="$2" worktree="$3" purpose="$4" pid="$5" priority="$6" now="$7"
    if ! is_in_queue "$state" "$branch" "$worktree"; then
        state=$(echo "$state" | jq \
            --arg b "$branch" --arg w "$worktree" --arg p "$purpose" \
            --arg pid "$pid" --arg priority "$priority" --arg now "$now" '
            .queue += [{
                branch: $b, worktree: $w,
                pid: ($pid | if . == "" then 0 else (tonumber? // 0) end),
                purpose: $p, priority: $priority,
                enqueued_at: $now, preempted: false
            }]')
        write_state "$state"
    fi
    mutex_unlock
    emit_acquire_result "$state" false "" 1
}

# Print structured JSON for an acquire result. Args: state, acquired (true|false),
# preempted_holder_json (or empty), exit_code.
emit_acquire_result() {
    local state="$1" acquired="$2" preempted="$3"
    local pos
    pos=$(echo "$state" | jq --arg b "$BRANCH_FOR_RESULT" --arg w "$WORKTREE_FOR_RESULT" \
        '[.queue[] | .branch + "@" + .worktree] | index($b + "@" + $w) // null')
    echo "$state" | jq \
        --argjson acquired "$acquired" \
        --argjson preempted "${preempted:-null}" \
        --argjson pos "$pos" '
        . + {
            acquired: $acquired,
            preempted_holder: $preempted,
            my_position: ($pos // null)
        }'
}

# -----------------------------------------------------------------------------
# Subcommand: release
# -----------------------------------------------------------------------------
# Match order: --agent-id (identity-stable across branch/worktree renames) →
# (branch, worktree) (fallback, preserves bare-CLI behavior). We always remove
# our queue entry by (branch, worktree) because the queue records the
# requester's branch+worktree at enqueue time and is unaffected by holder
# identity drift.
#
# NOTE: agent_id is ADVISORY, not authoritative. A supplied --agent-id that
# does not match the holder falls through to the branch+worktree match. Do NOT
# "harden" this into a refusal: the MCP wrapper persists its stamp to a single
# machine-global file (~/.raid-ledger/mcp-agent-id) that a parallel agent's
# enqueue-only acquire overwrites, so a wrong-looking agent_id is routinely the
# RIGHTFUL holder carrying a clobbered stamp. A refusal here zombies the lease
# until TTL expiry (attempted 2026-07-10, reverted — see TECH-DEBT-BACKLOG.md
# 2026-07-10 entry).
cmd_release() {
    if [ $# -lt 2 ] || [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
        echo '{"error": "missing_required_args", "expected": "<branch> <worktree> [--agent-id ID]"}' >&2
        exit 64
    fi
    local branch="$1" worktree="$2"
    shift 2
    local agent_id=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --agent-id) agent_id="$2"; shift 2 ;;
            *) echo "{\"error\": \"unknown_flag\", \"flag\": \"$1\"}" >&2; exit 64 ;;
        esac
    done

    init_state
    mutex_lock
    local state was_holder=false matched_by=""
    state=$(read_state)
    if is_holder_by_agent "$state" "$agent_id"; then
        was_holder=true
        matched_by="agent_id"
        state=$(echo "$state" | jq '.holder = null')
    elif is_holder_self "$state" "$branch" "$worktree"; then
        was_holder=true
        matched_by="branch_worktree"
        state=$(echo "$state" | jq '.holder = null')
    fi
    # Always also remove from queue (covers "I was queued and now I'm leaving").
    state=$(echo "$state" | jq --arg b "$branch" --arg w "$worktree" \
        '.queue = [.queue[] | select(.branch != $b or .worktree != $w)]')
    write_state "$state"
    mutex_unlock
    echo "$state" | jq --argjson wh "$was_holder" --arg mb "$matched_by" \
        '. + { released: true, was_holder: $wh, matched_by: (if $mb == "" then null else $mb end) }'
}

# -----------------------------------------------------------------------------
# Subcommand: heartbeat
# -----------------------------------------------------------------------------
# Same match-order as cmd_release: agent_id (if provided) primary, branch+worktree
# fallback. Keeps deploy_dev.sh's periodic heartbeat working under either
# identity scheme.
cmd_heartbeat() {
    if [ $# -lt 2 ] || [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
        echo '{"error": "missing_required_args", "expected": "<branch> <worktree> [--agent-id ID]"}' >&2
        exit 64
    fi
    local branch="$1" worktree="$2"
    shift 2
    local agent_id=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --agent-id) agent_id="$2"; shift 2 ;;
            *) echo "{\"error\": \"unknown_flag\", \"flag\": \"$1\"}" >&2; exit 64 ;;
        esac
    done
    init_state
    mutex_lock
    local state refreshed=false now
    now=$(now_iso)
    state=$(read_state)
    if is_holder_by_agent "$state" "$agent_id" || is_holder_self "$state" "$branch" "$worktree"; then
        refreshed=true
        state=$(echo "$state" | jq --arg now "$now" '.holder.heartbeat_at = $now')
        write_state "$state"
    fi
    mutex_unlock
    echo "$state" | jq --argjson r "$refreshed" '. + { refreshed: $r }'
}

# -----------------------------------------------------------------------------
# Subcommand: force-release
# -----------------------------------------------------------------------------
cmd_force_release() {
    init_state
    mutex_lock
    local state cleared
    state=$(read_state)
    cleared=$(echo "$state" | jq -c '.holder')
    state=$(echo "$state" | jq '.holder = null')
    write_state "$state"
    mutex_unlock
    echo "$state" | jq --argjson c "$cleared" '. + { cleared_holder: $c }'
}

# -----------------------------------------------------------------------------
# Subcommand: wait
# -----------------------------------------------------------------------------
cmd_wait() {
    # Validate before shift — see cmd_acquire for the same rationale.
    if [ $# -lt 3 ] || [ -z "${1:-}" ] || [ -z "${2:-}" ] || [ -z "${3:-}" ]; then
        echo '{"error": "missing_required_args", "expected": "<branch> <worktree> <purpose>"}' >&2
        exit 64
    fi
    local branch="$1" worktree="$2" purpose="$3"
    shift 3
    local timeout_seconds=1800
    local extra_args=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --timeout-seconds) timeout_seconds="$2"; shift 2 ;;
            *) extra_args+=("$1"); shift ;;
        esac
    done
    local out_file
    out_file=$(mktemp -t env-lock-wait.XXXXXX)
    # Caller may also Ctrl-C — clean up the temp file on exit.
    trap 'rm -f "$out_file"' RETURN

    local elapsed=0 poll_seconds=2 acquire_status
    while [ "$elapsed" -lt "$timeout_seconds" ]; do
        # `set -e` means we have to capture the status without letting non-0 abort us.
        set +e
        "$0" acquire "$branch" "$worktree" "$purpose" "${extra_args[@]}" >"$out_file" 2>&1
        acquire_status=$?
        set -e
        case "$acquire_status" in
            0)   cat "$out_file"; return 0 ;;
            1)   ;;  # busy + enqueued, keep polling
            *)   # bad usage / unexpected error — bubble it up immediately
                 cat "$out_file" >&2
                 exit "$acquire_status"
                 ;;
        esac
        sleep "$poll_seconds"
        elapsed=$((elapsed + poll_seconds))
    done
    echo "{\"error\": \"timeout\", \"timeout_seconds\": $timeout_seconds}" >&2
    exit 124
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------
SUBCOMMAND="${1:-}"
shift || true

# These are referenced by emit_acquire_result for queue position lookup.
BRANCH_FOR_RESULT="${1:-}"
WORKTREE_FOR_RESULT="${2:-}"

case "$SUBCOMMAND" in
    status)        cmd_status ;;
    acquire)       cmd_acquire "$@" ;;
    release)       cmd_release "$@" ;;
    heartbeat)     cmd_heartbeat "$@" ;;
    wait)          cmd_wait "$@" ;;
    force-release) cmd_force_release ;;
    -h|--help|help|"")
        sed -n '2,28p' "$0"
        exit 0
        ;;
    *)
        echo "{\"error\": \"unknown_subcommand\", \"value\": \"$SUBCOMMAND\"}" >&2
        exit 64
        ;;
esac
