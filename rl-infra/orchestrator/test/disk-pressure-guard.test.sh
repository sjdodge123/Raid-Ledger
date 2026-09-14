#!/usr/bin/env bash
# ROK-1568 — host disk-pressure guard.
#
# Incident 2026-09-14 17:55Z: the rl-infra host hit 98% (240G/245G), two
# parallel image builds died at `chmod -R` with ENOSPC, and a Playwright run
# overlapping them produced net::ERR_TIMED_OUT false reds. The sweeper's
# step-3 prune is scoped to `rl.role=env` labels, so it reclaimed nothing —
# the 87 GB actually sat in the builder cache, untagged images and 285
# anonymous volumes. The operator had to prune by hand.
#
# These tests drive the ladder library directly (sourced into the test shell)
# with `df` and `docker` replaced by shell functions, so no VM and no docker
# daemon are involved.
#
# Covered:
#   A-a  below RL_DISK_PRUNE_PCT the ladder runs NOTHING (and still records state)
#   A-b  the ladder stops at the FIRST rung that reaches RL_DISK_TARGET_PCT
#   A-c  it walks all three rungs when earlier ones don't reach the target
#   A-d  disk-pressure.json is written with used_pct / free_gb / last_prune_at / last_rungs
#   A-e  dry-run reports the rungs it WOULD run without invoking docker
#   A-f  sweep.sh wires the ladder in as step 3b

set -uo pipefail

CURRENT_TEST_FILE="disk-pressure-guard.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

LIB="$(cd "$TEST_DIR/../bin" && pwd)/_disk_pressure.sh"
SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"

DOCKER_LOG=""
DF_SEQ=""
DF_IDX=""

# `df` stub. The ladder reads df from COMMAND SUBSTITUTIONS (subshells), so the
# cursor lives in a file — a shell variable would be incremented in the subshell
# and lost, and the ladder would then never observe usage falling.
# Percentage queries pop the next value from the sequence; the avail query is
# derived from the most recent percentage and never advances the cursor.
df() {
    local idx pct last
    idx=$(cat "$DF_IDX" 2>/dev/null || echo 0)
    if [[ "$*" == *avail* ]]; then
        last=$(( idx > 0 ? idx - 1 : 0 ))
        pct=$(sed -n "$(( last + 1 ))p" "$DF_SEQ" 2>/dev/null)
        [[ -z "$pct" ]] && pct=$(tail -1 "$DF_SEQ" 2>/dev/null)
        echo "Avail"
        echo "$(( (100 - ${pct:-0}) * 2 ))G"
        return 0
    fi
    pct=$(sed -n "$(( idx + 1 ))p" "$DF_SEQ" 2>/dev/null)
    [[ -z "$pct" ]] && pct=$(tail -1 "$DF_SEQ" 2>/dev/null)
    echo $(( idx + 1 )) > "$DF_IDX"
    echo "Use%"
    echo "${pct:-0}%"
}

# `docker` stub — records the invocation and reports a plausible reclaim.
docker() {
    echo "docker $*" >> "$DOCKER_LOG"
    echo "Total reclaimed space: 12.3GB"
    return 0
}

# Fresh state + a usage sequence for one scenario.
_setup_ladder() {
    test_setup
    DOCKER_LOG="$RL_STATE_DIR/docker.log"
    DF_SEQ="$RL_STATE_DIR/df.seq"
    DF_IDX="$RL_STATE_DIR/df.idx"
    : > "$DOCKER_LOG"
    printf '%s\n' "$@" > "$DF_SEQ"
    echo 0 > "$DF_IDX"
    export RL_DISK_STATE_FILE="$RL_STATE_DIR/disk-pressure.json"
    export RL_DISK_PRUNE_PCT=80
    export RL_DISK_TARGET_PCT=65
    export RL_DISK_PRUNE_DRY_RUN=0
    unset RL_DISK_ROOT 2>/dev/null || true
    # shellcheck disable=SC1090
    source "$LIB"
}

_docker_calls() {
    grep -c . "$DOCKER_LOG" 2>/dev/null | tr -d ' '
}

# A-a: nothing runs below the threshold — this is the common case and it must
# not cost a builder-cache rebuild on every sweep cycle.
test_below_threshold_runs_nothing() {
    CURRENT_TEST_NAME="A-a: below the threshold the ladder runs no prune"
    _setup_ladder 42

    local out
    out=$(disk_pressure::guard 2>/dev/null)
    assert_eq "$(_docker_calls)" "0" "no docker prune may run below RL_DISK_PRUNE_PCT"
    assert_eq "$(echo "$out" | jq -r '.pruned')" "false" "result must report pruned=false"
    assert_eq "$(echo "$out" | jq -r '.before_pct')" "42" "result must carry the observed used_pct"
    assert_file_exists "$RL_DISK_STATE_FILE" "state file is written even when no prune runs"
    assert_eq "$(jq -r '.used_pct' "$RL_DISK_STATE_FILE")" "42" "state file records used_pct"
    test_teardown
}

# A-b: the first rung reaching the target ends the ladder — we do NOT nuke
# every image and volume on the host when the builder cache alone was enough.
test_ladder_stops_at_first_rung_that_hits_target() {
    CURRENT_TEST_NAME="A-b: ladder stops at the first rung that reaches the target"
    # 92% observed → builder prune → 60% (<= target) → stop.
    _setup_ladder 92 60

    local out
    out=$(disk_pressure::guard 2>/dev/null)
    assert_eq "$(_docker_calls)" "1" "only the builder-cache rung may run"
    assert_contains "$(cat "$DOCKER_LOG")" "builder prune -af" "rung 1 is docker builder prune -af"
    assert_eq "$(echo "$out" | jq -r '.rungs | length')" "1" "exactly one rung recorded"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].rung')" "builder_prune" "rung name"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].before_pct')" "92" "rung records before_pct"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].after_pct')" "60" "rung records after_pct"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].reclaimed')" "12.3GB" "rung parses Total reclaimed space"
    assert_eq "$(echo "$out" | jq -r '.after_pct')" "60" "ladder reports the final percentage"
    test_teardown
}

# A-c: when the cheap rungs don't get there, the ladder walks all the way down
# to anonymous volumes — the rung that actually reclaimed 14.5 GB on 09-14.
test_ladder_walks_all_rungs() {
    CURRENT_TEST_NAME="A-c: ladder walks image + volume rungs when builder is not enough"
    # 98 → builder → 90 → image prune → 80 → volume prune → 39.
    _setup_ladder 98 90 80 39

    local out
    out=$(disk_pressure::guard 2>/dev/null)
    local log
    log=$(cat "$DOCKER_LOG")
    assert_eq "$(_docker_calls)" "3" "all three rungs must run"
    assert_contains "$log" "image prune -af" "rung 2 prunes unused images"
    assert_contains "$log" "until=48h" "rung 2 honours RL_IMAGE_PRUNE_AGE"
    assert_contains "$log" "label!=rl.role=runner" "rung 2 must never prune a runner image"
    assert_contains "$log" "volume prune -f" "rung 3 prunes anonymous volumes"
    assert_eq "$(echo "$out" | jq -r '.rungs | length')" "3" "three rungs recorded"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].rung')" "volume_prune" "last rung is volume_prune"
    assert_eq "$(echo "$out" | jq -r '.after_pct')" "39" "final percentage after the last rung"
    test_teardown
}

# A-d: the status tool reads this file, so its shape is a contract.
test_state_file_shape() {
    CURRENT_TEST_NAME="A-d: disk-pressure.json carries the status-tool contract"
    _setup_ladder 91 55

    disk_pressure::guard >/dev/null 2>&1
    assert_file_exists "$RL_DISK_STATE_FILE" "state file must exist after a prune"
    assert_eq "$(jq -r '.used_pct' "$RL_DISK_STATE_FILE")" "55" "used_pct is the POST-prune reading"
    assert_eq "$(jq -r '.free_gb' "$RL_DISK_STATE_FILE")" "90" "free_gb is present"
    assert_neq "$(jq -r '.last_prune_at // "null"' "$RL_DISK_STATE_FILE")" "null" "last_prune_at is stamped"
    assert_eq "$(jq -r '.last_rungs | length' "$RL_DISK_STATE_FILE")" "1" "last_rungs mirrors the ladder"
    test_teardown
}

# A-e: dry-run must be inspectable without touching the host.
test_dry_run_lists_without_running() {
    CURRENT_TEST_NAME="A-e: dry-run lists the rungs it would run and calls no docker"
    _setup_ladder 95
    export RL_DISK_PRUNE_DRY_RUN=1

    local out
    out=$(disk_pressure::guard 2>/dev/null)
    assert_eq "$(_docker_calls)" "0" "dry-run must not invoke docker"
    assert_eq "$(echo "$out" | jq -r '.dry_run')" "true" "result is flagged dry_run"
    assert_eq "$(echo "$out" | jq -r '.rungs | length')" "3" "dry-run lists every rung it would run"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].would_run')" "true" "dry-run rungs are marked would_run"
    test_teardown
}

# A-f: the library existing is not the fix — the sweeper has to call it.
test_sweeper_wires_the_ladder() {
    CURRENT_TEST_NAME="A-f: sweep.sh invokes the disk-pressure ladder"
    local src
    src=$(grep -v '^[[:space:]]*#' "$SWEEP_SCRIPT" 2>/dev/null || echo "")
    assert_contains "$src" "_disk_pressure.sh" "sweep.sh must source the ladder library"
    assert_contains "$src" "disk_pressure::guard" "sweep.sh must call disk_pressure::guard"
    test_teardown
}

run_test "a-a-below-threshold" test_below_threshold_runs_nothing
run_test "a-b-stops-at-first-rung" test_ladder_stops_at_first_rung_that_hits_target
run_test "a-c-walks-all-rungs" test_ladder_walks_all_rungs
run_test "a-d-state-file-shape" test_state_file_shape
run_test "a-e-dry-run" test_dry_run_lists_without_running
run_test "a-f-sweeper-wiring" test_sweeper_wires_the_ladder

print_test_summary
