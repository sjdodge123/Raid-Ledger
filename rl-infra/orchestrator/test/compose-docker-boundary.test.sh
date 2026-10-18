#!/usr/bin/env bash
# ROK-1846 AC1 + AC2 — compose topology of the Docker API boundary.
#
#  * rl-docker-proxy (the orchestrator's unfiltered-create proxy) must not be on
#    rl-net, where every per-env allinone/pg container lives: host network,
#    loopback listener, loopback-only allowfrom.
#  * No runner (nor the shared x-runner-base anchor) mounts the raw docker.sock;
#    runners reach Docker through rl-docker-guard on its own network.
#  * env-spin never attaches an env container to the guard's network.
#
# Parses docker-compose.yml with awk (no Docker needed on the test host); when
# `docker compose` is available it ALSO asserts on the rendered config.
# Revert-proof: the pre-ROK-1846 compose fails every case (proxy on rl-net with
# -allowfrom=0.0.0.0/0; docker.sock on runner-1..4).
#
# macOS bash 3.2 compatible.

set -uo pipefail

CURRENT_TEST_FILE="compose-docker-boundary.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

RL_INFRA="$(cd "$TEST_DIR/../.." && pwd)"
COMPOSE="$RL_INFRA/docker-compose.yml"

# block <key> — the lines of a 2-space-indented service (or a top-level x- anchor)
# up to the next key at the same or lower indent. Comment lines are dropped so a
# comment that mentions docker.sock never decides a case.
block() {
    awk -v key="$1" '
        /^[[:space:]]*#/ { next }
        $0 ~ "^(  )?" key ":" { inb = 1; ind = match($0, /[^ ]/); print; next }
        inb && /[^[:space:]]/ { i = match($0, /[^ ]/); if (i <= ind) { inb = 0 } else { print } }
    ' "$COMPOSE"
}

has() { [[ "$1" == *"$2"* ]] && echo yes || echo no; }

test_proxy_is_off_rl_net() {
    local b; b=$(block "docker-socket-proxy")
    assert_neq "$b" "" "docker-socket-proxy service found"
    assert_eq "$(has "$b" "rl-net")" "no" "rl-docker-proxy is not on rl-net"
    assert_eq "$(has "$b" "network_mode: host")" "yes" "rl-docker-proxy uses the host network"
    assert_eq "$(has "$b" "-listenip=127.0.0.1")" "yes" "proxy listens on loopback only"
    assert_eq "$(has "$b" "-allowfrom=127.0.0.1/32")" "yes" "proxy allowfrom is loopback only"
    assert_eq "$(has "$b" "0.0.0.0")" "no" "no 0.0.0.0 listener / allowfrom left"
}

test_no_runner_mounts_docker_sock() {
    local svc b
    for svc in x-runner-base runner-1 runner-2 runner-3 runner-4; do
        b=$(block "$svc")
        assert_neq "$b" "" "$svc found"
        assert_eq "$(has "$b" "docker.sock")" "no" "$svc does not mount docker.sock"
    done
}

test_runners_route_through_guard() {
    local env svc
    env=$(block "x-runner-docker-env")
    assert_eq "$(has "$env" "DOCKER_HOST: tcp://rl-docker-guard:2375")" "yes" "runner DOCKER_HOST points at the guard"
    assert_eq "$(has "$env" "TESTCONTAINERS_RYUK_DISABLED: \"true\"")" "yes" "Ryuk (needs the raw socket) is off"
    for svc in runner-1 runner-2 runner-3 runner-4; do
        assert_eq "$(has "$(block "$svc")" "<<: *runner-docker-env")" "yes" "$svc inherits the guard env"
    done
    assert_eq "$(has "$(block "x-runner-base")" "rl-docker-guard")" "yes" "runners join the guard network"
}

test_guard_is_isolated() {
    local b; b=$(block "docker-guard")
    assert_neq "$b" "" "docker-guard service found"
    assert_eq "$(has "$b" "rl-net")" "no" "the guard is not on rl-net"
    assert_eq "$(has "$b" "ports:")" "no" "the guard publishes no host port"
    assert_eq "$(grep -c "rl-docker-guard" "$RL_INFRA/orchestrator/bin/env-spin" | tr -d ' ')" "0" "env-spin never joins env containers to the guard network"
}

test_rendered_config_when_docker_available() {
    if ! docker compose version >/dev/null 2>&1; then
        echo "  (skip: docker compose not installed — awk cases above still ran)"
        return 0
    fi
    local cfg
    cfg=$(cd "$RL_INFRA" && docker compose --profile extra-slots config --format json 2>/dev/null) || cfg=""
    [[ -z "$cfg" ]] && { echo "  (skip: docker compose config failed on this host)"; return 0; }
    assert_eq "$(jq -r '.services["docker-socket-proxy"].networks // {} | has("rl-net")' <<<"$cfg")" "false" "rendered: proxy not on rl-net"
    assert_eq "$(jq -r '[.services | to_entries[] | select(.key|startswith("runner-")) | .value.volumes[]? | select((.source // "") | test("docker.sock"))] | length' <<<"$cfg")" "0" "rendered: no runner mounts docker.sock"
}

run_test "proxy-is-off-rl-net" test_proxy_is_off_rl_net
run_test "no-runner-mounts-docker-sock" test_no_runner_mounts_docker_sock
run_test "runners-route-through-guard" test_runners_route_through_guard
run_test "guard-is-isolated" test_guard_is_isolated
run_test "rendered-config-when-docker-available" test_rendered_config_when_docker_available

print_test_summary
