#!/usr/bin/env bash
# ROK-2171 — env-destroy removes the destroyed env's LOCAL image tag.
#
# registry_gc::delete_env_tag (2026-10-26) deletes the env's rl-allinone:<tag>
# from rl-registry, but the VM host kept its local copy (~1.5 GB of layers per
# env; 34 rl-allinone tags on 2026-11-10). This removes it on destroy, keeping
# it (log line + audit entry, never a failure) when:
#   - the env row has no image, or the image is not present locally;
#   - another env row names the same tag (any registry-prefix spelling, as
#     registry_gc::_tags_of compares them);
#   - the image is labelled rl.role=runner;
#   - any container, running or stopped, was created from it — or `docker ps`
#     cannot say;
#   - an image build is BUILDING (admission ledger kind image_build, not
#     disk_parked — disk_pressure::image_build_keys' rule): the image's layers
#     may be that classic build's cache parent. Also when the ledger is
#     unreadable. image_prune (until=48h) reclaims a kept tag later;
#   - `docker image rm` (no --force: Docker's own in-use / child checks apply)
#     refuses.
# Only the ref the env row names is removed; another tag on the same image ID
# keeps the image (Docker untags).
#
# Requires: jq, docker, $RL_ENVS_FILE; registry_gc::_tags_of (_registry_gc.sh)
# for the tag comparison. Every exit path returns 0.

local_image_gc::_log() { echo "local image: $*" >&2; }

local_image_gc::_audit() {
    declare -F audit::log >/dev/null 2>&1 || return 0
    audit::log env-destroy "local-image-$1" \
        "$(jq -nc --arg slug "$2" --arg ref "$3" --arg why "${4:-}" '{slug:$slug, image:$ref, reason:$why}')" || true
}

# Echoes "busy" when an image build is building (or the ledger is unreadable).
local_image_gc::_build_busy() {
    local ledger="${RL_ADMISSION_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/admission.json}" n
    [[ -r "$ledger" ]] || { echo busy; return 0; }
    n=$(jq -er '[(.heavy_running // [])[] | select((.kind // "task") == "image_build")
                 | select(.disk_parked != true)] | length' "$ledger" 2>/dev/null) || { echo busy; return 0; }
    [[ "$n" == "0" ]] || echo busy
}

# Why the local image `ref` of env `slug` must be kept; empty = remove it.
local_image_gc::_keep_reason() {
    local slug="$1" ref="$2" tag others role users
    tag=$(registry_gc::_tags_of <<<"$ref")
    others=$(jq -r --arg s "$slug" '.[]? | select(.slug != $s) | .image // empty' "$RL_ENVS_FILE" 2>/dev/null) \
        || { echo "env registry unreadable"; return 0; }
    if [[ -n "$tag" ]] && registry_gc::_tags_of <<<"$others" | grep -qxF "$tag"; then
        echo "another env uses tag $tag"; return 0
    fi
    grep -qxF "$ref" <<<"$others" && { echo "another env uses $ref"; return 0; }
    role=$(docker image inspect --format '{{ index .Config.Labels "rl.role" }}' "$ref" 2>/dev/null) \
        || { echo "absent"; return 0; }
    [[ "$role" == "runner" ]] && { echo "labelled rl.role=runner"; return 0; }
    users=$(docker ps -aq --filter "ancestor=$ref" 2>/dev/null) || { echo "docker ps unreadable"; return 0; }
    [[ -n "$users" ]] && { echo "$(wc -l <<<"$users" | tr -d ' ') container(s) use it"; return 0; }
    [[ -n "$(local_image_gc::_build_busy)" ]] && { echo "an image build is in flight (or the ledger is unreadable)"; return 0; }
    return 0
}

# local_image_gc::remove_env_image <slug> — call while the env row still exists.
local_image_gc::remove_env_image() {
    local slug="$1" ref why err
    ref=$(jq -r --arg s "$slug" '[.[]? | select(.slug == $s)][0].image // empty' "$RL_ENVS_FILE" 2>/dev/null) || ref=""
    [[ -z "$ref" ]] && return 0
    why=$(local_image_gc::_keep_reason "$slug" "$ref")
    if [[ "$why" == "absent" ]]; then return 0; fi
    if [[ -n "$why" ]]; then
        local_image_gc::_log "kept $ref ($why)"; local_image_gc::_audit kept "$slug" "$ref" "$why"; return 0
    fi
    if err=$(docker image rm "$ref" 2>&1 >/dev/null); then
        local_image_gc::_log "removed $ref"; local_image_gc::_audit removed "$slug" "$ref"
    else
        local_image_gc::_log "kept $ref (docker image rm failed: ${err//$'\n'/ })"
        local_image_gc::_audit kept "$slug" "$ref" "rm failed"
    fi
    return 0
}
