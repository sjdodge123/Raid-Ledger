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
#               .image (by tag OR repo@digest), not labelled rl.role=runner,
#               not tagged rl-infra/* (locally built compose images), not a
#               base image the Dockerfiles build FROM (KEEP_IMAGE_PREFIXES).
#               Skipped while the admission ledger holds any task or build
#               (a build may be about to use an old base). Removed by tag
#               (else id), never -f, so the daemon also refuses an image in use.
#               An unreadable env registry aborts the rung (fail closed).
#   runners     only a runner with no claim, no queued claimant, no running
#               task and no admission entry. The slot is RESERVED in
#               claims.json under the queue + claims flocks (as _borrow.sh
#               does), re-checked inside the lock, cleaned, then restored
#               from state/disk-retention-reserve-<slot>.json (an orphaned
#               reservation is restored by recover_orphans next cycle).
#               Clean = old REGULAR files + empty dirs under /tmp, never a
#               socket/fifo/device, never tmux-* (the runner's `main` tmux
#               session), never a *.sock/*.lock/*.pid/runner-heartbeat and
#               never a path a process holds open (/proc/*/fd, cwd) or
#               under a process's cwd below /tmp; plus
#               `npm cache clean`. NEVER /root/.cache (Playwright browsers).
# Every rung is bounded by `timeout`, logs what it reclaimed to stderr and
# never fails the caller: sweep always prints one JSON object and returns 0.
# Counts and bytes are successes only; failures land in .failed + .error.
# A dry run reports would_reclaim_bytes (containers, images) instead.
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
#   RL_DISK_RETENTION_KEEP_IMAGE_PREFIXES "node:22-alpine debian:bookworm-slim
#                                          nginx:alpine mcr.microsoft.com/playwright:"

RL_DISK_RETENTION_DRY_RUN="${RL_DISK_RETENTION_DRY_RUN:-1}"
RL_DISK_RETENTION_INTERVAL_HOURS="${RL_DISK_RETENTION_INTERVAL_HOURS:-6}"
RL_DISK_RETENTION_CONTAINER_AGE_HOURS="${RL_DISK_RETENTION_CONTAINER_AGE_HOURS:-24}"
RL_DISK_RETENTION_IMAGE_AGE_HOURS="${RL_DISK_RETENTION_IMAGE_AGE_HOURS:-48}"
RL_DISK_RETENTION_TMP_AGE_MINUTES="${RL_DISK_RETENTION_TMP_AGE_MINUTES:-60}"
RL_DISK_RETENTION_COMPOSE_PROJECT="${RL_DISK_RETENTION_COMPOSE_PROJECT:-rl-infra}"
RL_DISK_RETENTION_TIMEOUT_SECONDS="${RL_DISK_RETENTION_TIMEOUT_SECONDS:-300}"
RL_DISK_RETENTION_KEEP_IMAGE_PREFIXES="${RL_DISK_RETENTION_KEEP_IMAGE_PREFIXES:-node:22-alpine debian:bookworm-slim nginx:alpine mcr.microsoft.com/playwright:}"
DISK_RETENTION_AGENT_ID="gc-sweeper:disk-retention"

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

# Remove each doomed item on its own so a failure is attributed. Args: doomed
# JSON, kind (container|image). Echoes the JSON array of ids that were removed.
disk_retention::_remove_each() {
    local doomed="$1" kind="$2" id refs ok=()
    [[ "$RL_DISK_RETENTION_DRY_RUN" == "1" ]] && { echo '[]'; return 0; }
    while IFS=$'\t' read -r id refs; do
        [[ -z "$id" ]] && continue
        # shellcheck disable=SC2086
        if disk_retention::_docker "$kind" rm ${refs:-$id} >/dev/null 2>&1; then ok+=("$id")
        else disk_retention::_log "$kind rm ${refs:-$id} failed (in use, or the daemon refused)"; fi
    done < <(jq -r '.[] | [.Id, ((.RepoTags // []) | join(" "))] | @tsv' <<<"$doomed")
    printf '%s\n' "${ok[@]:-}" | jq -Rnc '[inputs | select(length > 0)]'
}

# Rung 1 — stopped containers. Args: containers JSON. Echoes the rung record.
disk_retention::_container_rung() {
    local cj="$1" cut doomed ok
    cut=$(disk_retention::_cutoff "$RL_DISK_RETENTION_CONTAINER_AGE_HOURS")
    doomed=$(jq -c --argjson cut "$cut" --arg proj "$RL_DISK_RETENTION_COMPOSE_PROJECT" "$DISK_RETENTION_JQ_EPOCH"'
        [ .[] | select((.State.Status // "") | IN("exited", "created", "dead"))
          | select((.Created // "" | ep) < $cut)
          | (.Config.Labels // {}) as $l
          | select(($l["rl.role"] // "") | IN("env", "runner", "infra") | not)
          | select(($l["com.docker.compose.project"] // "") != $proj)
          | del(.RepoTags) ]' <<<"$cj") || return 1
    ok=$(disk_retention::_remove_each "$doomed" container) || return 1
    disk_retention::_record "$doomed" SizeRw "$ok"
}

# Rung record. Args: doomed JSON, size field, removed-ids JSON. bytes/removed
# count successes only; would_reclaim_bytes is every candidate's size.
disk_retention::_record() {
    jq -c --arg dry "$RL_DISK_RETENTION_DRY_RUN" --arg f "$2" --argjson ok "$3" '
        (map(.[$f] // 0) | add // 0) as $all
        | [.[] | select(.Id as $i | $ok | index($i))] as $done
        | [.[].Id | select(. as $i | ($ok | index($i)) == null)] as $failed
        | {candidates:[.[].Id], removed:($done | length),
           bytes:($done | map(.[$f] // 0) | add // 0), would_reclaim_bytes:$all}
        + (if $dry != "1" and ($failed | length) > 0 then {failed:$failed, error:"remove_failed"} else {} end)' <<<"$1"
}

# Every image ref/id that must survive: container image ids + refs, env rows
# (plus their repo@digest form). rc 1 — the rung aborts — when the env
# registry is missing, unreadable or not an array: an empty set would let the
# rung delete a preserved env's image.
disk_retention::_protected_refs() {
    local cj="$1" envs="${RL_ENVS_FILE:-$(disk_retention::_state_dir)/env-registry.json}" rows
    rows=$(jq -ec 'if type == "array" then [.[] | .image? // empty] else error("not an array") end' "$envs" 2>/dev/null) || {
        disk_retention::_log "env registry $envs unreadable — image rung aborted"; return 1; }
    jq -c --argjson rows "$rows" '[.[] | .Image, .Config.Image] + $rows | map(select(type == "string"))
        | . + map(select(test("@sha256:")) | sub(":[^/@]*@"; "@")) | unique' <<<"$cj"
}

# 0 (busy) when the admission ledger holds any task or build — light weight
# included, registry_gc excluded — or cannot be read. Echoes the keys.
disk_retention::_ledger_busy() {
    local ledger="${RL_ADMISSION_FILE:-$(disk_retention::_state_dir)/admission.json}" keys
    keys=$(jq -er '
        if type != "object" then error("bad ledger") else . end
        | [ (.heavy_running // [])[] | select((.kind // "task") != "registry_gc") | (.key // "?") ] | join(" ")' \
        "$ledger" 2>/dev/null) || { echo "ledger_unreadable"; return 0; }
    [[ -n "$keys" ]] && { echo "$keys"; return 0; }
    return 1
}

# Rung 2 — unused images. Args: containers JSON. Echoes the rung record.
disk_retention::_image_rung() {
    local cj="$1" ids ij prot cut doomed ok busy
    if busy=$(disk_retention::_ledger_busy); then
        disk_retention::_log "image rung skipped — admission ledger busy: $busy"
        jq -nc --arg b "$busy" '{skipped:"build_running", blocked_by:($b | split(" ")), candidates:[], removed:0, bytes:0}'
        return 0
    fi
    prot=$(disk_retention::_protected_refs "$cj") || return 1
    ids=$(disk_retention::_docker image ls -q --no-trunc 2>/dev/null) || return 1
    [[ -z "$ids" ]] && { echo '{"candidates":[],"removed":0,"bytes":0,"would_reclaim_bytes":0}'; return 0; }
    # shellcheck disable=SC2046
    ij=$(disk_retention::_docker image inspect $(sort -u <<<"$ids") 2>/dev/null | jq -ce 'arrays' 2>/dev/null) || return 1
    cut=$(disk_retention::_cutoff "$RL_DISK_RETENTION_IMAGE_AGE_HOURS")
    doomed=$(jq -c --argjson cut "$cut" --argjson prot "$prot" --arg keep "$RL_DISK_RETENTION_KEEP_IMAGE_PREFIXES" "$DISK_RETENTION_JQ_EPOCH"'
        ($keep | split(" ") | map(select(length > 0))) as $kp
        | [ .[] | select((.Created // "" | ep) < $cut)
          | select(((.Config.Labels // {})["rl.role"] // "") != "runner")
          | select(([.Id] + (.RepoTags // []) + (.RepoDigests // [])) as $refs
                   | ($refs - $prot | length) == ($refs | length))
          | select((.RepoTags // []) | any(startswith("rl-infra/")) | not)
          | select((.RepoTags // []) | any(. as $t | $kp | any(. as $p | $t | startswith($p))) | not) ]' <<<"$ij") || return 1
    ok=$(disk_retention::_remove_each "$doomed" image) || return 1
    disk_retention::_record "$doomed" Size "$ok"
}

# 0 when slot $1 is busy: claimed, a claimant queued for it, a running task on
# it, or an admission-ledger entry (heavy_running / heavy_waiting, any weight
# except registry_gc) whose task (`$TASKS_DIR/<task_id>.json`, else <key>)
# runs on it. Fail-safe: an unreadable/malformed claims file or ledger, or a
# ledger entry whose slot cannot be resolved, counts as busy.
disk_retention::_slot_busy() {
    local slot="$1" sd tasks claims ledger queue t tid key tslot entries
    sd=$(disk_retention::_state_dir); tasks="${TASKS_DIR:-$sd/tasks}"
    claims="${RL_CLAIMS_FILE:-$sd/claims.json}"; ledger="${RL_ADMISSION_FILE:-$sd/admission.json}"
    queue="${LEASE_QUEUE_DIR:-$sd/lease-queue}/$slot.json"
    jq -e --argjson s "$slot" 'any(.[]?; .slot == $s and .claimed == true) | not' "$claims" >/dev/null 2>&1 || return 0
    if [[ -e "$queue" ]]; then jq -e 'length == 0' "$queue" >/dev/null 2>&1 || return 0; fi
    for t in "$tasks"/*.json; do
        [[ -f "$t" ]] || continue
        jq -e --argjson s "$slot" '.status == "running" and .slot == $s' "$t" >/dev/null 2>&1 && return 0
    done
    entries=$(jq -er 'if type != "object" then error("bad ledger") else . end
        | ((.heavy_running // []) + (.heavy_waiting // []))[]
        | select((.kind // "task") != "registry_gc") | [(.task_id // .key // ""), (.key // "")] | @tsv' \
        "$ledger" 2>/dev/null; echo "rc=$?") || return 0
    [[ "${entries##*rc=}" == "0" || "${entries##*rc=}" == "4" ]] || return 0   # 4 = jq -e with no output
    while IFS=$'\t' read -r tid key; do
        [[ "$tid" == rc=* || -z "$tid$key" ]] && continue
        tslot=""
        for t in "$tasks/$tid.json" "$tasks/$key.json"; do
            [[ -f "$t" ]] && { tslot=$(jq -r '.slot // empty' "$t" 2>/dev/null); break; }
        done
        [[ -z "$tslot" || "$tslot" == "$slot" ]] && return 0
    done <<<"$entries"
    return 1
}

# flock(1) or fail: the reservation is only safe under the real serializer.
disk_retention::_lock_dir() { echo "${RL_LOCK_DIR:-${LOCK_DIR:-$(disk_retention::_state_dir)/locks}}"; }

# Slot $1's original claims row, kept under the state dir (not $TMPDIR) so it
# survives a sweeper recreate/OOM/reboot for recover_orphans to restore.
disk_retention::_save_file() { echo "$(disk_retention::_state_dir)/disk-retention-reserve-$1.json"; }

# Reserve idle slot $1 (exit 0) the way _borrow.sh claims one: queue lock,
# then claims lock (the STRICT order in _state.sh); refuse when the slot is
# busy as seen INSIDE the locks; else persist the original row, then flip it
# to claimed by $DISK_RETENTION_AGENT_ID. Each lock waits at most 30 s
# (lease::advance can hold the queue lock through an env-destroy): refusing
# only means this runner is not cleaned this cycle.
disk_retention::_reserve() {
    local slot="$1" save sd claims ld qlock
    sd=$(disk_retention::_state_dir); claims="${RL_CLAIMS_FILE:-$sd/claims.json}"; ld=$(disk_retention::_lock_dir)
    save=$(disk_retention::_save_file "$slot")
    command -v flock >/dev/null 2>&1 || { disk_retention::_log "flock missing — runner rung refuses to reserve"; return 1; }
    mkdir -p "$ld" 2>/dev/null; qlock="$ld/$slot.json.lock"
    (
        flock -w 30 -x 201 || exit 1
        (
            flock -w 30 -x 200 || exit 1
            disk_retention::_slot_busy "$slot" && exit 1
            jq -ce --argjson s "$slot" 'first(.[] | select(.slot == $s and .claimed != true))' "$claims" > "$save.tmp" 2>/dev/null \
                && mv -f "$save.tmp" "$save" || { rm -f "$save.tmp"; exit 1; }
            local tmp now; tmp=$(mktemp "$claims.XXXXXX") || exit 1; now=$(date -u +%FT%TZ)
            jq --argjson s "$slot" --arg a "$DISK_RETENTION_AGENT_ID" --arg t "$now" \
                'map(if .slot == $s and .claimed != true
                     then .claimed = true | .agent_id = $a | .started_at = $t | .last_heartbeat = $t
                          | .expires_at = null | .keep_alive = false else . end)' "$claims" > "$tmp" \
                && mv "$tmp" "$claims" || { rm -f "$tmp"; exit 1; }
            chmod 664 "$claims" 2>/dev/null || true
        ) 200>"$ld/$(basename "$claims").lock"
    ) 201>"$qlock"
}

# Restore slot $1's row from its save file — only while the row is still
# ours (a row someone else holds is never overwritten). No valid save file →
# reset the row to unclaimed. Never reaps an env and never runs lease-advance
# (an env-destroying binary that has no /srv/rl-infra paths in the sweeper
# container): a claimant queued meanwhile picks the slot up on its next queue
# wake or wait timeout, exactly as after a §1 reaper release (TDB:1101).
# The save file is removed only after a successful restore.
disk_retention::_restore() {
    local slot="$1" save sd claims ld row
    sd=$(disk_retention::_state_dir); claims="${RL_CLAIMS_FILE:-$sd/claims.json}"; ld=$(disk_retention::_lock_dir)
    save=$(disk_retention::_save_file "$slot"); mkdir -p "$ld" 2>/dev/null
    row=$(jq -ce --argjson s "$slot" 'select(type == "object" and .slot == $s)' "$save" 2>/dev/null) || row=null
    (
        flock -w 30 -x 200 || exit 1
        local tmp; tmp=$(mktemp "$claims.XXXXXX") || exit 1
        jq --argjson s "$slot" --arg a "$DISK_RETENTION_AGENT_ID" --argjson row "$row" '
            map(if .slot == $s and .agent_id == $a
                then ($row // (. + {claimed:false, agent_id:null, branch:null, started_at:null,
                                    last_heartbeat:null, expires_at:null, keep_alive:false, extends_count:0}))
                else . end)' "$claims" > "$tmp" && mv "$tmp" "$claims" || { rm -f "$tmp"; exit 1; }
        chmod 664 "$claims" 2>/dev/null || true
    ) 200>"$ld/$(basename "$claims").lock" || return 1
    rm -f "$save"
}

# Cycle-start recovery (sweep.sh calls it BEFORE the §1 reapers). The sweeper
# is single-threaded, so a row still held by $DISK_RETENTION_AGENT_ID now was
# orphaned — the sweeper was SIGKILLed mid-clean (docker stop, OOM, reboot)
# or a restore failed. Restore it from its save file (else reset it to
# unclaimed), never reaping. Echoes each restored slot.
disk_retention::recover_orphans() {
    local sd claims slots slot f
    sd=$(disk_retention::_state_dir); claims="${RL_CLAIMS_FILE:-$sd/claims.json}"
    slots=$(jq -r --arg a "$DISK_RETENTION_AGENT_ID" '.[]? | select(.agent_id == $a) | .slot' "$claims" 2>/dev/null) || return 0
    for slot in $slots; do
        [[ "$slot" =~ ^[0-9]+$ ]] || continue
        if disk_retention::_restore "$slot"; then
            disk_retention::_log "slot $slot: orphaned reservation restored"; echo "$slot"
        else
            disk_retention::_log "slot $slot: orphaned reservation restore failed — retried next cycle"
        fi
    done
    # A save file with no reservation (killed between the save and the flip).
    for f in "$sd"/disk-retention-reserve-*.json; do
        [[ -f "$f" ]] || continue
        slot="${f##*-reserve-}"; slot="${slot%.json}"
        [[ " $slots " == *" $slot "* ]] || rm -f "$f"
    done
    return 0
}

# EXIT trap of the runner rung (it runs in the _rung command-substitution
# subshell): restore a reservation a TERM/INT/error left behind. SIGKILL
# skips it — recover_orphans covers that on the next cycle.
disk_retention::_on_exit() {
    [[ -n "${DISK_RETENTION_RESERVED:-}" ]] || return 0
    disk_retention::_restore "$DISK_RETENTION_RESERVED" || disk_retention::_log "slot $DISK_RETENTION_RESERVED reservation restore failed — next sweep recovers it"
    DISK_RETENTION_RESERVED=""
}

# Echoes "<KB before> <KB after>" from inside the runner. Args: tmp root
# (default /tmp), proc root (default /proc). Only regular files and empty
# dirs older than TMP_AGE_MINUTES go; sockets, fifos, devices, tmux-* (the
# `main` session's socket dir), *.sock/*.lock/*.pid, runner-heartbeat and
# anything a process holds open or sits in stay. /root/.cache is absent on
# purpose: Playwright's browsers live there.
disk_retention::_runner_script() {
    local m="$RL_DISK_RETENTION_TMP_AGE_MINUTES" r="${1:-/tmp}" p="${2:-/proc}"
    cat <<SCRIPT
R='$r'; P='$p'; M='$m'
NPMC=\$(npm config get cache 2>/dev/null || echo /root/.npm)
du_kb() { du -sk "\$R" "\$NPMC" 2>/dev/null | awk '{s+=\$1} END {print s+0}'; }
b=\$(du_kb)
INUSE=\$(for l in "\$P"/[0-9]*/fd/* "\$P"/[0-9]*/cwd; do readlink "\$l" 2>/dev/null; done | sort -u)
CWDS=\$(for l in "\$P"/[0-9]*/cwd; do readlink "\$l" 2>/dev/null; done | sort -u)
keep() {
  [ -n "\$INUSE" ] && printf '%s\n' "\$INUSE" | grep -qxF -- "\$1" && return 0
  [ -n "\$CWDS" ] && printf '%s\n' "\$CWDS" | awk -v f="\$1" -v r="\$R" 'index(\$0, r "/") == 1 && index(f, \$0 "/") == 1 { k = 1 } END { exit !k }'
}
skip='( -name tmux-* -o -name *.sock -o -name *.lock -o -name *.pid -o -name runner-heartbeat -o -type s -o -type p -o -type c -o -type b )'
set -f
find "\$R" -xdev -mindepth 1 \$skip -prune -o -type f -mmin +\$M -print | while IFS= read -r f; do keep "\$f" || rm -f -- "\$f"; done
find "\$R" -xdev -mindepth 1 \$skip -prune -o -type d -empty -mmin +\$M -print | while IFS= read -r d; do keep "\$d" || rmdir -- "\$d" 2>/dev/null; done
set +f
npm cache clean --force >/dev/null 2>&1
echo "\$b \$(du_kb)"
SCRIPT
}

# Rung 3 — idle-runner caches. Echoes {idle, busy, cleaned, bytes}.
disk_retention::_runner_rung() {
    local names n slot idle=() busy=() cleaned=() bytes=0 out b a
    DISK_RETENTION_RESERVED=""
    trap 'disk_retention::_on_exit' EXIT; trap 'exit 143' TERM INT HUP
    names=$(disk_retention::_docker ps --filter label=rl.role=runner --format '{{.Names}}' 2>/dev/null) || return 1
    for n in $names; do
        [[ "$n" =~ ^rl-runner-([0-9]+)$ ]] || continue
        slot="${BASH_REMATCH[1]}"
        if disk_retention::_slot_busy "$slot"; then busy+=("$slot"); continue; fi
        idle+=("$slot")
        [[ "$RL_DISK_RETENTION_DRY_RUN" == "1" ]] && continue
        # Reserve under the claims flock (re-checked inside): a claim landing
        # mid-clean now finds the slot taken instead of racing the find.
        if ! disk_retention::_reserve "$slot"; then
            rm -f "$(disk_retention::_save_file "$slot")"; disk_retention::_log "runner $n became busy — not cleaned"; continue
        fi
        DISK_RETENTION_RESERVED="$slot"
        out=$(disk_retention::_docker exec "$n" sh -c "$(disk_retention::_runner_script)" 2>/dev/null) || out=""
        disk_retention::_on_exit
        [[ -n "$out" ]] || { disk_retention::_log "runner $n clean failed"; continue; }
        cleaned+=("$slot")
        read -r b a <<<"$out"
        [[ "${b:-}" =~ ^[0-9]+$ && "${a:-}" =~ ^[0-9]+$ ]] && (( b > a )) && bytes=$(( bytes + (b - a) * 1024 ))
    done
    trap - EXIT TERM INT HUP
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
    disk_retention::_log "$name: $(jq -rc '"removed=" + ((.removed // .cleaned // [] | if type == "array" then length else . end)|tostring) + " bytes=" + ((.bytes // 0)|tostring) + (if .would_reclaim_bytes then " would_reclaim=" + (.would_reclaim_bytes|tostring) else "" end) + (if .skipped then " skipped=" + .skipped else "" end) + (if .error then " error=" + .error else "" end)' <<<"$out" 2>/dev/null)"
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
