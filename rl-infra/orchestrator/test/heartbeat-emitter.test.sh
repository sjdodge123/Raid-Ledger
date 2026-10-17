#!/usr/bin/env bash
# ROK-1331 M5b — TDD red for run-on-runner-with-heartbeat.
#
# The wrapper forks a heartbeat loop that prints `[heartbeat] elapsed=Ns
# pid=P cpu=X.X% rss=NMB current_test=<...>` lines while the wrapped child
# runs. Tests run LOCALLY on the operator's mac (no docker exec inside the
# runner) — we shim docker via PATH override so we can drive the wrapper
# without an actual runner container.
#
# Required behavior per spec:
#   - `--heartbeat-interval=<seconds>` flag, default 30.
#   - Heartbeat lines prefixed `[heartbeat] `.
#   - Heartbeat format: `[heartbeat] elapsed=Ns pid=P cpu=X.X% rss=NMB current_test=<latest>`
#   - At least N heartbeat lines emitted across an `--heartbeat-interval=2 sleep 7` run.
#   - Exit code mirrors wrapped child.
#   - Heartbeat interval below 1s is clamped to 1.

set -uo pipefail

CURRENT_TEST_FILE="heartbeat-emitter.test.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/test_helpers.sh"

BIN_UNDER_TEST="$BIN_DIR/run-on-runner-with-heartbeat"

# Build a shim PATH so `docker exec ...` invocations from the wrapper
# resolve to a tiny script we control. We don't need to actually run the
# runner container — the wrapper just needs to fork & monitor a child
# whose PID we can poll with the standard /proc helpers (or `ps`).
make_docker_shim() {
    local shim_dir
    shim_dir="$(mktemp -d -t rl-docker-shim.XXXXXX)"
    cat > "$shim_dir/docker" <<'EOF'
#!/usr/bin/env bash
# Minimal docker shim: parse `docker exec ... <container> <cmd...>`,
# drop everything up to and including the container name, then exec
# the remaining argv. That lets the heartbeat wrapper monitor a real
# child PID locally (sleep / printf) without touching real docker.
if [[ "${1:-}" == "exec" ]]; then
    shift
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -i|-t|-it|-ti) shift ;;
            -e) shift 2 ;;
            -w) shift 2 ;;
            --) shift; break ;;
            -*) shift ;;
            *)
                # First non-flag is the container name. Drop it and stop.
                shift
                break
                ;;
        esac
    done
    exec "$@"
fi
# Other docker subcommands not used by the wrapper — pass through to a no-op.
exit 0
EOF
    chmod +x "$shim_dir/docker"
    echo "$shim_dir"
}

bin_exists_check() {
    assert_file_exists "$BIN_UNDER_TEST" "run-on-runner-with-heartbeat binary must exist in orchestrator/bin/"
    if [[ -f "$BIN_UNDER_TEST" ]]; then
        # Must be executable to be useful on the VM.
        [[ -x "$BIN_UNDER_TEST" ]] && TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)) || {
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: binary must be chmod +x")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] binary not executable"
        }
    fi
}

heartbeat_emits_at_interval() {
    # `--heartbeat-interval=2 sleep 7` should emit at least 3 heartbeat lines
    # AND exit 0 (mirroring sleep).
    [[ ! -x "$BIN_UNDER_TEST" ]] && {
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: binary missing — wrapper not implemented yet")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapper missing (expected for TDD red)"
        return 0
    }
    local shim_dir output rc heartbeat_count
    shim_dir="$(make_docker_shim)"
    output="$(PATH="$shim_dir:$PATH" RL_AGENT_ID=test-agent-1331 RL_STATE_DIR="$TMP_STATE" \
        "$BIN_UNDER_TEST" --heartbeat-interval=2 -- sleep 7 2>&1)"
    rc=$?
    heartbeat_count=$(echo "$output" | grep -c '^\[heartbeat\] ' || true)
    rm -rf "$shim_dir"
    assert_exit_code "$rc" "0" "wrapper must mirror wrapped child's exit code (sleep 7 → 0)"
    if (( heartbeat_count >= 3 )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: expected >=3 heartbeats, got $heartbeat_count")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected >=3 heartbeat lines; got $heartbeat_count"
        echo "  output:"
        echo "$output" | sed 's/^/    /'
    fi
}

heartbeat_line_format() {
    # Format must match: [heartbeat] elapsed=Ns pid=P cpu=X.X% rss=NMB current_test=<...>
    # rss may be "?" if /proc unavailable, but elapsed=Ns and pid=P MUST always be present.
    [[ ! -x "$BIN_UNDER_TEST" ]] && {
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: binary missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapper missing"
        return 0
    }
    local shim_dir output first_hb
    shim_dir="$(make_docker_shim)"
    output="$(PATH="$shim_dir:$PATH" RL_AGENT_ID=test-agent-1331 RL_STATE_DIR="$TMP_STATE" \
        "$BIN_UNDER_TEST" --heartbeat-interval=1 -- sleep 3 2>&1)"
    first_hb="$(echo "$output" | grep -m1 '^\[heartbeat\] ' || true)"
    rm -rf "$shim_dir"
    if [[ -z "$first_hb" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: no heartbeat line emitted")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] no heartbeat line emitted; output:"
        echo "$output" | sed 's/^/    /'
        return 0
    fi
    # Required tokens.
    assert_contains "$first_hb" "elapsed=" "heartbeat line must include 'elapsed=Ns'"
    assert_contains "$first_hb" "pid=" "heartbeat line must include 'pid=P'"
    assert_contains "$first_hb" "cpu=" "heartbeat line must include 'cpu=X.X%' (or cpu=?)"
    assert_contains "$first_hb" "rss=" "heartbeat line must include 'rss=NMB' (or rss=?)"
    assert_contains "$first_hb" "current_test=" "heartbeat line must include 'current_test=' (may be empty)"
    # Regex shape sanity: elapsed=<digits>s
    if [[ "$first_hb" =~ elapsed=[0-9]+s ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: elapsed= must be followed by digits + 's'")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] elapsed format wrong; line: $first_hb"
    fi
}

heartbeat_interval_default_30() {
    # When --heartbeat-interval is omitted, default to 30. We verify by running
    # for ~3s and asserting ZERO heartbeats land (interval > runtime).
    [[ ! -x "$BIN_UNDER_TEST" ]] && {
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: binary missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapper missing"
        return 0
    }
    local shim_dir output heartbeat_count
    shim_dir="$(make_docker_shim)"
    output="$(PATH="$shim_dir:$PATH" RL_AGENT_ID=test-agent-1331 RL_STATE_DIR="$TMP_STATE" \
        "$BIN_UNDER_TEST" -- sleep 3 2>&1)"
    heartbeat_count=$(echo "$output" | grep -c '^\[heartbeat\] ' || true)
    rm -rf "$shim_dir"
    # 30s default — a 3s child should not see a heartbeat (allow at most 1 in case
    # the wrapper emits one at startup t=0, which is a reasonable implementation).
    assert_le "$heartbeat_count" "1" "default heartbeat-interval=30 should not fire within 3s (max 1 startup heartbeat allowed)"
}

heartbeat_clamps_below_one() {
    # --heartbeat-interval=0 (or negative) must clamp to 1, not divide-by-zero / loop hot.
    [[ ! -x "$BIN_UNDER_TEST" ]] && {
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: binary missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapper missing"
        return 0
    }
    local shim_dir output rc heartbeat_count
    shim_dir="$(make_docker_shim)"
    output="$(PATH="$shim_dir:$PATH" RL_AGENT_ID=test-agent-1331 RL_STATE_DIR="$TMP_STATE" \
        rl_timeout 6 "$BIN_UNDER_TEST" --heartbeat-interval=0 -- sleep 3 2>&1)"
    rc=$?
    heartbeat_count=$(echo "$output" | grep -c '^\[heartbeat\] ' || true)
    rm -rf "$shim_dir"
    # Clamped to 1s → expect ~3 heartbeats in 3s. Loose lower bound = 2 (timing slack).
    if (( heartbeat_count >= 2 )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: clamp to 1s should produce >=2 heartbeats in 3s, got $heartbeat_count")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected >=2 heartbeats with --heartbeat-interval=0 clamp; got $heartbeat_count (rc=$rc)"
    fi
}

heartbeat_propagates_child_exit_code() {
    # When the wrapped child exits non-zero, the wrapper must mirror that exit code.
    [[ ! -x "$BIN_UNDER_TEST" ]] && {
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: binary missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapper missing"
        return 0
    }
    local shim_dir rc
    shim_dir="$(make_docker_shim)"
    PATH="$shim_dir:$PATH" RL_AGENT_ID=test-agent-1331 RL_STATE_DIR="$TMP_STATE" \
        "$BIN_UNDER_TEST" --heartbeat-interval=1 -- bash -c 'exit 42' >/dev/null 2>&1
    rc=$?
    rm -rf "$shim_dir"
    assert_exit_code "$rc" "42" "wrapper must mirror wrapped child's non-zero exit code (got rc=$rc)"
}

run_test "bin_exists_and_executable" bin_exists_check
run_test "heartbeat_emits_at_interval" heartbeat_emits_at_interval
run_test "heartbeat_line_format" heartbeat_line_format
run_test "heartbeat_interval_default_30" heartbeat_interval_default_30
run_test "heartbeat_clamps_below_one" heartbeat_clamps_below_one
run_test "heartbeat_propagates_child_exit_code" heartbeat_propagates_child_exit_code

print_test_summary
