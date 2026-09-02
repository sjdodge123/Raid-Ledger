#!/usr/bin/env bash
# ROK-1469 D2 — per-slot bot identity is VISIBLE to agents.
#
# An agent debugging "why did my embed land in the other env" must be able to
# see which Discord app an env is running as. Both env-state surfaces carry
# it: `env-inspect <slug>` (per-env snapshot) and `status`'s envs[] (fleet
# snapshot, via bot_identity::augment_envs). The client id is PUBLIC; the
# token and client secret must never appear in either.

set -uo pipefail

CURRENT_TEST_FILE="bot-identity-visibility.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

biv_setup() {
    test_setup
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    export RL_USE_DOCKER_SOCKET=1
    BIV_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$BIV_STUB_DIR"
    cat > "$BIV_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
    fmt=""; prev=""
    for a in "$@"; do
        if [[ "$prev" == "--format" ]]; then fmt="$a"; fi
        prev="$a"
    done
    case "$fmt" in
        '{{.State.Running}}') echo "true" ;;
        '{{.State.Status}}')  echo "running" ;;
        '{{.State.Health.Status}}') echo "" ;;
        *) echo "" ;;
    esac
    exit 0
fi
exit 0
STUB
    chmod +x "$BIV_STUB_DIR/docker"
    export PATH="$BIV_STUB_DIR:$PATH"
    export RL_SLOT_3_DISCORD_BOT_TOKEN="tok-slot-3-secret"
    export RL_SLOT_3_DISCORD_CLIENT_ID="300000000000000003"
    export RL_SLOT_3_DISCORD_CLIENT_SECRET="csec-slot-3-secret"
    export RL_SLOT_3_DISCORD_APP_NAME="RL Test Slot 3"
}

biv_teardown() {
    unset RL_ENVS_FILE RL_AUDIT_LOG RL_USE_DOCKER_SOCKET BIV_STUB_DIR \
          RL_SLOT_3_DISCORD_BOT_TOKEN RL_SLOT_3_DISCORD_CLIENT_ID \
          RL_SLOT_3_DISCORD_CLIENT_SECRET RL_SLOT_3_DISCORD_APP_NAME 2>/dev/null || true
    test_teardown
}

# D2.1 — env-inspect surfaces the identity, secrets excluded.
test_env_inspect_reports_bot_identity() {
    CURRENT_TEST_NAME="D2: env-inspect returns bot_identity (public fields only)"
    biv_setup
    jq -n '[{slug: "viz1", slot: 3, created_at: "2026-09-02T00:00:00Z"}]' > "$RL_ENVS_FILE"

    local out rc=0
    out=$("$BIN_DIR/env-inspect" viz1 2>/dev/null) || rc=$?
    assert_exit_code "$rc" "0" "env-inspect should exit 0"
    assert_eq "$(jq -r '.bot_identity.slot' <<<"$out" 2>/dev/null || echo parse_err)" "3" \
        ".bot_identity.slot == 3"
    assert_eq "$(jq -r '.bot_identity.client_id' <<<"$out" 2>/dev/null || echo parse_err)" \
        "300000000000000003" ".bot_identity.client_id is the public app id"
    assert_eq "$(jq -r '.bot_identity.app_name' <<<"$out" 2>/dev/null || echo parse_err)" \
        "RL Test Slot 3" ".bot_identity.app_name names the portal app"
    assert_eq "$(jq -r '.bot_identity.configured' <<<"$out" 2>/dev/null || echo parse_err)" \
        "true" ".bot_identity.configured == true"
    if [[ "$out" == *"tok-slot-3-secret"* || "$out" == *"csec-slot-3-secret"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: secret leaked")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] token/secret leaked into env-inspect output"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    biv_teardown
}

# D2.2 — status's envs[] augmentation, tested on the pure helper.
test_status_envs_augmented_with_identity() {
    CURRENT_TEST_NAME="D2: bot_identity::augment_envs stamps each env with its slot identity"
    biv_setup
    # shellcheck disable=SC1091
    source "$BIN_DIR/_state.sh"
    # shellcheck disable=SC1091
    source "$BIN_DIR/_bot_identity.sh"

    local envs out
    envs='[{"container":"rl-env-viz1-allinone","slug":"viz1","slot":"3"},
           {"container":"rl-env-viz2-allinone","slug":"viz2","slot":null}]'
    out=$(bot_identity::augment_envs "$envs")
    assert_eq "$(jq -r '.[0].bot_identity.client_id' <<<"$out" 2>/dev/null || echo parse_err)" \
        "300000000000000003" "slot-3 env carries slot 3's client id"
    assert_eq "$(jq -r '.[1].bot_identity' <<<"$out" 2>/dev/null || echo parse_err)" "null" \
        "an env with no resolvable slot gets bot_identity:null"
    assert_eq "$(jq -r 'length' <<<"$out" 2>/dev/null || echo parse_err)" "2" \
        "augmentation preserves the array length"
    if [[ "$out" == *"tok-slot-3-secret"* || "$out" == *"csec-slot-3-secret"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: secret leaked")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] token/secret leaked into status envs[]"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    biv_teardown
}

# D2.3 — an unconfigured slot reports configured:false, not a fake identity.
test_unconfigured_slot_reports_false() {
    CURRENT_TEST_NAME="D2: unconfigured slot reports configured:false with null ids"
    biv_setup
    jq -n '[{slug: "viz9", slot: 1, created_at: "2026-09-02T00:00:00Z"}]' > "$RL_ENVS_FILE"
    local out
    out=$("$BIN_DIR/env-inspect" viz9 2>/dev/null)
    assert_eq "$(jq -r '.bot_identity.configured' <<<"$out" 2>/dev/null || echo parse_err)" \
        "false" "slot 1 has no identity configured in this fixture"
    assert_eq "$(jq -r '.bot_identity.client_id' <<<"$out" 2>/dev/null || echo parse_err)" \
        "null" "client_id is null, not empty string"
    biv_teardown
}

run_test "d2-env-inspect" test_env_inspect_reports_bot_identity
run_test "d2-status-envs" test_status_envs_augmented_with_identity
run_test "d2-unconfigured" test_unconfigured_slot_reports_false

print_test_summary
