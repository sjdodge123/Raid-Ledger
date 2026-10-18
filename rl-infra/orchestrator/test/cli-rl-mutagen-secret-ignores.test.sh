#!/usr/bin/env bash
# ROK-1849 — the laptop→VM Mutagen session must never carry `.env` secrets.
#
# `ensure_mutagen_sync` used to create the one-way-replica session with no
# `.env` ignore, so root `.env`, `api/.env` and `tools/test-bot/.env` (Discord
# client secret, JWT secret, admin password, Sentry write token, the settings-
# bundle key) landed in /srv/rl-infra/runners/slot-N/worktree at 0644 and were
# readable by any branch code running in the runner as /workspace.
#
#   S1 — the create argv ignores `.env`, `**/.env`, `**/.env.*` and re-includes
#        the tracked `**/.env.example` templates.
#   S2 — drift guard: every `.env` rule in cli/rl is in sync-template.yml and
#        vice versa (the template is the operator's audit copy).
#   S3 — a live session created before the fix (no config label) is terminated
#        and recreated — ignores are baked in at create time, so reusing it
#        would keep syncing secrets forever.
#   S4 — a session already carrying the current config label is reused.
#   S5 — purge-synced-secrets.sh removes already-synced `.env*` files (Mutagen
#        never deletes ignored paths on the beta) and keeps `*.example`,
#        node_modules and .git untouched.
#   S6 — flush_mutagen runs the purge inside the runner via an explicit `bash`,
#        and a purge failure warns without failing the claim.
#
# Technique matches cli-rl-exec-bits-wiring.test.sh: slice the shipped
# functions out of cli/rl and run them against shims.

set -uo pipefail

CURRENT_TEST_FILE="cli-rl-mutagen-secret-ignores.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

WORKTREE_ROOT="$(cd "$TEST_DIR/../../.." && pwd)"
RL_CLI="$WORKTREE_ROOT/rl-infra/cli/rl"
TEMPLATE="$WORKTREE_ROOT/rl-infra/mutagen/sync-template.yml"
PURGE="$WORKTREE_ROOT/rl-infra/runner/purge-synced-secrets.sh"

slice_fn() {
    local fn="$1"
    awk -v fn="^${fn}\\\\(\\\\)" '$0 ~ fn {f=1} f {print} f && /^\}$/ {exit}' "$RL_CLI"
}

# mutagen shim: logs every call as "CALL <subcmd>" followed by one line per
# argument, and answers `sync list` from MUTAGEN_* env knobs.
write_driver() {
    local driver="$1"; shift
    local entry="$1"; shift
    {
        echo 'set -euo pipefail'
        echo 'mutagen() {'
        echo '  { echo "CALL $1 ${2:-}"; printf "  %s\n" "$@"; } >> "$MUTAGEN_LOG"'
        echo '  if [[ "$1 ${2:-}" == "sync list" ]]; then'
        echo '    case "${3:-}" in'
        echo '      "") [[ "${MUTAGEN_HAS_SESSION:-0}" == 1 ]] && echo "Name: rl-slot-3" ;;'
        echo '      --label-selector) [[ "${MUTAGEN_LABEL_MATCH:-0}" == 1 ]] && echo "Name: rl-slot-3" ;;'
        echo '      *) printf "Alpha:\n\tURL: /tmp/fake-repo\n" ;;'
        echo '    esac'
        echo '  fi'
        echo '  return 0'
        echo '}'
        echo 'ssh_run() {'
        echo '  printf "%s\n" "$*" >> "$ARGV_LOG"'
        echo '  case "$*" in *purge-synced-secrets.sh*) return "${PURGE_RC:-0}" ;; esac'
        echo '  return 0'
        echo '}'
        echo 'REPO_ROOT=/tmp/fake-repo'
        echo 'RL_PROXMOX_USER=rl-agent'
        echo 'RL_PROXMOX_HOST=rl-infra'
        local fn
        for fn in "$@"; do slice_fn "$fn"; echo; done
        echo "$entry"
    } > "$driver"
}

run_ensure() {
    export MUTAGEN_LOG="$TMP_STATE/mutagen.log" ARGV_LOG="$TMP_STATE/argv.log"
    : > "$MUTAGEN_LOG"; : > "$ARGV_LOG"
    write_driver "$TMP_STATE/driver.sh" 'ensure_mutagen_sync 3' ensure_mutagen_sync
    bash "$TMP_STATE/driver.sh" >/dev/null 2>&1
}

create_argv() {
    awk '/^CALL /{f=($0 ~ /^CALL sync create/)} f && /^  /{sub(/^  /,""); print}' "$MUTAGEN_LOG"
}

assert_arg() {
    local args="$1" want="$2" msg="$3"
    if grep -Fxq -- "$want" <<<"$args"; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $msg")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $msg"
        echo "  expected argv element: $want"
    fi
}

test_s1_create_ignores_env_files() {
    MUTAGEN_HAS_SESSION=0 run_ensure
    local args
    args=$(create_argv)
    assert_contains "$args" "one-way-replica" "a fresh slot must create the session"
    assert_arg "$args" "--ignore=.env" "the root .env (JWT/Discord/Sentry secrets) must never sync"
    assert_arg "$args" "--ignore=**/.env" "nested .env files (api/.env, tools/test-bot/.env) must never sync"
    assert_arg "$args" "--ignore=**/.env.*" ".env.local / .env.docker / .env.clone variants must never sync"
    assert_arg "$args" "--ignore=!**/.env.example" "the tracked .env.example templates must still sync"
}

env_rules_from_cli() {
    slice_fn ensure_mutagen_sync | grep -oE -- "--ignore='?[^' ]*\.env[^' ]*'?" \
        | sed -E "s/^--ignore=//; s/^'//; s/'$//" | sort -u
}

env_rules_from_template() {
    grep -E '^[[:space:]]*-[[:space:]]+.*\.env' "$TEMPLATE" \
        | sed -E 's/^[[:space:]]*-[[:space:]]+//; s/[[:space:]]+#.*$//; s/^"//; s/"$//' | sort -u
}

test_s2_template_drift_guard() {
    local cli tpl
    cli=$(env_rules_from_cli)
    tpl=$(env_rules_from_template)
    assert_contains "$cli" "**/.env.*" "cli/rl must carry the .env ignores"
    assert_eq "$tpl" "$cli" "sync-template.yml and cli/rl must list the same .env ignore rules"
}

test_s3_stale_session_is_recreated() {
    MUTAGEN_HAS_SESSION=1 MUTAGEN_LABEL_MATCH=0 run_ensure
    local log
    log=$(cat "$MUTAGEN_LOG")
    assert_contains "$log" "CALL sync terminate" \
        "a session created before the .env ignores must be terminated — ignores are fixed at create time"
    assert_contains "$log" "CALL sync create" "the stale session must be recreated with the new ignores"
    local label selector
    label=$(create_argv | grep -A1 -Fx -- "--label" | tail -1)
    selector=$(awk '/^CALL sync list/{f=1;next} /^CALL /{f=0} f' "$MUTAGEN_LOG" \
        | grep -A1 -F -- "--label-selector" | tail -1 | sed 's/^  //')
    assert_contains "$label" "rl-sync-config=" "the new session must carry the config label it is checked against"
    assert_eq "$selector" "$label" "the reuse check must select on exactly the label the create stamps"
}

test_s4_current_session_is_reused() {
    MUTAGEN_HAS_SESSION=1 MUTAGEN_LABEL_MATCH=1 run_ensure
    local log
    log=$(cat "$MUTAGEN_LOG")
    if [[ "$log" == *"CALL sync create"* || "$log" == *"CALL sync terminate"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: current session churned")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] a current session must be reused, not recreated"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
}

test_s5_purge_removes_synced_secrets() {
    assert_file_exists "$PURGE" "the purge script must exist"
    [[ -f "$PURGE" ]] || return 0
    local t="$TMP_STATE/worktree"
    mkdir -p "$t/api" "$t/tools/test-bot" "$t/node_modules/pkg" "$t/.git" "$t/web"
    local f
    for f in .env .env.local .env.docker api/.env tools/test-bot/.env web/.env.production.local \
        .env.example .env.docker.example api/.env.example tools/test-bot/.env.example \
        node_modules/pkg/.env .git/.env api/env.ts; do
        echo x > "$t/$f"
    done
    local rc=0
    bash "$PURGE" "$t" >/dev/null 2>&1 || rc=$?
    assert_exit_code "$rc" 0 "the purge must succeed on a normal tree"
    for f in .env .env.local .env.docker api/.env tools/test-bot/.env web/.env.production.local; do
        assert_file_not_exists "$t/$f" "$f must be purged from the runner worktree"
    done
    for f in .env.example .env.docker.example api/.env.example tools/test-bot/.env.example \
        node_modules/pkg/.env .git/.env api/env.ts; do
        assert_file_exists "$t/$f" "$f must be left alone"
    done
}

test_s6_flush_runs_purge_non_fatally() {
    export MUTAGEN_LOG="$TMP_STATE/mutagen.log" ARGV_LOG="$TMP_STATE/argv.log"
    : > "$MUTAGEN_LOG"; : > "$ARGV_LOG"
    write_driver "$TMP_STATE/driver.sh" 'restore_runner_exec_bits() { :; }; flush_mutagen 3' \
        flush_mutagen purge_runner_synced_secrets
    local out rc=0
    out=$(PURGE_RC=1 bash "$TMP_STATE/driver.sh" 2>&1) || rc=$?
    assert_contains "$(cat "$ARGV_LOG")" "run-on-runner -- bash /workspace/rl-infra/runner/purge-synced-secrets.sh /workspace" \
        "flush_mutagen must purge synced secrets inside the runner with an explicit bash"
    assert_exit_code "$rc" 0 "a failed purge must not fail the claim/validate-ci flush"
    assert_contains "$out" "secret purge" "a failed purge must be named on stderr"
}

run_test "S1 create ignores .env"        test_s1_create_ignores_env_files
run_test "S2 template drift guard"       test_s2_template_drift_guard
run_test "S3 stale session recreated"    test_s3_stale_session_is_recreated
run_test "S4 current session reused"     test_s4_current_session_is_reused
run_test "S5 purge synced secrets"       test_s5_purge_removes_synced_secrets
run_test "S6 flush runs purge"           test_s6_flush_runs_purge_non_fatally

print_test_summary
