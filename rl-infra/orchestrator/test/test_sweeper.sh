#!/usr/bin/env bash
# ROK-1331 M1 — sweeper retention tests
# Covers AC-M1-10 (sweeper prunes terminal tasks > 24h; preserves running tasks).

set -uo pipefail

CURRENT_TEST_FILE="test_sweeper.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

SWEEPER_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"

make_fixture_task() {
    local task_id="$1" slot="$2" status="$3" started_at="$4" finished_at="${5:-null}"
    local finished_field
    if [[ "$finished_at" == "null" ]]; then
        finished_field="null"
    else
        finished_field="\"$finished_at\""
    fi
    cat > "$RL_TASKS_DIR/$task_id.json" <<EOF
{
  "task_id": "$task_id",
  "tool": "manual",
  "slot": $slot,
  "agent_id": "fixture",
  "args_summary": "",
  "cmd": ["/bin/true"],
  "log_path": "$RL_TASKS_DIR/$task_id.log",
  "pid": null,
  "status": "$status",
  "script_exit_code": 0,
  "started_at": "$started_at",
  "finished_at": $finished_field,
  "cancel_reason": null,
  "steps": []
}
EOF
    touch "$RL_TASKS_DIR/$task_id.log"
}

# Helper: ISO timestamp delta_sec ago.
iso_ago() {
    local delta_sec="$1"
    if date -u -d "now - ${delta_sec} seconds" +%FT%TZ 2>/dev/null; then
        return 0
    fi
    # macOS fallback.
    date -u -v-"${delta_sec}"S +%FT%TZ 2>/dev/null || date -u +%FT%TZ
}

# Helper: invoke the sweeper against our temp state dir.
run_sweeper() {
    if [[ ! -f "$SWEEPER_SCRIPT" ]]; then
        return 127
    fi
    TASKS_DIR="$RL_TASKS_DIR" \
        RL_STATE_DIR="$RL_STATE_DIR" \
        RL_TASKS_DIR="$RL_TASKS_DIR" \
        TASK_RETENTION_SECONDS="${TASK_RETENTION_SECONDS:-86400}" \
        bash "$SWEEPER_SCRIPT" >/dev/null 2>&1 || true
}

# AC-M1-10 part 1: terminal task older than 24h is pruned.
test_sweeper_prunes_old_terminal() {
    CURRENT_TEST_NAME="AC-M1-10a: terminal task >24h pruned"
    local task_id="oldsucc01"
    local old_iso
    old_iso=$(iso_ago 90000)  # 25h ago
    make_fixture_task "$task_id" 1 "succeeded" "$old_iso" "$old_iso"

    run_sweeper

    assert_file_not_exists "$RL_TASKS_DIR/$task_id.json" "old terminal JSON should be pruned"
    assert_file_not_exists "$RL_TASKS_DIR/$task_id.log" "old terminal log should be pruned"
}

# AC-M1-10 part 2: recent terminal task is preserved.
test_sweeper_preserves_recent_terminal() {
    CURRENT_TEST_NAME="AC-M1-10b: recent terminal task <24h preserved"
    local task_id="recent001"
    local recent_iso
    recent_iso=$(iso_ago 82800)  # 23h ago
    make_fixture_task "$task_id" 1 "succeeded" "$recent_iso" "$recent_iso"

    run_sweeper

    assert_file_exists "$RL_TASKS_DIR/$task_id.json" "recent terminal task preserved"
}

# AC-M1-10 part 3: running task preserved regardless of age.
test_sweeper_preserves_running() {
    CURRENT_TEST_NAME="AC-M1-10c: running task preserved regardless of age"
    local task_id="oldrunn01"
    local old_iso
    old_iso=$(iso_ago 1000000)  # ~11 days ago
    make_fixture_task "$task_id" 1 "running" "$old_iso" "null"

    run_sweeper

    assert_file_exists "$RL_TASKS_DIR/$task_id.json" "running task preserved despite age"
}

# Configurable retention window.
test_sweeper_respects_retention_var() {
    CURRENT_TEST_NAME="TASK_RETENTION_SECONDS env override works"
    local task_id="customret"
    local iso
    iso=$(iso_ago 100)  # 100s ago
    make_fixture_task "$task_id" 1 "succeeded" "$iso" "$iso"

    TASK_RETENTION_SECONDS=60 run_sweeper

    assert_file_not_exists "$RL_TASKS_DIR/$task_id.json" \
        "task older than 60s should be pruned when TASK_RETENTION_SECONDS=60"
}

# Mixed batch: prunes the right files, preserves the others.
test_sweeper_mixed_batch() {
    CURRENT_TEST_NAME="mixed batch: prunes terminal-old, preserves terminal-new + running-old"
    local now_iso old_iso
    now_iso=$(iso_ago 60)
    old_iso=$(iso_ago 90000)
    make_fixture_task "kill00001" 1 "succeeded" "$old_iso" "$old_iso"
    make_fixture_task "keep00001" 1 "succeeded" "$now_iso" "$now_iso"
    make_fixture_task "keep00002" 1 "running" "$old_iso" "null"
    make_fixture_task "kill00002" 1 "failed" "$old_iso" "$old_iso"
    make_fixture_task "kill00003" 1 "cancelled" "$old_iso" "$old_iso"

    run_sweeper

    assert_file_not_exists "$RL_TASKS_DIR/kill00001.json" "succeeded+old pruned"
    assert_file_not_exists "$RL_TASKS_DIR/kill00002.json" "failed+old pruned"
    assert_file_not_exists "$RL_TASKS_DIR/kill00003.json" "cancelled+old pruned"
    assert_file_exists "$RL_TASKS_DIR/keep00001.json" "succeeded+new kept"
    assert_file_exists "$RL_TASKS_DIR/keep00002.json" "running+old kept"
}

# ROK-1336 #3 — pidfile-mtime liveness check (PID-namespace-agnostic).
# Previously the sweeper used `kill -0 $PID` from inside its own container,
# which always reported the host PID dead and false-orphaned every running
# task after one sweep tick. The new contract: supervisor touches
# tasks/<id>.pid on a heartbeat, sweeper accepts the task as alive iff the
# pidfile exists AND its mtime is within PIDFILE_STALE_SECONDS.

# Build a "real-looking" running task with PID set (so the orphan path runs).
make_running_with_pid() {
    local task_id="$1" pid="$2"
    local recent_iso
    recent_iso=$(iso_ago 60)
    cat > "$RL_TASKS_DIR/$task_id.json" <<EOF
{
  "task_id": "$task_id",
  "tool": "manual",
  "slot": 1,
  "agent_id": "fixture",
  "args_summary": "",
  "cmd": ["/bin/sleep", "9999"],
  "log_path": "$RL_TASKS_DIR/$task_id.log",
  "pid": $pid,
  "status": "running",
  "script_exit_code": null,
  "started_at": "$recent_iso",
  "finished_at": null,
  "cancel_reason": null,
  "steps": []
}
EOF
    touch "$RL_TASKS_DIR/$task_id.log"
}

# Running task with PID set + fresh pidfile → preserved.
test_sweeper_preserves_running_with_fresh_pidfile() {
    CURRENT_TEST_NAME="ROK-1336 #3a: running task with fresh pidfile preserved"
    local task_id="alivetask"
    make_running_with_pid "$task_id" 99999
    : > "$RL_TASKS_DIR/$task_id.pid"
    PIDFILE_STALE_SECONDS=300 run_sweeper
    assert_file_exists "$RL_TASKS_DIR/$task_id.json" "running task with fresh pidfile preserved"
    assert_eq "$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json")" "running" "status stays running"
}

# Running task with PID set + stale pidfile → flipped to failed/orphaned.
test_sweeper_orphans_running_with_stale_pidfile() {
    CURRENT_TEST_NAME="ROK-1336 #3b: running task with stale pidfile orphaned"
    local task_id="staletask"
    make_running_with_pid "$task_id" 99998
    : > "$RL_TASKS_DIR/$task_id.pid"
    # Force the pidfile mtime back 10min so the 60s threshold trips. Try GNU
    # syntax first (Linux), then BSD/macOS (-A HHMMSS).
    touch -d "10 minutes ago" "$RL_TASKS_DIR/$task_id.pid" 2>/dev/null \
        || touch -A -001000 "$RL_TASKS_DIR/$task_id.pid" 2>/dev/null || true
    PIDFILE_STALE_SECONDS=60 run_sweeper
    assert_eq "$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json")" "failed" "stale pidfile flips status"
    assert_eq "$(jq -r '.cancel_reason' "$RL_TASKS_DIR/$task_id.json")" "orphaned" "cancel_reason=orphaned"
}

# Running task with PID set + missing pidfile → flipped (supervisor died).
test_sweeper_orphans_running_with_missing_pidfile() {
    CURRENT_TEST_NAME="ROK-1336 #3c: running task with missing pidfile orphaned"
    local task_id="nopidfile"
    make_running_with_pid "$task_id" 99997
    # Deliberately no pidfile.
    PIDFILE_STALE_SECONDS=60 run_sweeper
    assert_eq "$(jq -r '.status' "$RL_TASKS_DIR/$task_id.json")" "failed" "missing pidfile flips status"
    assert_eq "$(jq -r '.cancel_reason' "$RL_TASKS_DIR/$task_id.json")" "orphaned" "cancel_reason=orphaned"
}

run_test "ac-m1-10a-prune-old" test_sweeper_prunes_old_terminal
run_test "ac-m1-10b-keep-recent" test_sweeper_preserves_recent_terminal
run_test "ac-m1-10c-keep-running" test_sweeper_preserves_running
run_test "retention-override" test_sweeper_respects_retention_var
run_test "mixed-batch" test_sweeper_mixed_batch
run_test "rok-1336-3a-fresh-pidfile" test_sweeper_preserves_running_with_fresh_pidfile
run_test "rok-1336-3b-stale-pidfile" test_sweeper_orphans_running_with_stale_pidfile
run_test "rok-1336-3c-missing-pidfile" test_sweeper_orphans_running_with_missing_pidfile

print_test_summary
