#!/usr/bin/env bash
# ROK-1331 M4 — env-psql tests
# Covers AC2: env-psql <slug> pipes stdin through docker exec -i to psql.

set -uo pipefail

CURRENT_TEST_FILE="env-psql.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

m4_psql_setup() {
    test_setup
    MOCK_BIN_DIR=$(mktemp -d -t rl-m4-psql.XXXXXX)
    # Mock docker that handles inspect (for container-exists check) AND exec
    # with stdin/argv passthrough. exec piping: read stdin, echo it back
    # prefixed with STDIN: so tests can confirm passthrough.
    cat >"$MOCK_BIN_DIR/docker" <<'MOCK'
#!/usr/bin/env bash
sub="$1"; shift
case "$sub" in
    inspect)
        # docker inspect <container> [--format ...]
        container="$1"
        state="${MOCK_DOCKER_STATE:-{\}}"
        present=$(echo "$state" | jq -r --arg c "$container" 'has($c)')
        if [[ "$present" != "true" ]]; then
            echo "Error: No such object: $container" >&2
            exit 1
        fi
        # Just echo "true" — env-psql only checks container existence.
        echo "true"
        ;;
    exec)
        # docker exec -i <container> psql [psql-args...]
        # Strip flags up to container name.
        container=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                -i|-it|-t) shift ;;
                -e) shift 2 ;;
                -*) shift ;;
                *) container="$1"; shift; break ;;
            esac
        done
        if [[ -z "$container" ]]; then
            echo "mock docker exec: missing container" >&2
            exit 2
        fi
        # Record argc + container for the test to inspect.
        : > "${MOCK_DOCKER_EXEC_LOG:-/tmp/mock-docker-exec.log}"
        {
            echo "CONTAINER=$container"
            echo "ARGC=$#"
            echo "ARGS=$*"
            echo "STDIN_BEGIN"
            cat
            echo "STDIN_END"
        } >>"${MOCK_DOCKER_EXEC_LOG:-/tmp/mock-docker-exec.log}"
        exit 0
        ;;
    *)
        echo "mock docker: unsupported subcommand $sub" >&2
        exit 2
        ;;
esac
MOCK
    chmod +x "$MOCK_BIN_DIR/docker"
    export PATH="$MOCK_BIN_DIR:$PATH"
    export RL_USE_DOCKER_SOCKET=1
    export MOCK_DOCKER_EXEC_LOG="$MOCK_BIN_DIR/exec.log"
}

m4_psql_teardown() {
    if [[ -n "${MOCK_BIN_DIR:-}" && -d "$MOCK_BIN_DIR" ]]; then
        rm -rf "$MOCK_BIN_DIR"
    fi
    unset MOCK_BIN_DIR MOCK_DOCKER_STATE MOCK_DOCKER_EXEC_LOG RL_USE_DOCKER_SOCKET
    test_teardown
}

# AC2: stdin passthrough — `echo 'SELECT 1;' | env-psql <slug>` writes SELECT 1; to
# the docker exec's stdin.
test_env_psql_stdin_passthrough() {
    CURRENT_TEST_NAME="AC2: stdin passes through to docker exec -i"
    m4_psql_setup
    local slug="testenv2"
    jq -n --arg slug "$slug" '[{slug: $slug, slot: 1, created_at: "2026-05-20T00:00:00Z"}]' \
        > "$RL_STATE_DIR/env-registry.json"
    export MOCK_DOCKER_STATE='{"rl-env-testenv2-pg": {"running": true, "status": "running"}}'

    echo "SELECT 1;" | "$BIN_DIR/env-psql" "$slug" -- -tA >/dev/null 2>&1 || true

    if [[ -f "$MOCK_DOCKER_EXEC_LOG" ]]; then
        local log_content
        log_content=$(cat "$MOCK_DOCKER_EXEC_LOG")
        assert_contains "$log_content" "CONTAINER=rl-env-testenv2-pg" "exec hits pg container"
        assert_contains "$log_content" "SELECT 1;" "stdin preserved through exec"
        assert_contains "$log_content" "-tA" "psql args after -- passed through"
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: mock exec log not written")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] mock exec log not written"
    fi
    m4_psql_teardown
}

# AC2: missing container returns exit 3.
test_env_psql_missing_container() {
    CURRENT_TEST_NAME="AC2: missing pg container exits 3"
    m4_psql_setup
    export MOCK_DOCKER_STATE='{}'
    echo "[]" > "$RL_STATE_DIR/env-registry.json"
    local exit_code=0
    echo "SELECT 1;" | "$BIN_DIR/env-psql" "no-such" -- -tA >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "3" "missing pg container should exit 3"
    m4_psql_teardown
}

# Validation: bad slug rejected.
test_env_psql_bad_slug() {
    CURRENT_TEST_NAME="validation: invalid slug rejected (exit 2)"
    m4_psql_setup
    local exit_code=0
    "$BIN_DIR/env-psql" "Bad_Slug" -- -c 'SELECT 1;' >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "2" "uppercase+underscore slug should reject"
    m4_psql_teardown
}

# psql exit code propagates: if docker exec fails with rc=42, env-psql exits 42.
test_env_psql_propagates_exit_code() {
    CURRENT_TEST_NAME="AC2: docker exec rc propagates to env-psql exit"
    m4_psql_setup
    local slug="testenv3"
    jq -n --arg slug "$slug" '[{slug: $slug, slot: 1, created_at: "2026-05-20T00:00:00Z"}]' \
        > "$RL_STATE_DIR/env-registry.json"
    export MOCK_DOCKER_STATE='{"rl-env-testenv3-pg": {"running": true, "status": "running"}}'
    # Replace exec branch with one that exits 42 to test rc propagation.
    cat >"$MOCK_BIN_DIR/docker" <<'MOCK'
#!/usr/bin/env bash
sub="$1"; shift
case "$sub" in
    inspect)
        container="$1"
        state="${MOCK_DOCKER_STATE:-{\}}"
        if [[ $(echo "$state" | jq -r --arg c "$container" 'has($c)') != "true" ]]; then exit 1; fi
        echo "true"
        ;;
    exec) exit 42 ;;
    *) exit 2 ;;
esac
MOCK
    chmod +x "$MOCK_BIN_DIR/docker"

    local exit_code=0
    echo "SELECT 1;" | "$BIN_DIR/env-psql" "$slug" -- -tA >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "42" "env-psql should propagate docker exec rc=42"
    m4_psql_teardown
}

run_test "ac2-stdin-passthrough" test_env_psql_stdin_passthrough
run_test "ac2-missing-container" test_env_psql_missing_container
run_test "ac2-bad-slug" test_env_psql_bad_slug
run_test "ac2-rc-propagates" test_env_psql_propagates_exit_code

print_test_summary
