#!/usr/bin/env bash
# ROK-1846 AC2 — the runner-facing Docker API guard (rl-infra/docker-guard)
# refuses every containers/create shape that makes a runner VM root, and still
# lets the shapes the fleet actually uses through (a testcontainers postgres,
# the validate-ci redis sidecar on rl-net).
#
# Drives the guard's pure policy through bin/check.mjs (exit 0 ALLOW, 1 DENY),
# so no Docker daemon is needed. Revert-proof: before ROK-1846 there was no
# guard at all — runners held the raw /var/run/docker.sock — so every DENY
# case below was an ALLOW.
#
# macOS bash 3.2 compatible. Needs node (>= 18).

set -uo pipefail

CURRENT_TEST_FILE="docker-guard-policy.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

CHECK="$(cd "$TEST_DIR/../../docker-guard" && pwd)/bin/check.mjs"

# probe <method> <url> <body-json> → sets PROBE_OUT / PROBE_RC
probe() {
    PROBE_OUT=$(jq -nc --arg m "$1" --arg u "$2" --argjson b "$3" '{method:$m, url:$u, body:$b}' \
        | node "$CHECK" 2>&1)
    PROBE_RC=$?
}

expect_deny() {
    probe "$1" "$2" "$3"
    assert_exit_code "$PROBE_RC" 1 "$4 must be refused (got: $PROBE_OUT)"
    assert_contains "$PROBE_OUT" "DENY" "$4 prints DENY"
}

expect_allow() {
    probe "$1" "$2" "$3"
    assert_exit_code "$PROBE_RC" 0 "$4 must be allowed (got: $PROBE_OUT)"
}

CREATE="/v1.45/containers/create"

test_privileged_create_refused() {
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Privileged":true}}' "privileged create"
    assert_contains "$PROBE_OUT" "Privileged" "reason names Privileged"
}

test_host_root_bind_refused() {
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Binds":["/:/host"]}}' "/:/host bind"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Binds":["/var/run/docker.sock:/var/run/docker.sock"]}}' "docker.sock bind"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Mounts":[{"Type":"bind","Source":"/srv/rl-infra","Target":"/x"}]}}' "Mounts bind of /srv/rl-infra"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Mounts":[{"Type":"volume","Source":"v","Target":"/x","VolumeOptions":{"DriverConfig":{"Name":"local","Options":{"type":"none","o":"bind","device":"/"}}}}]}}' "volume-in-disguise mount"
}

test_capadd_and_devices_refused() {
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"CapAdd":["SYS_ADMIN"]}}' "CapAdd create"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Devices":[{"PathOnHost":"/dev/sda","PathInContainer":"/dev/sda"}]}}' "Devices create"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"SecurityOpt":["apparmor=unconfined"]}}' "unconfined SecurityOpt"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"VolumesFrom":["rl-gc-sweeper"]}}' "VolumesFrom an infra container"
}

test_host_namespaces_refused() {
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"NetworkMode":"host"}}' "NetworkMode=host"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"PidMode":"host"}}' "PidMode=host"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"IpcMode":"host"}}' "IpcMode=host"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"UsernsMode":"host"}}' "UsernsMode=host"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"NetworkMode":"container:rl-traefik"}}' "joining an infra netns"
}

test_reserved_labels_refused() {
    # AC5 defence in depth: a runner cannot forge an env container.
    expect_deny POST "$CREATE" '{"Image":"alpine","Labels":{"rl.role":"env","rl.env_slug":"victim","rl.ttl":"0h"}}' "forged rl.role=env labels"
}

test_testcontainers_shaped_create_allowed() {
    # What @testcontainers/postgresql sends (Ryuk disabled on the runners).
    expect_allow POST "$CREATE?name=tc-pg" '{"Image":"pgvector/pgvector:pg16","Env":["POSTGRES_PASSWORD=test"],"ExposedPorts":{"5432/tcp":{}},"Labels":{"org.testcontainers":"true","org.testcontainers.session-id":"abc"},"HostConfig":{"PortBindings":{"5432/tcp":[{"HostPort":""}]},"Tmpfs":{"/var/lib/postgresql/data":"rw"}}}' "testcontainers postgres create"
    # validate-ci.sh's redis sidecar.
    expect_allow POST "$CREATE?name=rl-test-redis-1" '{"Image":"redis:7-alpine","Labels":{"rl.role":"test-redis","rl.slot":"1"},"HostConfig":{"NetworkMode":"rl-net","AutoRemove":true}}' "redis sidecar on rl-net"
    expect_allow POST "$CREATE" '{"Image":"alpine","HostConfig":{"Binds":["named-vol:/data"]}}' "named-volume bind"
}

test_other_escape_routes_refused() {
    expect_deny POST "/v1.45/build?networkmode=host&t=x" '{}' "build with networkmode=host"
    expect_deny POST "/v1.45/volumes/create" '{"Name":"v","DriverOpts":{"type":"none","o":"bind","device":"/"}}' "volume bound to /"
    expect_deny POST "/v1.45/plugins/pull" '{}' "plugin install"
    expect_deny POST "/v1.45/services/create" '{}' "swarm service"
    expect_deny POST "/v1.45/session" '{}' "BuildKit session (opaque gRPC)"
    expect_deny POST "/v1.45/containers/rl-gc-sweeper/update" '{}' "container update"
    expect_allow POST "/v1.45/build?t=rl:ci-test" '{}' "plain legacy build"
}

test_json_case_fold_bypass_refused() {
    # Go's encoding/json matches fields case-insensitively (and folds U+017F to
    # 's'), so Docker honours these spellings even though the guard reads
    # HostConfig.Privileged / HostConfig.Binds.
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"privileged":true}}' "lower-case privileged"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Privileged":false,"PRIVILEGED":true}}' "case-variant duplicate Privileged"
    expect_deny POST "$CREATE" '{"Image":"alpine","hostconfig":{"Binds":["/:/host"]}}' "lower-case hostconfig"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Bind\u017f":["/:/host"]}}' "long-s Binds"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Mounts":[{"type":"bind","Source":"/","Target":"/h"}]}}' "lower-case Mounts[].type"
    expect_deny POST "/v1.45/containers/x/exec" '{"Cmd":["sh"],"privileged":true}' "lower-case exec privileged"
}

test_links_cgroup_volumedriver_refused() {
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Links":["rl-gc-sweeper:s"]}}' "legacy link (copies the target Env)"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"Cgroup":"container:rl-traefik"}}' "joining an infra cgroup"
    expect_deny POST "$CREATE" '{"Image":"alpine","HostConfig":{"VolumeDriver":"evil"}}' "plugin VolumeDriver"
}

test_daemon_fetch_and_path_tricks_refused() {
    # The daemon would fetch these from the VM host network (127.0.0.1:2375).
    expect_deny POST "/v1.45/build?remote=http://127.0.0.1:2375/containers/rl-env-x/json" '{}' "build remote= SSRF"
    expect_deny POST "/v1.45/build?networkmode=default&networkmode=host" '{}' "second networkmode=host"
    expect_deny POST "/v1.45/build?cgroupparent=/" '{}' "build cgroupparent"
    expect_deny POST "/v1.45/images/create?fromSrc=http://127.0.0.1:2375/info" '{}' "image import fromSrc SSRF"
    expect_allow POST "/v1.45/images/create?fromImage=redis&tag=7-alpine" '{}' "plain image pull"
    expect_deny POST "/v1.45/containers/x/json/../../create" '{"HostConfig":{"Privileged":true}}' "dot-dot path"
    expect_deny POST "/v1.45/containers%2Fcreate" '{}' "percent-escaped path"
    expect_deny GET "//containers/json" '{}' "double-slash path"
}

run_test "privileged-create-refused" test_privileged_create_refused
run_test "host-root-bind-refused" test_host_root_bind_refused
run_test "capadd-and-devices-refused" test_capadd_and_devices_refused
run_test "host-namespaces-refused" test_host_namespaces_refused
run_test "reserved-labels-refused" test_reserved_labels_refused
run_test "testcontainers-shaped-create-allowed" test_testcontainers_shaped_create_allowed
run_test "other-escape-routes-refused" test_other_escape_routes_refused
run_test "json-case-fold-bypass-refused" test_json_case_fold_bypass_refused
run_test "links-cgroup-volumedriver-refused" test_links_cgroup_volumedriver_refused
run_test "daemon-fetch-and-path-tricks-refused" test_daemon_fetch_and_path_tricks_refused

print_test_summary
