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
EXEC_BITS_SCRIPT="/workspace/rl-infra/runner/restore-exec-bits.sh"

# Re-assert /workspace's exec bits inside $1 (a runner container) before the
# caller's command is dispatched.
#
# Returns 0 when the tree is executable (or when there is no repair script to
# run — see below), 97 when the tree exists but could not be repaired.
#
# Three deliberate details:
#   * Invoked with an EXPLICIT `bash`. The repair script is synced through the
#     same permission-stripping path as everything it repairs, so it cannot rely
#     on its own exec bit — that is precisely how it would fail.
#   * A MISSING repair script is a warning, not a failure. A worktree may
#     legitimately predate it (older branch, mid-bisect); hard-failing would make
#     every claim on such a branch unrunnable for a problem it doesn't have.
#   * stdin is closed and stdout is captured onto stderr. Callers parse
#     run-on-runner's stdout (jq envelopes, the MCP sync-guard's sentinel probe)
#     and pipe scripts into its stdin (`bash -s <<<"$script"`); the repair must
#     consume neither.
exec_bits::ensure_before_dispatch() {
    local container="$1"
    [[ "${RL_SKIP_EXEC_BITS:-0}" == "1" ]] && return 0
    [[ -z "$container" ]] && return 0

    local out rc=0
    out=$(docker exec -w /workspace "$container" bash -c '
        if [[ ! -f "$1" ]]; then
            echo "rl-exec-bits: WARN no repair script at $1 — skipping the pre-dispatch repair" >&2
            exit 0
        fi
        exec bash "$1" /workspace
    ' _ "$EXEC_BITS_SCRIPT" 2>&1 </dev/null) || rc=$?

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
