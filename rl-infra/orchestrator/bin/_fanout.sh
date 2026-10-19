#!/usr/bin/env bash
# ROK-1793 S2 — helpers for bin/gate-fanout (parallel fleet gate parent).
# Source after _state.sh, _parser.sh and _borrow.sh. The caller sets P (parent
# task id), RL_TASKS_DIR, INNER_ENV, CHILD_TIMEOUT and FANOUT_CHILDREN (space-
# separated child ids dispatched so far).

# fanout::child_id <parent> <role> — child task id (≤32 chars, [a-z0-9]).
fanout::child_id() { printf '%s%s' "${1:0:31}" "$2"; }

# fanout::status <task_id> — the child's status ("missing" when no JSON).
fanout::status() {
    jq -r '.status // "unknown"' "$RL_TASKS_DIR/$1.json" 2>/dev/null || echo missing
}

# fanout::inner <extra_env> <args> — the validate-ci command run in the runner.
fanout::inner() { printf '%s%sbash /workspace/scripts/validate-ci.sh %s' "$INNER_ENV" "$1" "$2"; }

# fanout::dispatch <role> <slot> <weight> <agent> <borrowed> <extra_env> <args>
# Starts one child through task-start (RL_PARENT_TASK_ID=P) and appends it to
# P's children[]. The inner env (admin password) lands in the child's cmd once,
# exactly as a serial run's does; it is never echoed to the log.
fanout::dispatch() {
    local role="$1" slot="$2" weight="$3" agent="$4" borrowed="$5" cid
    cid=$(fanout::child_id "$P" "$role")
    if ! RL_AGENT_ID="$agent" RL_PARENT_TASK_ID="$P" task-start "$cid" --tool rl_validate_ci \
        --slot "$slot" --weight "$weight" --timeout-seconds "$CHILD_TIMEOUT" \
        -- "$BIN_DIR_SELF/run-on-runner-with-heartbeat" -- bash -c "$(fanout::inner "$6" "$7")" >/dev/null; then
        echo "[parallel] dispatch failed: child $role"
        return 1
    fi
    FANOUT_CHILDREN="${FANOUT_CHILDREN:+$FANOUT_CHILDREN }$cid"
    state::mutate "$RL_TASKS_DIR/$P.json" --arg id "$cid" --arg r "$role" --argjson s "$slot" \
        --argjson b "$borrowed" '.children = ((.children // []) + [{task_id:$id, role:$r, slot:$s, borrowed:$b}])'
    echo "[parallel] child $role: $cid on slot $slot"
}

# fanout::relay <task_id> — print the child's NEW complete `[step-time]` and
# `Name: STATUS` lines, unprefixed, so P's own step parser fills steps[].
# The read offset lives in a per-child file under RL_TASKS_DIR.
fanout::relay() {
    local log="$RL_TASKS_DIR/$1.log" off_file="$RL_TASKS_DIR/$P.relay-$1" off n=0 line
    [[ -f "$log" ]] || return 0
    off=$(cat "$off_file" 2>/dev/null || echo 0)
    while IFS= read -r line; do
        n=$((n + 1))
        if [[ "$line" =~ $PATTERN_STEP_TIME || "$line" =~ $PATTERN_STEP_RESULT ]]; then
            printf '%s\n' "$line"
        fi
    done < <(tail -n "+$((off + 1))" "$log")
    echo $((off + n)) > "$off_file"
}

# fanout::failed <task_id> — 0 when the child failed or logged a FAIL row.
fanout::failed() {
    [[ "$(fanout::status "$1")" == "failed" ]] && return 0
    grep -Eq ': FAIL(\x1b\[[0-9;]*m)?$' "$RL_TASKS_DIR/$1.log" 2>/dev/null
}

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_runner_drain.sh"

# fanout::drain_runner <slot> — drain child B on the borrowed runner (see
# runner_drain::drain). An unreachable runner does not block the parent's
# release: its own children are terminal and the trap must finish.
fanout::drain_runner() { runner_drain::drain "$1" || true; }

# fanout::release_borrow — drain the borrowed runner, then release the borrow.
fanout::release_borrow() {
    [[ -n "${BORROWED:-}" ]] || return 0
    fanout::drain_runner "$BORROWED"
    borrow::release "$BORROWED" "$P" || true
    BORROWED=""
}

# fanout::release_borrow_if_done — free the borrowed slot once the child running
# on it ($FANOUT_BORROW_CHILD) is terminal; a no-op otherwise or when already freed.
fanout::release_borrow_if_done() {
    [[ -n "${BORROWED:-}" && -n "${FANOUT_BORROW_CHILD:-}" ]] || return 0
    case "$(fanout::status "$FANOUT_BORROW_CHILD")" in running|queued|pending|unknown|missing|"") return 0 ;; esac
    echo "[parallel] releasing borrowed slot $BORROWED (child ${FANOUT_BORROW_CHILD: -1} done)"
    fanout::release_borrow
}

# fanout::wait_all <fail_fast> <ids...> — relay until every id is terminal.
# With fail_fast=1 the first FAILing child cancels its still-running siblings.
# The borrow row's heartbeat is refreshed every 30 s while waiting.
fanout::wait_all() {
    local ff="$1" id live last_hb=0; shift
    while :; do
        live=0
        for id in "$@"; do
            fanout::relay "$id"
            [[ "$(fanout::status "$id")" == "running" ]] && live=1
        done
        fanout::release_borrow_if_done
        (( live )) || return 0
        if [[ "$ff" == "1" ]]; then fanout::fail_fast "$@"; fi
        if [[ -n "${BORROWED:-}" ]] && (( $(date +%s) - last_hb >= 30 )); then
            borrow::heartbeat "$BORROWED" "$P" || true; last_hb=$(date +%s)
        fi
        sleep "${RL_FANOUT_POLL_SECONDS:-2}"
    done
}

# fanout::fail_fast <ids...> — cancel running siblings once any child FAILed.
fanout::fail_fast() {
    local id other
    for id in "$@"; do
        fanout::failed "$id" || continue
        for other in "$@"; do
            [[ "$other" != "$id" && "$(fanout::status "$other")" == "running" ]] || continue
            echo "[parallel] fail-fast: child ${id: -1} failed, cancelling ${other: -1}"
            task-cancel "$other" "fail_fast: sibling $id failed" >/dev/null 2>&1 || true
        done
        return 0
    done
}

# fanout::record_outcome <task_id> — copy the child's terminal status and
# script_exit_code onto its children[] entry in P's JSON (rl_task_status reads it).
fanout::record_outcome() {
    local st ex
    st=$(fanout::status "$1")
    ex=$(jq -c '.script_exit_code // null' "$RL_TASKS_DIR/$1.json" 2>/dev/null || echo null)
    state::mutate "$RL_TASKS_DIR/$P.json" --arg id "$1" --arg st "$st" --argjson ex "${ex:-null}" \
        '.children = [(.children // [])[] | if .task_id == $id then .status = $st | .exit = $ex else . end]' || true
}

# fanout::cleanup — EXIT trap: cancel live children, release the borrow.
fanout::cleanup() {
    local id
    for id in ${FANOUT_CHILDREN:-}; do
        if [[ "$(fanout::status "$id")" == "running" ]]; then
            task-cancel "$id" "parent_exit: $P" >/dev/null 2>&1 || true
        fi
        rm -f "$RL_TASKS_DIR/$P.relay-$id"
        fanout::record_outcome "$id"
    done
    fanout::release_borrow
}
