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
# flip it read-only without a restart, so the sweep holds a `registry_gc`
# entry in the admission ledger (admission.json, same flock as an image
# build's admit) for its WHOLE run — tag deletes and garbage-collect. While it
# is held no image build (the only pushers) is admitted; it is taken only when
# no build runs or waits, and it expires on a timer so a killed sweeper cannot
# wedge builds (ROK-2018, see _admission.sh). Single-arch v2 manifests only —
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
#   RL_REGISTRY_GC_DRY_RUN        0    1 = report, delete nothing (sweeper AND
#                                      env-destroy — both read /srv/rl-infra/.env)
#   RL_REGISTRY_GC_TIMEOUT_SECONDS 1800 bound on `registry garbage-collect`
#   RL_REGISTRY_GC_KEY            registry-gc  the sweep's admission-ledger key

RL_REGISTRY_URL="${RL_REGISTRY_URL:-http://127.0.0.1:5000}"
RL_REGISTRY_REPO="${RL_REGISTRY_REPO:-rl-allinone}"
RL_REGISTRY_CONTAINER="${RL_REGISTRY_CONTAINER:-rl-registry}"
RL_REGISTRY_RETENTION_HOURS="${RL_REGISTRY_RETENTION_HOURS:-48}"
RL_REGISTRY_KEEP_N="${RL_REGISTRY_KEEP_N:-5}"
RL_REGISTRY_GC_INTERVAL_HOURS="${RL_REGISTRY_GC_INTERVAL_HOURS:-6}"
RL_REGISTRY_GC_STATE_FILE="${RL_REGISTRY_GC_STATE_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/registry-gc.json}"
RL_REGISTRY_GC_DRY_RUN="${RL_REGISTRY_GC_DRY_RUN:-0}"
RL_REGISTRY_GC_TIMEOUT_SECONDS="${RL_REGISTRY_GC_TIMEOUT_SECONDS:-1800}"
RL_REGISTRY_GC_KEY="${RL_REGISTRY_GC_KEY:-registry-gc}"
_REGISTRY_GC_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"

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

# rl-allinone image refs (stdin, one per line, any registry prefix or none:
# `rl-allinone:x`, `127.0.0.1:5000/rl-allinone:x`, `registry.rl.lan:5000/
# rl-allinone:x`) → bare tags. Other repos and digest refs drop out, so two
# spellings of the same tag compare equal.
registry_gc::_tags_of() {
    sed -n "s#^\(.*/\)\{0,1\}${RL_REGISTRY_REPO}:\([^@/]*\)\$#\2#p"
}

# Tags that must survive: `latest`, any tag a container (running or stopped)
# was created from, any tag present as a local image on this daemon (built and
# pushed, but not yet attached to a container or env row), and any tag an
# env-registry row points at — except the row of slug <$1> (env-destroy
# excludes the env being destroyed). JSON array. Returns 1 (no output) when
# `docker ps`, `docker images` or the env registry cannot be read: a partial
# protected set would let the sweep delete a live env's image.
registry_gc::protected_tags() {
    local exclude="${1:-}" ps local_imgs envs
    ps=$(docker ps -a --format '{{.Image}}' 2>/dev/null) || return 1
    local_imgs=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null) || return 1
    envs=$(jq -er --arg s "$exclude" \
        'if type == "array" then [.[] | select(.slug != $s) | .image // empty] | join("\n") else error("not an array") end' \
        "${RL_ENVS_FILE:-/nonexistent}" 2>/dev/null) || return 1
    { echo latest; printf '%s\n%s\n%s\n' "$ps" "$local_imgs" "$envs" | registry_gc::_tags_of; } \
        | sed '/^$/d' | sort -u | jq -Rnc '[inputs]'
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

# Minimal flock+jq writers for the admission ledger, used only where
# _state.sh is not sourced (the gc-sweeper must not source it: it re-sources
# the stack .env and points DOCKER_HOST at the socket proxy). Same contract as
# _state.sh: refuse invalid JSON; the precondition variant returns 1 when the
# filter left the file unchanged.
registry_gc::_define_state_shims() {
    command -v flock >/dev/null 2>&1 || flock() { return 0; }
    state::mutate() { registry_gc::_mutate 0 "$@"; }
    state::mutate_with_precondition() { registry_gc::_mutate 1 "$@"; }
}
registry_gc::_mutate() {
    local pre="$1" file="$2"; shift 2
    (
        flock -x 200
        jq empty "$file" 2>/dev/null || { echo "registry_gc: $file is not valid JSON" >&2; exit 1; }
        local tmp; tmp=$(mktemp "${file}.XXXXXX") || exit 1
        jq "$@" "$file" > "$tmp" || { rm -f "$tmp"; exit 1; }
        if [[ "$pre" == 1 ]] && cmp -s "$file" "$tmp"; then rm -f "$tmp"; exit 1; fi
        mv "$tmp" "$file"; chmod 664 "$file" 2>/dev/null || true
    ) 200>"$RL_LOCK_DIR/$(basename "$file").lock"
}

# Load _admission.sh (gc_try_acquire / gc_renew / release) once. The lock dir
# defaults to <admission dir>/locks — the orchestrator's RL_LOCK_DIR for the
# same file, so the sweeper and task-start take the SAME flock. 1 when the
# library is missing (the caller then skips the sweep: no lock, no GC).
registry_gc::_load_admission() {
    declare -F admission::gc_try_acquire >/dev/null 2>&1 && return 0
    [[ -r "$_REGISTRY_GC_LIB_DIR/_admission.sh" ]] || return 1
    : "${RL_STATE_DIR:=${STATE_DIR:-/state}}"
    : "${RL_ADMISSION_FILE:=${RL_STATE_DIR}/admission.json}"
    : "${RL_LOCK_DIR:=$(dirname "$RL_ADMISSION_FILE")/locks}"
    mkdir -p "$RL_LOCK_DIR" 2>/dev/null || true
    declare -F state::mutate_with_precondition >/dev/null 2>&1 || registry_gc::_define_state_shims
    # shellcheck disable=SC1091
    source "$_REGISTRY_GC_LIB_DIR/_admission.sh"
    declare -F admission::gc_try_acquire >/dev/null 2>&1
}

# `registry garbage-collect` inside the registry container, bounded by
# RL_REGISTRY_GC_TIMEOUT_SECONDS (coreutils `timeout`, present in the
# sweeper's debian image). A timeout kills the `docker exec` client only, so
# on exit 124 the in-container process is pkill'd too (best-effort, logged to
# stderr): left running, its sweep phase would race the next build's pushes.
# Echoes ran|timed_out|failed|dry_run.
registry_gc::collect() {
    [[ "$RL_REGISTRY_GC_DRY_RUN" == "1" ]] && { echo dry_run; return 0; }
    local rc=0
    timeout -k 10 "$RL_REGISTRY_GC_TIMEOUT_SECONDS" docker exec "$RL_REGISTRY_CONTAINER" \
        registry garbage-collect --delete-untagged /etc/docker/registry/config.yml >/dev/null 2>&1 || rc=$?
    if [[ "$rc" == 124 ]]; then
        echo "registry_gc: garbage-collect timed out after ${RL_REGISTRY_GC_TIMEOUT_SECONDS}s — killing it in $RL_REGISTRY_CONTAINER" >&2
        docker exec "$RL_REGISTRY_CONTAINER" pkill -f garbage-collect >/dev/null 2>&1 \
            || echo "registry_gc: pkill garbage-collect in $RL_REGISTRY_CONTAINER failed" >&2
    fi
    case "$rc" in 0) echo ran ;; 124) echo timed_out ;; *) echo failed ;; esac
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

registry_gc::_dry() { if [[ "$RL_REGISTRY_GC_DRY_RUN" == "1" ]]; then echo true; else echo false; fi; }

# Last run epoch from the state file; 0 when absent or recorded in the other
# mode, so switching dry-run off does not wait out a dry run's interval.
registry_gc::_last_run() {
    jq -r --argjson dry "$(registry_gc::_dry)" \
        'if (.dry_run // false) == $dry then .last_run_epoch // 0 else 0 end' \
        "$RL_REGISTRY_GC_STATE_FILE" 2>/dev/null || echo 0
}

# Write + echo the run summary <now> <inventory> <deleted> <gc>. Dry runs are
# recorded too (dry_run:true, `deleted` = would-delete) so the interval holds.
registry_gc::_record() {
    local result
    result=$(jq -nc --argjson n "$(jq 'length' <<<"$2")" --argjson d "$3" --arg gc "$4" \
        --argjson now "$1" --argjson dry "$(registry_gc::_dry)" \
        '{tags_seen:$n, deleted:$d, gc:$gc, dry_run:$dry, last_run_epoch:$now, last_run_at:($now|todate)}')
    printf '%s\n' "$result" > "$RL_REGISTRY_GC_STATE_FILE" 2>/dev/null || true
    echo "$result"
}

# The gc-sweeper entry. Interval-gated by RL_REGISTRY_GC_STATE_FILE unless
# $1 == force (the sweeper forces it under disk pressure). Takes the
# `registry_gc` admission entry first and skips everything when refused (a
# build is running or waiting — it is the only pusher, and a fresh cached-build
# tag has an old config.created and maybe no env row yet); a skipped sweep
# writes no state, so it retries next tick. The entry is released on every
# exit of the held part (trap + an explicit release). Echoes a JSON summary.
# Returns 1 ({"error":…}) when the protected set is unreadable.
registry_gc::sweep() {
    local now last reason rc=0 key="$RL_REGISTRY_GC_KEY"
    now=$(registry_gc::_now); last=$(registry_gc::_last_run)
    if [[ "${1:-}" != "force" ]] && (( now - ${last:-0} < RL_REGISTRY_GC_INTERVAL_HOURS * 3600 )); then
        echo '{"skipped":"interval"}'; return 0
    fi
    if ! registry_gc::_load_admission; then
        echo '{"skipped":"admission_lib_missing"}'; return 0
    fi
    if ! reason=$(admission::gc_try_acquire "$key"); then
        jq -nc --arg r "$reason" '{skipped: (if ($r | startswith("image_build")) then "build_admitted"
            else "admission_refused" end), blocked_by: $r}'
        return 0
    fi
    (
        trap 'admission::release "$key"' EXIT
        trap 'exit 143' TERM INT HUP
        registry_gc::_sweep_held "$now"
    ) || rc=$?
    admission::release "$key"
    return "$rc"
}

# The sweep body, run while the admission entry is held. Re-arms the entry's
# expiry right before garbage-collect; if the entry is gone by then (expired
# and pruned) a build may already be pushing, so garbage-collect is skipped.
registry_gc::_sweep_held() {
    local now="$1" prot inv avoid tag deleted='[]' gc
    if ! prot=$(registry_gc::protected_tags); then
        echo "registry_gc: docker ps, docker images or $RL_ENVS_FILE unreadable — sweep aborted" >&2
        echo '{"error":"protected_tags_unreadable"}'; return 1
    fi
    inv=$(registry_gc::_inventory); avoid=$(registry_gc::_protected_digests "$prot")
    for tag in $(registry_gc::select_doomed "$inv" "$prot"); do
        registry_gc::delete_tag "$tag" "$avoid" && deleted=$(jq -c --arg t "$tag" '. + [$t]' <<<"$deleted")
    done
    if admission::gc_renew "$RL_REGISTRY_GC_KEY"; then gc=$(registry_gc::collect); else gc="skipped_lock_lost"; fi
    registry_gc::_record "$now" "$inv" "$deleted" "$gc"
}

# env-destroy hook: delete the destroyed env's own `rl-allinone:<tag>` — the
# image recorded in its env-registry row — unless it is `latest`, another env
# or container still uses it (any registry prefix), or its digest equals a
# protected tag's (a DELETE by digest drops every tag sharing it). Call BEFORE
# the row is removed. Honours RL_REGISTRY_GC_DRY_RUN. Logs to stderr only
# (env-destroy's stdout is its JSON result). Best-effort: always returns 0.
registry_gc::delete_env_tag() {
    local slug="$1" tag prot
    tag=$(jq -r --arg s "$slug" '[.[]? | select(.slug == $s)][0].image // empty' "$RL_ENVS_FILE" 2>/dev/null \
        | registry_gc::_tags_of)
    [[ -z "$tag" || "$tag" == "latest" ]] && return 0
    if ! prot=$(registry_gc::protected_tags "$slug"); then
        echo "registry: protected tags unreadable — keeping ${RL_REGISTRY_REPO}:$tag" >&2; return 0
    fi
    jq -e --arg t "$tag" 'index($t)' <<<"$prot" >/dev/null && return 0
    registry_gc::delete_tag "$tag" "$(registry_gc::_protected_digests "$prot")" || return 0
    if [[ "$RL_REGISTRY_GC_DRY_RUN" == "1" ]]; then
        echo "registry: would delete ${RL_REGISTRY_REPO}:$tag (RL_REGISTRY_GC_DRY_RUN=1)" >&2
    else
        echo "registry: deleted ${RL_REGISTRY_REPO}:$tag" >&2
    fi
    return 0
}
