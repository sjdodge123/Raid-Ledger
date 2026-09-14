#!/usr/bin/env bash
# ROK-1568 — host disk-pressure ladder.
#
# Why: the gc-sweeper's step-3 prune is scoped to `rl.role=env` labels, which
# is exactly the disk the fleet does NOT leak. On 2026-09-14 the host reached
# 98% (240G/245G): two parallel image builds died at `chmod -R` with ENOSPC
# and an overlapping Playwright run produced net::ERR_TIMED_OUT false reds.
# The 87 GB sat in the buildkit cache, in untagged intermediate images, and
# in 285 anonymous volumes — none of them labelled `rl.role=env`, so the
# scoped prune reclaimed nothing and the operator pruned by hand.
#
# This file is a SOURCEABLE library, deliberately not an executable: both the
# sweeper (`gc-sweeper/sweep.sh`, via $ORCHESTRATOR_BIN_DIR, the same mount it
# already uses for runner-testcontainers-reap) and the orchestrator's build
# admission gate (`_admission.sh`) need the identical ladder, and a shared
# function is safer than a trigger file two processes race on.
#
# The ladder is ORDERED cheapest-blast-radius first and re-reads `df` after
# every rung, stopping as soon as usage is back under the target. A host that
# only needed its builder cache pruned keeps its images and volumes.
#
# Env knobs:
#   RL_DISK_PRUNE_PCT       80     run the ladder at/above this used%
#   RL_DISK_TARGET_PCT      65     stop as soon as used% is below this
#   RL_IMAGE_PRUNE_AGE      48h    only prune images older than this
#   RL_DISK_ROOT            /      filesystem to measure
#   RL_DISK_STATE_FILE      $STATE_DIR/disk-pressure.json
#   RL_DISK_PRUNE_DRY_RUN   0      1 = list the rungs, invoke no docker
#                                  (DRY_RUN=1 is honoured as an alias)

RL_DISK_PRUNE_PCT="${RL_DISK_PRUNE_PCT:-80}"
RL_DISK_TARGET_PCT="${RL_DISK_TARGET_PCT:-65}"
RL_IMAGE_PRUNE_AGE="${RL_IMAGE_PRUNE_AGE:-48h}"
RL_DISK_ROOT="${RL_DISK_ROOT:-/}"
RL_DISK_STATE_FILE="${RL_DISK_STATE_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/disk-pressure.json}"
RL_DISK_PRUNE_DRY_RUN="${RL_DISK_PRUNE_DRY_RUN:-${DRY_RUN:-0}}"

# Used percentage of RL_DISK_ROOT as a bare integer. GNU `--output` first (the
# VM), POSIX `df -P` second (macOS test runners / BusyBox). Echoes nothing
# when both fail — callers treat that as UNKNOWN and fail OPEN, because a
# disk gate must never become the reason the fleet can't work.
disk_pressure::used_pct() {
    local out
    out=$(df --output=pcent "$RL_DISK_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')
    [[ -z "$out" ]] && out=$(df -P "$RL_DISK_ROOT" 2>/dev/null | tail -1 | awk '{print $5}' | tr -dc '0-9')
    echo "$out"
}

# Free space on RL_DISK_ROOT in whole GB (same fallback ladder as above).
disk_pressure::free_gb() {
    local out
    out=$(df --output=avail -BG "$RL_DISK_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9')
    [[ -z "$out" ]] && out=$(df -Pk "$RL_DISK_ROOT" 2>/dev/null | tail -1 | awk '{printf "%d", $4 / 1048576}')
    echo "${out:-0}"
}

# The ordered ladder. Rung 2 carries two protections for the runner images:
# `docker image prune` never touches an image backing a RUNNING container
# (the four runners are always up), and `label!=rl.role=runner` additionally
# spares a stopped runner image — LIMITATION: that only works for images
# actually built with the label, so a runner image tagged without it is
# protected by the running-container rule alone. RL_RUNNER_IMAGE cannot be
# expressed as a prune filter (docker has no repo-name exclusion), which is
# why the label is the mechanism.
disk_pressure::rungs() {
    echo "builder_prune"
    echo "image_prune"
    echo "volume_prune"
}

disk_pressure::rung_cmd() {
    case "$1" in
        builder_prune) echo "docker builder prune -af" ;;
        image_prune)   echo "docker image prune -af --filter until=${RL_IMAGE_PRUNE_AGE} --filter label!=rl.role=runner" ;;
        volume_prune)  echo "docker volume prune -f" ;;
    esac
}

# Run one rung; echo the human-readable reclaim docker reports
# ("Total reclaimed space: 14.5GB"), or "0B" when it says nothing.
disk_pressure::_run_rung() {
    local rung="$1" out=""
    out=$(eval "$(disk_pressure::rung_cmd "$rung")" 2>&1) || true
    local reclaimed
    reclaimed=$(echo "$out" | sed -n 's/^Total reclaimed space:[[:space:]]*//p' | tail -1)
    echo "${reclaimed:-0B}"
}

# Audit through the sweeper's helper when we were sourced by it; fall back to
# stderr elsewhere (the orchestrator's build gate logs into the task log).
disk_pressure::_audit() {
    if declare -F audit >/dev/null 2>&1; then
        audit disk_prune "$1"
    else
        echo "[disk-pressure] $1" >&2
    fi
}

# Atomic state write, mirroring sweep.sh's mutate(): tmpfile in the SAME
# directory so the rename is same-fs (keeps the setgid group + 664 the
# dashboard reader needs). mutate() itself can't be reused — it requires the
# target to already exist and to be valid JSON.
disk_pressure::_write_state() {
    local json="$1" dir tmp
    dir=$(dirname "$RL_DISK_STATE_FILE")
    mkdir -p "$dir" 2>/dev/null || true
    tmp=$(mktemp "${RL_DISK_STATE_FILE}.XXXXXX" 2>/dev/null) || return 0
    printf '%s\n' "$json" > "$tmp" 2>/dev/null \
        && mv "$tmp" "$RL_DISK_STATE_FILE" 2>/dev/null \
        && chmod 664 "$RL_DISK_STATE_FILE" 2>/dev/null
    rm -f "$tmp" 2>/dev/null || true
}

# Walk the ladder from $1 (the already-observed used%). Echoes the rung array.
disk_pressure::_walk() {
    local before="$1" rungs='[]' rung after reclaimed
    for rung in $(disk_pressure::rungs); do
        if [[ "$RL_DISK_PRUNE_DRY_RUN" == "1" ]]; then
            rungs=$(jq -c --arg r "$rung" --arg c "$(disk_pressure::rung_cmd "$rung")" \
                '. + [{rung:$r, command:$c, would_run:true}]' <<<"$rungs")
            continue
        fi
        reclaimed=$(disk_pressure::_run_rung "$rung")
        after=$(disk_pressure::used_pct)
        [[ -z "$after" ]] && after="$before"
        rungs=$(jq -c --arg r "$rung" --arg rec "$reclaimed" \
            --argjson b "$before" --argjson a "$after" \
            '. + [{rung:$r, before_pct:$b, after_pct:$a, reclaimed:$rec}]' <<<"$rungs")
        before="$after"
        (( after < RL_DISK_TARGET_PCT )) && break
    done
    echo "$rungs"
}

# Entry point. Reads `df`, runs the ladder when at/above RL_DISK_PRUNE_PCT,
# writes RL_DISK_STATE_FILE either way, and echoes:
#   {used_pct|before_pct, after_pct, free_gb, pruned, dry_run, rungs:[…]}
# Always returns 0 — disk pressure is never fatal to its caller.
disk_pressure::guard() {
    local before rungs='[]' after pruned=false dry=false
    before=$(disk_pressure::used_pct)
    if [[ -z "$before" ]]; then
        echo '{"pruned":false,"error":"df_unreadable"}'
        return 0
    fi
    after="$before"
    local free_before
    free_before=$(disk_pressure::free_gb)
    if (( before >= RL_DISK_PRUNE_PCT )); then
        [[ "$RL_DISK_PRUNE_DRY_RUN" == "1" ]] && dry=true
        rungs=$(disk_pressure::_walk "$before")
        [[ "$dry" == "false" ]] && pruned=true
        local last
        last=$(jq -r 'if length > 0 then (.[-1].after_pct // empty) else empty end' <<<"$rungs")
        [[ -n "$last" ]] && after="$last"
    fi
    local result
    result=$(jq -nc --argjson b "$before" --argjson a "$after" \
        --argjson free "$(disk_pressure::free_gb)" --argjson rungs "$rungs" \
        --argjson pruned "$pruned" --argjson dry "$dry" --argjson fb "${free_before:-0}" \
        '{before_pct:$b, after_pct:$a, free_gb_before:$fb, free_gb:$free, pruned:$pruned, dry_run:$dry, rungs:$rungs}')
    disk_pressure::_write_state "$(jq -nc --argjson a "$after" \
        --argjson free "$(disk_pressure::free_gb)" --arg ts "$(date -u +%FT%TZ)" \
        --argjson rungs "$rungs" --argjson pruned "$pruned" \
        '{used_pct:$a, free_gb:$free, last_prune_at:(if $pruned then $ts else null end),
          last_checked_at:$ts, last_rungs:$rungs}')"
    [[ "$pruned" == "true" || "$dry" == "true" ]] && disk_pressure::_audit "$result"
    echo "$result"
    return 0
}

# Run the ladder unconditionally, ignoring RL_DISK_PRUNE_PCT. Used by the
# build admission gate (_admission.sh): a build needing 20 GB can be starved
# at 70% used on a 245 GB host, which is below the sweeper's alarm threshold.
# The stop-at-target rule still applies, so this never prunes more than needed.
disk_pressure::force_ladder() {
    local prev="$RL_DISK_PRUNE_PCT" rc=0
    RL_DISK_PRUNE_PCT=0
    disk_pressure::guard || rc=$?
    RL_DISK_PRUNE_PCT="$prev"
    return $rc
}
