#!/usr/bin/env bash
# ROK-1331 M11 — perf logging tests (AC1, AC3, AC5).
#
# AC1 — orchestrator events present: claim.acquired, release.start/end,
#       release.pkill_audit, lease.advance.end after a claim+release cycle.
# AC3 — pkill verification ran (release.pkill_audit appears with
#       surviving_count field — value is 0 on the mock test path since no
#       runner container exists; the AC asserts the AUDIT happened, not
#       that the kill killed anything).
# AC5 — rotation safety: copytruncate-compatible. The perf::emit helper
#       opens/appends/closes per call (no long-lived FD), so a logrotate
#       run mid-stream doesn't lose events. Simulate by truncating perf.log
#       mid-suite and asserting subsequent emits still land in the new file.
#
# Tests run LOCALLY (no SSH); they redirect RL_STATE_DIR to per-test temp
# dirs. Matches the convention used by the rest of the orchestrator test
# suite.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_TEST_FILE="$(basename "${BASH_SOURCE[0]}")"
source "$TEST_DIR/test_helpers.sh"

# ---------------------------------------------------------------------------
# AC1 — perf::emit writes a line with required fields
# ---------------------------------------------------------------------------
test_perf_emit_writes_required_fields() {
    # Source _state.sh inside a fresh subshell so init runs against the test
    # state dir. perf::emit lives in _state.sh after M11.
    (
        cd "$TEST_DIR/.."
        source "$TEST_DIR/../bin/_state.sh"

        # Helper must exist after M11. Until then this test fails (TDD red).
        if ! type perf::emit >/dev/null 2>&1; then
            echo "FAIL: perf::emit helper is not defined in _state.sh"
            return 1
        fi

        export RL_AGENT_ID="agent-perf-1"
        perf::emit "claim.acquired" '{"slot":1,"queue_wait_ms":0}'

        local line
        line=$(tail -1 "$RL_PERF_LOG")

        # Required fields: ts, event, source=orchestrator, agent_id, slot
        local got_event
        got_event=$(jq -r '.event' <<<"$line")
        assert_eq "$got_event" "claim.acquired" "event field"

        local got_source
        got_source=$(jq -r '.source' <<<"$line")
        assert_eq "$got_source" "orchestrator" "source field"

        local got_agent
        got_agent=$(jq -r '.agent_id' <<<"$line")
        assert_eq "$got_agent" "agent-perf-1" "agent_id field"

        local got_slot
        got_slot=$(jq -r '.slot' <<<"$line")
        assert_eq "$got_slot" "1" "slot field merged from extra"

        # ts must be ISO-8601 UTC
        local got_ts
        got_ts=$(jq -r '.ts' <<<"$line")
        if [[ "$got_ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$ ]]; then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: ts not ISO-8601 ms — got '$got_ts'"
        fi
    )
}

# ---------------------------------------------------------------------------
# AC1 — perf::start / perf::end emit a duration_ms field
# ---------------------------------------------------------------------------
test_perf_start_end_emits_duration_ms() {
    (
        cd "$TEST_DIR/.."
        source "$TEST_DIR/../bin/_state.sh"

        if ! type perf::start >/dev/null 2>&1 || ! type perf::end >/dev/null 2>&1; then
            echo "FAIL: perf::start / perf::end helpers not defined"
            return 1
        fi

        export RL_AGENT_ID="agent-perf-2"
        perf::start "release_total"
        # Sleep enough to register a non-zero ms delta even on EPOCHREALTIME
        # rounding paths.
        sleep 0.1
        perf::end "release_total" "release.end" '{"slot":2}'

        local line
        line=$(tail -1 "$RL_PERF_LOG")

        local got_event
        got_event=$(jq -r '.event' <<<"$line")
        assert_eq "$got_event" "release.end" "event field"

        # duration_ms must be present and > 0
        local got_dur
        got_dur=$(jq -r '.duration_ms' <<<"$line")
        if [[ "$got_dur" =~ ^[0-9]+$ ]] && [[ "$got_dur" -gt 0 ]]; then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: duration_ms not a positive integer — got '$got_dur'"
        fi

        local got_slot
        got_slot=$(jq -r '.slot' <<<"$line")
        assert_eq "$got_slot" "2" "extra slot field preserved"
    )
}

# ---------------------------------------------------------------------------
# AC3 — release writes release.pkill_audit with surviving_count field
# ---------------------------------------------------------------------------
test_release_emits_pkill_audit_event() {
    (
        cd "$TEST_DIR/.."
        source "$TEST_DIR/../bin/_state.sh"

        export RL_AGENT_ID="agent-perf-3"
        # Seed a claim on slot 1.
        state::mutate "$RL_CLAIMS_FILE" --arg a "$RL_AGENT_ID" --arg b "test-branch" --arg ts "$(date -u +%FT%TZ)" \
            'map(if .slot == 1 then .claimed = true | .agent_id = $a | .branch = $b | .started_at = $ts | .last_heartbeat = $ts else . end)'

        # Run release. The runner container does not exist on the test host;
        # release's docker exec branches no-op. After M11 the pkill_audit
        # event MUST still be emitted with surviving_count:0.
        "$TEST_DIR/../bin/release" >/dev/null 2>&1 || true

        if [[ ! -s "$RL_PERF_LOG" ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: perf.log is empty after release"
            return 1
        fi

        local pkill_line
        pkill_line=$(grep '"release.pkill_audit"' "$RL_PERF_LOG" | tail -1 || true)
        if [[ -z "$pkill_line" ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: release did not emit release.pkill_audit perf event"
            echo "perf.log contents:"
            cat "$RL_PERF_LOG"
            return 1
        fi

        local got_survivors
        got_survivors=$(jq -r '.surviving_count' <<<"$pkill_line")
        if [[ "$got_survivors" == "null" ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: release.pkill_audit missing surviving_count field"
            return 1
        fi
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))

        # release.start and release.end events also present per AC1.
        if grep -q '"release.start"' "$RL_PERF_LOG"; then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: release did not emit release.start"
        fi
        if grep -q '"release.end"' "$RL_PERF_LOG"; then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: release did not emit release.end"
        fi
    )
}

# ---------------------------------------------------------------------------
# AC5 — copytruncate compatibility: per-call append survives mid-stream
# truncation. logrotate's copytruncate first copies the file then truncates
# the original in place; long-lived FD writers would keep writing to the
# pre-truncate offset (sparse file). perf::emit MUST open+append+close per
# call so the next emit sees the empty file and starts at byte 0.
# ---------------------------------------------------------------------------
test_perf_log_rotation_safe() {
    (
        cd "$TEST_DIR/.."
        source "$TEST_DIR/../bin/_state.sh"

        export RL_AGENT_ID="agent-perf-5"
        perf::emit "claim.acquired" '{"slot":1}'
        perf::emit "claim.acquired" '{"slot":2}'

        local size_before
        size_before=$(wc -c <"$RL_PERF_LOG")
        if [[ "$size_before" -le 0 ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: perf.log empty before truncate"
            return 1
        fi

        # Simulate logrotate copytruncate.
        : > "$RL_PERF_LOG"

        perf::emit "release.start" '{"slot":3}'

        local size_after
        size_after=$(wc -c <"$RL_PERF_LOG")
        if [[ "$size_after" -le 0 ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: post-truncate emit did not write to perf.log"
            return 1
        fi
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))

        local last
        last=$(jq -r '.event' <"$RL_PERF_LOG")
        assert_eq "$last" "release.start" "post-rotate emit lands as new line in fresh file"
    )
}

# ---------------------------------------------------------------------------
# gc-sweeper emits gc.sweep.cycle with duration_ms
# ---------------------------------------------------------------------------
test_sweeper_emits_cycle_event() {
    (
        cd "$TEST_DIR/.."
        source "$TEST_DIR/../bin/_state.sh"

        # The sweeper script reads STATE_DIR, not RL_STATE_DIR — set both.
        export STATE_DIR="$RL_STATE_DIR"
        export ORCHESTRATOR_BIN_DIR="$TEST_DIR/../bin"

        # Sweeper runs against the seeded empty state files set up by state::init.
        bash "$TEST_DIR/../../gc-sweeper/sweep.sh" >/dev/null 2>&1 || true

        local cycle_line
        cycle_line=$(grep '"gc.sweep.cycle"' "$RL_PERF_LOG" | tail -1 || true)
        if [[ -z "$cycle_line" ]]; then
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: gc-sweeper did not emit gc.sweep.cycle perf event"
            echo "perf.log contents:"
            cat "$RL_PERF_LOG" 2>/dev/null || echo "(missing)"
            return 1
        fi
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))

        local got_dur
        got_dur=$(jq -r '.duration_ms' <<<"$cycle_line")
        if [[ "$got_dur" =~ ^[0-9]+$ ]]; then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            echo "FAIL: gc.sweep.cycle missing duration_ms — got '$got_dur'"
        fi
    )
}

# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
run_test "perf::emit writes required fields" test_perf_emit_writes_required_fields
run_test "perf::start/end emits duration_ms" test_perf_start_end_emits_duration_ms
run_test "release emits pkill_audit perf event" test_release_emits_pkill_audit_event
run_test "perf.log rotation safe (copytruncate)" test_perf_log_rotation_safe
run_test "sweeper emits gc.sweep.cycle event" test_sweeper_emits_cycle_event

print_test_summary
