#!/usr/bin/env bash
# ROK-1510 — build-image-on-runner bakes the commit into the image.
#
# Fleet builds passed no --build-arg COMMIT_SHA / APP_VERSION, so every fleet
# env answered GET /api/system/version with commitSha null and the ROK-1393
# running-commit-vs-main check fell back to semver. The laptop MCP now resolves
# the worktree HEAD and passes it as --commit-sha; the script prefers it over
# the runner's SYNCED_HEAD (a Mutagen replica whose HEAD is the BASE sha for a
# worktree branch) and omits both build-args only when there is no sha at all.
#
# Cases:
#   B1 — a supplied --commit-sha wins over SYNCED_HEAD and yields both
#        build-args; the rl.synced_head label is still runner-derived.
#   B2 — no --commit-sha falls back to the runner's SYNCED_HEAD.
#   B3 — no sha at all omits both build-args; the build still runs.
#   B4 — a malformed --commit-sha is rejected before docker runs (the value is
#        spliced into a `bash -c` string executed inside the runner).
#
# Technique: `docker` is stubbed on PATH (same pattern as
# run-on-runner-exec-bits.test.sh). The shim logs every invocation, runs
# `docker exec`'s command locally with /workspace rebound onto a temp tree, and
# no-ops build/push — so the inner `docker build` inside BUILD_CMD lands in the
# log with its full argv. That logged line IS the generated build command.

set -uo pipefail

CURRENT_TEST_FILE="build-image-commit-sha.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

BUILD_IMAGE="$BIN_DIR/build-image-on-runner"
GIVEN_SHA="0123456789abcdef0123456789abcdef01234567"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Give this agent a claimed slot so state::slot_for_agent resolves.
_seed_claim() {
    local slot="${1:-2}"
    jq -n --argjson s "$slot" --arg a "$RL_AGENT_ID" \
        '[{slot: $s, claimed: true, agent_id: $a, branch: "rok-1510",
           started_at: null, last_heartbeat: null}]' \
        > "$RL_STATE_DIR/claims.json"
}

# Fake /workspace with a Dockerfile.allinone the script's PATCH_SED matches.
# `git` makes it a repo with one commit (RUNNER_HEAD); `nogit` leaves it bare.
_make_workspace() {
    local mode="${1:-git}"
    WS="$TMP_STATE/ws"
    mkdir -p "$WS"
    printf 'FROM scratch\nRUN npm run build -w @raid-ledger/contract\n' \
        > "$WS/Dockerfile.allinone"
    RUNNER_HEAD=""
    if [[ "$mode" == "git" ]]; then
        git -C "$WS" init -q
        git -C "$WS" -c user.email=t@t -c user.name=t \
            commit -q --allow-empty -m init
        RUNNER_HEAD=$(git -C "$WS" rev-parse HEAD)
    fi
}

# Stub `docker`: log every call; run `exec`'s command locally with /workspace
# rebound onto $WS; no-op build/push (already logged).
_install_fake_docker() {
    FAKE_BIN=$(mktemp -d -t rl-fake-bin.XXXXXX)
    DOCKER_LOG="$TMP_STATE/docker.invoked"
    : > "$DOCKER_LOG"
    {
        printf '#!/usr/bin/env bash\n'
        printf 'WS=%q\n' "$WS"
        printf 'LOG=%q\n' "$DOCKER_LOG"
        cat <<'SHIM'
{ printf 'docker %s' "$*" | tr '\n' ' '; printf '\n'; } >> "$LOG"
[[ "${1:-}" == "exec" ]] || exit 0
shift
while (( $# > 0 )); do
    case "$1" in
        -i|-t|-it|-ti) shift ;;
        -w|-e|--workdir|--env) shift 2 ;;
        -*) shift ;;
        *) break ;;
    esac
done
shift || true
ARGS=()
for a in "$@"; do
    ARGS+=("${a//\/workspace/$WS}")
done
cd "$WS" || exit 1
"${ARGS[@]}"
SHIM
    } > "$FAKE_BIN/docker"
    chmod +x "$FAKE_BIN/docker"
    _install_sed_shim
}

# BUILD_CMD runs GNU-form `sed -i '<expr>' file`. BSD sed (macOS) would read
# the expr as the backup suffix, so translate to `-i ''` there. The shim finds
# the real sed by skipping its own directory on PATH.
_install_sed_shim() {
    {
        printf '#!/usr/bin/env bash\n'
        printf 'SELF=%q\n' "$FAKE_BIN"
        cat <<'SHIM'
REAL_SED=""
IFS=: read -r -a _dirs <<< "$PATH"
for d in "${_dirs[@]}"; do
    [[ "$d" == "$SELF" ]] && continue
    [[ -x "$d/sed" ]] && { REAL_SED="$d/sed"; break; }
done
[[ -n "$REAL_SED" ]] || { echo "sed shim: no real sed on PATH" >&2; exit 127; }
if "$REAL_SED" --version >/dev/null 2>&1 || [[ "${1:-}" != "-i" ]]; then
    exec "$REAL_SED" "$@"
fi
shift
exec "$REAL_SED" -i '' "$@"
SHIM
    } > "$FAKE_BIN/sed"
    chmod +x "$FAKE_BIN/sed"
}

_remove_fake_docker() {
    [[ -n "${FAKE_BIN:-}" && -d "$FAKE_BIN" ]] && rm -rf "$FAKE_BIN"
    unset FAKE_BIN
}

# Run the script with the fake docker on PATH; echo its exit code.
_run_build() {
    local rc=0
    PATH="$FAKE_BIN:$PATH" bash "$BUILD_IMAGE" "$@" >/dev/null 2>&1 || rc=$?
    echo "$rc"
}

# Count needle hits on the generated `docker build` line only — the logged
# `docker exec` line carries BUILD_CMD's literal text ("--build-arg
# COMMIT_SHA=$BUILD_SHA") and would otherwise match every needle.
_count() { grep '^docker build' "$DOCKER_LOG" | grep -c -- "$1"; }

# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------

test_b1_supplied_sha_wins() {
    CURRENT_TEST_NAME="B1: supplied --commit-sha wins over SYNCED_HEAD and yields both build-args"
    _make_workspace git
    _seed_claim 2
    _install_fake_docker
    local rc
    rc=$(_run_build --tag t1 --no-push --commit-sha "$GIVEN_SHA")
    assert_eq "$rc" "0" "build must succeed with a well-formed --commit-sha"
    assert_eq "$(_count "--build-arg COMMIT_SHA=$GIVEN_SHA")" "1" \
        "docker build must carry --build-arg COMMIT_SHA=<supplied sha>; without it the env's /api/system/version reports commitSha null"
    assert_eq "$(_count "--build-arg APP_VERSION=fleet-${GIVEN_SHA:0:7}")" "1" \
        "docker build must carry --build-arg APP_VERSION=fleet-<short supplied sha>"
    assert_eq "$(_count "--label rl.synced_head=$RUNNER_HEAD")" "1" \
        "the rl.synced_head label must stay runner-derived (ROK-1357 AC7 kept)"
    assert_eq "$(_count "COMMIT_SHA=$RUNNER_HEAD")" "0" \
        "the runner replica HEAD is the BASE sha for a worktree branch — it must not win over the supplied laptop sha"
    _remove_fake_docker
}

test_b2_fallback_to_synced_head() {
    CURRENT_TEST_NAME="B2: no --commit-sha falls back to the runner SYNCED_HEAD"
    _make_workspace git
    _seed_claim 2
    _install_fake_docker
    _run_build --tag t2 --no-push >/dev/null
    assert_eq "$(_count "--build-arg COMMIT_SHA=$RUNNER_HEAD")" "1" \
        "with no --commit-sha the build must still bake the runner's synced HEAD as COMMIT_SHA"
    assert_eq "$(_count "--build-arg APP_VERSION=fleet-${RUNNER_HEAD:0:7}")" "1" \
        "with no --commit-sha APP_VERSION must be fleet-<short synced HEAD>"
    _remove_fake_docker
}

test_b3_no_sha_omits_both() {
    CURRENT_TEST_NAME="B3: no sha at all omits both build-args"
    _make_workspace nogit
    _seed_claim 2
    _install_fake_docker
    _run_build --tag t3 --no-push >/dev/null
    assert_eq "$(_count "--build-arg COMMIT_SHA")" "0" \
        "with no sha anywhere the build must not pass an empty COMMIT_SHA"
    assert_eq "$(_count "APP_VERSION=")" "0" \
        "with no sha anywhere the build must not pass an empty APP_VERSION"
    assert_eq "$(_count "^docker build")" "1" \
        "the build itself must still run when no sha is available"
    _remove_fake_docker
}

test_b4_malformed_sha_rejected() {
    CURRENT_TEST_NAME="B4: malformed --commit-sha is rejected before docker runs"
    _make_workspace git
    _seed_claim 2
    _install_fake_docker
    local rc
    rc=$(_run_build --tag t4 --no-push --commit-sha 'abc; touch x')
    assert_eq "$rc" "2" \
        "a --commit-sha that is not [0-9a-f]{7,40} must exit 2 — it is spliced into a bash -c string inside the runner"
    assert_eq "$(wc -l < "$DOCKER_LOG" | tr -d ' ')" "0" \
        "docker must never be invoked with a malformed --commit-sha"
    _remove_fake_docker
}

run_test "B1 supplied sha wins"        test_b1_supplied_sha_wins
run_test "B2 fallback to synced head"  test_b2_fallback_to_synced_head
run_test "B3 no sha omits build-args"  test_b3_no_sha_omits_both
run_test "B4 malformed sha rejected"   test_b4_malformed_sha_rejected

print_test_summary
