#!/usr/bin/env bash
# ROK-1793 S2 — bin/_gate_merge.sh: one canonical Summary from child logs,
# fixed row ownership (D5), missing owned rows FAIL, child id in the note.
set -uo pipefail

# shellcheck disable=SC2034  # read by test_helpers.sh
CURRENT_TEST_FILE="gate-merge.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$(cd "$TEST_DIR/../bin" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

P="mergepar01"

# _child <role> <status> <row>... — child JSON + a log with a Summary block.
# Each row is "Name|STATUS|note".
_child() {
    local role="$1" st="$2" id="${P}$1" r name status note; shift 2
    jq -n --arg s "$st" --arg p "$P" '{status:$s, parent_task_id:$p}' > "$RL_TASKS_DIR/$id.json"
    {
        echo "Build (all workspaces): PASS"
        printf '\n\033[1;33m========== Summary ==========\033[0m\n'
        printf "%-30s  %s\n" "Check" "Result"
        printf "%-30s  %s\n" "-----" "------"
        for r in "$@"; do
            IFS='|' read -r name status note <<<"$r"
            printf "%-30s  \033[0;32m%s\033[0m%s\n" "$name" "$status" "${note:+ — $note}"
        done
    } > "$RL_TASKS_DIR/$id.log"
    [[ "$role" == b && "${DEFER:-0}" == 1 ]] && echo "[parallel] discord-deferred" >> "$RL_TASKS_DIR/$id.log"
    jq --arg id "$id" --arg r "$role" --argjson s "$([[ $role == b ]] && echo 2 || echo 1)" \
        '.children = ((.children // []) + [{task_id:$id, role:$r, slot:$s, borrowed:($r == "b")}])' \
        "$RL_TASKS_DIR/$P.json" > "$RL_TASKS_DIR/$P.tmp" && mv "$RL_TASKS_DIR/$P.tmp" "$RL_TASKS_DIR/$P.json"
}
_parent() { jq -n --arg id "$P" '{task_id:$id, status:"running"}' > "$RL_TASKS_DIR/$P.json"; }
A_ROWS=("Build (all workspaces)|PASS|" "TypeScript (all)|PASS|" "Lint (all)|PASS|"
    "Integration tests (api)|PASS|" "Playwright (desktop + mobile)|SKIPPED|phase 1, see child b"
    "Discord smoke (companion bot)|SKIPPED|phase 1, see child b")
B_PASS=("Playwright (desktop + mobile, scoped: 2 specs)|PASS|" "Discord smoke (companion bot)|SKIPPED|no bot files changed")
_merge() { OUT=$(bash "$BIN_DIR/_gate_merge.sh" "$P"); RC=$?; }
_row() { printf '%s\n' "$OUT" | grep -E "^$1" | tail -1; }

test_both_pass() {
    _parent; _child a succeeded "${A_ROWS[@]}"; _child b succeeded "${B_PASS[@]}"; _merge
    assert_exit_code "$RC" "0" "A PASS + B PASS -> exit 0"
    assert_contains "$(_row 'Playwright')" "PASS — child ${P}b slot 2" "Playwright owned by B, note carries B's id"
    assert_contains "$(_row 'Integration')" "PASS — child ${P}a slot 1" "integration owned by A"
    assert_eq "$(printf '%s\n' "$OUT" | grep -c '^Playwright')" "1" "A's SKIPPED phase-1 row is dropped"
    assert_contains "$OUT" "[parallel] merged: 6 rows from 2 children" "merged line counts rows + children"
}

test_b_missing_playwright() {
    _parent; _child a succeeded "${A_ROWS[@]}"; _child b succeeded "Discord smoke (companion bot)|SKIPPED|x"; _merge
    assert_exit_code "$RC" "1" "missing owned row -> exit 1"
    assert_contains "$(_row 'Playwright')" "FAIL — missing from child ${P}b" "missing Playwright row is a FAIL row"
}

test_a_fail_b_pass() {
    _parent; _child a failed "Build (all workspaces)|PASS|" "TypeScript (all)|FAIL|" "Lint (all)|PASS|"
    _child b succeeded "${B_PASS[@]}"; _merge
    assert_exit_code "$RC" "1" "A FAIL -> exit 1"
    assert_contains "$(_row 'TypeScript')" "FAIL — child ${P}a" "A's FAIL row kept"
    assert_contains "$(_row 'Playwright')" "PASS — child ${P}b" "B's PASS row kept alongside"
}

test_deferred_discord_replaced_by_c() {
    _parent; _child a succeeded "${A_ROWS[@]}"
    DEFER=1 _child b succeeded "Playwright (desktop + mobile)|PASS|" "Discord smoke (companion bot)|SKIPPED|deferred to phase 2"
    _child c succeeded "Playwright (desktop + mobile)|SKIPPED|phase 2" "Discord smoke (companion bot)|PASS|"; _merge
    assert_exit_code "$RC" "0" "C's Discord PASS -> exit 0"
    assert_contains "$(_row 'Discord')" "PASS — child ${P}c slot 1" "Discord row comes from C"
    assert_eq "$(printf '%s\n' "$OUT" | grep -c '^Discord')" "1" "B's deferred row is replaced, not duplicated"
    assert_contains "$OUT" "from 3 children" "three children counted"
}

test_deferred_without_c_fails() {
    _parent; _child a succeeded "${A_ROWS[@]}"
    DEFER=1 _child b succeeded "Playwright (desktop + mobile)|PASS|" "Discord smoke (companion bot)|SKIPPED|deferred to phase 2"; _merge
    assert_exit_code "$RC" "1" "expected C never ran -> exit 1"
    assert_contains "$(_row 'Discord')" "FAIL — missing from child ${P}c" "deferred row does not stand when C was expected"
}

test_child_failed_without_fail_row() {
    _parent; _child a failed "${A_ROWS[@]}"; _child b succeeded "${B_PASS[@]}"; _merge
    assert_exit_code "$RC" "1" "a child that failed (e.g. killed) fails the merge even with all-PASS rows"
}

test_serial_fallback_passthrough() {
    _parent; echo "[parallel] fallback: serial (no free slot)" > "$RL_TASKS_DIR/$P.log"; _merge
    assert_exit_code "$RC" "0" "serial fallback passes through"
    assert_eq "$OUT" "" "no merged table on a serial run"
}

run_test "both-pass" test_both_pass
run_test "b-missing-playwright" test_b_missing_playwright
run_test "a-fail-b-pass" test_a_fail_b_pass
run_test "deferred-discord-replaced-by-c" test_deferred_discord_replaced_by_c
run_test "deferred-without-c-fails" test_deferred_without_c_fails
run_test "child-failed-without-fail-row" test_child_failed_without_fail_row
run_test "serial-fallback-passthrough" test_serial_fallback_passthrough

print_test_summary
