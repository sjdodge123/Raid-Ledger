#!/usr/bin/env bash
# ROK-2181 — gc-sweeper step 3, the scoped `rl.role=env` prune.
#
# The step used to be three blanket calls every cycle:
#     docker {image,volume,container} prune -f --filter label=rl.role=env
# with no look at env-registry, so a PRESERVED env (rl_release keeps envs by
# default and marks the row claimable_by_next) or a PINNED env (rl_env_pin sets
# the row's .pinned) lost its stopped containers, then its rl-data-<slug>
# volume (dangling once the pg container was gone), then its image.
#
# Source of truth: env-registry.json. A row exists for every env env-spin
# brought up and that no destroy path (env-destroy, the TTL reap, the dead-claim
# reap — which already honour pinned / created_for_branch / plan grace) has
# removed yet. Pinned and preserved rows are a subset of that, so the prune
# protects EVERY registered slug and only reclaims resources of envs the
# registry no longer knows (dead envs).
#
# Per resource, never a blanket prune:
#   containers  stopped (exited/created/dead) rl.role=env containers; kept when
#               their rl.env_slug label, or their rl-env-<slug>-{allinone,pg}
#               name, is a registered slug. `docker rm` without -f.
#   volumes     dangling rl.role=env volumes; kept when their rl.env_slug label,
#               or their rl-data-<slug> name, is a registered slug.
#   images      dangling rl.role=env images; kept when a registry row's .image
#               is that image id. `docker image rm` without -f (Docker refuses
#               an image any container still uses).
#
# Fail safe: an env registry that is missing, unreadable or not a JSON array
# prunes NOTHING this cycle (`error:"env_registry_unreadable"`) — never a
# fallback to the blanket prune. A listing that fails skips only that kind.
# RL_ENV_SCOPED_PRUNE_DRY_RUN=1 lists `would_remove` and removes nothing
# (default 0: this step always pruned).
#
# Usage (sourced): env_scoped_prune::run <env-registry.json>
#   stdout: one JSON summary {removed, would_remove, kept, failed, error?}
#   rc:     always 0 — a sweeper cycle is never lost to this step.

# Space-padded list of registered slugs (" a b "), or rc 1 when the registry
# is not a readable JSON array.
env_scoped_prune::registered_slugs() {
    local envs="$1" slugs
    slugs=$(jq -er 'if type == "array" then [.[] | .slug // empty | tostring] | join(" ") else error("not an array") end' \
        "$envs" 2>/dev/null) || return 1
    printf ' %s ' "$slugs"
}

# Image ids (sha256:…) named by a registry row's .image, space-padded.
env_scoped_prune::registered_image_ids() {
    local ids
    ids=$(jq -r '[.[] | .image // empty | tostring | select(startswith("sha256:"))] | join(" ")' "$1" 2>/dev/null || true)
    printf ' %s ' "$ids"
}

# rc 0 when slug $1 is in the padded list $2.
env_scoped_prune::_registered() {
    [[ -n "$1" && "$2" == *" $1 "* ]]
}

# Record one decision into the _ESP_* arrays and act on a removal.
# Args: kind id action(keep|remove) reason rm-command…
env_scoped_prune::_decide() {
    local kind="$1" id="$2" action="$3" reason="$4"
    shift 4
    local entry
    entry=$(jq -nc --arg k "$kind" --arg i "$id" --arg r "$reason" '{kind:$k, id:$i, reason:$r}')
    if [[ "$action" == keep ]]; then
        _ESP_KEPT+=("$entry")
    elif [[ "${RL_ENV_SCOPED_PRUNE_DRY_RUN:-0}" == "1" ]]; then
        _ESP_WOULD+=("$entry")
    elif "$@" >/dev/null 2>&1; then
        _ESP_REMOVED+=("$entry")
    else
        _ESP_FAILED+=("$entry")
    fi
}

# Stopped rl.role=env containers.
env_scoped_prune::_containers() {
    local slugs="$1" listing id slug name owner
    listing=$(docker ps -a --filter label=rl.role=env --filter status=exited --filter status=created \
        --filter status=dead --format '{{.ID}}|{{.Label "rl.env_slug"}}|{{.Names}}' 2>/dev/null) \
        || { _ESP_ERRORS+=("containers_unreadable"); return 0; }
    while IFS='|' read -r id slug name; do
        [[ -z "$id" ]] && continue
        owner=""
        if [[ "$name" =~ ^/?rl-env-(.+)-(allinone|pg)$ ]]; then owner="${BASH_REMATCH[1]}"; fi
        if env_scoped_prune::_registered "$slug" "$slugs" || env_scoped_prune::_registered "$owner" "$slugs"; then
            env_scoped_prune::_decide container "$id" keep "registered:${slug:-$owner}"
        else
            env_scoped_prune::_decide container "$id" remove "unregistered:${slug:-$owner}" docker rm "$id"
        fi
    done <<<"$listing"
}

# Dangling rl.role=env volumes.
env_scoped_prune::_volumes() {
    local slugs="$1" listing name slug owner
    listing=$(docker volume ls --filter label=rl.role=env --filter dangling=true \
        --format '{{.Name}}|{{.Label "rl.env_slug"}}' 2>/dev/null) \
        || { _ESP_ERRORS+=("volumes_unreadable"); return 0; }
    while IFS='|' read -r name slug; do
        [[ -z "$name" ]] && continue
        owner="${name#rl-data-}"
        [[ "$owner" == "$name" ]] && owner=""
        if env_scoped_prune::_registered "$slug" "$slugs" || env_scoped_prune::_registered "$owner" "$slugs"; then
            env_scoped_prune::_decide volume "$name" keep "registered:${slug:-$owner}"
        else
            env_scoped_prune::_decide volume "$name" remove "unregistered:${slug:-$owner}" docker volume rm "$name"
        fi
    done <<<"$listing"
}

# Dangling rl.role=env images.
env_scoped_prune::_images() {
    local image_ids="$1" listing id
    listing=$(docker images --no-trunc --filter dangling=true --filter label=rl.role=env \
        --format '{{.ID}}' 2>/dev/null) \
        || { _ESP_ERRORS+=("images_unreadable"); return 0; }
    while read -r id; do
        [[ -z "$id" ]] && continue
        if [[ "$image_ids" == *" $id "* ]]; then
            env_scoped_prune::_decide image "$id" keep "registered_image"
        else
            env_scoped_prune::_decide image "$id" remove "dangling" docker image rm "$id"
        fi
    done <<<"$listing"
}

# Emit the JSON summary from the _ESP_* arrays.
env_scoped_prune::_summary() {
    local dry="${RL_ENV_SCOPED_PRUNE_DRY_RUN:-0}"
    jq -nc --argjson dry "$([[ "$dry" == 1 ]] && echo true || echo false)" \
        --argjson removed "$(printf '%s\n' "${_ESP_REMOVED[@]+"${_ESP_REMOVED[@]}"}" | jq -sc 'map(select(. != null))')" \
        --argjson would "$(printf '%s\n' "${_ESP_WOULD[@]+"${_ESP_WOULD[@]}"}" | jq -sc 'map(select(. != null))')" \
        --argjson kept "$(printf '%s\n' "${_ESP_KEPT[@]+"${_ESP_KEPT[@]}"}" | jq -sc 'map(select(. != null))')" \
        --argjson failed "$(printf '%s\n' "${_ESP_FAILED[@]+"${_ESP_FAILED[@]}"}" | jq -sc 'map(select(. != null))')" \
        --arg errors "${_ESP_ERRORS[*]+"${_ESP_ERRORS[*]}"}" \
        '{dry_run:$dry, removed:$removed, would_remove:$would, kept:$kept, failed:$failed}
         + (if $errors == "" then {} else {error:($errors | split(" ") | join(","))} end)'
}

# Entry point — see the header.
env_scoped_prune::run() {
    local envs="$1" slugs image_ids
    _ESP_REMOVED=(); _ESP_WOULD=(); _ESP_KEPT=(); _ESP_FAILED=(); _ESP_ERRORS=()
    if ! slugs=$(env_scoped_prune::registered_slugs "$envs"); then
        jq -nc '{error:"env_registry_unreadable", removed:[], kept:[]}'
        return 0
    fi
    image_ids=$(env_scoped_prune::registered_image_ids "$envs")
    env_scoped_prune::_containers "$slugs"
    env_scoped_prune::_volumes "$slugs"
    env_scoped_prune::_images "$image_ids"
    env_scoped_prune::_summary
    return 0
}
