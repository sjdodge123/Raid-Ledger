#!/usr/bin/env bash
# ROK-1331 M4 — rl-infra/cli/rl source-level checks.
# Covers:
#   AC6 — scaffold idempotency (probe before destructive rm -rf .git).
#   AC7 — scaffold fetch tries the agent's branch first, falls back to main.
#   AC8 — mutagen-session count uses `|| true`, not `|| echo 0`.
#  AC11 — start_heartbeat_daemon runs BEFORE scaffold_runner_git in cmd_claim.

set -uo pipefail

CURRENT_TEST_FILE="cli-rl-scaffold.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
RL_CLI="$WORKTREE_ROOT/rl-infra/cli/rl"

# AC8: line 564 (or its equivalent location) uses `|| true`, not `|| echo 0`.
test_ac8_mutagen_count_uses_or_true() {
    CURRENT_TEST_NAME="AC8: mutagen sync count uses '|| true' not '|| echo 0'"
    if [[ ! -f "$RL_CLI" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: rl CLI not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] rl CLI not found at $RL_CLI"
        return
    fi
    # Find the count= line inside ensure_mutagen_sync. Should NOT contain `|| echo 0`.
    local offending
    offending=$(grep -nE 'mutagen sync list .*grep -c .*\|\| echo 0' "$RL_CLI" || true)
    if [[ -z "$offending" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: '|| echo 0' still present")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] '|| echo 0' still in count= line:"
        echo "$offending"
    fi
    # Affirmative side: should have `|| true` on a `mutagen sync list .*grep -c` line.
    if grep -qE 'mutagen sync list .*grep -c .*\|\| true' "$RL_CLI"; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: '|| true' not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] '|| true' not present on count= line"
    fi
}

# AC11: start_heartbeat_daemon called BEFORE scaffold_runner_git inside cmd_claim.
test_ac11_heartbeat_before_scaffold() {
    CURRENT_TEST_NAME="AC11: start_heartbeat_daemon precedes scaffold_runner_git in cmd_claim"
    if [[ ! -f "$RL_CLI" ]]; then return; fi
    # Slice the cmd_claim function body (up to the next function-opening token).
    local body
    body=$(awk '
        /^cmd_claim\(\)/ {flag=1}
        flag {print}
        flag && /^cmd_[a-z]+\(\)/ && !/^cmd_claim\(\)/ {flag=0}
    ' "$RL_CLI")
    if [[ -z "$body" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: cmd_claim body not located")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] could not slice cmd_claim body"
        return
    fi
    local heartbeat_line scaffold_line
    heartbeat_line=$(echo "$body" | grep -n 'start_heartbeat_daemon' | head -1 | cut -d: -f1)
    scaffold_line=$(echo "$body" | grep -n 'scaffold_runner_git' | head -1 | cut -d: -f1)
    if [[ -z "$heartbeat_line" || -z "$scaffold_line" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: heartbeat or scaffold not found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] heartbeat_line=$heartbeat_line scaffold_line=$scaffold_line"
        return
    fi
    if (( heartbeat_line < scaffold_line )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: heartbeat at line $heartbeat_line, scaffold at $scaffold_line")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] heartbeat ($heartbeat_line) must precede scaffold ($scaffold_line)"
    fi
}

# AC6: scaffold_runner_git contains an idempotency probe before `rm -rf .git`.
# Look for a check that inspects .git/HEAD branch + .git/objects/pack BEFORE
# the destructive remove. Also expect a marker like "scaffold-idempotent" in
# stderr emission for the skip branch (per spec note 5).
test_ac6_scaffold_has_idempotency_probe() {
    CURRENT_TEST_NAME="AC6: scaffold_runner_git probes before rm -rf .git (idempotent skip)"
    if [[ ! -f "$RL_CLI" ]]; then return; fi
    local body
    body=$(awk '
        /^scaffold_runner_git\(\)/ {flag=1}
        flag {print}
        flag && /^}/ {flag=0}
    ' "$RL_CLI")
    if [[ -z "$body" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: scaffold_runner_git body not located")
        return
    fi
    # Probe must include rev-parse / HEAD inspection (any of these tokens).
    local probe_token_found=0
    for token in 'rev-parse' '.git/HEAD' '.git/objects/pack'; do
        if echo "$body" | grep -q "$token"; then
            probe_token_found=1
            break
        fi
    done
    if (( probe_token_found == 1 )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: no idempotency probe token found")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] no idempotency probe (looked for rev-parse / .git/HEAD / .git/objects/pack)"
    fi
    # Spec note 5: stderr marker "scaffold-idempotent" for the skip branch.
    if echo "$body" | grep -q 'scaffold-idempotent'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: 'scaffold-idempotent' stderr marker missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected stderr marker 'scaffold-idempotent' in skip branch"
    fi
}

# AC7: scaffold tries fetch origin <branch> first, falls back to main.
test_ac7_scaffold_branch_fetch_fallback() {
    CURRENT_TEST_NAME="AC7: scaffold tries 'git fetch origin <branch>' before falling back to main"
    if [[ ! -f "$RL_CLI" ]]; then return; fi
    local body
    body=$(awk '
        /^scaffold_runner_git\(\)/ {flag=1}
        flag {print}
        flag && /^}/ {flag=0}
    ' "$RL_CLI")
    # Expect a line that contains both `fetch origin ${quoted_branch}` and a
    # fallback to `fetch origin main`. The exact shape per spec:
    #   git ... fetch origin ${quoted_branch} ... || git ... fetch origin main ...
    if echo "$body" | tr -d '\n' | grep -Eq 'fetch[[:space:]]+origin[[:space:]]+\$?\{?quoted_branch\}?'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: branch-first fetch not present")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected 'fetch origin \${quoted_branch}' in scaffold"
    fi
    # Fallback to main must still exist (the OR-fallback after branch-first).
    if echo "$body" | grep -q 'fetch origin main'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: main fallback missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected fallback 'fetch origin main' to remain"
    fi
    # The two should be chained with `||` (fallback semantics). Probe by
    # joining lines and looking for `quoted_branch.*\|\|.*main`.
    if echo "$body" | tr '\n' ' ' | grep -Eq 'quoted_branch.*\|\|.*main'; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: branch || main fallback chain not detected")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected branch fetch || main fetch fallback chain"
    fi
}

# AC6: behavioral test — simulate the idempotency probe with a fake .git tree.
# If the probe inside scaffold_runner_git is extracted to inspect-able structure,
# this would call it directly. Lacking that, we assert the spec's recipe is
# encoded in the source (the static checks above). This test is a placeholder
# that confirms the probe LOGIC exists, by checking that the source mentions
# both pack and HEAD checks within ~30 lines of each other.
test_ac6_probe_logic_colocated() {
    CURRENT_TEST_NAME="AC6: probe logic for HEAD + pack co-located in scaffold body"
    if [[ ! -f "$RL_CLI" ]]; then return; fi
    local body line_head line_pack
    body=$(awk '
        /^scaffold_runner_git\(\)/ {flag=1}
        flag {print}
        flag && /^}/ {flag=0}
    ' "$RL_CLI")
    line_head=$(echo "$body" | grep -nE 'rev-parse|\.git/HEAD' | head -1 | cut -d: -f1)
    line_pack=$(echo "$body" | grep -nE '\.git/objects/pack' | head -1 | cut -d: -f1)
    if [[ -n "$line_head" && -n "$line_pack" ]]; then
        # Within 30 lines = same probe block.
        local diff=$(( line_head > line_pack ? line_head - line_pack : line_pack - line_head ))
        if (( diff <= 30 )); then
            TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
        else
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: HEAD probe and pack probe more than 30 lines apart")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] probe checks not colocated (HEAD line $line_head, pack line $line_pack)"
        fi
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: HEAD or pack check missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] missing probe — head_line='$line_head' pack_line='$line_pack'"
    fi
}

run_test "ac8-or-true" test_ac8_mutagen_count_uses_or_true
run_test "ac11-heartbeat-before-scaffold" test_ac11_heartbeat_before_scaffold
run_test "ac6-idempotency-probe" test_ac6_scaffold_has_idempotency_probe
run_test "ac7-branch-fetch-fallback" test_ac7_scaffold_branch_fetch_fallback
run_test "ac6-probe-logic" test_ac6_probe_logic_colocated

print_test_summary
