#!/usr/bin/env bash
# A3-B P6 — env-spin must hand the operator's Discord identity to bootstrap-admin.
#
# The bug: a fleet env has no way to make the operator an admin. He signs in with
# Discord OAuth, lands as an ordinary member, and every admin surface — including
# the binding config form he was there to test — is unreachable, so he has to
# switch to admin@local behind a password mid-test.
#
# The wiring: /srv/rl-infra/.env carries RL_OPERATOR_DISCORD_ID (same home and
# same lifecycle as RL_ADMIN_PASSWORD; /state.sh sources it for every
# orchestrator script). env-spin threads it into the bootstrap-admin `docker
# exec` as FLEET_ADMIN_DISCORD_ID, on BOTH the fresh and the idempotent path.
# bootstrap-admin then upserts that one Discord id as an admin row, gated on
# DEMO_MODE=true so the promotion is impossible outside a fleet env
# (api/src/scripts/bootstrap-admin-fleet-operator.spec.ts pins the script side).
#
# Same PATH-shim pattern as env-spin-bot-identity.test.sh: a `docker` stub
# records every call so the spec can assert on the real argv. macOS bash 3.2.

set -uo pipefail

CURRENT_TEST_FILE="env-spin-fleet-operator.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ENV_SPIN_BIN="$BIN_DIR/env-spin"

OPERATOR_DISCORD_ID="111222333444555666"

# test_helpers.sh has assert_contains but no negative form; define one locally
# rather than editing the shared helper out from under sibling lanes.
assert_excludes() {
    local haystack="$1" needle="$2" message="${3:-}"
    if [[ "$haystack" != *"$needle"* ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message"
        echo "  expected NOT to contain: $needle"
        echo "  actual:                  $haystack"
    fi
}

fo_setup() {
    test_setup
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_CLAIMS_FILE="$RL_STATE_DIR/claims.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    export RL_TRAEFIK_CONF_D="$RL_STATE_DIR/traefik/conf.d"
    mkdir -p "$RL_TRAEFIK_CONF_D"
    unset RL_PUBLIC_DOMAIN || true
    unset RL_OPERATOR_DISCORD_ID || true
    export RL_AGENT_ID="fo-agent"
    export RL_OPERATOR=0
    cat > "$RL_CLAIMS_FILE" <<'JSON'
[{"slot": 1, "claimed": true, "agent_id": "fo-agent", "branch": "a3b", "started_at": "2026-09-03T00:00:00Z", "last_heartbeat": "2026-09-03T00:00:00Z"}]
JSON
    echo "[]" > "$RL_ENVS_FILE"

    FO_APP_EXISTS="false"
    FO_PG_EXISTS="false"
    export FO_APP_EXISTS FO_PG_EXISTS

    FO_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$FO_STUB_DIR"
    cat > "$FO_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RL_STATE_DIR/docker-calls.log"
case "$1" in
    inspect)
        target=""
        for a in "$@"; do
            case "$a" in
                rl-env-*-allinone) target="app" ;;
                rl-env-*-pg)       target="pg" ;;
            esac
        done
        # Answer existence only. Emitting a value here would be read back as
        # the container's rl.slot label and force the recreate path, which is
        # exactly the branch the idempotent test must NOT take.
        case "$target" in
            app) [[ "${FO_APP_EXISTS:-false}" == "true" ]] || exit 1; exit 0 ;;
            pg)  [[ "${FO_PG_EXISTS:-false}" == "true" ]] || exit 1; exit 0 ;;
        esac
        exit 0
        ;;
    image) shift; [[ "$1" == "inspect" ]] && { printf 'sha256:img\n'; exit 0; }; exit 0 ;;
    pull|rm|run|exec|restart) exit 0 ;;
    ps) printf '\n'; exit 0 ;;
esac
exit 0
STUB
    chmod +x "$FO_STUB_DIR/docker"
    cat > "$FO_STUB_DIR/openssl" <<'STUB'
#!/usr/bin/env bash
echo "deadbeefdeadbeef"
STUB
    chmod +x "$FO_STUB_DIR/openssl"
    cat > "$FO_STUB_DIR/overlay-stub" <<'STUB'
#!/usr/bin/env bash
echo '{"ok":true,"applied":[],"bot_identity":{"slot":1,"configured":false}}'
STUB
    chmod +x "$FO_STUB_DIR/overlay-stub"
    export RL_ENV_SETTINGS_OVERLAY="$FO_STUB_DIR/overlay-stub"
    export PATH="$FO_STUB_DIR:$PATH"
}

fo_teardown() {
    unset RL_ENVS_FILE RL_CLAIMS_FILE RL_AUDIT_LOG RL_TRAEFIK_CONF_D RL_OPERATOR \
          RL_ENV_SETTINGS_OVERLAY FO_STUB_DIR FO_APP_EXISTS FO_PG_EXISTS \
          RL_OPERATOR_DISCORD_ID 2>/dev/null || true
    test_teardown
}

run_spin() {
    local slug="$1"; shift
    FO_OUT=$(bash "$ENV_SPIN_BIN" --slug "$slug" "$@" 2>/dev/null)
    FO_RC=$?
}

# The single `docker exec ... bootstrap-admin.js` line, so an assertion can't
# be satisfied by the variable appearing on some unrelated docker call.
bootstrap_exec_line() {
    grep 'bootstrap-admin.js' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null \
        | tail -1 || true
}

# --- P6.1: fresh spin threads the configured id -----------------------------

test_fresh_spin_threads_operator_id() {
    CURRENT_TEST_NAME="P6: fresh spin passes FLEET_ADMIN_DISCORD_ID to bootstrap-admin"
    fo_setup
    export RL_OPERATOR_DISCORD_ID="$OPERATOR_DISCORD_ID"
    run_spin fresh1
    assert_exit_code "$FO_RC" "0" "fresh spin should succeed"
    local line
    line=$(bootstrap_exec_line)
    assert_contains "$line" "FLEET_ADMIN_DISCORD_ID=$OPERATOR_DISCORD_ID" \
        "bootstrap-admin exec must carry the operator's Discord id"
    fo_teardown
}

# --- P6.2: the idempotent re-spin threads it too ----------------------------

test_idempotent_respin_threads_operator_id() {
    CURRENT_TEST_NAME="P6: idempotent re-spin also passes FLEET_ADMIN_DISCORD_ID"
    fo_setup
    export RL_OPERATOR_DISCORD_ID="$OPERATOR_DISCORD_ID"
    export FO_APP_EXISTS="true" FO_PG_EXISTS="true"
    jq -n '[{slug: "steady", slot: 1, created_at: "2026-09-03T00:00:00Z"}]' \
        > "$RL_ENVS_FILE"
    run_spin steady
    assert_exit_code "$FO_RC" "0" "idempotent re-spin should succeed"
    assert_eq "$(jq -r '.idempotent' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "true" \
        "should take the idempotent path"
    local line
    line=$(bootstrap_exec_line)
    assert_contains "$line" "FLEET_ADMIN_DISCORD_ID=$OPERATOR_DISCORD_ID" \
        "the idempotent path must thread the operator id too (re-spins are the common case)"
    fo_teardown
}

# --- P6.3: unset on the VM → the variable is empty, never another value -----

test_unset_operator_id_threads_empty() {
    CURRENT_TEST_NAME="P6: RL_OPERATOR_DISCORD_ID unset → no id is promoted"
    fo_setup
    run_spin bare1
    assert_exit_code "$FO_RC" "0" "spin without an operator id should still succeed"
    local line
    line=$(bootstrap_exec_line)
    assert_contains "$line" "FLEET_ADMIN_DISCORD_ID=" \
        "the flag is always present so the script's own gate is the only branch"
    assert_excludes "$line" "FLEET_ADMIN_DISCORD_ID=$OPERATOR_DISCORD_ID" \
        "an unconfigured VM must not promote any identity"
    fo_teardown
}

# --- P6.4: the container-side gate is satisfiable in a fleet env ------------

test_env_container_sets_demo_mode() {
    CURRENT_TEST_NAME="P6: the env container runs with DEMO_MODE=true (the promotion gate)"
    fo_setup
    export RL_OPERATOR_DISCORD_ID="$OPERATOR_DISCORD_ID"
    run_spin fresh2
    assert_exit_code "$FO_RC" "0" "fresh spin should succeed"
    # bootstrap-admin refuses to promote unless DEMO_MODE === 'true'. That gate
    # is what keeps this out of production, so the fleet side must keep setting
    # it — dropping it here would silently disable the feature.
    assert_contains "$(cat "$RL_STATE_DIR/docker-calls.log" 2>/dev/null || echo "")" \
        "DEMO_MODE=true" \
        "the allinone must run with DEMO_MODE=true or the promotion can never fire"
    fo_teardown
}

run_test "p6-fresh-threads-id" test_fresh_spin_threads_operator_id
run_test "p6-idempotent-threads-id" test_idempotent_respin_threads_operator_id
run_test "p6-unset-threads-empty" test_unset_operator_id_threads_empty
run_test "p6-demo-mode-gate-present" test_env_container_sets_demo_mode

print_test_summary
