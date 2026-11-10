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
# sweeper (`gc-sweeper/sweep.sh`, via the read-only /orchestrator-lib mount it
# resolves as $DISCORD_SWEEP_LIB_DIR) and the orchestrator's build
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
#   RL_DANGLING_PRUNE_AGE   6h     dangling_prune: untagged images older than this
#   RL_DISK_ROOT            /      filesystem to measure
#   RL_DISK_STATE_FILE      $STATE_DIR/disk-pressure.json
#   RL_DISK_PRUNE_DRY_RUN   0      1 = list the rungs, invoke no docker
#                                  (DRY_RUN=1 is honoured as an alias)
#   RL_DISK_BUILDER_FORCE_PCT 95   ROK-2111: run builder_prune AND dangling_prune
#                                  at/above this used% even while a build is
#                                  running (one ceiling for both guarded rungs)
#   RL_BUILD_MIN_FREE_GB    20     owned by _admission.sh (the image-build free
#                                  floor; read here at call time, same default).
#                                  dangling_prune is also forced below this many
#                                  free GB unless an IMAGE BUILD is running
#   RL_ADMISSION_FILE       $RL_STATE_DIR|$STATE_DIR/admission.json — the
#                                  ledger the builder guard reads (at call time)
#   RL_DISK_LADDER_SELF_KEYS ""    space-separated ledger keys of the CALLER,
#                                  ignored by the guard (set by acquire_disk)

RL_DISK_PRUNE_PCT="${RL_DISK_PRUNE_PCT:-80}"
RL_DISK_TARGET_PCT="${RL_DISK_TARGET_PCT:-65}"
RL_IMAGE_PRUNE_AGE="${RL_IMAGE_PRUNE_AGE:-48h}"
RL_DANGLING_PRUNE_AGE="${RL_DANGLING_PRUNE_AGE:-6h}"
RL_DISK_ROOT="${RL_DISK_ROOT:-/}"
RL_DISK_STATE_FILE="${RL_DISK_STATE_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/disk-pressure.json}"
RL_DISK_PRUNE_DRY_RUN="${RL_DISK_PRUNE_DRY_RUN:-${DRY_RUN:-0}}"
RL_DISK_BUILDER_FORCE_PCT="${RL_DISK_BUILDER_FORCE_PCT:-95}"

# Used percentage of RL_DISK_ROOT as a bare integer. GNU `--output` first (the
# VM), POSIX `df -P` second (macOS test runners / BusyBox). Echoes nothing
# when both fail — callers treat that as UNKNOWN and fail OPEN, because a
# disk gate must never become the reason the fleet can't work.
disk_pressure::used_pct() {
    local out
    # `|| true`: BSD/BusyBox df has no --output and the caller may run under
    # `set -e` + pipefail (build-image-on-runner), where the failing first leg
    # would abort the caller BEFORE the POSIX fallback below ever ran.
    out=$(df --output=pcent "$RL_DISK_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9') || true
    [[ -z "$out" ]] && { out=$(df -P "$RL_DISK_ROOT" 2>/dev/null | tail -1 | awk '{print $5}' | tr -dc '0-9') || true; }
    echo "$out"
}

# Free space on RL_DISK_ROOT in whole GB (same fallback ladder as above).
# Echoes NOTHING and returns 1 when both probes fail. It used to echo 0, which
# the admission gate reads as "permanently full" — an unreadable df would then
# park every image build until its budget expired, forever. Blank means
# UNKNOWN, and every caller treats UNKNOWN as fail-OPEN (Codex P2).
disk_pressure::free_gb() {
    local out
    out=$(df --output=avail -BG "$RL_DISK_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9') || true
    [[ -z "$out" ]] && { out=$(df -Pk "$RL_DISK_ROOT" 2>/dev/null | tail -1 | awk '{printf "%d", $4 / 1048576}') || true; }
    [[ -z "$out" ]] && return 1
    echo "$out"
}

# The ordered ladder. Rung 2 carries two protections for the runner images:
# `docker image prune` never touches an image backing a RUNNING container
# (the four runners are always up), and `label!=rl.role=runner` additionally
# spares a stopped runner image — LIMITATION: that only works for images
# actually built with the label, so a runner image tagged without it is
# protected by the running-container rule alone. RL_RUNNER_IMAGE cannot be
# expressed as a prune filter (docker has no repo-name exclusion), which is
# why the label is the mechanism.
#
# dangling_prune (2026-11-10): the runners build with the CLASSIC builder
# (compose `DOCKER_BUILDKIT: "0"`), so a build leaves no BuildKit cache for
# builder_prune to reclaim. It leaves untagged images instead — each
# Dockerfile.allinone stage result, and the old `rl:ci-test` / env tag every
# rebuild moves off. ~950 of them, all younger than 48h, filled the host on
# 2026-11-10 while image_prune's `until=48h` skipped every one. Without `-a`
# docker prunes DANGLING images only (untagged, no child image, no container
# of any state using it), so tagged images, env images and runner images
# stay — rung 2's protections (running/stopped container use, the runner
# label) apply here unchanged. It shares builder_prune's build guard: a running
# classic build can be mid-way through reusing an old stage image as cache.
# `until` filters on the image's CREATION time, not its last use, so a stage
# image first built more than RL_DANGLING_PRUNE_AGE ago is removed even if
# every gate since has reused it (cost: one cache rebuild of that stage).
#
# Free-floor override (review r1 MAJOR): image builds park below
# RL_BUILD_MIN_FREE_GB (~92% on the 245 GB host), which is BELOW the 95%
# ceiling, and gates run back to back — so the guard alone left a band where
# builds starve and nothing relieves it. Below the floor the rung is forced
# while ordinary tasks run, unless an image_build entry is BUILDING (a prune
# under one failed it on 2026-11-10: `failed to commit: lease does not exist`).
# An image build parked on disk (`disk_parked`, set by acquire_disk) has not
# started, so it does not block (review r2 MAJOR). A gate's own container
# check (`--static` builds Dockerfile.allinone) is a `kind:task` entry the
# ledger cannot tell from any other task, so it does not block either: in rare
# cases a forced prune fails that gate's container step (TECH-DEBT-BACKLOG
# 2026-10-30) — the `dangling_prune forced …` log line names the prune so the
# failure can be attributed. Forcing only when nothing at all runs was rejected:
# on a night of nonstop gates it would never fire.
disk_pressure::rungs() {
    echo "builder_prune"
    echo "image_prune"
    echo "dangling_prune"
    echo "volume_prune"
}

disk_pressure::rung_cmd() {
    case "$1" in
        # DOCKER_BUILDKIT=0 (2026-10-26): with the buildx plugin installed
        # (VM host + runner images) `docker builder prune` IS `docker buildx
        # prune`, which dials BuildKit over the hijacked POST /grpc endpoint
        # (or `containers/buildx_buildkit_*/exec`). rl-docker-proxy allows
        # neither, so the admission gate's ladder died on this rung every run
        # with `ERROR: driver not running`. The legacy CLI path is a plain
        # POST /build/prune (allowlisted), which the daemon serves by pruning
        # its embedded BuildKit cache. The runners build with the classic
        # builder (compose `DOCKER_BUILDKIT: "0"`), so this rung usually
        # reclaims ~0B; their waste is untagged images (dangling_prune). The
        # gc-sweeper image has no buildx plugin, so it was on this path already.
        builder_prune) echo "DOCKER_BUILDKIT=0 docker builder prune -af" ;;
        image_prune)   echo "docker image prune -af --filter until=${RL_IMAGE_PRUNE_AGE} --filter label!=rl.role=runner" ;;
        dangling_prune) echo "docker image prune -f --filter until=${RL_DANGLING_PRUNE_AGE} --filter label!=rl.role=runner" ;;
        # `volume prune` is anonymous-only from engine 23, but older engines
        # remove unattached NAMED volumes too — and traefik-acme /
        # registry-data / loki-data are unattached during any compose
        # recreate. The project filter makes the guard explicit either way.
        volume_prune)  echo "docker volume prune -f --filter label!=com.docker.compose.project=${RL_COMPOSE_PROJECT:-rl-infra}" ;;
    esac
}

# Run one rung; echo the human-readable reclaim docker reports
# ("Total reclaimed space: 14.5GB"), or "0B" when it says nothing.
# Run one rung; echo {reclaimed, exit_code, stderr}. The exit code is the
# point: rl-docker-proxy answers 403 for a route missing from allowPOST, and
# without this the reclaim regex simply misses and the rung reports "0B" with
# ok:true — a denied prune that looks like a successful one (review MAJOR 3).
disk_pressure::_run_rung() {
    local rung="$1" out="" rc=0
    out=$(eval "$(disk_pressure::rung_cmd "$rung")" 2>&1) || rc=$?
    local reclaimed
    reclaimed=$(echo "$out" | sed -n 's/^Total reclaimed space:[[:space:]]*//p' | tail -1)
    local err=""
    (( rc != 0 )) && err=$(echo "$out" | tail -3 | tr '\n' ' ' | cut -c1-300)
    jq -nc --arg rec "${reclaimed:-0B}" --argjson rc "$rc" --arg err "$err" \
        '{reclaimed:$rec, exit_code:$rc, stderr:$err}'
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

# A failed rung goes to the sweeper's log() when we were sourced by it (the
# sweeper calls guard with stderr discarded), stderr elsewhere (the build
# admission gate's task log). Never fatal. The sweeper's log() prints to
# STDOUT, and _walk returns the rung JSON on stdout, so its output is sent to
# stderr here — otherwise a failed rung's log line corrupts the captured JSON.
disk_pressure::_log_failure() {
    local rung="$1" outcome="$2" msg
    msg="disk ladder: ${rung} failed (exit $(jq -r '.exit_code' <<<"$outcome")): $(jq -r '.stderr' <<<"$outcome")"
    disk_pressure::_log "$msg"
}

# One line to the sweeper's log() when sourced by it, stderr elsewhere. Always
# to stderr: _walk returns its rung JSON on stdout (see _log_failure).
disk_pressure::_log() {
    if declare -F log >/dev/null 2>&1; then
        log "$1" >&2
    else
        echo "[disk-pressure] $1" >&2
    fi
    return 0
}

# ROK-2111 — `docker builder prune -af` deletes the BuildKit cache a running
# `docker build` is writing, killing the build mid-step. Echo the keys of the
# admission-ledger entries that make the builder rung unsafe: any image build
# and any task of ANY weight — validate-ci runs builds, and a light task can
# run a `docker build` too (ROK-2111 review r1). Only registry_gc (the
# sweeper's own registry sweep, no build) is harmless. The caller's own keys (RL_DISK_LADDER_SELF_KEYS)
# are ignored — a build's own disk admission runs before it builds anything.
# Returns 2 when the ledger is missing or unreadable.
disk_pressure::build_busy_keys() {
    local ledger="${RL_ADMISSION_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/admission.json}"
    [[ -r "$ledger" ]] || return 2
    jq -er --arg self "${RL_DISK_LADDER_SELF_KEYS:-}" '
        ($self | split(" ") | map(select(length > 0))) as $mine
        | [ (.heavy_running // [])[]
            | select((.key // "") as $k | ($mine | index($k)) == null)
            | select((.kind // "task") != "registry_gc")
            | (.key // "?") ] | join(" ")' "$ledger" 2>/dev/null || return 2
}

# Keys of image builds that are BUILDING (kind == image_build, which both
# task-start's admission and hold_image_build write), the caller's own keys
# excluded. An entry with disk_parked == true is parked in acquire_disk waiting
# for free disk and has not started building, so it is left out (review r2).
# Returns 2 when the ledger is missing or unreadable.
disk_pressure::image_build_keys() {
    local ledger="${RL_ADMISSION_FILE:-${RL_STATE_DIR:-${STATE_DIR:-/state}}/admission.json}"
    [[ -r "$ledger" ]] || return 2
    jq -er --arg self "${RL_DISK_LADDER_SELF_KEYS:-}" '
        ($self | split(" ") | map(select(length > 0))) as $mine
        | [ (.heavy_running // [])[]
            | select((.key // "") as $k | ($mine | index($k)) == null)
            | select((.kind // "task") == "image_build")
            | select(.disk_parked != true)
            | (.key // "?") ] | join(" ")' "$ledger" 2>/dev/null || return 2
}

# Decide a build-guarded rung ($2, default builder_prune) at used% $1. Echoes a JSON fragment merged into the
# rung record: {} = run, {forced:true, forced_by:"ceiling"|"free_floor"} = run
# despite a build (free_floor: dangling_prune only, see disk_pressure::rungs),
# {skipped:<reason>} = do not run. Logs every non-plain outcome.
disk_pressure::_builder_gate() {
    local pct="$1" rung="${2:-builder_prune}" keys rc=0 reason
    keys=$(disk_pressure::build_busy_keys) || rc=$?
    if (( rc != 0 )); then
        reason="ledger_unreadable"
    elif [[ -n "$keys" ]]; then
        reason="build_running"
    else
        echo '{}'; return 0
    fi
    if (( pct >= RL_DISK_BUILDER_FORCE_PCT )); then
        disk_pressure::_log "disk ladder: ${rung} forced at ${pct}% >= RL_DISK_BUILDER_FORCE_PCT=${RL_DISK_BUILDER_FORCE_PCT}% despite ${reason}${keys:+ (${keys})}"
        echo '{"forced":true,"forced_by":"ceiling"}'; return 0
    fi
    # dangling_prune only: forced below the image-build free floor unless an
    # image build is running. An unreadable ledger cannot tell, so stays skipped.
    local floor="${RL_BUILD_MIN_FREE_GB:-20}" free builds note=""
    [[ "$floor" =~ ^[1-9][0-9]*$ ]] || floor=20
    if [[ "$rung" == "dangling_prune" && "$reason" == "build_running" ]]; then
        free="$(disk_pressure::free_gb)" || free=""
        if [[ "$free" =~ ^[0-9]+$ ]] && (( free < floor )); then
            builds=$(disk_pressure::image_build_keys) || builds="?"
            if [[ -z "$builds" ]]; then
                disk_pressure::_log "disk ladder: ${rung} forced at ${free}GB free < RL_BUILD_MIN_FREE_GB=${floor} despite ${reason} (${keys}); no image build is building (disk-parked builds do not block)"
                echo '{"forced":true,"forced_by":"free_floor"}'; return 0
            fi
            note="; ${free}GB free < RL_BUILD_MIN_FREE_GB=${floor} but an image build is building (${builds})"
        fi
    fi
    disk_pressure::_log "disk ladder: ${rung} skipped (${reason}) at ${pct}%${keys:+ — running: ${keys}}; below RL_DISK_BUILDER_FORCE_PCT=${RL_DISK_BUILDER_FORCE_PCT}%${note}"
    jq -nc --arg r "$reason" --arg k "$keys" \
        '{skipped:$r} + (if $k == "" then {} else {blocked_by:($k | split(" "))} end)'
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
# ROK-2111: the builder rung passes _builder_gate first — both callers (the
# sweeper's guard and a build's own admission via force_ladder) walk here.
disk_pressure::_walk() {
    local before="$1" rungs='[]' rung after gate
    for rung in $(disk_pressure::rungs); do
        gate='{}'
        if [[ "$rung" == "builder_prune" || "$rung" == "dangling_prune" ]]; then
            gate=$(disk_pressure::_builder_gate "$before" "$rung")
            [[ -n "$gate" ]] || gate='{"skipped":"guard_error"}'   # fail safe
        fi
        if [[ "$(jq -r '.skipped // empty' <<<"$gate")" != "" ]]; then
            rungs=$(jq -c --arg r "$rung" --argjson b "$before" --argjson g "$gate" \
                '. + [({rung:$r, before_pct:$b, after_pct:$b} + $g)]' <<<"$rungs")
            continue
        fi
        if [[ "$RL_DISK_PRUNE_DRY_RUN" == "1" ]]; then
            rungs=$(jq -c --arg r "$rung" --arg c "$(disk_pressure::rung_cmd "$rung")" --argjson g "$gate" \
                '. + [({rung:$r, command:$c, would_run:true} + $g)]' <<<"$rungs")
            continue
        fi
        local outcome
        outcome=$(jq -c --argjson g "$gate" '. + $g' <<<"$(disk_pressure::_run_rung "$rung")")
        after=$(disk_pressure::used_pct)
        [[ -z "$after" ]] && after="$before"
        rungs=$(jq -c --arg r "$rung" --argjson o "$outcome" \
            --argjson b "$before" --argjson a "$after" \
            '. + [({rung:$r, before_pct:$b, after_pct:$a} + $o)]' <<<"$rungs")
        before="$after"
        # A rung that could not run has not relieved anything — log it and
        # keep walking so a single denied route doesn't abort the whole ladder.
        if [[ "$(jq -r '.exit_code' <<<"$outcome")" != "0" ]]; then
            disk_pressure::_log_failure "$rung" "$outcome"
            continue
        fi
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
    free_before="$(disk_pressure::free_gb)" || free_before=""
    if (( before >= RL_DISK_PRUNE_PCT )); then
        [[ "$RL_DISK_PRUNE_DRY_RUN" == "1" ]] && dry=true
        rungs=$(disk_pressure::_walk "$before")
        [[ "$dry" == "false" ]] && pruned=true
        local last
        last=$(jq -r 'if length > 0 then (.[-1].after_pct // empty) else empty end' <<<"$rungs")
        [[ -n "$last" ]] && after="$last"
    fi
    local free_now
    free_now="$(disk_pressure::free_gb)" || free_now=""
    [[ -z "$free_now" ]] && free_now="null"
    [[ -z "${free_before:-}" ]] && free_before="null"
    local result
    result=$(jq -nc --argjson b "$before" --argjson a "$after" \
        --argjson free "$free_now" --argjson rungs "$rungs" \
        --argjson pruned "$pruned" --argjson dry "$dry" --argjson fb "$free_before" \
        '{before_pct:$b, after_pct:$a, free_gb_before:$fb, free_gb:$free, pruned:$pruned, dry_run:$dry, rungs:$rungs}')
    # A dry run reports; it must NOT overwrite the state file the status tool
    # reads, or `rl_status.disk_pressure` starts claiming would_run rungs and
    # last_prune_at:null right after a real prune (review MINOR 9).
    [[ "$dry" == "true" ]] || disk_pressure::_write_state "$(jq -nc --argjson a "$after" \
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
