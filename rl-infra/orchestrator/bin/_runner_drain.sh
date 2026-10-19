#!/usr/bin/env bash
# ROK-1793 S2 — runner-side drain of a borrowed slot, shared by gate-fanout
# (_fanout.sh) and the gc-sweeper's orphan-borrow release. FUNCTION-ONLY: no
# side effects on source, so the sweeper can source it from /orchestrator-lib.
#
# A timed-out/cancelled child's `docker exec` client dies first, but its
# container-side Playwright can keep using the workspace and target env;
# releasing the borrow before a drain would hand a live workspace to a waiter.

# Child-B process pattern on the borrowed runner. The borrowed runner runs
# nothing but child B, so every match there is B's.
RUNNER_DRAIN_PROC_PATTERN='validate-ci\.sh|jest|vitest|playwright|npm |node '

# runner_drain::drain <slot> — probe rl-runner-<slot>; wait (≤ RL_FANOUT_DRAIN_SECONDS,
# default 60) until no child-B process remains, then SIGKILL any that outlived
# the window. Returns 0 once drained (or killed), 2 when the runner cannot be
# exec'd into at all (the caller must then NOT treat the runner as drained).
# pgrep runs directly (no `sh -c`) so it never matches its own command line.
runner_drain::drain() {
    local r="rl-runner-$1" end
    docker exec "$r" true >/dev/null 2>&1 || return 2
    end=$(awk -v n="$(date +%s)" -v d="${RL_FANOUT_DRAIN_SECONDS:-60}" 'BEGIN { printf "%d", n + d + 0.999 }')
    while docker exec "$r" pgrep -f "$RUNNER_DRAIN_PROC_PATTERN" >/dev/null 2>&1; do
        if (( $(date +%s) >= end )); then
            echo "[drain] slot $1: child B processes outlived the drain window, killing them"
            docker exec "$r" pkill -KILL -f "$RUNNER_DRAIN_PROC_PATTERN" >/dev/null 2>&1 || true
            return 0
        fi
        sleep "${RL_FANOUT_DRAIN_POLL_SECONDS:-1}"
    done
    return 0
}
