#!/usr/bin/env bash
# Shared helpers for the orchestrator. Source this from every bin/* script.
# Provides:
#   - jq+flock based atomic mutation of state files
#   - audit logging
#   - JSON output helpers
# State files (canonical locations on the VM):
#   /srv/rl-infra/state/claims.json
#   /srv/rl-infra/state/env-registry.json
#   /srv/rl-infra/state/audit.log

set -euo pipefail

# Source the stack-wide .env so orchestrator scripts inherit RL_PUBLIC_DOMAIN,
# GRAFANA_ADMIN_PASSWORD, etc. Without this, env-spin wouldn't know to write
# external host rules for Traefik or pass PUBLIC_URL to the allinone container.
# Safe — .env is operator-owned and read-only to rl-agent.
if [[ -f /srv/rl-infra/.env ]]; then
    set -a
    # shellcheck disable=SC1091
    . /srv/rl-infra/.env
    set +a
fi

# Route Docker calls through the socket-proxy by default. The operator can
# override with RL_USE_DOCKER_SOCKET=1 to bypass and hit /var/run/docker.sock
# directly (useful for ops like `docker compose down` that the proxy blocks).
# When the proxy is unreachable (e.g. on first stack bring-up), this falls
# back transparently.
if [[ -z "${DOCKER_HOST:-}" && "${RL_USE_DOCKER_SOCKET:-0}" != "1" ]]; then
    if curl -fsS --max-time 1 http://127.0.0.1:2375/_ping >/dev/null 2>&1; then
        export DOCKER_HOST=tcp://127.0.0.1:2375
    fi
fi

RL_STATE_DIR="${RL_STATE_DIR:-/srv/rl-infra/state}"
RL_CLAIMS_FILE="${RL_STATE_DIR}/claims.json"
RL_ENVS_FILE="${RL_STATE_DIR}/env-registry.json"
RL_AUDIT_LOG="${RL_STATE_DIR}/audit.log"
RL_LOCK_DIR="${RL_STATE_DIR}/locks"
# Default matches the docker-compose.yml default profile (2 runners). Override
# via .env to 4 when the `extra-slots` compose profile is enabled.
RUNNER_SLOTS="${RUNNER_SLOTS:-2}"
mkdir -p "$RL_LOCK_DIR"

# Initialize state files if missing. Safe to call repeatedly.
state::init() {
    if [[ ! -s "$RL_CLAIMS_FILE" ]]; then
        local slots="[]"
        for i in $(seq 1 "$RUNNER_SLOTS"); do
            slots=$(jq --arg s "$i" '. + [{slot: ($s|tonumber), claimed: false, agent_id: null, branch: null, started_at: null, last_heartbeat: null}]' <<<"$slots")
        done
        echo "$slots" > "$RL_CLAIMS_FILE"
    fi
    if [[ ! -s "$RL_ENVS_FILE" ]]; then
        echo "[]" > "$RL_ENVS_FILE"
    fi
    touch "$RL_AUDIT_LOG"
}

# Atomic transform: state::mutate <file> <jq-filter>
# Acquires flock, applies the filter, writes back atomically.
#
# Tmpfile lives in the SAME directory as the target file so:
#   1. mv across directories isn't needed (atomic rename works only same-fs).
#   2. The setgid bit on the state dir (chmod 2775) makes the new file
#      inherit the rl-fleet group, so both rl and rl-agent can write.
# After the mv, force mode 664 — mktemp creates with 600 which would lock
# out the other fleet user on the next call.
state::mutate() {
    local file="$1"
    shift
    local lockname
    lockname=$(basename "$file").lock
    (
        flock -x 200
        local tmp
        tmp=$(mktemp "${file}.XXXXXX")
        jq "$@" "$file" > "$tmp"
        mv "$tmp" "$file"
        chmod 664 "$file" 2>/dev/null || true
    ) 200>"$RL_LOCK_DIR/$lockname"
}

# Read-only query: state::query <file> <jq-filter>
state::query() {
    local file="$1"
    shift
    jq "$@" "$file"
}

# Append a structured audit line.
# audit::log <command> <outcome> [extra-json]
audit::log() {
    local cmd="$1"
    local outcome="$2"
    # Default to '{}' if no extra JSON passed. Do NOT use ${3:-{}} — bash
    # parses the first `}` as the end of the parameter expansion, leaving
    # the second `}` as literal text, which gives us "{}}" instead of "{}".
    local extra="${3-}"
    [[ -z "$extra" ]] && extra='{}'
    local agent="${RL_AGENT_ID:-unknown}"
    local ts
    ts=$(date -u +%FT%TZ)
    jq -nc \
        --arg ts "$ts" \
        --arg cmd "$cmd" \
        --arg outcome "$outcome" \
        --arg agent "$agent" \
        --argjson extra "$extra" \
        '{ts: $ts, cmd: $cmd, outcome: $outcome, agent: $agent} + $extra' \
        >> "$RL_AUDIT_LOG"
}

# Resolve the slot belonging to an agent. Echoes slot number or empty.
state::slot_for_agent() {
    local agent="$1"
    state::query "$RL_CLAIMS_FILE" --arg a "$agent" \
        '[.[] | select(.agent_id == $a and .claimed == true) | .slot] | first // empty'
}

state::init
