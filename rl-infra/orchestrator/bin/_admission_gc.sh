#!/usr/bin/env bash
# Sourced by _admission.sh (needs its _ADMISSION_JQ_DEFS and state::mutate*).
# No side effects beyond the knob default below.

# ROK-2018 — registry GC admission. `registry garbage-collect` marks blobs and
# then sweeps the unmarked ones; a push landing in that window can lose a layer,
# and image builds are the only pushers. So a GC run holds a `registry_gc` entry
# in THIS ledger, taken under the same flock as a build's admit: the ledger
# refuses an image build while a live GC entry exists (`registry_gc_running`),
# and a GC is admitted only when no image build is running OR waiting (GC
# yields; it is never urgent enough to starve a build). The entry reserves 0 MB
# and counts toward no cap or budget (GC is I/O, not memory).
#
# The holder is the gc-sweeper container, whose pid prune_dead cannot see from
# the orchestrator host, so the entry carries `expires_epoch` (now +
# RL_REGISTRY_GC_TIMEOUT_SECONDS + RL_REGISTRY_GC_EXPIRY_GRACE_SECONDS). Past it
# the ledger ignores the entry and prune_stale drops it: a sweeper killed
# mid-GC blocks builds for at most that long. The sweep calls gc_renew before
# every tag it processes and before garbage-collect, and stops when it fails.
RL_REGISTRY_GC_EXPIRY_GRACE_SECONDS="${RL_REGISTRY_GC_EXPIRY_GRACE_SECONDS:-120}"

admission::_gc_ttl() { echo $(( ${RL_REGISTRY_GC_TIMEOUT_SECONDS:-1800} + RL_REGISTRY_GC_EXPIRY_GRACE_SECONDS )); }

admission::_gc_held() {
    jq -e --arg k "$1" 'any((.heavy_running // [])[]; .key == $k and .kind == "registry_gc")' \
        "$RL_ADMISSION_FILE" >/dev/null 2>&1
}

# admission::gc_try_acquire <key> [pid] — non-blocking. 0 = admitted (entry
# written); 1 = refused, the reason on stdout (image_build_running,
# image_build_waiting, registry_gc_running, or admission_unreadable — an
# unreadable ledger is treated as busy: GC is the side that must not race).
admission::gc_try_acquire() {
    local key="$1" pid="${2:-$$}" now ts host reason
    # ledger_reason (in the shared defs) references these knobs: always bind them.
    local -a jargs=(--argjson floor "$RL_HEAVY_TASK_MIN_FREE_MB" --argjson budget 0
        --argjson maxheavy "$RL_MAX_HEAVY_CONCURRENT" --argjson maxbuilds "$RL_MAX_IMAGE_BUILDS")
    admission::ensure_file
    now=$(date +%s); ts=$(date -u +%FT%TZ); host="$(hostname 2>/dev/null || echo unknown)"
    state::mutate_with_precondition "$RL_ADMISSION_FILE" "${jargs[@]}" \
        --arg k "$key" --arg ts "$ts" --arg host "$host" --arg pid "$pid" \
        --argjson now "$now" --argjson exp "$(( now + $(admission::_gc_ttl) ))" \
        "$_ADMISSION_JQ_DEFS"'
        if gc_reason($now) == ""
        then .heavy_running = (ents + [{key: $k, task_id: $k, admitted_at: $ts, admitted_epoch: $now,
                 mb: 0, weight: "light", kind: "registry_gc", reserve_mb: 0, expires_epoch: $exp,
                 pid: ($pid | tonumber? // null), host: $host}])
        else . end' 2>/dev/null
    # Ours only if THIS call wrote it: a same-key entry of a still-live earlier
    # sweep must read as registry_gc_running, not as our admission.
    jq -e --arg k "$key" --arg pid "$pid" --arg host "$host" --argjson now "$now" \
        'any((.heavy_running // [])[]; .key == $k and .kind == "registry_gc"
             and (.pid | tostring) == $pid and .host == $host and .admitted_epoch == $now)' \
        "$RL_ADMISSION_FILE" >/dev/null 2>&1 && return 0
    reason=$(jq -r "${jargs[@]}" --argjson now "$now" "$_ADMISSION_JQ_DEFS"'gc_reason($now)' \
        "$RL_ADMISSION_FILE" 2>/dev/null)
    echo "${reason:-admission_unreadable}"
    return 1
}

# admission::gc_renew <key> — re-arm the entry's expiry, atomically and only
# while it is still ours to hold: present, NOT yet expired, and no image build
# admitted (an expired entry is invisible to the ledger, so a waiting build may
# already have been admitted past it — reviving it would let garbage-collect
# race that build's push). 1 = lost: the caller must stop, not garbage-collect.
admission::gc_renew() {
    local key="$1" now exp
    now=$(date +%s); exp=$(( now + $(admission::_gc_ttl) ))
    local -a jargs=(--arg k "$key" --argjson now "$now" --argjson exp "$exp" --argjson floor 0
        --argjson budget 0 --argjson maxheavy 0 --argjson maxbuilds 0)
    local held='def held: build_n == 0 and any(ents[]; .key == $k and kd == "registry_gc" and (.expires_epoch // 0)'
    state::mutate "$RL_ADMISSION_FILE" "${jargs[@]}" "$_ADMISSION_JQ_DEFS$held"' > $now);
        if held then .heavy_running = [ents[] | if .key == $k and kd == "registry_gc"
            then .expires_epoch = ([.expires_epoch, $exp] | max) else . end] else . end' 2>/dev/null
    jq -e "${jargs[@]}" "$_ADMISSION_JQ_DEFS$held"' >= $exp); held' "$RL_ADMISSION_FILE" >/dev/null 2>&1
}

# admission::hold_image_build <tag> — a build started outside task-start
# (direct CLI) holds no ledger entry, so nothing keeps its `docker push` out of
# a registry GC. Take an image_build entry (it waits on registry_gc_running)
# and release it on exit. No-op when task-start already holds one. 1 = not
# admitted (the caller exits 75).
admission::hold_image_build() {
    [[ -n "${RL_ADMISSION_HELD:-}" ]] && return 0
    BUILD_ADM_KEY="build-${1}-$$"
    admission::acquire "$BUILD_ADM_KEY" "$BUILD_ADM_KEY" "" "" \
        "$(admission::need_mb_for medium)" medium image_build || return 1
    trap 'admission::release "$BUILD_ADM_KEY"' EXIT
    export RL_ADMISSION_HELD="$BUILD_ADM_KEY"
}
