#!/usr/bin/env bash
# ROK-2280 — fleet runners get the companion-bot creds from the VM, but ONLY
# for an rl_validate_ci run whose validate-ci.sh args select the Discord tier.
#
# The wrapper (run-on-runner-with-heartbeat) reads RL_TEST_BOT_TOKEN /
# RL_DISCORD_TEST_GUILD_ID (sourced from /srv/rl-infra/.env by _state.sh) and
# forwards them as TEST_BOT_TOKEN / TEST_GUILD_ID with `docker exec -e NAME`
# (name only, ROK-1846 c6) so the value never lands in the exec's Cmd, the
# audit log or the task log.
#
# Cases:
#   D1 — rl_validate_ci + --only-e2e: `-e TEST_BOT_TOKEN -e TEST_GUILD_ID` by
#        name, the value absent from argv and present in the exec's env.
#   D2 — --with-e2e, --fleet, bare args, RL_GATE_DISCORD=only → injected.
#   D3 — --scoped, --static, --no-e2e, --only-unit, --only-integration,
#        RL_GATE_DISCORD=defer → nothing TEST_* forwarded.
#   D4 — RL_TASK_TOOL=rl_run_on_runner → not injected even for --only-e2e.
#   D5 — a missing VM key is named on stdout; neither var is forwarded.
#   D6 — the value appears nowhere in the wrapper's output or $RL_STATE_DIR.
#
# Technique: `docker` is stubbed on PATH. The shim records its argv, and — for
# the caller's command — the environment it inherited, then exits 0. Nothing
# runs; only the container boundary is observed. The sentinel is obviously fake.

set -uo pipefail

CURRENT_TEST_FILE="run-on-runner-discord-creds.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

RUN_WITH_HEARTBEAT="$BIN_DIR/run-on-runner-with-heartbeat"
readonly SENTINEL_TOKEN="sentinel-tok-XYZ"
readonly SENTINEL_GUILD="123"

_install_fake_docker() {
    FAKE_BIN=$(mktemp -d -t rl-fake-bin.XXXXXX)
    ARGV_LOG="$FAKE_BIN/argv.log"
    ENV_LOG="$FAKE_BIN/env.log"
    : > "$ARGV_LOG"
    : > "$ENV_LOG"
    {
        printf '#!/usr/bin/env bash\n'
        printf 'ARGV_LOG=%q\nENV_LOG=%q\n' "$ARGV_LOG" "$ENV_LOG"
        cat <<'SHIM'
{ printf '%s' "$*" | tr '\n' ' '; printf '\n'; } >> "$ARGV_LOG"
[[ "$*" == *validate-ci.sh* ]] && env >> "$ENV_LOG"
exit 0
SHIM
    } > "$FAKE_BIN/docker"
    chmod +x "$FAKE_BIN/docker"
}

_remove_fake_docker() {
    [[ -n "${FAKE_BIN:-}" && -d "$FAKE_BIN" ]] && rm -rf "$FAKE_BIN"
    unset FAKE_BIN
}

# _run <tool> <inner validate-ci args...> — dispatch the production command
# shape (`bash -c "…bash /workspace/scripts/validate-ci.sh <args>"`) through the
# wrapper. Sets OUT (stdout+stderr), ARGV, ENVDUMP.
_run() {
    local tool="$1"; shift
    local inner="$*"
    _install_fake_docker
    # Output goes to a FILE, not a $(…) pipe: the heartbeat loop's orphaned
    # `sleep` would hold a pipe open for the whole interval after exit.
    RL_TASK_TOOL="$tool" RL_SKIP_EXEC_BITS=1 PATH="$FAKE_BIN:$PATH" \
        bash "$RUN_WITH_HEARTBEAT" --heartbeat-interval=30 -- \
        bash -c "$inner" > "$FAKE_BIN/out.log" 2>&1
    OUT=$(cat "$FAKE_BIN/out.log")
    ARGV=$(cat "$ARGV_LOG")
    ENVDUMP=$(cat "$ENV_LOG")
    _remove_fake_docker
}

_with_creds() {
    export RL_TEST_BOT_TOKEN="$SENTINEL_TOKEN"
    export RL_DISCORD_TEST_GUILD_ID="$SENTINEL_GUILD"
}

_without_creds() { unset RL_TEST_BOT_TOKEN RL_DISCORD_TEST_GUILD_ID; }

# _env_has <exact KEY=value line> — yes/no. Never echoes the dump: it is the
# test process's whole environment, which must not land in a failure message.
_env_has() { grep -qxF -- "$1" <<<"$ENVDUMP" && echo yes || echo no; }

_assert_injected() {
    local label="$1"
    assert_contains "$ARGV" "-e TEST_BOT_TOKEN " "$label: argv must forward TEST_BOT_TOKEN by name"
    assert_contains "$ARGV" "-e TEST_GUILD_ID " "$label: argv must forward TEST_GUILD_ID by name"
    if [[ "$ARGV" == *"$SENTINEL_TOKEN"* || "$ARGV" == *"TEST_BOT_TOKEN="* ]]; then
        assert_eq "value in argv" "name only" "$label: the token value must never reach docker's argv (exec_create events carry Cmd verbatim)"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    assert_eq "$(_env_has "TEST_BOT_TOKEN=$SENTINEL_TOKEN")" "yes" "$label: TEST_BOT_TOKEN must be exported in the wrapper's process so -e NAME copies it"
    assert_eq "$(_env_has "TEST_GUILD_ID=$SENTINEL_GUILD")" "yes" "$label: TEST_GUILD_ID must be exported in the wrapper's process"
}

_assert_not_injected() {
    local label="$1" leaked=""
    [[ "$ARGV" == *"TEST_BOT_TOKEN"* || "$ARGV" == *"TEST_GUILD_ID"* ]] && leaked="argv: $ARGV"
    grep -qE '^TEST_(BOT_TOKEN|GUILD_ID)=' <<<"$ENVDUMP" && leaked="${leaked} env: TEST_* exported"
    assert_eq "${leaked:-none}" "none" "$label: a non-Discord-tier run must forward no companion-bot credential"
    assert_contains "$ARGV" "validate-ci.sh" "$label: precondition — the caller's command was dispatched"
}

test_d1_only_e2e_forwards_by_name() {
    CURRENT_TEST_NAME="D1: rl_validate_ci --only-e2e forwards TEST_* by name only"
    _with_creds
    _run rl_validate_ci "bash /workspace/scripts/validate-ci.sh '--only-e2e'"
    _assert_injected "D1"
}

test_d2_discord_tier_args_inject() {
    CURRENT_TEST_NAME="D2: Discord-tier arg shapes inject"
    _with_creds
    local args
    for args in "'--with-e2e'" "'--fleet'" "'--fleet-e2e'" "" "'--full'"; do
        _run rl_validate_ci "bash /workspace/scripts/validate-ci.sh $args"
        _assert_injected "D2 [${args:-bare}]"
    done
    _run rl_validate_ci "RL_GATE_DISCORD=only bash /workspace/scripts/validate-ci.sh '--only-e2e' '--with-e2e'"
    _assert_injected "D2 [RL_GATE_DISCORD=only]"
}

test_d3_non_discord_args_never_inject() {
    CURRENT_TEST_NAME="D3: non-Discord tiers never inject (exclusions win)"
    _with_creds
    local args
    for args in "'--scoped'" "'--static'" "'--fleet' '--no-e2e'" "'--only-unit'" \
        "'--only-integration'" "'--only-e2e' '--scoped'"; do
        _run rl_validate_ci "bash /workspace/scripts/validate-ci.sh $args"
        _assert_not_injected "D3 [$args]"
    done
    _run rl_validate_ci "RL_GATE_DISCORD=defer bash /workspace/scripts/validate-ci.sh '--only-e2e' '--with-e2e'"
    _assert_not_injected "D3 [RL_GATE_DISCORD=defer]"
}

test_d4_other_tools_never_inject() {
    CURRENT_TEST_NAME="D4: only rl_validate_ci tasks get the creds"
    _with_creds
    _run rl_run_on_runner "bash /workspace/scripts/validate-ci.sh '--only-e2e'"
    _assert_not_injected "D4 [rl_run_on_runner]"
    _run "" "bash /workspace/scripts/validate-ci.sh '--only-e2e'"
    _assert_not_injected "D4 [no RL_TASK_TOOL]"
}

test_d5_missing_key_is_named_and_nothing_forwarded() {
    CURRENT_TEST_NAME="D5: a missing VM key is named; neither var forwarded"
    _with_creds
    unset RL_TEST_BOT_TOKEN
    _run rl_validate_ci "bash /workspace/scripts/validate-ci.sh '--only-e2e'"
    assert_contains "$OUT" "[discord-creds] RL_TEST_BOT_TOKEN unset in /srv/rl-infra/.env — Discord smoke will SKIP (rl-infra/SETUP.md §3.2)" \
        "D5: a missing token must be named on stdout so the SKIP is explainable"
    _assert_not_injected "D5 [token unset]"

    _with_creds
    export RL_DISCORD_TEST_GUILD_ID=$' \r'
    _run rl_validate_ci "bash /workspace/scripts/validate-ci.sh '--only-e2e'"
    assert_contains "$OUT" "[discord-creds] RL_DISCORD_TEST_GUILD_ID unset" \
        "D5: a whitespace-only guild id counts as unset"
    _assert_not_injected "D5 [guild blank]"

    _without_creds
    _run rl_validate_ci "bash /workspace/scripts/validate-ci.sh '--only-e2e'"
    assert_contains "$OUT" "[discord-creds] RL_TEST_BOT_TOKEN, RL_DISCORD_TEST_GUILD_ID unset" \
        "D5: both missing keys are named on one line"
    _assert_not_injected "D5 [both unset]"
}

test_d6_value_never_logged() {
    CURRENT_TEST_NAME="D6: the token value never reaches output or state"
    export RL_TEST_BOT_TOKEN=$'  '"$SENTINEL_TOKEN"$'\r\n'
    export RL_DISCORD_TEST_GUILD_ID="$SENTINEL_GUILD"
    _run rl_validate_ci "bash /workspace/scripts/validate-ci.sh '--only-e2e'"
    assert_eq "$(_env_has "TEST_BOT_TOKEN=$SENTINEL_TOKEN")" "yes" \
        "D6: the forwarded token must be trimmed of whitespace and CR (exact line match)"
    local hits
    hits=$( { printf '%s' "$OUT" | grep -c "$SENTINEL_TOKEN"; grep -rl "$SENTINEL_TOKEN" "$RL_STATE_DIR" 2>/dev/null; } | tr '\n' ' ')
    assert_eq "$hits" "0 " "D6: the token must appear in neither the wrapper's stdout/stderr nor any file under RL_STATE_DIR (audit log)"
}

_cleanup_creds() { _without_creds; }

run_test "D1 only-e2e forwards by name"        test_d1_only_e2e_forwards_by_name;            _cleanup_creds
run_test "D2 discord-tier args inject"         test_d2_discord_tier_args_inject;             _cleanup_creds
run_test "D3 non-discord args never inject"    test_d3_non_discord_args_never_inject;        _cleanup_creds
run_test "D4 other tools never inject"         test_d4_other_tools_never_inject;             _cleanup_creds
run_test "D5 missing key named"                test_d5_missing_key_is_named_and_nothing_forwarded; _cleanup_creds
run_test "D6 value never logged"               test_d6_value_never_logged;                   _cleanup_creds

print_test_summary
