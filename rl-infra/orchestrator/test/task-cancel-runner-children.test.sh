#!/usr/bin/env bash
# A3 fix 2 — task-cancel must kill the RUNNER-SIDE children, not just the
# VM-side supervisor.
#
# Observed defect: after cancelling task 6b49906f0bf9 the VM-side pgid died but
# `validate-ci.sh` + `jest` kept running inside rl-runner-2 (docker exec's
# in-container process is NOT a child of the exec client, so killing the client
# on the host leaves the container-side tree orphaned onto docker-init). The
# stalled run held ~2.6 GB and the per-run redis sidecar name.
#
# Fix under test:
#   1. task-start exports RL_TASK_ID into the wrapped command's environment.
#   2. run-on-runner{,-with-heartbeat} forward it via `docker exec -e RL_TASK_ID`.
#      Environment is INHERITED, so every runner-side descendant (bash →
#      validate-ci.sh → npm → node → jest workers) carries the same marker.
#   3. task-cancel sweeps the runner container for processes whose
#      /proc/<pid>/environ contains RL_TASK_ID=<this task id> — SIGTERM, grace,
#      then SIGKILL. Per-task marker ⇒ a sibling task on the same runner is
#      never touched.
#
# Tests stub `docker` in a tmp dir prepended to PATH (same pattern as
# release-runner-cleanup.test.sh) so they run locally without a real runner.

set -uo pipefail

CURRENT_TEST_FILE="task-cancel-runner-children.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Fake `docker` that records one collapsed line per invocation, then prints a
# survivor count (so task-cancel's escalation branch is observable).
#   $2 = count echoed by each sweep (0 = nothing matched)
#   $3 = 1 → simulate a missing runner container (stderr + exit 1)
_install_fake_docker() {
    local sentinel="$1" count="${2:-0}" fail="${3:-0}"
    FAKE_BIN=$(mktemp -d -t rl-fake-bin.XXXXXX)
    cat > "$FAKE_BIN/docker" <<EOF
#!/usr/bin/env bash
{ printf 'docker %s' "\$*" | tr '\n' ' '; printf '\n'; } >> "$sentinel"
if [[ "$fail" == "1" ]]; then
    echo "Error: No such container" >&2
    exit 1
fi
echo "$count"
exit 0
EOF
    chmod +x "$FAKE_BIN/docker"
}

_remove_fake_docker() {
    [[ -n "${FAKE_BIN:-}" && -d "$FAKE_BIN" ]] && rm -rf "$FAKE_BIN"
    unset FAKE_BIN
}

# Start a real task on the given slot and wait for its pid to land.
_start_sleeper_task() {
    local task_id="$1" slot="$2"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot "$slot" -- /bin/sleep 60 \
        >/dev/null 2>&1 || true
    local pid="" attempts=0
    while [[ -z "$pid" || "$pid" == "null" ]] && (( attempts < 30 )); do
        pid=$(jq -r '.pid // "null"' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo "null")
        attempts=$((attempts + 1))
        sleep 0.1
    done
    echo "$pid"
}

# A3-2-1: the sweep targets the task's own runner container and carries the
# per-task marker (the task id) as its selector.
test_cancel_sweeps_runner_for_task_marker() {
    CURRENT_TEST_NAME="A3-2-1: task-cancel sweeps rl-runner-<slot> using the task id marker"
    local task_id="a32sweep1"
    local pid
    pid=$(_start_sleeper_task "$task_id" 2)

    local sentinel="$RL_STATE_DIR/docker.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel" 0

    RL_TASK_CANCEL_RUNNER_GRACE_SECONDS=0 PATH="$FAKE_BIN:$PATH" \
        "$BIN_DIR/task-cancel" "$task_id" "a3_fix2" >/dev/null 2>&1

    if grep -q "docker exec .*rl-runner-2" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: no docker exec against rl-runner-2")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] task-cancel never swept rl-runner-2"
        sed 's/^/  /' "$sentinel" 2>/dev/null
    fi

    if grep -q "$task_id" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sweep did not carry the task id marker")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] sweep must select by task id, not a broad pattern"
    fi

    # Must still do its host-side job.
    local status
    status=$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo parse_err)
    assert_eq "$status" "cancelled" "status must still flip to cancelled"

    [[ -n "$pid" && "$pid" != "null" ]] && kill -9 "$pid" 2>/dev/null
    _remove_fake_docker
}

# A3-2-2: SIGTERM sweep first, SIGKILL escalation after the grace window.
test_cancel_sigterm_then_sigkill_on_runner() {
    CURRENT_TEST_NAME="A3-2-2: runner sweep sends TERM then escalates to KILL"
    local task_id="a32escal1"
    local pid
    pid=$(_start_sleeper_task "$task_id" 1)

    local sentinel="$RL_STATE_DIR/docker.invoked"
    : > "$sentinel"
    # count=2 → survivors exist, so the KILL escalation must fire.
    _install_fake_docker "$sentinel" 2

    RL_TASK_CANCEL_RUNNER_GRACE_SECONDS=0 PATH="$FAKE_BIN:$PATH" \
        "$BIN_DIR/task-cancel" "$task_id" "a3_fix2" >/dev/null 2>&1

    local term_line kill_line
    term_line=$(grep -n ' TERM ' "$sentinel" 2>/dev/null | head -1 | cut -d: -f1)
    kill_line=$(grep -n ' KILL ' "$sentinel" 2>/dev/null | head -1 | cut -d: -f1)

    if [[ -z "$term_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: TERM sweep missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] no TERM sweep on the runner"
    elif [[ -z "$kill_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: KILL escalation missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] survivors reported but no KILL escalation"
    elif (( term_line < kill_line )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: TERM must precede KILL")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] TERM@$term_line KILL@$kill_line"
    fi

    [[ -n "$pid" && "$pid" != "null" ]] && kill -9 "$pid" 2>/dev/null
    _remove_fake_docker
}

# A3-2-3: nothing matched → no KILL escalation (cheap, quiet path).
test_cancel_no_survivors_skips_escalation() {
    CURRENT_TEST_NAME="A3-2-3: zero runner matches → no SIGKILL escalation"
    local task_id="a32quiet1"
    local pid
    pid=$(_start_sleeper_task "$task_id" 1)

    local sentinel="$RL_STATE_DIR/docker.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel" 0

    RL_TASK_CANCEL_RUNNER_GRACE_SECONDS=0 PATH="$FAKE_BIN:$PATH" \
        "$BIN_DIR/task-cancel" "$task_id" "a3_fix2" >/dev/null 2>&1

    if grep -q ' KILL ' "$sentinel" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: escalated with zero survivors")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] KILL sweep ran despite zero matches"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    [[ -n "$pid" && "$pid" != "null" ]] && kill -9 "$pid" 2>/dev/null
    _remove_fake_docker
}

# A3-2-4: missing runner container is quiet — exit 0, ok:true, status cancelled.
test_cancel_missing_container_is_quiet() {
    CURRENT_TEST_NAME="A3-2-4: missing runner container → cancel still exits 0"
    local task_id="a32nocon1"
    local pid
    pid=$(_start_sleeper_task "$task_id" 1)

    local sentinel="$RL_STATE_DIR/docker.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel" 0 1   # fail=1

    local out exit_code
    out=$(RL_TASK_CANCEL_RUNNER_GRACE_SECONDS=0 PATH="$FAKE_BIN:$PATH" \
        "$BIN_DIR/task-cancel" "$task_id" "a3_fix2" 2>/dev/null)
    exit_code=$?
    assert_exit_code "$exit_code" "0" "cancel must exit 0 when the runner is gone"
    assert_eq "$(echo "$out" | jq -r '.ok' 2>/dev/null || echo parse_err)" "true" \
        ".ok must be true with a missing runner"

    local status
    status=$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json" 2>/dev/null || echo parse_err)
    assert_eq "$status" "cancelled" "status must flip even when the sweep fails"

    [[ -n "$pid" && "$pid" != "null" ]] && kill -9 "$pid" 2>/dev/null
    _remove_fake_docker
}

# A3-2-5: idempotent — re-cancelling an already-cancelled task sweeps again,
# exits 0, and does not mutate the JSON.
test_recancel_cancelled_task_sweeps_again() {
    CURRENT_TEST_NAME="A3-2-5: re-cancel of a cancelled task re-sweeps, exits 0, JSON unchanged"
    local task_id="a32again1"
    jq -n --arg t "$task_id" '{
        task_id: $t, tool: "manual", slot: 3, agent_id: "test", status: "cancelled",
        pid: null, cmd: ["/bin/sleep","60"], log_path: "/dev/null",
        started_at: "2026-09-03T00:00:00Z", finished_at: "2026-09-03T00:00:01Z",
        script_exit_code: null, cancel_reason: "earlier", failure_reason: null, steps: []
    }' > "$RL_TASKS_DIR/$task_id.json"
    local before
    before=$(cat "$RL_TASKS_DIR/$task_id.json")

    local sentinel="$RL_STATE_DIR/docker.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel" 0

    local out exit_code
    out=$(RL_TASK_CANCEL_RUNNER_GRACE_SECONDS=0 PATH="$FAKE_BIN:$PATH" \
        "$BIN_DIR/task-cancel" "$task_id" "again" 2>/dev/null)
    exit_code=$?
    assert_exit_code "$exit_code" "0" "re-cancel must exit 0"
    assert_eq "$(echo "$out" | jq -r '.ok' 2>/dev/null || echo parse_err)" "true" \
        "re-cancel must report ok:true"

    if grep -q "docker exec .*rl-runner-3" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: re-cancel did not re-sweep the runner")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] cancelled-task re-cancel must retry the runner sweep"
    fi

    assert_eq "$(cat "$RL_TASKS_DIR/$task_id.json")" "$before" \
        "re-cancel must not mutate the task JSON"

    _remove_fake_docker
}

# A3-2-6: the marker actually reaches the container — the heartbeat wrapper
# forwards RL_TASK_ID via `docker exec -e`, and omits the flag when unset.
test_heartbeat_wrapper_forwards_task_marker() {
    CURRENT_TEST_NAME="A3-2-6: run-on-runner-with-heartbeat forwards -e RL_TASK_ID"
    local sentinel="$RL_STATE_DIR/docker.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel" 0

    RL_TASK_ID="hbmarker1" RL_AGENT_ID="test-agent-1331" PATH="$FAKE_BIN:$PATH" \
        rl_timeout 20 "$BIN_DIR/run-on-runner-with-heartbeat" \
        --heartbeat-interval 1 -- /bin/true >/dev/null 2>&1

    if grep -q -- "-e RL_TASK_ID=hbmarker1" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: -e RL_TASK_ID not forwarded")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] wrapper must inject the marker into the container"
        sed 's/^/  /' "$sentinel" 2>/dev/null
    fi

    : > "$sentinel"
    (
        unset RL_TASK_ID
        RL_AGENT_ID="test-agent-1331" PATH="$FAKE_BIN:$PATH" \
            rl_timeout 20 "$BIN_DIR/run-on-runner-with-heartbeat" \
            --heartbeat-interval 1 -- /bin/true >/dev/null 2>&1
    )
    if grep -q -- "-e RL_TASK_ID=" "$sentinel" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: empty marker forwarded")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] must omit -e RL_TASK_ID when unset"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    _remove_fake_docker
}

# A3-2-7: task-start exports RL_TASK_ID to the wrapped command (the other half
# of the marker chain — without this the wrapper has nothing to forward).
test_task_start_exports_task_id() {
    CURRENT_TEST_NAME="A3-2-7: task-start exports RL_TASK_ID into the wrapped command"
    local task_id="a32expor1"
    local out_file="$RL_STATE_DIR/marker.out"
    "$BIN_DIR/task-start" "$task_id" --tool manual --slot 1 -- \
        /bin/sh -c "printf '%s' \"\${RL_TASK_ID:-unset}\" > $out_file" >/dev/null 2>&1 || true

    local attempts=0
    while [[ ! -s "$out_file" ]] && (( attempts < 60 )); do
        attempts=$((attempts + 1))
        sleep 0.1
    done
    assert_eq "$(cat "$out_file" 2>/dev/null || echo missing)" "$task_id" \
        "wrapped command must see RL_TASK_ID=<task_id>"
}

run_test "a3-2-1-sweep-uses-task-marker" test_cancel_sweeps_runner_for_task_marker
run_test "a3-2-2-term-then-kill" test_cancel_sigterm_then_sigkill_on_runner
run_test "a3-2-3-no-survivors-no-escalation" test_cancel_no_survivors_skips_escalation
run_test "a3-2-4-missing-container-quiet" test_cancel_missing_container_is_quiet
run_test "a3-2-5-recancel-idempotent" test_recancel_cancelled_task_sweeps_again
run_test "a3-2-6-wrapper-forwards-marker" test_heartbeat_wrapper_forwards_task_marker
run_test "a3-2-7-task-start-exports-marker" test_task_start_exports_task_id

print_test_summary
