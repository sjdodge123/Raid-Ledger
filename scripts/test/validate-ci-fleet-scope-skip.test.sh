#!/usr/bin/env bash
# ROK-1793 S1(i) — `--fleet` skips the unchanged workspace's test suites.
#
# Contract asserted here:
#   W  web-only diff: --fleet skips api jest + api integration; web vitest runs.
#      Each skip is its own SKIPPED summary row that names the reason.
#   A  api-only diff: --fleet skips web vitest; api jest + integration run.
#   C  contract (packages/**) diff: --fleet runs everything, no scope rows.
#   S  scripts/** diff (the gate itself) widens a web diff back to everything.
#   E  empty / undetectable diff: --fleet runs everything.
#   F  --full on a web-only diff runs everything (scoping is --fleet only).
#   M1 (review): narrowing needs EVERY path under api/ or web/. Deps-only,
#      root tsconfig, web + README.md and web/src/components/admin/** run
#      everything; an untracked api file counts as changed; a web-only diff
#      still runs the api specs that read web/ (--runTestsByPath).
#
# Harness: npm/npx/docker/curl are stubbed and record argv (npx also records
# its cwd, which is how web vitest is told apart from the root-config smoke
# helper specs). git is real except `fetch` (no-op) and `diff --name-only`,
# which prints $STUB_GIT_DIFF, and `ls-files --others` (untracked), which
# prints $STUB_GIT_UNTRACKED, so each case controls the change set.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-fleet-scope-skip.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
VALIDATE_CI_PATH="$REPO_ROOT/scripts/validate-ci.sh"
REAL_GIT="$(command -v git)"
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

# Here-strings, never `printf | grep -q` (EPIPE under pipefail).
assert_in() {
    local pattern="$1" haystack="$2" label="$3"
    if grep -E -q -e "$pattern" <<<"$haystack"; then pass; else
        fail "$label: expected to match '$pattern'"
    fi
}
assert_not_in() {
    local pattern="$1" haystack="$2" label="$3"
    if grep -E -q -e "$pattern" <<<"$haystack"; then
        fail "$label: must NOT match '$pattern' (got: $(grep -E -e "$pattern" <<<"$haystack" | head -2 | tr '\n' '|'))"
    else pass; fi
}
assert_rc() {
    if [ "$INVOKE_RC" -eq "$1" ]; then pass; else
        fail "$2: expected exit $1, got $INVOKE_RC (tail: $(tail -5 <<<"$INVOKE_OUT" | tr '\n' '|'))"
    fi
}

stub_bin=$(mktemp -d -t rl-fleet-scope-stub.XXXXXX)
npx_argv_file=$(mktemp -t rl-fleet-scope-npx.XXXXXX)
npm_argv_file=$(mktemp -t rl-fleet-scope-npm.XXXXXX)
perf_log=$(mktemp -t rl-fleet-scope-perf.XXXXXX)
trap 'rm -rf "$stub_bin" "$npx_argv_file" "$npm_argv_file" "$perf_log" "${perf_log}.errors"' EXIT

cat >"$stub_bin/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "exec" && "$*" == *"redis-cli ping"* ]]; then echo "PONG"; fi
exit 0
EOF
cat >"$stub_bin/npm" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$STUB_NPM_ARGV_FILE"
exit 0
EOF
cat >"$stub_bin/npx" <<'EOF'
#!/usr/bin/env bash
echo "cwd=$PWD $*" >>"$STUB_NPX_ARGV_FILE"
exit 0
EOF
cat >"$stub_bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"/health"* ]]; then echo '{"status":"ok"}'; fi
exit 0
EOF
cat >"$stub_bin/git" <<'EOF'
#!/usr/bin/env bash
[[ "${1:-}" == "fetch" ]] && exit 0
if [[ "${1:-}" == "diff" && "$*" == *"--name-only"* ]]; then
  [[ -n "${STUB_GIT_DIFF:-}" ]] && printf '%s\n' "$STUB_GIT_DIFF"
  exit 0
fi
if [[ "${1:-}" == "ls-files" && "$*" == *"--others"* ]]; then
  [[ -n "${STUB_GIT_UNTRACKED:-}" ]] && printf '%s\n' "$STUB_GIT_UNTRACKED"
  exit 0
fi
exec "$REAL_GIT" "$@"
EOF
cat >"$stub_bin/node" <<EOF
#!/usr/bin/env bash
[[ "\${1:-}" == *check-bundle-size.mjs ]] && exit 0
exec "$(command -v node)" "\$@"
EOF
chmod +x "$stub_bin"/*

INVOKE_OUT=""
INVOKE_RC=0
NPX=""
# invoke <diff (newline-separated paths)> <validate-ci flags...>
invoke() {
    local diff="$1"; shift
    : >"$npx_argv_file"; : >"$npm_argv_file"
    INVOKE_RC=0
    INVOKE_OUT=$(
        PATH="$stub_bin:$PATH" REAL_GIT="$REAL_GIT" STUB_GIT_DIFF="$diff" \
        STUB_GIT_UNTRACKED="${UNTRACKED:-}" \
        RL_TARGET=remote RL_TARGET_DISPATCHED=1 BASE_URL="$ENV_URL" \
        PERF_LOG_LOCAL="$perf_log" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" STUB_NPM_ARGV_FILE="$npm_argv_file" \
        RL_DISCORD_LOCK_DIR="/nonexistent-lock-dir" \
        RL_DEPS_RUNNER_ROOT="/nonexistent-runner-root" \
        RL_WORKSPACE_ROOT="/nonexistent-workspace" \
        bash "$VALIDATE_CI_PATH" "$@" 2>&1
    ) || INVOKE_RC=$?
    # Strip ANSI colour so row assertions can anchor on ^ and $.
    INVOKE_OUT=$(sed $'s/\x1b\\[[0-9;]*m//g' <<<"$INVOKE_OUT")
    NPX=$(cat "$npx_argv_file")
}

# What each suite looks like in the npx argv log.
API_JEST='cwd=.*/api jest --passWithNoTests'
API_INTEGRATION='jest .*--shard=1/4'
WEB_VITEST='cwd=.*/web vitest run'
# The summary row the skip must print (2-space gap, status, em-dash reason).
skip_row() { echo "^$1 +SKIPPED — $2-only diff \(--fleet scope"; }
# A web-only diff narrows api jest to the cross-workspace specs, by path.
API_XWS_JEST='cwd=.*/api jest --runTestsByPath .*src/discord-bot/discord-bot-permissions-literal\.guard\.spec\.ts'


# ===== W: web-only diff =====
CURRENT_TEST_NAME="W: --fleet on a web-only diff skips api unit + integration"
invoke "web/src/pages/foo.tsx" --fleet --no-e2e
assert_rc 0 "web-only --fleet"
assert_not_in "$API_JEST" "$NPX" "api jest must not run on a web-only --fleet diff"
assert_not_in "$API_INTEGRATION" "$NPX" "api integration shards must not run on a web-only --fleet diff"
assert_in "$WEB_VITEST" "$NPX" "web vitest must still run"
assert_in "$(skip_row 'Unit tests \(api jest\)' web)" "$INVOKE_OUT" "summary row: api jest SKIPPED with reason"
assert_in "$(skip_row 'Integration tests \(api\)' web)" "$INVOKE_OUT" "summary row: integration SKIPPED with reason"
assert_in '^Unit tests \(api jest\): SKIPPED$' "$INVOKE_OUT" "run_step row stays parser-exact (no reason suffix)"
assert_not_in 'Unit tests \(web vitest\)' "$INVOKE_OUT" "web vitest must not get a skip row on a web diff"
assert_in "$API_XWS_JEST" "$NPX" "M1: a web-only diff still runs the api specs that read web/"
assert_in 'src/auth/fleet-first-login-admin\.prod-guard\.spec\.ts' "$(grep -e '--runTestsByPath' <<<"$NPX")" \
    "M1: the every-tracked-file guard runs on a web-only diff"
assert_not_in 'GitHub CI runs it' "$INVOKE_OUT" "m1: the skip reason must not claim GitHub CI covers it"

# ===== A: api-only diff =====
CURRENT_TEST_NAME="A: --fleet on an api-only diff skips web vitest"
invoke "api/src/events/foo.service.ts" --fleet --no-e2e
assert_rc 0 "api-only --fleet"
assert_not_in "$WEB_VITEST" "$NPX" "web vitest must not run on an api-only --fleet diff"
assert_in "$API_JEST" "$NPX" "api jest must still run"
assert_in "$API_INTEGRATION" "$NPX" "api integration must still run"
assert_in "$(skip_row 'Unit tests \(web vitest\)' api)" "$INVOKE_OUT" "summary row: web vitest SKIPPED with reason"
assert_not_in 'Integration tests \(api\) +SKIPPED' "$INVOKE_OUT" "integration must not be SKIPPED on an api diff"

# ===== C / S / E / F: everything runs =====
assert_runs_all() {
    assert_rc 0 "$1"
    assert_in "$API_JEST" "$NPX" "$1: api jest must run"
    assert_in "$API_INTEGRATION" "$NPX" "$1: api integration must run"
    assert_in "$WEB_VITEST" "$NPX" "$1: web vitest must run"
    assert_not_in 'SKIPPED — ' "$INVOKE_OUT" "$1: no scope-skip rows"
}

CURRENT_TEST_NAME="C: --fleet on a contract diff runs every suite"
invoke "packages/contract/src/events.schema.ts"$'\n'"web/src/pages/foo.tsx" --fleet --no-e2e
assert_runs_all "contract diff"

CURRENT_TEST_NAME="S: a scripts/** change widens a web diff to every suite"
invoke "web/src/pages/foo.tsx"$'\n'"scripts/validate-ci.sh" --fleet --no-e2e
assert_runs_all "web + scripts diff"

CURRENT_TEST_NAME="M1-D: a deps-only change (package-lock + web) runs every suite"
invoke "package-lock.json"$'\n'"web/src/pages/foo.tsx" --fleet --no-e2e
assert_runs_all "deps + web diff"

CURRENT_TEST_NAME="M1-T: a root tsconfig change runs every suite"
invoke "tsconfig.base.json" --fleet --no-e2e
assert_runs_all "root tsconfig diff"

CURRENT_TEST_NAME="M1-R: web + README.md runs every suite (api guards read README)"
invoke "web/src/pages/foo.tsx"$'\n'"README.md" --fleet --no-e2e
assert_runs_all "web + README diff"

CURRENT_TEST_NAME="M1-AD: a web/src/components/admin diff runs api jest"
invoke "web/src/components/admin/bot-panel.tsx" --fleet --no-e2e
assert_runs_all "web admin diff"

CURRENT_TEST_NAME="M1-U: an untracked api file counts as changed"
UNTRACKED="api/src/events/new.spec.ts" invoke "web/src/pages/foo.tsx" --fleet --no-e2e
assert_runs_all "committed web + untracked api"

CURRENT_TEST_NAME="E: --fleet on an empty diff runs every suite"
invoke "" --fleet --no-e2e
assert_runs_all "empty diff"

CURRENT_TEST_NAME="F: --full on a web-only diff runs every suite"
invoke "web/src/pages/foo.tsx" --full --no-e2e
assert_rc 0 "--full web-only"
# --full's unit step is the coverage path (npm test:cov / jest --coverage).
assert_in 'test:cov -w api|jest --coverage' "$NPX"$'\n'"$(cat "$npm_argv_file")" "--full: api unit must run"
assert_in "$API_INTEGRATION" "$NPX" "--full: api integration must run"
assert_in 'cwd=.*/web vitest run' "$NPX" "--full: web vitest must run"
assert_not_in 'SKIPPED — ' "$INVOKE_OUT" "--full: no scope-skip rows"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
