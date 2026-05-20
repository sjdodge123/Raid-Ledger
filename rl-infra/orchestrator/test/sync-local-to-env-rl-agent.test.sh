#!/usr/bin/env bash
# ROK-1331 M4 — sync-local-to-env.sh under RL_PROXMOX_USER=rl-agent
# Covers AC5: the sync script (a) defaults to rl-agent, and (b) routes every
# container-touching SSH through the new orchestrator binaries, NOT raw
# `docker inspect|exec|restart` (which fail under rl-agent — no docker group).
#
# These are STATIC checks on the script source — we don't need a live VM.
# AC5 is also coverable via a live smoke (see spec §AC5) but that requires
# an actual fleet slot. The static checks here are the unit-test layer.

set -uo pipefail

CURRENT_TEST_FILE="sync-local-to-env-rl-agent.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Locate the sync script relative to the worktree root.
WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
SYNC_SCRIPT="$WORKTREE_ROOT/scripts/sync-local-to-env.sh"

# AC5a: default RL_PROXMOX_USER is rl-agent.
test_default_user_rl_agent() {
    CURRENT_TEST_NAME="AC5a: RL_PROXMOX_USER defaults to rl-agent"
    if [[ ! -f "$SYNC_SCRIPT" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sync script not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] sync script not found at $SYNC_SCRIPT"
        return
    fi
    # Match `RL_PROXMOX_USER="${RL_PROXMOX_USER:-rl-agent}"` (allow whitespace).
    if grep -Eq '^[[:space:]]*RL_PROXMOX_USER=.*:-rl-agent[}"]' "$SYNC_SCRIPT"; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: default is not rl-agent")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected default ':-rl-agent' in RL_PROXMOX_USER line"
        grep -n "RL_PROXMOX_USER" "$SYNC_SCRIPT" || true
    fi
}

# AC5b: no leftover raw `docker inspect 'rl-env-...'` over ssh — must use env-inspect.
test_no_raw_ssh_docker_inspect() {
    CURRENT_TEST_NAME="AC5b: no raw 'docker inspect rl-env-...' over ssh"
    if [[ ! -f "$SYNC_SCRIPT" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sync script not found")
        return
    fi
    # Look for "docker inspect 'rl-env-" or "docker inspect \"rl-env-" patterns
    # ONLY inside ssh-quoted strings. Easier: search any line containing both
    # "ssh" earlier in script flow AND "docker inspect 'rl-env-" — but a
    # simpler proxy: grep for the literal pattern. If env-inspect routing
    # is in place, the only remaining `docker inspect ... rl-env-...` calls
    # should be on the LOCAL machine for the LOCAL_DB_CONTAINER, NOT the env-pg.
    local hits
    hits=$(grep -nE "docker[[:space:]]+inspect[^|]*['\"]?rl-env-" "$SYNC_SCRIPT" || true)
    if [[ -z "$hits" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: raw 'docker inspect rl-env-...' still present")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] raw docker-inspect-on-env still in script:"
        echo "$hits"
    fi
}

# AC5b: no leftover raw `docker exec ... rl-env-...-pg psql` — must use env-psql.
test_no_raw_ssh_docker_exec_pg() {
    CURRENT_TEST_NAME="AC5b: no raw 'docker exec ... rl-env-...-pg' over ssh"
    if [[ ! -f "$SYNC_SCRIPT" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sync script not found")
        return
    fi
    # The legacy pattern: `docker exec -i '$ENV_PG_CONTAINER' psql ...` AND
    # `docker exec -i 'rl-env-...-pg' psql ...`. Both should be gone.
    local hits
    hits=$(grep -nE "docker[[:space:]]+exec[^|]*(rl-env-[^[:space:]]+-pg|ENV_PG_CONTAINER)" \
                 "$SYNC_SCRIPT" || true)
    if [[ -z "$hits" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: raw 'docker exec rl-env-...-pg' still present")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] raw docker-exec-on-pg still in script:"
        echo "$hits"
    fi
}

# AC5b: no leftover raw `docker restart 'rl-env-...-allinone'` — must use env-restart.
test_no_raw_ssh_docker_restart() {
    CURRENT_TEST_NAME="AC5b: no raw 'docker restart rl-env-...-allinone' over ssh"
    if [[ ! -f "$SYNC_SCRIPT" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sync script not found")
        return
    fi
    local hits
    hits=$(grep -nE "docker[[:space:]]+restart[[:space:]]+['\"]?rl-env-" "$SYNC_SCRIPT" || true)
    if [[ -z "$hits" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: raw 'docker restart rl-env-...' still present")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] raw docker-restart-on-env still in script:"
        echo "$hits"
    fi
}

# AC5b: no leftover raw `docker exec ... rl-env-...-allinone node ...` — must use env-exec-app.
# (admin-bootstrap line — sync-local-to-env.sh:399-406 in current source.)
test_no_raw_ssh_docker_exec_allinone() {
    CURRENT_TEST_NAME="AC5b: no raw 'docker exec ... rl-env-...-allinone' over ssh"
    if [[ ! -f "$SYNC_SCRIPT" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sync script not found")
        return
    fi
    local hits
    hits=$(grep -nE "docker[[:space:]]+exec[^|]*(rl-env-[^[:space:]]+-allinone)" "$SYNC_SCRIPT" || true)
    if [[ -z "$hits" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: raw 'docker exec rl-env-...-allinone' still present")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] raw docker-exec-on-allinone still in script:"
        echo "$hits"
    fi
}

# AC5c: the new orchestrator binary names appear at least once in the script.
test_orchestrator_binaries_referenced() {
    CURRENT_TEST_NAME="AC5c: env-inspect / env-psql / env-restart / env-exec-app referenced"
    if [[ ! -f "$SYNC_SCRIPT" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sync script not found")
        return
    fi
    for bin in env-inspect env-psql env-restart env-exec-app; do
        if grep -q "$bin" "$SYNC_SCRIPT"; then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $bin not referenced")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $bin not referenced in sync script"
        fi
    done
}

run_test "ac5a-default-user" test_default_user_rl_agent
run_test "ac5b-no-inspect" test_no_raw_ssh_docker_inspect
run_test "ac5b-no-exec-pg" test_no_raw_ssh_docker_exec_pg
run_test "ac5b-no-restart" test_no_raw_ssh_docker_restart
run_test "ac5b-no-exec-allinone" test_no_raw_ssh_docker_exec_allinone
run_test "ac5c-binaries-referenced" test_orchestrator_binaries_referenced

print_test_summary
