#!/usr/bin/env bash
# A3-B — the exec-bit repair must survive a sync that lands AFTER it ran.
#
# THE GAP THIS CLOSES
# -------------------
# A3-B P2 wired restore-exec-bits.sh into rl-infra/cli/rl::flush_mutagen, so the
# repair fires at explicit-flush time. Mutagen, though, is a CONTINUOUS session:
# any write on the laptop after that flush is delivered to the runner at 0644
# (--permissions-mode=manual, Bug S / ROK-1326) and silently re-drops the bit the
# repair had just restored. P2's own handover named the hole and left it open.
#
# It closed on a real run: on 2026-09-03 a `git rebase` on the laptop re-synced
# orchestrator/bin/task-cancel at 00:13, AFTER the gate's restore had passed.
# task-cancel-runner-children.test.sh invokes "$BIN_DIR/task-cancel" directly, so
# it got permission-denied and reported 10/17 failures on the runner while the
# same commit was 17/0 on the laptop. Nothing in those ten failures said
# "permission" — they read like a real regression.
#
# The fix under test moves the guarantee from "at flush" to "immediately before
# anything executes", at the single chokepoint every runner-side execution passes
# through: orchestrator/bin/run-on-runner{,-with-heartbeat}. A file re-synced
# after the last restore is therefore repaired again before the command that uses
# it is dispatched.
#
# Cases:
#   X1 — a manifest file re-synced at 0644 AFTER a passing restore is executable
#        at the moment the caller's command runs (the 2026-09-03 defect).
#   X2 — the repair is dispatched BEFORE the caller's command, not after.
#   X3 — run-on-runner-with-heartbeat carries the same guarantee (task-start
#        dispatches nearly every heavy run through it, not through run-on-runner).
#   X4 — an UNREPAIRABLE tree aborts with the reserved 97 and a named reason, and
#        the caller's command is never dispatched. Spending a run on a tree whose
#        scripts exit 126 is the wasted round-trip this whole fix exists to stop.
#   X5 — a workspace with NO restore script still dispatches (warn, not fatal):
#        older branches predate the script and must stay runnable.
#   X6 — the repair's chatter never reaches run-on-runner's STDOUT. Callers parse
#        that stdout (jq, sentinel probes); a stray "ok — N scripts" corrupts it.
#
# Technique: `docker` is stubbed on PATH (same pattern as
# task-cancel-runner-children.test.sh) with a shim that rebinds /workspace onto a
# real temp tree and runs the command locally. So the tree, the modes and the
# repair are all REAL — only the container boundary is faked.
#
# This file invokes every script under test as `bash "$SCRIPT"`: it must not be
# vulnerable to the very bug it is asserting.

set -uo pipefail

CURRENT_TEST_FILE="run-on-runner-exec-bits.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
REAL_RESTORE="$WORKTREE_ROOT/rl-infra/runner/restore-exec-bits.sh"
RUN_ON_RUNNER="$BIN_DIR/run-on-runner"
RUN_WITH_HEARTBEAT="$BIN_DIR/run-on-runner-with-heartbeat"

readonly EXPECTED_FATAL_CODE=97
# The file the 2026-09-03 rebase re-synced. Used as the canary here for the same
# reason it was the casualty there: it is in the manifest and specs exec it.
readonly CANARY_REL="rl-infra/orchestrator/bin/task-cancel"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Portable mode read (BSD stat on macOS, GNU stat on the runner).
_mode_of() {
    stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null || echo "?"
}

# Build a fake /workspace: a handful of real manifest-matching scripts plus the
# restore script itself. `restore_mode` selects which restore lands there:
#   real     — the shipped rl-infra/runner/restore-exec-bits.sh
#   broken   — a stub that always exits 97 (an unrepairable tree)
#   noisy    — a stub that succeeds but chatters on stdout
#   missing  — no restore script at all (a branch that predates it)
_make_workspace() {
    local restore_mode="${1:-real}"
    WS="$TMP_STATE/ws"
    mkdir -p "$WS/rl-infra/runner" "$WS/rl-infra/orchestrator/bin" \
        "$WS/rl-infra/orchestrator/test" "$WS/rl-infra/gc-sweeper" \
        "$WS/rl-infra/cli" "$WS/scripts/test"
    local f
    for f in "$CANARY_REL" "rl-infra/orchestrator/bin/task-start" \
        "rl-infra/orchestrator/test/some.test.sh" "rl-infra/gc-sweeper/sweep.sh" \
        "rl-infra/cli/rl" "rl-infra/deploy.sh" "scripts/validate-ci.sh" \
        "scripts/test/helper.sh"; do
        printf '#!/usr/bin/env bash\nexit 0\n' > "$WS/$f"
        chmod 0755 "$WS/$f"
    done
    case "$restore_mode" in
        real)
            cp "$REAL_RESTORE" "$WS/rl-infra/runner/restore-exec-bits.sh"
            ;;
        broken)
            printf '#!/usr/bin/env bash\necho "rl-exec-bits: FATAL cannot repair" >&2\nexit 97\n' \
                > "$WS/rl-infra/runner/restore-exec-bits.sh"
            ;;
        noisy)
            printf '#!/usr/bin/env bash\necho "rl-exec-bits: ok — 42 script(s) executable"\nexit 0\n' \
                > "$WS/rl-infra/runner/restore-exec-bits.sh"
            ;;
        missing) : ;;
    esac
    [[ -f "$WS/rl-infra/runner/restore-exec-bits.sh" ]] && \
        chmod 0644 "$WS/rl-infra/runner/restore-exec-bits.sh"
    return 0
}

# Simulate the 2026-09-03 sequence: a restore already ran and passed, then a
# later Mutagen delivery re-wrote one file at 0644 and re-dropped its bit.
_resync_canary_at_0644() {
    bash "$WS/rl-infra/runner/restore-exec-bits.sh" "$WS" >/dev/null 2>&1
    chmod 0644 "$WS/$CANARY_REL"
}

# Stub `docker`, rebinding /workspace onto $WS and running the command for real.
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
# Drop docker exec's own flags, then the container name.
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
}

_remove_fake_docker() {
    [[ -n "${FAKE_BIN:-}" && -d "$FAKE_BIN" ]] && rm -rf "$FAKE_BIN"
    unset FAKE_BIN
}

# Give this agent a claimed slot so state::slot_for_agent resolves.
_seed_claim() {
    local slot="${1:-2}"
    jq -n --argjson s "$slot" --arg a "$RL_AGENT_ID" \
        '[{slot: $s, claimed: true, agent_id: $a, branch: "a3b-exec-bits",
           started_at: null, last_heartbeat: null}]' \
        > "$RL_STATE_DIR/claims.json"
}

# The command we hand to run-on-runner: it REPORTS the canary's mode from inside
# the container, at the exact moment it is dispatched. That is what makes the
# ordering observable — a repair that ran afterwards would report 644.
_probe_cmd=(bash -c 'printf "canary_mode=%s\n" "$(stat -f "%Lp" /workspace/rl-infra/orchestrator/bin/task-cancel 2>/dev/null || stat -c "%a" /workspace/rl-infra/orchestrator/bin/task-cancel 2>/dev/null || echo "?")"')

# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------

# X1 — the 2026-09-03 defect, in one assertion.
test_x1_resynced_file_is_executable_at_dispatch() {
    CURRENT_TEST_NAME="X1: a file re-synced at 0644 after a passing restore is executable when the command runs"
    _make_workspace real
    _resync_canary_at_0644
    _seed_claim 2

    local mode_before
    mode_before=$(_mode_of "$WS/$CANARY_REL")
    assert_eq "$mode_before" "644" \
        "fixture precondition: the canary must be 0644 going in, otherwise this case proves nothing about a post-restore resync"

    _install_fake_docker
    local out
    out=$(PATH="$FAKE_BIN:$PATH" bash "$RUN_ON_RUNNER" -- "${_probe_cmd[@]}" 2>/dev/null)
    _remove_fake_docker

    assert_eq "$out" "canary_mode=755" \
        "run-on-runner must re-assert the exec bits immediately before dispatch: this file was re-synced at 0644 AFTER the last restore passed, so at dispatch time it was still 0644 and every spec that execs it dies with a bare 126 that reads like a regression (2026-09-03: task-cancel-runner-children.test.sh 10/17 on the runner, 17/0 on the laptop)"
}

# X2 — repair first, command second. Ordering is the whole fix.
test_x2_repair_is_dispatched_before_the_command() {
    CURRENT_TEST_NAME="X2: the repair is dispatched before the caller's command"
    _make_workspace real
    _resync_canary_at_0644
    _seed_claim 2
    _install_fake_docker

    PATH="$FAKE_BIN:$PATH" bash "$RUN_ON_RUNNER" -- "${_probe_cmd[@]}" \
        >/dev/null 2>&1
    local first_line second_line
    first_line=$(sed -n '1p' "$DOCKER_LOG")
    second_line=$(sed -n '2p' "$DOCKER_LOG")
    _remove_fake_docker

    assert_contains "$first_line" "restore-exec-bits.sh" \
        "the FIRST docker exec must be the exec-bit repair; a repair that runs after the command cannot help the command"
    assert_contains "$second_line" "stat" \
        "the caller's own command must be the SECOND exec, dispatched only once the tree is executable"
}

# X3 — the heartbeat wrapper is the path task-start uses for heavy runs.
test_x3_heartbeat_wrapper_repairs_too() {
    CURRENT_TEST_NAME="X3: run-on-runner-with-heartbeat repairs before dispatch too"
    _make_workspace real
    _resync_canary_at_0644
    _seed_claim 2
    _install_fake_docker

    local out
    out=$(PATH="$FAKE_BIN:$PATH" bash "$RUN_WITH_HEARTBEAT" \
        --heartbeat-interval=30 -- "${_probe_cmd[@]}" 2>/dev/null \
        | grep '^canary_mode=' || true)
    _remove_fake_docker

    assert_eq "$out" "canary_mode=755" \
        "task-start dispatches nearly every heavy run through the heartbeat wrapper, so a guard only in run-on-runner would leave the fleet's main path exposed to exactly the failure it fixes"
}

# X4 — refuse to spend a run on a tree that cannot be repaired.
test_x4_unrepairable_tree_aborts_without_dispatch() {
    CURRENT_TEST_NAME="X4: an unrepairable tree aborts with 97 and never dispatches the command"
    _make_workspace broken
    _seed_claim 2
    _install_fake_docker

    local out rc=0
    out=$(PATH="$FAKE_BIN:$PATH" bash "$RUN_ON_RUNNER" -- "${_probe_cmd[@]}" 2>&1) || rc=$?
    local log
    log=$(cat "$DOCKER_LOG")
    _remove_fake_docker

    assert_exit_code "$rc" "$EXPECTED_FATAL_CODE" \
        "an unrepairable tree must exit with the reserved 97, never a bare 126 and never 0"
    assert_contains "$out" "exec-bit" \
        "the abort must name itself as an exec-bit/environment problem — an unexplained non-zero is what cost the two runs this fix exists to stop"
    if [[ "$log" != *"stat"* ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: command dispatched onto an unrepairable tree")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] the caller's command was dispatched even though the tree could not be made executable"
        echo "  expected: no second docker exec after a failed repair"
        echo "  actual:   $log"
    fi
}

# X5 — don't brick branches that predate the restore script.
test_x5_missing_restore_script_is_a_warning_not_a_block() {
    CURRENT_TEST_NAME="X5: a workspace with no restore script still dispatches (warn, not fatal)"
    _make_workspace missing
    _seed_claim 2
    _install_fake_docker

    local out rc=0
    out=$(PATH="$FAKE_BIN:$PATH" bash "$RUN_ON_RUNNER" -- \
        bash -c 'echo dispatched' 2>/dev/null) || rc=$?
    _remove_fake_docker

    assert_exit_code "$rc" "0" \
        "a worktree that predates restore-exec-bits.sh must still run; hard-failing on layout drift would make every claim on an older branch brittle"
    assert_eq "$out" "dispatched" \
        "the caller's command must still reach the runner when there is no repair script to run"
}

# X6 — stdout is the caller's, not the repair's.
test_x6_repair_output_never_pollutes_stdout() {
    CURRENT_TEST_NAME="X6: repair chatter stays off run-on-runner's stdout"
    _make_workspace noisy
    _seed_claim 2
    _install_fake_docker

    local out
    out=$(PATH="$FAKE_BIN:$PATH" bash "$RUN_ON_RUNNER" -- \
        bash -c 'echo only-this' 2>/dev/null)
    _remove_fake_docker

    assert_eq "$out" "only-this" \
        "callers parse run-on-runner's stdout (jq envelopes, the sync-guard sentinel probe); repair chatter leaking into it silently corrupts every one of them"
}

run_test "X1 resynced file executable at dispatch" test_x1_resynced_file_is_executable_at_dispatch
run_test "X2 repair before command"                test_x2_repair_is_dispatched_before_the_command
run_test "X3 heartbeat wrapper repairs"            test_x3_heartbeat_wrapper_repairs_too
run_test "X4 unrepairable aborts"                  test_x4_unrepairable_tree_aborts_without_dispatch
run_test "X5 missing restore warns"                test_x5_missing_restore_script_is_a_warning_not_a_block
run_test "X6 stdout stays clean"                   test_x6_repair_output_never_pollutes_stdout

print_test_summary
