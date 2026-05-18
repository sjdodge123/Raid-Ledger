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

exec "$@"
