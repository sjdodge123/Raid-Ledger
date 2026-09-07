#!/usr/bin/env bash
# ROK-1515 — the gc-sweeper's REAP paths must sweep the shared Discord test
# guild's leaked ⏰ voice channels, not just env-destroy (ROK-1508).
#
# ROK-1508 wired discord_sweep_ephemeral_voice into env-destroy only. Every
# sweeper reap path (dead-claim, hoarded, orphan, unhealthy, TTL) destroys envs
# WITHOUT it, so a reaped env's ⏰ channel outlives its env — which is exactly
# how eight of them accumulated and broke every Discord smoke run.
#
# The orphan path (§1b) is the discriminating case here: the docker shim says
# "no containers exist", so a registry row with no container is the only reap
# that fires, and its slot must be read from the registry BEFORE the row is
# deleted. Cases 2-4 are guards (token containment, best-effort on a 500,
# silent no-op without the mount) — only case 1 fails when the fix is reverted.
#
# Seams: RL_DISCORD_API_BASE (stub host), RL_DISCORD_TEST_GUILD_ID (the guild),
# DISCORD_SWEEP_LIB_DIR (where sweep.sh sources the helpers from — the
# read-only /orchestrator-lib mount in docker-compose.yml).
#
# macOS bash 3.2 compatible.

set -uo pipefail

CURRENT_TEST_FILE="gc-sweeper-ephemeral-sweep.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"
API_BASE="http://discord.invalid/api/v10"
GUILD="g-test"
TOKEN_1="tok-slot-1-supersecret"
TOKEN_2="tok-slot-2-other"

gs_setup() {
    test_setup
    echo "[]" > "$RL_STATE_DIR/claims.json"
    echo "[]" > "$RL_STATE_DIR/queue.json"
    # One registry row whose containers are gone → the orphan reaper (§1b).
    jq -n '[{slug: "goner", slot: 1, created_at: "2026-09-06T00:00:00Z"}]' \
        > "$RL_STATE_DIR/env-registry.json"

    export RL_DISCORD_API_BASE="$API_BASE"
    export RL_DISCORD_TEST_GUILD_ID="$GUILD"
    export SW_CURL_LOG="$RL_STATE_DIR/curl-calls.log"
    export SW_CHANNELS_JSON="$RL_STATE_DIR/channels.json"
    export SW_CURL_RC=0
    export SW_CURL_BODY=""
    : > "$SW_CURL_LOG"
    # Two ⏰ VOICE (must go), one ⏰ TEXT (must stay), one plain voice (must stay).
    jq -n '[{id: "v-1", type: 2, name: "⏰ Valheim — Playing now"},
            {id: "v-2", type: 2, name: "⏰ Deep Rock — Playing now"},
            {id: "t-1", type: 0, name: "⏰ alarm-text"},
            {id: "v-3", type: 2, name: "General"}]' > "$SW_CHANNELS_JSON"

    GS_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$GS_STUB_DIR"
    # Records argv + the stdin config; serves the channel list only for the
    # configured guild. Rejects any form other than `--config -` so a stray
    # probe can never block on stdin.
    cat > "$GS_STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" != "--config -" ]]; then exit 1; fi
printf 'ARGV %s\n' "$*" >> "$SW_CURL_LOG"
cfg=$(cat)
printf 'CONFIG %s\n' "$(printf '%s' "$cfg" | tr '\n' ' ')" >> "$SW_CURL_LOG"
if [[ "$cfg" == *"/guilds/${RL_DISCORD_TEST_GUILD_ID:-}/channels"* ]]; then
    if [[ -n "${SW_CURL_BODY:-}" ]]; then printf '%s' "$SW_CURL_BODY"
    else cat "$SW_CHANNELS_JSON"; fi
fi
exit "${SW_CURL_RC:-0}"
STUB
    chmod +x "$GS_STUB_DIR/curl"
    # No containers exist → only the orphan reaper can fire.
    cat > "$GS_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
    ps) ;;
    inspect) exit 1 ;;
esac
exit 0
STUB
    chmod +x "$GS_STUB_DIR/docker"

    GS_LIB_DIR="$BIN_DIR"
}

gs_teardown() {
    unset RL_DISCORD_API_BASE RL_DISCORD_TEST_GUILD_ID SW_CURL_LOG \
          SW_CHANNELS_JSON SW_CURL_RC SW_CURL_BODY 2>/dev/null || true
    test_teardown
}

# Run one full sweeper cycle against the stubs. Extra args are passed to bash
# (e.g. -x). Two configured slots make "swept with the env's slot" discriminating.
gs_run() {
    PATH="$GS_STUB_DIR:$PATH" \
    STATE_DIR="$RL_STATE_DIR" \
    TASKS_DIR="$RL_TASKS_DIR" \
    TEST_PLANS_DIR="$RL_STATE_DIR/test-plans" \
    ORCHESTRATOR_BIN_DIR="$RL_STATE_DIR/no-such-bin" \
    DISCORD_SWEEP_LIB_DIR="$GS_LIB_DIR" \
    RL_SLOT_1_DISCORD_BOT_TOKEN="$TOKEN_1" \
    RL_SLOT_1_DISCORD_CLIENT_ID="100000000000000001" \
    RL_SLOT_2_DISCORD_BOT_TOKEN="$TOKEN_2" \
    RL_SLOT_2_DISCORD_CLIENT_ID="100000000000000002" \
        bash "$@" "$SWEEP_SCRIPT"
}

gs_log() { cat "$SW_CURL_LOG" 2>/dev/null || true; }
gs_audit() { cat "$RL_STATE_DIR/audit.log" 2>/dev/null || true; }
gs_registry_slugs() { jq -r 'map(.slug) | join(",")' "$RL_STATE_DIR/env-registry.json" 2>/dev/null || echo "UNREADABLE"; }

# How many guild channel-list GETs the sweeper made.
gs_get_count() {
    grep '^CONFIG ' "$SW_CURL_LOG" 2>/dev/null | grep -- '--request GET' \
        | grep -c "url = \"${API_BASE}/guilds/${GUILD}/channels\"" || true
}

# URLs of every DELETE the stub saw.
gs_delete_urls() {
    grep '^CONFIG ' "$SW_CURL_LOG" 2>/dev/null | grep -- '--request DELETE' \
        | sed -n 's/.*url = "\([^"]*\)".*/\1/p'
}

# --- AC1: a reap path sweeps, exactly once, as the env's own slot --------------

test_orphan_reap_sweeps_once_with_slot() {
    CURRENT_TEST_NAME="AC1: the orphan reap sweeps the guild once, as the env's slot"
    gs_setup
    gs_run >/dev/null 2>&1

    assert_eq "$(gs_registry_slugs)" "" \
        "precondition: the orphan reap must have removed goner from the registry (sweep.sh §1b) — registry now: [$(gs_registry_slugs)]"
    assert_eq "$(gs_get_count)" "1" \
        "a sweeper reap must invoke the ⏰ sweep exactly once for the reaped env's slot — guild channel-list GETs seen: [$(gs_get_count)]"
    assert_eq "$(gs_delete_urls | grep -c .)" "2" \
        "exactly the two ⏰ VOICE channels must be DELETEd — deleted: [$(gs_delete_urls | tr '\n' '|')]"
    assert_contains "$(gs_delete_urls)" "${API_BASE}/channels/v-1" \
        "leaked ⏰ voice channel v-1 must be deleted by the reap or it litters the guild until smoke breaks"
    assert_contains "$(gs_delete_urls)" "${API_BASE}/channels/v-2" \
        "leaked ⏰ voice channel v-2 must be deleted by the reap or it litters the guild until smoke breaks"

    # Slot identity: slot 1's bot, never slot 2's.
    assert_contains "$(gs_log)" "Authorization: Bot ${TOKEN_1}" \
        "the sweep must run as the reaped env's own slot bot (slot 1)"
    if [[ "$(gs_log)" == *"$TOKEN_2"* ]]; then
        assert_eq "slot-2-token-used" "slot-1-token-used" \
            "the sweep used the WRONG slot's bot — slot is read from the env's registry row, not guessed"
    else
        assert_eq "slot-1-token-used" "slot-1-token-used" "only the env's own slot bot was used"
    fi

    # The count must be visible in the sweeper's audit log.
    assert_contains "$(gs_audit)" '"outcome":"discord-ephemeral-swept"' \
        "the reap's sweep must leave an audit line in the sweeper's audit.log or the count is invisible to the operator"
    assert_contains "$(gs_audit)" '"slot":1' \
        "the sweeper audit line must name the slot that was swept"
    assert_contains "$(gs_audit)" '"deleted":2' \
        "the sweeper audit line must carry the number of ⏰ channels deleted"
    gs_teardown
}

# --- AC2: the token never leaks ------------------------------------------------

test_token_never_in_argv_or_output() {
    CURRENT_TEST_NAME="AC2: the bot token never reaches argv, output, xtrace or audit"
    gs_setup
    local out="$RL_STATE_DIR/sweep.out" xtrace="$RL_STATE_DIR/sweep.xtrace"
    gs_run >"$out" 2>&1
    # Re-arm the fixture and run the same cycle under xtrace.
    jq -n '[{slug: "goner", slot: 1, created_at: "2026-09-06T00:00:00Z"}]' \
        > "$RL_STATE_DIR/env-registry.json"
    gs_run -x >/dev/null 2>"$xtrace"

    local argv_lines
    argv_lines=$(grep '^ARGV ' "$SW_CURL_LOG" 2>/dev/null || true)
    assert_contains "$argv_lines" "ARGV --config -" \
        "curl must take its whole request from stdin — the sweeper reached Discord through the same secret-safe path env-destroy uses"
    if [[ "$argv_lines" == *"$TOKEN_1"* ]]; then
        assert_eq "token-in-argv" "token-not-in-argv" \
            "the bot token was passed on curl's command line, where \`ps\` on the VM can read it"
    else
        assert_eq "token-not-in-argv" "token-not-in-argv" "token stayed off argv"
    fi
    local where
    for where in "$out" "$xtrace" "$RL_STATE_DIR/audit.log"; do
        if grep -q -- "$TOKEN_1" "$where" 2>/dev/null; then
            assert_eq "token-leaked" "token-contained" \
                "the bot token leaked into $(basename "$where"); it may only travel inside the curl --config stdin pipe under set +x"
        else
            assert_eq "token-contained" "token-contained" "token absent from $(basename "$where")"
        fi
    done
    gs_teardown
}

# --- AC3: a Discord 500 must never fail the reap -------------------------------

test_reap_survives_discord_500() {
    CURRENT_TEST_NAME="AC3: a Discord 500 never fails the reap or the sweeper cycle"
    gs_setup
    export SW_CURL_RC=22
    export SW_CURL_BODY='{"message":"500: Internal Server Error","code":0}'
    local rc
    gs_run >/dev/null 2>&1
    rc=$?
    assert_exit_code "$rc" 0 \
        "a Discord 500 must never fail the sweeper cycle — the ⏰ sweep is best-effort"
    assert_eq "$(gs_registry_slugs)" "" \
        "the reap must still complete when the sweep fails — registry now: [$(gs_registry_slugs)]"
    assert_eq "$(gs_delete_urls | grep -c .)" "0" \
        "an error body is not a channel list — nothing may be DELETEd"
    assert_contains "$(gs_audit)" 'orphan_env_pruned' \
        "the orphan reap must still be audited after a failed sweep"
    assert_contains "$(gs_audit)" '"outcome":"summary"' \
        "the cycle must still reach its §4 summary — a failed sweep must not abort sweep.sh under set -e"
    gs_teardown
}

# --- fresh-deploy fallback: no orchestrator mount → silent no-op ---------------

test_no_lib_dir_is_a_silent_noop() {
    CURRENT_TEST_NAME="without the orchestrator mount the sweeper skips the sweep silently"
    gs_setup
    GS_LIB_DIR="$RL_STATE_DIR/absent"
    local rc
    gs_run >/dev/null 2>&1
    rc=$?
    assert_exit_code "$rc" 0 \
        "a missing helper mount must not fail the sweeper cycle (fresh-deploy fallback)"
    assert_eq "$(wc -l < "$SW_CURL_LOG" | tr -d ' ')" "0" \
        "no helper mount means no Discord call at all — curl saw: [$(gs_log | tr '\n' '|')]"
    assert_eq "$(gs_registry_slugs)" "" \
        "the reap must be unaffected by the missing mount — registry now: [$(gs_registry_slugs)]"
    gs_teardown
}

run_test "orphan-reap-sweeps-once-with-slot" test_orphan_reap_sweeps_once_with_slot
run_test "token-never-in-argv-or-output" test_token_never_in_argv_or_output
run_test "reap-survives-discord-500" test_reap_survives_discord_500
run_test "no-lib-dir-is-a-silent-noop" test_no_lib_dir_is_a_silent_noop

print_test_summary
