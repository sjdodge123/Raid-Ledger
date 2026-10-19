#!/usr/bin/env bash
# ROK-1793 S2 — validate-ci.sh child modes for the parallel fleet gate.
#
# The parallel gate (rl_validate_ci parallel:true) splits one --fleet run into
# children: A (slot A) runs build/tsc/lint/unit/integration with e2e off; B (a
# borrowed slot) runs Playwright; C (slot A, after B) runs the Discord smoke —
# Discord stays serial on the owning slot's bot identity (operator ruling Q6).
# The orchestrator merges the three Summary blocks by row ownership, so each
# child must print the rows it does NOT own as SKIPPED with a note naming where
# the real verdict lives, and B must announce when it deferred Discord.
#
# Contract asserted here:
#   D1 RL_GATE_DISCORD=defer: when the Discord smoke WOULD have run, its row is
#      `SKIPPED — deferred to phase 2`, `[parallel] discord-deferred` is printed
#      exactly once, and the smoke never runs. Playwright still runs.
#   D2 defer when Discord is out of scope (e2e off): no marker, no deferred note.
#   O1 RL_GATE_DISCORD=only (with --only-e2e): Playwright never runs, its row is
#      `SKIPPED — phase 2`; the Discord smoke runs and reports PASS.
#   O2 only without --only-e2e, or an unknown value, exits 2 (invocation error).
#   F1 --fleet-e2e runs Playwright under --only-e2e; without --only-e2e it exits 2.
#   F1b --fleet-e2e forces e2e on: a down env FAILs the Playwright row (auto
#      mode SKIPs it), so the flag cannot silently degrade to auto.
#   A1 RL_GATE_E2E=deferred with --fleet --no-e2e: the Playwright and Discord
#      rows read `SKIPPED — phase 1, see child b`; every other row is present.
#   A2 plain --fleet --no-e2e still prints both e2e rows SKIPPED (ROK-1565
#      completeness) without the phase note; RL_GATE_E2E without --no-e2e = 2.
#
# Harness: npm/npx/docker/curl are stubbed (argv recorded); git passes through
# except `fetch`. No real suite, container or HTTP request runs.

set -uo pipefail

CURRENT_TEST_FILE="validate-ci-gate-discord.test.sh"
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

# Output is colour-stripped once per invoke; helpers read it via here-strings
# (never `printf | grep -q`, which EPIPEs under pipefail on large output).
assert_out_matches() {
    if grep -E -q -e "$1" <<<"$INVOKE_OUT"; then pass; else
        fail "$2: output did not match '$1'"
    fi
}
assert_out_absent() {
    if grep -E -q -e "$1" <<<"$INVOKE_OUT"; then fail "$2: output must NOT match '$1'"; else pass; fi
}
assert_out_count() {
    local actual
    actual=$(grep -c -E -e "$1" <<<"$INVOKE_OUT" || true)
    if [ "$actual" -eq "$2" ]; then pass; else fail "$3: expected $2 match(es) of '$1', got $actual"; fi
}
assert_file_matches() {
    if grep -E -q -e "$1" "$2"; then pass; else fail "$3: '$1' not in $(tr '\n' '|' <"$2")"; fi
}
assert_file_absent() {
    if grep -E -q -e "$1" "$2"; then fail "$3: '$1' must NOT appear ($(tr '\n' '|' <"$2"))"; else pass; fi
}
assert_rc() {
    if [ "$INVOKE_RC" -eq "$1" ]; then pass; else
        fail "$2: expected exit $1, got $INVOKE_RC ($(tail -3 <<<"$INVOKE_OUT" | tr '\n' '|'))"
    fi
}

make_stub_bin() {
    local d
    d=$(mktemp -d -t rl-gate-discord-stub.XXXXXX)
    printf '#!/usr/bin/env bash\n[[ "$1" == exec && "$*" == *"redis-cli ping"* ]] && echo PONG\nexit 0\n' >"$d/docker"
    printf '#!/usr/bin/env bash\necho "$*" >>"$STUB_NPM_ARGV_FILE"\nexit 0\n' >"$d/npm"
    printf '#!/usr/bin/env bash\necho "$*" >>"$STUB_NPX_ARGV_FILE"\nexit 0\n' >"$d/npx"
    # STUB_ENV_DOWN=1: the health probe fails (the env is not responding).
    printf '#!/usr/bin/env bash\n[[ "${STUB_ENV_DOWN:-0}" == 1 ]] && exit 7\n[[ "$*" == *"/health"* ]] && echo %s\nexit 0\n' "'{\"status\":\"ok\"}'" >"$d/curl"
    printf '#!/usr/bin/env bash\n[[ "${1:-}" == fetch ]] && exit 0\nexec "$REAL_GIT" "$@"\n' >"$d/git"
    # The bundle checker reads a web/dist the stubbed build never produced.
    cat >"$d/node" <<EOF
#!/usr/bin/env bash
[[ "\${1:-}" == *check-bundle-size.mjs ]] && exit 0
exec "$(command -v node)" "\$@"
EOF
    chmod +x "$d"/*
    echo "$d"
}

stub_bin=$(make_stub_bin)
npx_argv_file=$(mktemp -t rl-gate-discord-npx.XXXXXX)
npm_argv_file=$(mktemp -t rl-gate-discord-npm.XXXXXX)
perf_log=$(mktemp -t rl-gate-discord-perf.XXXXXX)
trap 'rm -rf "$stub_bin" "$npx_argv_file" "$npm_argv_file" "$perf_log" "${perf_log}.errors"' EXIT

INVOKE_OUT=""
INVOKE_RC=0
# Hermetic on a fleet runner (Codex r6 P2): /workspace exists there and the
# runner's RL_SLOT is inherited, so a "local" invoke would reach
# _check_state_locks_mount and exit 98 on /nonexistent-lock-dir before the
# mocked smoke runs. Strip every inherited RL_* that routes to the runner path
# (and RL_VALIDATE_CI_DRY, which would turn the run into a source-only dry run).
# The inherited Playwright/Discord selectors change routing too: E2E_SPECS with
# --no-e2e exits 2, and E2E_SCOPE / SMOKE_CHANNEL_SET re-scope the tiers.
RUNNER_ENV_UNSET=(-u RL_SLOT -u RL_SLOT_DISCORD_CLIENT_ID -u RL_DISCORD_LOCK_ALWAYS -u RL_TASK_ID
    -u RL_TEST_REDIS_CNAME -u RL_WORKSPACE_ROOT -u RL_VALIDATE_CI_DRY
    -u E2E_SPECS -u E2E_SCOPE -u SMOKE_CHANNEL_SET)

# invoke <RL_GATE_DISCORD> <RL_GATE_E2E> -- <validate-ci flags...>
# Companion-bot credentials are fake but present, so the Discord tier is in
# scope whenever e2e is on (it would otherwise SKIP for a missing .env).
invoke() {
    local gate_discord="$1" gate_e2e="$2"; shift 2
    : >"$npx_argv_file"; : >"$npm_argv_file"
    INVOKE_RC=0
    INVOKE_OUT=$(
        PATH="$stub_bin:$PATH" REAL_GIT="$REAL_GIT" \
        RL_TARGET=local RL_TARGET_DISPATCHED=1 BASE_URL="$ENV_URL" \
        RL_GATE_DISCORD="$gate_discord" RL_GATE_E2E="$gate_e2e" \
        TEST_BOT_TOKEN=fake-token TEST_GUILD_ID=fake-guild \
        PERF_LOG_LOCAL="$perf_log" \
        STUB_NPX_ARGV_FILE="$npx_argv_file" STUB_NPM_ARGV_FILE="$npm_argv_file" \
        RL_DISCORD_LOCK_DIR=/nonexistent-lock-dir RL_DEPS_RUNNER_ROOT=/nonexistent-runner-root \
        env "${RUNNER_ENV_UNSET[@]}" bash "$VALIDATE_CI_PATH" "$@" 2>&1
    ) || INVOKE_RC=$?
    INVOKE_OUT=$(sed $'s/\033\\[[0-9;]*m//g' <<<"$INVOKE_OUT")
}

PW_ROW='^Playwright \(desktop \+ mobile[^)]*\) +'
DC_ROW='^Discord smoke \(companion bot\) +'

# ===== D1/D2: RL_GATE_DISCORD=defer (child B) =====

CURRENT_TEST_NAME="D1: defer stamps the in-scope Discord row and prints the marker once"
invoke defer "" --only-e2e --with-e2e
assert_rc 0 "defer --only-e2e --with-e2e"
assert_out_count '^\[parallel\] discord-deferred$' 1 "marker printed exactly once"
assert_out_matches "${DC_ROW}SKIPPED — deferred to phase 2$" "Discord summary row"
assert_out_matches "${PW_ROW}PASS$" "Playwright still runs and PASSes on child B"
assert_file_matches 'playwright test' "$npx_argv_file" "child B runs Playwright"
assert_file_absent 'run smoke' "$npm_argv_file" "child B never runs the Discord smoke"

CURRENT_TEST_NAME="D2: defer with Discord out of scope prints no marker"
invoke defer "" --only-e2e --no-e2e
assert_rc 2 "--only-e2e + --no-e2e stays an invocation error under defer"
invoke defer "" --fleet --no-e2e
assert_rc 0 "defer --fleet --no-e2e"
assert_out_absent 'discord-deferred' "no marker when the smoke would not have run"
assert_out_absent 'deferred to phase 2' "no deferred note when out of scope"
assert_out_matches "${DC_ROW}SKIPPED" "Discord row still present"

# ===== O1/O2: RL_GATE_DISCORD=only (phase-2 child C) =====

CURRENT_TEST_NAME="O1: only runs the Discord smoke and stamps Playwright phase 2"
invoke only "" --only-e2e --with-e2e
assert_rc 0 "only --only-e2e --with-e2e"
assert_file_absent 'playwright' "$npx_argv_file" "child C never runs Playwright"
assert_file_matches 'run smoke' "$npm_argv_file" "child C runs the Discord smoke"
assert_out_matches "${PW_ROW}SKIPPED — phase 2$" "Playwright summary row"
assert_out_matches "${DC_ROW}PASS$" "Discord summary row"
assert_out_absent 'discord-deferred' "child C never prints the defer marker"

CURRENT_TEST_NAME="O2: only without --only-e2e, or an unknown value, is an invocation error"
invoke only "" --fleet
assert_rc 2 "only + --fleet"
assert_out_matches 'RL_GATE_DISCORD=only requires --only-e2e' "names the missing flag"
invoke sometimes "" --only-e2e
assert_rc 2 "unknown RL_GATE_DISCORD value"
assert_out_matches 'RL_GATE_DISCORD must be' "names the accepted values"

# ===== F1: --fleet-e2e (children B/C force e2e on, as serial --fleet does) =====

CURRENT_TEST_NAME="F1: --fleet-e2e runs Playwright under --only-e2e and is refused without it"
invoke defer "" --only-e2e --fleet-e2e
assert_rc 0 "defer --only-e2e --fleet-e2e"
assert_file_matches 'playwright' "$npx_argv_file" "child B runs Playwright with e2e forced on"

CURRENT_TEST_NAME="F1b: --fleet-e2e forces e2e on — a down env FAILs the Playwright row where auto would SKIP it"
STUB_ENV_DOWN=1 invoke "" "" --only-e2e
assert_out_matches "${PW_ROW}SKIPPED$" "control: auto mode skips Playwright on a down env"
STUB_ENV_DOWN=1 invoke defer "" --only-e2e --fleet-e2e
assert_out_matches "${PW_ROW}FAIL" "--fleet-e2e: the Playwright row is FAIL, never SKIPPED"
assert_out_absent "${PW_ROW}SKIPPED" "--fleet-e2e never skips Playwright for a down env"
if [ "$INVOKE_RC" -ne 0 ]; then pass; else fail "--fleet-e2e on a down env must exit non-zero"; fi

CURRENT_TEST_NAME="F1: --fleet-e2e is refused without --only-e2e"
invoke "" "" --fleet-e2e
assert_rc 2 "--fleet-e2e without --only-e2e"
assert_out_matches 'is only valid together with --only-e2e' "names the missing flag"

# ===== A1/A2: child A (--fleet --no-e2e) =====

CURRENT_TEST_NAME="A1: RL_GATE_E2E=deferred stamps both e2e rows phase 1"
invoke "" deferred --fleet --no-e2e
assert_rc 0 "--fleet --no-e2e with RL_GATE_E2E=deferred"
assert_out_matches "${PW_ROW}SKIPPED — phase 1, see child b$" "Playwright summary row"
assert_out_matches "${DC_ROW}SKIPPED — phase 1, see child b$" "Discord summary row"
for row in 'Build \(all workspaces\)' 'TypeScript \(all\)' 'Lint \(all\)' 'Integration tests \(api\)' \
    'Migration validation' 'Container startup'; do
    assert_out_matches "^${row} +(PASS|SKIPPED)" "child A keeps the ${row} row"
done
assert_file_absent 'playwright' "$npx_argv_file" "child A never runs Playwright"

CURRENT_TEST_NAME="A2: plain --fleet --no-e2e prints complete e2e rows without the phase note"
invoke "" "" --fleet --no-e2e
assert_rc 0 "--fleet --no-e2e"
assert_out_matches "${PW_ROW}SKIPPED$" "Playwright row present, no note"
assert_out_matches "${DC_ROW}SKIPPED$" "Discord row present, no note"
invoke "" deferred --fleet
assert_rc 2 "RL_GATE_E2E=deferred without --no-e2e"
assert_out_matches 'RL_GATE_E2E=deferred requires --no-e2e' "names the missing flag"

echo
echo "--- $CURRENT_TEST_FILE: $TEST_PASS_COUNT pass, $TEST_FAIL_COUNT fail ---"
if (( TEST_FAIL_COUNT > 0 )); then
    for f in "${TEST_FAIL_NAMES[@]}"; do echo "  - $f"; done
    exit 1
fi
exit 0
