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
#   A-c  it walks all four rungs when earlier ones don't reach the target
#   A-d  disk-pressure.json is written with used_pct / free_gb / last_prune_at / last_rungs
#   A-e  dry-run reports the rungs it WOULD run without invoking docker
#   A-f  sweep.sh resolves the ladder under the path compose actually mounts
#   A-g  the POSIX df fallback works and never aborts a `set -e` caller
#   A-h  a denied/failed rung is recorded, not scored as a 0B success
#   A-i  the build pre-flight gates on the DISK marker, not the memory one
#   A-j  an unreadable df is UNKNOWN (fail open), never "0 GB free"
#   A-k  rl status survives a missing/corrupt disk-pressure.json
#   A-l  the builder rung uses the proxy-allowed legacy /build/prune route
#   A-m  a failing rung is logged and the ladder keeps walking
#   B-*  ROK-2111: the builder rung is skipped while the admission ledger holds
#        an image build or a heavy/medium task (or is unreadable), unless used%
#        is at/above RL_DISK_BUILDER_FORCE_PCT; a caller's own key is excluded
#   C-*  2026-11-10: a dangling_prune rung removes untagged images younger than
#        RL_IMAGE_PRUNE_AGE (classic-builder stage results, retagged
#        rl:ci-test predecessors), never with -a, behind the same build guard;
#        C-d..f: below RL_BUILD_MIN_FREE_GB it is forced unless an IMAGE BUILD
#        is running (review r1 MAJOR — the 92–95% starvation band)
#   C-j  a parked build freed mid-clean-up waits (bounded) on disk-ladder.lock,
#        which _walk holds exclusive for the whole ladder (review r3 MAJOR)
#   C-k  a queued ladder re-reads used% after the lock and skips when freed;
#        lock timeouts are in the result; an unopenable lock is logged (r4)

set -uo pipefail

CURRENT_TEST_FILE="disk-pressure-guard.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# DISK_PRESSURE_LIB_UNDER_TEST lets a reviewer run the suite against another
# copy of the library (e.g. `git show HEAD:…` in a temp file) to prove red.
LIB="${DISK_PRESSURE_LIB_UNDER_TEST:-$(cd "$TEST_DIR/../bin" && pwd)/_disk_pressure.sh}"
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
    unset RL_DISK_ROOT RL_DISK_BUILDER_FORCE_PCT RL_DISK_LADDER_SELF_KEYS RL_ADMISSION_HELD 2>/dev/null || true
    # ROK-2111: the builder rung reads the admission ledger and SKIPS when it
    # is unreadable, so every scenario starts from an idle (empty) ledger.
    export RL_ADMISSION_FILE="$RL_STATE_DIR/admission.json"
    _ledger '[]'
    # shellcheck disable=SC1090
    source "$LIB"
}

# Write the admission ledger with the given heavy_running array.
_ledger() {
    jq -nc --argjson r "$1" '{heavy_running: $r, heavy_waiting: []}' > "$RL_ADMISSION_FILE"
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
    CURRENT_TEST_NAME="A-c: ladder walks image, dangling + volume rungs when builder is not enough"
    # 98 → builder → 90 → image prune → 80 → dangling prune → 70 → volume prune → 39.
    _setup_ladder 98 90 80 70 39

    local out
    out=$(disk_pressure::guard 2>/dev/null)
    local log
    log=$(cat "$DOCKER_LOG")
    assert_eq "$(_docker_calls)" "4" "all four rungs must run"
    assert_contains "$log" "image prune -af" "rung 2 prunes unused images"
    assert_contains "$log" "until=48h" "rung 2 honours RL_IMAGE_PRUNE_AGE"
    assert_contains "$log" "label!=rl.role=runner" "rung 2 must never prune a runner image"
    assert_contains "$log" "volume prune -f" "rung 4 prunes anonymous volumes"
    assert_eq "$(echo "$out" | jq -r '.rungs | length')" "4" "four rungs recorded"
    assert_eq "$(echo "$out" | jq -r '.rungs[3].rung')" "volume_prune" "last rung is volume_prune"
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
    assert_eq "$(echo "$out" | jq -r '.rungs | length')" "4" "dry-run lists every rung it would run"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].would_run')" "true" "dry-run rungs are marked would_run"
    assert_file_not_exists "$RL_DISK_STATE_FILE" \
        "a dry run must not overwrite the state file rl_status.disk_pressure reads"
    test_teardown
}

# A-f: the library existing is not the fix, and neither is sourcing it from a
# path that is not mounted. Inside the gc-sweeper container the orchestrator
# bin dir is mounted read-only at /orchestrator-lib and nowhere else (the old
# /orchestrator/bin default was never mounted; TDB:1101 removed it). Resolving
# the lib under an unmounted path made the whole ladder a silent "library not
# found" no-op in production (review BLOCKER 1), which a grep-only assertion
# happily passed. So resolve the path the way sweep.sh does, with compose's own
# value, and prove the mount provides it.
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
        bash -c "$assign; echo \"\$DISK_PRESSURE_LIB\"")
    assert_eq "$resolved" "${container_dir}/_disk_pressure.sh" \
        "the resolved lib path must sit inside the mount compose provides"

    # TDB:1101: with DISCORD_SWEEP_LIB_DIR unset, sweep.sh's own default must
    # also land on the compose mount, not on the never-mounted /orchestrator/bin.
    local lib_assign lib_default
    lib_assign=$(grep -m1 '^DISCORD_SWEEP_LIB_DIR=' "$SWEEP_SCRIPT")
    assert_neq "$lib_assign" "" "sweep.sh must assign DISCORD_SWEEP_LIB_DIR"
    lib_default=$(env -u DISCORD_SWEEP_LIB_DIR -u ORCHESTRATOR_BIN_DIR \
        bash -c "$lib_assign; echo \"\$DISCORD_SWEEP_LIB_DIR\"")
    assert_eq "$lib_default" "$container_dir" \
        "DISCORD_SWEEP_LIB_DIR's default must be the dir compose mounts the helpers at"

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
    assert_eq "$(echo "$out" | jq -r '.rungs | length')" "4" "one denied route must not abort the ladder"
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

# A-l (2026-10-26): `docker builder prune` on a host with the buildx plugin is
# `docker buildx prune`, which reaches BuildKit over the hijacked POST /grpc
# endpoint (or `containers/buildx_buildkit_*/exec` for a docker-container
# builder). rl-docker-proxy allows neither — only POST /build/prune — so the
# admission gate's ladder failed every run with `ERROR: driver not running`.
# DOCKER_BUILDKIT=0 forces the CLI onto the legacy POST /build/prune, which
# the daemon serves by pruning its embedded BuildKit cache: the same cache the
# runners' `docker build` (buildx `docker` driver) fills.
test_builder_rung_uses_the_proxy_allowed_route() {
    CURRENT_TEST_NAME="A-l: builder rung forces the legacy /build/prune route (DOCKER_BUILDKIT=0)"
    _setup_ladder 92 60
    assert_contains "$(disk_pressure::rung_cmd builder_prune)" "DOCKER_BUILDKIT=0" \
        "builder rung must pin DOCKER_BUILDKIT=0 so buildx is bypassed"
    local seen
    seen=$(
        docker() { echo "docker $* BK=${DOCKER_BUILDKIT:-unset}" >> "$DOCKER_LOG"; echo "Total reclaimed space: 2GB"; }
        disk_pressure::guard >/dev/null 2>&1
        cat "$DOCKER_LOG"
    )
    assert_contains "$seen" "builder prune -af BK=0" "the docker call itself must see DOCKER_BUILDKIT=0"
    test_teardown
}

# A-m: a failing rung is LOGGED where the operator looks (the sweeper's log(),
# stderr elsewhere), not only buried in the state file — and the ladder walks on.
test_failed_rung_is_logged_and_ladder_continues() {
    CURRENT_TEST_NAME="A-m: a non-zero rung is logged and the next rungs still run"
    _setup_ladder 95 95 95 95
    local logged="$RL_STATE_DIR/log.txt" out
    out=$(
        log() { echo "$*" >> "$logged"; }
        docker() {
            echo "docker $*" >> "$DOCKER_LOG"
            [[ "$*" == builder* ]] && { echo "ERROR: driver not running" >&2; return 1; }
            echo "Total reclaimed space: 1GB"
        }
        disk_pressure::guard 2>/dev/null
    )
    assert_contains "$(cat "$logged" 2>/dev/null)" "builder_prune failed (exit 1)" "failure must be logged"
    assert_contains "$(cat "$logged" 2>/dev/null)" "driver not running" "log must carry the error text"
    assert_eq "$(echo "$out" | jq -r '[.rungs[].rung] | join(",")')" "builder_prune,image_prune,dangling_prune,volume_prune" \
        "the ladder must continue past the failed rung"
    test_teardown
}

# A-n: the sweeper's real log() prints to STDOUT. A failed rung's log line must
# not land in the rung JSON that guard/_walk return on stdout (Codex P2).
test_failed_rung_log_does_not_corrupt_stdout_json() {
    CURRENT_TEST_NAME="A-n: a stdout-printing log() leaves guard's JSON parseable"
    _setup_ladder 95 95 95 95
    local out
    out=$(
        log() { echo "[sweep] $*"; }
        docker() {
            echo "docker $*" >> "$DOCKER_LOG"
            [[ "$*" == builder* ]] && { echo "ERROR: driver not running" >&2; return 1; }
            echo "Total reclaimed space: 1GB"
        }
        disk_pressure::guard 2>/dev/null
    )
    assert_eq "$(echo "$out" | jq -r '[.rungs[].rung] | join(",")' 2>/dev/null)" "builder_prune,image_prune,dangling_prune,volume_prune" \
        "guard stdout must stay pure JSON when log() prints to stdout"
    test_teardown
}

# ── ROK-2111: builder-prune build guard ─────────────────────────────────────
# `docker builder prune -af` under a running `docker build` deletes the cache
# the build is writing and kills it mid-step. The gc-sweeper's 15-minute ladder
# and a build's own disk admission (force_ladder) both walked into that.

# Run guard with a capturing log(); echoes the guard JSON. $1 = log file.
_guard_logged() {
    local logged="$1"
    ( log() { echo "$*" >> "$logged"; }; disk_pressure::guard 2>/dev/null )
}

# Assert the builder rung was skipped for $1 and the ladder went on to rung 2.
_assert_builder_skipped() {
    local out="$1" reason="$2" logged="$3"
    assert_eq "$(grep -c 'builder prune' "$DOCKER_LOG" | tr -d ' ')" "0" "builder prune must NOT run ($reason)"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].rung')" "builder_prune" "rung 1 is still recorded"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].skipped // "none"')" "$reason" "rung 1 records why it was skipped"
    assert_eq "$(echo "$out" | jq -r '.rungs[1].rung')" "image_prune" "the ladder continues to image_prune"
    assert_contains "$(cat "$logged" 2>/dev/null)" "builder_prune skipped ($reason)" "the skip is logged with its reason"
}

test_builder_skipped_while_image_build_runs() {
    CURRENT_TEST_NAME="B-a: builder rung skipped while an image build holds the ledger"
    _setup_ladder 92 60
    _ledger '[{"key":"build-pr1-77","kind":"image_build","weight":"medium"}]'
    local logged="$RL_STATE_DIR/log.txt" out
    out=$(_guard_logged "$logged")
    _assert_builder_skipped "$out" "build_running" "$logged"
    assert_contains "$(cat "$logged")" "build-pr1-77" "the log names the entry that blocked the rung"
    assert_eq "$(echo "$out" | jq -r '.after_pct')" "60" "the remaining rungs still relieve the disk"
    test_teardown
}

test_builder_skipped_while_heavy_or_medium_task_runs() {
    CURRENT_TEST_NAME="B-b: builder rung skipped while a heavy or medium validate-ci task runs"
    local w out logged
    for w in heavy medium; do
        _setup_ladder 92 60
        _ledger "[{\"key\":\"local-vci-1\",\"kind\":\"task\",\"weight\":\"$w\"}]"
        logged="$RL_STATE_DIR/log.txt"
        out=$(_guard_logged "$logged")
        _assert_builder_skipped "$out" "build_running" "$logged"
        test_teardown
    done
    # A legacy entry (no weight/kind) counts as heavy, like _ADMISSION_JQ_DEFS.
    _setup_ladder 92 60
    _ledger '[{"key":"legacy-1"}]'
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    _assert_builder_skipped "$out" "build_running" "$RL_STATE_DIR/log.txt"
    test_teardown
}

test_builder_runs_with_light_or_gc_entries_only() {
    CURRENT_TEST_NAME="B-c: registry_gc does not block the builder rung; a light task does (review r1)"
    _setup_ladder 92 60
    _ledger '[{"key":"gc","kind":"registry_gc","weight":"light"}]'
    local out
    out=$(disk_pressure::guard 2>/dev/null)
    assert_contains "$(cat "$DOCKER_LOG")" "builder prune -af" "builder prune runs beside the registry sweep"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].skipped // "none"')" "none" "rung 1 is not marked skipped"
    test_teardown
    _setup_ladder 92 60
    _ledger '[{"key":"t-light","kind":"task","weight":"light"},{"key":"gc","kind":"registry_gc","weight":"light"}]'
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    _assert_builder_skipped "$out" "build_running" "$RL_STATE_DIR/log.txt"
    assert_eq "$(echo "$out" | jq -c '.rungs[0].blocked_by')" '["t-light"]' "a light task (it may run a docker build) blocks the builder rung"
    test_teardown
}

test_builder_skipped_when_ledger_unreadable() {
    CURRENT_TEST_NAME="B-d: an unreadable or missing ledger skips the builder rung (fail safe)"
    _setup_ladder 92 60
    echo 'not json{' > "$RL_ADMISSION_FILE"
    local out
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    _assert_builder_skipped "$out" "ledger_unreadable" "$RL_STATE_DIR/log.txt"
    test_teardown
    _setup_ladder 92 60
    rm -f "$RL_ADMISSION_FILE"
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    _assert_builder_skipped "$out" "ledger_unreadable" "$RL_STATE_DIR/log.txt"
    test_teardown
}

test_builder_ceiling_overrides_the_guard() {
    CURRENT_TEST_NAME="B-e: at/above RL_DISK_BUILDER_FORCE_PCT (default 95) the builder rung runs anyway"
    _setup_ladder 96 60
    _ledger '[{"key":"build-pr1-77","kind":"image_build","weight":"medium"}]'
    local logged="$RL_STATE_DIR/log.txt" out
    out=$(_guard_logged "$logged")
    assert_contains "$(cat "$DOCKER_LOG")" "builder prune -af" "default ceiling 95: 96% forces the prune"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].forced // false')" "true" "the rung records that the ceiling forced it"
    assert_eq "$(echo "$out" | jq -r '.rungs[0].forced_by // "none"')" "ceiling" "builder_prune records forced_by ceiling"
    assert_contains "$(cat "$logged" 2>/dev/null)" "builder_prune forced" "the override is logged"
    test_teardown
    # The knob is honoured: ceiling 90 forces at 92%, an unreadable ledger too.
    _setup_ladder 92 60
    echo 'garbage' > "$RL_ADMISSION_FILE"
    out=$(RL_DISK_BUILDER_FORCE_PCT=90; disk_pressure::guard 2>/dev/null)
    assert_contains "$(cat "$DOCKER_LOG")" "builder prune -af" "RL_DISK_BUILDER_FORCE_PCT=90 forces at 92%"
    test_teardown
}

test_builder_runs_with_no_tasks() {
    CURRENT_TEST_NAME="B-f: an idle ledger lets the builder rung run"
    _setup_ladder 92 60
    local out
    out=$(disk_pressure::guard 2>/dev/null)
    assert_eq "$(_docker_calls)" "1" "only the builder rung runs on an idle ledger"
    assert_contains "$(cat "$DOCKER_LOG")" "builder prune -af" "builder prune ran"
    test_teardown
}

test_builder_guard_excludes_own_key() {
    CURRENT_TEST_NAME="B-g: the caller's own ledger entry does not block its own ladder"
    _setup_ladder 92 60
    _ledger '[{"key":"build-pr1-77","kind":"image_build","weight":"medium"}]'
    ( RL_DISK_LADDER_SELF_KEYS="local-x build-pr1-77"; disk_pressure::guard >/dev/null 2>&1 )
    assert_contains "$(cat "$DOCKER_LOG")" "builder prune -af" "own key excluded → builder prune runs"
    test_teardown
}

# B-h: the build's own disk admission (_admission.sh acquire_disk →
# force_ladder) walks the same guarded ladder, passing its own keys.
test_acquire_disk_force_ladder_honours_guard() {
    CURRENT_TEST_NAME="B-h: acquire_disk's force_ladder skips the builder rung under another build"
    local adm="$TEST_DIR/../bin/_admission.sh" calls
    for other in no yes; do
        _setup_ladder 92 92 92 92
        if [[ "$other" == "yes" ]]; then
            _ledger '[{"key":"build-me-1","kind":"image_build"},{"key":"local-vci-9","kind":"task","weight":"heavy"}]'
        else
            _ledger '[{"key":"build-me-1","kind":"image_build"},{"key":"gc","kind":"registry_gc","weight":"light"}]'
        fi
        ( source "$adm" 2>/dev/null; source "$LIB"
          RL_ADMISSION_HELD="build-me-1" RL_BUILD_MIN_FREE_GB=1000 RL_BUILD_DISK_WAIT_S=0
          admission::acquire_disk "local-task-1" "" "" >/dev/null 2>&1 )
        calls=$(grep -c "builder prune" "$DOCKER_LOG" | tr -d ' ')
        if [[ "$other" == "yes" ]]; then
            assert_eq "$calls" "0" "another heavy task running → force_ladder must skip builder prune"
        else
            assert_eq "$calls" "1" "only its own entry → force_ladder runs builder prune"
        fi
        test_teardown
    done
}

# ── 2026-11-10: dangling_prune ──────────────────────────────────────────────
# The runners build with the classic builder, so builder_prune finds no cache;
# the waste is ~950 untagged stage images younger than image_prune's 48h cut.

test_dangling_rung_prunes_young_untagged_images_only() {
    CURRENT_TEST_NAME="C-a: dangling_prune runs after image_prune, dangling-only, younger cut-off"
    # 97 → builder 96 → image prune 95 → dangling prune 60 → stop.
    _setup_ladder 97 96 95 60
    local out line
    out=$(disk_pressure::guard 2>/dev/null)
    assert_eq "$(echo "$out" | jq -r '[.rungs[].rung] | join(",")')" "builder_prune,image_prune,dangling_prune" \
        "dangling_prune must be rung 3, after the aged image prune"
    line=$(sed -n 3p "$DOCKER_LOG")
    assert_contains "$line" "image prune -f --filter until=6h" "rung 3 prunes untagged images older than 6h"
    assert_eq "$([[ "$line" == *" -af "* || "$line" == *" -a "* ]] && echo has-a || echo dangling-only)" "dangling-only" \
        "rung 3 must never pass -a (that would remove tagged env images)"
    assert_contains "$line" "label!=rl.role=runner" "rung 3 must never prune a runner image"
    assert_eq "$(echo "$out" | jq -r '.after_pct')" "60" "the dangling rung relieves the disk"
    test_teardown
}

test_dangling_rung_shares_the_build_guard() {
    CURRENT_TEST_NAME="C-b: dangling_prune is skipped while a build runs, forced at the ceiling"
    _setup_ladder 92 90 85
    _ledger '[{"key":"build-pr1-77","kind":"image_build","weight":"medium"}]'
    local logged="$RL_STATE_DIR/log.txt" out
    out=$(_guard_logged "$logged")
    assert_eq "$(grep -c 'image prune -f ' "$DOCKER_LOG" | tr -d ' ')" "0" "dangling prune must NOT run under a build"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].skipped // "none"')" "build_running" "rung 3 records why it was skipped"
    assert_contains "$(cat "$logged" 2>/dev/null)" "dangling_prune skipped (build_running)" "the skip is logged"
    assert_eq "$(echo "$out" | jq -r '.rungs[3].rung')" "volume_prune" "the ladder continues to volume_prune"
    test_teardown
    _setup_ladder 96 96 96 60
    _ledger '[{"key":"build-pr1-77","kind":"image_build","weight":"medium"}]'
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    assert_contains "$(cat "$DOCKER_LOG")" "image prune -f --filter until=6h" "96% >= ceiling forces the dangling rung"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced // false')" "true" "the forced run is recorded"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced_by // "none"')" "ceiling" "dangling_prune records forced_by ceiling"
    test_teardown
}

test_dangling_rung_age_knob() {
    CURRENT_TEST_NAME="C-c: RL_DANGLING_PRUNE_AGE sets the dangling cut-off; dry run lists the rung"
    _setup_ladder 97 96 95 60
    RL_DANGLING_PRUNE_AGE=2h
    assert_contains "$(disk_pressure::rung_cmd dangling_prune)" "until=2h" "the knob is honoured"
    RL_DANGLING_PRUNE_AGE=6h
    RL_DISK_PRUNE_DRY_RUN=1
    local out
    out=$(disk_pressure::guard 2>/dev/null)
    assert_eq "$(echo "$out" | jq -r '[.rungs[] | select(.would_run) | .rung] | join(",")')" \
        "builder_prune,image_prune,dangling_prune,volume_prune" "dry run lists all four rungs"
    assert_eq "$(_docker_calls)" "0" "dry run invokes no docker"
    RL_DISK_PRUNE_DRY_RUN=0
    test_teardown
}

# C-d..f (review r1 MAJOR): image builds park below RL_BUILD_MIN_FREE_GB, which
# sits BELOW the 95% ceiling. With gates running back to back the guard alone
# never let the dangling rung relieve that band. df stub: free GB = (100-pct)*2,
# so 92% = 16 GB (< 20) and 85% = 30 GB.
test_dangling_forced_below_free_floor() {
    CURRENT_TEST_NAME="C-d: below the free floor dangling_prune runs although a non-build task holds the ledger"
    _setup_ladder 92 92 92 60
    _ledger '[{"key":"local-vci-1","kind":"task","weight":"medium"}]'
    local logged="$RL_STATE_DIR/log.txt" out
    out=$(_guard_logged "$logged")
    assert_eq "$(grep -c 'builder prune' "$DOCKER_LOG" | tr -d ' ')" "0" "builder_prune keeps its plain guard below 95%"
    assert_contains "$(cat "$DOCKER_LOG")" "image prune -f --filter until=6h" "16 GB free < 20 forces the dangling rung"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced_by // "none"')" "free_floor" "the rung records the floor forced it"
    assert_contains "$(cat "$logged" 2>/dev/null)" "dangling_prune forced at 16GB free" "the floor override is logged"
    test_teardown
    # A parked image build's own force_ladder: its own key is excluded, so the
    # rung is forced beside another (non-build) gate — the starvation case.
    _setup_ladder 92 92 92 60
    _ledger '[{"key":"build-me-1","kind":"image_build"},{"key":"local-vci-9","kind":"task","weight":"heavy"}]'
    out=$(RL_DISK_LADDER_SELF_KEYS="local-me build-me-1"; disk_pressure::guard 2>/dev/null)
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced_by // "none"')" "free_floor" "a parked build's own entry does not block the floor override"
    test_teardown
}

test_dangling_floor_spares_image_build() {
    CURRENT_TEST_NAME="C-e: below the free floor dangling_prune stays skipped while an image build runs"
    _setup_ladder 92 92 92 60
    _ledger '[{"key":"build-pr1-77","kind":"image_build","weight":"medium"},{"key":"local-vci-1","kind":"task","weight":"medium"}]'
    local logged="$RL_STATE_DIR/log.txt" out
    out=$(_guard_logged "$logged")
    assert_eq "$(grep -c 'image prune -f ' "$DOCKER_LOG" | tr -d ' ')" "0" "no dangling prune under a running image build"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].skipped // "none"')" "build_running" "rung 3 records the skip"
    assert_contains "$(cat "$logged" 2>/dev/null)" "but an image build is building (build-pr1-77)" "the log names the image build that held the floor override back"
    test_teardown
}

test_dangling_above_floor_still_skips() {
    CURRENT_TEST_NAME="C-f: above the free floor a running task still skips dangling_prune"
    _setup_ladder 85 85 85 85
    _ledger '[{"key":"local-vci-1","kind":"task","weight":"medium"}]'
    local logged="$RL_STATE_DIR/log.txt" out
    out=$(_guard_logged "$logged")
    assert_eq "$(grep -c 'image prune -f ' "$DOCKER_LOG" | tr -d ' ')" "0" "30 GB free >= 20: the plain guard applies"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].skipped // "none"')" "build_running" "rung 3 skipped as before"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced // false')" "false" "not forced"
    test_teardown
}

# C-g (review r2 MINOR): below the floor an unreadable ledger, or an unreadable
# free-GB reading, falls back to the plain skip — never a forced prune.
test_dangling_floor_fail_safe() {
    CURRENT_TEST_NAME="C-g: below the floor an unreadable ledger or free-GB reading still skips dangling_prune"
    local out
    _setup_ladder 92 92 92 92
    echo 'not json{' > "$RL_ADMISSION_FILE"
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    assert_eq "$(grep -c 'image prune -f ' "$DOCKER_LOG" | tr -d ' ')" "0" "unreadable ledger: no dangling prune"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].skipped // "none"')" "ledger_unreadable" "unreadable ledger: rung 3 skipped"
    test_teardown
    _setup_ladder 92 92 92 92
    _ledger '[{"key":"local-vci-1","kind":"task","weight":"medium"}]'
    out=$( disk_pressure::free_gb() { return 1; }; _guard_logged "$RL_STATE_DIR/log.txt" )
    assert_eq "$(grep -c 'image prune -f ' "$DOCKER_LOG" | tr -d ' ')" "0" "unreadable free GB: no dangling prune"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].skipped // "none"')" "build_running" "unreadable free GB: plain skip"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced // false')" "false" "unreadable free GB: not forced"
    test_teardown
}

# C-h (review r2 MAJOR): an image build PARKED on disk (disk_parked, set by
# acquire_disk) has not started building, so it does not block the floor
# override for the sweeper / rl_fleet_prune (no self keys) — one parked build,
# or two parked builds for a third caller. A building image build still does.
test_dangling_floor_ignores_disk_parked_builds() {
    CURRENT_TEST_NAME="C-h: disk-parked image builds do not block the free-floor override; a building one does"
    local out
    _setup_ladder 92 92 92 60
    _ledger '[{"key":"local-b-1","kind":"image_build","disk_parked":true},{"key":"local-vci-1","kind":"task","weight":"medium"}]'
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced_by // "none"')" "free_floor" "one parked build: sweeper call forces the rung"
    assert_contains "$(cat "$DOCKER_LOG")" "image prune -f --filter until=6h" "one parked build: dangling prune ran"
    test_teardown
    _setup_ladder 92 92 92 60
    _ledger '[{"key":"local-b-1","kind":"image_build","disk_parked":true},{"key":"local-b-2","kind":"image_build","disk_parked":true}]'
    out=$(RL_DISK_LADDER_SELF_KEYS="local-b-3"; _guard_logged "$RL_STATE_DIR/log.txt")
    assert_eq "$(echo "$out" | jq -r '.rungs[2].forced_by // "none"')" "free_floor" "two parked builds: a third caller forces the rung"
    test_teardown
    _setup_ladder 92 92 92 60
    _ledger '[{"key":"local-b-1","kind":"image_build","disk_parked":true},{"key":"local-b-2","kind":"image_build"}]'
    out=$(_guard_logged "$RL_STATE_DIR/log.txt")
    assert_eq "$(grep -c 'image prune -f ' "$DOCKER_LOG" | tr -d ' ')" "0" "a building image build still blocks the floor override"
    assert_eq "$(echo "$out" | jq -r '.rungs[2].skipped // "none"')" "build_running" "building: rung 3 skipped"
    assert_contains "$(cat "$RL_STATE_DIR/log.txt" 2>/dev/null)" "but an image build is building (local-b-2)" "the log names only the building one"
    test_teardown
}

# C-i (review r2 MAJOR): acquire_disk sets disk_parked on its own entries while
# it parks, and clears it when admitted and when it gives up; release (task end)
# drops the entry. Other entries are untouched.
test_acquire_disk_marks_and_clears_disk_parked() {
    CURRENT_TEST_NAME="C-i: acquire_disk marks its entries disk_parked while parked and clears the marker on admit / end"
    local adm="$TEST_DIR/../bin/_admission.sh" st="$TEST_DIR/../bin/_state.sh" seen="" outcome
    for outcome in admit timeout; do
        _setup_ladder 92 50
        _ledger '[{"key":"local-t-1","kind":"image_build"},{"key":"build-x-9","kind":"image_build"},{"key":"local-vci-1","kind":"task"}]'
        seen="$RL_STATE_DIR/seen.json"
        ( source "$st" 2>/dev/null; source "$adm" 2>/dev/null; source "$LIB"
          disk_pressure::force_ladder() {
              cp "$RL_ADMISSION_FILE" "$seen"
              [[ "$outcome" == "admit" ]] && echo 2 > "$DF_IDX"
              echo '{}'
          }
          RL_ADMISSION_HELD="build-x-9" RL_BUILD_MIN_FREE_GB=20 RL_BUILD_DISK_WAIT_S=0
          admission::acquire_disk "local-t-1" "" "" >/dev/null 2>&1
          echo "rc=$?" > "$RL_STATE_DIR/rc" )
        assert_eq "$(jq -c '[.heavy_running[] | select(.disk_parked == true) | .key]' "$seen" 2>/dev/null)" \
            '["local-t-1","build-x-9"]' "$outcome: while parked, its own two entries are disk_parked"
        assert_eq "$(jq -c '[.heavy_running[] | select(has("disk_parked")) | .key]' "$RL_ADMISSION_FILE")" \
            '[]' "$outcome: the marker is cleared when acquire_disk returns"
        assert_eq "$(jq -r '.heavy_running | length' "$RL_ADMISSION_FILE")" "3" "$outcome: no entry dropped"
        if [[ "$outcome" == "admit" ]]; then
            assert_eq "$(cat "$RL_STATE_DIR/rc")" "rc=0" "admit: acquire_disk returns 0"
        else
            assert_eq "$(cat "$RL_STATE_DIR/rc")" "rc=1" "timeout: acquire_disk returns disk_pressure"
        fi
        test_teardown
    done
    # Task end: release drops the (still-parked) entry entirely.
    _setup_ladder 92
    _ledger '[{"key":"local-t-1","kind":"image_build","disk_parked":true},{"key":"local-vci-1","kind":"task"}]'
    ( source "$st" 2>/dev/null; source "$adm" 2>/dev/null; admission::release "local-t-1" )
    assert_eq "$(jq -c '[.heavy_running[].key]' "$RL_ADMISSION_FILE")" '["local-vci-1"]' "task end: release drops the parked entry"
    test_teardown
}

# C-j needs a REAL flock(2): macOS ships no flock(1), and _state.sh's shim is a
# no-op. This perl stand-in takes the same `[-x|-s] [-n] [-w secs] <fd>` form
# and locks the caller's open fd (inherited), exactly as util-linux flock does.
# On Linux the real binary is used.
if ! command -v flock >/dev/null 2>&1 || [[ "$(type -t flock)" == "function" ]]; then
    flock() {
        perl -MFcntl=:flock -MTime::HiRes=sleep,time -e '
            my ($op, $nb, $w, $fd) = (LOCK_EX, 0, -1, undef);
            while (@ARGV) { my $a = shift;
                if ($a eq "-x") { $op = LOCK_EX } elsif ($a eq "-s") { $op = LOCK_SH }
                elsif ($a eq "-n") { $nb = 1 } elsif ($a eq "-w") { $w = shift } else { $fd = $a } }
            open(my $fh, ">>&=", $fd) or exit 1;
            exit(flock($fh, $op | LOCK_NB) ? 0 : 1) if $nb;
            my $end = $w < 0 ? undef : time + $w;
            until (flock($fh, $op | LOCK_NB)) { exit 1 if defined $end && time >= $end; sleep 0.05 }
            exit 0;' -- "$@"
    }
fi

# Bounded poll (≤10s) for a condition string; 1 when it never held.
_poll_until() {
    local i
    for i in $(seq 1 200); do eval "$1" && return 0; sleep 0.05; done
    return 1
}

# C-j (review r3 MAJOR): the forced dangling_prune frees the floor while a build
# is parked; the build re-polls, sees free disk and must NOT start while that
# prune is still deleting. _walk holds disk-ladder.lock exclusive for the whole
# ladder; the parked build waits on it (bounded, logged) before returning 0.
test_parked_build_waits_for_running_ladder() {
    CURRENT_TEST_NAME="C-j: a parked build freed mid-clean-up waits for the disk ladder lock before it starts"
    local adm="$TEST_DIR/../bin/_admission.sh" st="$TEST_DIR/../bin/_state.sh" ev log lock holder build probe wait_s
    for wait_s in 30 1; do
        _setup_ladder 92 50
        _ledger '[{"key":"local-t-1","kind":"image_build"}]'
        ev="$RL_STATE_DIR/events"; log="$RL_STATE_DIR/task.log"; lock="$RL_LOCK_DIR/disk-ladder.lock"
        : > "$ev"; : > "$log"
        # The sweeper's forced ladder, mid-prune: holds the lock until "go".
        ( exec 203>>"$lock"; flock -x 203; : > "$RL_STATE_DIR/held"
          _poll_until "[[ -e '$RL_STATE_DIR/go' ]]"; echo prune-done >> "$ev" ) &
        holder=$!
        _poll_until "[[ -e '$RL_STATE_DIR/held' ]]"
        # The parked build: its first poll is under the floor, then the disk is free.
        ( source "$st" 2>/dev/null; source "$adm" 2>/dev/null; source "$LIB"
          disk_pressure::force_ladder() { echo 2 > "$DF_IDX"; echo '{}'; }
          RL_BUILD_MIN_FREE_GB=20 RL_BUILD_DISK_WAIT_S=60 RL_DISK_LADDER_LOCK_WAIT_S="$wait_s"
          admission::acquire_disk "local-t-1" "" "$log" >/dev/null 2>&1
          echo "admitted rc=$?" >> "$ev" ) &
        build=$!
        if [[ "$wait_s" == 30 ]]; then
            _poll_until "grep -q 'disk-ladder.lock' '$log' || grep -q admitted '$ev'"
            : > "$RL_STATE_DIR/go"; wait "$holder" "$build"
            assert_eq "$(paste -sd, "$ev")" "prune-done,admitted rc=0" \
                "the build starts only after the running clean-up finished"
            assert_contains "$(cat "$log")" "waiting up to 30s for the running disk clean-up (disk-ladder.lock)" "the wait is logged"
            assert_contains "$(cat "$log")" "disk clean-up finished after" "the end of the wait is logged"
        else
            wait "$build"; : > "$RL_STATE_DIR/go"; wait "$holder"
            assert_eq "$(paste -sd, "$ev")" "admitted rc=0,prune-done" \
                "bounded: a stuck clean-up does not block the build past RL_DISK_LADDER_LOCK_WAIT_S"
            assert_contains "$(cat "$log")" "still running after 1s — build admitted anyway" "the give-up is logged"
        fi
        test_teardown
    done
    # _walk itself holds the lock exclusive while a rung runs.
    _setup_ladder 92 50
    probe="$RL_STATE_DIR/probe"; lock="$RL_LOCK_DIR/disk-ladder.lock"
    ( source "$LIB"
      eval "_orig_docker() $(declare -f docker | tail -n +2)"
      docker() { ( flock -s -n 203 ) 203>>"$lock" && echo free >> "$probe" || echo busy >> "$probe"; _orig_docker "$@"; }
      disk_pressure::guard >/dev/null 2>&1 )
    assert_eq "$(sort -u "$probe" | paste -sd, -)" "busy" "every rung runs with disk-ladder.lock held exclusive"
    test_teardown
}

# C-k (review r4 MINORs): a ladder that queued behind another re-reads used%
# once it holds the lock and skips the walk when the other freed the disk; a
# lock timeout is recorded in the result (callers drop stderr); a build that
# cannot open the lock file says so in its task log.
test_queued_ladder_rereads_and_records_lock() {
    CURRENT_TEST_NAME="C-k: a queued ladder re-reads the disk after the lock, records lock outcomes, logs an unopenable lock"
    local adm="$TEST_DIR/../bin/_admission.sh" st="$TEST_DIR/../bin/_state.sh" lock holder out err wait_s
    for wait_s in 30 1; do
        _setup_ladder 92 50
        lock="$RL_LOCK_DIR/disk-ladder.lock"; out="$RL_STATE_DIR/out.json"; err="$RL_STATE_DIR/err"; : > "$err"
        ( exec 203>>"$lock"; flock -x 203; : > "$RL_STATE_DIR/held"
          _poll_until "[[ -e '$RL_STATE_DIR/go' ]]" ) &
        holder=$!
        _poll_until "[[ -e '$RL_STATE_DIR/held' ]]"
        ( source "$LIB"; RL_DISK_LADDER_LOCK_WAIT_S="$wait_s"; disk_pressure::guard > "$out" 2> "$err" ) &
        if [[ "$wait_s" == 30 ]]; then
            # The sweeper read 92%, queued; the other ladder then freed the disk to 50%.
            _poll_until "grep -q 'waiting up to' '$err'"
            : > "$RL_STATE_DIR/go"; wait
            assert_eq "$(_docker_calls)" "0" "stale reading: the queued ladder runs no rung once the disk is free"
            assert_eq "$(jq -c '[.rungs[] | del(.waited_s)]' "$out")" \
                '[{"rung":"ladder_lock","lock":"waited","before_pct":92,"after_pct":50,"skipped":"no_longer_needed"}]' \
                "stale reading: the skip is recorded with the fresh reading"
        else
            wait "$!"; : > "$RL_STATE_DIR/go"; wait "$holder"
            assert_eq "$(jq -c '.rungs[0] | {rung, lock}' "$out")" '{"rung":"ladder_lock","lock":"timed_out"}' \
                "timeout: the unlocked walk is recorded in the result, not only on stderr"
            assert_neq "$(_docker_calls)" "0" "timeout: the ladder still walks (fails open)"
        fi
        test_teardown
    done
    # The build side cannot open the lock file: it says so instead of skipping silently.
    _setup_ladder 92 50
    _ledger '[{"key":"local-t-1","kind":"image_build"}]'
    : > "$RL_STATE_DIR/notadir"
    ( source "$st" 2>/dev/null; source "$adm" 2>/dev/null; source "$LIB"
      disk_pressure::force_ladder() { echo 2 > "$DF_IDX"; echo '{}'; }
      RL_LOCK_DIR="$RL_STATE_DIR/notadir" RL_BUILD_MIN_FREE_GB=20 RL_BUILD_DISK_WAIT_S=60
      admission::acquire_disk "local-t-1" "" "$RL_STATE_DIR/task.log" >/dev/null 2>&1 )
    assert_contains "$(cat "$RL_STATE_DIR/task.log")" "disk-ladder.lock not openable" "unopenable lock is logged on the build side"
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
run_test "a-l-builder-legacy-route" test_builder_rung_uses_the_proxy_allowed_route
run_test "a-m-failed-rung-logged" test_failed_rung_is_logged_and_ladder_continues
run_test "a-n-log-stays-off-stdout" test_failed_rung_log_does_not_corrupt_stdout_json
run_test "b-a-build-running-skips-builder" test_builder_skipped_while_image_build_runs
run_test "b-b-heavy-medium-task-skips-builder" test_builder_skipped_while_heavy_or_medium_task_runs
run_test "b-c-light-only-runs-builder" test_builder_runs_with_light_or_gc_entries_only
run_test "b-d-unreadable-ledger-skips" test_builder_skipped_when_ledger_unreadable
run_test "b-e-ceiling-forces-builder" test_builder_ceiling_overrides_the_guard
run_test "b-f-idle-ledger-runs-builder" test_builder_runs_with_no_tasks
run_test "b-g-own-key-excluded" test_builder_guard_excludes_own_key
run_test "b-h-acquire-disk-honours-guard" test_acquire_disk_force_ladder_honours_guard
run_test "c-a-dangling-rung" test_dangling_rung_prunes_young_untagged_images_only
run_test "c-b-dangling-build-guard" test_dangling_rung_shares_the_build_guard
run_test "c-c-dangling-age-knob" test_dangling_rung_age_knob
run_test "c-d-free-floor-forces-dangling" test_dangling_forced_below_free_floor
run_test "c-e-free-floor-spares-image-build" test_dangling_floor_spares_image_build
run_test "c-f-above-floor-still-skips" test_dangling_above_floor_still_skips
run_test "c-g-floor-fail-safe" test_dangling_floor_fail_safe
run_test "c-h-floor-ignores-disk-parked" test_dangling_floor_ignores_disk_parked_builds
run_test "c-i-acquire-disk-parked-marker" test_acquire_disk_marks_and_clears_disk_parked
run_test "c-j-parked-build-waits-for-ladder" test_parked_build_waits_for_running_ladder
run_test "c-k-queued-ladder-rereads" test_queued_ladder_rereads_and_records_lock

print_test_summary
