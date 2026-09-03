#!/usr/bin/env bash
# A3-B P2 — runner-side exec-bit restoration.
#
# The fleet's Mutagen session is created with `--permissions-mode=manual
# --default-file-mode-beta=0644` (rl-infra/cli/rl::ensure_mutagen_sync), which
# by design refuses to propagate ANY source permission — executability
# included. So every script in the synced worktree lands on the runner at 0644
# and `./scripts/foo.sh` dies with exit 126, which reads as a test failure with
# no assertion output rather than an environment problem.
#
# rl-infra/runner/restore-exec-bits.sh is the single post-sync repair. These
# specs cover both halves of the brief:
#   AC1 — the known-executable set is +x after a restore (including
#         rl-infra/cli/rl, the entry the manual folklore kept missing).
#   AC2 — the restore does NOT blanket `chmod -R a+x` the whole tree.
#   AC3 — a required script that is still non-executable after the restore
#         produces a NAMED error and the reserved exit code 97 — never a bare
#         126, never a silent 0.
#   AC4 — --check verifies without repairing, same named error.
#
# NB (self-immunity): every invocation below is `bash "$RESTORE_SCRIPT"`, never
# `"$RESTORE_SCRIPT"`. A spec for a dropped-exec-bit bug must not itself be
# able to fail because of a dropped exec bit.

set -uo pipefail

CURRENT_TEST_FILE="runner-exec-bits.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
RESTORE_SCRIPT="$WORKTREE_ROOT/rl-infra/runner/restore-exec-bits.sh"

# Reserved exit code for "a required script is not executable". Distinct from
# 126 (shell's "found but not executable") precisely so the two are tellable
# apart in a log.
readonly EXPECTED_FATAL_CODE=97

# Portable octal mode read — BSD stat (macOS laptop) vs GNU stat (runner).
mode_of() {
    local path="$1"
    stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null
}

# Build a throwaway tree shaped like the runner's post-sync /workspace: real
# relative paths, every file 0644 (exactly what Mutagen's manual mode leaves).
make_synced_tree() {
    local root="$1"
    mkdir -p "$root/rl-infra/cli" \
             "$root/rl-infra/orchestrator/bin" \
             "$root/rl-infra/orchestrator/test" \
             "$root/rl-infra/gc-sweeper" \
             "$root/rl-infra/runner" \
             "$root/scripts/test" \
             "$root/api/src"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/rl-infra/cli/rl"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/rl-infra/orchestrator/bin/env-spin"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/rl-infra/orchestrator/bin/_admission.sh"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/rl-infra/orchestrator/test/env-spin.test.sh"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/rl-infra/gc-sweeper/sweep.sh"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/rl-infra/runner/entrypoint.sh"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/scripts/validate-ci.sh"
    printf '#!/usr/bin/env bash\ntrue\n' > "$root/scripts/test/run-all.sh"
    # A file that must NOT be made executable — source, not a script.
    printf 'export const x = 1;\n' > "$root/api/src/main.ts"
    find "$root" -type f -exec chmod 0644 {} +
}

assert_executable() {
    local path="$1" label="$2"
    if [[ -x "$path" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $label not executable after restore")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $label should be executable after the post-sync restore"
        echo "  expected mode: any with +x (0755)"
        echo "  actual mode:   $(mode_of "$path") ($path)"
    fi
}

assert_not_executable() {
    local path="$1" label="$2"
    if [[ ! -x "$path" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $label wrongly made executable")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $label is NOT in the executable manifest and must stay 0644"
        echo "  expected mode: 644 (no +x)"
        echo "  actual mode:   $(mode_of "$path") ($path)"
    fi
}

# Guard: without the implementation there is nothing to assert against, and a
# missing-file crash is not an assertion. Report it AS an assertion so a red run
# still names expected vs actual.
restore_script_present() {
    if [[ -f "$RESTORE_SCRIPT" ]]; then
        return 0
    fi
    TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
    TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: restore-exec-bits.sh missing")
    echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] post-sync exec-bit restore script is missing"
    echo "  expected: an executable-restore script at $RESTORE_SCRIPT"
    echo "  actual:   no such file"
    return 1
}

# AC1 — every entry of the known-executable set is +x after a restore.
test_ac1_known_set_is_executable() {
    CURRENT_TEST_NAME="AC1: known-executable set is +x after a post-sync restore"
    restore_script_present || return 0
    local root="$TMP_STATE/workspace"
    make_synced_tree "$root"

    bash "$RESTORE_SCRIPT" "$root" >/dev/null 2>&1

    # rl-infra/cli/rl is called out separately in the brief: it is the entry the
    # hand-rolled `chmod -R a+x` incantation kept missing, and one lost run was
    # attributed to exactly it.
    assert_executable "$root/rl-infra/cli/rl" "rl-infra/cli/rl"
    assert_executable "$root/rl-infra/orchestrator/bin/env-spin" "rl-infra/orchestrator/bin/env-spin"
    assert_executable "$root/rl-infra/orchestrator/bin/_admission.sh" "rl-infra/orchestrator/bin/_admission.sh"
    assert_executable "$root/rl-infra/orchestrator/test/env-spin.test.sh" "rl-infra/orchestrator/test/env-spin.test.sh"
    assert_executable "$root/rl-infra/gc-sweeper/sweep.sh" "rl-infra/gc-sweeper/sweep.sh"
    assert_executable "$root/rl-infra/runner/entrypoint.sh" "rl-infra/runner/entrypoint.sh"
    assert_executable "$root/scripts/validate-ci.sh" "repo-root scripts/validate-ci.sh"
    assert_executable "$root/scripts/test/run-all.sh" "scripts/test/run-all.sh"
}

# AC1b — the restore exits 0 on a healthy tree (no false alarm).
test_ac1b_healthy_tree_exits_zero() {
    CURRENT_TEST_NAME="AC1b: restore over a fully-repairable tree exits 0"
    restore_script_present || return 0
    local root="$TMP_STATE/workspace"
    make_synced_tree "$root"

    local rc=0
    bash "$RESTORE_SCRIPT" "$root" >/dev/null 2>&1 || rc=$?
    assert_exit_code "$rc" 0 "a tree whose exec bits are all repairable must exit 0"
}

# AC2 — NOT a blanket `chmod -R a+x`. Source files stay 0644.
test_ac2_does_not_blanket_chmod() {
    CURRENT_TEST_NAME="AC2: restore is manifest-scoped, not chmod -R a+x"
    restore_script_present || return 0
    local root="$TMP_STATE/workspace"
    make_synced_tree "$root"

    bash "$RESTORE_SCRIPT" "$root" >/dev/null 2>&1

    assert_not_executable "$root/api/src/main.ts" "api/src/main.ts"
}

# AC3 — the loud-failure half. A required script that is STILL non-executable
# after the repair must surface a named error and the reserved code 97, not the
# bare 126 the calling suite would otherwise die with.
#
# The unrepairable condition is produced by shimming `chmod` to a no-op on PATH
# for the duration of this one invocation. That reproduces the real-world shape
# (a read-only bind mount, a squashed filesystem, an EPERM under a foreign uid)
# without needing root.
test_ac3_unrepairable_yields_named_error_not_126() {
    CURRENT_TEST_NAME="AC3: unrepairable script yields a named error + exit 97, never a bare 126"
    restore_script_present || return 0
    local root="$TMP_STATE/workspace"
    make_synced_tree "$root"

    local shim_dir="$TMP_STATE/shim"
    mkdir -p "$shim_dir"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$shim_dir/chmod"
    /bin/chmod +x "$shim_dir/chmod"

    local out rc=0
    out=$(PATH="$shim_dir:$PATH" bash "$RESTORE_SCRIPT" "$root" 2>&1) || rc=$?

    assert_exit_code "$rc" "$EXPECTED_FATAL_CODE" \
        "a required script left non-executable must exit with the reserved 97, not succeed"
    assert_neq "$rc" 126 \
        "exit must NOT be a bare 126 — 126 is the failure mode this fix exists to replace"
    assert_contains "$out" "rl-exec-bits:" \
        "stderr must carry the rl-exec-bits: prefix so the failure is greppable and attributable"
    assert_contains "$out" "not executable" \
        "the error must say what is wrong, in words, not just fail"
    assert_contains "$out" "rl-infra/cli/rl" \
        "the error must NAME the offending path (rl-infra/cli/rl) so no one has to guess"
}

# AC4 — --check verifies without repairing, and reports the same named error.
test_ac4_check_mode_reports_without_repairing() {
    CURRENT_TEST_NAME="AC4: --check reports the named error and leaves modes untouched"
    restore_script_present || return 0
    local root="$TMP_STATE/workspace"
    make_synced_tree "$root"

    local out rc=0
    out=$(bash "$RESTORE_SCRIPT" --check "$root" 2>&1) || rc=$?

    assert_exit_code "$rc" "$EXPECTED_FATAL_CODE" \
        "--check over a freshly-synced (all-0644) tree must report the reserved 97"
    assert_contains "$out" "rl-exec-bits:" \
        "--check must emit the same named, greppable error as the repair path"
    assert_not_executable "$root/rl-infra/cli/rl" "rl-infra/cli/rl (under --check)"
}

run_test "AC1 known set executable"        test_ac1_known_set_is_executable
run_test "AC1b healthy tree exits 0"       test_ac1b_healthy_tree_exits_zero
run_test "AC2 manifest-scoped"             test_ac2_does_not_blanket_chmod
run_test "AC3 named error not 126"         test_ac3_unrepairable_yields_named_error_not_126
run_test "AC4 check mode"                  test_ac4_check_mode_reports_without_repairing

print_test_summary
