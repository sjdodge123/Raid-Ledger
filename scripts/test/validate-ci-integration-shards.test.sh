#!/usr/bin/env bash
# ROK-1331 M10 — validate-ci.sh jest integration test sharding.
#
# When run inside the fleet runner (RL_TARGET=remote OR /workspace bind-mount
# present), run_integration_tests must split the jest invocation into N shards
# (default 4) so each shard is its own Node process and V8 heap is freed
# between shards. Probe 1 attempt 5 OOM'd with `Reached heap limit
# Allocation failed - JavaScript heap out of memory` after ~50 of ~98 suites.
#
# Required loop shape:
#   - $INTEGRATION_SHARDS (default 4) shards
#   - `npx jest --config api/jest.integration.config.js --runInBand
#      --verbose --shard=$i/$N` per shard
#   - NODE_OPTIONS=--max-old-space-size=3072 per shard
#   - Fast-fail: first shard failure aborts the loop, returns 1
#   - M9 sidecar spawned ONCE before loop, NOT per-shard
#   - Local laptop path (RL_TARGET=local + no /workspace) unchanged: still
#     calls `npm run test:integration -w api`
#
# Strategy (structural + behavioral):
#   - Structural: grep validate-ci.sh for shard-loop markers.
#   - Behavioral: source with RL_VALIDATE_CI_DRY=1 + stubbed npx/docker.
#     Verify per-shard --shard=N/M invocations + NODE_OPTIONS + override env
#     + fast-fail behavior + local-mode bypass + M9 sidecar single-spawn.
#
# These tests MUST fail today — no shard logic exists yet.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-integration-shards.test.sh"
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

# Build a stub bin dir. Stubs:
#   - docker: records argv, simulates `exec ... redis-cli ping` → PONG so the
#     M9 sidecar wait-loop exits immediately.
#   - npm: no-op (local-mode path).
#   - npx: records argv to $STUB_NPX_ARGV_FILE. If $STUB_NPX_FAIL_SHARD is set
#     (e.g. "2"), the matching --shard=N/... invocation exits 1.
make_stub_bin() {
    local stub_dir
    stub_dir=$(mktemp -d -t rl-shard-stub.XXXXXX)
    cat >"$stub_dir/docker" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${STUB_DOCKER_ARGV_FILE:-}" ]]; then
    echo "$*" >>"$STUB_DOCKER_ARGV_FILE"
fi
if [[ "$1" == "exec" && "$*" == *"redis-cli ping"* ]]; then
    echo "PONG"
    exit 0
fi
exit 0
EOF
    cat >"$stub_dir/npm" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${STUB_NPM_ARGV_FILE:-}" ]]; then
    echo "$*" >>"$STUB_NPM_ARGV_FILE"
fi
exit 0
EOF
    cat >"$stub_dir/npx" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${STUB_NPX_ARGV_FILE:-}" ]]; then
    echo "NODE_OPTIONS=${NODE_OPTIONS:-} $*" >>"$STUB_NPX_ARGV_FILE"
fi
# Fast-fail simulation: if STUB_NPX_FAIL_SHARD matches the --shard prefix.
if [[ -n "${STUB_NPX_FAIL_SHARD:-}" ]]; then
    for arg in "$@"; do
        if [[ "$arg" == "--shard=${STUB_NPX_FAIL_SHARD}/"* ]]; then
            exit 1
        fi
    done
fi
exit 0
EOF
    chmod +x "$stub_dir/docker" "$stub_dir/npm" "$stub_dir/npx"
    echo "$stub_dir"
}

dry_run_guard_present() {
    grep -E -q 'RL_VALIDATE_CI_DRY' "$VALIDATE_CI_PATH"
}

# ===== Structural assertions =====

# AC-M10-1: inside-runner branch invokes jest with --shard=$i/$N.
CURRENT_TEST_NAME="AC-M10-1: shard loop invokes jest --shard=\$i/\$N"
assert_grep '\-\-shard=' "$VALIDATE_CI_PATH" "validate-ci.sh must invoke jest with --shard=N/M per shard"
assert_grep 'npx jest' "$VALIDATE_CI_PATH" "shard loop must call npx jest directly (separate Node process per shard)"
assert_grep 'jest.integration.config.js' "$VALIDATE_CI_PATH" "shard loop must pass --config api/jest.integration.config.js"

# AC-M10-2: NODE_OPTIONS=--max-old-space-size=3072 per shard.
CURRENT_TEST_NAME="AC-M10-2: NODE_OPTIONS=--max-old-space-size=3072 per shard"
assert_grep 'max-old-space-size=3072' "$VALIDATE_CI_PATH" "each shard must run with NODE_OPTIONS=--max-old-space-size=3072"

# AC-M10-6: INTEGRATION_SHARDS env var with default 4.
CURRENT_TEST_NAME="AC-M10-6: INTEGRATION_SHARDS env var overrides default 4"
assert_grep 'INTEGRATION_SHARDS' "$VALIDATE_CI_PATH" "shard count must be controlled by INTEGRATION_SHARDS env var"
assert_grep 'INTEGRATION_SHARDS:-4' "$VALIDATE_CI_PATH" "INTEGRATION_SHARDS must default to 4"

# AC-M10-3 + AC-M10-4: fast-fail on first shard failure (break + return 1).
CURRENT_TEST_NAME="AC-M10-3/4: shard loop must fast-fail on first failure"
# Verify a `break` exists inside run_integration_tests' shard loop, and a
# return 1 condition tied to a FAIL marker.
assert_grep 'break' "$VALIDATE_CI_PATH" "shard loop must break on first failure for fast-fail"

# AC-M10-5: local laptop path unchanged (still calls npm run test:integration -w api).
CURRENT_TEST_NAME="AC-M10-5: local laptop path keeps npm run test:integration -w api"
assert_grep 'npm run test:integration -w api' "$VALIDATE_CI_PATH" "local laptop path must keep npm run test:integration -w api"

# ===== Behavioral assertions (skipped if dry-run guard absent) =====

if ! dry_run_guard_present; then
    echo "[SKIP behavioral block — RL_VALIDATE_CI_DRY guard missing]"
else
    stub_bin=$(make_stub_bin)
    docker_argv_file=$(mktemp -t rl-shard-docker-argv.XXXXXX)
    npx_argv_file=$(mktemp -t rl-shard-npx-argv.XXXXXX)
    npm_argv_file=$(mktemp -t rl-shard-npm-argv.XXXXXX)

    # ----- AC-M10-1 behavioral: 4 jest --shard invocations on remote -----
    CURRENT_TEST_NAME="AC-M10-1 behavioral: 4 shards in remote mode"
    : >"$docker_argv_file"; : >"$npx_argv_file"; : >"$npm_argv_file"
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        RL_SLOT="1" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" \
        STUB_NPM_ARGV_FILE="$npm_argv_file" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; type run_integration_tests >/dev/null 2>&1 && run_integration_tests" 2>&1
    )
    shard_count=$(grep -c -E -- '--shard=[0-9]+/4' "$npx_argv_file" || true)
    if [ "$shard_count" -eq 4 ]; then
        pass
    else
        fail "expected 4 shard invocations (--shard=N/4), got $shard_count (npx argv: $(tr '\n' '|' <"$npx_argv_file"))"
    fi
    # Each of 1..4 must appear exactly once.
    for i in 1 2 3 4; do
        if grep -E -q -- "--shard=${i}/4( |$)" "$npx_argv_file"; then
            pass
        else
            fail "missing shard ${i}/4 invocation (npx argv: $(tr '\n' '|' <"$npx_argv_file"))"
        fi
    done

    # ----- AC-M10-2 behavioral: NODE_OPTIONS on each shard -----
    CURRENT_TEST_NAME="AC-M10-2 behavioral: NODE_OPTIONS=--max-old-space-size=3072 on each shard"
    node_opts_count=$(grep -c -E 'NODE_OPTIONS=.*--max-old-space-size=3072.*jest.*--shard=' "$npx_argv_file" || true)
    if [ "$node_opts_count" -eq 4 ]; then
        pass
    else
        fail "expected NODE_OPTIONS=--max-old-space-size=3072 on all 4 shards, got $node_opts_count (npx argv: $(tr '\n' '|' <"$npx_argv_file"))"
    fi

    # ----- AC-M10-7 behavioral: M9 sidecar spawned ONCE, torn down ONCE -----
    CURRENT_TEST_NAME="AC-M10-7 behavioral: M9 sidecar spawn-once + teardown-once"
    spawn_count=$(grep -c -E 'run -d .*--name rl-test-redis-1' "$docker_argv_file" || true)
    if [ "$spawn_count" -eq 1 ]; then
        pass
    else
        fail "M9 sidecar must spawn ONCE before shard loop, got $spawn_count spawns (docker argv: $(tr '\n' '|' <"$docker_argv_file"))"
    fi

    # ----- AC-M10-6 behavioral: INTEGRATION_SHARDS override -----
    CURRENT_TEST_NAME="AC-M10-6 behavioral: INTEGRATION_SHARDS=2 yields 2 shards"
    : >"$docker_argv_file"; : >"$npx_argv_file"; : >"$npm_argv_file"
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        RL_SLOT="1" \
        INTEGRATION_SHARDS="2" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" \
        STUB_NPM_ARGV_FILE="$npm_argv_file" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; type run_integration_tests >/dev/null 2>&1 && run_integration_tests" 2>&1
    )
    override_count=$(grep -c -E -- '--shard=[0-9]+/2' "$npx_argv_file" || true)
    if [ "$override_count" -eq 2 ]; then
        pass
    else
        fail "INTEGRATION_SHARDS=2 must produce 2 shards, got $override_count (npx argv: $(tr '\n' '|' <"$npx_argv_file"))"
    fi

    # ----- AC-M10-3 behavioral: fast-fail on shard 2 → only 2 invocations -----
    CURRENT_TEST_NAME="AC-M10-3 behavioral: shard 2 failure stops loop early"
    : >"$docker_argv_file"; : >"$npx_argv_file"; : >"$npm_argv_file"
    rc=0
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        RL_SLOT="1" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" \
        STUB_NPM_ARGV_FILE="$npm_argv_file" \
        STUB_NPX_FAIL_SHARD="2" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; type run_integration_tests >/dev/null 2>&1 && run_integration_tests" 2>&1
    ) || rc=$?
    failed_shard_count=$(grep -c -E -- '--shard=[0-9]+/4' "$npx_argv_file" || true)
    if [ "$failed_shard_count" -eq 2 ]; then
        pass
    else
        fail "expected exactly 2 shard invocations after shard 2 fails (1=PASS, 2=FAIL, then break), got $failed_shard_count (npx argv: $(tr '\n' '|' <"$npx_argv_file"))"
    fi
    if [ "$rc" -ne 0 ]; then
        pass
    else
        fail "expected non-zero return from run_integration_tests after shard failure, got rc=$rc"
    fi

    # ----- AC-M10-4 behavioral: all-pass produces 4 invocations and rc=0 -----
    CURRENT_TEST_NAME="AC-M10-4 behavioral: all shards PASS yields 4 invocations + rc=0"
    : >"$docker_argv_file"; : >"$npx_argv_file"; : >"$npm_argv_file"
    rc=0
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="remote" \
        RL_SLOT="1" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" \
        STUB_NPM_ARGV_FILE="$npm_argv_file" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; type run_integration_tests >/dev/null 2>&1 && run_integration_tests" 2>&1
    ) || rc=$?
    pass_shard_count=$(grep -c -E -- '--shard=[0-9]+/4' "$npx_argv_file" || true)
    if [ "$pass_shard_count" -eq 4 ] && [ "$rc" -eq 0 ]; then
        pass
    else
        fail "expected 4 shard invocations + rc=0 on all-pass, got shards=$pass_shard_count rc=$rc"
    fi

    # ----- AC-M10-5 behavioral: local mode skips sharding -----
    CURRENT_TEST_NAME="AC-M10-5 behavioral: local mode uses npm run test:integration (no jest --shard)"
    : >"$docker_argv_file"; : >"$npx_argv_file"; : >"$npm_argv_file"
    out=$(
        PATH="$stub_bin:$PATH" \
        REPO_ROOT="$REPO_ROOT" \
        RL_TARGET="local" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" \
        STUB_NPM_ARGV_FILE="$npm_argv_file" \
        bash -c "RL_VALIDATE_CI_DRY=1 source '$VALIDATE_CI_PATH'; type run_integration_tests >/dev/null 2>&1 && run_integration_tests" 2>&1
    )
    local_shard_count=$(grep -c -E -- '--shard=' "$npx_argv_file" || true)
    if [ "$local_shard_count" -eq 0 ]; then
        pass
    else
        fail "local mode must NOT invoke jest --shard, got $local_shard_count shard calls (npx argv: $(tr '\n' '|' <"$npx_argv_file"))"
    fi
    if grep -E -q 'test:integration -w api' "$npm_argv_file"; then
        pass
    else
        fail "local mode must call npm run test:integration -w api (npm argv: $(tr '\n' '|' <"$npm_argv_file"))"
    fi

    rm -rf "$stub_bin" "$docker_argv_file" "$npx_argv_file" "$npm_argv_file"
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
