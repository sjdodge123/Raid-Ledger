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

STATE_DIR="${STATE_DIR:-/state}"
CLAIMS="${STATE_DIR}/claims.json"
ENVS="${STATE_DIR}/env-registry.json"
QUEUE="${STATE_DIR}/queue.json"
AUDIT="${STATE_DIR}/audit.log"
LOCK_DIR="${STATE_DIR}/locks"
QUEUE_TTL_SECONDS="${QUEUE_TTL_SECONDS:-1800}"   # 30 min — stale waiters
MAX_CLAIM_AGE_SECONDS="${MAX_CLAIM_AGE_SECONDS:-28800}"   # 8 hr — slot hoarding
mkdir -p "$LOCK_DIR"
NOW_EPOCH=$(date -u +%s)
NOW_ISO=$(date -u +%FT%TZ)

log() { echo "[$(date -u +%FT%TZ)] sweep: $*"; }

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
    tmp=$(mktemp)
    (
        flock -x 200
        jq "$@" "$file" > "$tmp"
        mv "$tmp" "$file"
    ) 200>"$LOCK_DIR/$(basename "$file").lock"
}

# 1. Dead claims (heartbeat older than timeout).
DEAD_SLOTS=$(jq -r --argjson cutoff "$NOW_EPOCH" --argjson tol "$CLAIM_HEARTBEAT_TIMEOUT_SECONDS" \
    '.[] | select(.claimed == true and .last_heartbeat != null
        and ((($cutoff - ($tol|tonumber)) | tostring) > (.last_heartbeat | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring)
    ) | .slot' "$CLAIMS" 2>/dev/null || true)

for slot in $DEAD_SLOTS; do
    log "releasing dead slot $slot (heartbeat expired)"
    # Inline release: destroy envs labeled with this slot, clear claim record.
    docker ps -aq --filter "label=rl.slot=$slot" --filter "label=rl.role=env" \
        --format '{{ index .Labels "rl.env_slug" }} {{.ID}}' 2>/dev/null \
      | while read -r slug cid; do
            [[ -z "$slug" ]] && continue
            log "  destroying env $slug (orphaned by dead claim)"
            docker rm -f "$cid" >/dev/null 2>&1 || true
            docker rm -f "rl-env-${slug}-pg" >/dev/null 2>&1 || true
            docker volume rm "rl-data-${slug}" >/dev/null 2>&1 || true
        done
    mutate "$CLAIMS" --argjson s "$slot" \
        '(.[] | select(.slot == $s)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null)'
    audit dead_claim_released "$(jq -nc --argjson slot "$slot" '{slot:$slot}')"
done

# 1b'. Hoarded-slot reaper. Claims older than MAX_CLAIM_AGE_SECONDS get
# released regardless of heartbeat — stops a "stuck-alive" agent from
# holding a slot indefinitely. Operator can opt out per-claim with the
# `--keep-alive` flag (sets claims[].keep_alive=true).
HOARDED_SLOTS=$(jq -r --argjson cutoff "$NOW_EPOCH" --argjson tol "$MAX_CLAIM_AGE_SECONDS" \
    '.[] | select(.claimed == true and (.keep_alive // false) == false and .started_at != null
        and ((($cutoff - ($tol|tonumber)) | tostring) > (.started_at | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring)
    ) | .slot' "$CLAIMS" 2>/dev/null || true)
for slot in $HOARDED_SLOTS; do
    log "releasing hoarded slot $slot (claim age > ${MAX_CLAIM_AGE_SECONDS}s, keep_alive=false)"
    docker ps -aq --filter "label=rl.slot=$slot" --filter "label=rl.role=env" \
        --format '{{ index .Labels "rl.env_slug" }} {{.ID}}' 2>/dev/null \
      | while read -r slug cid; do
            [[ -z "$slug" ]] && continue
            docker rm -f "$cid" >/dev/null 2>&1 || true
            docker rm -f "rl-env-${slug}-pg" >/dev/null 2>&1 || true
            docker volume rm "rl-data-${slug}" >/dev/null 2>&1 || true
            rm -f "/traefik-conf.d/env-${slug}.yml" 2>/dev/null || true
        done
    mutate "$CLAIMS" --argjson s "$slot" \
        '(.[] | select(.slot == $s)) |= (.claimed=false | .agent_id=null | .branch=null | .started_at=null | .last_heartbeat=null | .keep_alive=false)'
    audit hoarded_slot_released "$(jq -nc --argjson slot "$slot" '{slot:$slot}')"
done

# 1c. Stale queue entries. Waiters older than QUEUE_TTL_SECONDS get dropped
# so dead callers don't block the queue head.
STALE_WAITERS=$(jq -r --argjson cutoff "$NOW_EPOCH" --argjson tol "$QUEUE_TTL_SECONDS" \
    '.[] | select(.queued_at != null
        and ((($cutoff - ($tol|tonumber)) | tostring) > (.queued_at | sub("Z$";"") | sub("\\.[0-9]+$";"") | strptime("%Y-%m-%dT%H:%M:%S") | mktime | tostring)
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
        audit orphan_env_pruned "$(jq -nc --arg slug "$slug" '{slug:$slug, reason:"container_missing"}')"
        continue
    fi
    HEALTH=$(docker inspect "$APP" --format '{{.State.Health.Status}}' 2>/dev/null || echo "none")
    if [[ "$HEALTH" == "unhealthy" ]]; then
        # Give the env a 5-minute grace from spin time before reaping for unhealth.
        STARTED=$(docker inspect "$APP" --format '{{.State.StartedAt}}' 2>/dev/null || echo "")
        STARTED_EPOCH=$(date -u -d "$STARTED" +%s 2>/dev/null || echo "$NOW_EPOCH")
        UPTIME=$(( NOW_EPOCH - STARTED_EPOCH ))
        if (( UPTIME >= 300 )); then
            log "destroying unhealthy env $slug (allinone has been unhealthy for ${UPTIME}s)"
            docker rm -f "$APP" "rl-env-${slug}-pg" >/dev/null 2>&1 || true
            docker volume rm "rl-data-${slug}" >/dev/null 2>&1 || true
            rm -f "/traefik-conf.d/env-${slug}.yml" 2>/dev/null || true
            mutate "$ENVS" --arg slug "$slug" 'map(select(.slug != $slug))'
            audit unhealthy_env_pruned "$(jq -nc --arg slug "$slug" --argjson uptime "$UPTIME" '{slug:$slug, uptime_s:$uptime, reason:"unhealthy"}')"
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
        audit env_expired "$(jq -nc --arg slug "$SLUG" --argjson age "$AGE_HOURS" --argjson ttl "$TTL_HOURS" '{slug:$slug, age_hours:$age, ttl_hours:$ttl}')"
    fi
done

# 3. Scoped prune.
docker image prune -f --filter "label=rl.role=env" >/dev/null 2>&1 || true
docker volume prune -f --filter "label=rl.role=env" >/dev/null 2>&1 || true
docker container prune -f --filter "label=rl.role=env" >/dev/null 2>&1 || true

# 4. Summary.
FREE=$(jq '[.[] | select(.claimed == false)] | length' "$CLAIMS")
BUSY=$(jq '[.[] | select(.claimed == true)] | length' "$CLAIMS")
ENV_COUNT=$(docker ps -aq --filter "label=rl.role=env" | wc -l | tr -d ' ')
audit summary "$(jq -nc --argjson free "$FREE" --argjson busy "$BUSY" --argjson envs "$ENV_COUNT" '{slots_free:$free, slots_busy:$busy, envs:$envs}')"
log "summary: $FREE free / $BUSY busy / $ENV_COUNT envs"
