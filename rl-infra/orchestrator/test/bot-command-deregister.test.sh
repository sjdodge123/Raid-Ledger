#!/usr/bin/env bash
# A3-B P5 — env-destroy must deregister the slot bot's slash commands.
#
# Discord stores slash commands against the APPLICATION, not the container, so
# a destroyed env used to leave a live-looking /bind in the test guild's picker
# routing to an application nobody was running: "The application did not
# respond", with nothing in any env's logs. That cost the operator two test
# attempts on 2026-09-03.
#
# The seams: RL_DISCORD_API_BASE points at a fake host (no network is ever
# touched — the `curl` on PATH is a stub), RL_BOT_DEREGISTER_DISABLED=1 turns
# the whole thing off. The stub records BOTH argv and the stdin config, so the
# "token never reaches argv" property is asserted rather than assumed.
#
# macOS bash 3.2 compatible.

set -uo pipefail

CURRENT_TEST_FILE="bot-command-deregister.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ENV_DESTROY_BIN="$BIN_DIR/env-destroy"
API_BASE="http://discord.invalid/api/v10"
CID="100000000000000001"
TOKEN="tok-slot-1-supersecret"

dr_setup() {
    test_setup
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_CLAIMS_FILE="$RL_STATE_DIR/claims.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    export RL_TRAEFIK_CONF_D="$RL_STATE_DIR/traefik/conf.d"
    mkdir -p "$RL_TRAEFIK_CONF_D" "$RL_STATE_DIR/bot-identity"
    echo "[]" > "$RL_ENVS_FILE"
    echo "[]" > "$RL_CLAIMS_FILE"

    export RL_DISCORD_API_BASE="$API_BASE"
    export DEREG_CURL_LOG="$RL_STATE_DIR/curl-calls.log"
    export DEREG_GUILDS_JSON="$RL_STATE_DIR/guilds.json"
    export DEREG_CURL_RC=0
    : > "$DEREG_CURL_LOG"
    jq -n '[{id: "g-1", name: "Test Guild"}, {id: "g-2", name: "Other"}]' \
        > "$DEREG_GUILDS_JSON"

    export RL_SLOT_1_DISCORD_BOT_TOKEN="$TOKEN"
    export RL_SLOT_1_DISCORD_CLIENT_ID="$CID"
    export RL_SLOT_1_DISCORD_APP_NAME="RL Test Slot 1"

    DR_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$DR_STUB_DIR"
    # curl stub: argv on one line, the stdin config on another. Answers the
    # guild probe from a fixture; every other call returns an empty body.
    cat > "$DR_STUB_DIR/curl" <<'STUB'
#!/usr/bin/env bash
# _state.sh:31 probes the docker socket-proxy with `curl -fsS ... /_ping`.
# Reading stdin for THAT call blocks forever (nothing is piping into it), so
# only the deregistration helper's `--config -` form is handled here; anything
# else fails fast exactly as it does on a laptop with no socket-proxy.
if [[ "$*" != "--config -" ]]; then exit 1; fi
printf 'ARGV %s\n' "$*" >> "$DEREG_CURL_LOG"
cfg=$(cat)
printf 'CONFIG %s\n' "$(printf '%s' "$cfg" | tr '\n' ' ')" >> "$DEREG_CURL_LOG"
if [[ "$cfg" == *"/users/@me/guilds"* ]]; then cat "$DEREG_GUILDS_JSON"; fi
exit "${DEREG_CURL_RC:-0}"
STUB
    chmod +x "$DR_STUB_DIR/curl"
    # Permissive docker stub — env-destroy's container/volume work is not
    # what this file is about.
    cat > "$DR_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
    ps) printf '\n' ;;
    inspect) exit 1 ;;
esac
exit 0
STUB
    chmod +x "$DR_STUB_DIR/docker"
    export PATH="$DR_STUB_DIR:$PATH"

    # Driver runs the helper the way env-destroy does: under `set -euo
    # pipefail`, so a non-zero return anywhere inside would abort here too.
    DR_DRIVER="$RL_STATE_DIR/dereg-driver.sh"
    cat > "$DR_DRIVER" <<STUB
#!/usr/bin/env bash
set -euo pipefail
source "$BIN_DIR/_state.sh"
source "$BIN_DIR/_bot_identity.sh"
bot_identity::deregister_commands "\$1" "\$2"
STUB
    chmod +x "$DR_DRIVER"
}

dr_teardown() {
    unset RL_ENVS_FILE RL_CLAIMS_FILE RL_AUDIT_LOG RL_TRAEFIK_CONF_D \
          RL_DISCORD_API_BASE DEREG_CURL_LOG DEREG_GUILDS_JSON DEREG_CURL_RC \
          RL_SLOT_1_DISCORD_BOT_TOKEN RL_SLOT_1_DISCORD_CLIENT_ID \
          RL_SLOT_1_DISCORD_APP_NAME RL_BOT_DEREGISTER_DISABLED 2>/dev/null || true
    test_teardown
}

dr_claim_identity() {
    jq -n --arg slug "$1" '{slug: $slug, claimed_at: "2026-09-02T00:00:00Z"}' \
        > "$RL_STATE_DIR/bot-identity/slot-1.json"
}

dr_log() { cat "$DEREG_CURL_LOG" 2>/dev/null || true; }

# Assert no Discord call happened, and NAME the calls that did. A bare line
# count would report "expected 0, actual 2" and leave the reader guessing.
dr_assert_no_calls() {
    local n
    n=$(wc -l < "$DEREG_CURL_LOG" 2>/dev/null | tr -d ' ')
    assert_eq "${n:-unreadable}" "0" \
        "$1 — curl was called with: [$(dr_log | tr '\n' '|')]"
}

# --- P5.1: the app's GLOBAL commands are deleted ------------------------------

test_global_commands_deleted() {
    CURRENT_TEST_NAME="P5: teardown PUTs an empty body to the app's GLOBAL commands"
    dr_setup
    dr_claim_identity "goner"
    bash "$DR_DRIVER" 1 goner >/dev/null 2>&1
    assert_contains "$(dr_log)" "url = \"${API_BASE}/applications/${CID}/commands\"" \
        "global registrations survive env destroy and are what fill the picker with dead /bind rows — teardown must PUT [] to the app's global command route"
    assert_contains "$(dr_log)" '--data "[]"' \
        "the delete-all is an empty command array"
    dr_teardown
}

# --- P5.2: every guild the bot is in is cleared -------------------------------

test_guild_commands_deleted_for_each_guild() {
    CURRENT_TEST_NAME="P5: teardown clears commands in EVERY guild the bot is in"
    dr_setup
    dr_claim_identity "goner"
    bash "$DR_DRIVER" 1 goner >/dev/null 2>&1
    assert_contains "$(dr_log)" "${API_BASE}/users/@me/guilds" \
        "the guild list must be discovered from the token, not configured"
    assert_contains "$(dr_log)" "${API_BASE}/applications/${CID}/guilds/g-1/commands" \
        "guild g-1 from the discovered list must have its commands cleared"
    assert_contains "$(dr_log)" "${API_BASE}/applications/${CID}/guilds/g-2/commands" \
        "guild g-2 from the discovered list must have its commands cleared"
    dr_teardown
}

# --- P5.3: the bot token never reaches argv -----------------------------------

test_token_never_in_argv() {
    CURRENT_TEST_NAME="P5: the bot token never appears in curl's argv"
    dr_setup
    dr_claim_identity "goner"
    bash "$DR_DRIVER" 1 goner >/dev/null 2>&1
    local argv_lines
    argv_lines=$(grep '^ARGV ' "$DEREG_CURL_LOG" 2>/dev/null || true)
    assert_contains "$argv_lines" "ARGV --config -" \
        "curl must take its whole request from stdin"
    if [[ "$argv_lines" == *"$TOKEN"* ]]; then
        assert_eq "token-in-argv" "token-not-in-argv" \
            "the bot token was passed on curl's command line, where \`ps\` on the VM can read it; it must go through the --config stdin pipe like every other secret in this module"
    else
        assert_eq "token-not-in-argv" "token-not-in-argv" "token stayed off argv"
    fi
    dr_teardown
}

# --- P5.4: an unconfigured slot is left alone ---------------------------------

test_unconfigured_slot_makes_no_calls() {
    CURRENT_TEST_NAME="P5: a slot with no Discord identity makes no Discord calls"
    dr_setup
    unset RL_SLOT_1_DISCORD_BOT_TOKEN RL_SLOT_1_DISCORD_CLIENT_ID
    dr_claim_identity "goner"
    bash "$DR_DRIVER" 1 goner >/dev/null 2>&1
    dr_assert_no_calls \
        "a slot with no bot token has no commands to deregister and must not call Discord at all"
    dr_teardown
}

# --- P5.5: a LIVE sibling env's commands are never stripped -------------------

test_non_holder_destroy_makes_no_calls() {
    CURRENT_TEST_NAME="P5: destroying a non-holder env never strips the holder's commands"
    dr_setup
    dr_claim_identity "still-running"
    bash "$DR_DRIVER" 1 goner >/dev/null 2>&1
    dr_assert_no_calls \
        "slot 1's identity is held by a DIFFERENT, still-running env; deregistering here would break that live env's slash commands"
    dr_teardown
}

# --- P5.6: a Discord failure must not wedge the teardown ----------------------

test_curl_failure_does_not_abort() {
    CURRENT_TEST_NAME="P5: a failing Discord call returns 0 so teardown continues"
    dr_setup
    dr_claim_identity "goner"
    export DEREG_CURL_RC=7
    bash "$DR_DRIVER" 1 goner >/dev/null 2>&1
    assert_exit_code "$?" 0 \
        "the helper runs under \`set -euo pipefail\` inside env-destroy; a Discord outage must not abort the teardown"
    dr_teardown
}

# --- P5.7: the disable seam ---------------------------------------------------

test_disable_seam_skips_everything() {
    CURRENT_TEST_NAME="P5: RL_BOT_DEREGISTER_DISABLED=1 makes no Discord calls"
    dr_setup
    dr_claim_identity "goner"
    export RL_BOT_DEREGISTER_DISABLED=1
    bash "$DR_DRIVER" 1 goner >/dev/null 2>&1
    dr_assert_no_calls \
        "the disable seam must short-circuit before any Discord call"
    dr_teardown
}

# --- P5.8: env-destroy actually calls it --------------------------------------

test_env_destroy_wires_deregistration() {
    CURRENT_TEST_NAME="P5: env-destroy itself deregisters the slot app's commands"
    dr_setup
    export RL_AGENT_ID="dr-agent"
    jq -n '[{slug: "goner", slot: 1, created_at: "2026-09-02T00:00:00Z"}]' \
        > "$RL_ENVS_FILE"
    dr_claim_identity "goner"
    "$ENV_DESTROY_BIN" --slug goner --force >/dev/null 2>&1
    assert_contains "$(dr_log)" "${API_BASE}/applications/${CID}/commands" \
        "env-destroy must call the deregistration helper — an unwired helper leaves the picker exactly as broken as before"
    unset RL_AGENT_ID
    dr_teardown
}

run_test "p5-global-cleared" test_global_commands_deleted
run_test "p5-guilds-cleared" test_guild_commands_deleted_for_each_guild
run_test "p5-token-off-argv" test_token_never_in_argv
run_test "p5-unconfigured-noop" test_unconfigured_slot_makes_no_calls
run_test "p5-non-holder-noop" test_non_holder_destroy_makes_no_calls
run_test "p5-outage-tolerated" test_curl_failure_does_not_abort
run_test "p5-disable-seam" test_disable_seam_skips_everything
run_test "p5-env-destroy-wired" test_env_destroy_wires_deregistration

print_test_summary
