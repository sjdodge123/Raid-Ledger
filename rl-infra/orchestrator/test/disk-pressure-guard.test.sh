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
#   A-f  sweep.sh resolves the ladder under the path compose actually mounts
#   A-g  the POSIX df fallback works and never aborts a `set -e` caller
#   A-h  a denied/failed rung is recorded, not scored as a 0B success
#   A-i  the build pre-flight gates on the DISK marker, not the memory one
#   A-j  an unreadable df is UNKNOWN (fail open), never "0 GB free"
#   A-k  rl status survives a missing/corrupt disk-pressure.json

set -uo pipefail

CURRENT_TEST_FILE="disk-pressure-guard.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

LIB="$(cd "$TEST_DIR/../bin" && pwd)/_disk_pressure.sh"
SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"
COMPOSE_FILE="$(cd "$TEST_DIR/../../" && pwd)/docker-compose.yml"

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
    assert_file_not_exists "$RL_DISK_STATE_FILE" \
        "a dry run must not overwrite the state file rl_status.disk_pressure reads"
    test_teardown
}

# A-f: the library existing is not the fix, and neither is sourcing it from a
# path that is not mounted. ORCHESTRATOR_BIN_DIR (/orchestrator/bin) is
# deliberately DEAD inside the gc-sweeper container — the bin dir is mounted at
# /orchestrator-lib. Resolving the lib under the wrong one made the whole
# ladder a silent "library not found" no-op in production (review BLOCKER 1),
# which a grep-only assertion happily passed. So resolve the path the way
# sweep.sh does, with compose's own value, and prove the mount provides it.
test_sweeper_wires_the_ladder() {
    CURRENT_TEST_NAME="A-f: sweep.sh resolves the ladder under the path compose actually mounts"
    local src
    src=$(grep -v '^[[:space:]]*#' "$SWEEP_SCRIPT" 2>/dev/null || echo "")
    assert_contains "$src" "_disk_pressure.sh" "sweep.sh must source the ladder library"
    assert_contains "$src" "disk_pressure::guard" "sweep.sh must call disk_pressure::guard"

    # What compose puts where: `- ./orchestrator/bin:/orchestrator-lib:ro`
    local mount host_dir container_dir lib_dir_env
    mount=$(grep -Eo '\./orchestrator/bin:/[A-Za-z0-9_-]+:ro' "$COMPOSE_FILE" | head -1)
    assert_neq "$mount" "" "compose must bind-mount orchestrator/bin into gc-sweeper"
    host_dir="${mount%%:*}"
    container_dir="${mount#*:}"; container_dir="${container_dir%:ro}"
    lib_dir_env=$(grep -E '^[[:space:]]+DISCORD_SWEEP_LIB_DIR:' "$COMPOSE_FILE" | head -1 | awk '{print $2}')

    # Resolve sweep.sh's own default with the container's environment.
    local assign resolved
    assign=$(grep -m1 '^DISK_PRESSURE_LIB=' "$SWEEP_SCRIPT")
    resolved=$(env -u DISK_PRESSURE_LIB DISCORD_SWEEP_LIB_DIR="$lib_dir_env" \
        ORCHESTRATOR_BIN_DIR=/orchestrator/bin bash -c "$assign; echo \"\$DISK_PRESSURE_LIB\"")
    assert_eq "$resolved" "${container_dir}/_disk_pressure.sh" \
        "the resolved lib path must sit inside the mount compose provides"

    # ...and the host side of that mount must really contain the file.
    assert_file_exists "$(cd "$TEST_DIR/../../" && pwd)/${host_dir#./}/_disk_pressure.sh" \
        "the mounted host directory must contain _disk_pressure.sh"
    test_teardown
}

# A-g (review MAJOR 6): BSD/BusyBox df has no --output. Under `set -e` +
# pipefail the failing first leg used to abort the CALLER before the POSIX
# fallback ever ran, so a build-image-on-runner pre-flight would kill the build.
test_posix_df_fallback() {
    CURRENT_TEST_NAME="A-g: falls back to POSIX df when --output is unsupported"
    _setup_ladder 42
    # The BSD-ish df lives in SUBSHELLS only: `unset -f df` here would delete
    # the file-level stub every later test depends on.
    local bsd_df='df() {
        if [[ "$*" == *--output* ]]; then echo "df: illegal option -- output" >&2; return 1; fi
        echo "Filesystem 1024-blocks Used Available Capacity Mounted"
        echo "/dev/disk1 100000000 42000000 58000000 42% /"
    }'

    local rc=0 pct free
    ( eval "$bsd_df"; set -eo pipefail; source "$LIB"; disk_pressure::used_pct >/dev/null ) || rc=$?
    assert_exit_code "$rc" "0" "used_pct must not abort a caller running set -e + pipefail"
    pct=$( eval "$bsd_df"; disk_pressure::used_pct )
    assert_eq "$pct" "42" "the POSIX fallback must parse the capacity column"
    free=$( eval "$bsd_df"; disk_pressure::free_gb )
    assert_eq "$free" "55" "the POSIX fallback must convert 1K blocks to GB"
    test_teardown
}

# A-h (review MAJOR 3): rl-docker-proxy answers 403 for a route missing from
# allowPOST and docker reports that as a plain non-zero exit. Scoring it as a
# "0B" success is how a denied prune looks identical to a clean one.
test_failed_rung_is_recorded_not_swallowed() {
    CURRENT_TEST_NAME="A-h: a denied/failed rung records exit_code + stderr and the ladder keeps walking"
    _setup_ladder 95 95 95 95

    # Builder prune is refused (what rl-docker-proxy returns for a route that
    # is not in allowPOST); the other rungs behave normally. Subshell-scoped
    # so the file-level docker stub survives for any later test.
    local out
    out=$(
        docker() {
            echo "docker $*" >> "$DOCKER_LOG"
            if [[ "$*" == builder* ]]; then
                echo "Error response from daemon: 403 Forbidden" >&2
                return 1
            fi
            echo "Total reclaimed space: 1GB"
        }
        disk_pressure::guard 2>/dev/null
    )
    assert_eq "$(echo "$out" | jq -r '.rungs[0].exit_code')" "1" "a refused rung must record its exit code"
    assert_contains "$(echo "$out" | jq -r '.rungs[0].stderr')" "403" "a refused rung must record why"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].reclaimed')" "0B" "a refused rung reclaims nothing"
    assert_eq "$(echo "$out" | jq -r '.rungs[1].exit_code')" "0" "a healthy rung records exit_code 0"
    assert_eq "$(echo "$out" | jq -r '.rungs | length')" "3" "one denied route must not abort the ladder"
    test_teardown
}

# A-i (review MAJOR 5): the build pre-flight must key off a DISK-specific
# marker. RL_ADMISSION_HELD is exported for every heavy task by task-start,
# so keying off it meant a heavy rl_run_on_runner/deploy that builds an image
# skipped the disk gate entirely — the 2026-09-14 scenario. Source-scanned
# with comments stripped: this test's own rationale names both vars.
test_build_preflight_uses_disk_specific_marker() {
    CURRENT_TEST_NAME="A-i: build-image-on-runner gates on RL_ADMISSION_DISK_HELD, not RL_ADMISSION_HELD"
    local bin_dir build_src start_src
    bin_dir="$(cd "$TEST_DIR/../bin" && pwd)"
    build_src=$(grep -v '^[[:space:]]*#' "$bin_dir/build-image-on-runner" 2>/dev/null || echo "")
    start_src=$(grep -v '^[[:space:]]*#' "$bin_dir/task-start" 2>/dev/null || echo "")

    assert_contains "$build_src" 'RL_ADMISSION_DISK_HELD' "the pre-flight must consult the disk marker"
    if [[ "$build_src" == *'${RL_ADMISSION_HELD:-}'* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: pre-flight still keys off the memory marker")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] pre-flight still keys off the memory marker"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    assert_contains "$start_src" 'export RL_ADMISSION_DISK_HELD' "only the disk gate may set the disk marker"
    test_teardown
}

# A-j (Codex P2): both df probes failing must read as UNKNOWN, not as a full
# disk. free_gb used to echo 0, which the admission gate reads as "permanently
# full" — an unreadable df would park every image build until its budget
# expired, forever, on a host with terabytes free.
test_unreadable_df_is_unknown_not_full() {
    CURRENT_TEST_NAME="A-j: an unreadable df reports UNKNOWN, never 0 free"
    _setup_ladder 42
    local dead_df='df() { echo "df: cannot read table of mounted file systems" >&2; return 1; }'

    local free rc=0
    free=$( eval "$dead_df"; disk_pressure::free_gb ) || rc=$?
    assert_eq "$free" "" "free_gb must echo nothing when it cannot measure"
    assert_exit_code "$rc" "1" "free_gb must return non-zero so callers can tell UNKNOWN from 0"

    # The guard must still produce parseable JSON rather than a jq crash.
    local out
    out=$( eval "$dead_df"; disk_pressure::guard 2>/dev/null )
    assert_eq "$(echo "$out" | jq -r '.pruned')" "false" "an unmeasurable host prunes nothing"
    assert_eq "$(echo "$out" | jq -r '.error')" "df_unreadable" "and says why"
    test_teardown
}

# A-k (Codex P1): `rl status` runs under `set -euo pipefail`. A missing
# disk-pressure.json (every deploy before the sweeper's first cycle) or a
# truncated one must not abort the assignment and take the whole status
# command down fleet-wide. Exercises the real lines from the script.
test_status_tolerates_missing_or_garbage_state_file() {
    CURRENT_TEST_NAME="A-k: rl status survives a missing or corrupt disk-pressure.json"
    test_setup
    local status_bin block
    status_bin="$(cd "$TEST_DIR/../bin" && pwd)/status"
    # The disk block is self-contained: from the DISK_FS assignment through the
    # DISK_PRESSURE validation. Extracted so we can run it without /proc.
    block=$(sed -n '/^DISK_FS=/,/^jq -e . >\/dev\/null/p' "$status_bin")
    assert_neq "$block" "" "the disk block must be extractable from bin/status"

    local rc=0 out
    # (1) file absent
    out=$(RL_DISK_STATE_FILE="$RL_STATE_DIR/absent.json" \
        bash -c "set -euo pipefail; $block; echo \"\$DISK_PRESSURE|\$DISK_FREE_GB\"" 2>/dev/null) || rc=$?
    assert_exit_code "$rc" "0" "a missing state file must not abort the status script"
    assert_eq "${out%%|*}" "null" "disk_pressure must fall back to null"

    # (2) file present but not JSON (truncated mid-write)
    echo '{"used_pct": 4' > "$RL_STATE_DIR/garbage.json"
    rc=0
    out=$(RL_DISK_STATE_FILE="$RL_STATE_DIR/garbage.json" \
        bash -c "set -euo pipefail; $block; echo \"\$DISK_PRESSURE\"" 2>/dev/null) || rc=$?
    assert_exit_code "$rc" "0" "a corrupt state file must not abort the status script"
    assert_eq "$out" "null" "corrupt JSON must degrade to null, not leak a fragment"

    # (3) a good file is passed through untouched
    echo '{"used_pct":39,"free_gb":149,"last_prune_at":null,"last_rungs":[]}' > "$RL_STATE_DIR/good.json"
    rc=0
    out=$(RL_DISK_STATE_FILE="$RL_STATE_DIR/good.json" \
        bash -c "set -euo pipefail; $block; echo \"\$DISK_PRESSURE\"" 2>/dev/null) || rc=$?
    assert_exit_code "$rc" "0" "a valid state file must still work"
    assert_eq "$(echo "$out" | jq -r '.used_pct')" "39" "a valid state file is passed through"
    test_teardown
}

run_test "a-a-below-threshold" test_below_threshold_runs_nothing
run_test "a-b-stops-at-first-rung" test_ladder_stops_at_first_rung_that_hits_target
run_test "a-c-walks-all-rungs" test_ladder_walks_all_rungs
run_test "a-d-state-file-shape" test_state_file_shape
run_test "a-e-dry-run" test_dry_run_lists_without_running
run_test "a-f-sweeper-wiring" test_sweeper_wires_the_ladder
run_test "a-g-posix-df-fallback" test_posix_df_fallback
run_test "a-h-failed-rung-recorded" test_failed_rung_is_recorded_not_swallowed
run_test "a-i-disk-specific-marker" test_build_preflight_uses_disk_specific_marker
run_test "a-j-unreadable-df" test_unreadable_df_is_unknown_not_full
run_test "a-k-status-tolerates-state-file" test_status_tolerates_missing_or_garbage_state_file

print_test_summary
