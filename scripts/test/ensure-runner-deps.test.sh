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
#   runner mode (ROOT == RL_DEPS_RUNNER_ROOT): install when tsc is missing,
#     the marker is absent, or the marker differs from sha256(package-lock.json);
#     write the marker only after npm really refreshed
#     node_modules/.package-lock.json, with the sha hashed BEFORE npm ran; a
#     failed npm ci exits 1 with its log tail and leaves the marker alone.
#   laptop mode: install only when tsc is missing; never write a marker.
#     RL_WORKSPACE_ROOT (validate-ci.sh's auth-dir seam) never switches mode.
#   callers: validate-ci.sh's _ensure_test_bot_deps and rl's
#     install_runner_deps really pass tools/test-bot as SUBDIR (each run
#     from its own source against a fixture checkout), and their fallbacks
#     still work.
#
# Harness: a stub `npm` first on PATH records argv and behaves per
# STUB_NPM_MODE (ok | fail | noop | rewrite | ci-fail). No real install runs,
# no sleep().

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
    if grep -E -q -e "$pattern" <<<"$OUT"; then pass; else
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
# The install dir goes to its OWN file: ci_calls counts npm.calls lines.
[ -n "${NPM_CWD:-}" ] && pwd >>"$NPM_CWD"
case "${STUB_NPM_MODE:-ok}" in
  ok|rewrite)
    # Like real `npm ci`: wipe node_modules, then lay down a fresh tree. A
    # real install takes many seconds; a fixed future mtime on the hidden
    # lockfile keeps the helper's `find -newer` check deterministic.
    rm -rf node_modules
    mkdir -p node_modules/.bin
    printf '#!/bin/sh\n' >node_modules/.bin/tsc
    chmod +x node_modules/.bin/tsc
    : >node_modules/.package-lock.json
    touch -t 203001010000 node_modules/.package-lock.json
    echo "stub-npm-ok"
    # rewrite: a new package-lock.json lands (Mutagen sync) mid-install.
    if [ "${STUB_NPM_MODE:-ok}" = rewrite ]; then
      printf '{"name":"fixture","lockfileVersion":3,"rev":99}\n' >package-lock.json
    fi ;;
  fail) echo "stub-npm-boom"; exit 1 ;;
  # ci-fail: `npm ci` fails (lockfile drift), any other command succeeds.
  ci-fail)
    if [ "${1:-}" = ci ]; then echo "stub-npm-ci-boom"; exit 1; fi
    mkdir -p node_modules ;;
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

# run_helper <runner|laptop|auth-seam> <ok|fail|noop|rewrite>
#   auth-seam: a laptop run whose RL_WORKSPACE_ROOT (validate-ci.sh's auth-dir
#   seam) happens to equal ROOT, as validate-ci-fleet-flag.test.sh's AC7 does.
run_helper() {
    local runner_root="$CASE_DIR/not-root" ws="$CASE_DIR/not-root"
    case "$1" in
        runner) runner_root="$ROOT" ;;
        auth-seam) ws="$ROOT" ;;
    esac
    OUT=$(PATH="$STUB_BIN:$PATH" RL_DEPS_RUNNER_ROOT="$runner_root" RL_WORKSPACE_ROOT="$ws" \
        RL_NPM_CI_LOCK="$CASE_DIR/lock" STUB_NPM_MODE="$2" NPM_CALLS="$CASE_DIR/npm.calls" \
        bash "$HELPER" "$ROOT" 2>&1)
    RC=$?
}

ci_calls() { grep -c -E '^ci( |$)' "$CASE_DIR/npm.calls" || true; }
marker() { cat "$MARKER" 2>/dev/null || echo "<no marker>"; }

# Harness self-check: assert_out_matches must keep an early match in a large
# output. A `printf | grep -q` pipe under pipefail lost it to EPIPE.
CURRENT_TEST_NAME="harness: an early match in a 1 MiB output is still a match"
OUT="needle-line"$'\n'"$(head -c 1048576 /dev/zero | tr '\0' x)"
after=$(assert_out_matches '^needle-line$' self-check >/dev/null; echo "$TEST_PASS_COUNT")
if [ "$after" -gt "$TEST_PASS_COUNT" ]; then pass; else
    fail "assert_out_matches on a 1 MiB output: expected pass, got fail"
fi
OUT=""

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

new_case "(h) runner, package-lock.json changes mid-install: marker keeps the pre-install sha"
seed_install "0000stale"
pre_sha="$(sha_of "$ROOT/package-lock.json")"
run_helper runner rewrite
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_eq "$pre_sha" "$(marker)" "marker must hold the sha npm installed from, not the one synced in mid-install"
run_helper runner ok
assert_eq 2 "$(ci_calls)" "npm ci calls after the next run (the new lockfile must be installed)"
assert_eq "$(sha_of "$ROOT/package-lock.json")" "$(marker)" "marker after the follow-up install"

new_case "(i) RL_WORKSPACE_ROOT == ROOT alone stays in laptop mode: no install, no marker, no lock"
seed_install
run_helper auth-seam ok
assert_eq 0 "$RC" "exit code"
assert_eq 0 "$(ci_calls)" "npm ci calls"
assert_absent_file "$MARKER" "auth-seam marker"
assert_absent_file "$CASE_DIR/lock" "auth-seam lock"

# ===== SUBDIR mode (TDB:2088): a standalone package such as tools/test-bot =====

# new_sub_case <name>: new_case plus SUB_DIR=ROOT/tools/test-bot holding its
# own package-lock.json.
new_sub_case() {
    new_case "$1"
    SUB="tools/test-bot"
    SUB_DIR="$ROOT/$SUB"
    SUB_MARKER="$SUB_DIR/node_modules/.rl-lockfile-sha256"
    mkdir -p "$SUB_DIR"
    printf '{"name":"sub-fixture","lockfileVersion":3,"rev":1}\n' >"$SUB_DIR/package-lock.json"
    : >"$CASE_DIR/npm.cwd"
}

# seed_sub_install [marker]: SUB_DIR/node_modules as an earlier install left it.
seed_sub_install() {
    mkdir -p "$SUB_DIR/node_modules"
    : >"$SUB_DIR/node_modules/.package-lock.json"
    touch -t 200001010000 "$SUB_DIR/node_modules/.package-lock.json"
    if [ $# -gt 0 ]; then printf '%s\n' "$1" >"$SUB_MARKER"; fi
}

# run_helper_sub <runner|laptop> <ok|fail|noop|rewrite> [subdir, default $SUB]
run_helper_sub() {
    local runner_root="$CASE_DIR/not-root"
    if [ "$1" = runner ]; then runner_root="$ROOT"; fi
    OUT=$(PATH="$STUB_BIN:$PATH" RL_DEPS_RUNNER_ROOT="$runner_root" RL_WORKSPACE_ROOT="$CASE_DIR/not-root" \
        RL_NPM_CI_LOCK="$CASE_DIR/lock" STUB_NPM_MODE="$2" NPM_CALLS="$CASE_DIR/npm.calls" \
        NPM_CWD="$CASE_DIR/npm.cwd" bash "$HELPER" "$ROOT" "${3:-$SUB}" 2>&1)
    RC=$?
}

sub_marker() { cat "$SUB_MARKER" 2>/dev/null || echo "<no marker>"; }

new_sub_case "(s1) runner, SUBDIR marker matches its lockfile: no install"
seed_install "$(sha_of "$ROOT/package-lock.json")"
seed_sub_install "$(sha_of "$SUB_DIR/package-lock.json")"
run_helper_sub runner ok
assert_eq 0 "$RC" "exit code"
assert_eq 0 "$(ci_calls)" "npm ci calls"

new_sub_case "(s2) runner, SUBDIR lockfile changed: one npm ci IN SUBDIR, its marker re-stamped"
seed_install "$(sha_of "$ROOT/package-lock.json")"
seed_sub_install "$(sha_of "$SUB_DIR/package-lock.json")"
printf '{"name":"sub-fixture","lockfileVersion":3,"rev":2}\n' >"$SUB_DIR/package-lock.json"
run_helper_sub runner ok
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls after a SUBDIR lockfile change"
assert_eq "$SUB_DIR" "$(cat "$CASE_DIR/npm.cwd")" "npm ci must run in ROOT/SUBDIR"
assert_eq "$(sha_of "$SUB_DIR/package-lock.json")" "$(sub_marker)" "SUBDIR marker after re-install"

new_sub_case "(s3) runner, a SUBDIR install and a root install never touch each other's marker"
seed_install "0000root"
seed_sub_install "0000sub"
run_helper_sub runner ok
assert_eq 1 "$(ci_calls)" "npm ci calls for the SUBDIR install"
assert_eq "0000root" "$(marker)" "root marker after a SUBDIR install"
assert_eq "$(sha_of "$SUB_DIR/package-lock.json")" "$(sub_marker)" "SUBDIR marker after its install"
run_helper runner ok
assert_eq 2 "$(ci_calls)" "npm ci calls after the root install"
assert_eq "$(sha_of "$ROOT/package-lock.json")" "$(marker)" "root marker after its install"
assert_eq "$(sha_of "$SUB_DIR/package-lock.json")" "$(sub_marker)" "SUBDIR marker after a root install"

new_sub_case "(s4) laptop, SUBDIR node_modules present: no install, no marker"
seed_sub_install
run_helper_sub laptop ok
assert_eq 0 "$RC" "exit code"
assert_eq 0 "$(ci_calls)" "npm ci calls"
assert_absent_file "$SUB_MARKER" "laptop SUBDIR marker"

new_sub_case "(s5) laptop, SUBDIR node_modules missing: one npm ci in SUBDIR, no marker"
run_helper_sub laptop ok
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_eq "$SUB_DIR" "$(cat "$CASE_DIR/npm.cwd")" "npm ci must run in ROOT/SUBDIR"
assert_absent_file "$SUB_MARKER" "laptop SUBDIR marker"

new_sub_case "(s6) an invalid SUBDIR exits 1 without installing"
run_helper_sub runner ok "../x"
assert_eq 1 "$RC" "exit code for SUBDIR ../x"
run_helper_sub runner ok "tools/missing"
assert_eq 1 "$RC" "exit code for a missing SUBDIR"
assert_eq 0 "$(ci_calls)" "npm ci calls"

new_sub_case "(s7) runner, SUBDIR node_modules without its hidden lockfile: re-installs despite a matching marker"
seed_install "$(sha_of "$ROOT/package-lock.json")"
seed_sub_install "$(sha_of "$SUB_DIR/package-lock.json")"
rm -f "$SUB_DIR/node_modules/.package-lock.json"
run_helper_sub runner ok
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_out_matches 'no node_modules/\.package-lock\.json' "reason printed"

# ===== Callers: each must hand the helper tools/test-bot as SUBDIR =====
# Dropping that argument makes the helper check the ROOT tree, which is
# already installed, so it exits 0 and tools/test-bot stays uninstalled: the
# Discord smoke then dies at import (ERR_MODULE_NOT_FOUND @discordjs/voice).

# extract_fn <file> <name>: the source of one top-level function.
extract_fn() { sed -n "/^$2() {/,/^}/p" "$1"; }

# new_caller_case <name> [helper sed expr]: new_sub_case with the helper
# copied to ROOT/scripts/ci, where both callers look for it. The optional
# sed expression edits that copy (to simulate an older checkout).
new_caller_case() {
    new_sub_case "$1"
    mkdir -p "$ROOT/scripts/ci"
    sed -e "${2:-}" "$HELPER" >"$ROOT/scripts/ci/ensure-runner-deps.sh"
}

# run_vci_test_bot_deps <npm mode>: validate-ci.sh's real
# _ensure_test_bot_deps in laptop mode, with REPO_ROOT at the fixture. The
# contract entry is seeded so these cases pin the install alone; the
# contract-build step is covered by validate-ci-test-bot-deps-contract.test.sh.
run_vci_test_bot_deps() {
    local fn
    mkdir -p "$ROOT/packages/contract/dist" && : >"$ROOT/packages/contract/dist/index.js"
    fn=$(extract_fn "$REPO_ROOT/scripts/validate-ci.sh" _ensure_test_bot_deps)
    OUT=$(PATH="$STUB_BIN:$PATH" RL_DEPS_RUNNER_ROOT="$CASE_DIR/not-root" \
        RL_WORKSPACE_ROOT="$CASE_DIR/not-root" RL_NPM_CI_LOCK="$CASE_DIR/lock" \
        STUB_NPM_MODE="$1" NPM_CALLS="$CASE_DIR/npm.calls" NPM_CWD="$CASE_DIR/npm.cwd" \
        REPO_ROOT="$ROOT" YELLOW="" NC="" bash -c "${fn:-false}"$'\n''_ensure_test_bot_deps' 2>&1)
    RC=$?
}

# run_rl_install_runner_deps: rl's real install_runner_deps in runner mode.
# The ssh_run stub runs the remote script locally with /workspace mapped to
# the fixture ROOT.
run_rl_install_runner_deps() {
    local fn stub
    fn=$(extract_fn "$REPO_ROOT/rl-infra/cli/rl" install_runner_deps)
    # shellcheck disable=SC2016
    stub='ssh_run() { [ "$1 $2 $3 $4" = "run-on-runner -- bash -c" ] || return 99; bash -c "${5//\/workspace/$FIXTURE_ROOT}"; }'
    OUT=$(PATH="$STUB_BIN:$PATH" RL_DEPS_RUNNER_ROOT="$ROOT" FIXTURE_ROOT="$ROOT" \
        RL_WORKSPACE_ROOT="$CASE_DIR/not-root" RL_NPM_CI_LOCK="$CASE_DIR/lock" \
        STUB_NPM_MODE=ok NPM_CALLS="$CASE_DIR/npm.calls" NPM_CWD="$CASE_DIR/npm.cwd" \
        bash -c "$stub"$'\n'"${fn:-false}"$'\n''install_runner_deps 1' 2>&1)
    RC=$?
}

new_caller_case "(c1) validate-ci _ensure_test_bot_deps installs tools/test-bot when only the root is installed"
seed_install
run_vci_test_bot_deps ok
assert_eq 0 "$RC" "exit code (output: $(printf '%s' "$OUT" | tr '\n' '|'))"
assert_eq 1 "$(ci_calls)" "npm ci calls"
assert_eq "$SUB_DIR" "$(cat "$CASE_DIR/npm.cwd")" "npm ci must run in tools/test-bot"

new_caller_case "(c2) validate-ci _ensure_test_bot_deps falls back to npm install in tools/test-bot when npm ci fails"
seed_install
run_vci_test_bot_deps ci-fail
assert_eq 0 "$RC" "exit code"
assert_eq 1 "$(grep -c -E '^install( |$)' "$CASE_DIR/npm.calls" || true)" "npm install calls after a failed npm ci"
assert_eq "$SUB_DIR" "$(tail -1 "$CASE_DIR/npm.cwd")" "the npm install fallback must run in tools/test-bot"

new_caller_case "(r1) rl install_runner_deps re-installs tools/test-bot on a warm runner when its lockfile changed"
seed_install "$(sha_of "$ROOT/package-lock.json")"
seed_sub_install "0000stale"
run_rl_install_runner_deps
assert_eq 1 "$(ci_calls)" "npm ci calls (root current, tools/test-bot stale)"
assert_eq "$SUB_DIR" "$(cat "$CASE_DIR/npm.cwd")" "npm ci must run in tools/test-bot"
assert_eq "$(sha_of "$SUB_DIR/package-lock.json")" "$(sub_marker)" "tools/test-bot marker after the refresh"

new_caller_case "(r2) rl install_runner_deps on a checkout whose helper predates SUBDIR keeps the populated-tree guard" \
    '/RL_DEPS_SUBROOT_V1/d'
seed_install "$(sha_of "$ROOT/package-lock.json")"
seed_sub_install "0000stale"
run_rl_install_runner_deps
assert_eq 0 "$(ci_calls)" "npm ci calls while tools/test-bot/node_modules exists"
rm -rf "$SUB_DIR/node_modules"
run_rl_install_runner_deps
assert_eq 1 "$(ci_calls)" "npm ci calls once tools/test-bot/node_modules is gone"
assert_eq "$SUB_DIR" "$(cat "$CASE_DIR/npm.cwd")" "the old guard must install in tools/test-bot"
assert_absent_file "$SUB_MARKER" "the old guard writes no tools/test-bot marker"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    echo "Failed cases:"
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
