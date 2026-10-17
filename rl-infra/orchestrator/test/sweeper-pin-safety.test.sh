#!/usr/bin/env bash
# ROK-1331 M5a — gc-sweeper safety changes
# Covers AC4 (pin defeats unhealthy reaper), AC5 (active-claim heartbeat
# suppression), and the legacy-MAX_CLAIM_AGE_SECONDS gate on expires_at.
#
# These tests are TDD-red — sweep.sh has not yet been updated for M5a.
#
# Approach: rather than spin Docker, we test the sweeper's DECISION logic by
# extracting the env-iteration block into a callable shell scope, mocking
# `docker inspect` / `docker rm -f` / `docker volume rm` with sentinel files
# that record what would have been reaped. After M5a's changes land,
# pinned envs and envs with fresh-heartbeat claims should NOT appear in
# the reap sentinel.

set -uo pipefail

CURRENT_TEST_FILE="sweeper-pin-safety.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"

_seed_env_with_claim() {
    # Args: agent slot slug pinned claimable_by_next heartbeat_iso
    local agent="$1" slot="$2" slug="$3" pinned="$4" claimable="$5" hb_iso="$6" expires_at="${7:-}"
    local now started_at
    now=$(date -u +%FT%TZ)
    started_at="$now"
    jq -n --arg a "$agent" --arg t "$now" --arg hb "$hb_iso" --argjson s "$slot" --arg exp "$expires_at" '
        [
            {slot:1, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ] | map(if .slot == $s
              then .claimed=true | .agent_id=$a | .branch="feat" | .started_at=$t | .last_heartbeat=$hb | (if $exp == "" then . else .expires_at=$exp end)
              else . end)
    ' > "$RL_STATE_DIR/claims.json"
    jq -n --arg slug "$slug" --argjson s "$slot" --argjson p "$pinned" --argjson c "$claimable" --arg t "$now" '
        [{slug:$slug, slot:$s, image:"x", ttl:"24h", created_at:$t, last_touched:$t,
          public_domain:"x.lan", pinned:($p == 1), claimable_by_next:($c == 1), created_for_branch:"feat"}]
    ' > "$RL_STATE_DIR/env-registry.json"
}

# Build a fake docker shim that simulates an unhealthy long-uptime allinone
# for one slug, and records reap attempts (docker rm -f / docker volume rm).
_install_docker_shim() {
    local slug="$1"
    local shim_dir="$2"
    local reap_log="$3"

    mkdir -p "$shim_dir"
    cat > "$shim_dir/docker" <<EOF
#!/usr/bin/env bash
# Test shim: simulates a single unhealthy rl-env-${slug}-allinone container.
case "\$1" in
    inspect)
        # Match the script's two distinct inspect calls:
        #   docker inspect rl-env-${slug}-allinone (status check)
        #   docker inspect <name> --format '{{.State.Health.Status}}'
        #   docker inspect <name> --format '{{.State.StartedAt}}'
        shift
        case "\$*" in
            *"--format"*"Health.Status"*)
                echo "unhealthy"
                ;;
            *"--format"*"StartedAt"*)
                # Started 2h ago → uptime well over 900s threshold
                date -u -d '2 hours ago' +%FT%TZ 2>/dev/null \\
                    || python3 -c "import datetime; print((datetime.datetime.utcnow() - datetime.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))"
                ;;
            *"--format"*"Labels"*)
                # Used in TTL section for orphan check; emit empty labels.
                echo '{}'
                ;;
            *)
                # status check (no --format): success → container exists
                exit 0
                ;;
        esac
        ;;
    ps)
        # Emit no extra containers for the TTL loop.
        :
        ;;
    rm|volume)
        # Record the reap attempt.
        echo "docker \$*" >> "$reap_log"
        ;;
    image|container)
        # prune calls — record but tolerate.
        echo "docker \$*" >> "$reap_log"
        ;;
    *)
        :
        ;;
esac
exit 0
EOF
    chmod +x "$shim_dir/docker"
}

# AC4 — pin defeats unhealthy reaper
test_sweeper_skips_pinned_env() {
    CURRENT_TEST_NAME="AC4: sweeper SKIPS unhealthy env when pinned=true (audit: pinned_env_skipped)"
    local recent_hb
    recent_hb=$(date -u +%FT%TZ)
    _seed_env_with_claim "agent-pin" 1 "pinned-slug" 1 0 "$recent_hb"

    local shim_dir reap_log
    shim_dir=$(mktemp -d -t rl-sweeper-shim.XXXXXX)
    reap_log="$RL_STATE_DIR/reap.log"
    : > "$reap_log"
    _install_docker_shim "pinned-slug" "$shim_dir" "$reap_log"

    PATH="$shim_dir:$PATH" \
        STATE_DIR="$RL_STATE_DIR" \
        CLAIM_HEARTBEAT_TIMEOUT_SECONDS=120 \
        bash "$SWEEP_SCRIPT" >/dev/null 2>&1 || true

    # Pinned slug should NOT appear in reap log (no `docker rm -f rl-env-pinned-slug-allinone`).
    if grep -q "rm -f rl-env-pinned-slug-allinone" "$reap_log" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sweeper reaped pinned env (must skip)")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] sweeper must skip pinned envs; reap.log contains:"
        cat "$reap_log" >&2
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    # Audit log should contain pinned_env_skipped
    if grep -q 'pinned_env_skipped' "$RL_STATE_DIR/audit.log" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: audit log missing pinned_env_skipped")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected audit::log pinned_env_skipped"
    fi

    rm -rf "$shim_dir"
}

# AC5 — active claim heartbeat (<5min) protects unhealthy env from reap
test_sweeper_skips_env_with_active_claim_heartbeat() {
    CURRENT_TEST_NAME="AC5: sweeper SKIPS unhealthy env when slot has fresh heartbeat (<5min)"
    local recent_hb
    recent_hb=$(date -u +%FT%TZ)   # within last 5 min
    _seed_env_with_claim "agent-live" 1 "active-claim-env" 0 0 "$recent_hb"

    local shim_dir reap_log
    shim_dir=$(mktemp -d -t rl-sweeper-shim.XXXXXX)
    reap_log="$RL_STATE_DIR/reap.log"
    : > "$reap_log"
    _install_docker_shim "active-claim-env" "$shim_dir" "$reap_log"

    PATH="$shim_dir:$PATH" \
        STATE_DIR="$RL_STATE_DIR" \
        CLAIM_HEARTBEAT_TIMEOUT_SECONDS=120 \
        bash "$SWEEP_SCRIPT" >/dev/null 2>&1 || true

    if grep -q "rm -f rl-env-active-claim-env-allinone" "$reap_log" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sweeper reaped env with active heartbeat (must skip)")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] active-claim env must NOT be reaped; reap.log:"
        cat "$reap_log" >&2
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    if grep -q 'unhealthy_env_skipped_active_claim' "$RL_STATE_DIR/audit.log" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: audit log missing unhealthy_env_skipped_active_claim")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected unhealthy_env_skipped_active_claim audit entry"
    fi

    rm -rf "$shim_dir"
}

# STRICT — MAX_CLAIM_AGE_SECONDS legacy reaper DISABLED when expires_at IS NOT NULL
test_sweeper_legacy_age_reaper_gated_by_expires_at() {
    CURRENT_TEST_NAME="STRICT: legacy MAX_CLAIM_AGE_SECONDS reaper SKIPS claims with expires_at set"
    # Seed claim with started_at 10h in the past (would trigger legacy 8h reaper)
    # but with expires_at set 24h in the future (M5a's expiry-driven lifecycle).
    local started_iso expires_iso recent_hb
    started_iso=$(date -u -d '10 hours ago' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() - datetime.timedelta(hours=10)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    expires_iso=$(date -u -d '+24 hours' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() + datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    recent_hb=$(date -u +%FT%TZ)

    jq -n --arg t_old "$started_iso" --arg hb "$recent_hb" --arg exp "$expires_iso" '
        [
            {slot:1, claimed:true, agent_id:"long-runner", branch:"feat",
             started_at:$t_old, last_heartbeat:$hb, keep_alive:false,
             expires_at:$exp, extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    echo "[]" > "$RL_STATE_DIR/env-registry.json"

    local shim_dir reap_log
    shim_dir=$(mktemp -d -t rl-sweeper-shim.XXXXXX)
    reap_log="$RL_STATE_DIR/reap.log"
    : > "$reap_log"
    cat > "$shim_dir/docker" <<'EOF'
#!/usr/bin/env bash
# Minimal shim: no containers exist.
case "$1" in
    ps) ;;
    inspect) exit 1 ;;
    rm|volume|image|container)
        echo "docker $*" >> /dev/null
        ;;
esac
exit 0
EOF
    chmod +x "$shim_dir/docker"

    PATH="$shim_dir:$PATH" \
        STATE_DIR="$RL_STATE_DIR" \
        CLAIM_HEARTBEAT_TIMEOUT_SECONDS=120 \
        MAX_CLAIM_AGE_SECONDS=28800 \
        bash "$SWEEP_SCRIPT" >/dev/null 2>&1 || true

    # Slot 1 must STILL be claimed (legacy reaper must NOT fire because expires_at is set).
    local claimed agent_id
    claimed=$(jq -r '.[] | select(.slot==1) | .claimed' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    agent_id=$(jq -r '.[] | select(.slot==1) | .agent_id' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    assert_eq "$claimed" "true" "legacy hoarded-slot reaper must NOT fire when expires_at IS NOT NULL"
    assert_eq "$agent_id" "long-runner" "agent_id must remain on claim when expires_at gates legacy reaper"

    # Audit log must NOT contain hoarded_slot_released for this row.
    if grep -q 'hoarded_slot_released' "$RL_STATE_DIR/audit.log" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: legacy reaper fired despite expires_at being set")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected NO hoarded_slot_released in audit log"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    rm -rf "$shim_dir"
}

# Legacy MAX_CLAIM_AGE_SECONDS reaper STILL fires when expires_at IS NULL (backward compat).
test_sweeper_legacy_reaper_still_works_when_expires_at_null() {
    CURRENT_TEST_NAME="Legacy MAX_CLAIM_AGE_SECONDS reaper STILL fires for null expires_at (backward compat)"
    local started_iso recent_hb
    started_iso=$(date -u -d '10 hours ago' +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() - datetime.timedelta(hours=10)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    recent_hb=$(date -u +%FT%TZ)

    # Legacy row WITHOUT expires_at (null).
    jq -n --arg t_old "$started_iso" --arg hb "$recent_hb" '
        [
            {slot:1, claimed:true, agent_id:"legacy-row", branch:"feat",
             started_at:$t_old, last_heartbeat:$hb, keep_alive:false,
             expires_at:null, extends_count:0},
            {slot:2, claimed:false, agent_id:null, branch:null, started_at:null, last_heartbeat:null, keep_alive:false}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    echo "[]" > "$RL_STATE_DIR/env-registry.json"

    local shim_dir
    shim_dir=$(mktemp -d -t rl-sweeper-shim.XXXXXX)
    cat > "$shim_dir/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
    ps) ;;
    inspect) exit 1 ;;
    rm|volume|image|container) ;;
esac
exit 0
EOF
    chmod +x "$shim_dir/docker"

    PATH="$shim_dir:$PATH" \
        STATE_DIR="$RL_STATE_DIR" \
        CLAIM_HEARTBEAT_TIMEOUT_SECONDS=120 \
        MAX_CLAIM_AGE_SECONDS=28800 \
        bash "$SWEEP_SCRIPT" >/dev/null 2>&1 || true

    # Legacy row should be released.
    local claimed
    claimed=$(jq -r '.[] | select(.slot==1) | .claimed' "$RL_STATE_DIR/claims.json" 2>/dev/null || echo "")
    assert_eq "$claimed" "false" "legacy expires_at=null row STILL released by 8h reaper"

    rm -rf "$shim_dir"
}

run_test "ac4-skips-pinned-env" test_sweeper_skips_pinned_env
run_test "ac5-skips-active-heartbeat-env" test_sweeper_skips_env_with_active_claim_heartbeat
run_test "strict-legacy-reaper-gated-by-expires-at" test_sweeper_legacy_age_reaper_gated_by_expires_at
run_test "legacy-reaper-still-works-when-null" test_sweeper_legacy_reaper_still_works_when_expires_at_null

print_test_summary
