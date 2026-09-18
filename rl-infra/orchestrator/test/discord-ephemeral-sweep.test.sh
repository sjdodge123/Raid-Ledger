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
discord_sweep_ephemeral_voice "\$1" "\${2:-}" "\${3:-}"
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
    CURRENT_TEST_NAME="no RL_DISCORD_TEST_GUILD_ID → no Discord call, and the skip says so"
    sw_setup
    unset RL_DISCORD_TEST_GUILD_ID
    local err="$RL_STATE_DIR/skip.err"
    bash "$SW_DRIVER" 1 goner >/dev/null 2>"$err"
    sw_assert_no_calls "without a guild id there is nothing to sweep"
    # ROK-1611: this exact case was live for days and nothing said a word —
    # 148 channels piled up behind a guard that declined in silence.
    assert_contains "$(cat "$err")" "RL_DISCORD_TEST_GUILD_ID unset" \
        "the skip must name the missing variable — an unexplained no-op is how 148 channels leaked unnoticed"
    sw_teardown
}

test_skips_without_token() {
    CURRENT_TEST_NAME="no slot bot token → no Discord call"
    sw_setup
    unset RL_SLOT_1_DISCORD_BOT_TOKEN
    local err="$RL_STATE_DIR/skip.err"
    bash "$SW_DRIVER" 1 goner >/dev/null 2>"$err"
    sw_assert_no_calls "an unconfigured slot has no bot to sweep with"
    assert_contains "$(cat "$err")" "no bot identity" \
        "the skip must name the unconfigured slot"
    sw_teardown
}

test_disable_seam() {
    CURRENT_TEST_NAME="RL_DISCORD_SWEEP_DISABLED=1 → no Discord call"
    sw_setup
    export RL_DISCORD_SWEEP_DISABLED=1
    local err="$RL_STATE_DIR/skip.err"
    bash "$SW_DRIVER" 1 goner >/dev/null 2>"$err"
    sw_assert_no_calls "the disable seam must short-circuit before any Discord call"
    assert_contains "$(cat "$err")" "RL_DISCORD_SWEEP_DISABLED=1" \
        "an intentionally disabled sweep must still say that is why it did nothing"
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

# --- ROK-1611: the skip is audited, not just printed -----------------------------

test_skip_is_audited() {
    CURRENT_TEST_NAME="ROK-1611: a declined sweep leaves an audit line naming the reason"
    sw_setup
    sw_register_goner
    unset RL_DISCORD_TEST_GUILD_ID
    bash "$ENV_DESTROY_BIN" --slug goner --force >/dev/null 2>&1
    assert_contains "$(cat "$RL_AUDIT_LOG" 2>/dev/null)" "discord-ephemeral-skipped" \
        "audit.log must record that the sweep declined — it held zero lines about this for the whole time the guild was filling up"
    assert_contains "$(cat "$RL_AUDIT_LOG" 2>/dev/null)" "RL_DISCORD_TEST_GUILD_ID unset" \
        "the audit line must carry the reason, so the fix is one grep away"
    sw_teardown
}

# --- ROK-1611: the age guard ----------------------------------------------------

# A channel snowflake for a moment `age_seconds` ago: (ms - epoch) << 22.
sw_snowflake_aged() {
    local age="$1" ms
    ms=$(( ($(date +%s) - age) * 1000 - 1420070400000 ))
    printf '%s' "$(( ms * 4194304 ))"
}

# Two ⏰ VOICE channels: one two days old, one 60s old (i.e. plausibly in use).
sw_write_aged_channels() {
    jq -n --arg old "$(sw_snowflake_aged 172800)" --arg young "$(sw_snowflake_aged 60)" \
        '[{id: $old, type: 2, name: "⏰ Valheim — Playing now"},
          {id: $young, type: 2, name: "⏰ Deep Rock — Playing now"}]' \
        > "$SW_CHANNELS_JSON"
    SW_OLD_ID="$(sw_snowflake_aged 172800)"
    SW_YOUNG_ID="$(sw_snowflake_aged 60)"
}

test_age_guard_spares_young_channels() {
    CURRENT_TEST_NAME="ROK-1611: with a cutoff, a minutes-old ⏰ channel is spared"
    sw_setup
    sw_write_aged_channels
    local cutoff
    cutoff=$(( ($(date +%s) - 21600) * 1000 ))   # 6h ago
    bash "$SW_DRIVER" 1 goner "$cutoff" >/dev/null 2>&1
    assert_contains "$(sw_delete_urls)" "${API_BASE}/channels/${SW_OLD_ID}" \
        "a two-day-old ⏰ channel is orphaned by construction and must be swept"
    sw_assert_kept "$SW_YOUNG_ID" \
        "a 60-second-old ⏰ channel may be someone's live session — REST cannot see voice members, so age is the only guard there is"
    sw_teardown
}

test_teardown_path_has_no_age_guard() {
    CURRENT_TEST_NAME="ROK-1611: env-destroy still sweeps young channels (its env is gone)"
    sw_setup
    sw_write_aged_channels
    bash "$SW_DRIVER" 1 goner >/dev/null 2>&1
    assert_eq "$(sw_delete_urls | grep -c .)" "2" \
        "teardown passes no cutoff: the env that owned these is being destroyed, so both must go — deleted: [$(sw_delete_urls | tr '\n' '|')]"
    sw_teardown
}

# --- ROK-1611: the standalone backlog sweeper -----------------------------------

test_sweep_bin_dry_run_deletes_nothing() {
    CURRENT_TEST_NAME="ROK-1611 AC2: discord-sweep defaults to a dry run"
    sw_setup
    sw_write_aged_channels
    local out="$RL_STATE_DIR/sweep.out"
    bash "$BIN_DIR/discord-sweep" --slot 1 >"$out" 2>/dev/null
    assert_eq "$(jq -r '.dry_run' "$out" 2>/dev/null)" "true" \
        "no --delete means no deletion — the destructive form must be the one you type on purpose"
    assert_eq "$(sw_delete_urls | grep -c .)" "0" \
        "a dry run must not issue a single DELETE — deleted: [$(sw_delete_urls | tr '\n' '|')]"
    assert_eq "$(jq -r '.matched' "$out" 2>/dev/null)" "1" \
        "the dry run must still report the one channel old enough to sweep"
    assert_eq "$(jq -r '.too_young_to_touch' "$out" 2>/dev/null)" "1" \
        "and must say how many it spared, or the age guard is invisible"
    sw_teardown
}

test_sweep_bin_delete_removes_only_old() {
    CURRENT_TEST_NAME="ROK-1611 AC2: --delete removes the aged channels only"
    sw_setup
    sw_write_aged_channels
    local out="$RL_STATE_DIR/sweep.out"
    bash "$BIN_DIR/discord-sweep" --slot 1 --delete >"$out" 2>/dev/null
    assert_eq "$(jq -r '.deleted' "$out" 2>/dev/null)" "1" \
        "exactly the aged channel is deleted"
    assert_contains "$(sw_delete_urls)" "${API_BASE}/channels/${SW_OLD_ID}" \
        "the aged ⏰ channel must actually be DELETEd"
    sw_assert_kept "$SW_YOUNG_ID" "a young channel survives --delete too"
    sw_teardown
}

test_sweep_bin_is_idempotent() {
    CURRENT_TEST_NAME="ROK-1611 AC2: re-running against a clean guild deletes nothing"
    sw_setup
    jq -n '[{id: "1", type: 2, name: "General"}]' > "$SW_CHANNELS_JSON"
    local out="$RL_STATE_DIR/sweep.out" rc
    bash "$BIN_DIR/discord-sweep" --slot 1 --delete >"$out" 2>/dev/null
    rc=$?
    assert_exit_code "$rc" 0 "a second sweep over an already-clean guild is a success, not an error"
    assert_eq "$(jq -r '.deleted' "$out" 2>/dev/null)" "0" \
        "nothing matches, so nothing is deleted — the sweep must be safe to re-run"
    sw_teardown
}

test_sweep_bin_refuses_zero_hours() {
    CURRENT_TEST_NAME="ROK-1611: --older-than-hours 0 is refused"
    sw_setup
    sw_write_aged_channels
    local rc
    bash "$BIN_DIR/discord-sweep" --slot 1 --delete --older-than-hours 0 >/dev/null 2>&1
    rc=$?
    assert_exit_code "$rc" 2 \
        "a zero-hour cutoff deletes voice channels that are in use right now; it must be refused, not obeyed"
    assert_eq "$(sw_delete_urls | grep -c .)" "0" \
        "a refused invocation must not have deleted anything first"
    sw_teardown
}

test_sweep_bin_reports_missing_config() {
    CURRENT_TEST_NAME="ROK-1611: discord-sweep fails loudly when the guild id is unset"
    sw_setup
    unset RL_DISCORD_TEST_GUILD_ID
    local err="$RL_STATE_DIR/sweep.err" rc
    bash "$BIN_DIR/discord-sweep" --slot 1 >/dev/null 2>"$err"
    rc=$?
    assert_exit_code "$rc" 1 \
        "the operator ran a sweep and it could not run — that is a failure, not a quiet success"
    assert_contains "$(cat "$err")" "RL_DISCORD_TEST_GUILD_ID unset" \
        "the error must name the variable to set"
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
run_test "skip-is-audited" test_skip_is_audited
run_test "age-guard-spares-young-channels" test_age_guard_spares_young_channels
run_test "teardown-path-has-no-age-guard" test_teardown_path_has_no_age_guard
run_test "sweep-bin-dry-run-deletes-nothing" test_sweep_bin_dry_run_deletes_nothing
run_test "sweep-bin-delete-removes-only-old" test_sweep_bin_delete_removes_only_old
run_test "sweep-bin-is-idempotent" test_sweep_bin_is_idempotent
run_test "sweep-bin-refuses-zero-hours" test_sweep_bin_refuses_zero_hours
run_test "sweep-bin-reports-missing-config" test_sweep_bin_reports_missing_config

print_test_summary
