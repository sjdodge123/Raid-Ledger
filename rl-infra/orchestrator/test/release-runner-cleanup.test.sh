#!/usr/bin/env bash
# ROK-1331 M7 — release-side runner orphan-pkill cleanup.
#
# Real bug discovered during M5b dogfood: when a slot is released, any shell
# processes started via the OLD `ssh run-on-runner -- bash ...` path inside
# the runner container keep running because docker-init reparents them to
# PID 1. M1's task-cancel cascade catches the NEW MCP task-execution path
# but NOT the legacy CLI direct path. Witnessed: rok-1335's validate-ci.sh +
# jest survived their `rl release` and contended for DB ports against the
# next claim.
#
# Fix: release sends SIGTERM (then SIGKILL after 3s) to runner-side
# processes matching validate-ci.sh|jest|vitest|npm|node, BEFORE M5a's
# lease-advance. Block fires unconditionally (preserve-envs OR destroy-envs).
#
# Tests stub `docker` (in a tmp dir prepended to PATH) so they run locally
# without a real runner container — same pattern as existing tests stub
# task-cancel / lease-advance via symlinks in BIN_DIR.

set -uo pipefail

CURRENT_TEST_FILE="release-runner-cleanup.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# Seed an active claim on slot 1 with an env entry (so env-preserve marking
# logic + lease-advance both have something to chew on, exercising the
# cleanup block alongside the rest of release).
_seed_active_claim() {
    local agent="$1" branch="$2"
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg a "$agent" --arg b "$branch" --arg t "$now" '
        [
            {slot:1, claimed:true, agent_id:$a, branch:$b, started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    # Empty env-registry; release still iterates the cleanup block before
    # touching envs.
    echo "[]" > "$RL_STATE_DIR/env-registry.json"
}

# Create a fake `docker` shim in a tmp dir prepended to PATH. Records every
# invocation argv (one per line) to a sentinel file so tests can assert
# ordering + signal selection + container name.
_install_fake_docker() {
    local sentinel="$1"
    local missing_runner="${2:-0}"
    FAKE_BIN=$(mktemp -d -t rl-fake-bin.XXXXXX)
    cat > "$FAKE_BIN/docker" <<EOF
#!/usr/bin/env bash
echo "docker \$*" >> "$sentinel"
# Simulate missing runner container — pkill returns 1 (no procs killed)
# but the runner-cleanup block in release MUST treat this as a noop.
if [[ "$missing_runner" == "1" && "\$1" == "exec" ]]; then
    echo "Error: No such container: \$2" >&2
    exit 1
fi
exit 0
EOF
    chmod +x "$FAKE_BIN/docker"
    # Stub task-cancel + lease-advance so they're observable in the same sentinel.
    cat > "$FAKE_BIN/task-cancel" <<EOF
#!/usr/bin/env bash
echo "task-cancel \$*" >> "$sentinel"
exit 0
EOF
    chmod +x "$FAKE_BIN/task-cancel"
    cat > "$FAKE_BIN/lease-advance" <<EOF
#!/usr/bin/env bash
echo "lease-advance \$*" >> "$sentinel"
exit 0
EOF
    chmod +x "$FAKE_BIN/lease-advance"
    # Stub env-destroy too in case the destroy-envs path is exercised.
    cat > "$FAKE_BIN/env-destroy" <<EOF
#!/usr/bin/env bash
echo "env-destroy \$*" >> "$sentinel"
exit 0
EOF
    chmod +x "$FAKE_BIN/env-destroy"
}

# Sym-link the fake task-cancel + lease-advance into BIN_DIR so release's
# `"$(dirname "$0")/task-cancel"` and `lease-advance` references resolve
# to our stubs without the test having to monkey-patch PATH ordering.
# Backups recorded into per-link sentinel files (bash 3 compatible — no
# `declare -g` arrays).
_link_stubs_into_bin_dir() {
    local fake_dir="$1"
    STUB_NAMES="task-cancel lease-advance env-destroy"
    STUB_BACKUP_DIR=$(mktemp -d -t rl-stub-backups.XXXXXX)
    for name in $STUB_NAMES; do
        local link="$BIN_DIR/$name"
        if [[ -e "$link" || -L "$link" ]]; then
            mv "$link" "$STUB_BACKUP_DIR/$name"
        fi
        ln -s "$fake_dir/$name" "$link"
    done
}

_restore_stubs() {
    for name in ${STUB_NAMES:-}; do
        local link="$BIN_DIR/$name"
        rm -f "$link"
        if [[ -n "${STUB_BACKUP_DIR:-}" && -e "$STUB_BACKUP_DIR/$name" ]]; then
            mv "$STUB_BACKUP_DIR/$name" "$link"
        fi
    done
    [[ -n "${STUB_BACKUP_DIR:-}" && -d "$STUB_BACKUP_DIR" ]] && rm -rf "$STUB_BACKUP_DIR"
    [[ -n "${FAKE_BIN:-}" && -d "$FAKE_BIN" ]] && rm -rf "$FAKE_BIN"
    unset FAKE_BIN STUB_NAMES STUB_BACKUP_DIR
}

# AC-M7-1: release calls `docker exec rl-runner-<SLOT>` with pkill targeting
# the documented process pattern (validate-ci.sh|jest|vitest|npm|node).
test_release_pkills_orphan_processes_on_runner() {
    CURRENT_TEST_NAME="AC-M7-1: release runs docker exec rl-runner-<SLOT> pkill against orphan procs"
    _seed_active_claim "agent-A" "feat-cleanup"
    export RL_AGENT_ID="agent-A"

    local sentinel="$RL_STATE_DIR/cleanup.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel"
    _link_stubs_into_bin_dir "$FAKE_BIN"

    PATH="$FAKE_BIN:$PATH" "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true

    # Must invoke docker exec at least once targeting rl-runner-1.
    if ! grep -q "docker exec.*rl-runner-1" "$sentinel" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: no docker exec for rl-runner-1")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] release did not invoke docker exec rl-runner-1"
        echo "sentinel contents:"
        cat "$sentinel" 2>/dev/null | sed 's/^/  /'
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    # Must mention pkill targeting validate-ci.sh|jest|vitest|npm|node.
    if grep -E -q "pkill.*(validate-ci\.sh|jest|vitest)" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: pkill pattern missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] pkill pattern (validate-ci.sh|jest|vitest) missing"
    fi

    _restore_stubs
}

# AC-M7-2: SIGTERM first, SIGKILL after 3s if stragglers — block invokes
# pkill -TERM and pkill -KILL (in that order). The "after 3s" is sequencing,
# not real-time timing — we just confirm both signals appear and TERM is
# first.
test_release_sigterm_then_sigkill() {
    CURRENT_TEST_NAME="AC-M7-2: SIGTERM precedes SIGKILL in runner-cleanup block"
    _seed_active_claim "agent-B" "feat-signal"
    export RL_AGENT_ID="agent-B"

    local sentinel="$RL_STATE_DIR/cleanup.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel"
    _link_stubs_into_bin_dir "$FAKE_BIN"

    PATH="$FAKE_BIN:$PATH" "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true

    local term_line kill_line
    term_line=$(grep -n 'pkill.*-TERM' "$sentinel" 2>/dev/null | head -1 | cut -d: -f1)
    kill_line=$(grep -n 'pkill.*-KILL' "$sentinel" 2>/dev/null | head -1 | cut -d: -f1)

    if [[ -z "$term_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: SIGTERM pkill missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] SIGTERM pkill not invoked"
    elif [[ -z "$kill_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: SIGKILL pkill missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] SIGKILL pkill not invoked"
    elif (( term_line < kill_line )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: TERM at $term_line, KILL at $kill_line (TERM must come first)")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] SIGTERM must precede SIGKILL"
    fi

    _restore_stubs
}

# AC-M7-3: orphan cleanup runs BEFORE lease-advance.
test_runner_cleanup_before_lease_advance() {
    CURRENT_TEST_NAME="AC-M7-3: docker exec runner cleanup precedes lease-advance"
    _seed_active_claim "agent-C" "feat-order"
    export RL_AGENT_ID="agent-C"

    local sentinel="$RL_STATE_DIR/cleanup.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel"
    _link_stubs_into_bin_dir "$FAKE_BIN"

    PATH="$FAKE_BIN:$PATH" "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true

    local cleanup_line advance_line
    cleanup_line=$(grep -n 'docker exec.*rl-runner-1.*pkill' "$sentinel" 2>/dev/null | head -1 | cut -d: -f1)
    advance_line=$(grep -n '^lease-advance ' "$sentinel" 2>/dev/null | head -1 | cut -d: -f1)

    if [[ -z "$cleanup_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: runner-cleanup pkill not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] docker exec pkill missing"
    elif [[ -z "$advance_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: lease-advance not invoked")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] lease-advance missing"
    elif (( cleanup_line < advance_line )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: runner-cleanup at $cleanup_line, lease-advance at $advance_line (cleanup must come first)")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] runner-cleanup must precede lease-advance"
    fi

    _restore_stubs
}

# AC-M7-4: orphan cleanup fires even under --preserve-envs (unconditional).
# Already covered by tests above, but explicit assertion here makes the
# contract obvious in test output.
test_runner_cleanup_unconditional_on_preserve_envs() {
    CURRENT_TEST_NAME="AC-M7-4: runner-cleanup runs with --preserve-envs (not gated on destroy)"
    _seed_active_claim "agent-D" "feat-preserve"
    export RL_AGENT_ID="agent-D"

    local sentinel="$RL_STATE_DIR/cleanup.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel"
    _link_stubs_into_bin_dir "$FAKE_BIN"

    PATH="$FAKE_BIN:$PATH" "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true

    if grep -q "docker exec.*rl-runner-1.*pkill" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: cleanup did NOT fire under --preserve-envs")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] cleanup must fire unconditionally"
    fi

    _restore_stubs
}

# AC-M7-5: missing runner container is a noop (does not crash release).
# The fake docker is configured to exit 1 from exec; release should not
# propagate the error to its overall exit code.
test_runner_cleanup_missing_container_is_noop() {
    CURRENT_TEST_NAME="AC-M7-5: missing runner container → cleanup is a noop, release exit 0"
    _seed_active_claim "agent-E" "feat-noop"
    export RL_AGENT_ID="agent-E"

    local sentinel="$RL_STATE_DIR/cleanup.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel" 1   # missing_runner=1
    _link_stubs_into_bin_dir "$FAKE_BIN"

    local out exit_code
    out=$(PATH="$FAKE_BIN:$PATH" "$BIN_DIR/release" --preserve-envs 2>&1)
    exit_code=$?

    # release proceeded through to print its JSON envelope.
    if echo "$out" | grep -q '"ok":\s*true'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: release did not return ok:true with missing runner")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] release crashed on missing runner (exit=$exit_code, out=$out)"
    fi

    # release must still have called lease-advance after the cleanup attempt.
    if grep -q '^lease-advance ' "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: lease-advance not invoked after cleanup error")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] release short-circuited after docker exec failed"
    fi

    _restore_stubs
}

# AC-M7-bonus: cleanup is audit-logged so operators can correlate post-mortem.
test_runner_cleanup_audit_logged() {
    CURRENT_TEST_NAME="AC-M7-bonus: runner_cleanup audit log entry exists"
    _seed_active_claim "agent-F" "feat-audit"
    export RL_AGENT_ID="agent-F"

    local sentinel="$RL_STATE_DIR/cleanup.invoked"
    : > "$sentinel"
    _install_fake_docker "$sentinel"
    _link_stubs_into_bin_dir "$FAKE_BIN"

    PATH="$FAKE_BIN:$PATH" "$BIN_DIR/release" --preserve-envs >/dev/null 2>&1 || true

    if grep -q 'runner_cleanup' "$RL_STATE_DIR/audit.log" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: audit.log missing runner_cleanup entry")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] no runner_cleanup audit entry"
    fi

    _restore_stubs
}

run_test "ac-m7-1-pkills-orphans" test_release_pkills_orphan_processes_on_runner
run_test "ac-m7-2-sigterm-then-sigkill" test_release_sigterm_then_sigkill
run_test "ac-m7-3-cleanup-before-lease-advance" test_runner_cleanup_before_lease_advance
run_test "ac-m7-4-unconditional-on-preserve" test_runner_cleanup_unconditional_on_preserve_envs
run_test "ac-m7-5-missing-runner-noop" test_runner_cleanup_missing_container_is_noop
run_test "ac-m7-bonus-audit-logged" test_runner_cleanup_audit_logged

print_test_summary
