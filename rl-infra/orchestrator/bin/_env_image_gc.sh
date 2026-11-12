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
#   - its newest of Created and Metadata.LastTagTime (a cached rebuild keeps an
#     old Created but re-tags) is older than RL_ENV_IMAGE_GC_MIN_AGE_HOURS, so
#     a freshly built image is not removed before its env is spun; an
#     unparseable age keeps it;
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
# dangling_prune). A spin racing the removal re-pulls on `docker run`.
#
# Env knobs:
#   RL_ENV_IMAGE_GC_REPO              registry.rl.lan:5000/rl-allinone
#   RL_ENV_IMAGE_GC_MIN_AGE_HOURS     2    age floor
#   RL_ENV_IMAGE_GC_DRY_RUN           1    report only; 0 = remove
#   RL_ENV_IMAGE_GC_TIMEOUT_SECONDS   600  ledger-entry lifetime (renewed per image)
#   RL_ENV_IMAGE_GC_RM_TIMEOUT_SECONDS 120 bound on one `docker image rm`
#   RL_ENV_IMAGE_GC_KEY               env-image-gc

RL_ENV_IMAGE_GC_REPO="${RL_ENV_IMAGE_GC_REPO:-registry.rl.lan:5000/rl-allinone}"
RL_ENV_IMAGE_GC_MIN_AGE_HOURS="${RL_ENV_IMAGE_GC_MIN_AGE_HOURS:-2}"
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

# Every env row's .image, one per line; 1 when unreadable or not an array.
env_image_gc::_rows() {
    jq -r 'if type == "array" then .[] | .image // empty else error("not an array") end' \
        "$RL_ENVS_FILE" 2>/dev/null
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
        echo "an env uses tag $tag"; return 0
    fi
    grep -qxF "$ref" <<<"$rows" && { echo "an env uses $ref"; return 0; }
    info=$(env_image_gc::_inspect "$ref"); rc=$?
    (( rc == 1 )) && { echo absent; return 0; }
    (( rc != 0 )) && { echo "docker image inspect failed: $info"; return 0; }
    IFS='|' read -r id role age <<<"$info"
    [[ "$role" == "runner" ]] && { echo "labelled rl.role=runner"; return 0; }
    [[ "$age" =~ ^-?[0-9]+$ ]] || { echo "age unknown"; return 0; }
    (( now - age < RL_ENV_IMAGE_GC_MIN_AGE_HOURS * 3600 )) \
        && { echo "younger than ${RL_ENV_IMAGE_GC_MIN_AGE_HOURS}h"; return 0; }
    why=$(env_image_gc::_digest_keep "$id" "$rows")
    [[ -n "$why" ]] && { echo "$why"; return 0; }
    users=$(docker ps -aq --filter "ancestor=$id" 2>/dev/null) || { echo "docker ps unreadable"; return 0; }
    [[ -n "$users" ]] && { echo "$(grep -c . <<<"$users") container(s) use it"; return 0; }
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

# The removal pass, run while the ledger entry is held. Re-reads the env rows
# and re-checks each candidate; stops (lock_lost) once a renewal fails.
env_image_gc::_remove_held() {
    local now="$1"; shift
    local rows ref why err removed="" kept="" failed="" stop=""
    rows=$(env_image_gc::_rows) || { echo '{"error":"env_registry_unreadable","removed":[]}'; return 1; }
    for ref in "$@"; do
        if ! env_image_gc::_renew; then stop=lock_lost; break; fi
        why=$(env_image_gc::_keep_reason "$ref" "$rows" "$now")
        [[ "$why" == absent ]] && continue
        if [[ -n "$why" ]]; then kept+="$ref"$'\t'"$why"$'\n'; continue; fi
        if err=$(timeout "$RL_ENV_IMAGE_GC_RM_TIMEOUT_SECONDS" docker image rm "$ref" 2>&1 >/dev/null); then
            removed+="$ref"$'\n'; env_image_gc::_log "removed $ref"
        else
            failed+="$ref"$'\t'"${err//$'\n'/ }"$'\n'; env_image_gc::_log "rm failed $ref: ${err//$'\n'/ }"
        fi
    done
    jq -nc --argjson r "$(env_image_gc::_json <<<"$removed")" --argjson k "$(env_image_gc::_json <<<"$kept")" \
        --argjson f "$(env_image_gc::_json <<<"$failed")" --arg s "$stop" \
        '{removed: $r, kept: $k, failed: $f} + (if $s == "" then {} else {stopped: $s} end)'
}

# env_image_gc::sweep — echoes a JSON summary; always returns 0. `idle:true`
# means there was nothing to remove and no reservation was taken.
env_image_gc::sweep() {
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
    echo "$out"
    return 0
}
