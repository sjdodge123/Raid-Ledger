#!/usr/bin/env bash
# ROK-1508 — env-destroy must sweep the shared test guild's ⏰ voice channels.
#
# ROK-1494 now-sessions create `⏰ <game> — Playing now` voice channels via the
# slot app bot; nothing deleted them on destroy, eight accumulated 2026-09-06/07
# and every Discord smoke run broke. The seams: RL_DISCORD_API_BASE points at a
# fake host (the `curl` on PATH is a stub that records argv + stdin config),
# RL_DISCORD_TEST_GUILD_ID names the guild, RL_DISCORD_SWEEP_DISABLED=1 turns
# it off. RL_BOT_DEREGISTER_DISABLED=1 keeps the sibling deregister helper's
# calls out of the log so DELETE counts here are exact.
#
# macOS bash 3.2 compatible.

set -uo pipefail

CURRENT_TEST_FILE="discord-ephemeral-sweep.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ENV_DESTROY_BIN="$BIN_DIR/env-destroy"
API_BASE="http://discord.invalid/api/v10"
GUILD="g-test"
TOKEN="tok-slot-1-supersecret"

sw_setup() {
    test_setup
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_CLAIMS_FILE="$RL_STATE_DIR/claims.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    export RL_TRAEFIK_CONF_D="$RL_STATE_DIR/traefik/conf.d"
    mkdir -p "$RL_TRAEFIK_CONF_D" "$RL_STATE_DIR/bot-identity"
    echo "[]" > "$RL_ENVS_FILE"
    echo "[]" > "$RL_CLAIMS_FILE"

    export RL_DISCORD_API_BASE="$API_BASE"
    export RL_DISCORD_TEST_GUILD_ID="$GUILD"
    export RL_BOT_DEREGISTER_DISABLED=1
    export RL_SLOT_1_DISCORD_BOT_TOKEN="$TOKEN"
    export RL_SLOT_1_DISCORD_CLIENT_ID="100000000000000001"

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

    SW_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$SW_STUB_DIR"
    cat > "$SW_STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
# _state.sh probes the docker socket-proxy with `curl -fsS ... /_ping`; reading
# stdin there would block forever, so only the `--config -` form is handled.
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
    chmod +x "$SW_STUB_DIR/curl"
    # Permissive docker stub — container/volume teardown is not under test.
    cat > "$SW_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
    ps) printf '\n' ;;
    inspect) exit 1 ;;
esac
exit 0
STUB
    chmod +x "$SW_STUB_DIR/docker"
    export PATH="$SW_STUB_DIR:$PATH"

    SW_DRIVER="$RL_STATE_DIR/sweep-driver.sh"
    cat > "$SW_DRIVER" <<STUB
#!/usr/bin/env bash
set -euo pipefail
source "$BIN_DIR/_state.sh"
source "$BIN_DIR/_bot_identity.sh"
source "$BIN_DIR/_discord_sweep.sh"
discord_sweep_ephemeral_voice "\$1" "\${2:-}"
STUB
    chmod +x "$SW_DRIVER"
}

sw_teardown() {
    unset RL_ENVS_FILE RL_CLAIMS_FILE RL_AUDIT_LOG RL_TRAEFIK_CONF_D \
          RL_DISCORD_API_BASE RL_DISCORD_TEST_GUILD_ID RL_DISCORD_SWEEP_DISABLED \
          RL_BOT_DEREGISTER_DISABLED RL_SLOT_1_DISCORD_BOT_TOKEN \
          RL_SLOT_1_DISCORD_CLIENT_ID SW_CURL_LOG SW_CHANNELS_JSON SW_CURL_RC \
          SW_CURL_BODY RL_AGENT_ID 2>/dev/null || true
    test_teardown
}

sw_log() { cat "$SW_CURL_LOG" 2>/dev/null || true; }

# URLs of every DELETE the stub saw.
sw_delete_urls() {
    grep '^CONFIG ' "$SW_CURL_LOG" 2>/dev/null | grep -- '--request DELETE' \
        | sed -n 's/.*url = "\([^"]*\)".*/\1/p'
}

sw_register_goner() {
    export RL_AGENT_ID="sw-agent"
    jq -n '[{slug: "goner", slot: 1, created_at: "2026-09-06T00:00:00Z"}]' \
        > "$RL_ENVS_FILE"
}

# Assert no Discord call happened, and NAME the calls that did.
sw_assert_no_calls() {
    local n
    n=$(wc -l < "$SW_CURL_LOG" 2>/dev/null | tr -d ' ')
    assert_eq "${n:-unreadable}" "0" \
        "$1 — curl was called with: [$(sw_log | tr '\n' '|')]"
}

# Assert the given channel id was NOT deleted.
sw_assert_kept() {
    local cid="$1" why="$2"
    case "$(sw_delete_urls)" in
        *"/channels/${cid}"*) assert_eq "${cid}-deleted" "${cid}-kept" "$why" ;;
        *) assert_eq "kept" "kept" "$why" ;;
    esac
}

# --- AC1: only ⏰ VOICE channels are deleted ------------------------------------

test_sweep_deletes_only_clock_voice() {
    CURRENT_TEST_NAME="AC1: exactly the ⏰ VOICE channels are DELETEd"
    sw_setup
    bash "$SW_DRIVER" 1 goner >/dev/null 2>&1
    assert_contains "$(sw_log)" "url = \"${API_BASE}/guilds/${GUILD}/channels\"" \
        "the channel list must be fetched from the configured test guild"
    assert_contains "$(sw_log)" '--request GET' \
        "the channel list is a GET"
    assert_eq "$(sw_delete_urls | grep -c .)" "2" \
        "exactly the two ⏰ VOICE channels must be DELETEd — deleted: [$(sw_delete_urls | tr '\n' '|')]"
    assert_contains "$(sw_delete_urls)" "${API_BASE}/channels/v-1" \
        "leaked ⏰ voice channel v-1 must be deleted or it litters the guild until smoke breaks"
    assert_contains "$(sw_delete_urls)" "${API_BASE}/channels/v-2" \
        "leaked ⏰ voice channel v-2 must be deleted or it litters the guild until smoke breaks"
    sw_assert_kept "t-1" "a ⏰ TEXT channel (type 0) must never be deleted"
    sw_assert_kept "v-3" "a plain voice channel without the ⏰ prefix must never be deleted"
    sw_teardown
}

# --- AC1 wiring: env-destroy calls it ----------------------------------------

test_env_destroy_wired() {
    CURRENT_TEST_NAME="AC1: env-destroy itself sweeps the guild"
    sw_setup
    sw_register_goner
    bash "$ENV_DESTROY_BIN" --slug goner --force >/dev/null 2>&1
    assert_contains "$(sw_delete_urls)" "${API_BASE}/channels/v-1" \
        "env-destroy must call discord_sweep_ephemeral_voice — an unwired helper leaves the test guild exactly as littered as before"
    assert_contains "$(cat "$RL_AUDIT_LOG" 2>/dev/null)" "discord-ephemeral-swept" \
        "the sweep must leave an audit line so the count is visible"
    assert_contains "$(cat "$RL_AUDIT_LOG" 2>/dev/null)" '"deleted":2' \
        "the audit line must carry the number of channels deleted"
    sw_teardown
}

# --- AC2: the token never leaks --------------------------------------------------

test_token_never_in_argv_or_output() {
    CURRENT_TEST_NAME="AC2: the bot token never reaches argv, output, xtrace or audit"
    sw_setup
    local out="$RL_STATE_DIR/driver.out" xtrace="$RL_STATE_DIR/driver.xtrace"
    bash "$SW_DRIVER" 1 goner >"$out" 2>&1
    bash -x "$SW_DRIVER" 1 goner >/dev/null 2>"$xtrace"
    local argv_lines
    argv_lines=$(grep '^ARGV ' "$SW_CURL_LOG" 2>/dev/null || true)
    assert_contains "$argv_lines" "ARGV --config -" \
        "curl must take its whole request from stdin"
    if [[ "$argv_lines" == *"$TOKEN"* ]]; then
        assert_eq "token-in-argv" "token-not-in-argv" \
            "the bot token was passed on curl's command line, where \`ps\` on the VM can read it"
    else
        assert_eq "token-not-in-argv" "token-not-in-argv" "token stayed off argv"
    fi
    local where
    for where in "$out" "$xtrace" "$RL_AUDIT_LOG"; do
        if grep -q -- "$TOKEN" "$where" 2>/dev/null; then
            assert_eq "token-leaked" "token-contained" \
                "the bot token leaked into $(basename "$where"); it may only travel inside the curl --config stdin pipe under set +x"
        else
            assert_eq "token-contained" "token-contained" "token absent from $(basename "$where")"
        fi
    done
    sw_teardown
}

# --- AC3: a Discord 500 never fails the destroy ---------------------------------

test_env_destroy_exits_0_on_500() {
    CURRENT_TEST_NAME="AC3: env-destroy exits 0 when Discord answers 500"
    sw_setup
    sw_register_goner
    export SW_CURL_RC=22
    export SW_CURL_BODY='{"message":"500: Internal Server Error","code":0}'
    local out="$RL_STATE_DIR/destroy.out" rc
    bash "$ENV_DESTROY_BIN" --slug goner --force >"$out" 2>/dev/null
    rc=$?
    assert_exit_code "$rc" 0 \
        "a Discord 500 must never fail the destroy — the sweep is best-effort"
    assert_eq "$(jq -r '.ok' "$out" 2>/dev/null)" "true" \
        "env-destroy must still report {ok:true} after a failed sweep"
    assert_eq "$(sw_delete_urls | grep -c .)" "0" \
        "an error body is not a channel list — nothing may be DELETEd"
    sw_teardown
}

# --- skip paths -----------------------------------------------------------------

test_skips_without_guild_id() {
    CURRENT_TEST_NAME="no RL_DISCORD_TEST_GUILD_ID → no Discord call"
    sw_setup
    unset RL_DISCORD_TEST_GUILD_ID
    bash "$SW_DRIVER" 1 goner >/dev/null 2>&1
    sw_assert_no_calls "without a guild id there is nothing to sweep; the helper must stay silent"
    sw_teardown
}

test_skips_without_token() {
    CURRENT_TEST_NAME="no slot bot token → no Discord call"
    sw_setup
    unset RL_SLOT_1_DISCORD_BOT_TOKEN
    bash "$SW_DRIVER" 1 goner >/dev/null 2>&1
    sw_assert_no_calls "an unconfigured slot has no bot to sweep with"
    sw_teardown
}

test_disable_seam() {
    CURRENT_TEST_NAME="RL_DISCORD_SWEEP_DISABLED=1 → no Discord call"
    sw_setup
    export RL_DISCORD_SWEEP_DISABLED=1
    bash "$SW_DRIVER" 1 goner >/dev/null 2>&1
    sw_assert_no_calls "the disable seam must short-circuit before any Discord call"
    sw_teardown
}

test_non_numeric_slot_noop() {
    CURRENT_TEST_NAME="empty slot → no Discord call, exit 0"
    sw_setup
    bash "$SW_DRIVER" "" goner >/dev/null 2>&1
    assert_exit_code "$?" 0 "an env with no recorded slot must not abort the destroy"
    sw_assert_no_calls "no slot means no bot identity to sweep with"
    sw_teardown
}

run_test "sweep-deletes-only-clock-voice" test_sweep_deletes_only_clock_voice
run_test "env-destroy-wired" test_env_destroy_wired
run_test "token-never-in-argv-or-output" test_token_never_in_argv_or_output
run_test "env-destroy-exits-0-on-500" test_env_destroy_exits_0_on_500
run_test "skips-silently-without-guild-id" test_skips_without_guild_id
run_test "skips-silently-without-token" test_skips_without_token
run_test "disable-seam" test_disable_seam
run_test "non-numeric-slot-noop" test_non_numeric_slot_noop

print_test_summary
