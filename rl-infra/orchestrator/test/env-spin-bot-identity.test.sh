#!/usr/bin/env bash
# ROK-1469 D1/D3 — env-spin per-slot Discord bot identity.
#
# D1: every env gets ITS SLOT's Discord app — env-spin injects the slot's
#     RL_SLOT_<N>_DISCORD_* into the container AND runs the settings overlay
#     so app_settings carries the slot identity even after sync_settings has
#     copied the operator's laptop rows over it.
# D3: at most ONE live env per slot may hold that identity — a second env on
#     the same slot is refused with `bot_identity_in_use` (two containers
#     logging in with one bot token flap the gateway connection).
#
# Same PATH-shim pattern as env-spin.test.sh: a `docker` stub records calls
# and answers off ES_* globals. The overlay is stubbed through the
# RL_ENV_SETTINGS_OVERLAY seam so no container is needed. macOS bash 3.2.

set -uo pipefail

CURRENT_TEST_FILE="env-spin-bot-identity.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ENV_SPIN_BIN="$BIN_DIR/env-spin"
ENV_DESTROY_BIN="$BIN_DIR/env-destroy"

bi_setup() {
    test_setup
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_CLAIMS_FILE="$RL_STATE_DIR/claims.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    export RL_TRAEFIK_CONF_D="$RL_STATE_DIR/traefik/conf.d"
    mkdir -p "$RL_TRAEFIK_CONF_D"
    unset RL_PUBLIC_DOMAIN || true
    export RL_AGENT_ID="bi-agent"
    export RL_OPERATOR=0
    cat > "$RL_CLAIMS_FILE" <<'JSON'
[{"slot": 1, "claimed": true, "agent_id": "bi-agent", "branch": "rok-1469", "started_at": "2026-09-02T00:00:00Z", "last_heartbeat": "2026-09-02T00:00:00Z"}]
JSON
    echo "[]" > "$RL_ENVS_FILE"

    BI_APP_EXISTS="false"
    BI_PG_EXISTS="false"
    BI_HOLDER_APP_EXISTS="true"
    export BI_APP_EXISTS BI_PG_EXISTS BI_HOLDER_APP_EXISTS

    BI_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$BI_STUB_DIR"
    cat > "$BI_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RL_STATE_DIR/docker-calls.log"
case "$1" in
    inspect)
        target=""
        for a in "$@"; do
            case "$a" in
                rl-env-holder-allinone) target="holder" ;;
                rl-env-*-allinone)      target="app" ;;
                rl-env-*-pg)            target="pg" ;;
            esac
        done
        case "$target" in
            holder) [[ "${BI_HOLDER_APP_EXISTS:-true}" == "true" ]] || exit 1; echo "1"; exit 0 ;;
            app)    [[ "${BI_APP_EXISTS:-false}" == "true" ]] || exit 1; exit 0 ;;
            pg)     [[ "${BI_PG_EXISTS:-false}" == "true" ]] || exit 1; exit 0 ;;
        esac
        exit 0
        ;;
    image) shift; [[ "$1" == "inspect" ]] && { printf 'sha256:img\n'; exit 0; }; exit 0 ;;
    pull|run|rm|exec) exit 0 ;;
    ps) printf '\n'; exit 0 ;;
esac
exit 0
STUB
    chmod +x "$BI_STUB_DIR/docker"
    cat > "$BI_STUB_DIR/openssl" <<'STUB'
#!/usr/bin/env bash
echo "deadbeefdeadbeef"
STUB
    chmod +x "$BI_STUB_DIR/openssl"
    export PATH="$BI_STUB_DIR:$PATH"

    # Overlay seam: record argv, emit a realistic overlay result.
    BI_OVERLAY_LOG="$RL_STATE_DIR/overlay-calls.log"
    BI_OVERLAY_RC=0
    export BI_OVERLAY_LOG BI_OVERLAY_RC
    cat > "$BI_STUB_DIR/overlay-stub" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$BI_OVERLAY_LOG"
if [[ "${BI_OVERLAY_RC:-0}" != "0" ]]; then
    echo '{"ok":false,"error":"settings_overlay_failed","detail":"stub failure"}'
    exit "${BI_OVERLAY_RC}"
fi
echo '{"ok":true,"applied":["discord_bot_token","discord_client_id"],"bot_identity":{"slot":1,"client_id":"100000000000000001","app_name":"RL Test Slot 1","configured":true}}'
STUB
    chmod +x "$BI_STUB_DIR/overlay-stub"
    export RL_ENV_SETTINGS_OVERLAY="$BI_STUB_DIR/overlay-stub"

    export RL_SLOT_1_DISCORD_BOT_TOKEN="tok-slot-1-secret"
    export RL_SLOT_1_DISCORD_CLIENT_ID="100000000000000001"
    export RL_SLOT_1_DISCORD_CLIENT_SECRET="csec-slot-1-secret"
    export RL_SLOT_1_DISCORD_APP_NAME="RL Test Slot 1"
}

bi_teardown() {
    unset RL_ENVS_FILE RL_CLAIMS_FILE RL_AUDIT_LOG RL_TRAEFIK_CONF_D RL_OPERATOR \
          RL_ENV_SETTINGS_OVERLAY BI_OVERLAY_LOG BI_OVERLAY_RC BI_STUB_DIR \
          BI_APP_EXISTS BI_PG_EXISTS BI_HOLDER_APP_EXISTS \
          RL_SLOT_1_DISCORD_BOT_TOKEN RL_SLOT_1_DISCORD_CLIENT_ID \
          RL_SLOT_1_DISCORD_CLIENT_SECRET RL_SLOT_1_DISCORD_APP_NAME 2>/dev/null || true
    test_teardown
}

run_spin() {
    local slug="$1"; shift
    BI_OUT=$("$ENV_SPIN_BIN" --slug "$slug" "$@" 2>/dev/null)
    BI_RC=$?
}

# --- D1.1: the slot identity reaches the container as env vars ---------------

test_slot_identity_injected_into_container() {
    CURRENT_TEST_NAME="D1: docker run injects the slot's RL_SLOT_DISCORD_* env vars"
    bi_setup
    run_spin fresh1
    assert_exit_code "$BI_RC" "0" "fresh spin should succeed"
    local run_line
    run_line=$(grep -E '^run .*--name rl-env-fresh1-allinone' "$RL_STATE_DIR/docker-calls.log" | head -1 || true)
    assert_contains "$run_line" "RL_SLOT_DISCORD_BOT_TOKEN=tok-slot-1-secret" \
        "allinone must receive the slot bot token"
    assert_contains "$run_line" "RL_SLOT_DISCORD_CLIENT_ID=100000000000000001" \
        "allinone must receive the slot client id"
    assert_contains "$run_line" "RL_SLOT_DISCORD_CLIENT_SECRET=csec-slot-1-secret" \
        "allinone must receive the slot client secret"
    bi_teardown
}

# --- D1.2: env-spin runs the overlay and surfaces bot_identity ---------------

test_spin_runs_overlay_and_reports_identity() {
    CURRENT_TEST_NAME="D1: env-spin runs the settings overlay and reports bot_identity"
    bi_setup
    run_spin fresh2
    assert_exit_code "$BI_RC" "0" "fresh spin should succeed"
    local calls
    calls=$(cat "$BI_OVERLAY_LOG" 2>/dev/null || echo "")
    assert_contains "$calls" "--slug fresh2" "overlay must be called for the slug"
    assert_contains "$calls" "--slot 1" "overlay must be called with the resolved slot"
    assert_eq "$(jq -r '.bot_identity.client_id' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" \
        "100000000000000001" "env-spin output must carry the PUBLIC client id"
    if [[ "$BI_OUT" == *"tok-slot-1-secret"* || "$BI_OUT" == *"csec-slot-1-secret"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: secret leaked into env-spin output")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] secret leaked into env-spin output"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    bi_teardown
}

# --- D1.3: the idempotent re-spin re-applies the identity -------------------

test_idempotent_respin_reapplies_overlay() {
    CURRENT_TEST_NAME="D1: idempotent re-spin re-applies the slot identity"
    bi_setup
    export BI_APP_EXISTS="true" BI_PG_EXISTS="true"
    jq -n '[{slug: "steady", slot: 1, created_at: "2026-09-02T00:00:00Z"}]' > "$RL_ENVS_FILE"
    printf '%s' '{"slug":"steady","claimed_at":"2026-09-02T00:00:00Z"}' \
        > /dev/null   # placeholder: holder state is written by env-spin itself
    run_spin steady
    assert_exit_code "$BI_RC" "0" "idempotent re-spin should succeed"
    assert_eq "$(jq -r '.idempotent' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" "true" \
        "should take the idempotent path"
    assert_contains "$(cat "$BI_OVERLAY_LOG" 2>/dev/null || echo "")" "--slug steady" \
        "overlay must run on the idempotent path too"
    bi_teardown
}

# --- D1.4: an overlay failure warns, it does not kill the spin --------------

test_overlay_failure_is_a_warning() {
    CURRENT_TEST_NAME="D1: overlay failure surfaces a warning, env-spin still ok"
    bi_setup
    export BI_OVERLAY_RC=1
    run_spin warned
    assert_exit_code "$BI_RC" "0" "overlay failure must not fail the spin"
    assert_eq "$(jq -r '.ok' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" "true" ".ok stays true"
    assert_eq "$(jq -r '.overlay_warnings[0].code' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" \
        "settings_overlay_failed" "the failure is reported as a warning"
    bi_teardown
}

# --- D3.1: a second live env on the slot is refused -------------------------

test_second_env_on_slot_refused() {
    CURRENT_TEST_NAME="D3: second env on a slot whose bot is live → bot_identity_in_use"
    bi_setup
    # slot 1's identity is already held by a RUNNING env ("holder").
    mkdir -p "$RL_STATE_DIR/bot-identity"
    jq -n '{slug: "holder", claimed_at: "2026-09-02T00:00:00Z"}' \
        > "$RL_STATE_DIR/bot-identity/slot-1.json"
    export BI_HOLDER_APP_EXISTS="true"

    run_spin second
    assert_exit_code "$BI_RC" "1" "second env must be refused"
    assert_eq "$(jq -r '.ok' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" "false" ".ok == false"
    assert_eq "$(jq -r '.error' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" \
        "bot_identity_in_use" ".error == bot_identity_in_use"
    assert_eq "$(jq -r '.held_by' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" \
        "holder" ".held_by names the env holding the identity"
    # No containers may be created for the refused env.
    local run_line
    run_line=$(grep -E '^run .*--name rl-env-second-' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_eq "$run_line" "" "refused spin must not create containers"
    bi_teardown
}

# --- D3.2: a stale holder (container gone) is reclaimed ----------------------

test_stale_holder_is_reclaimed() {
    CURRENT_TEST_NAME="D3: holder whose container is gone → identity reclaimed"
    bi_setup
    mkdir -p "$RL_STATE_DIR/bot-identity"
    jq -n '{slug: "holder", claimed_at: "2026-09-02T00:00:00Z"}' \
        > "$RL_STATE_DIR/bot-identity/slot-1.json"
    export BI_HOLDER_APP_EXISTS="false"   # holder container no longer exists

    run_spin reclaimer
    assert_exit_code "$BI_RC" "0" "stale holder must not block a new env"
    assert_eq "$(jq -r '.ok' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" "true" ".ok == true"
    assert_eq "$(jq -r '.slug' "$RL_STATE_DIR/bot-identity/slot-1.json" 2>/dev/null || echo parse_err)" \
        "reclaimer" "the new env takes ownership of the slot identity"
    bi_teardown
}

# --- D3.3: re-spinning the SAME slug keeps its own identity ------------------

test_same_slug_respin_allowed() {
    CURRENT_TEST_NAME="D3: re-spinning the holder itself is allowed"
    bi_setup
    export BI_APP_EXISTS="true" BI_PG_EXISTS="true"
    jq -n '[{slug: "steady", slot: 1, created_at: "2026-09-02T00:00:00Z"}]' > "$RL_ENVS_FILE"
    mkdir -p "$RL_STATE_DIR/bot-identity"
    jq -n '{slug: "steady", claimed_at: "2026-09-02T00:00:00Z"}' \
        > "$RL_STATE_DIR/bot-identity/slot-1.json"

    run_spin steady
    assert_exit_code "$BI_RC" "0" "self re-spin must not be refused"
    assert_eq "$(jq -r '.ok' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" "true" ".ok == true"
    bi_teardown
}

# --- D3.4: a slot with no identity configured never refuses ------------------

test_unconfigured_slot_never_refuses() {
    CURRENT_TEST_NAME="D3: unconfigured slot identity → no refusal (nothing to collide over)"
    bi_setup
    unset RL_SLOT_1_DISCORD_BOT_TOKEN RL_SLOT_1_DISCORD_CLIENT_ID
    mkdir -p "$RL_STATE_DIR/bot-identity"
    jq -n '{slug: "holder", claimed_at: "2026-09-02T00:00:00Z"}' \
        > "$RL_STATE_DIR/bot-identity/slot-1.json"
    export BI_HOLDER_APP_EXISTS="true"

    run_spin nobot
    assert_exit_code "$BI_RC" "0" "no slot identity → no one-live-bot rule to enforce"
    assert_eq "$(jq -r '.ok' <<<"$BI_OUT" 2>/dev/null || echo parse_err)" "true" ".ok == true"
    bi_teardown
}

# --- D3.5: env-destroy releases the slot identity ---------------------------

test_destroy_clears_identity_holder() {
    CURRENT_TEST_NAME="D3: env-destroy clears the slot's bot-identity holder"
    bi_setup
    jq -n '[{slug: "goner", slot: 1, created_at: "2026-09-02T00:00:00Z"}]' > "$RL_ENVS_FILE"
    mkdir -p "$RL_STATE_DIR/bot-identity"
    jq -n '{slug: "goner", claimed_at: "2026-09-02T00:00:00Z"}' \
        > "$RL_STATE_DIR/bot-identity/slot-1.json"

    "$ENV_DESTROY_BIN" --slug goner --force >/dev/null 2>&1
    assert_file_not_exists "$RL_STATE_DIR/bot-identity/slot-1.json" \
        "destroying the holder must free the slot identity"
    bi_teardown
}

# --- D3.6: env-destroy of a NON-holder leaves the holder alone --------------

test_destroy_of_non_holder_preserves_state() {
    CURRENT_TEST_NAME="D3: destroying a non-holder env leaves the holder's claim intact"
    bi_setup
    jq -n '[{slug: "sibling", slot: 1, created_at: "2026-09-02T00:00:00Z"}]' > "$RL_ENVS_FILE"
    mkdir -p "$RL_STATE_DIR/bot-identity"
    jq -n '{slug: "holder", claimed_at: "2026-09-02T00:00:00Z"}' \
        > "$RL_STATE_DIR/bot-identity/slot-1.json"

    "$ENV_DESTROY_BIN" --slug sibling --force >/dev/null 2>&1
    assert_eq "$(jq -r '.slug' "$RL_STATE_DIR/bot-identity/slot-1.json" 2>/dev/null || echo parse_err)" \
        "holder" "holder claim must survive an unrelated destroy"
    bi_teardown
}

run_test "d1-identity-env-vars" test_slot_identity_injected_into_container
run_test "d1-overlay-invoked" test_spin_runs_overlay_and_reports_identity
run_test "d1-idempotent-overlay" test_idempotent_respin_reapplies_overlay
run_test "d1-overlay-warning" test_overlay_failure_is_a_warning
run_test "d3-second-env-refused" test_second_env_on_slot_refused
run_test "d3-stale-holder-reclaim" test_stale_holder_is_reclaimed
run_test "d3-same-slug-respin" test_same_slug_respin_allowed
run_test "d3-unconfigured-no-refusal" test_unconfigured_slot_never_refuses
run_test "d3-destroy-clears" test_destroy_clears_identity_holder
run_test "d3-destroy-non-holder" test_destroy_of_non_holder_preserves_state

print_test_summary
