#!/usr/bin/env bash
# CURRENT_TEST_* and RL_REGISTRY_* are read by test_helpers.sh / the sourced lib.
# shellcheck disable=SC2034
# 2026-10-26 — fleet registry garbage collection (fix/rl-infra-disk-gc).
#
# rl-registry was never garbage-collected: every env build pushes a ~1.5 GB
# rl-allinone:<slug> tag, 424 tags reached 134 GB and starved image builds.
# These tests drive orchestrator/bin/_registry_gc.sh with `curl` and `docker`
# replaced by shell functions — no registry, no daemon.
#
# Covered:
#   R-a  selection keeps live/latest tags, the newest N, and anything young
#   R-b  delete_tag resolves the digest then DELETEs the manifest by digest
#   R-c  sweep deletes doomed tags, then runs garbage-collect in rl-registry
#   R-d  sweep skips garbage-collect while an image build is admitted
#   R-e  sweep is interval-gated (state file) unless forced
#   R-f  env-destroy deletes the env's own tag, never one another env uses
#   R-g  sweep.sh wires the sweep under the compose mount; run-tests.sh runs us
#   R-h  env-destroy spares its tag when another env's tag shares the digest
#   R-i  env-destroy compares tags across registry-prefix spellings
#   R-j  sweep aborts (non-zero) when docker ps or the env registry is unreadable
#   R-k  a dry run writes the state file, so the interval gate holds
#   R-l  env-destroy honours RL_REGISTRY_GC_DRY_RUN ("would delete")
#   R-m  garbage-collect runs under `timeout`

set -uo pipefail
CURRENT_TEST_FILE="registry-gc.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"
LIB="$(cd "$TEST_DIR/../bin" && pwd)/_registry_gc.sh"
DESTROY="$(cd "$TEST_DIR/../bin" && pwd)/env-destroy"
NOW=1800000000

# curl stub: tags/list → $TAGS; HEAD manifest → digest sha256:<tag>;
# ($DIGESTS "tag=d" overrides it to sha256:d); GET manifest → config digest
# cfg-<tag>; GET blob → created from $AGES (tag=hours).
curl() {
    local args="$*" url="${*: -1}"
    echo "curl $args" >> "$CALL_LOG"
    case "$url" in
        */tags/list) jq -nc --arg t "$TAGS" '{name:"rl-allinone", tags:($t|split(" "))}' ;;
        */manifests/*)
            local tag="${url##*/}"
            if [[ "$args" == *DELETE* ]]; then return 0
            elif [[ "$args" == *-I* ]]; then
                local d; d=$(tr ' ' '\n' <<<"${DIGESTS:-}" | sed -n "s/^${tag}=//p")
                printf 'HTTP/1.1 200 OK\r\nDocker-Content-Digest: sha256:%s\r\n\r\n' "${d:-$tag}"
            else jq -nc --arg t "$tag" '{schemaVersion:2, config:{digest:("cfg-" + $t)}}'; fi ;;
        */blobs/cfg-*)
            local tag="${url##*/cfg-}" h
            h=$(tr ' ' '\n' <<<"$AGES" | sed -n "s/^${tag}=//p")
            jq -nc --argjson e "$(( NOW - ${h:-0} * 3600 ))" '{created:($e|todate)}' ;;
    esac
}
docker() {
    echo "docker $*" >> "$CALL_LOG"
    # shellcheck disable=SC2086  # PS_IMAGES is a space-separated list on purpose
    if [[ "$1" == ps ]]; then [[ -n "${DOCKER_PS_FAIL:-}" ]] && return 1; printf '%s\n' ${PS_IMAGES:-}; fi
    return 0
}
# timeout stub: log the wrapper, then run the (stubbed) command — `-k N SECS cmd…`.
timeout() { echo "timeout $*" >> "$CALL_LOG"; shift 3; "$@"; }

_setup_gc() {
    test_setup
    CALL_LOG="$RL_STATE_DIR/calls.log"; : > "$CALL_LOG"
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json" RL_ADMISSION_FILE="$RL_STATE_DIR/admission.json"
    export RL_REGISTRY_GC_STATE_FILE="$RL_STATE_DIR/registry-gc.json" RL_REGISTRY_GC_NOW="$NOW"
    export RL_REGISTRY_URL="http://reg.test:5000" RL_REGISTRY_KEEP_N=2 RL_REGISTRY_RETENTION_HOURS=48
    echo '[]' > "$RL_ENVS_FILE"; echo '{"heavy_running":[]}' > "$RL_ADMISSION_FILE"
    PS_IMAGES=""; DIGESTS=""; DOCKER_PS_FAIL=""; RL_REGISTRY_GC_DRY_RUN=0
    # shellcheck disable=SC1090
    source "$LIB"
}

test_selection() {
    CURRENT_TEST_NAME="R-a: keeps live, latest, newest N and young tags"
    _setup_gc
    local tags out
    tags='[{"tag":"latest","created":1},{"tag":"live","created":2},{"tag":"n1","created":1799990000},
           {"tag":"n2","created":1799980000},{"tag":"young","created":1799900000},{"tag":"old1","created":1700000000},
           {"tag":"old2","created":1600000000},{"tag":"unknown","created":null}]'
    out=$(registry_gc::select_doomed "$tags" '["live"]' | sort | tr '\n' ' ')
    assert_eq "$out" "old1 old2 " "only old, unprotected tags beyond the newest N are doomed"
    test_teardown
}

test_delete_tag() {
    CURRENT_TEST_NAME="R-b: delete_tag DELETEs the manifest by digest"
    _setup_gc
    registry_gc::delete_tag "rok-1" >/dev/null 2>&1
    assert_contains "$(cat "$CALL_LOG")" "-X DELETE http://reg.test:5000/v2/rl-allinone/manifests/sha256:rok-1" \
        "manifest must be deleted by its digest"
    test_teardown
}

test_sweep_deletes_and_collects() {
    CURRENT_TEST_NAME="R-c: sweep deletes doomed tags then garbage-collects"
    _setup_gc
    TAGS="latest live a b c old"; AGES="live=500 a=1 b=2 c=100 old=200"; PS_IMAGES="registry.rl.lan:5000/rl-allinone:live"
    local out; out=$(registry_gc::sweep 2>/dev/null)
    assert_eq "$(jq -r '.deleted | sort | join(",")' <<<"$out")" "c,old" "c and old are past retention and beyond the newest 2"
    assert_contains "$(cat "$CALL_LOG")" "docker exec rl-registry registry garbage-collect --delete-untagged" "GC runs in rl-registry"
    assert_eq "$(jq -r '.gc' <<<"$out")" "ran" "result reports the GC ran"
    assert_file_exists "$RL_REGISTRY_GC_STATE_FILE" "state file written"
    test_teardown
}

test_sweep_skips_gc_during_build() {
    CURRENT_TEST_NAME="R-d: no garbage-collect while an image build is admitted"
    _setup_gc
    TAGS="a b c old"; AGES="a=1 b=2 c=3 old=200"
    echo '{"heavy_running":[{"task_id":"t1","kind":"image_build"}]}' > "$RL_ADMISSION_FILE"
    local out; out=$(registry_gc::sweep 2>/dev/null)
    assert_eq "$(grep -c 'garbage-collect' "$CALL_LOG")" "0" "GC must not run during a build"
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "no tag is deleted while a build may be pushing"
    assert_eq "$(jq -r '.skipped' <<<"$out")" "build_admitted" "result names why"
    assert_file_not_exists "$RL_REGISTRY_GC_STATE_FILE" "a build-skipped sweep retries next tick"
    test_teardown
}

test_sweep_interval_gate() {
    CURRENT_TEST_NAME="R-e: sweep honours the interval unless forced"
    _setup_gc
    TAGS="a"; AGES="a=1"
    jq -nc --argjson e "$(( NOW - 60 ))" '{last_run_epoch:$e}' > "$RL_REGISTRY_GC_STATE_FILE"
    local out; out=$(registry_gc::sweep 2>/dev/null)
    assert_eq "$(jq -r '.skipped' <<<"$out")" "interval" "a recent run gates the next one"
    assert_eq "$(grep -c 'tags/list' "$CALL_LOG")" "0" "gated sweep makes no registry calls"
    out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.skipped // "none"' <<<"$out")" "none" "force bypasses the interval"
    test_teardown
}

test_env_destroy_deletes_own_tag() {
    CURRENT_TEST_NAME="R-f: env-destroy deletes its tag, never a shared one"
    _setup_gc
    jq -nc '[{slug:"s1", image:"registry.rl.lan:5000/rl-allinone:s1"},
             {slug:"s2", image:"registry.rl.lan:5000/rl-allinone:shared"},
             {slug:"s3", image:"registry.rl.lan:5000/rl-allinone:shared"},
             {slug:"s4", image:"registry.rl.lan:5000/rl-allinone:latest"}]' > "$RL_ENVS_FILE"
    registry_gc::delete_env_tag s1 >/dev/null 2>&1
    registry_gc::delete_env_tag s2 >/dev/null 2>&1
    registry_gc::delete_env_tag s4 >/dev/null 2>&1
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "1" "only s1's private tag is deleted"
    assert_contains "$(cat "$CALL_LOG")" "manifests/sha256:s1" "s1's digest"
    local stripped; stripped=$(grep -v '^[[:space:]]*#' "$DESTROY")
    assert_contains "$stripped" "registry_gc::delete_env_tag" "env-destroy calls the tag delete"
    test_teardown
}

test_sweeper_wires_registry_gc() {
    CURRENT_TEST_NAME="R-g: sweep.sh sources the lib from the compose mount and runs the sweep"
    test_setup
    local stripped; stripped=$(grep -v '^[[:space:]]*#' "$TEST_DIR/../../gc-sweeper/sweep.sh")
    assert_contains "$stripped" '/orchestrator-lib}/_registry_gc.sh' "lib resolves under /orchestrator-lib"
    assert_contains "$stripped" 'registry_gc::sweep' "sweeper calls registry_gc::sweep"
    assert_contains "$stripped" 'http://rl-registry:5000' "sweeper talks to the registry over rl-net"
    assert_contains "$stripped" 'registry: GC aborted' "sweeper logs an aborted registry sweep"
    bash -n "$TEST_DIR/../../gc-sweeper/sweep.sh"; assert_eq "$?" "0" "sweep.sh parses"
    assert_contains "$(grep -v '^[[:space:]]*#' "$TEST_DIR/run-tests.sh")" '/registry-gc.test.sh"' "run-tests.sh runs this file"
    test_teardown
}

test_env_destroy_spares_shared_digest() {
    CURRENT_TEST_NAME="R-h: env-destroy spares a tag whose digest another env's tag shares"
    _setup_gc
    jq -nc '[{slug:"s1", image:"registry.rl.lan:5000/rl-allinone:s1"},
             {slug:"s2", image:"registry.rl.lan:5000/rl-allinone:s2"}]' > "$RL_ENVS_FILE"
    DIGESTS="s1=same s2=same"
    registry_gc::delete_env_tag s1 >/dev/null 2>&1
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "deleting s1's digest would take s2's tag down too"
    test_teardown
}

test_env_destroy_normalises_prefix() {
    CURRENT_TEST_NAME="R-i: env-destroy treats registry-prefix spellings of a tag as one tag"
    _setup_gc
    jq -nc '[{slug:"s1", image:"registry.rl.lan:5000/rl-allinone:shared"},
             {slug:"s2", image:"127.0.0.1:5000/rl-allinone:shared"},
             {slug:"s3", image:"rl-allinone:solo"}]' > "$RL_ENVS_FILE"
    registry_gc::delete_env_tag s1 >/dev/null 2>&1
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "s2 still uses shared under another prefix"
    registry_gc::delete_env_tag s3 >/dev/null 2>&1
    assert_contains "$(cat "$CALL_LOG")" "manifests/sha256:solo" "an unprefixed ref still resolves its tag"
    test_teardown
}

test_sweep_aborts_on_unreadable_protection() {
    CURRENT_TEST_NAME="R-j: sweep aborts when docker ps or the env registry is unreadable"
    _setup_gc
    TAGS="a b c old"; AGES="a=1 b=2 c=300 old=200"; DOCKER_PS_FAIL=1
    local out rc
    out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_neq "$rc" "0" "docker ps failure must fail the sweep"
    assert_eq "$(jq -r '.error' <<<"$out")" "protected_tags_unreadable" "result names the failure"
    DOCKER_PS_FAIL=""; rm -f "$RL_ENVS_FILE"
    out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_neq "$rc" "0" "an unreadable env registry must fail the sweep"
    echo '{"not":"an array"}' > "$RL_ENVS_FILE"
    out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_neq "$rc" "0" "a malformed env registry must fail the sweep"
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "nothing deleted on a partial protected set"
    assert_eq "$(grep -c 'garbage-collect' "$CALL_LOG")" "0" "no GC either"
    test_teardown
}

test_dry_run_writes_state() {
    CURRENT_TEST_NAME="R-k: a dry run writes the state file and honours the interval"
    _setup_gc
    TAGS="a b c old"; AGES="a=1 b=2 c=300 old=200"; RL_REGISTRY_GC_DRY_RUN=1
    local out; out=$(registry_gc::sweep 2>/dev/null)
    assert_eq "$(jq -r '.dry_run' "$RL_REGISTRY_GC_STATE_FILE" 2>/dev/null)" "true" "dry-run state recorded"
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "dry run deletes nothing"
    out=$(registry_gc::sweep 2>/dev/null)
    assert_eq "$(jq -r '.skipped' <<<"$out")" "interval" "the next dry sweep is interval-gated"
    RL_REGISTRY_GC_DRY_RUN=0
    out=$(registry_gc::sweep 2>/dev/null)
    assert_eq "$(jq -r '.skipped // "none"' <<<"$out")" "none" "leaving dry-run is not gated by a dry run"
    test_teardown
}

test_env_destroy_dry_run() {
    CURRENT_TEST_NAME="R-l: env-destroy honours RL_REGISTRY_GC_DRY_RUN"
    _setup_gc
    jq -nc '[{slug:"s1", image:"registry.rl.lan:5000/rl-allinone:s1"}]' > "$RL_ENVS_FILE"
    RL_REGISTRY_GC_DRY_RUN=1
    local err; err=$(registry_gc::delete_env_tag s1 2>&1 >/dev/null)
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "dry run deletes nothing"
    assert_contains "$err" "would delete rl-allinone:s1" "dry run says what it would delete"
    local call; call=$(grep -v '^[[:space:]]*#' "$DESTROY" | grep 'registry_gc::delete_env_tag')
    assert_eq "$(grep -c '2>/dev/null' <<<"$call")" "0" "env-destroy keeps the tag log on stderr"
    test_teardown
}

test_collect_has_timeout() {
    CURRENT_TEST_NAME="R-m: garbage-collect is bounded by timeout"
    _setup_gc
    registry_gc::collect >/dev/null 2>&1
    assert_contains "$(cat "$CALL_LOG")" "timeout -k 10 1800 docker exec rl-registry registry garbage-collect" \
        "docker exec into the registry is wrapped in timeout"
    test_teardown
}

run_test "r-a-selection" test_selection
run_test "r-b-delete-tag" test_delete_tag
run_test "r-c-sweep" test_sweep_deletes_and_collects
run_test "r-d-build-admitted" test_sweep_skips_gc_during_build
run_test "r-e-interval" test_sweep_interval_gate
run_test "r-f-env-destroy" test_env_destroy_deletes_own_tag
run_test "r-g-sweeper-wiring" test_sweeper_wires_registry_gc
run_test "r-h-shared-digest" test_env_destroy_spares_shared_digest
run_test "r-i-prefix" test_env_destroy_normalises_prefix
run_test "r-j-protection-abort" test_sweep_aborts_on_unreadable_protection
run_test "r-k-dry-run-state" test_dry_run_writes_state
run_test "r-l-destroy-dry-run" test_env_destroy_dry_run
run_test "r-m-collect-timeout" test_collect_has_timeout
print_test_summary
