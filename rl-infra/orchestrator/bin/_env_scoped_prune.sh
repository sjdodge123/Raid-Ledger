#!/usr/bin/env bash
# ROK-2181 — gc-sweeper step 3, the scoped `rl.role=env` prune.
#
# The step used to be three blanket calls every cycle:
#     docker {image,volume,container} prune -f --filter label=rl.role=env
# with no look at env-registry, so a PRESERVED env (rl_release keeps envs by
# default and marks the row claimable_by_next) or a PINNED env (rl_env_pin sets
# the row's .pinned) lost its stopped containers.
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
#   volumes     dangling, ANONYMOUS rl.role=env volumes only. Named volumes
#               (rl-data-<slug>) are never removed here: on Engine >= 23 the old
#               `docker volume prune` without --all only removed anonymous
#               volumes (see _disk_pressure.sh), so deleting a named env DB
#               would be new behaviour resting on the registry being complete.
#               env-destroy owns rl-data-<slug> removal.
#   images      not handled. Env images carry no rl.role=env label
#               (build-image-on-runner labels only rl.synced_head), so the old
#               image prune matched nothing; the ROK-2171 image GC owns them.
#
# Spin-race grace: env-spin writes the registry row only after it created the
# rl-data volume and ran both containers, so any removal candidate younger than
# RL_ENV_SCOPED_PRUNE_MIN_AGE_MIN minutes (default 30, from `docker inspect`)
# — or whose creation time cannot be read — is kept as "too_young".
#
# Fail safe: an env registry that is missing, empty, unreadable or not a JSON
# array prunes NOTHING this cycle (`error:"env_registry_unreadable"`) — never a
# fallback to the blanket prune. A listing that fails skips only that kind.
# RL_ENV_SCOPED_PRUNE_DRY_RUN=1 lists `would_remove` and removes nothing
# (default 0: this step always pruned).
#
# Usage (sourced): env_scoped_prune::run <env-registry.json>
#   stdout: one JSON summary {dry_run, removed, would_remove, kept, failed, error?}
#   rc:     always 0 — a sweeper cycle is never lost to this step.
# env_scoped_prune::needs_audit <summary-json> → rc 0 when sweep.sh should audit.

# Space-padded list of registered slugs (" a b "), or rc 1 when the registry
# is not exactly one readable JSON array. Slurp mode so an EMPTY file is an
# error on every jq version (jq 1.6 `-e` exits 0 when it produced no output).
env_scoped_prune::registered_slugs() {
    local envs="$1" slugs
    slugs=$(jq -sr 'if length == 1 and (.[0] | type) == "array"
                    then [.[0][] | .slug // empty | tostring] | join(" ")
                    else error("not one array") end' "$envs" 2>/dev/null) || return 1
    printf ' %s ' "$slugs"
}

# rc 0 when slug $1 is in the padded list $2.
env_scoped_prune::_registered() {
    [[ -n "$1" && "$2" == *" $1 "* ]]
}

# rc 0 when RFC3339 timestamp $1 is at least the min age old. An unparseable
# or empty timestamp is treated as young (keep).
env_scoped_prune::_old_enough() {
    local created="$1" min_s
    min_s=$(( ${RL_ENV_SCOPED_PRUNE_MIN_AGE_MIN:-30} * 60 ))
    [[ "$(jq -rn --arg c "$created" --argjson now "$(date +%s)" --argjson min "$min_s" '
        ($c | capture("^(?<b>[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2})(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:[0-9]{2})$"))
        | ((.b + "Z") | fromdateiso8601)
          - (if .z == "Z" then 0
             else ((.z[1:3] | tonumber) * 3600 + (.z[4:6] | tonumber) * 60) * (if .z[0:1] == "+" then 1 else -1 end) end)
        | ($now - .) >= $min' 2>/dev/null)" == "true" ]]
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
        elif ! env_scoped_prune::_old_enough "$(docker inspect --format '{{.Created}}' "$id" 2>/dev/null)"; then
            env_scoped_prune::_decide container "$id" keep "too_young"
        else
            env_scoped_prune::_decide container "$id" remove "unregistered:${slug:-$owner}" docker rm "$id"
        fi
    done <<<"$listing"
}

# Dangling, anonymous (64-hex name) rl.role=env volumes.
env_scoped_prune::_volumes() {
    local slugs="$1" listing name slug
    listing=$(docker volume ls --filter label=rl.role=env --filter dangling=true \
        --format '{{.Name}}|{{.Label "rl.env_slug"}}' 2>/dev/null) \
        || { _ESP_ERRORS+=("volumes_unreadable"); return 0; }
    while IFS='|' read -r name slug; do
        [[ -z "$name" ]] && continue
        if ! [[ "$name" =~ ^[0-9a-f]{64}$ ]]; then
            env_scoped_prune::_decide volume "$name" keep "named_volume"
        elif env_scoped_prune::_registered "$slug" "$slugs"; then
            env_scoped_prune::_decide volume "$name" keep "registered:$slug"
        elif ! env_scoped_prune::_old_enough "$(docker volume inspect --format '{{.CreatedAt}}' "$name" 2>/dev/null)"; then
            env_scoped_prune::_decide volume "$name" keep "too_young"
        else
            env_scoped_prune::_decide volume "$name" remove "unregistered:$slug" docker volume rm "$name"
        fi
    done <<<"$listing"
}

# JSON array from the entries given as arguments (none → []).
env_scoped_prune::_json_list() {
    printf '%s\n' "$@" | jq -sc 'map(select(. != null))'
}

# Emit the JSON summary from the _ESP_* arrays.
env_scoped_prune::_summary() {
    jq -nc --argjson dry "$([[ "${RL_ENV_SCOPED_PRUNE_DRY_RUN:-0}" == 1 ]] && echo true || echo false)" \
        --argjson removed "$(env_scoped_prune::_json_list "${_ESP_REMOVED[@]+"${_ESP_REMOVED[@]}"}")" \
        --argjson would "$(env_scoped_prune::_json_list "${_ESP_WOULD[@]+"${_ESP_WOULD[@]}"}")" \
        --argjson kept "$(env_scoped_prune::_json_list "${_ESP_KEPT[@]+"${_ESP_KEPT[@]}"}")" \
        --argjson failed "$(env_scoped_prune::_json_list "${_ESP_FAILED[@]+"${_ESP_FAILED[@]}"}")" \
        --arg errors "${_ESP_ERRORS[*]+"${_ESP_ERRORS[*]}"}" \
        '{dry_run:$dry, removed:$removed, would_remove:$would, kept:$kept, failed:$failed}
         + (if $errors == "" then {} else {error:($errors | split(" ") | join(","))} end)'
}

# rc 0 when summary $1 is worth an audit row: something removed / would be
# removed / failed, or an error (unreadable registry or listing). A clean run
# and unparseable input are rc 1. Parenthesised so `has("error")` runs on the
# object, never on the merged array (the review-round bug).
env_scoped_prune::needs_audit() {
    [[ "$(jq -r 'type == "object" and
        (((([(.removed // []), (.would_remove // []), (.failed // [])] | add) | length) > 0) or has("error"))' \
        <<<"$1" 2>/dev/null)" == "true" ]]
}

# Entry point — see the header.
env_scoped_prune::run() {
    local envs="$1" slugs
    _ESP_REMOVED=(); _ESP_WOULD=(); _ESP_KEPT=(); _ESP_FAILED=(); _ESP_ERRORS=()
    if ! slugs=$(env_scoped_prune::registered_slugs "$envs"); then
        jq -nc '{error:"env_registry_unreadable", removed:[], kept:[]}'
        return 0
    fi
    env_scoped_prune::_containers "$slugs"
    env_scoped_prune::_volumes "$slugs"
    env_scoped_prune::_summary
    return 0
}
