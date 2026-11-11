#!/usr/bin/env bash
# CURRENT_TEST_* are read by test_helpers.sh.
# shellcheck disable=SC2034
# ROK-2171 — env-destroy removes the destroyed env's LOCAL image
# (orchestrator/bin/_local_image_gc.sh), with `docker` replaced by a shell
# function — no daemon.
#
# Covered:
#   L-a  the env's own image is removed (`docker image rm <ref>`, no --force)
#   L-b  kept when another env names the same tag (any prefix spelling)
#   L-c  kept when a container (any state) uses it, or docker ps fails
#   L-d  a runner-labelled image is never removed
#   L-e  kept while an image build is building (parked builds do not block),
#        and when the admission ledger is unreadable
#   L-f  a failed `docker image rm` logs and returns 0; an absent image is a no-op
#   L-g  env-destroy calls it before dropping the env row; run-tests.sh runs us

set -uo pipefail
CURRENT_TEST_FILE="local-image-gc.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"
BIN="$(cd "$TEST_DIR/../bin" && pwd)"
DESTROY="$BIN/env-destroy"

# docker stub. IMAGE_ROLE: the rl.role label (IMAGE_ABSENT=1: inspect fails);
# PS_USERS: ids `docker ps -a --filter ancestor=` prints (PS_FAIL=1: it fails);
# RM_FAIL=1: `docker image rm` fails.
docker() {
    echo "docker $*" >> "$CALL_LOG"
    case "$1 ${2:-}" in
        "image inspect") [[ -n "${IMAGE_ABSENT:-}" ]] && return 1; echo "${IMAGE_ROLE:-}" ;;
        "image rm") [[ -n "${RM_FAIL:-}" ]] && { echo "conflict: unable to remove" >&2; return 1; }; return 0 ;;
        "ps -aq") [[ -n "${PS_FAIL:-}" ]] && return 1; [[ -n "${PS_USERS:-}" ]] && echo "$PS_USERS"; return 0 ;;
    esac
    return 0
}

_setup_li() {
    test_setup
    CALL_LOG="$RL_STATE_DIR/calls.log"; : > "$CALL_LOG"
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json" RL_ADMISSION_FILE="$RL_STATE_DIR/admission.json"
    echo '{"heavy_running":[]}' > "$RL_ADMISSION_FILE"
    jq -nc '[{slug:"s1", image:"registry.rl.lan:5000/rl-allinone:s1"},
             {slug:"s2", image:"registry.rl.lan:5000/rl-allinone:shared"},
             {slug:"s3", image:"127.0.0.1:5000/rl-allinone:shared"}]' > "$RL_ENVS_FILE"
    IMAGE_ROLE=""; IMAGE_ABSENT=""; PS_USERS=""; PS_FAIL=""; RM_FAIL=""
    # shellcheck disable=SC1091
    source "$BIN/_registry_gc.sh"
    # shellcheck disable=SC1091
    source "$BIN/_local_image_gc.sh"
}

_rm_count() { grep -c '^docker image rm' "$CALL_LOG"; }

test_removes_own_image() {
    CURRENT_TEST_NAME="L-a: destroy removes the env's own local image"
    _setup_li
    local err; err=$(local_image_gc::remove_env_image s1 2>&1 >/dev/null)
    assert_contains "$(cat "$CALL_LOG")" "docker image rm registry.rl.lan:5000/rl-allinone:s1" "s1's image is removed"
    assert_eq "$(grep -c -- '--force\|-f ' <(grep '^docker image rm' "$CALL_LOG"))" "0" "never --force"
    assert_contains "$err" "local image: removed registry.rl.lan:5000/rl-allinone:s1" "logs the removal"
    test_teardown
}

test_keeps_shared_tag() {
    CURRENT_TEST_NAME="L-b: kept when another env uses the same tag"
    _setup_li
    local err; err=$(local_image_gc::remove_env_image s2 2>&1 >/dev/null)
    assert_eq "$(_rm_count)" "0" "s3 names :shared under another prefix — keep it"
    assert_contains "$err" "kept registry.rl.lan:5000/rl-allinone:shared (another env uses tag shared)" "logs why"
    test_teardown
}

test_keeps_in_use() {
    CURRENT_TEST_NAME="L-c: kept when a container uses it or docker ps fails"
    _setup_li
    PS_USERS="abc123"
    local err; err=$(local_image_gc::remove_env_image s1 2>&1 >/dev/null)
    assert_eq "$(_rm_count)" "0" "a container of any state uses the image"
    assert_contains "$err" "1 container(s) use it" "logs the in-use reason"
    assert_contains "$(cat "$CALL_LOG")" "docker ps -aq --filter ancestor=registry.rl.lan:5000/rl-allinone:s1" "checks all containers (-a)"
    PS_USERS=""; PS_FAIL=1
    local_image_gc::remove_env_image s1 2>/dev/null
    assert_eq "$(_rm_count)" "0" "an unreadable container list keeps the image"
    test_teardown
}

test_keeps_runner_image() {
    CURRENT_TEST_NAME="L-d: a runner image is never removed"
    _setup_li
    IMAGE_ROLE="runner"
    local err; err=$(local_image_gc::remove_env_image s1 2>&1 >/dev/null)
    assert_eq "$(_rm_count)" "0" "rl.role=runner"
    assert_contains "$err" "labelled rl.role=runner" "logs why"
    test_teardown
}

test_keeps_during_build() {
    CURRENT_TEST_NAME="L-e: kept while an image build is building or the ledger is unreadable"
    _setup_li
    echo '{"heavy_running":[{"key":"b1","kind":"image_build"}]}' > "$RL_ADMISSION_FILE"
    local_image_gc::remove_env_image s1 2>/dev/null
    assert_eq "$(_rm_count)" "0" "a building image build may use the layers as cache"
    echo '{"heavy_running":[{"key":"b1","kind":"image_build","disk_parked":true},{"key":"t1","kind":"task"}]}' > "$RL_ADMISSION_FILE"
    local_image_gc::remove_env_image s1 2>/dev/null
    assert_eq "$(_rm_count)" "1" "a parked build and an ordinary task do not block it"
    : > "$CALL_LOG"; rm -f "$RL_ADMISSION_FILE"
    local_image_gc::remove_env_image s1 2>/dev/null
    assert_eq "$(_rm_count)" "0" "an unreadable ledger keeps the image (fail closed)"
    test_teardown
}

test_failure_is_not_fatal() {
    CURRENT_TEST_NAME="L-f: a failed rm or an absent image returns 0"
    _setup_li
    RM_FAIL=1
    local err rc; err=$(local_image_gc::remove_env_image s1 2>&1 >/dev/null); rc=$?
    assert_eq "$rc" "0" "a failed removal never fails the destroy"
    assert_contains "$err" "kept registry.rl.lan:5000/rl-allinone:s1 (docker image rm failed: conflict: unable to remove)" "logs the failure"
    RM_FAIL=""; IMAGE_ABSENT=1; : > "$CALL_LOG"
    local_image_gc::remove_env_image s1 2>/dev/null; rc=$?
    assert_eq "$rc" "0" "absent image"
    assert_eq "$(_rm_count)" "0" "nothing to remove"
    local_image_gc::remove_env_image no-such-env 2>/dev/null; rc=$?
    assert_eq "$rc" "0" "unknown slug"
    test_teardown
}

test_env_destroy_wiring() {
    CURRENT_TEST_NAME="L-g: env-destroy wires the removal before dropping the row"
    test_setup
    local stripped call_line drop_line
    stripped=$(grep -v '^[[:space:]]*#' "$DESTROY")
    assert_contains "$stripped" '_local_image_gc.sh"' "env-destroy sources the lib"
    assert_contains "$stripped" 'local_image_gc::remove_env_image "$SLUG" || true' "env-destroy calls it, best-effort"
    call_line=$(grep -n 'local_image_gc::remove_env_image "\$SLUG"' "$DESTROY" | cut -d: -f1)
    drop_line=$(grep -n 'map(select(.slug != \$slug))' "$DESTROY" | cut -d: -f1)
    assert_le "$call_line" "$drop_line" "removal runs while the env row still exists"
    assert_contains "$(grep -v '^[[:space:]]*#' "$TEST_DIR/run-tests.sh")" '/local-image-gc.test.sh"' "run-tests.sh runs this file"
    bash -n "$DESTROY"; assert_eq "$?" "0" "env-destroy parses"
    test_teardown
}

run_test "l-a-removes-own" test_removes_own_image
run_test "l-b-shared-tag" test_keeps_shared_tag
run_test "l-c-in-use" test_keeps_in_use
run_test "l-d-runner" test_keeps_runner_image
run_test "l-e-build" test_keeps_during_build
run_test "l-f-failure" test_failure_is_not_fatal
run_test "l-g-wiring" test_env_destroy_wiring
print_test_summary
