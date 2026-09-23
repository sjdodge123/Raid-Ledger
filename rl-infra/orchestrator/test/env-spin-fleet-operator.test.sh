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
    FO_APP_ENV=""
    export FO_APP_EXISTS FO_PG_EXISTS FO_APP_ENV

    FO_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$FO_STUB_DIR"
    cat > "$FO_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RL_STATE_DIR/docker-calls.log"
case "$1" in
    inspect)
        # ROK-1537: env-spin reads the reused container's env to report
        # operator_admin on the idempotent path. FO_APP_ENV is that env.
        if [[ "$*" == *".Config.Env"* ]]; then
            [[ -n "${FO_APP_ENV:-}" ]] && printf '%s\n' "$FO_APP_ENV"
            exit 0
        fi
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
          RL_ENV_SETTINGS_OVERLAY FO_STUB_DIR FO_APP_EXISTS FO_PG_EXISTS FO_APP_ENV \
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

# The app container's `docker run` line (never the PG one), so ROK-1537's
# marker can't be satisfied by an unrelated call.
app_run_line() {
    grep -E '^run .*--name rl-env-[a-z0-9-]+-allinone' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null \
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

# --- ROK-1537: first-login marker + id on the app container ------------------

test_fresh_spin_sets_marker_and_id() {
    CURRENT_TEST_NAME="ROK-1537: fresh spin passes the first-login marker and the operator id to the app"
    fo_setup
    export RL_OPERATOR_DISCORD_ID="$OPERATOR_DISCORD_ID"
    run_spin fresh3
    assert_exit_code "$FO_RC" "0" "fresh spin should succeed"
    local line
    line=$(app_run_line)
    assert_contains "$line" "FLEET_FIRST_DISCORD_LOGIN_ADMIN=true" \
        "the app container must carry the first-login marker the API gates on"
    assert_contains "$line" "FLEET_ADMIN_DISCORD_ID=$OPERATOR_DISCORD_ID" \
        "the app container must carry the configured id so the API skips first-login promotion"
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "configured" \
        "an id on the VM reports operator_admin=configured"
    fo_teardown
}

test_fresh_spin_unset_id_reports_first_login() {
    CURRENT_TEST_NAME="ROK-1537: fresh spin without an id → marker set, id empty, operator_admin=first-login"
    fo_setup
    run_spin fresh4
    assert_exit_code "$FO_RC" "0" "fresh spin should succeed"
    local line
    line=$(app_run_line)
    assert_contains "$line" "FLEET_FIRST_DISCORD_LOGIN_ADMIN=true" \
        "the marker is passed whether or not an id is configured"
    assert_contains "$line" "FLEET_ADMIN_DISCORD_ID= " \
        "the id flag is present but empty on an unconfigured VM"
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "first-login" \
        "no id + marker reports operator_admin=first-login"
    fo_teardown
}

test_idempotent_reports_from_container_env() {
    CURRENT_TEST_NAME="ROK-1537: idempotent re-spin reads operator_admin from the reused container"
    fo_setup
    export FO_APP_EXISTS="true" FO_PG_EXISTS="true"
    jq -n '[{slug: "old", slot: 1, created_at: "2026-09-03T00:00:00Z"}]' > "$RL_ENVS_FILE"
    run_spin old
    assert_eq "$(jq -r '.idempotent' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "true" \
        "should take the idempotent path"
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "none" \
        "a pre-ROK-1537 container (no marker) with no id must report none, not first-login"
    assert_excludes "$(app_run_line)" "allinone" "the idempotent path must not re-run the app container"
    export FO_APP_ENV=$'DEMO_MODE=true\nFLEET_FIRST_DISCORD_LOGIN_ADMIN=true'
    run_spin old
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "first-login" \
        "a reused container that carries the marker reports first-login"
    # Review MINOR: the id the container was CREATED with keeps the API's
    # first-login gate off even after the VM setting is removed.
    export FO_APP_ENV=$'DEMO_MODE=true\nFLEET_FIRST_DISCORD_LOGIN_ADMIN=true\nFLEET_ADMIN_DISCORD_ID=987654321098765432'
    run_spin old
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "configured" \
        "a reused container created with an id reports configured though the VM id is now unset"
    export FO_APP_ENV=$'DEMO_MODE=true\nFLEET_FIRST_DISCORD_LOGIN_ADMIN=true\nFLEET_ADMIN_DISCORD_ID='
    run_spin old
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "first-login" \
        "an empty id in the container env is not configured"
    export RL_OPERATOR_DISCORD_ID="$OPERATOR_DISCORD_ID"
    run_spin old
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "configured" \
        "a configured id wins on the idempotent path (bootstrap upserts it there too)"
    fo_teardown
}

# --- Codex P2: a malformed id is treated as unset -----------------------------

MALFORMED_DISCORD_ID="not-a-snowflake-42"

test_malformed_id_falls_back_to_first_login() {
    CURRENT_TEST_NAME="Codex P2: malformed RL_OPERATOR_DISCORD_ID → empty id, first-login, one warning"
    fo_setup
    export RL_OPERATOR_DISCORD_ID="$MALFORMED_DISCORD_ID"
    local err_file="$RL_STATE_DIR/spin-stderr.log"
    FO_OUT=$(bash "$ENV_SPIN_BIN" --slug badid1 2>"$err_file")
    FO_RC=$?
    assert_exit_code "$FO_RC" "0" "a malformed id must not fail the spin"
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "first-login" \
        "a malformed id bootstrap-admin rejects must not report configured"
    assert_contains "$(app_run_line)" "FLEET_ADMIN_DISCORD_ID= " \
        "the app container gets an empty id so the API keeps first-login promotion on"
    assert_excludes "$(cat "$RL_STATE_DIR/docker-calls.log" 2>/dev/null)" "$MALFORMED_DISCORD_ID" \
        "the malformed value reaches no docker call"
    local err
    err=$(cat "$err_file" 2>/dev/null)
    assert_eq "$(grep -c 'RL_OPERATOR_DISCORD_ID is not a Discord snowflake' "$err_file" 2>/dev/null)" "1" \
        "exactly one stderr warning names the problem"
    assert_excludes "$err" "$MALFORMED_DISCORD_ID" "the warning never echoes the value"
    fo_teardown
}

test_malformed_id_idempotent_path() {
    CURRENT_TEST_NAME="Codex P2: idempotent re-spin applies the snowflake rule to VM and container ids"
    fo_setup
    export FO_APP_EXISTS="true" FO_PG_EXISTS="true"
    jq -n '[{slug: "oldbad", slot: 1, created_at: "2026-09-03T00:00:00Z"}]' > "$RL_ENVS_FILE"
    export RL_OPERATOR_DISCORD_ID="$MALFORMED_DISCORD_ID"
    export FO_APP_ENV=$'DEMO_MODE=true\nFLEET_FIRST_DISCORD_LOGIN_ADMIN=true\nFLEET_ADMIN_DISCORD_ID='
    run_spin oldbad
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "first-login" \
        "a malformed VM id is ignored on the idempotent path too"
    assert_excludes "$(bootstrap_exec_line)" "$MALFORMED_DISCORD_ID" \
        "the idempotent bootstrap exec never carries the malformed value"
    unset RL_OPERATOR_DISCORD_ID
    export FO_APP_ENV=$'DEMO_MODE=true\nFLEET_FIRST_DISCORD_LOGIN_ADMIN=true\nFLEET_ADMIN_DISCORD_ID=bad-id'
    run_spin oldbad
    assert_eq "$(jq -r '.operator_admin' <<<"$FO_OUT" 2>/dev/null || echo parse_err)" "none" \
        "a container created with a malformed id has neither path (bootstrap rejects it, the API sees non-empty)"
    fo_teardown
}

run_test "p6-fresh-threads-id" test_fresh_spin_threads_operator_id
run_test "p6-idempotent-threads-id" test_idempotent_respin_threads_operator_id
run_test "p6-unset-threads-empty" test_unset_operator_id_threads_empty
run_test "p6-demo-mode-gate-present" test_env_container_sets_demo_mode
run_test "1537-fresh-marker-and-id" test_fresh_spin_sets_marker_and_id
run_test "1537-fresh-unset-first-login" test_fresh_spin_unset_id_reports_first_login
run_test "1537-idempotent-reads-container" test_idempotent_reports_from_container_env
run_test "p2-malformed-fresh" test_malformed_id_falls_back_to_first_login
run_test "p2-malformed-idempotent" test_malformed_id_idempotent_path

print_test_summary
