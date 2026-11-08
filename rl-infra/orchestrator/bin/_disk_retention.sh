#!/usr/bin/env bash
# ROK-2111 lane 2 — interval disk retention (gc-sweeper step 3a).
#
# The ROK-1568 ladder only fires at >= RL_DISK_PRUNE_PCT; between alarms the
# host silted up with stopped containers, unused images and runner /tmp + npm
# caches. disk_retention::sweep runs three rungs every
# RL_DISK_RETENTION_INTERVAL_HOURS regardless of used%:
#   containers  stopped (exited/created/dead) and created > MAX_CONTAINER_AGE
#               ago. NEVER rl.role=env|runner|infra (a preserved env's stopped
#               container) and NEVER the compose project RL_DISK_RETENTION_COMPOSE_PROJECT.
#               Filtered in jq, not with `--filter label!=…`: the daemon ANDs
#               repeated label! filters (a container is spared only when it
#               carries ALL of them), which would reap a stopped env container.
#   images      created > MAX_IMAGE_AGE ago and not used by ANY container
#               (running or stopped), not referenced by an env-registry row's
#               .image, not labelled rl.role=runner, not tagged rl-infra/*
#               (locally built compose images). Removed by tag (else id),
#               never -f, so the daemon also refuses an image still in use.
#   runners     only a runner with no claim, no running task and no admission
#               entry: `find /tmp -mmin +60 -delete` + `npm cache clean`.
#               NEVER /root/.cache (Playwright browsers live there).
# Every rung is bounded by `timeout`, logs what it reclaimed to stderr and
# never fails the caller: sweep always prints one JSON object and returns 0.
#
# Env knobs:
#   RL_DISK_RETENTION_DRY_RUN             1    list candidates, remove nothing
#   RL_DISK_RETENTION_INTERVAL_HOURS      6    0 = every sweeper cycle
#   RL_DISK_RETENTION_CONTAINER_AGE_HOURS 24
#   RL_DISK_RETENTION_IMAGE_AGE_HOURS     48
#   RL_DISK_RETENTION_TMP_AGE_MINUTES     60
#   RL_DISK_RETENTION_COMPOSE_PROJECT     rl-infra
#   RL_DISK_RETENTION_TIMEOUT_SECONDS     300  per docker call
#   RL_DISK_RETENTION_STATE_FILE          $STATE_DIR/disk-retention.json

RL_DISK_RETENTION_DRY_RUN="${RL_DISK_RETENTION_DRY_RUN:-1}"
RL_DISK_RETENTION_INTERVAL_HOURS="${RL_DISK_RETENTION_INTERVAL_HOURS:-6}"
RL_DISK_RETENTION_CONTAINER_AGE_HOURS="${RL_DISK_RETENTION_CONTAINER_AGE_HOURS:-24}"
RL_DISK_RETENTION_IMAGE_AGE_HOURS="${RL_DISK_RETENTION_IMAGE_AGE_HOURS:-48}"
RL_DISK_RETENTION_TMP_AGE_MINUTES="${RL_DISK_RETENTION_TMP_AGE_MINUTES:-60}"
RL_DISK_RETENTION_COMPOSE_PROJECT="${RL_DISK_RETENTION_COMPOSE_PROJECT:-rl-infra}"
RL_DISK_RETENTION_TIMEOUT_SECONDS="${RL_DISK_RETENTION_TIMEOUT_SECONDS:-300}"

disk_retention::_state_dir() { echo "${RL_STATE_DIR:-${STATE_DIR:-/state}}"; }
disk_retention::_log() { echo "disk-retention: $*" >&2; }

# docker bounded by `timeout` when the host has one (BusyBox/coreutils).
disk_retention::_docker() {
    local t; t=$(command -v timeout 2>/dev/null || true)
    if [[ -n "$t" ]]; then "$t" "$RL_DISK_RETENTION_TIMEOUT_SECONDS" docker "$@"; else docker "$@"; fi
}

# Epoch cutoff for "older than $1 hours".
disk_retention::_cutoff() { echo $(( $(date +%s) - $1 * 3600 )); }

# jq helper: Docker RFC3339 (with nanoseconds) → epoch; unparsable = now (kept).
DISK_RETENTION_JQ_EPOCH='def ep: (try (sub("\\.[0-9]+"; "") | sub("Z$"; "") | strptime("%Y-%m-%dT%H:%M:%S") | mktime) catch now);'

# All containers (any state), inspected once. Echoes a JSON array; rc 1 on failure.
disk_retention::_containers() {
    local ids
    ids=$(disk_retention::_docker ps -aq --no-trunc 2>/dev/null) || return 1
    [[ -z "$ids" ]] && { echo '[]'; return 0; }
    # shellcheck disable=SC2086
    disk_retention::_docker container inspect --size $ids 2>/dev/null | jq -ce 'arrays' 2>/dev/null
}

# Rung 1 — stopped containers. Args: containers JSON. Echoes the rung record.
disk_retention::_container_rung() {
    local cj="$1" cut doomed ids
    cut=$(disk_retention::_cutoff "$RL_DISK_RETENTION_CONTAINER_AGE_HOURS")
    doomed=$(jq -c --argjson cut "$cut" --arg proj "$RL_DISK_RETENTION_COMPOSE_PROJECT" "$DISK_RETENTION_JQ_EPOCH"'
        [ .[] | select((.State.Status // "") | IN("exited", "created", "dead"))
          | select((.Created // "" | ep) < $cut)
          | (.Config.Labels // {}) as $l
          | select(($l["rl.role"] // "") | IN("env", "runner", "infra") | not)
          | select(($l["com.docker.compose.project"] // "") != $proj) ]' <<<"$cj") || return 1
    ids=$(jq -r '[.[].Id] | join(" ")' <<<"$doomed")
    if [[ -n "$ids" && "$RL_DISK_RETENTION_DRY_RUN" != "1" ]]; then
        # shellcheck disable=SC2086
        disk_retention::_docker container rm $ids >/dev/null 2>&1 || disk_retention::_log "container rm reported an error (partial removal possible)"
    fi
    disk_retention::_record "$doomed" SizeRw
}

# Rung record from the doomed list. Args: doomed JSON, size field.
disk_retention::_record() {
    jq -c --arg dry "$RL_DISK_RETENTION_DRY_RUN" --arg f "$2" '
        {candidates:[.[].Id], removed:(if $dry == "1" then 0 else length end),
         bytes:(if $dry == "1" then 0 else (map(.[$f] // 0) | add // 0) end)}' <<<"$1"
}

# Every image ref/id that must survive: container image ids + refs, env rows.
disk_retention::_protected_refs() {
    local cj="$1" envs="${RL_ENVS_FILE:-$(disk_retention::_state_dir)/env-registry.json}" rows='[]'
    if [[ -r "$envs" ]]; then rows=$(jq -c '[.[]? | .image? // empty]' "$envs" 2>/dev/null) || return 1; fi
    jq -c --argjson rows "$rows" '[.[] | .Image, .Config.Image] + $rows | map(select(. != null))' <<<"$cj"
}

# Rung 2 — unused images. Args: containers JSON. Echoes the rung record.
disk_retention::_image_rung() {
    local cj="$1" ids ij prot cut doomed targets
    prot=$(disk_retention::_protected_refs "$cj") || return 1
    ids=$(disk_retention::_docker image ls -q --no-trunc 2>/dev/null) || return 1
    [[ -z "$ids" ]] && { echo '{"candidates":[],"removed":0,"bytes":0}'; return 0; }
    # shellcheck disable=SC2086
    ij=$(disk_retention::_docker image inspect $(sort -u <<<"$ids") 2>/dev/null | jq -ce 'arrays' 2>/dev/null) || return 1
    cut=$(disk_retention::_cutoff "$RL_DISK_RETENTION_IMAGE_AGE_HOURS")
    doomed=$(jq -c --argjson cut "$cut" --argjson prot "$prot" "$DISK_RETENTION_JQ_EPOCH"'
        [ .[] | select((.Created // "" | ep) < $cut)
          | select(((.Config.Labels // {})["rl.role"] // "") != "runner")
          | select(([.Id] + (.RepoTags // [])) as $refs | ($refs - $prot | length) == ($refs | length))
          | select((.RepoTags // []) | any(startswith("rl-infra/")) | not) ]' <<<"$ij") || return 1
    targets=$(jq -r '[.[] | if ((.RepoTags // []) | length) > 0 then .RepoTags[] else .Id end] | join(" ")' <<<"$doomed")
    if [[ -n "$targets" && "$RL_DISK_RETENTION_DRY_RUN" != "1" ]]; then
        # shellcheck disable=SC2086
        disk_retention::_docker image rm $targets >/dev/null 2>&1 || disk_retention::_log "image rm reported an error (an image in use is refused by the daemon)"
    fi
    disk_retention::_record "$doomed" Size
}

# 0 when slot $1 is busy: claimed, a running task on it, or an admission-ledger
# entry (running or waiting) whose own .slot or task JSON names it. An
# unreadable claims file or ledger counts as busy — a skipped clean is cheap.
disk_retention::_slot_busy() {
    local slot="$1" sd tasks claims ledger t
    sd=$(disk_retention::_state_dir); tasks="${TASKS_DIR:-$sd/tasks}"
    claims="${RL_CLAIMS_FILE:-$sd/claims.json}"; ledger="${RL_ADMISSION_FILE:-$sd/admission.json}"
    jq -e --argjson s "$slot" 'any(.[]?; .slot == $s and .claimed == true) | not' "$claims" >/dev/null 2>&1 || return 0
    [[ -r "$ledger" ]] || return 0
    for t in "$tasks"/*.json; do
        [[ -f "$t" ]] || continue
        jq -e --argjson s "$slot" '.status == "running" and .slot == $s' "$t" >/dev/null 2>&1 && return 0
    done
    while IFS=$'\t' read -r key eslot; do
        [[ -z "$key$eslot" ]] && continue
        [[ "$eslot" == "$slot" ]] && return 0
        [[ -f "$tasks/$key.json" ]] && jq -e --argjson s "$slot" '.slot == $s' "$tasks/$key.json" >/dev/null 2>&1 && return 0
    done < <(jq -r '((.heavy_running // [])[], (.waiting // [])[]) | [(.key // ""), ((.slot // "") | tostring)] | @tsv' "$ledger" 2>/dev/null || echo "?	?")
    return 1
}

# Echoes "<KB before> <KB after>" from inside the runner. /root/.cache is
# deliberately absent: Playwright's browsers live there.
disk_retention::_runner_script() {
    local m="$RL_DISK_RETENTION_TMP_AGE_MINUTES"
    printf '%s' "du_kb() { du -sk /tmp \"\$(npm config get cache 2>/dev/null || echo /root/.npm)\" 2>/dev/null | awk '{s+=\$1} END {print s+0}'; }; b=\$(du_kb); find /tmp -xdev -mindepth 1 -mmin +$m -delete 2>/dev/null; npm cache clean --force >/dev/null 2>&1; echo \"\$b \$(du_kb)\""
}

# Rung 3 — idle-runner caches. Echoes {idle, busy, cleaned, bytes}.
disk_retention::_runner_rung() {
    local names n slot idle=() busy=() cleaned=() bytes=0 out b a
    names=$(disk_retention::_docker ps --filter label=rl.role=runner --format '{{.Names}}' 2>/dev/null) || return 1
    for n in $names; do
        [[ "$n" =~ ^rl-runner-([0-9]+)$ ]] || continue
        slot="${BASH_REMATCH[1]}"
        if disk_retention::_slot_busy "$slot"; then busy+=("$slot"); continue; fi
        idle+=("$slot")
        [[ "$RL_DISK_RETENTION_DRY_RUN" == "1" ]] && continue
        # Re-check right before the exec: a claim may have landed meanwhile.
        disk_retention::_slot_busy "$slot" && continue
        out=$(disk_retention::_docker exec "$n" sh -c "$(disk_retention::_runner_script)" 2>/dev/null) || { disk_retention::_log "runner $n clean failed"; continue; }
        cleaned+=("$slot")
        read -r b a <<<"$out"
        [[ "${b:-}" =~ ^[0-9]+$ && "${a:-}" =~ ^[0-9]+$ ]] && (( b > a )) && bytes=$(( bytes + (b - a) * 1024 ))
    done
    jq -nc --arg i "${idle[*]:-}" --arg b "${busy[*]:-}" --arg c "${cleaned[*]:-}" --argjson by "$bytes" '
        def nums: split(" ") | map(select(length > 0) | tonumber) | sort;
        {idle:($i|nums), busy:($b|nums), cleaned:($c|nums), bytes:$by}'
}

# 0 when the last run is younger than the interval.
disk_retention::_within_interval() {
    local f="$1" last
    (( RL_DISK_RETENTION_INTERVAL_HOURS > 0 )) || return 1
    last=$(jq -r '.last_run_epoch // 0' "$f" 2>/dev/null || echo 0)
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    (( $(date +%s) - last < RL_DISK_RETENTION_INTERVAL_HOURS * 3600 ))
}

# Run one rung; a failure becomes {error:"<rung>_failed"}, never a non-zero rc.
disk_retention::_rung() {
    local name="$1" out; shift
    out=$("$@") && [[ -n "$out" ]] || out=$(jq -nc --arg n "$name" '{error:($n + "_failed")}')
    disk_retention::_log "$name: $(jq -rc '"removed=" + ((.removed // .cleaned // [] | if type == "array" then length else . end)|tostring) + " bytes=" + ((.bytes // 0)|tostring) + (if .error then " error=" + .error else "" end)' <<<"$out" 2>/dev/null)"
    echo "$out"
}

# Entry point. Prints one JSON summary; always returns 0.
disk_retention::sweep() {
    local sf="${RL_DISK_RETENTION_STATE_FILE:-$(disk_retention::_state_dir)/disk-retention.json}" cj c i r out
    if disk_retention::_within_interval "$sf"; then echo '{"skipped":"interval"}'; return 0; fi
    if cj=$(disk_retention::_containers); then
        c=$(disk_retention::_rung containers disk_retention::_container_rung "$cj")
        i=$(disk_retention::_rung images disk_retention::_image_rung "$cj")
    else
        c='{"error":"containers_unreadable"}'; i='{"error":"containers_unreadable"}'
        disk_retention::_log "docker ps/inspect unreadable — container and image rungs skipped"
    fi
    r=$(disk_retention::_rung runners disk_retention::_runner_rung)
    out=$(jq -nc --argjson c "$c" --argjson i "$i" --argjson r "$r" --argjson t "$(date +%s)" \
        --arg dry "$RL_DISK_RETENTION_DRY_RUN" '{dry_run:($dry == "1"), last_run_epoch:$t, containers:$c, images:$i, runners:$r}' 2>/dev/null) \
        || out='{"error":"summary_failed"}'
    [[ -d "$(dirname "$sf")" ]] && { echo "$out" > "$sf.tmp.$$" && mv -f "$sf.tmp.$$" "$sf"; } 2>/dev/null
    echo "$out"
    return 0
}
