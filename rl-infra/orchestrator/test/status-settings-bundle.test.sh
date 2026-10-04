#!/usr/bin/env bash
# TDB:1904 — `rl status` reports settings-bundle freshness without SSH.
#
# settings_bundle::freshness_json is what bin/status embeds as the top-level
# `settings_bundle` key. Asserted here (real openssl round-trip, no stubs):
#   1. absent bundle      → present:false, everything else null
#   2. unreadable bundle  → decrypts:false + an "unreadable" warning
#   3. no key / wrong key → decrypts:false + a warning
#   4. good 3-key bundle  → present, decrypts, key_count:3, ISO mtime, age
#   5. NO LEAK: no key name or value from the bundle appears in the output
#   6. exit 0 in every case (status runs under set -euo pipefail)
#   7. a value containing the split sentinel still yields the full key count
#   8. bin/status actually calls it and emits `settings_bundle:` in its jq

set -uo pipefail

CURRENT_TEST_FILE="status-settings-bundle.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ssb_setup() {
    test_setup
    export RL_SETTINGS_BUNDLE="$RL_STATE_DIR/bundle.enc"
    export RL_SETTINGS_BUNDLE_KEY="unit-test-bundle-key"
    # shellcheck disable=SC1091
    source "$BIN_DIR/_settings_bundle.sh"
}

ssb_teardown() {
    unset RL_SETTINGS_BUNDLE RL_SETTINGS_BUNDLE_KEY SETTINGS_BUNDLE_WARNING
    test_teardown
}

ssb_write_bundle() {
    printf '%s' "$1" | openssl enc -aes-256-cbc -pbkdf2 -salt \
        -pass env:RL_SETTINGS_BUNDLE_KEY -out "$RL_SETTINGS_BUNDLE" 2>/dev/null
}

# Run freshness_json into SSB_OUT / SSB_RC.
ssb_probe() {
    SSB_OUT=$(settings_bundle::freshness_json)
    SSB_RC=$?
}

ssb_field() { jq -c ".$1" <<<"$SSB_OUT" 2>/dev/null || echo parse_err; }

test_absent() {
    CURRENT_TEST_NAME="TDB:1904: absent bundle → present:false, the rest null"
    ssb_setup
    ssb_probe
    assert_exit_code "$SSB_RC" 0 "exits 0 when absent"
    assert_eq "$(jq -c '.' <<<"$SSB_OUT" 2>/dev/null || echo parse_err)" \
        '{"present":false,"mtime":null,"age_hours":null,"key_count":null,"decrypts":null,"warning":null}' \
        "absent shape is exact"
    ssb_teardown
}

test_unreadable() {
    CURRENT_TEST_NAME="TDB:1904: unreadable bundle → decrypts:false + unreadable warning"
    ssb_setup
    ssb_write_bundle '{"a":"1"}'
    chmod 000 "$RL_SETTINGS_BUNDLE" 2>/dev/null || true
    if [[ -r "$RL_SETTINGS_BUNDLE" ]]; then
        echo "SKIP [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] running as root; chmod 000 is still readable"
        chmod 600 "$RL_SETTINGS_BUNDLE" 2>/dev/null || true
        ssb_teardown
        return 0
    fi
    ssb_probe
    chmod 600 "$RL_SETTINGS_BUNDLE" 2>/dev/null || true
    assert_exit_code "$SSB_RC" 0 "exits 0 when unreadable"
    assert_eq "$(ssb_field present)" "true" "an unreadable bundle is still present"
    assert_eq "$(ssb_field decrypts)" "false" "unreadable does not decrypt"
    assert_eq "$(ssb_field key_count)" "null" "no key count without a decrypt"
    assert_contains "$(ssb_field warning)" "unreadable" "the warning says unreadable"
    ssb_teardown
}

test_no_key() {
    CURRENT_TEST_NAME="TDB:1904: no RL_SETTINGS_BUNDLE_KEY → decrypts:false + warning"
    ssb_setup
    ssb_write_bundle '{"a":"1"}'
    unset RL_SETTINGS_BUNDLE_KEY
    ssb_probe
    assert_exit_code "$SSB_RC" 0 "exits 0 with no key"
    assert_eq "$(ssb_field decrypts)" "false" "no key → does not decrypt"
    assert_eq "$(ssb_field key_count)" "null" "no key → key_count null"
    assert_contains "$(ssb_field warning)" "RL_SETTINGS_BUNDLE_KEY is unset" "the warning names the missing key var"
    ssb_teardown
}

test_wrong_key() {
    CURRENT_TEST_NAME="TDB:1904: wrong key → decrypts:false + warning"
    ssb_setup
    ssb_write_bundle '{"a":"1"}'
    export RL_SETTINGS_BUNDLE_KEY="the-wrong-key"
    ssb_probe
    assert_exit_code "$SSB_RC" 0 "exits 0 with a wrong key"
    assert_eq "$(ssb_field decrypts)" "false" "wrong key → does not decrypt"
    assert_eq "$(ssb_field key_count)" "null" "wrong key → key_count null"
    assert_contains "$(ssb_field warning)" "could not be decrypted" "the warning says it could not be decrypted"
    ssb_teardown
}

test_good_bundle() {
    CURRENT_TEST_NAME="TDB:1904: good 3-key bundle → decrypts:true, key_count:3, ISO mtime, numeric age"
    ssb_setup
    ssb_write_bundle '{"a":"1","b":"2","c":"3"}'
    ssb_probe
    assert_exit_code "$SSB_RC" 0 "exits 0 on the happy path"
    assert_eq "$(ssb_field present)" "true" "present"
    assert_eq "$(ssb_field decrypts)" "true" "decrypts"
    assert_eq "$(ssb_field key_count)" "3" "key_count is the number of keys"
    assert_eq "$(ssb_field warning)" "null" "no warning on the happy path"
    assert_eq "$(jq -r '.age_hours | type' <<<"$SSB_OUT" 2>/dev/null || echo parse_err)" "number" "age_hours is a number"
    assert_eq "$(jq -r '.mtime | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")' <<<"$SSB_OUT" 2>/dev/null || echo parse_err)" \
        "true" "mtime is ISO-8601 UTC"
    ssb_teardown
}

test_no_leak() {
    CURRENT_TEST_NAME="TDB:1904: no key name or value ever appears in the output"
    ssb_setup
    local name="zz_leakcheck_key_name" value="zz-leakcheck-secret-value-9481"
    ssb_write_bundle "{\"$name\":\"$value\"}"
    ssb_probe
    assert_eq "$(ssb_field decrypts)" "true" "the leak check ran against a decrypted bundle"
    # Deliberately NOT assert_contains: its failure path would print the haystack.
    local leaked=no
    [[ "$SSB_OUT" == *"$name"* || "$SSB_OUT" == *"$value"* ]] && leaked=yes
    [[ "$SSB_OUT" == *"$RL_SETTINGS_BUNDLE_KEY"* ]] && leaked=yes
    assert_eq "$leaked" "no" "bundle key names, values and the bundle key stay out of the output"
    ssb_teardown
}

# The probe splits payload from warning on a sentinel. A decrypted VALUE that
# contains the sentinel must not truncate the JSON before the key count.
test_sentinel_in_value() {
    CURRENT_TEST_NAME="TDB:1904: a value containing the split sentinel still counts every key"
    ssb_setup
    ssb_write_bundle '{"a":"x__RL_SB_WARN__y","b":"2"}'
    ssb_probe
    assert_exit_code "$SSB_RC" 0 "exits 0 when a value contains the sentinel"
    assert_eq "$(ssb_field decrypts)" "true" "decrypts"
    assert_eq "$(ssb_field key_count)" "2" "key_count counts both keys despite the sentinel in a value"
    assert_eq "$(ssb_field warning)" "null" "no warning"
    ssb_teardown
}

test_status_wiring() {
    CURRENT_TEST_NAME="TDB:1904: bin/status embeds freshness_json as settings_bundle"
    local code
    code=$(grep -v '^[[:space:]]*#' "$BIN_DIR/status")
    assert_contains "$code" "settings_bundle::freshness_json" "status calls freshness_json"
    assert_contains "$code" "settings_bundle: \$settings_bundle" "status's jq emits a settings_bundle key"
}

run_test "tdb1904-absent" test_absent
run_test "tdb1904-unreadable" test_unreadable
run_test "tdb1904-no-key" test_no_key
run_test "tdb1904-wrong-key" test_wrong_key
run_test "tdb1904-good" test_good_bundle
run_test "tdb1904-no-leak" test_no_leak
run_test "tdb1904-sentinel-in-value" test_sentinel_in_value
run_test "tdb1904-status-wiring" test_status_wiring

print_test_summary
