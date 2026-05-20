#!/usr/bin/env bash
# ROK-1331 M4 — env-exec-app tests
# Covers AC4: env-exec-app <slug> [-e KEY=VAL...] -- <cmd...> wraps
# `docker exec -i [-e KEY=VAL...] rl-env-<slug>-allinone <cmd...>`.

set -uo pipefail

CURRENT_TEST_FILE="env-exec-app.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

m4_exec_setup() {
    test_setup
    MOCK_BIN_DIR=$(mktemp -d -t rl-m4-exec.XXXXXX)
    # Mock docker — exec branch logs container + argv + env flags to a file.
    cat >"$MOCK_BIN_DIR/docker" <<'MOCK'
#!/usr/bin/env bash
sub="$1"; shift
case "$sub" in
    inspect)
        container="$1"
        state="${MOCK_DOCKER_STATE:-{\}}"
        if [[ $(echo "$state" | jq -r --arg c "$container" 'has($c)') != "true" ]]; then
            echo "Error: No such object: $container" >&2
            exit 1
        fi
        echo "true"
        ;;
    exec)
        # Collect -e flags before container name.
        env_flags=()
        container=""
        while [[ $# -gt 0 ]]; do
            case "$1" in
                -i|-it|-t) shift ;;
                -e) env_flags+=("$2"); shift 2 ;;
                -w) shift 2 ;;
                -*) shift ;;
                *) container="$1"; shift; break ;;
            esac
        done
        {
            echo "CONTAINER=$container"
            echo "ENV_COUNT=${#env_flags[@]}"
            for f in "${env_flags[@]}"; do
                echo "ENV=$f"
            done
            echo "ARGC=$#"
            echo "ARGS=$*"
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
    : > "$MOCK_DOCKER_EXEC_LOG"
}

m4_exec_teardown() {
    if [[ -n "${MOCK_BIN_DIR:-}" && -d "$MOCK_BIN_DIR" ]]; then
        rm -rf "$MOCK_BIN_DIR"
    fi
    unset MOCK_BIN_DIR MOCK_DOCKER_STATE MOCK_DOCKER_EXEC_LOG RL_USE_DOCKER_SOCKET
    test_teardown
}

# AC4: env-exec-app exists (the 4th binary). Failing-test red phase will fail
# here if the binary isn't created yet.
test_env_exec_app_binary_exists() {
    CURRENT_TEST_NAME="AC4: env-exec-app binary exists in orchestrator/bin"
    assert_file_exists "$BIN_DIR/env-exec-app" "env-exec-app must exist (4th binary added in M4)"
    if [[ -f "$BIN_DIR/env-exec-app" && ! -x "$BIN_DIR/env-exec-app" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: env-exec-app not executable")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] env-exec-app not executable"
    fi
}

# AC4: wraps docker exec on the allinone container.
test_env_exec_app_targets_allinone() {
    CURRENT_TEST_NAME="AC4: env-exec-app targets rl-env-<slug>-allinone container"
    m4_exec_setup
    local slug="testenv5"
    export MOCK_DOCKER_STATE='{"rl-env-testenv5-allinone": {"running": true, "status": "running"}}'

    "$BIN_DIR/env-exec-app" "$slug" -- node -e 'console.log("hi")' >/dev/null 2>&1 || true

    if [[ -s "$MOCK_DOCKER_EXEC_LOG" ]]; then
        local log
        log=$(cat "$MOCK_DOCKER_EXEC_LOG")
        assert_contains "$log" "CONTAINER=rl-env-testenv5-allinone" "exec hits allinone container"
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: mock exec log empty")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] mock exec log empty"
    fi
    m4_exec_teardown
}

# AC4: -e env flags are forwarded to docker exec.
test_env_exec_app_env_flag_forwarded() {
    CURRENT_TEST_NAME="AC4: -e KEY=VAL forwarded to docker exec"
    m4_exec_setup
    local slug="testenv6"
    export MOCK_DOCKER_STATE='{"rl-env-testenv6-allinone": {"running": true, "status": "running"}}'

    "$BIN_DIR/env-exec-app" "$slug" -e FOO=bar -e BAZ=qux -- node -e 'process.env' >/dev/null 2>&1 || true

    local log
    log=$(cat "$MOCK_DOCKER_EXEC_LOG")
    assert_contains "$log" "ENV=FOO=bar" "first -e flag forwarded"
    assert_contains "$log" "ENV=BAZ=qux" "second -e flag forwarded"
    # Ensure cmd-line args after -- are also forwarded.
    assert_contains "$log" "node" "wrapped command name forwarded"

    m4_exec_teardown
}

# AC4: missing container returns exit 3.
test_env_exec_app_missing_container() {
    CURRENT_TEST_NAME="AC4: missing allinone container exits 3"
    m4_exec_setup
    export MOCK_DOCKER_STATE='{}'
    local exit_code=0
    "$BIN_DIR/env-exec-app" "no-such" -- /bin/true >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "3" "missing container should exit 3"
    m4_exec_teardown
}

# AC4: bad slug rejected.
test_env_exec_app_bad_slug() {
    CURRENT_TEST_NAME="validation: invalid slug rejected (exit 2)"
    m4_exec_setup
    local exit_code=0
    "$BIN_DIR/env-exec-app" "Bad_Slug" -- /bin/true >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "2" "uppercase+underscore slug should reject"
    m4_exec_teardown
}

# AC4: docker exec rc propagates.
test_env_exec_app_rc_propagates() {
    CURRENT_TEST_NAME="AC4: docker exec rc propagates to env-exec-app exit"
    m4_exec_setup
    local slug="testenv7"
    export MOCK_DOCKER_STATE='{"rl-env-testenv7-allinone": {"running": true, "status": "running"}}'
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
    exec) exit 77 ;;
    *) exit 2 ;;
esac
MOCK
    chmod +x "$MOCK_BIN_DIR/docker"

    local exit_code=0
    "$BIN_DIR/env-exec-app" "$slug" -- /bin/false >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "77" "env-exec-app should propagate docker exec rc=77"
    m4_exec_teardown
}

run_test "ac4-binary-exists" test_env_exec_app_binary_exists
run_test "ac4-targets-allinone" test_env_exec_app_targets_allinone
run_test "ac4-env-flag-forwarded" test_env_exec_app_env_flag_forwarded
run_test "ac4-missing-container" test_env_exec_app_missing_container
run_test "ac4-bad-slug" test_env_exec_app_bad_slug
run_test "ac4-rc-propagates" test_env_exec_app_rc_propagates

print_test_summary
