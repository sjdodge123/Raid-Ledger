#!/usr/bin/env bash
# ROK-2171 — the gc-sweeper removes local env images nothing uses any more.
#
# Why: env-destroy deletes the env's rl-allinone:<tag> from rl-registry, but the
# VM host kept its local copy (~1.5 GB per env; 34 rl-allinone tags on
# 2026-11-10). env-destroy cannot remove it itself: it talks to the daemon
# through rl-docker-proxy, which refuses DELETE /images (Codex P1). The
# gc-sweeper holds the raw docker socket, so the removal lives here (operator
# ruling 2026-11-12, option a).
#
# SOURCEABLE library (no side effects on source beyond knob defaults and
# loading _registry_gc.sh), used by gc-sweeper/sweep.sh → env_image_gc::sweep.
# Never sources _state.sh (it would point DOCKER_HOST at the proxy).
#
# A local `$RL_ENV_IMAGE_GC_REPO:<tag>` image is removed only when ALL hold:
#   - no env-registry row names it: not by tag (any registry-prefix spelling,
#     registry_gc::_tags_of), not by exact ref, and no row pinned by digest
#     resolves to the same image ID. An unreadable or non-array env registry
#     aborts the sweep (nothing removed);
#   - no container of any state was created from its image ID (`docker ps -a
#     --filter ancestor=<id>`); an unreadable container list keeps it;
#   - it is not labelled rl.role=runner;
#   - no env row pins its bare image ID (`sha256:<hex>`, env-spin's re-spin of
#     an unclaimed slot records that form);
#   - its newest of Created and Metadata.LastTagTime (a cached rebuild keeps an
#     old Created but re-tags) is older than RL_ENV_IMAGE_GC_MIN_AGE_HOURS, so
#     a freshly built image is not removed before its env is spun; an
#     unparseable age keeps it;
#   - its release grace is over: RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS since the
#     tag was released, i.e. since env-destroy recorded it
#     (env_image_gc::mark_env_released; env-destroy also deletes the registry
#     tag, so this local copy is the only source for a destroy → re-spin with
#     the same --image) or, when no release time is recorded, since the first
#     sweep that found it unused (that sweep records it and keeps the image).
#     A tag an env row or container uses has its record cleared, so its next
#     release starts a fresh grace. Records: one file per tag holding the epoch,
#     in RL_ENV_IMAGE_GC_RELEASED_DIR (default env-image-released/ beside the
#     env registry); written in dry run too. The dir is provisioned at deploy
#     (runner/ensure-runner-dirs.sh, rl-agent:rl-fleet 2775) and never created
#     here: whichever writer made it first would decide its owner (review r2
#     MINOR-1). Missing dir → no records → every unused image is kept. After
#     each sweep, records whose tag has no local image, and records older than
#     grace + RL_ENV_IMAGE_GC_RECORD_MARGIN_HOURS, are pruned (MINOR-2); a
#     pruned record never removes an image, it only restarts a full grace;
#   - a `registry_gc`-kind entry (key RL_ENV_IMAGE_GC_KEY) is held in the
#     admission ledger for the whole removal pass: taken under the ledger flock
#     only when no image build runs or waits, and while held no image build is
#     admitted. Every candidate is re-checked inside the reservation and the
#     entry is renewed before each removal; a lost entry stops the pass. The
#     entry is released on every exit path (trap + explicit release) and
#     expires after RL_ENV_IMAGE_GC_TIMEOUT_SECONDS + 120 s otherwise.
# Removal is `docker image rm <ref>` without --force, so Docker's own in-use
# and child-image checks still apply, and another tag on the same image ID
# keeps the layers (Docker only untags). A `--static` gate's container build
# runs as kind:task, which does not block the pass (same trade-off as
# dangling_prune).
#
# Env knobs:
#   RL_ENV_IMAGE_GC_REPO              registry.rl.lan:5000/rl-allinone
#   RL_ENV_IMAGE_GC_MIN_AGE_HOURS     2    age floor (image build/tag time)
#   RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS 2  grace after release; 0 = off
#   RL_ENV_IMAGE_GC_RELEASED_DIR      <dir of RL_ENVS_FILE>/env-image-released
#   RL_ENV_IMAGE_GC_RECORD_MARGIN_HOURS 24 record kept this long past its grace
#   RL_ENV_IMAGE_GC_DRY_RUN           1    report only; 0 = remove
#   RL_ENV_IMAGE_GC_TIMEOUT_SECONDS   600  ledger-entry lifetime (renewed per image)
#   RL_ENV_IMAGE_GC_RM_TIMEOUT_SECONDS 120 bound on one `docker image rm`
#   RL_ENV_IMAGE_GC_KEY               env-image-gc

RL_ENV_IMAGE_GC_REPO="${RL_ENV_IMAGE_GC_REPO:-registry.rl.lan:5000/rl-allinone}"
RL_ENV_IMAGE_GC_MIN_AGE_HOURS="${RL_ENV_IMAGE_GC_MIN_AGE_HOURS:-2}"
RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS="${RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS:-2}"
RL_ENV_IMAGE_GC_RECORD_MARGIN_HOURS="${RL_ENV_IMAGE_GC_RECORD_MARGIN_HOURS:-24}"
RL_ENV_IMAGE_GC_DRY_RUN="${RL_ENV_IMAGE_GC_DRY_RUN:-1}"
RL_ENV_IMAGE_GC_TIMEOUT_SECONDS="${RL_ENV_IMAGE_GC_TIMEOUT_SECONDS:-600}"
RL_ENV_IMAGE_GC_RM_TIMEOUT_SECONDS="${RL_ENV_IMAGE_GC_RM_TIMEOUT_SECONDS:-120}"
RL_ENV_IMAGE_GC_KEY="${RL_ENV_IMAGE_GC_KEY:-env-image-gc}"
_ENV_IMAGE_GC_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
if ! declare -F registry_gc::_load_admission >/dev/null 2>&1; then
    # shellcheck source=SCRIPTDIR/_registry_gc.sh
    source "$_ENV_IMAGE_GC_LIB_DIR/_registry_gc.sh"
fi

env_image_gc::_log() { echo "$*" >&2; }
env_image_gc::_now() { echo "${RL_ENV_IMAGE_GC_NOW:-$(date +%s)}"; }

# Every env row's .image, one per line; 1 unless the file is exactly one JSON
# array document (`[]` is fine). Slurped, because jq given an empty,
# whitespace-only file runs no filter and exits 0 (Codex P2).
env_image_gc::_rows() {
    jq -rs 'if length == 1 and (.[0] | type) == "array" then .[0][] | .image // empty
            else error("not one array document") end' "$RL_ENVS_FILE" 2>/dev/null
}

env_image_gc::_released_dir() {
    echo "${RL_ENV_IMAGE_GC_RELEASED_DIR:-$(dirname "${RL_ENVS_FILE:-/state/env-registry.json}")/env-image-released}"
}
env_image_gc::_valid_tag() { [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; }

# Grace hours, a non-number read as the default 2.
env_image_gc::_grace_hours() {
    local h="$RL_ENV_IMAGE_GC_RELEASE_GRACE_HOURS"; [[ "$h" =~ ^[0-9]+$ ]] || h=2; echo "$h"
}

# Record that tag $1 was released at epoch $2 (default now). Never creates the
# dir (deploy provisions it; MINOR-1). rc 1 = nothing written.
env_image_gc::mark_released() {
    local tag="$1" at="${2:-$(env_image_gc::_now)}" dir
    env_image_gc::_valid_tag "$tag" || return 0
    dir=$(env_image_gc::_released_dir)
    [[ -d "$dir" ]] || return 1
    { printf '%s\n' "$at" > "$dir/.$tag.$$" && mv -f "$dir/.$tag.$$" "$dir/$tag"; } 2>/dev/null && return 0
    rm -f "$dir/.$tag.$$" 2>/dev/null
    return 1
}

env_image_gc::_clear_released() {
    env_image_gc::_valid_tag "$1" && rm -f "$(env_image_gc::_released_dir)/$1" 2>/dev/null
    return 0
}

# env-destroy hook (call BEFORE the row is removed): the slug's image tag is
# released now. Best-effort, always 0, no Docker access.
env_image_gc::mark_env_released() {
    local tag
    tag=$(jq -r --arg s "$1" '[.[]? | select(.slug == $s)][0].image // empty' "$RL_ENVS_FILE" 2>/dev/null \
        | registry_gc::_tags_of)
    [[ -n "$tag" ]] || return 0
    env_image_gc::mark_released "$tag" && return 0
    env_image_gc::_log "env-image-gc: WARNING could not record the release of $tag in" \
        "$(env_image_gc::_released_dir); the gc-sweeper starts its grace at its next sweep instead"
    return 0
}

# Why tag $1 is still in its release grace at time $2; empty = grace over.
# No readable record → record now and keep (MAJOR-1: unknown = just released).
env_image_gc::_release_keep() {
    local tag="$1" now="$2" hours at
    hours=$(env_image_gc::_grace_hours)
    (( hours > 0 )) || return 0
    at=$(cat "$(env_image_gc::_released_dir)/$tag" 2>/dev/null)
    if ! [[ "$at" =~ ^[0-9]+$ ]]; then
        if env_image_gc::mark_released "$tag" "$now"; then echo "release time unknown: ${hours}h grace starts now"
        else echo "no release record and none can be written: kept"; fi
        return 0
    fi
    (( now - at < hours * 3600 )) && echo "released less than ${hours}h ago"
    return 0
}

# Local refs of the repo (untagged ones excluded); 1 when docker cannot list.
env_image_gc::_local_refs() {
    local out
    out=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$RL_ENV_IMAGE_GC_REPO" 2>/dev/null) || return 1
    grep -v ':<none>$' <<<"$out" | grep -v '^$' || true
}

# "<id>|<role>|<age epoch or empty>" for ref $1. rc 1 = no such image,
# rc 2 = any other inspect failure (message on stdout).
env_image_gc::_inspect() {
    local out
    if ! out=$(docker image inspect "$1" 2>&1); then
        grep -qi 'no such image' <<<"$out" && return 1
        echo "${out//$'\n'/ }"; return 2
    fi
    jq -r 'def ep: (. // "") | sub("\\.[0-9]+"; "") | sub("[+]00:00$"; "Z") | (fromdateiso8601? // null);
        .[0] | [.Id, (.Config.Labels["rl.role"] // ""),
                ([(.Created | ep), (.Metadata.LastTagTime | ep)] | map(select(. != null)) | max // "")]
        | map(tostring) | join("|")' <<<"$out" 2>/dev/null || { echo "unparseable inspect"; return 2; }
}

# Why another env's digest-pinned row keeps image id $1; empty = none does.
env_image_gc::_digest_keep() {
    local id="$1" rows="$2" pin info rc
    while IFS= read -r pin; do
        [[ "$pin" == *@sha256:* ]] || continue
        info=$(env_image_gc::_inspect "$pin"); rc=$?
        (( rc == 1 )) && continue
        (( rc == 2 )) && { echo "cannot inspect digest-pinned $pin"; return 0; }
        [[ "${info%%|*}" == "$id" ]] && { echo "an env pins the same image as $pin"; return 0; }
    done <<<"$rows"
    return 0
}

# Why ref $1 must be kept given env rows $2 at time $3; "absent" = gone; empty = remove.
env_image_gc::_keep_reason() {
    local ref="$1" rows="$2" now="$3" tag info rc id role age why users
    tag=$(registry_gc::_tags_of <<<"$ref")
    if [[ -n "$tag" ]] && grep -qxF "$tag" <<<"$(registry_gc::_tags_of <<<"$rows")"; then
        env_image_gc::_clear_released "$tag"; echo "an env uses tag $tag"; return 0
    fi
    grep -qxF "$ref" <<<"$rows" && { env_image_gc::_clear_released "$tag"; echo "an env uses $ref"; return 0; }
    info=$(env_image_gc::_inspect "$ref"); rc=$?
    (( rc == 1 )) && { echo absent; return 0; }
    (( rc != 0 )) && { echo "docker image inspect failed: $info"; return 0; }
    IFS='|' read -r id role age <<<"$info"
    # Review MINOR-1: a row pinned to the bare image ID (env-spin re-spin).
    grep -qxF "$id" <<<"$rows" && { env_image_gc::_clear_released "$tag"; echo "an env pins image id $id"; return 0; }
    [[ "$role" == "runner" ]] && { echo "labelled rl.role=runner"; return 0; }
    [[ "$age" =~ ^-?[0-9]+$ ]] || { echo "age unknown"; return 0; }
    (( now - age < RL_ENV_IMAGE_GC_MIN_AGE_HOURS * 3600 )) \
        && { echo "younger than ${RL_ENV_IMAGE_GC_MIN_AGE_HOURS}h"; return 0; }
    why=$(env_image_gc::_digest_keep "$id" "$rows")
    [[ -n "$why" ]] && { env_image_gc::_clear_released "$tag"; echo "$why"; return 0; }
    users=$(docker ps -aq --filter "ancestor=$id" 2>/dev/null) || { echo "docker ps unreadable"; return 0; }
    if [[ -n "$users" ]]; then
        env_image_gc::_clear_released "$tag"; echo "$(grep -c . <<<"$users") container(s) use it"; return 0
    fi
    env_image_gc::_release_keep "$tag" "$now"
    return 0
}

# JSON array of "ref\treason" lines (stdin); a line without a tab → {image}.
env_image_gc::_json() {
    jq -Rsc '[split("\n")[] | select(length > 0) | split("\t")
              | if length > 1 then {image: .[0], reason: .[1]} else {image: .[0]} end]'
}

env_image_gc::_renew() {
    RL_REGISTRY_GC_TIMEOUT_SECONDS="$RL_ENV_IMAGE_GC_TIMEOUT_SECONDS" admission::gc_renew "$RL_ENV_IMAGE_GC_KEY"
}

# The removal pass, run while the ledger entry is held. Renews the entry, then
# re-reads the env rows and re-checks each candidate before removing it; stops
# (stopped: lock_lost | env_registry_unreadable) at the first failure.
env_image_gc::_remove_held() {
    local now="$1"; shift
    local rows ref why err removed="" kept="" failed="" stop=""
    for ref in "$@"; do
        if ! env_image_gc::_renew; then stop=lock_lost; break; fi
        # Re-read per image: a row written since the pre-pass must count.
        rows=$(env_image_gc::_rows) || { stop=env_registry_unreadable; break; }
        why=$(env_image_gc::_keep_reason "$ref" "$rows" "$now")
        [[ "$why" == absent ]] && continue
        if [[ -n "$why" ]]; then kept+="$ref"$'\t'"$why"$'\n'; continue; fi
        if err=$(timeout "$RL_ENV_IMAGE_GC_RM_TIMEOUT_SECONDS" docker image rm "$ref" 2>&1 >/dev/null); then
            removed+="$ref"$'\n'; env_image_gc::_log "removed $ref"
            env_image_gc::_clear_released "$(registry_gc::_tags_of <<<"$ref")"
        else
            failed+="$ref"$'\t'"${err//$'\n'/ }"$'\n'; env_image_gc::_log "rm failed $ref: ${err//$'\n'/ }"
        fi
    done
    jq -nc --argjson r "$(env_image_gc::_json <<<"$removed")" --argjson k "$(env_image_gc::_json <<<"$kept")" \
        --argjson f "$(env_image_gc::_json <<<"$failed")" --arg s "$stop" \
        '{removed: $r, kept: $k, failed: $f} + (if $s == "" then {} else {stopped: $s} end)'
}

# Review r2 MINOR-2: drop records whose tag has no local image, or older than
# grace + margin (an unused image goes one grace after its record, so an older
# one is a leftover). Only when the image list is readable. Logs a count.
env_image_gc::_prune_records() {
    local dir refs tags now max f tag at n=0 margin="$RL_ENV_IMAGE_GC_RECORD_MARGIN_HOURS"
    dir=$(env_image_gc::_released_dir); [[ -d "$dir" ]] || return 0
    refs=$(env_image_gc::_local_refs) || return 0
    tags=$(registry_gc::_tags_of <<<"$refs"); now=$(env_image_gc::_now)
    [[ "$margin" =~ ^[0-9]+$ ]] || margin=24
    max=$(( ($(env_image_gc::_grace_hours) + margin) * 3600 ))
    for f in "$dir"/*; do
        tag=${f##*/}
        [[ -f "$f" ]] && env_image_gc::_valid_tag "$tag" || continue
        at=$(cat "$f" 2>/dev/null)
        grep -qxF "$tag" <<<"$tags" && [[ "$at" =~ ^[0-9]+$ ]] && (( now - at < max )) && continue
        rm -f "$f" 2>/dev/null && n=$((n + 1))
    done
    (( n == 0 )) || env_image_gc::_log "env-image-gc: pruned $n stale release record(s)"
    return 0
}

# env_image_gc::sweep — echoes a JSON summary; always returns 0. `idle:true`
# means there was nothing to remove and no reservation was taken. Release
# records are pruned after the pass, so a candidate's record is still there
# for the in-reservation re-check.
env_image_gc::sweep() {
    local dir; dir=$(env_image_gc::_released_dir)
    if (( $(env_image_gc::_grace_hours) > 0 )) && [[ ! -d "$dir" ]]; then
        env_image_gc::_log "env-image-gc: release-record dir $dir is missing (deploy creates it);" \
            "no records, so every unused image is kept"
    fi
    env_image_gc::_sweep_once
    env_image_gc::_prune_records
    return 0
}

env_image_gc::_sweep_once() {
    local now rows refs ref why cands=() kept="" reason out key="$RL_ENV_IMAGE_GC_KEY"
    now=$(env_image_gc::_now)
    rows=$(env_image_gc::_rows) || { echo '{"error":"env_registry_unreadable"}'; return 0; }
    refs=$(env_image_gc::_local_refs) || { echo '{"error":"image_list_unreadable"}'; return 0; }
    while IFS= read -r ref; do
        [[ -n "$ref" ]] || continue
        why=$(env_image_gc::_keep_reason "$ref" "$rows" "$now")
        [[ "$why" == absent ]] && continue
        if [[ -n "$why" ]]; then kept+="$ref"$'\t'"$why"$'\n'; else cands+=("$ref"); fi
    done <<<"$refs"
    if (( ${#cands[@]} == 0 )); then
        jq -nc --argjson k "$(env_image_gc::_json <<<"$kept")" '{idle: true, kept: $k}'; return 0
    fi
    if [[ "$RL_ENV_IMAGE_GC_DRY_RUN" == "1" ]]; then
        jq -nc --argjson k "$(env_image_gc::_json <<<"$kept")" \
            --argjson w "$(printf '%s\n' "${cands[@]}" | env_image_gc::_json)" \
            '{dry_run: true, would_remove: $w, kept: $k}'
        return 0
    fi
    registry_gc::_load_admission || { echo '{"skipped":"admission_lib_missing"}'; return 0; }
    if ! reason=$(RL_REGISTRY_GC_TIMEOUT_SECONDS="$RL_ENV_IMAGE_GC_TIMEOUT_SECONDS" \
            admission::gc_try_acquire "$key"); then
        jq -nc --arg r "$reason" '{skipped: "admission_refused", blocked_by: $r}'; return 0
    fi
    out=$(
        # shellcheck disable=SC2064  # key baked in now; locals are gone by EXIT.
        trap "admission::release $(printf '%q' "$key")" EXIT
        trap 'exit 143' TERM INT HUP
        env_image_gc::_remove_held "$now" "${cands[@]}"
    ) || true
    admission::release "$key"
    [[ -n "$out" ]] || out='{"error":"removal_pass_died"}'
    # Images the pre-pass already kept are reported too.
    jq -c --argjson k "$(env_image_gc::_json <<<"$kept")" '.kept = ($k + (.kept // []))' <<<"$out" 2>/dev/null \
        || echo "$out"
    return 0
}
