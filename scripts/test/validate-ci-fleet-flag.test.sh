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

ENV_URL="http://rl-env-rok-1453-allinone"

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
  echo "NODE_OPTIONS=${NODE_OPTIONS:-} BASE_URL=${BASE_URL:-} PLAYWRIGHT_BASE_URL=${PLAYWRIGHT_BASE_URL:-} API_URL=${API_URL:-} $*" \
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
