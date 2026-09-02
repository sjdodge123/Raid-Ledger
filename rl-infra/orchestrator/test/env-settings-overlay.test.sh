#!/usr/bin/env bash
# ROK-1469 D1 — env-settings-overlay tests.
#
# The overlay is what makes a fleet env's Discord identity SLOT-OWNED rather
# than "whatever the operator's laptop held when sync_settings ran". It builds
# a plaintext payload from /srv/rl-infra/.env's RL_SLOT_<N>_DISCORD_* values
# and pipes it — over STDIN, never argv — into the env's allinone container,
# where apply-settings-overlay.js re-encrypts it through the app's own path.
#
# Covered:
#   1. happy path      — payload reaches the container, JSON reports the slot
#   2. secret hygiene  — stdout carries key NAMES + the PUBLIC client id only
#   3. unconfigured    — no slot creds → ok:true, skipped, container untouched
#   4. exec failure    — container-side failure surfaces settings_overlay_failed
#   5. slot resolution — --slot wins; otherwise read from the env registry
#
# `env-exec-app` is stubbed via RL_ENV_EXEC_APP (the same override seam the
# suite uses for RL_TRAEFIK_CONF_D) so no docker is required. macOS bash 3.2.

set -uo pipefail

CURRENT_TEST_FILE="env-settings-overlay.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

OVERLAY_BIN="$BIN_DIR/env-settings-overlay"

# Stub globals:
#   ESO_EXEC_RC        exit code the fake env-exec-app returns (default 0)
#   ESO_EXEC_STDOUT    what the fake container-side script prints
eso_setup() {
    test_setup
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    export RL_AGENT_ID="eso-agent"
    ESO_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$ESO_STUB_DIR"
    ESO_STDIN_CAPTURE="$RL_STATE_DIR/exec-stdin.json"
    ESO_ARGV_CAPTURE="$RL_STATE_DIR/exec-argv.log"
    export ESO_STDIN_CAPTURE ESO_ARGV_CAPTURE
    ESO_EXEC_RC=0
    ESO_EXEC_STDOUT='{"ok":true,"applied":["discord_bot_token","discord_client_id","discord_client_secret","discord_bot_enabled"],"count":4}'
    export ESO_EXEC_RC ESO_EXEC_STDOUT
    cat > "$ESO_STUB_DIR/env-exec-app" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$ESO_ARGV_CAPTURE"
cat > "$ESO_STDIN_CAPTURE"
printf '%s\n' "${ESO_EXEC_STDOUT:-}"
exit "${ESO_EXEC_RC:-0}"
STUB
    chmod +x "$ESO_STUB_DIR/env-exec-app"
    export RL_ENV_EXEC_APP="$ESO_STUB_DIR/env-exec-app"

    jq -n '[{slug: "eso1", slot: 2, created_at: "2026-09-02T00:00:00Z"}]' \
        > "$RL_ENVS_FILE"

    # Slot 2 identity (fake values — mirrors /srv/rl-infra/.env shape).
    export RL_SLOT_2_DISCORD_BOT_TOKEN="tok-slot-2-secret"
    export RL_SLOT_2_DISCORD_CLIENT_ID="200000000000000002"
    export RL_SLOT_2_DISCORD_CLIENT_SECRET="csec-slot-2-secret"
    export RL_SLOT_2_DISCORD_APP_NAME="Raid Ledger Test Slot 2"
}

eso_teardown() {
    unset RL_ENV_EXEC_APP ESO_STDIN_CAPTURE ESO_ARGV_CAPTURE ESO_EXEC_RC ESO_EXEC_STDOUT
    unset RL_SLOT_2_DISCORD_BOT_TOKEN RL_SLOT_2_DISCORD_CLIENT_ID \
          RL_SLOT_2_DISCORD_CLIENT_SECRET RL_SLOT_2_DISCORD_APP_NAME
    test_teardown
}

# 1 + 2 — happy path and secret hygiene.
test_overlay_applies_slot_identity() {
    CURRENT_TEST_NAME="D1: slot identity is piped to the container over stdin"
    eso_setup

    local out rc=0
    out=$("$OVERLAY_BIN" --slug eso1 2>&1) || rc=$?
    assert_exit_code "$rc" "0" "overlay should exit 0"
    assert_eq "$(jq -r '.ok' <<<"$out" 2>/dev/null || echo parse_err)" "true" ".ok == true"
    assert_eq "$(jq -r '.slot' <<<"$out" 2>/dev/null || echo parse_err)" "2" ".slot == 2 (from registry)"
    assert_contains "$out" "discord_bot_token" ".applied names the token key"
    assert_eq "$(jq -r '.bot_identity.client_id' <<<"$out" 2>/dev/null || echo parse_err)" \
        "200000000000000002" ".bot_identity.client_id is the PUBLIC client id"

    # The payload reached the container as JSON on stdin.
    local payload
    payload=$(cat "$ESO_STDIN_CAPTURE" 2>/dev/null || echo "")
    assert_eq "$(jq -r '.discord_bot_token' <<<"$payload" 2>/dev/null || echo parse_err)" \
        "tok-slot-2-secret" "payload carries the slot bot token"
    assert_eq "$(jq -r '.discord_client_secret' <<<"$payload" 2>/dev/null || echo parse_err)" \
        "csec-slot-2-secret" "payload carries the slot client secret"
    assert_eq "$(jq -r '.discord_bot_enabled' <<<"$payload" 2>/dev/null || echo parse_err)" \
        "true" "payload enables the bot"

    # Secret hygiene: neither stdout NOR the argv of env-exec-app may carry
    # a secret value. argv is world-readable via `ps` on the VM.
    if [[ "$out" == *"tok-slot-2-secret"* || "$out" == *"csec-slot-2-secret"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: secret leaked to stdout")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] secret value leaked to stdout"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    local argv
    argv=$(cat "$ESO_ARGV_CAPTURE" 2>/dev/null || echo "")
    if [[ "$argv" == *"tok-slot-2-secret"* || "$argv" == *"csec-slot-2-secret"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: secret leaked to argv")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] secret value leaked to env-exec-app argv"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    eso_teardown
}

# 3 — a slot with no configured identity is a no-op, not a failure.
test_overlay_skips_unconfigured_slot() {
    CURRENT_TEST_NAME="D1: unconfigured slot → ok:true, skipped, container untouched"
    eso_setup
    unset RL_SLOT_2_DISCORD_BOT_TOKEN RL_SLOT_2_DISCORD_CLIENT_ID RL_SLOT_2_DISCORD_CLIENT_SECRET

    local out rc=0
    out=$("$OVERLAY_BIN" --slug eso1 2>&1) || rc=$?
    assert_exit_code "$rc" "0" "unconfigured slot should still exit 0"
    assert_eq "$(jq -r '.ok' <<<"$out" 2>/dev/null || echo parse_err)" "true" ".ok == true"
    assert_eq "$(jq -r '.skipped' <<<"$out" 2>/dev/null || echo parse_err)" \
        "no_overlay_configured" ".skipped explains the no-op"
    assert_file_not_exists "$ESO_ARGV_CAPTURE" "env-exec-app must not be invoked"

    eso_teardown
}

# 4 — container-side failure surfaces a structured error.
test_overlay_reports_exec_failure() {
    CURRENT_TEST_NAME="D1: container-side failure → settings_overlay_failed"
    eso_setup
    ESO_EXEC_RC=3
    ESO_EXEC_STDOUT="env-exec-app: allinone container not found"
    export ESO_EXEC_RC ESO_EXEC_STDOUT

    local out rc=0
    out=$("$OVERLAY_BIN" --slug eso1 2>/dev/null) || rc=$?
    assert_exit_code "$rc" "1" "failed overlay should exit 1"
    assert_eq "$(jq -r '.ok' <<<"$out" 2>/dev/null || echo parse_err)" "false" ".ok == false"
    assert_eq "$(jq -r '.error' <<<"$out" 2>/dev/null || echo parse_err)" \
        "settings_overlay_failed" ".error == settings_overlay_failed"

    eso_teardown
}

# 5 — explicit --slot overrides the registry lookup (env-spin passes it
#     directly, before the registry row for a fresh env exists).
test_overlay_explicit_slot_wins() {
    CURRENT_TEST_NAME="D1: --slot overrides the registry lookup"
    eso_setup
    export RL_SLOT_4_DISCORD_BOT_TOKEN="tok-slot-4-secret"
    export RL_SLOT_4_DISCORD_CLIENT_ID="400000000000000004"

    local out rc=0
    out=$("$OVERLAY_BIN" --slug eso1 --slot 4 2>&1) || rc=$?
    assert_exit_code "$rc" "0" "explicit slot should exit 0"
    assert_eq "$(jq -r '.slot' <<<"$out" 2>/dev/null || echo parse_err)" "4" ".slot == 4"
    assert_eq "$(jq -r '.bot_identity.client_id' <<<"$out" 2>/dev/null || echo parse_err)" \
        "400000000000000004" "slot 4's client id, not slot 2's"
    local payload
    payload=$(cat "$ESO_STDIN_CAPTURE" 2>/dev/null || echo "")
    assert_eq "$(jq -r '.discord_bot_token' <<<"$payload" 2>/dev/null || echo parse_err)" \
        "tok-slot-4-secret" "payload carries slot 4's token"

    unset RL_SLOT_4_DISCORD_BOT_TOKEN RL_SLOT_4_DISCORD_CLIENT_ID
    eso_teardown
}

# 6 — D6: the VM-side bundle supplies the shared API keys, and the slot
#     identity wins on any key collision.
test_overlay_merges_settings_bundle() {
    CURRENT_TEST_NAME="D6: bundle keys are applied; slot identity wins collisions"
    eso_setup
    export RL_SETTINGS_BUNDLE="$RL_STATE_DIR/bundle.enc"
    export RL_SETTINGS_BUNDLE_KEY="overlay-test-key"
    printf '%s' '{"itad_api_key":"itad-from-bundle","discord_bot_token":"stale-laptop-token"}' \
        | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:RL_SETTINGS_BUNDLE_KEY \
          -out "$RL_SETTINGS_BUNDLE" 2>/dev/null

    local out rc=0
    out=$("$OVERLAY_BIN" --slug eso1 2>&1) || rc=$?
    assert_exit_code "$rc" "0" "overlay with a bundle should exit 0"
    local payload
    payload=$(cat "$ESO_STDIN_CAPTURE" 2>/dev/null || echo "")
    assert_eq "$(jq -r '.itad_api_key' <<<"$payload" 2>/dev/null || echo parse_err)" \
        "itad-from-bundle" "shared API key from the bundle reaches the env"
    assert_eq "$(jq -r '.discord_bot_token' <<<"$payload" 2>/dev/null || echo parse_err)" \
        "tok-slot-2-secret" "the SLOT identity beats a stale token in the bundle"
    unset RL_SETTINGS_BUNDLE RL_SETTINGS_BUNDLE_KEY
    eso_teardown
}

# 7 — D6: with no slot identity but a bundle present, the overlay still runs
#     (this is the Docker-Desktop-off path that must not no-op).
test_overlay_runs_for_bundle_only() {
    CURRENT_TEST_NAME="D6: bundle alone (no slot identity) still applies"
    eso_setup
    unset RL_SLOT_2_DISCORD_BOT_TOKEN RL_SLOT_2_DISCORD_CLIENT_ID RL_SLOT_2_DISCORD_CLIENT_SECRET
    export RL_SETTINGS_BUNDLE="$RL_STATE_DIR/bundle.enc"
    export RL_SETTINGS_BUNDLE_KEY="overlay-test-key"
    printf '%s' '{"itad_api_key":"itad-from-bundle"}' \
        | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:RL_SETTINGS_BUNDLE_KEY \
          -out "$RL_SETTINGS_BUNDLE" 2>/dev/null

    local out rc=0
    out=$("$OVERLAY_BIN" --slug eso1 2>&1) || rc=$?
    assert_exit_code "$rc" "0" "bundle-only overlay should exit 0"
    assert_eq "$(jq -r '.skipped // "none"' <<<"$out" 2>/dev/null || echo parse_err)" "none" \
        "must NOT report skipped when the bundle has keys"
    assert_eq "$(jq -r '.itad_api_key' "$ESO_STDIN_CAPTURE" 2>/dev/null || echo parse_err)" \
        "itad-from-bundle" "bundle key reaches the container"
    unset RL_SETTINGS_BUNDLE RL_SETTINGS_BUNDLE_KEY
    eso_teardown
}

run_test "d1-applies-slot-identity" test_overlay_applies_slot_identity
run_test "d1-skips-unconfigured" test_overlay_skips_unconfigured_slot
run_test "d1-exec-failure" test_overlay_reports_exec_failure
run_test "d1-explicit-slot" test_overlay_explicit_slot_wins
run_test "d6-bundle-merge" test_overlay_merges_settings_bundle
run_test "d6-bundle-only" test_overlay_runs_for_bundle_only

print_test_summary
