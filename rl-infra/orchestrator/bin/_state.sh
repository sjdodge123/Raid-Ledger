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
# Honor explicit overrides so test fixtures can redirect to non-canonical
# paths (mirrors the `RL_TASKS_DIR` + `RL_LEASE_QUEUE_DIR` pattern below).
# Production unaffected — these env vars are never set on the VM.
RL_CLAIMS_FILE="${RL_CLAIMS_FILE:-${RL_STATE_DIR}/claims.json}"
RL_ENVS_FILE="${RL_ENVS_FILE:-${RL_STATE_DIR}/env-registry.json}"
RL_QUEUE_FILE="${RL_QUEUE_FILE:-${RL_STATE_DIR}/queue.json}"
RL_AUDIT_LOG="${RL_AUDIT_LOG:-${RL_STATE_DIR}/audit.log}"
# ROK-1331 M11 — perf log: sibling of audit.log. Append-only, one JSON
# object per line. Rotated daily by logrotate (cloud-init.yaml) with
# copytruncate — perf::emit opens+appends+closes per call so the rotation
# is safe (no long-lived FD).
RL_PERF_LOG="${RL_PERF_LOG:-${RL_STATE_DIR}/perf.log}"
RL_LOCK_DIR="${RL_STATE_DIR}/locks"
RL_TASKS_DIR="${RL_TASKS_DIR:-${RL_STATE_DIR}/tasks}"
# ROK-1331 M5a — per-slot lease-queue dir. Each slot owns a FIFO array file
# at $RL_LEASE_QUEUE_DIR/<slot>.json. The legacy global queue.json is still
# written to for one transition cycle so the dashboard keeps rendering until
# M5b rewires; the per-slot files are the source of truth for lease-advance.
RL_LEASE_QUEUE_DIR="${RL_LEASE_QUEUE_DIR:-${RL_STATE_DIR}/lease-queue}"
# Stale-head eviction threshold: queue entries whose last_heartbeat is older
# than this are evicted by lease-advance before granting. Mirrors the
# sweeper's CLAIM_HEARTBEAT_TIMEOUT_SECONDS shape but for queue waiters.
RL_LEASE_HEAD_TIMEOUT_SECONDS="${RL_LEASE_HEAD_TIMEOUT_SECONDS:-300}"
# Default claim duration when a slot is granted (lease TTL). M5a's claim
# expiry reaper drives lifecycle once `expires_at` is populated.
RL_CLAIM_DURATION_SECONDS="${RL_CLAIM_DURATION_SECONDS:-86400}"
# Default matches the docker-compose.yml default profile (2 runners). Override
# via .env to 4 when the `extra-slots` compose profile is enabled.
RUNNER_SLOTS="${RUNNER_SLOTS:-2}"
mkdir -p "$RL_LOCK_DIR" "$RL_TASKS_DIR" "$RL_LEASE_QUEUE_DIR"

# Portability shim: flock(1) lives in util-linux on the VM, but macOS test
# runners don't ship it. When absent we fall back to a no-op (tests are
# sequential; production runs on Linux where the real binary serializes
# under contention). Defining the shim once here keeps callers
# (state::mutate, state::mutate_with_precondition) unchanged.
if ! command -v flock >/dev/null 2>&1; then
    flock() {
        # Accept any combination of `-x`, `-s`, `-n`, `-w <sec>`, `<fd>`.
        # We only care that the function returns 0 so the surrounding subshell
        # continues to the jq + mv. No real locking happens.
        return 0
    }
fi

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
    if [[ ! -s "$RL_QUEUE_FILE" ]]; then
        echo "[]" > "$RL_QUEUE_FILE"
    fi
    mkdir -p "$RL_TASKS_DIR"
    chmod 2775 "$RL_TASKS_DIR" 2>/dev/null || true
    mkdir -p "$RL_LEASE_QUEUE_DIR"
    chmod 2775 "$RL_LEASE_QUEUE_DIR" 2>/dev/null || true
    touch "$RL_AUDIT_LOG"
}

# ROK-1331 M5a — per-slot lease-queue helpers. Each slot has its own
# FIFO file (lease-queue/<slot>.json) so inotifywait on the directory
# can detect any slot's mutation in one watcher process.
#
# Lock ordering (STRICT): when an op touches BOTH claims.json AND a
# lease-queue/<slot>.json, ALWAYS lock the queue FIRST then claims.
# Reverse-order callers could deadlock against lease-advance, which
# acquires queue → claims inside `lease::advance`.
lease::file_for_slot() {
    local slot="$1"
    printf '%s/%s.json' "$RL_LEASE_QUEUE_DIR" "$slot"
}

# Ensure the per-slot queue file exists with `[]` initial content. Safe to
# call repeatedly; idempotent under concurrent callers (atomic touch).
lease::ensure_file() {
    local slot="$1"
    local f
    f=$(lease::file_for_slot "$slot")
    if [[ ! -s "$f" ]]; then
        echo "[]" > "$f.init.$$"
        mv -n "$f.init.$$" "$f" 2>/dev/null || rm -f "$f.init.$$"
        chmod 664 "$f" 2>/dev/null || true
    fi
}

# Echo the agent_id at the head of the slot's queue, or empty.
lease::head_agent() {
    local slot="$1"
    local f
    f=$(lease::file_for_slot "$slot")
    [[ -f "$f" ]] || { echo ""; return 0; }
    jq -r '.[0].agent_id // empty' "$f" 2>/dev/null || true
}

# 0-based position of agent in the slot's queue (or empty if absent).
lease::position() {
    local slot="$1" agent="$2"
    local f
    f=$(lease::file_for_slot "$slot")
    [[ -f "$f" ]] || { echo ""; return 0; }
    jq -r --arg a "$agent" \
        '[.[] | .agent_id] | index($a) // empty' "$f" 2>/dev/null || true
}

# Length of the slot's queue.
lease::length() {
    local slot="$1"
    local f
    f=$(lease::file_for_slot "$slot")
    [[ -f "$f" ]] || { echo 0; return 0; }
    jq 'length' "$f" 2>/dev/null || echo 0
}

# Append an entry (idempotent on agent_id). Updates last_heartbeat if the
# agent is already queued — heartbeat refresh on poll.
lease::add() {
    local slot="$1" agent="$2" branch="$3" ts="$4"
    lease::ensure_file "$slot"
    local f
    f=$(lease::file_for_slot "$slot")
    state::mutate "$f" \
        --arg a "$agent" --arg b "$branch" --arg t "$ts" \
        'if any(.[]; .agent_id == $a)
         then map(if .agent_id == $a then .last_heartbeat = $t else . end)
         else . + [{agent_id: $a, branch: $b, requested_at: $t, preempt: false, last_heartbeat: $t}]
         end'
}

# Remove an entry from the slot's queue (idempotent).
lease::remove() {
    local slot="$1" agent="$2"
    local f
    f=$(lease::file_for_slot "$slot")
    [[ -f "$f" ]] || return 0
    state::mutate "$f" --arg a "$agent" 'map(select(.agent_id != $a))'
}

# Pick the slot to enqueue against when all slots are busy:
# smallest queue wins; lowest slot id on tie. Echoes a slot number.
lease::pick_enqueue_slot() {
    local best_slot="" best_len=""
    local slot len
    for slot in $(seq 1 "$RUNNER_SLOTS"); do
        len=$(lease::length "$slot")
        if [[ -z "$best_slot" || "$len" -lt "$best_len" ]]; then
            best_slot="$slot"
            best_len="$len"
        fi
    done
    echo "$best_slot"
}

# Read queue entries BEFORE a given agent (the "queue_ahead" slice). JSON
# array; empty array when agent is head or not queued.
lease::ahead_of() {
    local slot="$1" agent="$2"
    local f
    f=$(lease::file_for_slot "$slot")
    [[ -f "$f" ]] || { echo "[]"; return 0; }
    jq --arg a "$agent" \
        '. as $q
         | ([.[] | .agent_id] | index($a)) as $pos
         | if $pos == null or $pos == 0 then []
           else $q[0:$pos] | map({agent_id, branch, requested_at})
           end' "$f" 2>/dev/null || echo "[]"
}

# ROK-1331 M5a — env-registry pinned/claimable helpers. Default missing
# fields to safe values via // false / // "" so legacy entries without the
# M5a additions don't break callers.
env_registry::set_pinned() {
    local slug="$1" pinned="$2"
    state::mutate "$RL_ENVS_FILE" --arg slug "$slug" --argjson p "$pinned" \
        'map(if .slug == $slug then .pinned = ($p == true) else . end)'
}

env_registry::mark_claimable_by_next() {
    local slot="$1" branch="$2"
    state::mutate "$RL_ENVS_FILE" --argjson s "$slot" --arg b "$branch" \
        'map(if .slot == $s
             then .claimable_by_next = true
                | .created_for_branch = $b
             else . end)'
}

env_registry::clear_claimable_for_slot() {
    local slot="$1"
    state::mutate "$RL_ENVS_FILE" --argjson s "$slot" \
        'map(if .slot == $s then .claimable_by_next = false else . end)'
}

# ROK-1331 M1: thin audit wrapper for task-* commands. Folds the task_id into
# the extra-json payload so downstream filtering can `jq 'select(.task_id ...)'`.
task::audit() {
    local task_id="$1"
    local cmd="$2"
    local outcome="$3"
    local extra="${4-}"
    [[ -z "$extra" ]] && extra='{}'
    local merged
    merged=$(jq -nc --arg t "$task_id" --argjson e "$extra" '{task_id: $t} + $e')
    audit::log "task-$cmd" "$outcome" "$merged"
}

# Queue helpers. The queue is an ordered array of {agent_id, branch, queued_at}.
# Pull-based: release just frees a slot, the next claim from the queue head
# atomically dequeues + acquires.
queue::position() {
    # Echoes 0-based position if agent is in queue, else empty.
    local agent="$1"
    state::query "$RL_QUEUE_FILE" --arg a "$agent" \
        '[.[] | .agent_id] | index($a) // empty'
}

queue::head_agent() {
    # LEGACY — pre-M5a global queue. Now superseded by `lease::head_agent <slot>`
    # in M5a's per-slot lease-queue model. Retained for any code path that still
    # reads the global queue.json mirror.
    #
    # NOTE (ROK-1331 dogfood-discovery 2026-05-20): added `-r` so the returned
    # agent_id strips JSON quotes. Without `-r`, the value comes back as
    # `"sdodge-xxxx"` with literal quote chars, breaking bash string comparisons
    # like `[[ "$QUEUE_HEAD" == "$RL_AGENT_ID" ]]` in old-flow callers.
    state::query "$RL_QUEUE_FILE" -r '.[0].agent_id // empty'
}

queue::add() {
    # Append agent to queue if not already present. No-op if present.
    local agent="$1" branch="$2" ts="$3"
    state::mutate "$RL_QUEUE_FILE" \
        --arg a "$agent" --arg b "$branch" --arg t "$ts" \
        'if any(.[]; .agent_id == $a) then . else . + [{agent_id: $a, branch: $b, queued_at: $t}] end'
}

queue::remove() {
    local agent="$1"
    state::mutate "$RL_QUEUE_FILE" --arg a "$agent" 'map(select(.agent_id != $a))'
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
        # Validate the existing file IS valid JSON before mutating.
        # Without this, a corrupted state file (kill -9 mid-rename, disk
        # full mid-write, etc.) silently lets the jq filter receive null
        # and produce a fresh tree that obliterates real state. Refuse
        # loudly instead. Companion to the read-side validation in
        # claim's queue-head check (H-VM-3).
        if ! jq empty "$file" 2>/dev/null; then
            echo "state::mutate: $file is not valid JSON — refusing to mutate" >&2
            return 1
        fi
        local tmp
        tmp=$(mktemp "${file}.XXXXXX")
        jq "$@" "$file" > "$tmp"
        mv "$tmp" "$file"
        chmod 664 "$file" 2>/dev/null || true
    ) 200>"$RL_LOCK_DIR/$lockname"
}

# Like state::mutate but the caller can encode a precondition INSIDE the
# jq filter (e.g. `select(.claimed == false)`) — used by claim to close
# the TOCTOU race between free-slot lookup and the slot-flip mutation
# (H-VM-2). Both the slot-pick AND the mutation happen inside the same
# flock window. Returns 0 if the mutation took effect, 1 if the
# precondition rejected (the produced tree was identical to input).
state::mutate_with_precondition() {
    local file="$1"
    shift
    local lockname
    lockname=$(basename "$file").lock
    (
        flock -x 200
        if ! jq empty "$file" 2>/dev/null; then
            echo "state::mutate_with_precondition: $file is not valid JSON" >&2
            return 1
        fi
        local tmp
        tmp=$(mktemp "${file}.XXXXXX")
        jq "$@" "$file" > "$tmp"
        # Identical output = precondition rejected. Caller handles.
        if cmp -s "$file" "$tmp"; then
            rm -f "$tmp"
            return 1
        fi
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

# ROK-1331 M11 — millisecond-precision timer + ISO-8601-ms timestamp.
# bash 5+ provides EPOCHREALTIME ("1234567890.123456"); older bash (incl.
# macOS default 3.2) does not. Fall back to python3 for portability. The
# VM ships bash 5 so this fast-path uses EPOCHREALTIME there; the local
# test runner uses python3 transparently.
perf::_now_ms() {
    if [[ -n "${EPOCHREALTIME:-}" && "$EPOCHREALTIME" == *.* ]]; then
        # secs.usec → ms
        local secs="${EPOCHREALTIME%.*}" frac="${EPOCHREALTIME#*.}"
        frac="${frac}000"
        frac="${frac:0:3}"
        echo "${secs}${frac}"
        return
    fi
    python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null \
        || echo "$(($(date +%s) * 1000))"
}

# ROK-1331 M11 — perf logging helpers.
#
# perf::emit <event> [extra-json]
#   Append one JSON object to RL_PERF_LOG. Required fields are merged with
#   the caller's `extra` object (flat snake_case). Open+append+close per
#   call so logrotate's copytruncate is safe (no long-lived FD).
#
# perf::start <key> / perf::end <key> <event> [extra-json]
#   Paired timing helpers. perf::start stashes EPOCHREALTIME under
#   /tmp/.rl-perf-<key>.<pid>; perf::end reads it, computes duration_ms,
#   merges into `extra`, and calls perf::emit. EPOCHREALTIME is bash 5+
#   (VM has it); the awk fallback uses second-resolution and still emits
#   so callers don't break on older bash.
#
# Best-effort by design — every call routes through a `|| true`-ish guard
# at the perf::emit boundary so an emit failure (disk full, jq missing on
# a hostile path) never breaks the calling control flow.
perf::emit() {
    local event="$1"
    local extra="${2-}"
    [[ -z "$extra" ]] && extra='{}'
    # ISO-8601 with ms precision. python3 path is portable across macOS
    # (BSD date lacks %3N) and the Linux VM (GNU date supports %3N but the
    # python3 path is just as cheap when bash 3.2 is the runtime).
    local ts
    ts=$(date -u +%FT%T.%3NZ 2>/dev/null || true)
    if [[ -z "$ts" || "$ts" == *N* ]]; then
        ts=$(python3 -c "import datetime; print(datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.') + ('%03d' % (datetime.datetime.utcnow().microsecond // 1000)) + 'Z')" 2>/dev/null \
            || date -u +%FT%TZ)
    fi
    local agent="${RL_AGENT_ID:-unknown}"
    local branch="${RL_BRANCH:-unknown}"
    # jq -c (compact) + append. Errors are swallowed — perf logging never
    # blocks the caller.
    jq -nc \
        --arg ts "$ts" \
        --arg ev "$event" \
        --arg agent "$agent" \
        --arg branch "$branch" \
        --argjson extra "$extra" \
        '{ts:$ts, event:$ev, source:"orchestrator", agent_id:$agent, branch:$branch} + $extra' \
        >> "$RL_PERF_LOG" 2>/dev/null || true
}

# Stash a millisecond timestamp under a per-pid sentinel file so multiple
# parallel timers can coexist in the same shell.
perf::start() {
    local key="$1"
    perf::_now_ms > "/tmp/.rl-perf-${key}.$$" 2>/dev/null || true
}

# Compute duration_ms from the matching perf::start and emit.
perf::end() {
    local key="$1" event="$2" extra="${3-}"
    [[ -z "$extra" ]] && extra='{}'
    local sentinel="/tmp/.rl-perf-${key}.$$"
    local start_ms="0" end_ms dur=0
    if [[ -r "$sentinel" ]]; then
        start_ms=$(cat "$sentinel" 2>/dev/null || echo 0)
    fi
    end_ms=$(perf::_now_ms)
    if [[ "$start_ms" != "0" ]]; then
        dur=$(( end_ms - start_ms ))
        (( dur < 0 )) && dur=0
    fi
    rm -f "$sentinel" 2>/dev/null || true
    # Merge duration_ms into extra so it's a first-class field.
    local merged
    merged=$(jq -c --argjson d "$dur" --argjson e "$extra" -n '$e + {duration_ms:$d}' 2>/dev/null || echo "{\"duration_ms\":$dur}")
    perf::emit "$event" "$merged"
}

# Resolve the slot belonging to an agent. Echoes slot number or empty.
state::slot_for_agent() {
    local agent="$1"
    state::query "$RL_CLAIMS_FILE" --arg a "$agent" \
        '[.[] | select(.agent_id == $a and .claimed == true) | .slot] | first // empty'
}

# ROK-1331 M4 — resolve the branch persisted alongside this agent's claim.
# Mirrors state::slot_for_agent. Echoes branch label or empty when no claim
# exists. Used by `claim`'s idempotent path to preserve the original branch
# label when the caller didn't pass --branch (or passed the literal "unknown").
state::branch_for_agent() {
    local agent="$1"
    state::query "$RL_CLAIMS_FILE" -r --arg a "$agent" \
        '[.[] | select(.agent_id == $a and .claimed == true) | .branch] | first // empty'
}

state::init
