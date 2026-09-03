#!/usr/bin/env bash
# ROK-1469 D6 — VM-side encrypted settings bundle.
#
# `rl_env_deploy` used to need the operator's laptop DB reachable: sync_settings
# pg_dumps app_settings out of the local raid-ledger-db container. With Docker
# Desktop off (2026-09-02 incident) every deploy shipped an env with no API
# keys. The bundle is the laptop-independent path: `rl settings push` writes
# /srv/rl-infra/settings/bundle.enc, and env-spin's overlay seeds from it.
#
# Asserted here (real openssl round-trip, no stubs):
#   1. a valid bundle decrypts to the plaintext settings map
#   2. a missing bundle is a silent no-op ({}), never a failed spin
#   3. a wrong key / corrupt file yields {} + a warning, never garbage
#   4. a bundle whose plaintext is not a JSON object yields {}

set -uo pipefail

CURRENT_TEST_FILE="settings-bundle.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

sb_setup() {
    test_setup
    export RL_SETTINGS_BUNDLE="$RL_STATE_DIR/bundle.enc"
    export RL_SETTINGS_BUNDLE_KEY="unit-test-bundle-key"
    # shellcheck disable=SC1091
    source "$BIN_DIR/_settings_bundle.sh"
}

sb_teardown() {
    unset RL_SETTINGS_BUNDLE RL_SETTINGS_BUNDLE_KEY SETTINGS_BUNDLE_WARNING
    test_teardown
}

# Encrypt <plaintext> into the bundle path with the current key.
sb_write_bundle() {
    printf '%s' "$1" | openssl enc -aes-256-cbc -pbkdf2 -salt \
        -pass env:RL_SETTINGS_BUNDLE_KEY -out "$RL_SETTINGS_BUNDLE" 2>/dev/null
}

test_bundle_roundtrip() {
    CURRENT_TEST_NAME="D6: a valid bundle decrypts to its settings map"
    sb_setup
    sb_write_bundle '{"itad_api_key":"itad-123","cooptimus_user_agent":"RL/1.0"}'

    local out
    out=$(settings_bundle::payload)
    assert_eq "$(jq -r '.itad_api_key' <<<"$out" 2>/dev/null || echo parse_err)" \
        "itad-123" "shared API key survives the round-trip"
    assert_eq "$(jq -r '.cooptimus_user_agent' <<<"$out" 2>/dev/null || echo parse_err)" \
        "RL/1.0" "second key survives too"
    assert_eq "${SETTINGS_BUNDLE_WARNING:-}" "" "no warning on the happy path"
    sb_teardown
}

test_missing_bundle_is_noop() {
    CURRENT_TEST_NAME="D6: no bundle on disk → {} and no warning (pre-push fleet)"
    sb_setup
    local out
    out=$(settings_bundle::payload)
    assert_eq "$out" "{}" "missing bundle yields an empty map"
    assert_eq "${SETTINGS_BUNDLE_WARNING:-}" "" "absence is not an error"
    sb_teardown
}

test_wrong_key_warns_but_yields_empty() {
    CURRENT_TEST_NAME="D6: undecryptable bundle → {} + warning, never garbage"
    sb_setup
    sb_write_bundle '{"itad_api_key":"itad-123"}'
    export RL_SETTINGS_BUNDLE_KEY="the-wrong-key"

    # Read the payload the way callers must: to a FILE, so the function runs
    # in THIS shell and its warning survives ($( ) would fork it away — the
    # bug B1 caught in env-settings-overlay).
    settings_bundle::payload > "$RL_STATE_DIR/payload.json"
    assert_eq "$(cat "$RL_STATE_DIR/payload.json")" "{}" "a failed decrypt must not leak partial plaintext"
    assert_neq "${SETTINGS_BUNDLE_WARNING:-}" "" "a decrypt failure must warn"
    sb_teardown
}

test_non_object_plaintext_rejected() {
    CURRENT_TEST_NAME="D6: non-object plaintext → {} + warning"
    sb_setup
    sb_write_bundle '["itad_api_key"]'
    settings_bundle::payload > "$RL_STATE_DIR/payload.json"
    assert_eq "$(cat "$RL_STATE_DIR/payload.json")" "{}" "an array payload is rejected"
    assert_neq "${SETTINGS_BUNDLE_WARNING:-}" "" "a malformed bundle must warn"
    sb_teardown
}

test_no_key_configured() {
    CURRENT_TEST_NAME="D6: bundle present but no key configured → {} + warning"
    sb_setup
    sb_write_bundle '{"itad_api_key":"itad-123"}'
    unset RL_SETTINGS_BUNDLE_KEY
    settings_bundle::payload > "$RL_STATE_DIR/payload.json"
    assert_eq "$(cat "$RL_STATE_DIR/payload.json")" "{}" "no key → nothing applied"
    assert_neq "${SETTINGS_BUNDLE_WARNING:-}" "" "missing key must warn (silently skipping hides a broken deploy)"
    sb_teardown
}

# LIVE FINDING (2026-09-02): `rl settings push` wrote bundle.enc as rl:rl 640
# while the orchestrator runs as rl-agent, so every read hit the "no file"
# branch — silently. The env came up with the 4 identity keys, none of the 12
# shared keys, and overlay_warnings:[]. "Absent" and "present but unreadable"
# must never look the same.
test_unreadable_bundle_warns() {
    CURRENT_TEST_NAME="D6: present-but-unreadable bundle warns (does not look absent)"
    sb_setup
    sb_write_bundle '{"itad_api_key":"itad-123"}'
    chmod 000 "$RL_SETTINGS_BUNDLE" 2>/dev/null || true
    if [[ -r "$RL_SETTINGS_BUNDLE" ]]; then
        # root (or a permissive FS) can read anything — the case is not
        # reproducible here, so skip rather than assert something false.
        echo "SKIP [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] running as root; chmod 000 is still readable"
        chmod 600 "$RL_SETTINGS_BUNDLE" 2>/dev/null || true
        sb_teardown
        return 0
    fi

    settings_bundle::payload > "$RL_STATE_DIR/payload.json"
    assert_eq "$(cat "$RL_STATE_DIR/payload.json")" "{}" "nothing is applied"
    assert_neq "${SETTINGS_BUNDLE_WARNING:-}" "" "an unreadable bundle MUST warn"
    assert_contains "${SETTINGS_BUNDLE_WARNING:-}" "unreadable" \
        "the warning says unreadable, not missing"
    assert_contains "${SETTINGS_BUNDLE_WARNING:-}" "$RL_SETTINGS_BUNDLE" \
        "the warning names the path so the operator can fix the mode"
    chmod 600 "$RL_SETTINGS_BUNDLE" 2>/dev/null || true
    sb_teardown
}

run_test "d6-roundtrip" test_bundle_roundtrip
run_test "d6-missing" test_missing_bundle_is_noop
run_test "d6-wrong-key" test_wrong_key_warns_but_yields_empty
run_test "d6-non-object" test_non_object_plaintext_rejected
run_test "d6-no-key" test_no_key_configured
run_test "d6-unreadable" test_unreadable_bundle_warns

print_test_summary
