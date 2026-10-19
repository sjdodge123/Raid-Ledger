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
export OPERATOR_INFRA="$WORKTREE_ROOT/rl-infra"
export RL_INFRA_SELF_DIR="$OPERATOR_INFRA"
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
        echo '    if [[ "$*" == *--template* ]]; then'
        echo '      if grep -q "^CALL sync create" "$MUTAGEN_LOG"; then echo 2'
        echo '      elif [[ -n "${MUTAGEN_LABEL_VALUE:-}" ]]; then echo "$MUTAGEN_LABEL_VALUE"; fi'
        echo '    elif [[ -z "${3:-}" ]]; then'
        echo '      [[ "${MUTAGEN_HAS_SESSION:-0}" == 1 ]] && echo "Name: rl-slot-3"'
        echo '    else printf "Alpha:\n\tURL: /tmp/fake-repo\n"; fi'
        echo '  fi'
        echo '  return 0'
        echo '}'
        # ssh_run: logs argv plus WHICH operator script arrived on stdin (by
        # byte-comparison with the CLI checkout's copy), so tests prove the
        # purge is the CLI's own script and never a /workspace path.
        echo 'ssh_run() {'
        echo '  local in name=none; in=$(cat)'
        echo '  [[ "$in" == "$(cat "$OPERATOR_INFRA/runner/purge-synced-secrets.sh")" ]] && name=purge'
        echo '  [[ "$in" == "$(cat "$OPERATOR_INFRA/runner/restore-exec-bits.sh")" ]] && name=restore'
        echo '  printf "%s [stdin=%s]\n" "$*" "$name" >> "$ARGV_LOG"'
        echo '  case "$name" in purge) return "${PURGE_RC:-0}" ;; esac'
        echo '  return 0'
        echo '}'
        echo 'require_repo_root() { :; }'
        echo 'lookup_held_slot() { echo 3; }'
        echo 'stop_mutagen_sync() { echo "CALL stop" >> "$MUTAGEN_LOG"; }'
        echo 'scaffold_runner_git() { :; }'
        echo 'git() { echo main; }'
        echo 'TARGET=remote'
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
    write_driver "$TMP_STATE/driver.sh" 'ensure_mutagen_sync 3' ensure_mutagen_sync mutagen_session_config_version
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
    assert_arg "$args" "--ignore=!**/.env.*.example" "the tracked .env.*.example templates must still sync"
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

assert_recreated() {
    local log
    log=$(cat "$MUTAGEN_LOG")
    assert_contains "$log" "CALL sync terminate" \
        "$1 must be terminated — ignores are fixed at create time"
    assert_contains "$log" "CALL sync create" "$1 must be recreated with the new ignores"
    assert_eq "$(create_argv | grep -A1 -Fx -- "--label" | tail -1)" "rl-sync-config=2" \
        "the new session must be stamped with the current config label"
    assert_contains "$log" '{{index .Labels "rl-sync-config"}}' \
        "the reuse check must read the session's own rl-sync-config label"
}

test_s3_stale_session_is_recreated() {
    MUTAGEN_HAS_SESSION=1 MUTAGEN_LABEL_VALUE="" run_ensure
    assert_recreated "a session with NO rl-sync-config label (pre-ROK-1849)"
}

test_s3b_older_label_is_recreated() {
    MUTAGEN_HAS_SESSION=1 MUTAGEN_LABEL_VALUE="1" run_ensure
    assert_recreated "a session labelled rl-sync-config=1"
    MUTAGEN_HAS_SESSION=1 MUTAGEN_LABEL_VALUE="junk" run_ensure
    assert_recreated "a session with a non-numeric rl-sync-config label"
}

test_s4_current_session_is_reused() {
    MUTAGEN_HAS_SESSION=1 MUTAGEN_LABEL_VALUE=2 run_ensure
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
    write_driver "$TMP_STATE/driver.sh" 'flush_mutagen 3' \
        flush_mutagen purge_runner_synced_secrets restore_runner_exec_bits run_operator_script_on_runner rl_infra_self_dir
    local out rc=0
    out=$(PURGE_RC=1 bash "$TMP_STATE/driver.sh" 2>&1) || rc=$?
    local log
    log=$(cat "$ARGV_LOG")
    assert_eq "$(head -1 <<<"$log")" "run-on-runner -- bash -s -- /workspace [stdin=purge]" \
        "the FIRST thing run in the runner must be the CLI checkout's own purge script, streamed over stdin"
    assert_eq "$(sed -n 2p <<<"$log")" "run-on-runner -- bash -s -- /workspace [stdin=restore]" \
        "the exec-bit repair must also be the CLI's own copy, after the purge"
    if [[ "$log" == */workspace/rl-infra* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: branch script executed")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] nothing may be executed from the synced /workspace/rl-infra (branch content)"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    assert_exit_code "$rc" 0 "a failed purge must not fail the claim/validate-ci flush"
    assert_contains "$out" "secret purge" "a failed purge must be named on stderr"
}

# S7 — the operator script path is derived from the running CLI file itself
# (through a symlink), never from /workspace.
test_s7_self_dir_is_the_cli_checkout() {
    local fake="$TMP_STATE/opinfra"
    mkdir -p "$fake/cli" "$TMP_STATE/bin"
    { slice_fn rl_infra_self_dir; echo; echo 'unset RL_INFRA_SELF_DIR; rl_infra_self_dir'; } > "$fake/cli/rl"
    ln -sf "$fake/cli/rl" "$TMP_STATE/bin/rl"
    local want got
    want=$(cd -P "$fake" && pwd)
    got=$(bash "$TMP_STATE/bin/rl")
    assert_eq "$got" "$want" "operator scripts must resolve from the rl CLI's own checkout"
    assert_contains "$(head -30 "$PURGE")" "set -euo pipefail" "the purge script must run with set -euo pipefail"
}

# S8/S9 — cmd_resync goes through the same ensure+purge path as cmd_claim.
reset_logs() {
    export MUTAGEN_LOG="$TMP_STATE/mutagen.log" ARGV_LOG="$TMP_STATE/argv.log"
    : > "$MUTAGEN_LOG"; : > "$ARGV_LOG"
}

# Caller runs reset_logs first (run_resync is called inside $(...)).
run_resync() {
    write_driver "$TMP_STATE/driver.sh" 'cmd_resync' cmd_resync resync_fail sync_slot_and_purge \
        ensure_mutagen_sync mutagen_session_config_version require_current_sync_config flush_mutagen purge_runner_synced_secrets \
        restore_runner_exec_bits run_operator_script_on_runner rl_infra_self_dir
    bash "$TMP_STATE/driver.sh" 2>/dev/null
}

test_s8_resync_purges() {
    reset_logs
    local out rc=0
    out=$(MUTAGEN_HAS_SESSION=0 run_resync) || rc=$?
    assert_exit_code "$rc" 0 "a healthy resync must succeed"
    assert_contains "$out" '"ok":true' "a healthy resync reports ok"
    assert_contains "$(cat "$ARGV_LOG")" "[stdin=purge]" "rl resync must purge synced secrets after recreating the session"
    assert_contains "$(cat "$MUTAGEN_LOG")" "CALL sync create" "rl resync must recreate the session"
}

test_s9_resync_purge_failure_is_fatal() {
    reset_logs
    local out rc=0
    out=$(MUTAGEN_HAS_SESSION=0 PURGE_RC=1 run_resync) || rc=$?
    assert_neq "$rc" 0 "a resync whose purge failed must not report success"
    assert_contains "$out" "resync_purge_failed" "the failure must be named"
}

test_s10_claim_uses_shared_path() {
    local body
    body=$(slice_fn cmd_claim)
    assert_contains "$body" 'sync_slot_and_purge "$SLOT" ||' "cmd_claim must use the shared ensure+purge path, non-fatally"
    if grep -qE '^[[:space:]]*(ensure_mutagen_sync|flush_mutagen) ' <<<"$body$(slice_fn cmd_resync)"; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: bypass")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] cmd_claim/cmd_resync must not call ensure_mutagen_sync/flush_mutagen directly (bypasses the purge)"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
}

# S11 — Codex r2 P1: `rl validate-ci` on a slot whose live session predates the
# fix recreates it, then the CLI's own purge, then its exec-bit repair, then the
# gate. validate-ci used to flush the old session directly and keep its ignores.
test_s11_validate_recreates_unlabeled_session() {
    reset_logs
    write_driver "$TMP_STATE/driver.sh" 'current_slot() { echo 3; }; ensure_claim() { :; }; cmd_validate_ci --static </dev/null' \
        cmd_validate_ci sync_slot_and_purge ensure_mutagen_sync mutagen_session_config_version \
        require_current_sync_config flush_mutagen purge_runner_synced_secrets restore_runner_exec_bits \
        run_operator_script_on_runner rl_infra_self_dir ensure_runner_git
    local rc=0
    MUTAGEN_HAS_SESSION=1 bash "$TMP_STATE/driver.sh" >/dev/null 2>&1 || rc=$?
    assert_exit_code "$rc" 0 "validate-ci on a recreated, purged session must proceed"
    assert_contains "$(cat "$MUTAGEN_LOG")" "CALL sync create" "validate-ci must recreate a session with no rl-sync-config label"
    local log
    log=$(grep -v 'test -d /workspace/.git' "$ARGV_LOG")
    assert_contains "$(sed -n 1p <<<"$log")" "[stdin=purge]" "first remote command: the CLI's streamed purge"
    assert_contains "$(sed -n 2p <<<"$log")" "[stdin=restore]" "second remote command: the CLI's streamed exec-bit repair"
    assert_contains "$(sed -n 3p <<<"$log")" "validate-ci.sh" "third remote command: the gate itself"
}

# S12 — the guard refuses a session whose label is missing or < 2.
test_s12_guard_refuses_stale_label() {
    reset_logs
    write_driver "$TMP_STATE/driver.sh" 'require_current_sync_config 3 </dev/null' \
        require_current_sync_config mutagen_session_config_version
    local rc=0
    MUTAGEN_LABEL_VALUE=1 bash "$TMP_STATE/driver.sh" >/dev/null 2>&1 || rc=$?
    assert_neq "$rc" 0 "a session labelled rl-sync-config=1 must be refused"
    rc=0
    bash "$TMP_STATE/driver.sh" >/dev/null 2>&1 || rc=$?
    assert_neq "$rc" 0 "an unlabelled session must be refused"
    rc=0
    MUTAGEN_LABEL_VALUE=2 bash "$TMP_STATE/driver.sh" >/dev/null 2>&1 || rc=$?
    assert_exit_code "$rc" 0 "a session labelled rl-sync-config=2 passes"
}

# S13 — static: no branch-controlled runner script is executed, and nothing but
# sync_slot_and_purge flushes (so every flush is ensure + guard first).
test_s13_no_workspace_runner_script_execution() {
    local hits
    hits=$(cat "$RL_CLI" "$WORKTREE_ROOT"/rl-infra/orchestrator/bin/* \
        | sed -e 's/^[[:space:]]*#.*$//' | grep -n '/workspace/rl-infra/runner/' || true)
    assert_eq "$hits" "" "nothing may reference /workspace/rl-infra/runner/*.sh for execution"
    local callers
    callers=$(awk '/^[a-z_]+\(\) *\{/{fn=$1} /^[[:space:]]*[^#]*flush_mutagen "/{print fn}' "$RL_CLI" | sort -u | tr '\n' ' ')
    assert_eq "$callers" "sync_slot_and_purge() " "flush_mutagen may only be called from sync_slot_and_purge"
}

run_test "S1 create ignores .env"        test_s1_create_ignores_env_files
run_test "S2 template drift guard"       test_s2_template_drift_guard
run_test "S3 stale session recreated"    test_s3_stale_session_is_recreated
run_test "S3b older label recreated"     test_s3b_older_label_is_recreated
run_test "S4 current session reused"     test_s4_current_session_is_reused
run_test "S5 purge synced secrets"       test_s5_purge_removes_synced_secrets
run_test "S6 flush runs purge"           test_s6_flush_runs_purge_non_fatally
run_test "S7 self dir is CLI checkout"   test_s7_self_dir_is_the_cli_checkout
run_test "S8 resync purges"              test_s8_resync_purges
run_test "S9 resync purge failure fatal" test_s9_resync_purge_failure_is_fatal
run_test "S10 claim shared path"         test_s10_claim_uses_shared_path
run_test "S11 validate recreates session" test_s11_validate_recreates_unlabeled_session
run_test "S12 guard refuses stale label" test_s12_guard_refuses_stale_label
run_test "S13 no /workspace script exec" test_s13_no_workspace_runner_script_execution

print_test_summary
