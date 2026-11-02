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
#   R-n  a locally built tag (docker images, no container/row yet) is protected;
#        an unreadable `docker images` aborts the sweep
#   R-o  a timed-out garbage-collect is pkill'd inside rl-registry
#   R-p  fail closed: a kept tag whose digest HEAD fails aborts the sweep
#        (protected_digest_unreadable, rc 1); env-destroy keeps its tag
#   R-q  digest-pinned refs (container, env row, local RepoDigests) protect
#   R-r  keep-N survivors and young tags protect a doomed tag sharing a digest
#   R-s  a 137 (timeout -k) also pkills; the pkill is itself under timeout
#   R-t  RL_REGISTRY_GC_DRY_RUN defaults to 1; sweep.sh logs the ledger path

set -uo pipefail
CURRENT_TEST_FILE="registry-gc.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"
LIB="$(cd "$TEST_DIR/../bin" && pwd)/_registry_gc.sh"
DESTROY="$(cd "$TEST_DIR/../bin" && pwd)/env-destroy"
NOW=1800000000

# The gc-sweeper image has flock; macOS may not. Stub it explicitly — the lib
# itself refuses to run without one (fail closed, R-y).
command -v flock >/dev/null 2>&1 || flock() { return 0; }
# curl stub: tags/list → $TAGS; HEAD manifest → digest sha256:<tag>;
# ($DIGESTS "tag=d" overrides it to sha256:d); GET manifest → config digest
# cfg-<tag>; GET blob → created from $AGES (tag=hours).
curl() {
    local args="$*" url="${*: -1}"
    echo "curl $args" >> "$CALL_LOG"
    case "$url" in
        */tags/list) [[ -n "${LIST_FAIL:-}" ]] && return 22; jq -nc --arg t "$TAGS" '{name:"rl-allinone", tags:($t|split(" "))}' ;;
        */manifests/*)
            local tag="${url##*/}"
            if [[ "$args" == *DELETE* ]]; then return 0
            elif [[ "$args" == *-I* ]]; then
                [[ " ${HEAD_FAIL:-} " == *" $tag "* ]] && return 22
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
    [[ "$1" == exec && "$*" == *pgrep* ]] && return "${PGREP_RC:-1}"
    # shellcheck disable=SC2086  # PS_IMAGES is a space-separated list on purpose
    if [[ "$1" == ps ]]; then [[ -n "${DOCKER_PS_FAIL:-}" ]] && return 1; printf '%s\n' ${PS_IMAGES:-}; fi
    # shellcheck disable=SC2086  # LOCAL_IMAGES is a space-separated list on purpose
    if [[ "$1" == images ]]; then
        [[ -n "${DOCKER_IMAGES_FAIL:-}" ]] && return 1
        # shellcheck disable=SC2086  # space-separated lists on purpose
        if [[ "$*" == *--digests* ]]; then printf '%s\n' ${LOCAL_DIGESTS:-}; else printf '%s\n' ${LOCAL_IMAGES:-}; fi
    fi
    return 0
}
# timeout stub: log the wrapper, then run the (stubbed) command — `[-k N] SECS cmd…`.
# TIMEOUT_RC set = the garbage-collect bound expires (124, or 137 after -k);
# CLEANUP_TIMEOUT_RC set = the in-container pkill's own bound expires.
timeout() {
    echo "timeout $*" >> "$CALL_LOG"
    [[ "$1" == -k ]] && shift 2; shift
    if [[ "$*" == *pkill* ]]; then [[ -n "${CLEANUP_TIMEOUT_RC:-}" ]] && return "$CLEANUP_TIMEOUT_RC"
    elif [[ "$*" == *pgrep* ]]; then :
    elif [[ -n "${TIMEOUT_RC:-}" ]]; then return "$TIMEOUT_RC"; fi
    "$@"
}

_setup_gc() {
    test_setup
    CALL_LOG="$RL_STATE_DIR/calls.log"; : > "$CALL_LOG"
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json" RL_ADMISSION_FILE="$RL_STATE_DIR/admission.json"
    export RL_REGISTRY_GC_STATE_FILE="$RL_STATE_DIR/registry-gc.json" RL_REGISTRY_GC_NOW="$NOW"
    export RL_REGISTRY_URL="http://reg.test:5000" RL_REGISTRY_KEEP_N=2 RL_REGISTRY_RETENTION_HOURS=48
    echo '[]' > "$RL_ENVS_FILE"; echo '{"heavy_running":[]}' > "$RL_ADMISSION_FILE"
    PS_IMAGES=""; DIGESTS=""; DOCKER_PS_FAIL=""; RL_REGISTRY_GC_DRY_RUN=0
    LOCAL_IMAGES=""; DOCKER_IMAGES_FAIL=""; TIMEOUT_RC=""; CLEANUP_TIMEOUT_RC=""
    TAGS=""; AGES=""; HEAD_FAIL=""; LIST_FAIL=""; LOCAL_DIGESTS=""; PGREP_RC=""
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
    TAGS="s1 s2"; DIGESTS="s1=same s2=same"
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

test_local_images_protected() {
    CURRENT_TEST_NAME="R-n: locally built tags are protected; docker images failure aborts"
    _setup_gc
    TAGS="a b fresh old"; AGES="a=1 b=2 fresh=300 old=200"
    LOCAL_IMAGES="registry.rl.lan:5000/rl-allinone:fresh <none>:<none> postgres:16"
    local out rc
    out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.deleted | join(",")' <<<"$out")" "old" "a built+pushed tag with no env yet survives"
    : > "$CALL_LOG"; DOCKER_IMAGES_FAIL=1
    out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_neq "$rc" "0" "docker images failure must fail the sweep"
    assert_eq "$(jq -r '.error' <<<"$out")" "protected_tags_unreadable" "result names the failure"
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "nothing deleted on a partial protected set"
    test_teardown
}

test_collect_timeout_kills_gc() {
    CURRENT_TEST_NAME="R-o: a timed-out garbage-collect is killed inside rl-registry"
    _setup_gc
    local out; out=$(registry_gc::collect 2>/dev/null)
    assert_eq "$(grep -c 'pkill' "$CALL_LOG")" "0" "no pkill when GC finishes"
    TIMEOUT_RC=124
    out=$(registry_gc::collect 2>/dev/null)
    assert_eq "$out" "timed_out" "result reports the timeout"
    assert_contains "$(cat "$CALL_LOG")" "docker exec rl-registry pkill -f garbage-collect" \
        "the in-container GC must not keep running against new pushes"
    test_teardown
}

test_unreadable_digest_fails_closed() {
    CURRENT_TEST_NAME="R-p: a kept tag with an unreadable digest aborts the sweep"
    _setup_gc
    TAGS="latest a b c old"; AGES="a=1 b=2 c=300 old=200"; HEAD_FAIL="latest"
    local out rc
    out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_eq "$rc" "1" "an unreadable protected digest fails the sweep"
    assert_eq "$(jq -r '.error' <<<"$out")" "protected_digest_unreadable" "result names the failure"
    HEAD_FAIL="a"
    out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_eq "$(jq -r '.error' <<<"$out")" "protected_digest_unreadable" "a keep-N survivor's digest counts too"
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "nothing deleted on an unknown digest"
    assert_eq "$(grep -c 'garbage-collect' "$CALL_LOG")" "0" "no GC either"
    HEAD_FAIL=""; PS_IMAGES="rl-allinone:gone"
    out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.deleted | sort | join(",")' <<<"$out")" "c,old" "a protected tag absent from the registry is no blocker"
    : > "$CALL_LOG"
    jq -nc '[{slug:"s1", image:"rl-allinone:s1"}]' > "$RL_ENVS_FILE"
    TAGS="s1 other"; HEAD_FAIL="other"
    registry_gc::delete_env_tag s1 >/dev/null 2>&1
    TAGS="s1"; HEAD_FAIL=""; LIST_FAIL=1
    registry_gc::delete_env_tag s1 >/dev/null 2>&1
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "env-destroy keeps its tag when any digest is unknown"
    test_teardown
}

test_digest_pinned_refs_protect() {
    CURRENT_TEST_NAME="R-q: digest-pinned container/env/local refs protect the manifest"
    _setup_gc
    TAGS="a b c d e old"; AGES="a=1 b=2 c=300 d=300 e=300 old=200"
    PS_IMAGES="registry.rl.lan:5000/rl-allinone@sha256:c"
    jq -nc '[{slug:"s9", image:"127.0.0.1:5000/rl-allinone:gone@sha256:d"}]' > "$RL_ENVS_FILE"
    LOCAL_DIGESTS="registry.rl.lan:5000/rl-allinone@sha256:e postgres@sha256:old rl-allinone@<none>"
    local out; out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.deleted | join(",")' <<<"$out")" "old" "pinned c, d and e survive; another repo's digest is ignored"
    : > "$CALL_LOG"
    jq -nc '[{slug:"s1", image:"rl-allinone:s1"}]' > "$RL_ENVS_FILE"
    TAGS="s1"; PS_IMAGES="rl-allinone@sha256:s1"
    registry_gc::delete_env_tag s1 >/dev/null 2>&1
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "env-destroy spares a digest a container pins"
    test_teardown
}

test_survivors_share_digest() {
    CURRENT_TEST_NAME="R-r: keep-N survivors and young tags protect a shared digest"
    _setup_gc
    TAGS="a b old1"; AGES="a=100 b=250 old1=200"
    RL_REGISTRY_KEEP_N=1; DIGESTS="a=same old1=same"
    local out; out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.deleted | join(",")' <<<"$out")" "b" "old1 shares the keep-N survivor a's digest"
    TAGS="y1 y2 b old2"; AGES="y1=1 y2=2 b=250 old2=300"; DIGESTS="y2=yd old2=yd"
    out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.deleted | join(",")' <<<"$out")" "b" "old2 shares the young (non-doomed) y2's digest"
    : > "$CALL_LOG"
    jq -nc '[{slug:"s1", image:"rl-allinone:s1"}]' > "$RL_ENVS_FILE"
    TAGS="s1 untracked"; DIGESTS="s1=x untracked=x"
    registry_gc::delete_env_tag s1 >/dev/null 2>&1
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "env-destroy spares a digest any other registry tag shares"
    test_teardown
}

test_collect_137_and_bounded_cleanup() {
    CURRENT_TEST_NAME="R-s: exit 137 is a timeout; the pkill cleanup is bounded"
    _setup_gc
    TIMEOUT_RC=137
    local out; out=$(registry_gc::collect 2>/dev/null)
    assert_eq "$out" "timed_out" "a KILL escalation is still a timeout"
    assert_contains "$(cat "$CALL_LOG")" "timeout -k 5 30 docker exec rl-registry pkill -f garbage-collect" \
        "the cleanup exec is bounded by timeout"
    CLEANUP_TIMEOUT_RC=124
    local err; err=$(registry_gc::collect 2>&1 >/dev/null)
    assert_contains "$err" "pkill garbage-collect in rl-registry failed" "a stuck cleanup is logged"
    test_teardown
}

test_dry_run_default() {
    CURRENT_TEST_NAME="R-t: dry run is the default; sweep.sh logs the admission ledger path"
    _setup_gc
    unset RL_REGISTRY_GC_DRY_RUN
    # shellcheck disable=SC1090
    source "$LIB"
    assert_eq "$RL_REGISTRY_GC_DRY_RUN" "1" "unset means dry run"
    TAGS="a b c old"; AGES="a=1 b=2 c=300 old=200"
    local out; out=$(registry_gc::sweep force 2>/dev/null)
    assert_eq "$(jq -r '.gc + " " + (.dry_run|tostring) + " " + (.deleted|sort|join(","))' <<<"$out")" \
        "dry_run true c,old" "a default sweep only reports would-delete tags"
    assert_eq "$(grep -c -- '-X DELETE' "$CALL_LOG")" "0" "a default sweep deletes nothing"
    local stripped; stripped=$(grep -v '^[[:space:]]*#' "$TEST_DIR/../../gc-sweeper/sweep.sh")
    # shellcheck disable=SC2016  # the literal source text, not an expansion
    assert_contains "$stripped" 'registry: admission ledger $RL_ADMISSION_FILE' "sweeper logs which admission.json it locks"
    test_teardown
}

test_untagged_pin_keeps_untagged() {
    CURRENT_TEST_NAME="R-u: a pin no kept tag carries → garbage-collect without --delete-untagged"
    _setup_gc
    TAGS="a b old"; AGES="a=1 b=2 old=200"; PS_IMAGES="rl-allinone@sha256:orphan"
    local err; err=$(registry_gc::sweep force 2>&1 >/dev/null)
    assert_contains "$(grep 'garbage-collect' "$CALL_LOG")" "registry garbage-collect /etc/docker/registry/config.yml" \
        "collect still runs (deleted manifests are swept)"
    assert_eq "$(grep -c -- '--delete-untagged' "$CALL_LOG")" "0" "an untagged pinned manifest is not collected"
    assert_contains "$err" "sha256:orphan" "the log says which pin forced it"
    : > "$CALL_LOG"; PS_IMAGES="rl-allinone@sha256:a"
    registry_gc::sweep force >/dev/null 2>&1
    assert_eq "$(grep -c '^docker exec .*--delete-untagged' "$CALL_LOG")" "1" "a pin carried by a kept tag keeps --delete-untagged"
    test_teardown
}

test_cleanup_failure_keeps_lock() {
    CURRENT_TEST_NAME="R-v: a collector that may still run keeps the GC entry and fails the sweep"
    _setup_gc
    TAGS="a"; AGES="a=1"; TIMEOUT_RC=124; CLEANUP_TIMEOUT_RC=124
    local out rc; out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_eq "$(jq -r '.gc' <<<"$out")" "timed_out_cleanup_failed" "the result names the failed cleanup"
    assert_eq "$rc" "1" "non-success"
    assert_eq "$(jq '[.heavy_running[] | select(.kind == "registry_gc")] | length' "$RL_ADMISSION_FILE")" "1" \
        "the entry stays until its TTL, so builds stay blocked"
    echo '{"heavy_running":[]}' > "$RL_ADMISSION_FILE"; CLEANUP_TIMEOUT_RC=""; PGREP_RC=0
    assert_eq "$(registry_gc::collect 2>/dev/null)" "timed_out_cleanup_failed" "pkill ran but the collector is still alive"
    PGREP_RC=1
    out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_eq "$(jq -r '.gc' <<<"$out") $rc" "timed_out 0" "a confirmed-dead collector is a plain timeout"
    assert_eq "$(jq '.heavy_running | length' "$RL_ADMISSION_FILE")" "0" "and the entry is released"
    test_teardown
}

test_minor_fail_closed() {
    CURRENT_TEST_NAME="R-w..R-z: unreadable tags/list, empty created, missing flock, sweeper stderr"
    _setup_gc
    TAGS="a"; LIST_FAIL=1
    local out rc; out=$(registry_gc::sweep force 2>/dev/null); rc=$?
    assert_eq "$(jq -r '.error' <<<"$out") $rc" "tags_unreadable 1" "R-w: an unreadable tags/list aborts"
    assert_eq "$(grep -c 'garbage-collect' "$CALL_LOG")" "0" "R-w: and runs no garbage-collect"
    LIST_FAIL=""; TAGS="a b"
    registry_gc::created_epoch() { echo ""; }
    assert_eq "$(registry_gc::_inventory | jq -c 'map(.created)')" "[null,null]" "R-x: an empty build time stays in the inventory as null"
    _setup_gc
    ( unset -f flock; PATH=/nonexistent; registry_gc::_define_state_shims; flock -x 200 ); rc=$?
    assert_neq "$rc" "0" "R-y: without flock the ledger lock fails instead of no-op'ing"
    local stripped; stripped=$(grep -v '^[[:space:]]*#' "$TEST_DIR/../../gc-sweeper/sweep.sh")
    assert_eq "$(grep -c 'registry_gc::sweep.*2>/dev/null' <<<"$stripped")" "0" "R-z: the sweeper keeps the lib's stderr"
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
run_test "r-n-local-images" test_local_images_protected
run_test "r-o-timeout-pkill" test_collect_timeout_kills_gc
run_test "r-p-digest-fail-closed" test_unreadable_digest_fails_closed
run_test "r-q-digest-pins" test_digest_pinned_refs_protect
run_test "r-r-survivor-digest" test_survivors_share_digest
run_test "r-s-137-cleanup" test_collect_137_and_bounded_cleanup
run_test "r-t-dry-run-default" test_dry_run_default
run_test "r-u-untagged-pin" test_untagged_pin_keeps_untagged
run_test "r-v-cleanup-keeps-lock" test_cleanup_failure_keeps_lock
run_test "r-w-minor-fail-closed" test_minor_fail_closed
print_test_summary
