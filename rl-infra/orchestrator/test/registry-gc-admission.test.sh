#!/usr/bin/env bash
# CURRENT_TEST_* and RL_* knobs are read by test_helpers.sh / the sourced libs.
# shellcheck disable=SC2034
# ROK-2018 lane A — registry GC holds the image-build admission lock.
#
# `registry garbage-collect` marks blobs, then sweeps the unmarked ones. A push
# racing that window can lose a layer, so a GC run and an image build (the only
# pushers) must never be admitted together. The sweep takes a `registry_gc`
# entry in the same admission ledger builds use, for the whole sweep, and that
# entry expires on a timer because the sweeper's pid lives in another
# container (prune_dead only reaps pids on its own host).
#
# Covered:
#   G1  GC held → an image build is refused (registry_gc_running); a heavy
#       non-build task still admits; the GC entry reserves 0 MB
#   G2  an image build running → GC refused (image_build_running), no entry
#   G3  an image build waiting → GC refused (image_build_waiting) — GC yields
#   G4  an expired GC entry (foreign host) no longer blocks a build and is
#       dropped by prune_stale; an unexpired one survives both prunes
#   G5  the sweep holds the entry during garbage-collect and releases it on
#       every exit path (ran, aborted, dry run)
#   G6  a build started mid-sweep is never admitted until garbage-collect
#       returns, then is admitted (fifo handshakes, no sleeps)
#
# Sourced the way gc-sweeper/sweep.sh sources it: _registry_gc.sh alone, no
# _state.sh — the lib must bring its own admission helpers.

set -uo pipefail
CURRENT_TEST_FILE="registry-gc-admission.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"
LIB="$(cd "$TEST_DIR/../bin" && pwd)/_registry_gc.sh"
HOST_NAME="$(hostname 2>/dev/null || echo unknown)"

# The gc-sweeper image has flock; macOS may not. Stub it explicitly — the lib
# itself refuses to run without one (fail closed).
command -v flock >/dev/null 2>&1 || flock() { return 0; }
# curl stub: tags/list → $GC_TAGS (JSON array); manifest HEAD → sha256:<tag>;
# blobs → a 2020 build time. $CURL_HOOK (a function) runs on every manifest call.
curl() {
    local url="${*: -1}"
    case "$url" in
        */tags/list) echo "{\"name\":\"rl-allinone\",\"tags\":${GC_TAGS:-[]}}" ;;
        */manifests/*)
            [[ -n "${CURL_HOOK:-}" ]] && "$CURL_HOOK"
            if [[ "$*" == *DELETE* ]]; then echo "DELETE ${url##*/}" >> "$RL_STATE_DIR/deletes"
            elif [[ "$*" == *-I* ]]; then printf 'Docker-Content-Digest: sha256:%s\r\n' "${url##*/}"
            else echo '{"config":{"digest":"cfg"}}'; fi ;;
        */blobs/*) echo '{"created":"2020-01-01T00:00:00Z"}' ;;
    esac
    return 0
}
timeout() { [[ "$1" == -k ]] && shift 2; shift; "$@"; }
# docker stub: ps/images empty (or failing); `exec … garbage-collect` snapshots
# the ledger and, when GC_FIFO_IN is set, blocks until the test says go.
docker() {
    case "$1" in
        ps|images) [[ -n "${DOCKER_PS_FAIL:-}" ]] && return 1; return 0 ;;
        exec)
            [[ "$*" == *pgrep* ]] && return 1
            [[ "$*" == *pkill* || "$*" != *garbage-collect* ]] && return 0
            cp "$RL_ADMISSION_FILE" "$RL_STATE_DIR/during-collect.json"
            if [[ -n "${GC_FIFO_IN:-}" ]]; then
                echo in-collect > "$GC_FIFO_IN"
                read -r _ < "$GC_FIFO_GO"
                echo collect-end >> "$SEQ"
            fi ;;
    esac
    return 0
}

_setup_adm() {
    test_setup
    export RL_ADMISSION_FILE="$RL_STATE_DIR/admission.json" RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_REGISTRY_GC_STATE_FILE="$RL_STATE_DIR/registry-gc.json" RL_REGISTRY_URL="http://reg.test:5000"
    export RL_REGISTRY_GC_DRY_RUN=0 RL_REGISTRY_GC_TIMEOUT_SECONDS=1800
    printf 'MemTotal:       16777216 kB\nMemAvailable:   16000000 kB\n' > "$RL_STATE_DIR/meminfo"
    export RL_MEMINFO_PATH="$RL_STATE_DIR/meminfo" RL_HEAVY_TASK_SETTLE_SECONDS=0
    export RL_HEAVY_TASK_POLL_SECONDS=1 RL_LEDGER_ADMISSION_TIMEOUT_SECONDS=20 RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS=20
    export RL_MAX_IMAGE_BUILDS=1 RL_MAX_HEAVY_CONCURRENT=2 RL_ADMISSION_BUDGET_MB=12288
    echo '[]' > "$RL_ENVS_FILE"
    echo '{"heavy_running":[],"heavy_waiting":[]}' > "$RL_ADMISSION_FILE"
    DOCKER_PS_FAIL=""; GC_TAGS="[]"; CURL_HOOK=""; GC_FIFO_IN=""; GC_FIFO_GO=""; SEQ="$RL_STATE_DIR/seq"
    # shellcheck disable=SC1090
    source "$LIB"
    registry_gc::_load_admission
}

# seed '<jq array of entries>' '<jq array of waiters>' — live holders on this host.
_seed() {
    jq -n --argjson now "$(date +%s)" --argjson pid "$$" --arg host "$HOST_NAME" "($1) as \$r | (${2:-[]}) as \$w"' | {
        heavy_running: [ $r[] | {task_id: .key, admitted_at: "x", admitted_epoch: $now, mb: 5120,
                                 weight: "heavy", kind: "task", reserve_mb: 3072, pid: $pid, host: $host} + . ],
        heavy_waiting: [ $w[] | {task_id: .key, since: "x", since_epoch: $now, weight: "heavy",
                                 reserve_mb: 3072, pid: $pid, host: $host} + . ]
    }' > "$RL_ADMISSION_FILE"
}

_gc_n() { jq '[.heavy_running[] | select(.kind == "registry_gc")] | length' "$RL_ADMISSION_FILE"; }
_has() { jq -r --arg k "$1" '[.heavy_running[] | select(.key == $k)] | length' "$RL_ADMISSION_FILE"; }

test_gc_blocks_builds() {
    CURRENT_TEST_NAME="G1: GC held → image build refused, heavy task still admits, GC reserves 0"
    _setup_adm
    admission::gc_try_acquire registry-gc >/dev/null
    assert_eq "$?" "0" "GC is admitted on an empty ledger"
    assert_eq "$(jq -r '.heavy_running[0] | "\(.kind) \(.reserve_mb) \(.expires_epoch > 0)"' "$RL_ADMISSION_FILE")" \
        "registry_gc 0 true" "GC entry: kind registry_gc, 0 MB, an expiry"
    admission::_try_admit b1 b1 16000 5120 heavy image_build
    assert_eq "$(_has b1)" "0" "an image build must not be admitted while GC runs"
    assert_eq "$(admission::ledger_block_reason heavy image_build 3072 b1)" "registry_gc_running" \
        "the build's wait names the GC"
    admission::_try_admit h1 h1 16000 5120 heavy task
    assert_eq "$(_has h1)" "1" "a non-build heavy task does not wait on GC"
    test_teardown
}

test_build_running_refuses_gc() {
    CURRENT_TEST_NAME="G2: image build running → GC refused, no entry"
    _setup_adm
    _seed '[{key:"b1", kind:"image_build"}]'
    local reason; reason=$(admission::gc_try_acquire registry-gc); local rc=$?
    assert_eq "$rc" "1" "GC refused while a build is admitted"
    assert_eq "$reason" "image_build_running" "refusal names the build"
    assert_eq "$(_gc_n)" "0" "no GC entry was written"
    test_teardown
}

test_build_waiting_refuses_gc() {
    CURRENT_TEST_NAME="G3: image build waiting → GC yields"
    _setup_adm
    _seed '[]' '[{key:"b2", kind:"image_build"}]'
    local reason; reason=$(admission::gc_try_acquire registry-gc); local rc=$?
    assert_eq "$rc" "1" "GC refused while a build waits"
    assert_eq "$reason" "image_build_waiting" "refusal names the waiting build"
    assert_eq "$(_gc_n)" "0" "no GC entry was written"
    test_teardown
}

test_expired_gc_entry() {
    CURRENT_TEST_NAME="G4: an expired foreign-host GC entry stops blocking and is pruned"
    _setup_adm
    local now; now=$(date +%s)
    _seed "[{key:\"registry-gc\", kind:\"registry_gc\", weight:\"light\", mb:0, reserve_mb:0,
             host:\"sweeper-dead\", pid:999999, expires_epoch:$(( now + 600 ))}]"
    admission::prune_stale; admission::prune_dead
    assert_eq "$(_gc_n)" "1" "an unexpired GC entry on another host survives both prunes"
    admission::_try_admit b1 b1 16000 5120 heavy image_build
    assert_eq "$(_has b1)" "0" "and still blocks builds"
    _seed "[{key:\"registry-gc\", kind:\"registry_gc\", weight:\"light\", mb:0, reserve_mb:0,
             host:\"sweeper-dead\", pid:999999, expires_epoch:$(( now - 1 ))}]"
    assert_eq "$(admission::ledger_block_reason heavy image_build 3072 b1)" "" \
        "an expired GC entry no longer blocks a build, even before any prune"
    admission::prune_stale
    assert_eq "$(_gc_n)" "0" "prune_stale drops the expired GC entry"
    test_teardown
}

test_sweep_holds_and_releases() {
    CURRENT_TEST_NAME="G5: sweep holds the GC entry during collect, releases on every exit"
    _setup_adm
    local out; out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.gc' <<<"$out")" "ran" "the sweep garbage-collected"
    assert_eq "$(jq '[.heavy_running[] | select(.kind == "registry_gc")] | length' \
        "$RL_STATE_DIR/during-collect.json" 2>/dev/null)" "1" "the GC entry is held while garbage-collect runs"
    assert_eq "$(_gc_n)" "0" "released after a normal sweep"
    DOCKER_PS_FAIL=1
    out=$(registry_gc::sweep force 2>/dev/null); local rc=$?
    assert_eq "$rc" "1" "unreadable protection aborts"
    assert_eq "$(_gc_n)" "0" "released after an aborted sweep"
    DOCKER_PS_FAIL=""; RL_REGISTRY_GC_DRY_RUN=1
    out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.gc' <<<"$out")" "dry_run" "dry run"
    assert_eq "$(_gc_n)" "0" "released after a dry run"
    RL_REGISTRY_GC_DRY_RUN=0
    _seed '[{key:"b1", kind:"image_build"}]'
    out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.skipped' <<<"$out")" "build_admitted" "a running build skips the sweep"
    assert_eq "$(_has b1)" "1" "the build's own entry is untouched"
    test_teardown
}

test_concurrent_build_waits() {
    CURRENT_TEST_NAME="G6: a build started mid-sweep is admitted only after garbage-collect returns"
    _setup_adm
    if ! declare -F admission::acquire >/dev/null; then
        assert_eq "missing" "admission::acquire" "the GC lib must load the admission helpers"; test_teardown; return
    fi
    GC_FIFO_IN="$RL_STATE_DIR/in-collect"; GC_FIFO_GO="$RL_STATE_DIR/go"
    local fw="$RL_STATE_DIR/build-waiting" line
    mkfifo "$GC_FIFO_IN" "$GC_FIFO_GO" "$fw"
    : > "$SEQ"
    # Announce the build's first wait once, through a fifo (no polling).
    eval "$(declare -f admission::_mark_waiting | sed '1s/admission::_mark_waiting/_orig_mark_waiting/')"
    # shellcheck disable=SC2329  # invoked by admission::acquire
    admission::_mark_waiting() {
        _orig_mark_waiting "$@"
        [[ -e "$RL_STATE_DIR/announced" ]] && return 0
        : > "$RL_STATE_DIR/announced"; echo "waiting:${5:-}" > "$fw"
    }
    ( registry_gc::sweep force >/dev/null 2>&1; echo sweep-exit > "$GC_FIFO_IN" ) &
    local sweep_pid=$!
    read -r line < "$GC_FIFO_IN"
    assert_eq "$line" "in-collect" "the sweep reached garbage-collect"
    if [[ "$line" != in-collect ]]; then wait "$sweep_pid"; test_teardown; return; fi
    ( admission::acquire b1 b1 "" "" 5120 heavy image_build && echo build-admitted >> "$SEQ" ) &
    local build_pid=$!
    read -r line < "$fw"
    assert_eq "$line" "waiting:registry_gc_running" "the build waits on the GC"
    assert_eq "$(_has b1)" "0" "no build admitted while garbage-collect runs"
    echo go > "$GC_FIFO_GO"
    read -r line < "$GC_FIFO_IN"
    assert_eq "$line" "sweep-exit" "the sweep finished"
    wait "$sweep_pid"; wait "$build_pid"; local rc=$?
    assert_eq "$rc" "0" "the build is admitted once GC releases"
    assert_eq "$(tr '\n' ' ' < "$SEQ")" "collect-end build-admitted " "admission strictly after garbage-collect"
    test_teardown
}

test_suite_registers_us() {
    CURRENT_TEST_NAME="G7: run-tests.sh runs this file"
    # shellcheck disable=SC2016  # the literal "$TEST_DIR/…" line is what we look for
    assert_contains "$(cat "$TEST_DIR/run-tests.sh")" '"$TEST_DIR/registry-gc-admission.test.sh"' "registered"
}

# _gc_set '<jq update of the registry_gc entry>' [extra running entry] — mutate the held entry.
_gc_set() {
    jq --argjson now "$(date +%s)" --arg host "$HOST_NAME" --argjson pid "$$" "
        .heavy_running = [.heavy_running[] | if .kind == \"registry_gc\" then $1 else . end] + (${2:-[]})" \
        "$RL_ADMISSION_FILE" > "$RL_ADMISSION_FILE.t" && mv "$RL_ADMISSION_FILE.t" "$RL_ADMISSION_FILE"
}
_B1='[{key:"b1", task_id:"b1", kind:"image_build", weight:"medium", mb:5120, reserve_mb:3072, admitted_epoch:$now, host:$host, pid:$pid}]'
# shellcheck disable=SC2329  # CURL_HOOK targets
_hook_expire_admit() { [[ -e "$RL_STATE_DIR/hooked" ]] && return 0; : > "$RL_STATE_DIR/hooked"; _gc_set '.expires_epoch = ($now - 1)' "$_B1"; }
# shellcheck disable=SC2329
_hook_near_expiry() {
    [[ -e "$RL_STATE_DIR/hooked" ]] || { : > "$RL_STATE_DIR/hooked"; _gc_set '.expires_epoch = ($now + 2)'; }
    jq '[.heavy_running[] | select(.kind == "registry_gc") | .expires_epoch][0]' "$RL_ADMISSION_FILE" > "$RL_STATE_DIR/last-exp"
}

test_renew_precondition() {
    CURRENT_TEST_NAME="G8: gc_renew refuses an expired entry or one with a build admitted"
    _setup_adm
    admission::gc_try_acquire registry-gc >/dev/null
    _gc_set '.expires_epoch = ($now + 5)'
    admission::gc_renew registry-gc; assert_eq "$?" "0" "a live entry with no build renews"
    assert_eq "$(jq '.heavy_running[0].expires_epoch > (now + 1000)' "$RL_ADMISSION_FILE")" "true" "expiry pushed out"
    _gc_set '.expires_epoch = ($now - 1)' "$_B1"
    admission::gc_renew registry-gc; assert_eq "$?" "1" "an expired entry is never revived"
    assert_eq "$(jq '[.heavy_running[] | select(.kind == "registry_gc") | .expires_epoch < now][0]' "$RL_ADMISSION_FILE")" \
        "true" "and its expiry is left in the past"
    _gc_set '.expires_epoch = ($now + 600)'
    admission::gc_renew registry-gc; assert_eq "$?" "1" "a live entry with a build admitted (fail-open path) is not renewed"
    test_teardown
}

test_lock_lost_mid_sweep() {
    CURRENT_TEST_NAME="G9: entry expired and a build admitted mid-inventory → sweep stops, no delete, no collect"
    _setup_adm
    GC_TAGS='["a","b","c"]'; RL_REGISTRY_KEEP_N=0; CURL_HOOK=_hook_expire_admit
    local out; out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.gc' <<<"$out")" "skipped_lock_lost" "the sweep reports the lost lock"
    assert_file_not_exists "$RL_STATE_DIR/during-collect.json" "garbage-collect never ran"
    assert_file_not_exists "$RL_STATE_DIR/deletes" "no tag deleted after the lock was lost"
    assert_eq "$(_has b1)" "1" "the build keeps its admission"
    test_teardown
}

test_long_sweep_renews() {
    CURRENT_TEST_NAME="G10: a healthy long sweep renews the entry while it processes tags"
    _setup_adm
    GC_TAGS='["a","b","c"]'; RL_REGISTRY_KEEP_N=0; RL_REGISTRY_GC_DRY_RUN=1; CURL_HOOK=_hook_near_expiry
    registry_gc::sweep force >/dev/null 2>&1
    assert_eq "$(jq '. > (now + 1000)' "$RL_STATE_DIR/last-exp" 2>/dev/null)" "true" \
        "the entry was re-armed during tag processing, not only before collect"
    test_teardown
}

# _start_build <id> <weight> — task-start an image build; echo its terminal status.
_start_build() {
    bash "$BIN_DIR/task-start" "$1" --tool build-image --slot 1 --weight "$2" -- /bin/sh -c "exit 0" >/dev/null 2>&1
    local i st
    for (( i = 0; i < 150; i++ )); do
        st=$(jq -r '.status // "missing"' "$RL_TASKS_DIR/$1.json" 2>/dev/null)
        case "$st" in succeeded|failed|cancelled) echo "$st"; return 0 ;; esac
        sleep 0.1
    done
    echo "$st"
}

test_light_build_respects_gc() {
    CURRENT_TEST_NAME="G11: a light-weight image build takes admission and waits on a live GC"
    _setup_adm
    export RL_DISK_GATE=0 RL_LEDGER_ADMISSION_TIMEOUT_SECONDS=2 RL_HEAVY_TASK_ADMISSION_TIMEOUT_SECONDS=2
    _seed "[{key:\"registry-gc\", kind:\"registry_gc\", weight:\"light\", mb:0, reserve_mb:0,
             host:\"sweeper\", pid:1, expires_epoch:$(( $(date +%s) + 600 ))}]"
    assert_eq "$(_start_build abcd1111 light)" "failed" "a light build must not run while GC is live"
    assert_contains "$(cat "$RL_TASKS_DIR/abcd1111.log" 2>/dev/null)" "registry_gc_running" "it waited on the GC"
    export RL_MEMINFO_PATH="$RL_STATE_DIR/no-meminfo"
    admission::acquire b2 b2 "" "" 5120 medium image_build; local rc=$?
    assert_eq "$rc" "1" "an unreadable MemAvailable does not admit a build past a live GC"
    test_teardown
}

run_test "g1-gc-blocks-builds" test_gc_blocks_builds
run_test "g2-build-running" test_build_running_refuses_gc
run_test "g3-build-waiting" test_build_waiting_refuses_gc
run_test "g4-expiry" test_expired_gc_entry
run_test "g5-hold-release" test_sweep_holds_and_releases
run_test "g6-concurrent-build" test_concurrent_build_waits
run_test "g7-registered" test_suite_registers_us
run_test "g8-renew-precondition" test_renew_precondition
run_test "g9-lock-lost" test_lock_lost_mid_sweep
run_test "g10-long-sweep-renews" test_long_sweep_renews
run_test "g11-light-build" test_light_build_respects_gc
print_test_summary
