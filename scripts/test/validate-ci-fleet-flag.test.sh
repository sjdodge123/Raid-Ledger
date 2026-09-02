#!/usr/bin/env bash
# ROK-1466 — validate-ci.sh `--fleet` gate + explicit-BASE_URL e2e targeting.
#
# Why the flag exists:
#   Running the whole gate on an rl-infra runner previously took THREE separate
#   rl_validate_ci dispatches (--static, then --only-unit --no-coverage, then
#   --only-integration) because --full dies in the coverage unit step on a
#   4 GiB slot. Playwright was a fourth, and it targeted localhost:5173 — where
#   nothing listens inside a runner container. `--fleet` is the single call:
#   the static steps, the unit step without coverage, the sharded integration
#   suite, and e2e pointed at the fleet env's internal URL.
#
# Contract asserted here:
#   AC1 --fleet without an explicit target (BASE_URL / PLAYWRIGHT_BASE_URL)
#       exits 2 on stderr — an invocation error. A runner has no localhost app,
#       so silently defaulting to :5173 would produce a 120s webServer hang and
#       a misleading failure.
#   AC2 --fleet runs build + typecheck + lint + shell-parse + unit (WITHOUT
#       coverage) + tools + integration shards, and stamps a summary row for
#       EVERY step — a narrowed gate that hides rows is a gate missing a check.
#   AC3 --fleet --with-e2e probes and targets ONLY the explicit BASE_URL:
#       no curl to localhost:3000/health or localhost:5173, and Playwright is
#       invoked with BASE_URL / PLAYWRIGHT_BASE_URL / API_URL all pointing at
#       the env (API_URL derived as <BASE_URL>/api when the caller omits it).
#   AC4 An explicit BASE_URL wins in LOCAL mode too — the honouring is a
#       property of the flag, not of RL_TARGET=remote.
#   AC5 --fleet + --static and --fleet + --only-* exit 2 (contradictions).
#   AC6 The env-down messages name the URL actually probed, never a hardcoded
#       ":3000/health", so a fleet operator can see WHICH host failed.
#
# Dry-run harness: npm/npx/docker/curl are stubbed (argv recorded to temp
# files) and git passes through to the real binary except `fetch`. No real
# suite, container, or HTTP request runs.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-fleet-flag.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REPO_ROOT/scripts/validate-ci.sh"
REAL_GIT="$(command -v git)"

# The slot https URL is the ONLY correct fleet target — see AC8.
ENV_URL="https://slot-3.gamernight.net"

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
        fail "$label: expected $expected match(es) for '$pattern', got $actual"
    fi
}

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

assert_err_matches() {
    local pattern="$1" label="$2"
    if printf '%s' "$INVOKE_ERR" | grep -E -q -e "$pattern"; then pass; else
        fail "$label: expected '$pattern' on STDERR, got: $(printf '%s' "$INVOKE_ERR" | tr '\n' '|')"
    fi
}

assert_rc() {
    local expected="$1" label="$2"
    if [ "$INVOKE_RC" -eq "$expected" ]; then pass; else
        fail "$label: expected exit $expected, got $INVOKE_RC (output tail: $(printf '%s' "$INVOKE_OUT" | tail -5 | tr '\n' '|'))"
    fi
}

# Stub bin: npm/npx/docker/curl record argv; git passes through except `fetch`.
# The npx stub records the four target env vars alongside argv so a test can
# assert WHAT Playwright was pointed at, not merely that it ran.
make_stub_bin() {
    local stub_dir
    stub_dir=$(mktemp -d -t rl-fleet-flag-stub.XXXXXX)
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
[[ -n "${STUB_NPX_ARGV_FILE:-}" ]] && \
  echo "NODE_OPTIONS=${NODE_OPTIONS:-} BASE_URL=${BASE_URL:-} PLAYWRIGHT_BASE_URL=${PLAYWRIGHT_BASE_URL:-} API_URL=${API_URL:-} PLAYWRIGHT_AUTH_DIR=${PLAYWRIGHT_AUTH_DIR:-} $*" \
  >>"$STUB_NPX_ARGV_FILE"
exit 0
EOF
    cat >"$stub_dir/curl" <<'EOF'
#!/usr/bin/env bash
[[ -n "${STUB_CURL_ARGV_FILE:-}" ]] && echo "$*" >>"$STUB_CURL_ARGV_FILE"
# STUB_CURL_DOWN simulates an unreachable target (curl exit 7).
[[ "${STUB_CURL_DOWN:-0}" == "1" ]] && exit 7
# Health probes must look healthy so the e2e gate proceeds; everything else
# (the SPA root probe) just needs a zero exit.
if [[ "$*" == *"/health"* ]]; then echo '{"status":"ok"}'; fi
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
    chmod +x "$stub_dir/docker" "$stub_dir/npm" "$stub_dir/npx" "$stub_dir/curl" "$stub_dir/git"
    echo "$stub_dir"
}

stub_bin=$(make_stub_bin)
docker_argv_file=$(mktemp -t rl-fleet-docker.XXXXXX)
npx_argv_file=$(mktemp -t rl-fleet-npx.XXXXXX)
npm_argv_file=$(mktemp -t rl-fleet-npm.XXXXXX)
curl_argv_file=$(mktemp -t rl-fleet-curl.XXXXXX)
perf_log=$(mktemp -t rl-fleet-perf.XXXXXX)
err_file=$(mktemp -t rl-fleet-stderr.XXXXXX)
cleanup() {
    rm -rf "$stub_bin" "$docker_argv_file" "$npx_argv_file" "$npm_argv_file" \
        "$curl_argv_file" "$perf_log" "${perf_log}.errors" "$err_file"
}
trap cleanup EXIT

INVOKE_OUT=""
INVOKE_ERR=""
INVOKE_RC=0
# Fake "this tree is inside a runner container" without needing /workspace.
INVOKE_WORKSPACE_ROOT="/nonexistent-workspace"
# Pre-set PLAYWRIGHT_AUTH_DIR to assert the export never clobbers a caller's.
INVOKE_AUTH_DIR=""
# Simulates the NODE_OPTIONS the runner environment injects (this is what
# defeated the first attempt at the recipe).
INVOKE_NODE_OPTIONS=""
# The explicit, unambiguous operator override.
INVOKE_UNIT_HEAP=""

# invoke <rl_target> <base_url> -- <validate-ci flags...>
# An empty <base_url> leaves BASE_URL unset entirely (the AC1 case).
invoke() {
    local target="$1" base_url="$2"; shift 2
    : >"$docker_argv_file"; : >"$npx_argv_file"; : >"$npm_argv_file"
    : >"$curl_argv_file"; : >"$err_file"
    INVOKE_RC=0
    if [ -n "$base_url" ]; then
        INVOKE_OUT=$(
            PATH="$stub_bin:$PATH" REAL_GIT="$REAL_GIT" \
            RL_TARGET="$target" RL_TARGET_DISPATCHED=1 \
            BASE_URL="$base_url" \
            PERF_LOG_LOCAL="$perf_log" \
            STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
            STUB_NPX_ARGV_FILE="$npx_argv_file" \
            STUB_NPM_ARGV_FILE="$npm_argv_file" \
            STUB_CURL_ARGV_FILE="$curl_argv_file" \
            RL_DISCORD_LOCK_DIR="/nonexistent-lock-dir" \
            RL_WORKSPACE_ROOT="$INVOKE_WORKSPACE_ROOT" \
            PLAYWRIGHT_AUTH_DIR="$INVOKE_AUTH_DIR" \
            NODE_OPTIONS="$INVOKE_NODE_OPTIONS" \
            RL_UNIT_HEAP_MB="$INVOKE_UNIT_HEAP" \
            bash "$VALIDATE_CI_PATH" "$@" 2>"$err_file"
        ) || INVOKE_RC=$?
    else
        INVOKE_OUT=$(
            PATH="$stub_bin:$PATH" REAL_GIT="$REAL_GIT" \
            RL_TARGET="$target" RL_TARGET_DISPATCHED=1 \
            PERF_LOG_LOCAL="$perf_log" \
            STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
            STUB_NPX_ARGV_FILE="$npx_argv_file" \
            STUB_NPM_ARGV_FILE="$npm_argv_file" \
            STUB_CURL_ARGV_FILE="$curl_argv_file" \
            RL_DISCORD_LOCK_DIR="/nonexistent-lock-dir" \
            bash "$VALIDATE_CI_PATH" "$@" 2>"$err_file"
        ) || INVOKE_RC=$?
    fi
    INVOKE_ERR=$(cat "$err_file")
    INVOKE_OUT="${INVOKE_OUT}
${INVOKE_ERR}"
}

# ===== Structural =====

CURRENT_TEST_NAME="structural: --fleet is documented and parsed"
assert_grep '[-][-]fleet' "$VALIDATE_CI_PATH" "validate-ci.sh must accept --fleet"

# ===== AC1: --fleet demands an explicit target =====

CURRENT_TEST_NAME="AC1: --fleet without BASE_URL exits 2 on stderr"
invoke remote "" --fleet
assert_rc 2 "--fleet with no BASE_URL"
assert_err_matches 'BASE_URL' "the error must name BASE_URL"
assert_absent 'playwright' "$npx_argv_file" "--fleet must not reach Playwright without a target"

# ===== AC2: --fleet runs the whole gate, unit step without coverage =====

CURRENT_TEST_NAME="AC2: --fleet runs the full gate with a no-coverage unit step"
invoke remote "$ENV_URL" --fleet
assert_rc 0 "--fleet"
assert_grep 'run build' "$npm_argv_file" "--fleet must build"
assert_grep 'tsc --noEmit' "$npx_argv_file" "--fleet must typecheck"
assert_grep '(^| )lint( |$)' "$npm_argv_file" "--fleet must lint"
assert_grep '--shard=[0-9]+/4' "$npx_argv_file" "--fleet must run the sharded integration suite"
assert_absent '--coverage' "$npx_argv_file" "--fleet must never run coverage instrumentation"
assert_absent 'test:cov' "$npm_argv_file" "--fleet must not use the api coverage script"

# ROK-1466: tools/test-bot is not an npm workspace and ships no vitest, so its
# pure assertion helpers (the Discord render rules) had NO gate outside the
# env-dependent smoke suite. The tools step runs their tsx self-test.
CURRENT_TEST_NAME="AC2: the tools step gates the Discord render-rule helpers"
assert_grep 'render-rules\.selftest' "$npx_argv_file" "the tools step must run the test-bot render-rule self-test"

# W4 (reviewer): scripts/smoke/*.spec.ts (target / auth-paths / login-retry /
# browser-preflight) are included by the ROOT vitest config, which nothing ever
# invoked — CI's web job and run_unit_tests both `cd web` first. Unrun tests are
# not coverage.
CURRENT_TEST_NAME="AC2: the unit step runs the scripts/smoke helper specs"
assert_grep 'vitest run --config vitest\.config\.ts scripts/smoke' "$npx_argv_file" "the unit step must run the root-config scripts/smoke specs"

# The runner recipe. `--fleet --with-e2e` (task de3ead1d639b) died at
# "Unit tests (no coverage)": ONE in-band jest process walked into the V8 heap
# limit at ~2.9 GB on a 4 GiB runner ("Ineffective mark-compacts near heap
# limit"), and run_step stops on first failure, so the gate never reached e2e.
#
# The FIRST attempt at the fix was vacuous and shipped broken (task
# 35761319dca3 still printed NODE_OPTIONS=--max-old-space-size=3072 and
# OOM-killed two workers). It only set 1536 when NODE_OPTIONS was empty — and
# the runner environment injects a NODE_OPTIONS of its own, so the branch never
# fired there. The old test passed because `invoke` supplied an EMPTY
# NODE_OPTIONS, i.e. it asserted the one condition the runner never meets.
#
# So every case below runs with NODE_OPTIONS pre-set the way the runner sets it,
# and asserts the EFFECTIVE value: the banner the step prints AND the argv the
# step actually invoked.
CURRENT_TEST_NAME="AC9: --fleet pins 1536 even when the environment injects 3072"
INVOKE_NODE_OPTIONS="--max-old-space-size=3072"
invoke remote "$ENV_URL" --fleet --no-e2e
INVOKE_NODE_OPTIONS=""
assert_rc 0 "--fleet under an injected NODE_OPTIONS"
assert_out_matches 'Running unit tests WITHOUT coverage \(NODE_OPTIONS=--max-old-space-size=1536\)' "the banner must report the effective 1536 ceiling"
assert_grep 'NODE_OPTIONS=--max-old-space-size=1536 .*jest.*--maxWorkers=2' "$npx_argv_file" "jest must run 2-up at 1536"
assert_grep 'jest.*--workerIdleMemoryLimit=1024MB' "$npx_argv_file" "jest must recycle a worker before it grows into the cap"
assert_grep 'NODE_OPTIONS=--max-old-space-size=1536 .*vitest run.*--maxWorkers=2' "$npx_argv_file" "vitest must run 2-up at 1536"
assert_absent 'NODE_OPTIONS=--max-old-space-size=3072 .*(jest|vitest run) ' "$npx_argv_file" "the injected 3072 must not survive into the unit step"
assert_absent 'vitest run.*workerIdleMemoryLimit' "$npx_argv_file" "--workerIdleMemoryLimit is jest-only; vitest would reject it"

CURRENT_TEST_NAME="AC9: RL_UNIT_HEAP_MB is the explicit operator override"
INVOKE_NODE_OPTIONS="--max-old-space-size=3072"
INVOKE_UNIT_HEAP="2048"
invoke remote "$ENV_URL" --fleet --no-e2e
INVOKE_NODE_OPTIONS=""; INVOKE_UNIT_HEAP=""
assert_rc 0 "--fleet with RL_UNIT_HEAP_MB"
assert_out_matches 'NODE_OPTIONS=--max-old-space-size=2048' "the operator ceiling must reach the banner"
assert_grep 'NODE_OPTIONS=--max-old-space-size=2048 .*jest' "$npx_argv_file" "the operator ceiling must reach jest"
assert_absent 'max-old-space-size=1536' "$npx_argv_file" "the recipe must not override an explicit operator ceiling"

CURRENT_TEST_NAME="AC9: non-heap NODE_OPTIONS flags survive the re-pin"
INVOKE_NODE_OPTIONS="--enable-source-maps --max-old-space-size=3072"
invoke remote "$ENV_URL" --fleet --no-e2e
INVOKE_NODE_OPTIONS=""
assert_rc 0 "--fleet with a mixed NODE_OPTIONS"
assert_grep 'NODE_OPTIONS=--enable-source-maps --max-old-space-size=1536 .*jest' "$npx_argv_file" "unrelated node flags must be preserved, only the heap re-pinned"

CURRENT_TEST_NAME="AC9: --only-unit --no-coverage is unchanged (no worker cap)"
invoke local "" --only-unit --no-coverage
assert_rc 0 "--only-unit --no-coverage"
assert_absent 'maxWorkers' "$npx_argv_file" "the runner recipe is scoped to --fleet"
assert_absent 'workerIdleMemoryLimit' "$npx_argv_file" "the runner recipe is scoped to --fleet"
invoke remote "$ENV_URL" --fleet

# W2 (reviewer): a fresh runner has no tools/test-bot/node_modules — the
# Discord-smoke step says so and installs them. The render-rule self-test in the
# tools step needed the same guard or it dies at import.
CURRENT_TEST_NAME="W2: the test-bot dep guard is shared, not duplicated"
assert_count '_ensure_test_bot_deps' "$VALIDATE_CI_PATH" 3 "one definition + both call sites"

# Reviewer suggestion: --fleet's whole point is running e2e against the env, but
# e2e_mode stayed "auto" so it SKIPped unless the diff happened to touch web/**.
CURRENT_TEST_NAME="AC2: --fleet runs e2e without needing --with-e2e"
assert_grep 'playwright test' "$npx_argv_file" "--fleet alone must run Playwright"
# This branch touches scripts/smoke/**, so `playwright test` appearing proves
# nothing on its own — assert the flag ANNOUNCED that it forced e2e on.
assert_out_matches 'fleet.*e2e (steps )?enabled' "--fleet must announce that it enabled e2e"
assert_out_absent 'No Playwright-relevant files changed' "--fleet must not diff-gate e2e"

CURRENT_TEST_NAME="AC2: --fleet --no-e2e still opts out"
invoke remote "$ENV_URL" --fleet --no-e2e
assert_rc 0 "--fleet --no-e2e"
assert_absent 'playwright test' "$npx_argv_file" "--no-e2e must win over --fleet"
invoke remote "$ENV_URL" --fleet

CURRENT_TEST_NAME="AC2: the summary lists every step"
assert_out_matches 'Build \(all workspaces\)' "Build row"
assert_out_matches 'TypeScript \(all\)' "TypeScript row"
assert_out_matches 'Lint \(all\)' "Lint row"
assert_out_matches 'Shell parse check' "Shell parse row"
assert_out_matches 'Unit tests \(no coverage\)' "Unit row must advertise no-coverage"
assert_out_matches 'Tools unit tests \(mcp servers\)' "Tools unit row"
assert_out_matches 'Integration tests \(api\)' "Integration row"
assert_out_matches 'Migration validation' "Migration row"
assert_out_matches 'Container startup' "Container row"
assert_out_matches 'Playwright \(desktop \+ mobile\)' "Playwright row"
assert_out_matches 'Discord smoke \(companion bot\)' "Discord row"

# ===== AC3: e2e targets the explicit BASE_URL and nothing else =====

CURRENT_TEST_NAME="AC3: --fleet --with-e2e points Playwright at the env"
invoke remote "$ENV_URL" --fleet --with-e2e
assert_rc 0 "--fleet --with-e2e"
assert_grep "BASE_URL=${ENV_URL} .*playwright test" "$npx_argv_file" "Playwright must run with BASE_URL set to the env"
assert_grep "PLAYWRIGHT_BASE_URL=${ENV_URL} .*playwright test" "$npx_argv_file" "Playwright must run with PLAYWRIGHT_BASE_URL set to the env"
assert_grep "API_URL=${ENV_URL}/api .*playwright test" "$npx_argv_file" "API_URL must be derived as <BASE_URL>/api"

CURRENT_TEST_NAME="AC3: nothing probes localhost when BASE_URL is explicit"
assert_grep "${ENV_URL}/api/health" "$curl_argv_file" "the health probe must hit the env"
assert_absent 'localhost:3000' "$curl_argv_file" "no probe may hit localhost:3000"
assert_absent 'localhost:5173' "$curl_argv_file" "no probe may hit localhost:5173"

# ===== AC4: an explicit BASE_URL is honoured in local mode too =====

CURRENT_TEST_NAME="AC4: explicit BASE_URL wins with RL_TARGET=local"
invoke local "$ENV_URL" --with-e2e --no-coverage
assert_rc 0 "--with-e2e with an explicit BASE_URL in local mode"
assert_grep "API_URL=${ENV_URL}/api .*playwright test" "$npx_argv_file" "API_URL must derive from BASE_URL in local mode too"
assert_absent 'localhost:3000' "$curl_argv_file" "local mode must not fall back to localhost:3000 when BASE_URL is set"

# ===== AC7: the auth dir must escape the Mutagen-reaped tree on a runner =====
# The rl-infra sync is one-way-replica (laptop is the sole source of truth), so
# a runner-created scripts/.auth/admin.json is DELETED on the next ~30s cycle —
# global setup logged a successful write and the first spec still died with
# "Error reading storage state ... ENOENT".

CURRENT_TEST_NAME="AC7: a fleet run inside a runner tree exports an out-of-tree auth dir"
INVOKE_WORKSPACE_ROOT="$REPO_ROOT"
invoke remote "$ENV_URL" --fleet --with-e2e
INVOKE_WORKSPACE_ROOT="/nonexistent-workspace"
assert_rc 0 "--fleet --with-e2e inside a runner tree"
assert_grep 'PLAYWRIGHT_AUTH_DIR=/[^ ]+ .*playwright test' "$npx_argv_file" "Playwright must run with PLAYWRIGHT_AUTH_DIR set"
assert_absent "PLAYWRIGHT_AUTH_DIR=${REPO_ROOT}[^ ]*scripts/\\.auth" "$npx_argv_file" "the auth dir must NOT be inside the synced tree"

# Reviewer suggestion: the dir holds an admin JWT. It must not be world-readable
# and must not outlive the run.
CURRENT_TEST_NAME="AC7: the auth dir is private and cleaned up"
auth_dir=$(printf '%s' "$INVOKE_OUT" | sed -n 's/.*Playwright auth dir: \([^ ]*\) .*/\1/p' | head -1)
if [ -n "$auth_dir" ]; then pass; else fail "the run must announce the auth dir it created"; fi
if [ -n "$auth_dir" ] && [ ! -e "$auth_dir" ]; then pass; else
    fail "the auth dir ($auth_dir) must be removed when the run exits"
fi
assert_grep 'chmod 700' "$VALIDATE_CI_PATH" "the auth dir must be created mode 700 (it holds an admin JWT)"

CURRENT_TEST_NAME="AC7: an explicit PLAYWRIGHT_AUTH_DIR is never clobbered"
INVOKE_WORKSPACE_ROOT="$REPO_ROOT"
INVOKE_AUTH_DIR="/tmp/rl-caller-chosen-auth"
invoke remote "$ENV_URL" --fleet --with-e2e
INVOKE_WORKSPACE_ROOT="/nonexistent-workspace"
INVOKE_AUTH_DIR=""
assert_rc 0 "--fleet --with-e2e with a caller-supplied auth dir"
assert_grep 'PLAYWRIGHT_AUTH_DIR=/tmp/rl-caller-chosen-auth .*playwright test' "$npx_argv_file" "the caller's auth dir must survive"

CURRENT_TEST_NAME="AC7: a laptop run is untouched"
invoke local "" --with-e2e --no-coverage
assert_rc 0 "laptop --with-e2e"
assert_absent 'PLAYWRIGHT_AUTH_DIR=/' "$npx_argv_file" "a laptop run must keep the in-tree default"

# ===== AC8: a plain-http rl-env-*-allinone target is refused =====
# The allinone nginx sends CSP `upgrade-insecure-requests` + HSTS (correct
# behind Traefik TLS). Over the plain-http internal route the SPA therefore
# re-requests every JS chunk as https://rl-env-.../assets/*.js →
# ERR_CONNECTION_REFUSED → blank page. curl, /api/health and the companion bot
# never noticed (no CSP for them); Playwright times out on an empty DOM.

CURRENT_TEST_NAME="AC8: --fleet refuses http://rl-env-*-allinone with the CSP reason"
invoke remote "http://rl-env-rok-1453-allinone" --fleet
assert_rc 2 "--fleet against the internal http host"
assert_err_matches 'upgrade-insecure-requests|CSP' "the error must explain WHY"
assert_err_matches 'slot-' "the error must name the slot https URL to use instead"

CURRENT_TEST_NAME="AC8: https to the same host is allowed"
invoke remote "https://rl-env-rok-1453-allinone" --fleet --no-e2e
assert_rc 0 "https internal host"

CURRENT_TEST_NAME="AC8: the slot https URL is the happy path"
invoke remote "https://slot-3.gamernight.net" --fleet
assert_rc 0 "slot https URL"
assert_grep 'BASE_URL=https://slot-3\.gamernight\.net .*playwright test' "$npx_argv_file" "Playwright must target the slot URL"

CURRENT_TEST_NAME="AC8: a plain-http NON-env target is still fine (local allinone)"
invoke local "http://localhost:8080" --with-e2e --no-coverage
assert_rc 0 "local allinone on :8080"

# ===== AC5: contradictions exit 2 =====

CURRENT_TEST_NAME="AC5: --fleet + --static exits 2"
invoke remote "$ENV_URL" --fleet --static
assert_rc 2 "--fleet --static"
assert_err_matches 'mutually exclusive' "conflict message on stderr"

CURRENT_TEST_NAME="AC5: --fleet + --only-unit exits 2"
invoke remote "$ENV_URL" --fleet --only-unit
assert_rc 2 "--fleet --only-unit"
assert_err_matches 'mutually exclusive' "conflict message on stderr"

CURRENT_TEST_NAME="AC5: --fleet + --only-e2e exits 2"
invoke remote "$ENV_URL" --fleet --only-e2e
assert_rc 2 "--fleet --only-e2e"

# ===== AC6: env-down messages name the probed URL =====

CURRENT_TEST_NAME="AC6: a failing probe reports the URL it actually probed"
# Point at an unreachable host with the curl stub removed from PATH for the
# health probe: easiest deterministic way is a target the stub reports as down.
: >"$curl_argv_file"
INVOKE_RC=0
INVOKE_OUT=$(
    PATH="$stub_bin:$PATH" REAL_GIT="$REAL_GIT" \
    RL_TARGET=remote RL_TARGET_DISPATCHED=1 \
    BASE_URL="$ENV_URL" \
    STUB_CURL_DOWN=1 \
    PERF_LOG_LOCAL="$perf_log" \
    STUB_CURL_ARGV_FILE="$curl_argv_file" \
    STUB_NPX_ARGV_FILE="$npx_argv_file" \
    STUB_NPM_ARGV_FILE="$npm_argv_file" \
    STUB_DOCKER_ARGV_FILE="$docker_argv_file" \
    RL_DISCORD_LOCK_DIR="/nonexistent-lock-dir" \
    bash "$VALIDATE_CI_PATH" --fleet --with-e2e 2>"$err_file"
) || INVOKE_RC=$?
INVOKE_ERR=$(cat "$err_file")
INVOKE_OUT="${INVOKE_OUT}
${INVOKE_ERR}"
assert_rc 1 "--fleet --with-e2e against a down env must FAIL"
assert_out_matches "${ENV_URL}/api/health" "the failure must name the probed URL"
assert_out_absent ':3000/health' "the failure must not claim it probed :3000"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
