#!/usr/bin/env bash
# Pre-dispatch exec-bit repair for a runner's /workspace. (A3-B)
#
# WHY THIS EXISTS — AND WHY IT IS NOT THE SAME AS flush_mutagen's CALL
# -------------------------------------------------------------------
# A3-B P2 added rl-infra/runner/restore-exec-bits.sh and wired it into
# rl-infra/cli/rl::flush_mutagen, which fires at explicit-flush time (cmd_claim,
# cmd_validate_ci). That is necessary but NOT sufficient, because the Mutagen
# session is CONTINUOUS: every laptop write after that flush is delivered to the
# runner at 0644 (--permissions-mode=manual, a deliberate Bug S / ROK-1326
# choice — `portable` propagated macOS xattr perms and broke the allinone
# `docker COPY`) and silently re-drops the bit the repair had just restored.
#
# That is not theoretical. On 2026-09-03 a `git rebase` on the laptop re-synced
# orchestrator/bin/task-cancel at 00:13, AFTER the gate's restore had passed.
# task-cancel-runner-children.test.sh invokes "$BIN_DIR/task-cancel" directly,
# got permission-denied, and reported 10/17 on the runner against 17/0 on the
# laptop. None of the ten failures mentioned permissions.
#
# The class only closes if the guarantee is re-asserted at the moment of
# EXECUTION rather than at the moment of sync. run-on-runner and
# run-on-runner-with-heartbeat are the two chokepoints every runner-side
# execution passes through — the CLI's `rl validate-ci`, the MCP server's
# rl_run_on_runner, task-start's dispatch, and cli/rl's own scaffold/probe
# helpers all funnel through them. Repairing here means "re-synced after the
# last restore" is no longer a state anything can be launched in.
#
# WHY NOT A MUTAGEN POST-SYNC HOOK: Mutagen has no post-sync command hook, and
# the permissions mode that causes this must not change (Bug S). WHY NOT the
# runner entrypoint: it runs once, at container start, before any sync.
#
# Cost: one extra `docker exec` (~100-300ms) per dispatch. RL_SKIP_EXEC_BITS=1
# opts a hot path out; nothing in-tree sets it, it exists for the operator.

# Reserved by rl-infra/runner/restore-exec-bits.sh — deliberately NOT 126, so an
# environment failure is tellable apart in a log from the shell's own
# "found but not executable" that it replaces.
EXEC_BITS_FATAL_CODE=97
EXEC_BITS_PURGE_FATAL_CODE=96
# ROK-1849 Codex r2 — the scripts run before dispatch come from the
# orchestrator's OWN rl-infra checkout (this file's ../../runner), streamed into
# the container over stdin (`bash -s`). The /workspace copies are branch content:
# executing them while previously-synced secrets may still be readable would let
# a hostile branch exfiltrate them or skip the purge. Nothing under /workspace
# executes until the trusted purge has succeeded for this dispatch.
EXEC_BITS_RUNNER_DIR="${RL_INFRA_RUNNER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../runner" 2>/dev/null && pwd)}"

# Stream one trusted runner/ script into $1 as `bash -s -- /workspace`.
# stdout is captured (callers parse run-on-runner's stdout), stdin is the
# script file, never the caller's stdin.
exec_bits::_stream() {
    local container="$1" script="$EXEC_BITS_RUNNER_DIR/$2"
    if [[ ! -f "$script" ]]; then
        echo "rl-exec-bits: operator script missing: $script" >&2
        return 2
    fi
    docker exec -i -w /workspace "$container" bash -s -- /workspace < "$script" 2>&1
}

# Pre-dispatch: (1) purge synced .env secrets, (2) repair exec bits — both from
# the orchestrator's own checkout. Returns 0 when ready, 96 when the purge failed
# (nothing is dispatched), 97 when the tree could not be made executable.
exec_bits::ensure_before_dispatch() {
    local container="$1"
    [[ -z "$container" ]] && return 0
    local out rc=0
    out=$(exec_bits::_stream "$container" purge-synced-secrets.sh) || rc=$?
    if (( rc != 0 )); then
        [[ -n "$out" ]] && printf '%s\n' "$out" >&2
        echo "[rl] FATAL pre-dispatch secret purge failed on $container (rc=$rc) — refusing to dispatch." >&2
        return "$EXEC_BITS_PURGE_FATAL_CODE"
    fi
    [[ -n "$out" ]] && printf '%s\n' "$out" >&2
    [[ "${RL_SKIP_EXEC_BITS:-0}" == "1" ]] && return 0
    rc=0
    out=$(exec_bits::_stream "$container" restore-exec-bits.sh) || rc=$?
    if (( rc != 0 )); then
        {
            [[ -n "$out" ]] && printf '%s\n' "$out"
            echo "[rl] FATAL pre-dispatch exec-bit repair failed on $container (rc=$rc)."
            echo "[rl] Refusing to dispatch: /workspace's scripts are not executable, so the"
            echo "[rl] command would die with a bare 126 that reads like a test regression."
            echo "[rl] This is an ENVIRONMENT problem. Try: rl resync (or release + re-claim)."
        } >&2
        return "$EXEC_BITS_FATAL_CODE"
    fi
    [[ -n "$out" ]] && printf '%s\n' "$out" >&2
    return 0
}
