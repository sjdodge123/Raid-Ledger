#!/usr/bin/env bash
# ROK-1331 M4 — env-restart tests
# Covers AC3: env-restart <slug> issues `docker restart rl-env-<slug>-allinone`
# and emits {ok:true, slug, restarted_at}.

set -uo pipefail

CURRENT_TEST_FILE="env-restart.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

m4_restart_setup() {
    test_setup
    MOCK_BIN_DIR=$(mktemp -d -t rl-m4-restart.XXXXXX)
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
    restart)
        container="$1"
        echo "$container" >> "${MOCK_DOCKER_RESTART_LOG:-/tmp/mock-docker-restart.log}"
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
    export MOCK_DOCKER_RESTART_LOG="$MOCK_BIN_DIR/restart.log"
    : > "$MOCK_DOCKER_RESTART_LOG"
}

m4_restart_teardown() {
    if [[ -n "${MOCK_BIN_DIR:-}" && -d "$MOCK_BIN_DIR" ]]; then
        rm -rf "$MOCK_BIN_DIR"
    fi
    unset MOCK_BIN_DIR MOCK_DOCKER_STATE MOCK_DOCKER_RESTART_LOG RL_USE_DOCKER_SOCKET
    test_teardown
}

# AC3: happy path.
test_env_restart_runs() {
    CURRENT_TEST_NAME="AC3: env-restart issues docker restart on allinone container"
    m4_restart_setup
    local slug="testenv4"
    export MOCK_DOCKER_STATE='{"rl-env-testenv4-allinone": {"running": true, "status": "running"}}'

    local out exit_code
    out=$("$BIN_DIR/env-restart" "$slug" 2>&1)
    exit_code=$?
    assert_exit_code "$exit_code" "0" "env-restart should exit 0"

    local ok slug_out
    ok=$(echo "$out" | jq -r '.ok' 2>/dev/null || echo parse_err)
    slug_out=$(echo "$out" | jq -r '.slug' 2>/dev/null || echo parse_err)
    assert_eq "$ok" "true" ".ok == true"
    assert_eq "$slug_out" "$slug" ".slug echoes input"

    # restarted_at should parse as ISO 8601.
    local restarted_at
    restarted_at=$(echo "$out" | jq -r '.restarted_at' 2>/dev/null || echo parse_err)
    assert_neq "$restarted_at" "parse_err" ".restarted_at present"
    assert_neq "$restarted_at" "null" ".restarted_at not null"

    # Confirm docker restart was actually invoked on the right container.
    if [[ -s "$MOCK_DOCKER_RESTART_LOG" ]]; then
        local logged
        logged=$(head -1 "$MOCK_DOCKER_RESTART_LOG")
        assert_eq "$logged" "rl-env-testenv4-allinone" "docker restart targeted allinone"
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: docker restart never invoked")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] docker restart never invoked"
    fi
    m4_restart_teardown
}

# AC3: missing container returns exit 3.
test_env_restart_missing() {
    CURRENT_TEST_NAME="AC3: missing allinone container exits 3"
    m4_restart_setup
    export MOCK_DOCKER_STATE='{}'
    local exit_code=0
    "$BIN_DIR/env-restart" "no-such" >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "3" "missing container should exit 3"
    m4_restart_teardown
}

# Validation: bad slug rejected.
test_env_restart_bad_slug() {
    CURRENT_TEST_NAME="validation: invalid slug rejected (exit 2)"
    m4_restart_setup
    local exit_code=0
    "$BIN_DIR/env-restart" "Bad_Slug" >/dev/null 2>&1 || exit_code=$?
    assert_exit_code "$exit_code" "2" "uppercase+underscore should reject"
    m4_restart_teardown
}

run_test "ac3-happy" test_env_restart_runs
run_test "ac3-missing" test_env_restart_missing
run_test "ac3-bad-slug" test_env_restart_bad_slug

print_test_summary
