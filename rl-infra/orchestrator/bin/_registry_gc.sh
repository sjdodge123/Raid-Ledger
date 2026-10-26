#!/usr/bin/env bash
# 2026-10-26 — fleet registry garbage collection (TECH-DEBT 2026-10-24).
#
# Why: rl-registry was never garbage-collected. Every env build pushes a
# ~1.5 GB `rl-allinone:<slug>` tag and nothing deleted one; 424 tags reached
# 134 GB and image builds (which need RL_BUILD_MIN_FREE_GB free) parked on
# waiting_disk until they failed disk_pressure. The operator cleared it by hand.
#
# SOURCEABLE library (no side effects on source), used by:
#   - orchestrator/bin/env-destroy  → registry_gc::delete_env_tag <slug>
#   - gc-sweeper/sweep.sh           → registry_gc::sweep [force]
#
# Tag deletion is a manifest DELETE by digest through the registry HTTP API
# (rl-registry runs with REGISTRY_STORAGE_DELETE_ENABLED=true). That frees no
# disk by itself: blobs go only when `registry garbage-collect` runs inside
# the registry container. The distribution docs want the registry read-only
# for that, because a push racing the mark phase can lose blobs. We cannot
# flip it read-only without a restart, so GC runs only when NO image build is
# admitted (admission.json heavy_running kind=image_build) — builds are the
# only pushers. Residual risk: a build admitted during the GC window itself
# (seconds) could push a layer GC sweeps; that build's env then fails
# image_not_found and a rebuild fixes it. Single-arch v2 manifests only —
# --delete-untagged is unsafe for multi-arch indexes (distribution#3178).
#
# Env knobs:
#   RL_REGISTRY_URL               http://127.0.0.1:5000  (sweeper: rl-registry:5000)
#   RL_REGISTRY_REPO              rl-allinone
#   RL_REGISTRY_CONTAINER         rl-registry
#   RL_REGISTRY_RETENTION_HOURS   48   only tags older than this are deleted
#   RL_REGISTRY_KEEP_N            5    always keep the newest N tags
#   RL_REGISTRY_GC_INTERVAL_HOURS 6    sweeper cadence (forced under disk pressure)
#   RL_REGISTRY_GC_STATE_FILE     $STATE_DIR/registry-gc.json
#   RL_REGISTRY_GC_DRY_RUN        0    1 = report, delete nothing

RL_REGISTRY_URL="${RL_REGISTRY_URL:-http://127.0.0.1:5000}"
RL_REGISTRY_REPO="${RL_REGISTRY_REPO:-rl-allinone}"
RL_REGISTRY_CONTAINER="${RL_REGISTRY_CONTAINER:-rl-registry}"
RL_REGISTRY_RETENTION_HOURS="${RL_REGISTRY_RETENTION_HOURS:-48}"
RL_REGISTRY_KEEP_N="${RL_REGISTRY_KEEP_N:-5}"
RL_REGISTRY_GC_INTERVAL_HOURS="${RL_REGISTRY_GC_INTERVAL_HOURS:-6}"
RL_REGISTRY_GC_STATE_FILE="${RL_REGISTRY_GC_STATE_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/registry-gc.json}"
RL_REGISTRY_GC_DRY_RUN="${RL_REGISTRY_GC_DRY_RUN:-0}"

_REGISTRY_ACCEPT="Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json"

registry_gc::_now() { echo "${RL_REGISTRY_GC_NOW:-$(date +%s)}"; }

registry_gc::_api() { echo "${RL_REGISTRY_URL%/}/v2/${RL_REGISTRY_REPO}"; }

# All tags of the repo, one per line (empty on any error).
registry_gc::list_tags() {
    curl -fsS --max-time 10 "$(registry_gc::_api)/tags/list" 2>/dev/null \
        | jq -r '.tags[]? // empty' 2>/dev/null || true
}

# Manifest digest of <tag> (Docker-Content-Digest header), empty if unknown.
registry_gc::digest() {
    curl -fsS --max-time 10 -I -H "$_REGISTRY_ACCEPT" "$(registry_gc::_api)/manifests/$1" 2>/dev/null \
        | tr -d '\r' | awk 'tolower($1) == "docker-content-digest:" {print $2}' | tail -1
}

# Build time of <tag> as epoch seconds (image config `.created`), or "null".
registry_gc::created_epoch() {
    local cfg
    cfg=$(curl -fsS --max-time 10 -H "$_REGISTRY_ACCEPT" "$(registry_gc::_api)/manifests/$1" 2>/dev/null \
        | jq -r '.config.digest // empty' 2>/dev/null)
    [[ -z "$cfg" ]] && { echo null; return 0; }
    curl -fsS --max-time 10 "$(registry_gc::_api)/blobs/${cfg}" 2>/dev/null \
        | jq -r '(.created // "") | sub("\\.[0-9]+"; "") | try fromdateiso8601 catch "null"' 2>/dev/null \
        || echo null
}

# Delete <tag> by its manifest digest, unless that digest is in <avoid>
# (newline list) — a DELETE by digest drops EVERY tag sharing it, `latest` too.
registry_gc::delete_tag() {
    local tag="$1" avoid="${2:-}" digest
    digest=$(registry_gc::digest "$tag")
    [[ -z "$digest" ]] && return 1
    if [[ -n "$avoid" ]] && grep -qxF "$digest" <<<"$avoid"; then return 1; fi
    [[ "$RL_REGISTRY_GC_DRY_RUN" == "1" ]] && return 0
    curl -fsS --max-time 10 -X DELETE "$(registry_gc::_api)/manifests/${digest}" >/dev/null 2>&1
}

# Tags that must survive: `latest`, any tag a container (running or stopped)
# was created from, and any tag an env-registry row points at. JSON array.
registry_gc::protected_tags() {
    local repo="$RL_REGISTRY_REPO"
    {
        echo latest
        docker ps -a --format '{{.Image}}' 2>/dev/null
        jq -r '.[]?.image // empty' "${RL_ENVS_FILE:-/dev/null}" 2>/dev/null
    } | sed -n "s#^\(.*/\)\{0,1\}${repo}:##p; s#^latest\$#latest#p" | sort -u | jq -Rnc '[inputs | select(length > 0)]'
}

# Pure selection. <tags_json> = [{tag, created}] (created epoch or null),
# <protected_json> = [tag]. Echoes doomed tags, one per line: unprotected,
# not among the newest RL_REGISTRY_KEEP_N, older than the retention window.
# A tag of unknown age is never doomed.
registry_gc::select_doomed() {
    jq -r --argjson prot "$2" --argjson now "$(registry_gc::_now)" \
        --argjson keep "$RL_REGISTRY_KEEP_N" --argjson ret "$(( RL_REGISTRY_RETENTION_HOURS * 3600 ))" \
        '[ .[] | select(.tag != "latest" and (.tag as $t | $prot | index($t) | not) and (.created | type) == "number") ]
         | sort_by(-.created) | .[$keep:][] | select(($now - .created) > $ret) | .tag' <<<"$1"
}

# 0 when an image build is admitted, or when admission state is unreadable
# (unknown is treated as busy: GC is the operation that must not race).
registry_gc::build_admitted() {
    local f="${RL_ADMISSION_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/admission.json}"
    [[ -r "$f" ]] || return 0
    jq -e '[(.heavy_running // [])[] | select(.kind == "image_build")] | length > 0' "$f" >/dev/null 2>&1 && return 0
    jq -e . "$f" >/dev/null 2>&1 || return 0
    return 1
}

# `registry garbage-collect` inside the registry container. Echoes ran|failed.
registry_gc::collect() {
    [[ "$RL_REGISTRY_GC_DRY_RUN" == "1" ]] && { echo dry_run; return 0; }
    if docker exec "$RL_REGISTRY_CONTAINER" registry garbage-collect --delete-untagged \
        /etc/docker/registry/config.yml >/dev/null 2>&1; then echo ran; else echo failed; fi
}

# Digests of the protected tags (newline list) — a doomed tag sharing one is
# spared, because the DELETE would take the protected tag down with it.
registry_gc::_protected_digests() {
    local tag
    for tag in $(jq -r '.[]' <<<"$1"); do registry_gc::digest "$tag"; done | sed '/^$/d' | sort -u
}

# [{tag, created}] for every tag in the repo.
registry_gc::_inventory() {
    local tag
    for tag in $(registry_gc::list_tags); do
        jq -nc --arg t "$tag" --argjson c "$(registry_gc::created_epoch "$tag")" '{tag:$t, created:$c}'
    done | jq -sc .
}

# The gc-sweeper entry. Interval-gated by RL_REGISTRY_GC_STATE_FILE unless
# $1 == force (the sweeper forces it under disk pressure). Deletes doomed
# tags, then garbage-collects when no image build is admitted. Echoes a JSON
# summary and always returns 0 — registry GC is never fatal to a sweep.
registry_gc::sweep() {
    local now last
    now=$(registry_gc::_now)
    last=$(jq -r '.last_run_epoch // 0' "$RL_REGISTRY_GC_STATE_FILE" 2>/dev/null || echo 0)
    if [[ "${1:-}" != "force" ]] && (( now - ${last:-0} < RL_REGISTRY_GC_INTERVAL_HOURS * 3600 )); then
        echo '{"skipped":"interval"}'; return 0
    fi
    local inv prot avoid tag deleted='[]' gc
    inv=$(registry_gc::_inventory); prot=$(registry_gc::protected_tags)
    avoid=$(registry_gc::_protected_digests "$prot")
    for tag in $(registry_gc::select_doomed "$inv" "$prot"); do
        registry_gc::delete_tag "$tag" "$avoid" && deleted=$(jq -c --arg t "$tag" '. + [$t]' <<<"$deleted")
    done
    if registry_gc::build_admitted; then gc="skipped_build_admitted"; else gc=$(registry_gc::collect); fi
    local result
    result=$(jq -nc --argjson n "$(jq 'length' <<<"$inv")" --argjson d "$deleted" --arg gc "$gc" \
        --argjson now "$now" --argjson dry "$([[ "$RL_REGISTRY_GC_DRY_RUN" == "1" ]] && echo true || echo false)" \
        '{tags_seen:$n, deleted:$d, gc:$gc, dry_run:$dry, last_run_epoch:$now, last_run_at:($now|todate)}')
    [[ "$RL_REGISTRY_GC_DRY_RUN" == "1" ]] || printf '%s\n' "$result" > "$RL_REGISTRY_GC_STATE_FILE" 2>/dev/null || true
    echo "$result"
    return 0
}

# env-destroy hook: delete the destroyed env's own `rl-allinone:<tag>` — the
# image recorded in its env-registry row — unless it is `latest` or another
# env still points at it. Call BEFORE the row is removed. Best-effort.
registry_gc::delete_env_tag() {
    local slug="$1" image tag
    image=$(jq -r --arg s "$slug" '[.[]? | select(.slug == $s)][0].image // empty' "$RL_ENVS_FILE" 2>/dev/null)
    [[ "$image" == *"${RL_REGISTRY_REPO}:"* ]] || return 0
    tag="${image##*"${RL_REGISTRY_REPO}:"}"
    [[ -z "$tag" || "$tag" == "latest" ]] && return 0
    jq -e --arg s "$slug" --arg i "$image" 'any(.[]?; .slug != $s and .image == $i)' "$RL_ENVS_FILE" >/dev/null 2>&1 \
        && return 0
    registry_gc::delete_tag "$tag" "$(registry_gc::digest latest)" || true
    return 0
}
