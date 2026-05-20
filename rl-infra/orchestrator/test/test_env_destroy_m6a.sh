#!/usr/bin/env bash
# ROK-1331 M6a — env-destroy cleanup chunks (chunk 1 MED/LOW).
#
# AC3: successor liveness probe BEFORE rewriting slot Traefik conf.
# AC4: successor conf merge preserves existing middlewares/tls (replace
#      ONLY the rule: line, not the whole file).
# AC12: flock-failure path emits an audit log line + warning (never silent).
#
# These tests stub `docker` so the env-destroy binary can run without a
# live Docker daemon. The stub records calls and returns canned output.

set -uo pipefail

CURRENT_TEST_FILE="test_env_destroy_m6a.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

# --- env-destroy-specific setup ----------------------------------------------

ENV_DESTROY_BIN="$BIN_DIR/env-destroy"

# Per-test fixture builder. Creates an isolated state dir + Traefik conf dir
# + docker stub. Returns paths via globals.
m6a_setup() {
    test_setup
    # Override the orchestrator's state files to live in our tmp dir.
    export RL_ENVS_FILE="$RL_STATE_DIR/envs.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    # Traefik conf directory under our control.
    export RL_TRAEFIK_CONF_D="$RL_STATE_DIR/traefik/conf.d"
    mkdir -p "$RL_TRAEFIK_CONF_D"
    # Force a public domain so the slot-rule re-registration logic activates.
    export RL_PUBLIC_DOMAIN="gamernight.net"
    # Disable the ownership check so we can target any slug.
    export RL_FORCE_DESTROY=1

    # Bootstrap envs.json with TWO envs on slot=1: the destroyed slug + a
    # successor. created_at ordering: destroyed is newer, successor is older
    # (so successor is selected as the next-oldest).
    cat > "$RL_ENVS_FILE" <<JSON
[
  {"slug": "destroyed-a", "slot": 1, "created_at": "2026-05-20T11:00:00Z"},
  {"slug": "successor-b", "slot": 1, "created_at": "2026-05-19T10:00:00Z"}
]
JSON

    # Destroyed env's conf — carries the slot Host rule (owner).
    cat > "$RL_TRAEFIK_CONF_D/env-destroyed-a.yml" <<EOF
http:
  routers:
    env-destroyed-a:
      rule: "Host(\`destroyed-a.rl.lan\`) || Host(\`destroyed-atest.gamernight.net\`) || Host(\`slot-1.gamernight.net\`)"
      service: env-destroyed-a
      entryPoints: [web]
  services:
    env-destroyed-a:
      loadBalancer:
        servers:
          - url: "http://rl-env-destroyed-a-allinone:80"
EOF

    # Stub PATH so our fake docker runs first. The stub writes call-log to
    # RL_STATE_DIR/docker-calls.log and returns based on the first arg.
    M6A_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$M6A_STUB_DIR"
    cat > "$M6A_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
# Test stub for `docker`. Tests set M6A_SUCCESSOR_RUNNING to "true"/"false"
# to control the inspect probe result.
echo "$*" >> "$RL_STATE_DIR/docker-calls.log"
case "$1" in
    inspect)
        # docker inspect <container> --format '{{.State.Running}}'
        # Tests pre-set M6A_SUCCESSOR_RUNNING.
        # Return label-lookup for ownership check separately.
        if [[ "$*" == *"--format"* && "$*" == *"State.Running"* ]]; then
            printf '%s\n' "${M6A_SUCCESSOR_RUNNING:-true}"
            exit 0
        fi
        if [[ "$*" == *"rl.slot"* ]]; then
            # Slot label lookup — always return our test slot.
            printf '%s\n' "1"
            exit 0
        fi
        printf '\n'
        exit 0
        ;;
    rm|volume)
        exit 0
        ;;
esac
exit 0
STUB
    chmod +x "$M6A_STUB_DIR/docker"
    export PATH="$M6A_STUB_DIR:$PATH"
}

m6a_teardown() {
    test_teardown
    unset RL_ENVS_FILE RL_AUDIT_LOG RL_TRAEFIK_CONF_D RL_PUBLIC_DOMAIN
    unset RL_FORCE_DESTROY M6A_STUB_DIR M6A_SUCCESSOR_RUNNING
}

# --- AC3: successor liveness probe -------------------------------------------

test_env_destroy_skips_dead_successor() {
    CURRENT_TEST_NAME="AC3: env-destroy SKIPS slot-rule reassignment when successor is dead"
    m6a_setup
    # Pre-create the successor's conf (so the script could overwrite it).
    cat > "$RL_TRAEFIK_CONF_D/env-successor-b.yml" <<EOF
# Original successor conf — middleware should NOT be erased by env-destroy.
http:
  routers:
    env-successor-b:
      rule: "Host(\`successor-b.rl.lan\`) || Host(\`successor-btest.gamernight.net\`)"
      service: env-successor-b
      middlewares: [custom-mw]
      entryPoints: [web]
EOF
    # Mark successor's allinone as STOPPED.
    export M6A_SUCCESSOR_RUNNING="false"

    # Invoke env-destroy.
    "$ENV_DESTROY_BIN" --slug destroyed-a --force >/dev/null 2>&1 || true

    # The successor conf must NOT contain the slot Host rule (since we
    # refused to rewrite it).
    local successor_conf
    successor_conf=$(cat "$RL_TRAEFIK_CONF_D/env-successor-b.yml" 2>/dev/null || echo "")
    if [[ "$successor_conf" == *"slot-1.gamernight.net"* ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: successor conf was rewritten even though container was dead")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] successor conf contains slot Host rule despite dead container"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi
    # An audit log entry MUST mark the skip.
    local audit_line
    audit_line=$(grep -E '"event":\s*"slot-rule-skip-dead-successor"|slot-rule-skip-dead-successor' "$RL_AUDIT_LOG" 2>/dev/null | head -1 || true)
    assert_neq "$audit_line" "" "audit log should record slot-rule-skip-dead-successor"

    m6a_teardown
}

# --- AC4: successor conf merge preserves middleware ---------------------------

test_env_destroy_preserves_successor_middleware() {
    CURRENT_TEST_NAME="AC4: env-destroy preserves successor conf middleware/tls"
    m6a_setup
    cat > "$RL_TRAEFIK_CONF_D/env-successor-b.yml" <<EOF
http:
  routers:
    env-successor-b:
      rule: "Host(\`successor-b.rl.lan\`) || Host(\`successor-btest.gamernight.net\`)"
      service: env-successor-b
      middlewares:
        - custom-mw-A
        - custom-mw-B
      tls:
        certResolver: le
      entryPoints: [web]
  services:
    env-successor-b:
      loadBalancer:
        servers:
          - url: "http://rl-env-successor-b-allinone:80"
EOF
    export M6A_SUCCESSOR_RUNNING="true"

    "$ENV_DESTROY_BIN" --slug destroyed-a --force >/dev/null 2>&1 || true

    local final
    final=$(cat "$RL_TRAEFIK_CONF_D/env-successor-b.yml" 2>/dev/null || echo "")
    # Middlewares block MUST survive.
    assert_contains "$final" "custom-mw-A" "middlewares custom-mw-A must survive the conf merge"
    assert_contains "$final" "custom-mw-B" "middlewares custom-mw-B must survive the conf merge"
    # TLS block MUST survive.
    assert_contains "$final" "certResolver: le" "tls.certResolver must survive the conf merge"
    # AND the new slot Host clause MUST be present in the rule line.
    assert_contains "$final" "slot-1.gamernight.net" "rule must now include the slot Host clause"

    m6a_teardown
}

# --- AC12: flock failure logs audit warning ----------------------------------

test_env_destroy_flock_failure_logs_warning() {
    CURRENT_TEST_NAME="AC12: env-destroy flock-failure emits audit warning (not silent || true)"
    m6a_setup
    cat > "$RL_TRAEFIK_CONF_D/env-successor-b.yml" <<EOF
http:
  routers:
    env-successor-b:
      rule: "Host(\`successor-b.rl.lan\`)"
EOF
    export M6A_SUCCESSOR_RUNNING="true"
    # Create the lock file with no write permission so flock fails.
    local lock_file="$RL_TRAEFIK_CONF_D/.slot-1.lock"
    : > "$lock_file"
    # Hold an exclusive lock from a background process so the inner flock
    # times out. Background `flock -x` keeps the lock for 60s; env-destroy
    # should time out at 5s and audit-log the warning.
    (
        flock -x "$lock_file" -c "sleep 60" &
        echo $! > "$RL_STATE_DIR/lock-holder.pid"
    )
    # Tiny delay so the background flock actually grabs the lock before
    # env-destroy starts.
    sleep 0.2

    "$ENV_DESTROY_BIN" --slug destroyed-a --force >/dev/null 2>&1 || true

    # Clean up the lock holder.
    if [[ -f "$RL_STATE_DIR/lock-holder.pid" ]]; then
        kill "$(cat "$RL_STATE_DIR/lock-holder.pid")" 2>/dev/null || true
    fi

    local audit_warning
    audit_warning=$(grep -E 'flock-warning|flock_warning' "$RL_AUDIT_LOG" 2>/dev/null | head -1 || true)
    assert_neq "$audit_warning" "" "audit log MUST contain flock-warning entry (silent || true is forbidden)"

    m6a_teardown
}

run_test "ac3-skip-dead-successor" test_env_destroy_skips_dead_successor
run_test "ac4-preserve-middleware" test_env_destroy_preserves_successor_middleware
run_test "ac12-flock-warning" test_env_destroy_flock_failure_logs_warning

print_test_summary
