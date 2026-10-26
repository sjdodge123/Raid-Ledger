#!/usr/bin/env bash
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

set -uo pipefail
CURRENT_TEST_FILE="registry-gc.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"
LIB="$(cd "$TEST_DIR/../bin" && pwd)/_registry_gc.sh"
DESTROY="$(cd "$TEST_DIR/../bin" && pwd)/env-destroy"
NOW=1800000000

# curl stub: tags/list → $TAGS; HEAD manifest → digest sha256:<tag>;
# GET manifest → config digest cfg-<tag>; GET blob → created from $AGES (tag=hours).
curl() {
    local args="$*" url="${*: -1}"
    echo "curl $args" >> "$CALL_LOG"
    case "$url" in
        */tags/list) jq -nc --arg t "$TAGS" '{name:"rl-allinone", tags:($t|split(" "))}' ;;
        */manifests/*)
            local tag="${url##*/}"
            if [[ "$args" == *DELETE* ]]; then return 0
            elif [[ "$args" == *-I* ]]; then printf 'HTTP/1.1 200 OK\r\nDocker-Content-Digest: sha256:%s\r\n\r\n' "$tag"
            else jq -nc --arg t "$tag" '{schemaVersion:2, config:{digest:("cfg-" + $t)}}'; fi ;;
        */blobs/cfg-*)
            local tag="${url##*/cfg-}" h
            h=$(tr ' ' '\n' <<<"$AGES" | sed -n "s/^${tag}=//p")
            jq -nc --argjson e "$(( NOW - ${h:-0} * 3600 ))" '{created:($e|todate)}' ;;
    esac
}
docker() { echo "docker $*" >> "$CALL_LOG"; [[ "$1" == ps ]] && printf '%s\n' ${PS_IMAGES:-}; return 0; }

_setup_gc() {
    test_setup
    CALL_LOG="$RL_STATE_DIR/calls.log"; : > "$CALL_LOG"
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json" RL_ADMISSION_FILE="$RL_STATE_DIR/admission.json"
    export RL_REGISTRY_GC_STATE_FILE="$RL_STATE_DIR/registry-gc.json" RL_REGISTRY_GC_NOW="$NOW"
    export RL_REGISTRY_URL="http://reg.test:5000" RL_REGISTRY_KEEP_N=2 RL_REGISTRY_RETENTION_HOURS=48
    echo '[]' > "$RL_ENVS_FILE"; echo '{"heavy_running":[]}' > "$RL_ADMISSION_FILE"
    PS_IMAGES=""
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
    assert_eq "$(jq -r '.gc' <<<"$out")" "skipped_build_admitted" "result names why"
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

run_test "r-a-selection" test_selection
run_test "r-b-delete-tag" test_delete_tag
run_test "r-c-sweep" test_sweep_deletes_and_collects
run_test "r-d-build-admitted" test_sweep_skips_gc_during_build
run_test "r-e-interval" test_sweep_interval_gate
run_test "r-f-env-destroy" test_env_destroy_deletes_own_tag
print_test_summary
