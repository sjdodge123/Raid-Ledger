#!/usr/bin/env bash
# ROK-1331 M4 — env-inspect tests
# Covers AC1: env-inspect <slug> returns JSON with {ok, slug, slot, allinone, pg}.
#
# Tests use a mock `docker` binary on PATH to simulate container states without
# touching real Docker. The mock reads MOCK_DOCKER_STATE env var (JSON) and
# returns canned responses per inspect call.

set -uo pipefail

CURRENT_TEST_FILE="env-inspect.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Per-test override of test_setup to also install a docker-mock dir on PATH.
m4_setup() {
    test_setup
    MOCK_BIN_DIR=$(mktemp -d -t rl-m4-mock.XXXXXX)
    cat >"$MOCK_BIN_DIR/docker" <<'MOCK'
#!/usr/bin/env bash
# Mock docker binary. Reads MOCK_DOCKER_STATE env var.
# Supports:
#   docker inspect <container> --format <template>
# State JSON shape:
#   { "<container>": {"running": true, "status": "running", "health": "healthy"} }
# If a container isn't in state, returns exit 1 (matches real docker behavior).
if [[ "$1" == "inspect" ]]; then
    container="$2"
    state="${MOCK_DOCKER_STATE:-{\}}"
    present=$(echo "$state" | jq -r --arg c "$container" 'has($c)')
    if [[ "$present" != "true" ]]; then
        echo "Error: No such object: $container" >&2
        exit 1
    fi
    # Find --format
    fmt=""
    shift 2
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --format) fmt="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    case "$fmt" in
        '{{.State.Running}}')
            echo "$state" | jq -r --arg c "$container" '.[$c].running' ;;
        '{{.State.Status}}')
            echo "$state" | jq -r --arg c "$container" '.[$c].status' ;;
        '{{.State.Health.Status}}')
            echo "$state" | jq -r --arg c "$container" '.[$c].health // ""' ;;
        *)
            # Full JSON for default inspect — return a stub.
            echo "$state" | jq --arg c "$container" '.[$c]'
            ;;
    esac
    exit 0
fi
echo "mock docker: unsupported subcommand $1" >&2
exit 2
MOCK
    chmod +x "$MOCK_BIN_DIR/docker"
    export PATH="$MOCK_BIN_DIR:$PATH"
    export RL_USE_DOCKER_SOCKET=1  # bypass DOCKER_HOST probing
}

m4_teardown() {
    if [[ -n "${MOCK_BIN_DIR:-}" && -d "$MOCK_BIN_DIR" ]]; then
        rm -rf "$MOCK_BIN_DIR"
    fi
    unset MOCK_BIN_DIR MOCK_DOCKER_STATE RL_USE_DOCKER_SOCKET
    test_teardown
}

# AC1 — happy path: live env returns {ok:true, slot, allinone, pg}.
test_env_inspect_live() {
    CURRENT_TEST_NAME="AC1: live env returns JSON snapshot"
    m4_setup
    local slug="testenv1"
    # Seed env-registry.json so slot lookup works.
    jq -n --arg slug "$slug" '[{slug: $slug, slot: 1, created_at: "2026-05-20T00:00:00Z"}]' \
        > "$RL_STATE_DIR/env-registry.json"
    export MOCK_DOCKER_STATE='{
        "rl-env-testenv1-allinone": {"running": true, "status": "running", "health": "healthy"},
        "rl-env-testenv1-pg": {"running": true, "status": "running", "health": null}
    }'

    local out exit_code
    out=$("$BIN_DIR/env-inspect" "$slug" 2>&1)
    exit_code=$?

    assert_exit_code "$exit_code" "0" "live env should exit 0"
    local ok slot allinone_running pg_running
    ok=$(echo "$out" | jq -r '.ok' 2>/dev/null || echo parse_err)
    slot=$(echo "$out" | jq -r '.slot' 2>/dev/null || echo parse_err)
    allinone_running=$(echo "$out" | jq -r '.allinone.running' 2>/dev/null || echo parse_err)
    pg_running=$(echo "$out" | jq -r '.pg.running' 2>/dev/null || echo parse_err)
    assert_eq "$ok" "true" ".ok == true"
    assert_eq "$slot" "1" ".slot == 1"
    assert_eq "$allinone_running" "true" ".allinone.running == true"
    assert_eq "$pg_running" "true" ".pg.running == true"

    m4_teardown
}

# AC1 — not-found: missing env returns {ok:false, error:env_not_found} exit 3.
test_env_inspect_missing() {
    CURRENT_TEST_NAME="AC1: missing env returns env_not_found / exit 3"
    m4_setup
    export MOCK_DOCKER_STATE='{}'
    echo "[]" > "$RL_STATE_DIR/env-registry.json"

    local out exit_code=0
    out=$("$BIN_DIR/env-inspect" "no-such-env" 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "3" "missing container should exit 3"
    local ok error
    ok=$(echo "$out" | jq -r '.ok' 2>/dev/null || echo parse_err)
    error=$(echo "$out" | jq -r '.error' 2>/dev/null || echo parse_err)
    assert_eq "$ok" "false" ".ok == false on missing"
    assert_eq "$error" "env_not_found" ".error == env_not_found"

    m4_teardown
}

# Validation: slug regex enforced.
test_env_inspect_bad_slug() {
    CURRENT_TEST_NAME="validation: invalid slug rejected (exit 2)"
    m4_setup
    local out exit_code=0
    out=$("$BIN_DIR/env-inspect" "Bad_Slug" 2>&1) || exit_code=$?
    assert_exit_code "$exit_code" "2" "uppercase + underscore should reject"
    m4_teardown
}

# Missing args.
test_env_inspect_missing_args() {
    CURRENT_TEST_NAME="validation: missing slug arg rejected"
    m4_setup
    local out exit_code=0
    out=$("$BIN_DIR/env-inspect" 2>&1) || exit_code=$?
    # exit 1 (bad args) or 2 (validation) — both acceptable per spec.
    if [[ "$exit_code" == "1" || "$exit_code" == "2" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: expected exit 1 or 2, got $exit_code")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected exit 1 or 2, got $exit_code"
    fi
    m4_teardown
}

run_test "ac1-live" test_env_inspect_live
run_test "ac1-missing" test_env_inspect_missing
run_test "ac1-bad-slug" test_env_inspect_bad_slug
run_test "ac1-missing-args" test_env_inspect_missing_args

print_test_summary
