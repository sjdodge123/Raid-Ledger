#!/usr/bin/env bash
# ROK-1793 S2 — runner-side drain of a borrowed slot, shared by gate-fanout
# (_fanout.sh) and the gc-sweeper's orphan-borrow release. FUNCTION-ONLY: no
# side effects on source, so the sweeper can source it from /orchestrator-lib.
#
# A timed-out/cancelled child's `docker exec` client dies first, but its
# container-side Playwright can keep using the workspace and target env;
# releasing the borrow before a drain would hand a live workspace to a waiter.
#
# Codex r5: the drain is scoped by the per-task marker, never by a command-line
# pattern. task-start exports RL_TASK_ID=<task_id> and run-on-runner{,-with-
# heartbeat} forward it with `docker exec -e`, so every runner-side descendant
# of the child carries it — and only that child's descendants do (task ids are
# unique). A queued claimant that took the slot meanwhile is never matched.
# /proc/<pid>/environ is read because pgrep/pkill see only the command line.

# shellcheck disable=SC2016
RUNNER_DRAIN_SCAN_SCRIPT='
mode="$1"; shift; self=$$; n=0
for d in /proc/[0-9]*; do
    [ -r "$d/environ" ] || continue
    p=${d#/proc/}
    [ "$p" = "$self" ] && continue
    env=$(tr "\000" "\n" < "$d/environ" 2>/dev/null) || continue
    for t in "$@"; do
        if printf "%s\n" "$env" | grep -qxF "RL_TASK_ID=$t"; then
            n=$((n + 1))
            [ "$mode" = count ] || kill -KILL "$p" 2>/dev/null
            break
        fi
    done
done
echo "drained=$n"
'

# runner_drain::scan <runner> <count|kill> <task_id...> — echo how many runner
# processes carry one of the markers (killing them with mode=kill). Returns 1 on
# an exec/docker error or unparseable output: that is NOT "no processes".
runner_drain::scan() {
    local r="$1" mode="$2" out; shift 2
    out=$(docker exec "$r" sh -c "$RUNNER_DRAIN_SCAN_SCRIPT" rl-drain "$mode" "$@" 2>/dev/null) || return 1
    out=$(printf '%s\n' "$out" | tail -1)
    [[ "$out" =~ ^drained=([0-9]+)$ ]] || return 1
    echo "${BASH_REMATCH[1]}"
}

# runner_drain::drain <slot> <task_id...> — wait (≤ RL_FANOUT_DRAIN_SECONDS,
# default 60) until no process marked with one of the task ids remains on
# rl-runner-<slot>, then SIGKILL the marked survivors and VERIFY they are gone.
# Returns 0 once drained, 2 when the runner cannot be exec'd into (or no marker
# was given), 3 when the drain failed (scan error mid-drain, or marked
# processes survive the kill). Non-zero means: do NOT treat the runner as free.
runner_drain::drain() {
    local slot="$1" r="rl-runner-$1" end n _; shift
    (( $# > 0 )) || return 2
    docker exec "$r" true >/dev/null 2>&1 || return 2
    end=$(awk -v n="$(date +%s)" -v d="${RL_FANOUT_DRAIN_SECONDS:-60}" 'BEGIN { printf "%d", n + d + 0.999 }')
    while :; do
        n=$(runner_drain::scan "$r" count "$@") || return 3
        (( n == 0 )) && return 0
        (( $(date +%s) >= end )) && break
        sleep "${RL_FANOUT_DRAIN_POLL_SECONDS:-1}"
    done
    echo "[drain] slot $slot: $n marked process(es) outlived the drain window, killing them"
    runner_drain::scan "$r" kill "$@" >/dev/null || return 3
    for _ in 1 2 3; do
        n=$(runner_drain::scan "$r" count "$@") || return 3
        (( n == 0 )) && return 0
        sleep "${RL_FANOUT_DRAIN_POLL_SECONDS:-1}"
    done
    return 3
}
