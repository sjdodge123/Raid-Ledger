#!/usr/bin/env bash
# Fleet sync_settings root-cause fix — sync-local-to-env.sh::read_infra_env.
#
# Covers the RL_ENV_JWT_SECRET "missing" false-alarm bug
# (TECH-DEBT-BACKLOG.md 2026-05-22 x2 + 2026-06-02 recurrence):
#   - OLD: `sudo grep ... /srv/rl-infra/.env` over rl-agent SSH. rl-agent has
#     no passwordless sudo → empty result, swallowed by `2>/dev/null || true`,
#     reported as "missing" even when the var was set.
#   - NEW: source .env over SSH (non-sudo, like _state.sh) and DISTINGUISH a
#     remote-read FAILURE from a genuinely-absent var.
#
# Strategy: extract the read_infra_env() function VERBATIM from the real
# script (single source of truth — no drift), then exercise it against an
# overridable `SSH_TO_VM` stub. No live VM needed. Runs under bash 3.2
# (macOS default) — the same shell the MCP server invokes the script with.

set -uo pipefail

CURRENT_TEST_FILE="sync-local-to-env-infra-read.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
SYNC_SCRIPT="$WORKTREE_ROOT/scripts/sync-local-to-env.sh"

# --- Extract read_infra_env() from the real script ---------------------------
# From the `read_infra_env() {` line through the first column-0 `}` (the
# function's own closing brace — the inner `{ ...; }` group closes inline).
extract_fn() {
    sed -n '/^read_infra_env() {/,/^}/p' "$SYNC_SCRIPT"
}

# Build a stub `ssh` whose behavior is controlled by env vars, then run the
# extracted function with SSH_TO_VM pointed at it. Echoes the resulting
# globals + RC in a stable, parseable form.
run_read_infra_env() {
    local stub="$1"
    local harness
    harness=$(mktemp -t rl-read-infra.XXXXXX)
    {
        echo 'set -uo pipefail'
        echo "SSH_TO_VM=(\"$stub\")"
        extract_fn
        echo 'read_infra_env'
        echo 'printf "RC=%s\n" "$INFRA_ENV_READ_RC"'
        echo 'printf "JWT=%s\n" "$REMOTE_ENV_JWT_SECRET"'
        echo 'printf "DOM=%s\n" "$REMOTE_PUBLIC_DOMAIN"'
        echo 'printf "ADM=%s\n" "$REMOTE_ADMIN_PASSWORD"'
        echo 'printf "ERR=%s\n" "$INFRA_ENV_READ_STDERR"'
    } > "$harness"
    /bin/bash "$harness"
    rm -f "$harness"
}

make_stub() {
    # $1 = stub path, remaining lines piped on stdin become the stub body.
    local path="$1"
    cat > "$path"
    chmod +x "$path"
}

STUB_DIR=$(mktemp -d -t rl-read-infra-stubs.XXXXXX)
trap 'rm -rf "$STUB_DIR"' EXIT

# ---------------------------------------------------------------------------
# Case 1: extraction sanity — the function MUST be present + parseable.
test_extraction() {
    CURRENT_TEST_NAME="function read_infra_env extracts + parses"
    local fn; fn=$(extract_fn)
    assert_contains "$fn" "read_infra_env() {" "function header present"
    assert_contains "$fn" "__RL_EOF__" "sentinel present"
    if echo "$fn" | /bin/bash -n - 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: extracted fn does not parse")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] extracted function failed bash -n"
    fi
}

# Case 2: all three present → RC=0, values populated.
test_all_present() {
    CURRENT_TEST_NAME="all vars present → RC=0, values returned"
    local stub="$STUB_DIR/ok"
    make_stub "$stub" <<'STUB'
#!/usr/bin/env bash
printf "%s\n" "jwt-secret-abc" "tests.gamernight.net" "admin-pw-xyz" "__RL_EOF__"
STUB
    local out; out=$(run_read_infra_env "$stub")
    assert_contains "$out" "RC=0" "read succeeded"
    assert_contains "$out" "JWT=jwt-secret-abc" "jwt value"
    assert_contains "$out" "DOM=tests.gamernight.net" "domain value"
    assert_contains "$out" "ADM=admin-pw-xyz" "admin pw value"
}

# Case 3: read SUCCEEDS but JWT empty → RC=0 + empty JWT = GENUINELY ABSENT.
# This is the case the caller maps to the "genuinely absent" error (exit 4).
test_genuinely_absent() {
    CURRENT_TEST_NAME="read ok but JWT empty → RC=0 (genuinely absent)"
    local stub="$STUB_DIR/absent"
    make_stub "$stub" <<'STUB'
#!/usr/bin/env bash
printf "%s\n" "" "tests.gamernight.net" "" "__RL_EOF__"
STUB
    local out; out=$(run_read_infra_env "$stub")
    assert_contains "$out" "RC=0" "read itself succeeded"
    # JWT line must be exactly empty.
    if echo "$out" | grep -qx "JWT="; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: JWT not empty")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected empty JWT line; got:"
        echo "$out"
    fi
    # Trailing-empty field (ADM) must also survive as empty, not misalign.
    assert_contains "$out" "DOM=tests.gamernight.net" "domain still aligned"
}

# Case 4: file not readable by rl-agent → RC=7 (read FAILED, NOT missing).
test_unreadable() {
    CURRENT_TEST_NAME=".env unreadable → RC=7 (read failed, not absent)"
    local stub="$STUB_DIR/unreadable"
    make_stub "$stub" <<'STUB'
#!/usr/bin/env bash
echo "RL_INFRA_ENV_UNREADABLE: /srv/rl-infra/.env not readable by rl-agent" >&2
exit 7
STUB
    local out; out=$(run_read_infra_env "$stub")
    assert_contains "$out" "RC=7" "read-failure code"
    assert_contains "$out" "ERR=RL_INFRA_ENV_UNREADABLE" "stderr surfaced"
}

# Case 5: ssh transport error (e.g. host unreachable) → RC=255, read failed.
test_ssh_transport_fail() {
    CURRENT_TEST_NAME="ssh transport error → RC!=0 (read failed)"
    local stub="$STUB_DIR/sshfail"
    make_stub "$stub" <<'STUB'
#!/usr/bin/env bash
echo "ssh: connect to host rl-infra port 22: Operation timed out" >&2
exit 255
STUB
    local out; out=$(run_read_infra_env "$stub")
    assert_contains "$out" "RC=255" "transport error code preserved"
    assert_neq "$(echo "$out" | grep '^RC=')" "RC=0" "must not look like success"
}

# Case 6: truncated/garbled payload (no sentinel) → RC=8.
test_truncated() {
    CURRENT_TEST_NAME="truncated payload (no sentinel) → RC=8"
    local stub="$STUB_DIR/trunc"
    make_stub "$stub" <<'STUB'
#!/usr/bin/env bash
printf "%s\n" "jwt-secret-abc"
STUB
    local out; out=$(run_read_infra_env "$stub")
    assert_contains "$out" "RC=8" "sentinel-mismatch code"
    assert_contains "$out" "ERR=truncated/garbled" "truncation reported"
}

# Case 7: STATIC — the old sudo-grep read path is gone, new contract present.
test_no_sudo_grep_remains() {
    CURRENT_TEST_NAME="STATIC: no 'sudo grep' read of /srv/rl-infra/.env remains"
    # Only flag executable usage, not the explanatory comments.
    local hits
    hits=$(grep -nE '^[[:space:]]*[^#].*sudo[[:space:]]+grep' "$SYNC_SCRIPT" || true)
    if [[ -z "$hits" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sudo grep still present")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] sudo grep still in script:"
        echo "$hits"
    fi
}

test_diagnosability_contract() {
    CURRENT_TEST_NAME="STATIC: caller distinguishes read-failure (exit 6) from absent (exit 4)"
    local body; body=$(cat "$SYNC_SCRIPT")
    assert_contains "$body" "INFRA_ENV_READ_RC != 0" "caller branches on read RC"
    assert_contains "$body" "remote-read failure, NOT a missing variable" "read-failure message"
    assert_contains "$body" "genuinely ABSENT" "genuinely-absent message"
    assert_contains "$body" "exit 6" "dedicated read-failure exit code"
}

run_test "extraction" test_extraction
run_test "all-present" test_all_present
run_test "genuinely-absent" test_genuinely_absent
run_test "unreadable-rc7" test_unreadable
run_test "ssh-transport-fail" test_ssh_transport_fail
run_test "truncated-rc8" test_truncated
run_test "no-sudo-grep" test_no_sudo_grep_remains
run_test "diagnosability" test_diagnosability_contract

print_test_summary
