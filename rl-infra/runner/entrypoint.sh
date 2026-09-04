#!/usr/bin/env bash
# Runner entrypoint. Starts a long-lived tmux session named `main` so the
# host-side `rl shell` command can attach into the same context across runs.
set -euo pipefail

# Idempotent — survives container restarts because tmux server is per-container.
if ! tmux has-session -t main 2>/dev/null; then
    tmux new-session -d -s main -c /workspace
    tmux send-keys -t main "echo 'rl-runner-${RL_SLOT:-?} ready — pwd: /workspace'" Enter
fi

# Convenience marker file so /workspace bind-mount sanity can be checked from
# the host without exec'ing into the container.
echo "$(date -u +%FT%TZ) runner-${RL_SLOT:-?} entrypoint" > /tmp/runner-heartbeat

# A3-B P3 — report the /state-locks mount by name into the container log, which
# is what Loki indexes and what `docker logs rl-runner-N` shows. Runners 3-4
# shipped without this mount, so the Discord-smoke lock branch in
# validate-ci.sh was skipped and smoke ran unsynchronized, exit 0 — the defect
# announced itself only as non-deterministic bot disconnects on another slot.
#
# ADVISORY, never fatal: a mount is fixed by recreating the container, and
# crash-looping the runner would take the whole slot out of the fleet to report
# a problem that only affects Discord smoke. `|| true` is safe here precisely
# because the script's job is to emit the named line, not to gate anything.
bash "${RL_CHECK_STATE_LOCKS:-/usr/local/bin/rl-check-state-locks}" || true

exec "$@"
