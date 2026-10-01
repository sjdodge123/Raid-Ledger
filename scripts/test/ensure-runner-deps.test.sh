#!/usr/bin/env bash
# scripts/ci/ensure-runner-deps.sh: the shared root `npm ci` decision used by
# validate-ci.sh and `rl` install_runner_deps.
#
# Why it exists: a fleet runner's node_modules survives between claims, and
# the old guard re-installed only when node_modules/.bin/tsc was missing. A
# branch that changed package-lock.json therefore built against stale deps
# (Rolldown could not resolve @m-lab/ndt7; TS2307 rollup-plugin-visualizer).
#
# Contract asserted here:
#   runner mode (ROOT == RL_WORKSPACE_ROOT): install when tsc is missing, the
#     marker is absent, or the marker differs from sha256(package-lock.json);
#     write the marker only after npm really refreshed
#     node_modules/.package-lock.json; a failed npm ci exits 1 with its log
#     tail and leaves the marker alone.
#   laptop mode: install only when tsc is missing; never write a marker.
#
# Harness: a stub `npm` first on PATH records argv and behaves per
# STUB_NPM_MODE (ok | fail | noop). No real install runs, no sleep().

set -uo pipefail

CURRENT_TEST_FILE="ensure-runner-deps.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
HELPER="$REPO_ROOT/scripts/ci/ensure-runner-deps.sh"

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

assert_eq() {
    local expected="$1" actual="$2" label="$3"
    if [ "$expected" = "$actual" ]; then pass; else
        fail "$label: expected '$expected', got '$actual'"
    fi
}

assert_out_matches() {
    local pattern="$1" label="$2"
    if printf '%s' "$OUT" | grep -E -q -e "$pattern"; then pass; else
        fail "$label: output did not match '$pattern' (output: $(printf '%s' "$OUT" | tr '\n' '|'))"
    fi
}

assert_absent_file() {
    local path="$1" label="$2"
    if [ -e "$path" ]; then fail "$label: $path must not exist (content: $(cat "$path" 2>/dev/null))"; else pass; fi
}

sha_of() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    else shasum -a 256 "$1" | awk '{print $1}'; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"
cat >"$STUB_BIN/npm" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$NPM_CALLS"
case "${STUB_NPM_MODE:-ok}" in
  ok)
    # Like real `npm ci`: wipe node_modules, then lay down a fresh tree. A
    # real install takes many seconds; a fixed future mtime on the hidden
    # lockfile keeps the helper's `find -newer` check deterministic.
    rm -rf node_modules
    mkdir -p node_modules/.bin
    printf '#!/bin/sh\n' >node_modules/.bin/tsc
    chmod +x node_modules/.bin/tsc
    : >node_modules/.package-lock.json
    touch -t 203001010000 node_modules/.package-lock.json
    echo "stub-npm-ok" ;;
  fail) echo "stub-npm-boom"; exit 1 ;;
  noop) exit 0 ;;
esac
STUB
chmod +x "$STUB_BIN/npm"

# new_case <name>: fresh ROOT holding only a package-lock.json.
new_case() {
    CURRENT_TEST_NAME="$1"
    CASE_DIR="$(mktemp -d "$WORK/case.XXXXXX")"
    ROOT="$CASE_DIR/repo"
    MARKER="$ROOT/node_modules/.rl-lockfile-sha256"
    mkdir -p "$ROOT"
    printf '{"name":"fixture","lockfileVersion":3,"rev":1}\n' >"$ROOT/package-lock.json"
    : >"$CASE_DIR/npm.calls"
}

# seed_install [marker]: node_modules as an earlier install left it. The
# hidden lockfile is backdated so it is older than any stamp the helper takes.
seed_install() {
    mkdir -p "$ROOT/node_modules/.bin"
    printf '#!/bin/sh\n' >"$ROOT/node_modules/.bin/tsc"
    chmod +x "$ROOT/node_modules/.bin/tsc"
    : >"$ROOT/node_modules/.package-lock.json"
    touch -t 200001010000 "$ROOT/node_modules/.package-lock.json"
    if [ $# -gt 0 ]; then printf '%s\n' "$1" >"$MARKER"; fi
}

# run_helper <runner|laptop> <ok|fail|noop>
run_helper() {
    local ws="$ROOT"
    [ "$1" = runner ] || ws="$CASE_DIR/not-root"
    OUT=$(PATH="$STUB_BIN:$PATH" RL_WORKSPACE_ROOT="$ws" RL_NPM_CI_LOCK="$CASE_DIR/lock" \
        STUB_NPM_MODE="$2" NPM_CALLS="$CASE_DIR/npm.calls" bash "$HELPER" "$ROOT" 2>&1)
    RC=$?
}

ci_calls() { grep -c -E '^ci( |$)' "$CASE_DIR/npm.calls" || true; }
marker() { cat "$MARKER" 2>/dev/null || echo "<no marker>"; }

new_case "(a) runner, tsc present, no marker: installs and stamps the lockfile sha"
seed_install
run_helper runner ok
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_eq "$(sha_of "$ROOT/package-lock.json")" "$(marker)" "marker after install"
assert_out_matches 'no marker' "reason printed"
if command -v flock >/dev/null 2>&1; then
    if [ -e "$CASE_DIR/lock" ]; then pass; else fail "runner mode must open the lock at RL_NPM_CI_LOCK"; fi
fi

new_case "(b) runner, marker matches the lockfile: no install"
seed_install "$(sha_of "$ROOT/package-lock.json")"
run_helper runner ok
assert_eq 0 "$RC" "exit code"
assert_eq 0 "$(ci_calls)" "npm ci calls"
assert_eq "$(sha_of "$ROOT/package-lock.json")" "$(marker)" "marker untouched"

new_case "(c) runner, lockfile changed after the marker: re-installs and updates the marker"
seed_install "$(sha_of "$ROOT/package-lock.json")"
old_sha="$(marker)"
printf '{"name":"fixture","lockfileVersion":3,"rev":2}\n' >"$ROOT/package-lock.json"
run_helper runner ok
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_eq "$(sha_of "$ROOT/package-lock.json")" "$(marker)" "marker after re-install"
if [ "$old_sha" != "$(marker)" ]; then pass; else fail "marker still holds the old lockfile sha $old_sha"; fi
assert_out_matches 'package-lock\.json changed \(marker [0-9a-f]+, lockfile [0-9a-f]+\)' "reason printed"

new_case "(d) runner, npm ci fails: exit 1, log tail shown, marker unchanged"
seed_install "0000stale"
run_helper runner fail
assert_eq 1 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_out_matches 'stub-npm-boom' "npm log tail printed"
assert_eq "0000stale" "$(marker)" "marker after a failed install"

new_case "(e) runner, npm exits 0 without refreshing node_modules: marker NOT rewritten"
seed_install "0000stale"
run_helper runner noop
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_eq "0000stale" "$(marker)" "marker after a no-op install"
assert_out_matches 'did not refresh node_modules/\.package-lock\.json; marker not written' "warning printed"

new_case "(f) laptop, tsc present: no install, no marker, no lock"
seed_install
run_helper laptop ok
assert_eq 0 "$RC" "exit code"
assert_eq 0 "$(ci_calls)" "npm ci calls"
assert_absent_file "$MARKER" "laptop marker"
assert_absent_file "$CASE_DIR/lock" "laptop lock"

new_case "(g) laptop, tsc missing: installs, writes no marker"
run_helper laptop ok
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_out_matches 'missing tsc' "reason printed"
assert_absent_file "$MARKER" "laptop marker"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
