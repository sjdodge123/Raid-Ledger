#!/usr/bin/env bash
# Periodic sweeper. Runs every $SWEEP_INTERVAL_SECONDS inside the rl-gc-sweeper
# container. Mounts /state from the host so it reads the canonical claims +
# env-registry files.
#
# Responsibilities:
#   1. Release slots whose last_heartbeat is older than $CLAIM_HEARTBEAT_TIMEOUT_SECONDS.
#   2. Destroy envs whose age exceeds their declared TTL.
#   3. Destroy orphaned env containers (no matching claim).
#   4. Prune dangling images/volumes scoped to rl.role=* labels.
#   5. Append summary to audit log.
set -euo pipefail

# ROK-1331 M1: accept RL_STATE_DIR as a fallback so callers using the
# orchestrator's canonical var name (test_helpers.sh, mcp-env tools) work
# without re-exporting under the legacy STATE_DIR name.
STATE_DIR="${STATE_DIR:-${RL_STATE_DIR:-/state}}"
CLAIMS="${STATE_DIR}/claims.json"
ENVS="${STATE_DIR}/env-registry.json"
QUEUE="${STATE_DIR}/queue.json"
AUDIT="${STATE_DIR}/audit.log"
# ROK-1331 M11 — sibling perf log. Per-cycle structured stats land here so
# dashboards can show "GC sweep took 280ms last cycle, reaped K envs".
PERF_LOG="${PERF_LOG:-${STATE_DIR}/perf.log}"
LOCK_DIR="${STATE_DIR}/locks"
QUEUE_TTL_SECONDS="${QUEUE_TTL_SECONDS:-1800}"   # 30 min — stale waiters
MAX_CLAIM_AGE_SECONDS="${MAX_CLAIM_AGE_SECONDS:-28800}"   # 8 hr — slot hoarding
# ROK-1331 M1: default so the task-retention block (added below) can be
# exercised by tests that don't supply the Dockerfile-provided env vars.
CLAIM_HEARTBEAT_TIMEOUT_SECONDS="${CLAIM_HEARTBEAT_TIMEOUT_SECONDS:-300}"
mkdir -p "$LOCK_DIR"
NOW_EPOCH=$(date -u +%s)
NOW_ISO=$(date -u +%FT%TZ)

# ROK-1331 M11 — cycle-level counters. Bumped by the reap branches below
# and consumed by the gc.sweep.cycle perf emit at the end. Wallclock
# timing uses python3 (portable across macOS bash 3.2 + Linux bash 5).
# Emitted via EXIT trap so a partial cycle (docker daemon down, jq error,
# anything that trips set -e) still surfaces "we ran" with the work done
# up to the failure point — operators see the cycle terminated rather
# than the sweeper silently going dark.
CYCLE_START_MS=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || echo "$((NOW_EPOCH * 1000))")
CYCLE_CLAIMS_SWEPT=0
CYCLE_ENVS_REAPED=0
CYCLE_TESTCONTAINERS_REAPED=0

_emit_cycle_perf() {
    local end_ms dur ts
    end_ms=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || echo "$(( $(date -u +%s) * 1000 ))")
    dur=$(( end_ms - CYCLE_START_MS ))
    (( dur < 0 )) && dur=0
    ts=$(python3 -c "import datetime; print(datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.') + ('%03d' % (datetime.datetime.utcnow().microsecond // 1000)) + 'Z')" 2>/dev/null \
        || date -u +%FT%TZ)
    jq -nc \
        --arg ts "$ts" \
        --argjson dur "$dur" \
        --argjson cs "$CYCLE_CLAIMS_SWEPT" \
        --argjson er "$CYCLE_ENVS_REAPED" \
        --argjson tr "$CYCLE_TESTCONTAINERS_REAPED" \
        '{ts:$ts, event:"gc.sweep.cycle", source:"orchestrator", agent_id:"sweeper", branch:"unknown", duration_ms:$dur, claims_swept:$cs, envs_reaped:$er, testcontainers_reaped:$tr}' \
        >> "$PERF_LOG" 2>/dev/null || true
}
trap _emit_cycle_perf EXIT

log() { echo "[$(date -u +%FT%TZ)] sweep: $*"; }

# ROK-1331 M5a — flock shim mirror (matches _state.sh). flock(1) lives in
# util-linux on the VM, but macOS test runners don't ship it. Without this
# shim, the mutate() function below silently no-ops on macOS because flock
# fails before jq can write the tmpfile. The shim lets the local test
# harness exercise the reaper without flock; the VM keeps its real serializer.
if ! command -v flock >/dev/null 2>&1; then
    flock() { return 0; }
fi

# ROK-1331 M5a — portable ISO 8601 → epoch parser. GNU `date -d` is Linux-only;
# macOS test runners (and any non-coreutils environment) fall back to python.
iso_to_epoch() {
    local iso="$1"
    [[ -z "$iso" ]] && { echo 0; return; }
    date -u -d "$iso" +%s 2>/dev/null \
        || python3 -W ignore -c "import datetime,sys; print(int(datetime.datetime.fromisoformat('$iso'.replace('Z','+00:00')).timestamp()))" 2>/dev/null \
        || echo 0
}

# When the sweeper reaps an env (orphan, unhealthy, TTL, or dead-claim
# cascade), also drop the env's test plan file. Without this, a tester
# returning to fleet.gamernight.net would see a plan tied to a slug
# that no longer maps to a running env — confusing + the deep links
# would 502. Mirrors the cleanup env-destroy does for explicit teardowns.
TEST_PLANS_DIR="${TEST_PLANS_DIR:-/state/test-plans}"
TEST_PLAN_ATTACHMENTS_DIR="${TEST_PLAN_ATTACHMENTS_DIR:-/state/test-plan-attachments}"
# Test plan auto-cleanup is DISABLED on reaper paths too (operator pref
# 2026-05-19). When an env is destroyed by the sweeper, its plan + any
# screenshot attachments are preserved for review. Operators clear
# explicitly via rl_test_plan_clear when ready. The clean_test_plan
# function stays as a no-op so callers in this script don't need touching.
clean_test_plan() {
    local _slug="$1"
    return 0
}

audit() {
    local outcome="$1"
    # Don't use ${2:-{}} — bash parses the first `}` as end of expansion,
    # leaving the second as literal text. Default + assign in two steps.
    local extra="${2-}"
    [[ -z "$extra" ]] && extra='{}'
    jq -nc --arg ts "$NOW_ISO" --arg cmd "gc-sweep" --arg outcome "$outcome" \
        --argjson extra "$extra" \
        '{ts:$ts, cmd:$cmd, outcome:$outcome, agent:"sweeper"} + $extra' >> "$AUDIT"
}

mutate() {
    local file="$1"; shift
    local tmp
    # tmpfile in the SAME directory as the target so:
    #   1. mv is a same-fs rename (atomic + preserves the dir's setgid bit
    #      so the new file inherits the rl-fleet group)
    #   2. we don't cross from /tmp (root-owned, mode 600) to /state
    #      (which would copy+unlink and leave the target as root:root 0600,
    #      blocking the dashboard reader). Same fix already in _state.sh.
    tmp=$(mktemp "${file}.XXXXXX")
    (
        flock -x 200
        jq "$@" "$file" > "$tmp"
        mv "$tmp" "$file"
        chmod 664 "$file" 2>/dev/null || true
    ) 200>"$LOCK_DIR/$(basename "$file").lock"
}

# 0. ROK-1331 M1 — task retention. Drop task JSON + log pairs for completed
# tasks older than TASK_RETENTION_SECONDS (default 86400 = 24h). Running tasks
# are preserved unconditionally — the sweeper never kills tasks. Orphan
# recovery: if a running task's pid is no longer alive (host reboot, OOM),
# flip to failed with cancel_reason "orphaned" so the next sweeper pass ages
# it out normally.
#
# Runs BEFORE the docker-dependent sections so it works even when the docker
# socket is unreachable (e.g. local test runs on the operator's Mac).
TASK_RETENTION_SECONDS="${TASK_RETENTION_SECONDS:-86400}"
TASKS_DIR="${TASKS_DIR:-/state/tasks}"
if [[ -d "$TASKS_DIR" ]]; then
    for tjson in "$TASKS_DIR"/*.json; do
        [[ -f "$tjson" ]] || continue
        STATUS=$(jq -r '.status // "unknown"' "$tjson" 2>/dev/null || echo "unknown")
        if [[ "$STATUS" == "running" ]]; then
            PID=$(jq -r '.pid // empty' "$tjson" 2>/dev/null)
            if [[ -n "$PID" ]] && ! kill -0 "$PID" 2>/dev/null; then
                ORPHAN_FINISHED=$(date -u +%FT%TZ)
                tmp=$(mktemp "${tjson}.XXXXXX")
                jq --arg f "$ORPHAN_FINISHED" \
                    '.status = "failed" | .cancel_reason = "orphaned" | (if .finished_at == null then .finished_at = $f else . end)' \
                    "$tjson" > "$tmp" && mv "$tmp" "$tjson" || rm -f "$tmp"
                ORPHAN_TID=$(jq -r '.task_id // "unknown"' "$tjson" 2>/dev/null)
                audit task_orphaned "$(jq -nc --arg t "$ORPHAN_TID" '{task_id:$t}')"
            fi
            continue
        fi
        FINISHED=$(jq -r '.finished_at // empty' "$tjson" 2>/dev/null)
        [[ -z "$FINISHED" ]] && continue
        FINISHED_EPOCH=$(date -u -d "$FINISHED" +%s 2>/dev/null || \
            date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$FINISHED" +%s 2>/dev/null || echo 0)
        AGE=$(( NOW_EPOCH - FINISHED_EPOCH ))
        if (( AGE >= TASK_RETENTION_SECONDS )); then
            TID=$(jq -r '.task_id' "$tjson" 2>/dev/null || echo "")
            rm -f "$tjson" "$TASKS_DIR/${TID}.log"
            audit task_pruned "$(jq -nc --arg tid "$TID" --argjson age "$AGE" '{task_id:$tid, age_s:$age}')"
        fi
    done
fi

# ROK-1331 M5a — helper: call orchestrator's lease-advance for a slot after
# the sweeper frees it. Best-effort; never fatal. Resolves the binary path
# relative to the sweeper container's mounted /orchestrator dir (set up by
# docker-compose.yml) OR via $ORCHESTRATOR_BIN_DIR override for tests.
ORCHESTRATOR_BIN_DIR="${ORCHESTRATOR_BIN_DIR:-/orchestrator/bin}"
sweeper_lease_advance() {
    local slot="$1"
    local advance_bin="${ORCHESTRATOR_BIN_DIR}/lease-advance"
    [[ -x "$advance_bin" ]] || return 0
    RL_STATE_DIR="$STATE_DIR" "$advance_bin" --slot "$slot" >/dev/null 2>&1 || true
}

# 1. Dead claims (heartbeat older than timeout).
# ROK-1331 M5a — fix pre-existing missing-close-paren in the M1 jq (the
# `((($cutoff - ($tol|tonumber)) | tostring) > (.last_heartbeat | ... | tostring)`
# expression needs ONE more `)` before the `| .slot` outdent so the
# `and (...)` wrapping closes properly. Without it jq emits a compile error
# that the `2>/dev/null || true` guard silently swallows — the dead-claim
# reaper has been a no-op since M1 landed.
DEAD_SLOTS=$(jq -r --argjson cutoff "$NOW_EPOCH" --argjson tol "$CLAIM_HEARTBEAT_TIMEOUT_SECONDS" \
    '.[] | select(.claimed == true and .last_heartbeat != null
        and ((($cutoff - ($tol|tonumber)) | tostring) > (.last_heartbeat | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring))
    ) | .slot' "$CLAIMS" 2>/dev/null || true)

for slot in $DEAD_SLOTS; do
    log "releasing dead slot $slot (heartbeat expired)"
    # Inline release: destroy envs labeled with this slot, clear claim record.
    docker ps -aq --filter "label=rl.slot=$slot" --filter "label=rl.role=env" \
        --format '{{ .Label "rl.env_slug" }} {{.ID}}' 2>/dev/null \
      | while read -r slug cid; do
            [[ -z "$slug" ]] && continue
            log "  destroying env $slug (orphaned by dead claim)"
            docker rm -f "$cid" >/dev/null 2>&1 || true
            docker rm -f "rl-env-${slug}-pg" >/dev/null 2>&1 || true
            docker volume rm "rl-data-${slug}" >/dev/null 2>&1 || true
            clean_test_plan "$slug"
        done
    mutate "$CLAIMS" --argjson s "$slot" \
        '(.[] | select(.slot == $s)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null | .expires_at=null | .extends_count=0)'
    audit dead_claim_released "$(jq -nc --argjson slot "$slot" '{slot:$slot}')"
    CYCLE_CLAIMS_SWEPT=$((CYCLE_CLAIMS_SWEPT + 1))
    # ROK-1331 M5a — promote any queued waiter immediately so dead claims
    # don't strand the queue.
    sweeper_lease_advance "$slot"
done

# 1b'. Hoarded-slot reaper. Claims older than MAX_CLAIM_AGE_SECONDS get
# released regardless of heartbeat — stops a "stuck-alive" agent from
# holding a slot indefinitely. Operator can opt out per-claim with the
# `--keep-alive` flag (sets claims[].keep_alive=true).
#
# ROK-1331 M5a (STRICT, architect 2026-05-20) — the legacy reaper now ONLY
# fires when `expires_at IS NULL`. New M5a claims always populate
# expires_at; their lifecycle is driven by the claim-expiry reaper (1d
# below). Legacy rows from before M5a (or rows manually wiped) keep the
# 8h fallback. Without this gate, M5a claims older than 8h would be
# reaped despite still being within their 24h lease.
HOARDED_SLOTS=$(jq -r --argjson cutoff "$NOW_EPOCH" --argjson tol "$MAX_CLAIM_AGE_SECONDS" \
    '.[] | select(.claimed == true and (.keep_alive // false) == false and .started_at != null
        and (.expires_at == null)
        and ((($cutoff - ($tol|tonumber)) | tostring) > (.started_at | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring))
    ) | .slot' "$CLAIMS" 2>/dev/null || true)
for slot in $HOARDED_SLOTS; do
    log "releasing hoarded slot $slot (claim age > ${MAX_CLAIM_AGE_SECONDS}s, keep_alive=false, expires_at=null)"
    docker ps -aq --filter "label=rl.slot=$slot" --filter "label=rl.role=env" \
        --format '{{ .Label "rl.env_slug" }} {{.ID}}' 2>/dev/null \
      | while read -r slug cid; do
            [[ -z "$slug" ]] && continue
            docker rm -f "$cid" >/dev/null 2>&1 || true
            docker rm -f "rl-env-${slug}-pg" >/dev/null 2>&1 || true
            docker volume rm "rl-data-${slug}" >/dev/null 2>&1 || true
            rm -f "/traefik-conf.d/env-${slug}.yml" 2>/dev/null || true
            clean_test_plan "$slug"
        done
    mutate "$CLAIMS" --argjson s "$slot" \
        '(.[] | select(.slot == $s)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null | .keep_alive=false | .expires_at=null | .extends_count=0)'
    audit hoarded_slot_released "$(jq -nc --argjson slot "$slot" '{slot:$slot}')"
    CYCLE_CLAIMS_SWEPT=$((CYCLE_CLAIMS_SWEPT + 1))
    sweeper_lease_advance "$slot"
done

# 1d. ROK-1331 M5a — Claim-expiry reaper. Claims past `expires_at` get
# released ONLY when there's a queued waiter for the slot (operator
# quote: "leave up until an agent is queued"). When the queue is empty
# AND the claim is past expiry, leave the env up + slot "claimed but
# idle" — the next claim will inherit/destroy via lease-advance when
# someone arrives.
LEASE_QUEUE_DIR="${LEASE_QUEUE_DIR:-${STATE_DIR}/lease-queue}"
EXPIRED_SLOTS=$(jq -r --argjson now "$NOW_EPOCH" \
    '.[] | select(.claimed == true and .expires_at != null
        and (($now | tostring) > (.expires_at | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring))
    ) | .slot' "$CLAIMS" 2>/dev/null || true)
for slot in $EXPIRED_SLOTS; do
    QFILE="${LEASE_QUEUE_DIR}/${slot}.json"
    QLEN=0
    if [[ -f "$QFILE" ]]; then
        QLEN=$(jq 'length' "$QFILE" 2>/dev/null || echo 0)
    fi
    if (( QLEN == 0 )); then
        # No queued waiter — defer; operator quote "leave up until queued".
        continue
    fi
    log "releasing expired slot $slot (past expires_at, queue depth=$QLEN)"
    # Preserve envs so the queue head can inherit them on branch-match.
    SLOT_BRANCH=$(jq -r --argjson s "$slot" '.[] | select(.slot == $s) | .branch // ""' "$CLAIMS" 2>/dev/null || echo "")
    if [[ -n "$SLOT_BRANCH" ]]; then
        mutate "$ENVS" --argjson s "$slot" --arg b "$SLOT_BRANCH" \
            'map(if .slot == $s then .claimable_by_next = true | .created_for_branch = $b else . end)'
    fi
    mutate "$CLAIMS" --argjson s "$slot" \
        '(.[] | select(.slot == $s)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null | .expires_at=null | .extends_count=0)'
    audit claim_expired_released "$(jq -nc --argjson slot "$slot" --argjson q "$QLEN" '{slot:$slot, queue_depth:$q}')"
    CYCLE_CLAIMS_SWEPT=$((CYCLE_CLAIMS_SWEPT + 1))
    sweeper_lease_advance "$slot"
done

# 1e. ROK-1331 M5a — Stale lease-queue heads. Drop entries whose
# last_heartbeat is older than LEASE_HEAD_TIMEOUT_SECONDS so dead waiters
# don't block the queue front indefinitely.
LEASE_HEAD_TIMEOUT_SECONDS="${LEASE_HEAD_TIMEOUT_SECONDS:-300}"
if [[ -d "$LEASE_QUEUE_DIR" ]]; then
    for qfile in "$LEASE_QUEUE_DIR"/*.json; do
        [[ -f "$qfile" ]] || continue
        STALE_AGENTS=$(jq -r --argjson now "$NOW_EPOCH" --argjson tol "$LEASE_HEAD_TIMEOUT_SECONDS" \
            '.[] | select(.last_heartbeat != null
                and ((($now - ($tol|tonumber)) | tostring) > (.last_heartbeat | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring))
            ) | .agent_id' "$qfile" 2>/dev/null || true)
        for sa in $STALE_AGENTS; do
            [[ -z "$sa" ]] && continue
            mutate "$qfile" --arg a "$sa" 'map(select(.agent_id != $a))'
            audit lease_head_evicted "$(jq -nc --arg agent "$sa" --arg file "$qfile" '{agent:$agent, queue_file:$file, reason:"stale_heartbeat"}')"
        done
    done
fi

# 1c. Stale queue entries. Waiters older than QUEUE_TTL_SECONDS get dropped
# so dead callers don't block the queue head.
STALE_WAITERS=$(jq -r --argjson cutoff "$NOW_EPOCH" --argjson tol "$QUEUE_TTL_SECONDS" \
    '.[] | select(.queued_at != null
        and ((($cutoff - ($tol|tonumber)) | tostring) > (.queued_at | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring))
    ) | .agent_id' "$QUEUE" 2>/dev/null || true)
for waiter in $STALE_WAITERS; do
    log "dropping stale queue entry: $waiter"
    mutate "$QUEUE" --arg a "$waiter" 'map(select(.agent_id != $a))'
    audit queue_waiter_expired "$(jq -nc --arg agent "$waiter" '{agent:$agent}')"
done

# 1b. Orphan / unhealthy envs. Two failure modes the sweeper catches:
#   (a) env-registry.json has a slug whose containers don't exist (env-destroy
#       crashed mid-way, or container was killed externally).
#   (b) Allinone container exists but Docker marks it 'unhealthy' (nginx
#       crashed inside, app boot failed, etc.) for >5 minutes — auto-destroy
#       so the dashboard doesn't show a dead URL as "live".
ENVS_REGISTERED=$(jq -r '.[] | .slug' "$ENVS" 2>/dev/null || true)
for slug in $ENVS_REGISTERED; do
    [[ -z "$slug" ]] && continue
    APP="rl-env-${slug}-allinone"
    if ! docker inspect "$APP" >/dev/null 2>&1; then
        log "destroying orphan env $slug (registry entry exists but $APP container is gone)"
        docker rm -f "rl-env-${slug}-pg" >/dev/null 2>&1 || true
        docker volume rm "rl-data-${slug}" >/dev/null 2>&1 || true
        rm -f "/traefik-conf.d/env-${slug}.yml" 2>/dev/null || true
        mutate "$ENVS" --arg slug "$slug" 'map(select(.slug != $slug))'
        clean_test_plan "$slug"
        audit orphan_env_pruned "$(jq -nc --arg slug "$slug" '{slug:$slug, reason:"container_missing"}')"
        CYCLE_ENVS_REAPED=$((CYCLE_ENVS_REAPED + 1))
        continue
    fi
    HEALTH=$(docker inspect "$APP" --format '{{.State.Health.Status}}' 2>/dev/null || echo "none")
    if [[ "$HEALTH" == "unhealthy" ]]; then
        # Grace from spin time before reaping for unhealth. Bumped from
        # 5min → 15min (2026-05-19): allinones with cold DB + migrations
        # + first-load workers legitimately take >5min to come fully
        # healthy on the smaller VM. Anything longer than 15min is
        # almost certainly an app-level crash worth tearing down so the
        # operator notices.
        STARTED=$(docker inspect "$APP" --format '{{.State.StartedAt}}' 2>/dev/null || echo "")
        STARTED_EPOCH=$(iso_to_epoch "$STARTED")
        [[ "$STARTED_EPOCH" == "0" ]] && STARTED_EPOCH="$NOW_EPOCH"
        UPTIME=$(( NOW_EPOCH - STARTED_EPOCH ))
        if (( UPTIME >= 900 )); then
            # ROK-1331 M5a — pin / active-claim guards. Pinned envs are
            # protected from the unhealthy reaper until the 24h-idle ceiling
            # hits (operator can still unpin to force-reap sooner). Envs
            # whose owning slot has a fresh heartbeat (<5min) are also
            # skipped — the slot is in active use; an intermittent
            # health-check blip shouldn't yank it.
            ENV_PINNED=$(jq -r --arg slug "$slug" '.[] | select(.slug == $slug) | .pinned // false' "$ENVS" 2>/dev/null || echo "false")
            ENV_SLOT=$(jq -r --arg slug "$slug" '.[] | select(.slug == $slug) | .slot // empty' "$ENVS" 2>/dev/null || echo "")
            LAST_TOUCHED=$(jq -r --arg slug "$slug" '.[] | select(.slug == $slug) | .last_touched // ""' "$ENVS" 2>/dev/null || echo "")
            IDLE_SECONDS=0
            if [[ -n "$LAST_TOUCHED" ]]; then
                LT_EPOCH=$(iso_to_epoch "$LAST_TOUCHED")
                [[ "$LT_EPOCH" == "0" ]] && LT_EPOCH="$NOW_EPOCH"
                IDLE_SECONDS=$(( NOW_EPOCH - LT_EPOCH ))
            fi
            if [[ "$ENV_PINNED" == "true" ]] && (( IDLE_SECONDS < 86400 )); then
                audit pinned_env_skipped "$(jq -nc --arg slug "$slug" --argjson uptime "$UPTIME" --argjson idle "$IDLE_SECONDS" '{slug:$slug, uptime_s:$uptime, idle_s:$idle, reason:"pinned"}')"
                continue
            fi
            # Active-claim heartbeat guard: skip when the slot's claim has a
            # heartbeat within the last 5 minutes.
            if [[ -n "$ENV_SLOT" ]]; then
                CLAIM_HB=$(jq -r --argjson s "$ENV_SLOT" '.[] | select(.slot == $s and .claimed == true) | .last_heartbeat // ""' "$CLAIMS" 2>/dev/null || echo "")
                if [[ -n "$CLAIM_HB" ]]; then
                    HB_EPOCH=$(iso_to_epoch "$CLAIM_HB")
                    HB_AGE=$(( NOW_EPOCH - HB_EPOCH ))
                    if (( HB_AGE < 300 )); then
                        audit unhealthy_env_skipped_active_claim "$(jq -nc --arg slug "$slug" --argjson slot "$ENV_SLOT" --argjson hb_age "$HB_AGE" '{slug:$slug, slot:$slot, hb_age_s:$hb_age}')"
                        continue
                    fi
                fi
            fi
            log "destroying unhealthy env $slug (allinone has been unhealthy for ${UPTIME}s)"
            docker rm -f "$APP" "rl-env-${slug}-pg" >/dev/null 2>&1 || true
            docker volume rm "rl-data-${slug}" >/dev/null 2>&1 || true
            rm -f "/traefik-conf.d/env-${slug}.yml" 2>/dev/null || true
            mutate "$ENVS" --arg slug "$slug" 'map(select(.slug != $slug))'
            clean_test_plan "$slug"
            audit unhealthy_env_pruned "$(jq -nc --arg slug "$slug" --argjson uptime "$UPTIME" '{slug:$slug, uptime_s:$uptime, reason:"unhealthy"}')"
            CYCLE_ENVS_REAPED=$((CYCLE_ENVS_REAPED + 1))
        fi
    fi
done

# 2. TTL-expired envs.
docker ps -a --filter "label=rl.role=env" --format '{{.ID}}' | while read -r cid; do
    [[ -z "$cid" ]] && continue
    LABELS=$(docker inspect "$cid" --format '{{json .Config.Labels}}' 2>/dev/null || echo '{}')
    SLUG=$(jq -r '."rl.env_slug" // empty' <<<"$LABELS")
    TTL_RAW=$(jq -r '."rl.ttl" // empty' <<<"$LABELS")
    LAST_TOUCHED=$(jq -r '."rl.last_touched" // empty' <<<"$LABELS")
    [[ -z "$SLUG" || -z "$TTL_RAW" || -z "$LAST_TOUCHED" ]] && continue
    TTL_HOURS=$(sed 's/h$//' <<<"$TTL_RAW")
    LAST_EPOCH=$(date -u -d "$LAST_TOUCHED" +%s 2>/dev/null || echo 0)
    AGE_HOURS=$(( (NOW_EPOCH - LAST_EPOCH) / 3600 ))
    if (( AGE_HOURS >= TTL_HOURS )); then
        log "destroying expired env $SLUG (age ${AGE_HOURS}h >= ttl ${TTL_HOURS}h)"
        docker rm -f "rl-env-${SLUG}-allinone" "rl-env-${SLUG}-pg" >/dev/null 2>&1 || true
        docker volume rm "rl-data-${SLUG}" >/dev/null 2>&1 || true
        mutate "$ENVS" --arg slug "$SLUG" 'map(select(.slug != $slug))'
        clean_test_plan "$SLUG"
        audit env_expired "$(jq -nc --arg slug "$SLUG" --argjson age "$AGE_HOURS" --argjson ttl "$TTL_HOURS" '{slug:$slug, age_hours:$age, ttl_hours:$ttl}')"
        CYCLE_ENVS_REAPED=$((CYCLE_ENVS_REAPED + 1))
    fi
done

# 3. Scoped prune.
docker image prune -f --filter "label=rl.role=env" >/dev/null 2>&1 || true
docker volume prune -f --filter "label=rl.role=env" >/dev/null 2>&1 || true
docker container prune -f --filter "label=rl.role=env" >/dev/null 2>&1 || true

# 3a. ROK-1331 M8 — testcontainers orphan reap (fleet-wide).
# release fires the reaper per-slot at handoff; this is the safety net for
# anything that slipped through (jest killed by OOM after release already
# ran, ryuk-session desync surfaced post-release, etc.). Best-effort —
# silenced because the operator's Mac runs the sweeper-test without docker
# available, and we don't want the noise. The reaper itself exits 0 on
# zero-reap or docker unreachable.
REAP_BIN="${ORCHESTRATOR_BIN_DIR}/runner-testcontainers-reap"
if [[ -x "$REAP_BIN" ]]; then
    RL_STATE_DIR="$STATE_DIR" "$REAP_BIN" all >/dev/null 2>&1 || true
fi

# 3b. ROK-1331 M1 — task retention block moved to a self-contained function
# below + invoked at the top (before docker ops) so it runs even when docker
# is unavailable (test runners on the operator's Mac). See `prune_old_tasks`
# above the section-1 block.

# 4. Summary.
FREE=$(jq '[.[] | select(.claimed == false)] | length' "$CLAIMS")
BUSY=$(jq '[.[] | select(.claimed == true)] | length' "$CLAIMS")
ENV_COUNT=$(docker ps -aq --filter "label=rl.role=env" 2>/dev/null | wc -l | tr -d ' ' || echo 0)
audit summary "$(jq -nc --argjson free "$FREE" --argjson busy "$BUSY" --argjson envs "$ENV_COUNT" '{slots_free:$free, slots_busy:$busy, envs:$envs}')"
log "summary: $FREE free / $BUSY busy / $ENV_COUNT envs"

# gc.sweep.cycle perf emit fires from the EXIT trap registered at the top
# of the script — fires on success AND on partial-cycle failure paths.
