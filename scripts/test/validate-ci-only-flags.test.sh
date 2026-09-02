#!/usr/bin/env bash
# ROK-1467 — validate-ci.sh narrowed gates: --only-integration / --only-unit
# and the --no-coverage modifier.
#
# Why these flags exist:
#   * `rl_validate_ci --full` on a 4 GiB fleet runner dies inside
#     "Unit tests + coverage" (jest --coverage under a 3072 MB heap cap), and
#     run_step stops on first failure — so the integration suite NEVER runs on
#     the fleet. --only-integration runs it directly.
#   * The M9 Redis sidecar and the sharded jest loop live inside
#     run_integration_tests, which the main pipeline reaches only after
#     build/tsc/lint/unit. Sourcing the function by hand (the previous
#     workaround) skips the flag parsing + the summary and, without RL_SLOT
#     wiring, dies with ECONNREFUSED 127.0.0.1:6379. A first-class flag keeps
#     the sidecar/shard/env-export path identical to --full.
#   * --no-coverage drops the coverage instrumentation (the thing that pushes
#     the unit suite past the cgroup ceiling) and pins a 3072 MB heap.
#
# Contract asserted here:
#   AC1 --only-integration runs the sharded suite + spawns the sidecar once,
#       and never invokes build / typecheck / lint / unit / e2e. Every skipped
#       step still gets a summary row, stamped SKIPPED — never PASS.
#   AC2 --only-unit runs only the unit step; --no-coverage drops --coverage and
#       exports NODE_OPTIONS=--max-old-space-size=3072 unless already set.
#       Coverage remains the default without the flag.
#   AC4 two --only-* flags (or --static + --only-*) exit 2 — an invocation
#       error, distinct from the exit 1 a failing check produces.
#
# Dry-run harness: npm/npx/docker are stubbed (argv recorded to temp files) and
# git passes through to the real binary except `fetch`. No real suite runs.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-only-flags.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REPO_ROOT/scripts/validate-ci.sh"
REAL_GIT="$(command -v git)"

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
    if grep -E -q -e "$pattern" "$file"; then pass; else
        fail "$message (pattern not found in $file: $pattern)"
    fi
}

# assert_count <pattern> <file> <expected> <label>
assert_count() {
    local pattern="$1" file="$2" expected="$3" label="$4" actual
    actual=$(grep -c -E -e "$pattern" "$file" || true)
    if [ "$actual" -eq "$expected" ]; then pass; else
        fail "$label: expected $expected match(es) for '$pattern', got $actual ($(tr '\n' '|' <"$file"))"
    fi
}

# assert_absent <pattern> <file> <label>
assert_absent() {
    local pattern="$1" file="$2" label="$3"
    if grep -E -q -e "$pattern" "$file"; then
        fail "$label: '$pattern' must NOT appear ($(tr '\n' '|' <"$file"))"
    else pass; fi
}

assert_out_matches() {
    local pattern="$1" label="$2"
    if printf '%s' "$INVOKE_OUT" | grep -E -q -e "$pattern"; then pass; else
        fail "$label: output did not match '$pattern'"
    fi
}

assert_out_absent() {
    local pattern="$1" label="$2"
    if printf '%s' "$INVOKE_OUT" | grep -E -q -e "$pattern"; then
        fail "$label: output must NOT match '$pattern'"
    else pass; fi
}

assert_rc() {
    local expected="$1" label="$2"
    if [ "$INVOKE_RC" -eq "$expected" ]; then pass; else
        fail "$label: expected exit $expected, got $INVOKE_RC (output tail: $(printf '%s' "$INVOKE_OUT" | tail -3 | tr '\n' '|'))"
    fi
}

# Stub bin: npm/npx/docker record argv; git passes through except `fetch`.
make_stub_bin() {
    local stub_dir
    stub_dir=$(mktemp -d -t rl-only-flags-stub.XXXXXX)
    cat >"$stub_dir/docker" <<'EOF'
#!/usr/bin/env bash
[[ -n "${STUB_DOCKER_ARGV_FILE:-}" ]] && echo "$*" >>"$STUB_DOCKER_ARGV_FILE"
if [[ "$1" == "exec" && "$*" == *"redis-cli ping"* ]]; then echo "PONG"; fi
exit 0
EOF
    cat >"$stub_dir/npm" <<'EOF'
#!/usr/bin/env bash
[[ -n "${STUB_NPM_ARGV_FILE:-}" ]] && echo "$*" >>"$STUB_NPM_ARGV_FILE"
exit 0
EOF
    cat >"$stub_dir/npx" <<'EOF'
#!/usr/bin/env bash
[[ -n "${STUB_NPX_ARGV_FILE:-}" ]] && echo "NODE_OPTIONS=${NODE_OPTIONS:-} $*" >>"$STUB_NPX_ARGV_FILE"
exit 0
EOF
    cat >"$stub_dir/git" <<'EOF'
#!/usr/bin/env bash
# `git fetch` would hit the network from a unit test — no-op it. Everything
# else (rev-parse --show-toplevel, diff --name-only) must be REAL so the
# script resolves the repo root and the change scope exactly as in production.
[[ "${1:-}" == "fetch" ]] && exit 0
exec "${REAL_GIT:-/usr/bin/git}" "$@"
EOF
    chmod +x "$stub_dir/docker" "$stub_dir/npm" "$stub_dir/npx" "$stub_dir/git"
    echo "$stub_dir"
}

stub_bin=$(make_stub_bin)
docker_argv_file=$(mktemp -t rl-only-docker.XXXXXX)
npx_argv_file=$(mktemp -t rl-only-npx.XXXXXX)
npm_argv_file=$(mktemp -t rl-only-npm.XXXXXX)
perf_log=$(mktemp -t rl-only-perf.XXXXXX)
cleanup() { rm -rf "$stub_bin" "$docker_argv_file" "$npx_argv_file" "$npm_argv_file" "$perf_log" "${perf_log}.errors"; }
trap cleanup EXIT

INVOKE_OUT=""
INVOKE_RC=0

# invoke <rl_target> [extra_node_options] -- <validate-ci flags...>
invoke() {
    local target="$1" node_opts="$2"; shift 2
    : >"$docker_argv_file"; : >"$npx_argv_file"; : >"$npm_argv_file"
    INVOKE_RC=0
    INVOKE_OUT=$(
        PATH="$stub_bin:$PATH" \
        REAL_GIT="$REAL_GIT" \
        RL_TARGET="$target" \
        RL_TARGET_DISPATCHED=1 \
        RL_SLOT="1" \
        NODE_OPTIONS="$node_opts" \
        PERF_LOG_LOCAL="$perf_log" \
        STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" \
        STUB_NPM_ARGV_FILE="$npm_argv_file" \
        bash "$VALIDATE_CI_PATH" "$@" 2>&1
    ) || INVOKE_RC=$?
}

# ===== Structural assertions =====

CURRENT_TEST_NAME="AC1/AC2 structural: flags are documented and parsed"
assert_grep '--only-integration' "$VALIDATE_CI_PATH" "validate-ci.sh must accept --only-integration"
assert_grep '--only-unit' "$VALIDATE_CI_PATH" "validate-ci.sh must accept --only-unit"
assert_grep '--no-coverage' "$VALIDATE_CI_PATH" "validate-ci.sh must accept --no-coverage"

# ===== AC1: --only-integration =====

CURRENT_TEST_NAME="AC1: --only-integration runs sharded integration only"
invoke remote "" --only-integration
assert_rc 0 "--only-integration"
assert_count '--shard=[0-9]+/4' "$npx_argv_file" 4 "--only-integration must run the same 4 shards as --full"
assert_count 'run -d .*--name rl-test-redis-1' "$docker_argv_file" 1 "--only-integration must spawn the M9 Redis sidecar exactly once"
assert_absent 'run build' "$npm_argv_file" "--only-integration must not build"
assert_absent '(^| )lint( |$)' "$npm_argv_file" "--only-integration must not lint"
assert_absent 'test:cov' "$npm_argv_file" "--only-integration must not run unit tests"
assert_absent 'tsc --noEmit' "$npx_argv_file" "--only-integration must not typecheck"
assert_absent 'playwright' "$npx_argv_file" "--only-integration must not run Playwright"
assert_absent 'vitest' "$npx_argv_file" "--only-integration must not run web unit tests"

CURRENT_TEST_NAME="AC1: skipped steps are reported SKIPPED, never PASS"
assert_out_matches 'Build \(all workspaces\).*SKIPPED' "Build row"
assert_out_absent 'Build \(all workspaces\).*PASS' "Build row must never read PASS"
assert_out_matches 'TypeScript \(all\).*SKIPPED' "TypeScript row"
assert_out_absent 'TypeScript \(all\).*PASS' "TypeScript row must never read PASS"
assert_out_matches 'Lint \(all\).*SKIPPED' "Lint row"
assert_out_absent 'Lint \(all\).*PASS' "Lint row must never read PASS"
assert_out_matches 'Unit tests.*SKIPPED' "Unit row"
assert_out_matches 'Playwright \(desktop \+ mobile\).*SKIPPED' "Playwright row"
assert_out_matches 'Discord smoke \(companion bot\).*SKIPPED' "Discord row"
assert_out_matches 'Integration tests \(api\).*PASS' "Integration row must PASS"

# ===== AC2: --only-unit --no-coverage =====

CURRENT_TEST_NAME="AC2: --only-unit --no-coverage drops coverage + pins the heap"
invoke local "" --only-unit --no-coverage
assert_rc 0 "--only-unit --no-coverage"
assert_absent '--coverage' "$npx_argv_file" "--no-coverage must never pass --coverage"
assert_absent 'test:cov' "$npm_argv_file" "--no-coverage must not use the coverage npm script"
assert_grep 'NODE_OPTIONS=--max-old-space-size=3072 .*jest' "$npx_argv_file" "--no-coverage must run jest with a 3072 MB heap ceiling"
assert_absent '--shard=' "$npx_argv_file" "--only-unit must not run the integration shards"
assert_absent 'run build' "$npm_argv_file" "--only-unit must not build"
assert_out_matches 'Integration tests \(api\).*SKIPPED' "Integration row must be SKIPPED"
assert_out_absent 'Integration tests \(api\).*PASS' "Integration row must never read PASS"

CURRENT_TEST_NAME="AC2: an explicit NODE_OPTIONS wins over the 3072 default"
invoke local "--max-old-space-size=2048" --only-unit --no-coverage
assert_rc 0 "--only-unit --no-coverage with NODE_OPTIONS preset"
assert_grep 'NODE_OPTIONS=--max-old-space-size=2048 .*jest' "$npx_argv_file" "a preset NODE_OPTIONS must be preserved"
assert_absent 'max-old-space-size=3072' "$npx_argv_file" "the 3072 default must not override a preset NODE_OPTIONS"

CURRENT_TEST_NAME="AC2: coverage stays the default without --no-coverage"
invoke local "" --only-unit
assert_rc 0 "--only-unit"
assert_grep 'test:cov' "$npm_argv_file" "--only-unit alone must keep the api coverage script"
assert_grep 'vitest run --coverage' "$npx_argv_file" "--only-unit alone must keep web coverage"

# ===== AC4: mutually exclusive combos exit 2 =====

CURRENT_TEST_NAME="AC4: --only-integration + --only-unit exits 2"
invoke local "" --only-integration --only-unit
assert_rc 2 "--only-integration --only-unit"
assert_out_matches 'mutually exclusive' "conflict message"

CURRENT_TEST_NAME="AC4: --only-e2e + --only-integration exits 2"
invoke local "" --only-e2e --only-integration
assert_rc 2 "--only-e2e --only-integration"

CURRENT_TEST_NAME="AC4: --static + --only-integration exits 2"
invoke local "" --static --only-integration
assert_rc 2 "--static --only-integration"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
