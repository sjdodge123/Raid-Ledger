#!/usr/bin/env bash
# ROK-1600 — env TTL decision helpers, extracted from gc-sweeper/sweep.sh so
# the "should this env be reaped?" predicate is pure logic that can be unit
# tested without docker (see test/gc-sweeper-plan-guard.test.sh).
#
# Function-only library. Sourced by sweep.sh from the read-only
# /orchestrator-lib mount (same mount as _discord_sweep.sh / _disk_pressure.sh),
# so a repo checkout on the VM updates it without rebuilding the sweeper image.
# Sources nothing itself and defines no globals beyond its functions.
#
# Two defects it exists to fix:
#   1. TTL was read from the container's immutable `rl.last_touched` LABEL.
#      env-spin REUSES the PG container on redeploy (ENV_SPIN_PG_REUSED), so
#      the PG label keeps the ORIGINAL spin time forever and a redeploy could
#      never extend the env — the sweeper reaped a freshly-redeployed env off
#      its sidecar's stale label (rok1570a, 2026-09-16).
#   2. Reaping an env drops it from env-registry.json, and the dashboard's
#      orphan-plan prune then deletes its test plans — pending operator
#      verdicts and all (rok1564a lost 9 pending plans, 2026-09-16 03:40Z).

# Portable ISO 8601 → epoch. GNU `date -d` first (the sweeper image is
# debian-slim and has NO python3); python fallback for macOS test runners.
# Unparseable/empty → 0, which makes an env look infinitely old. That is the
# safe direction for a *reference* timestamp only because callers take the
# MAX of the candidates below — a single bad label can't force a reap.
env_ttl::epoch() {
    local iso="${1-}"
    [[ -z "$iso" ]] && { echo 0; return 0; }
    date -u -d "$iso" +%s 2>/dev/null \
        || python3 -W ignore -c "import datetime; print(int(datetime.datetime.fromisoformat('${iso}'.replace('Z','+00:00')).timestamp()))" 2>/dev/null \
        || echo 0
}

# env_ttl::reference_epoch <label_iso> <slug> <env_registry_json>
#
# The age clock an env is judged against: the NEWEST of the container label
# and the registry's last_touched. env-spin bumps the registry row on EVERY
# spin and redeploy (both the idempotent and the recreate path), so registry
# wins whenever the env was touched after its containers were created — that
# is defect 1's fix. The label still wins for a container with no registry row
# (orphan / clobbered registry), so nothing becomes immortal.
env_ttl::reference_epoch() {
    local label_iso="${1-}" slug="${2-}" envs="${3-}"
    local label_epoch registry_iso registry_epoch
    label_epoch=$(env_ttl::epoch "$label_iso")
    registry_iso=""
    if [[ -n "$slug" && -n "$envs" && -f "$envs" ]]; then
        registry_iso=$(jq -r --arg s "$slug" \
            'map(select(.slug == $s)) | .[0].last_touched // ""' "$envs" 2>/dev/null || echo "")
        [[ "$registry_iso" == "null" ]] && registry_iso=""
    fi
    registry_epoch=$(env_ttl::epoch "$registry_iso")
    (( registry_epoch > label_epoch )) && label_epoch=$registry_epoch
    echo "$label_epoch"
}

# env_ttl::pending_plan_steps <slug> <test_plans_dir>
#
# Count steps with no verdict across every plan file for the slug
# (TEST_PLANS_DIR/<slug>/<plan_id>.json, v2 layout). "Pending" matches the
# dashboard's own summarizePlan() counter: a step with an empty results[].
# A step whose last verdict is `fail` is NOT pending — the tester already
# reported and the agent is expected to act before merge, so it must not hold
# the env open. Unreadable dir / malformed JSON → 0 (fail open: a broken plan
# file must not make an env immortal).
env_ttl::pending_plan_steps() {
    local slug="${1-}" plans_dir="${2-}" file total=0 count
    [[ -z "$slug" || -z "$plans_dir" || ! -d "$plans_dir/$slug" ]] && { echo 0; return 0; }
    for file in "$plans_dir/$slug"/*.json; do
        [[ -f "$file" ]] || continue
        count=$(jq -r '[.steps[]? | select((.results // []) | length == 0)] | length' "$file" 2>/dev/null || echo 0)
        [[ "$count" =~ ^[0-9]+$ ]] || count=0
        total=$(( total + count ))
    done
    echo "$total"
}

# env_ttl::decision <now_epoch> <reference_epoch> <ttl_hours> <pending_steps> <grace_hours>
#
# Echoes "<verdict> <age_hours> <deadline_hours>" where verdict is one of:
#   keep       — inside its TTL.
#   plan_grace — past TTL but held open because a plan still has pending steps.
#   reap       — past its deadline; destroy it.
#
# GUARANTEED EVENTUAL CLEANUP: the grace is an ABSOLUTE ceiling measured from
# the same reference clock, not a per-cycle renewal. An env with pending plans
# dies at ttl + grace (24h + 24h = 48h by default) whether or not anyone ever
# submits a verdict. One forgotten plan can therefore delay a reap, never
# block it. Set grace_hours=0 to disable the guard entirely, and note that
# `rl_env_destroy` / env-destroy remain unconditional force paths.
env_ttl::decision() {
    local now="${1:-0}" reference="${2:-0}" ttl_hours="${3:-0}"
    local pending="${4:-0}" grace_hours="${5:-0}"
    local age_hours deadline_hours
    age_hours=$(( (now - reference) / 3600 ))
    (( age_hours < 0 )) && age_hours=0
    deadline_hours="$ttl_hours"
    (( pending > 0 )) && deadline_hours=$(( ttl_hours + grace_hours ))
    if (( age_hours >= deadline_hours )); then
        echo "reap $age_hours $deadline_hours"
    elif (( pending > 0 && age_hours >= ttl_hours )); then
        echo "plan_grace $age_hours $deadline_hours"
    else
        echo "keep $age_hours $deadline_hours"
    fi
}
