#!/usr/bin/env bash
# ROK-1331 M9 — validate-ci.sh per-slot Redis sidecar.
#
# When RL_TARGET=remote the integration-test step must spawn a per-slot
# Redis sidecar (rl-test-redis-${RL_SLOT}), wire REDIS_URL at it, and tear
# it down on EXIT (even on failure). Local mode (RL_TARGET=local) must NOT
# spawn a sidecar — the laptop's deploy_dev.sh handles Redis.
#
# Strategy:
#   - Structural: grep validate-ci.sh for the sidecar markers (container
#     name, network, REDIS_URL export, trap, idempotency `docker rm -f`,
#     ping-wait loop, audit log marker, local-mode guard).
#   - Behavioral: source validate-ci.sh with RL_VALIDATE_CI_DRY=1 (the
#     existing M6b dry-run guard) and a docker stub on PATH. Verify the
#     stub records the expected docker commands when RL_TARGET=remote and
#     records NOTHING when RL_TARGET=local.
#
# These tests MUST fail today — no Redis-sidecar logic exists yet.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-redis-sidecar.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REPO_ROOT/scripts/validate-ci.sh"

TEST_PASS_COUNT=0
TEST_FAIL_COUNT=0
TEST_FAIL_NAMES=()
CURRENT_TEST_NAME=""

pass() { TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1)); }
fail() {
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $1")
    echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $1"
}

assert_grep() {
    local pattern="$1" file="$2" message="${3:-}"
    if grep -E -q -- "$pattern" "$file"; then
        pass
    else
        fail "$message (pattern not found in $file: $pattern)"
    fi
}

# Build stub bin dir for behavioral block. Stubs docker (records argv to a
# file, optionally controls exit code) and redis-cli (so ping-wait succeeds
# without a real container). npm is stubbed to no-op so the integration
# step body runs to completion without trying jest.
make_stub_bin() {
    local stub_dir
    stub_dir=$(mktemp -d -t rl-redis-stub.XXXXXX)
    cat >"$stub_dir/docker" <<'EOF'
#!/usr/bin/env bash
# Record argv to the file so the test can assert on the commands issued.
if [[ -n "${STUB_DOCKER_ARGV_FILE:-}" ]]; then
    echo "$*" >>"$STUB_DOCKER_ARGV_FILE"
fi
# Simulate `docker exec ... redis-cli ping` → PONG so the wait-loop exits.
if [[ "$1" == "exec" && "$*" == *"redis-cli ping"* ]]; then
    echo "PONG"
    exit 0
fi
# All other docker subcommands succeed.
exit "${STUB_DOCKER_EXIT:-0}"
EOF
    cat >"$stub_dir/npm" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    cat >"$stub_dir/npx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$stub_dir/docker" "$stub_dir/npm" "$stub_dir/npx"
    echo "$stub_dir"
}

dry_run_guard_present() {
    grep -E -q 'RL_VALIDATE_CI_DRY' "$VALIDATE_CI_PATH"
}

# ===== Structural assertions =====

# AC-M9-1: sidecar spawn uses rl-test-redis-${RL_SLOT} container name on rl-net.
CURRENT_TEST_NAME="AC-M9-1: sidecar spawn uses rl-test-redis-\${RL_SLOT} on rl-net"
assert_grep 'rl-test-redis-' "$VALIDATE_CI_PATH" "expected rl-test-redis- container-name prefix in validate-ci.sh"
assert_grep 'rl-net' "$VALIDATE_CI_PATH" "sidecar must join rl-net docker network"
assert_grep 'redis:7-alpine' "$VALIDATE_CI_PATH" "sidecar must use redis:7-alpine image"

# AC-M9-2: local mode guard — sidecar block must be gated on RL_TARGET=remote.
CURRENT_TEST_NAME="AC-M9-2: sidecar block gated on RL_TARGET=remote"
# We assert that the rl-test-redis- string appears inside a remote-gated
# branch. Cheap proxy: grep for both markers in the script; behavioral
# block below verifies local mode emits ZERO docker calls.
assert_grep 'RL_TARGET' "$VALIDATE_CI_PATH" "sidecar block must reference RL_TARGET"

# AC-M9-3: REDIS_URL exported at the sidecar hostname.
CURRENT_TEST_NAME="AC-M9-3: REDIS_URL exported at rl-test-redis-\${RL_SLOT}"
assert_grep 'REDIS_URL=.*rl-test-redis-' "$VALIDATE_CI_PATH" "REDIS_URL must be exported pointing at rl-test-redis-\${RL_SLOT}:6379"

# AC-M9-4: trap on EXIT for teardown.
CURRENT_TEST_NAME="AC-M9-4: trap cleans up sidecar on EXIT"
assert_grep "trap.*rl-test-redis" "$VALIDATE_CI_PATH" "must install a trap that stops rl-test-redis-\${RL_SLOT} on EXIT"

# AC-M9-5: idempotency — docker rm -f before docker run.
CURRENT_TEST_NAME="AC-M9-5: idempotency via docker rm -f before run"
assert_grep 'docker rm -f' "$VALIDATE_CI_PATH" "must docker rm -f any stale rl-test-redis-\${RL_SLOT} before spawning fresh"

# AC-M9-6: ping-wait with bounded timeout.
CURRENT_TEST_NAME="AC-M9-6: redis-cli ping bounded wait"
assert_grep 'redis-cli ping' "$VALIDATE_CI_PATH" "must probe sidecar readiness via redis-cli ping"
# Bounded — the loop must reference a timeout constant (30s per brief).
assert_grep '30' "$VALIDATE_CI_PATH" "must bound the ping-wait loop (30s per brief)"

# AC-M9-7: audit log line so /api/fleet-health can surface this later.
CURRENT_TEST_NAME="AC-M9-7: structured audit log entry for sidecar spawn"
assert_grep 'rl-test-redis' "$VALIDATE_CI_PATH" "audit-log line must mention rl-test-redis"
# We expect at least one echo/printf referencing rl-test-redis for forensics.
audit_line=$(grep -E '(echo|printf).*rl-test-redis' "$VALIDATE_CI_PATH" || true)
if [[ -n "$audit_line" ]]; then pass; else fail "expected an echo/printf line mentioning rl-test-redis for audit log"; fi

# ===== Behavioral assertions (skipped if guard absent) =====

if ! dry_run_guard_present; then
    echo "[SKIP behavioral block — RL_VALIDATE_CI_DRY guard missing]"
else
    stub_bin=$(make_stub_bin)
    docker_argv_file=$(mktemp -t rl-redis-docker-argv.XXXXXX)

    CURRENT_TEST_NAME="AC-M9-8: behavioral remote — sidecar spawn + REDIS_URL export"
    : >"$docker_argv_file"
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        RL_SLOT="1" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; type run_integration_tests >/dev/null 2>&1 && run_integration_tests; echo REDIS_URL_AFTER=\${REDIS_URL:-UNSET}" 2>&1
    )
    # Sidecar should be spawned with the slot-1 name.
    if grep -E -q 'run -d .*--name rl-test-redis-1' "$docker_argv_file"; then pass; else fail "expected docker run with --name rl-test-redis-1 in remote mode (got: $(cat "$docker_argv_file" | tr '\n' '|'))"; fi
    # rl-net must be wired.
    if grep -E -q 'network rl-net' "$docker_argv_file"; then pass; else fail "expected --network rl-net on the docker run call"; fi
    # REDIS_URL must be exported at the sidecar.
    if grep -E -q 'REDIS_URL_AFTER=redis://rl-test-redis-1:6379' <<<"$out"; then pass; else fail "expected REDIS_URL=redis://rl-test-redis-1:6379 in remote mode (got: $(grep REDIS_URL_AFTER <<<"$out"))"; fi
    # Stale-cleanup via docker rm -f must precede docker run.
    if grep -E -q 'rm -f rl-test-redis-1' "$docker_argv_file"; then pass; else fail "expected docker rm -f rl-test-redis-1 before spawn (idempotency)"; fi

    CURRENT_TEST_NAME="AC-M9-9: behavioral local — no docker invocations"
    : >"$docker_argv_file"
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="local" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; type run_integration_tests >/dev/null 2>&1 && run_integration_tests; echo REDIS_URL_AFTER=\${REDIS_URL:-UNSET}" 2>&1
    )
    # No sidecar docker calls in local mode.
    if grep -E -q 'rl-test-redis' "$docker_argv_file"; then
        fail "RL_TARGET=local must NOT spawn a sidecar (docker calls: $(cat "$docker_argv_file" | tr '\n' '|'))"
    else
        pass
    fi
    # REDIS_URL must remain unset in local mode (laptop deploy_dev.sh's Redis takes over).
    if grep -E -q 'REDIS_URL_AFTER=UNSET|REDIS_URL_AFTER=redis://localhost' <<<"$out"; then pass; else fail "RL_TARGET=local must NOT export sidecar REDIS_URL (got: $(grep REDIS_URL_AFTER <<<"$out"))"; fi

    rm -rf "$stub_bin" "$docker_argv_file"
fi

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do
        echo "  - $f"
    done
    exit 1
fi
exit 0
