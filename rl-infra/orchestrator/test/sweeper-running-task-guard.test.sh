#!/usr/bin/env bash
# A3-B P1 — gc-sweeper must not reap a slot whose own work is still running.
#
# Background (traced 2026-09-03): `claims[].last_heartbeat` is written by
# exactly three things — `claim`, `lease-advance` and `bin/heartbeat`. The last
# is driven by the `rl` CLI's laptop-side daemon (cli/rl::start_heartbeat_daemon);
# MCP-driven agents have no daemon at all. `task-start` never touches it. So the
# lease tracks AGENT liveness and knows nothing about WORK liveness, and a
# 14-minute validate-ci run can outlive CLAIM_HEARTBEAT_TIMEOUT_SECONDS while
# still executing. sweep.sh §1 then releases the slot AND destroys its envs.
#
# These tests pin the three directions that matter:
#   1. running task + lapsed heartbeat  -> slot AND envs survive
#   2. no running task + lapsed heartbeat -> slot IS reaped (guard is narrow)
#   3. task JSON says "running" but its supervisor is dead (stale pidfile)
#      -> slot IS reaped. This is the dead-agent case: protection is bounded by
#      work liveness, so a dead agent can never leak a slot permanently.

set -uo pipefail

CURRENT_TEST_FILE="sweeper-running-task-guard.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"

SLUG="guardslug"
AGENT="agent-guard-p1"
# Heartbeat lapse used by every case: 1h stale against a 120s timeout, so the
# ONLY thing that can save the slot is the running-work guard.
LAPSED_SECONDS=3600
HB_TIMEOUT=120

# --- local assertion: substring must be ABSENT (test_helpers has the positive
# form only). Same counter/reporting contract as assert_contains.
assert_absent() {
    local haystack="$1" needle="$2" message="${3:-}"
    if [[ "$haystack" != *"$needle"* ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $message")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $message"
        echo "  expected NOT to contain: $needle"
        echo "  actual:                  ${haystack:-<empty>}"
    fi
}

# ISO-8601 timestamp N seconds in the past (GNU date, macOS fallback).
_iso_ago() {
    local secs="$1"
    date -u -d "now - ${secs} seconds" +%FT%TZ 2>/dev/null \
        || date -u -v-"${secs}"S +%FT%TZ 2>/dev/null \
        || python3 -c "import datetime; print((datetime.datetime.utcnow() - datetime.timedelta(seconds=$secs)).strftime('%Y-%m-%dT%H:%M:%SZ'))"
}

# Set a file's mtime N seconds in the past. `touch -t` takes LOCAL time, and
# python's fromtimestamp is local too, so the pair is consistent.
_touch_ago() {
    local path="$1" secs="$2" stamp=""
    touch "$path"
    stamp=$(python3 -c "import time,datetime; print(datetime.datetime.fromtimestamp(time.time()-${secs}).strftime('%Y%m%d%H%M.%S'))" 2>/dev/null) || stamp=""
    if [[ -n "$stamp" ]]; then
        touch -t "$stamp" "$path" 2>/dev/null || true
    else
        touch -d "-${secs} seconds" "$path" 2>/dev/null || true
    fi
}

# claims.json: two slots, slot 1 claimed with a heartbeat $LAPSED_SECONDS old.
# expires_at is left null and started_at is "now" so neither the claim-expiry
# reaper (§1d) nor the 8h hoard reaper (§1b') can fire — §1 is isolated.
_seed_lapsed_claim() {
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg a "$AGENT" --arg started "$now" --arg hb "$(_iso_ago "$LAPSED_SECONDS")" '
        [
          {slot:1, claimed:true,  agent_id:$a,  branch:"a3b", started_at:$started,
           last_heartbeat:$hb, expires_at:null, keep_alive:false, extends_count:0},
          {slot:2, claimed:false, agent_id:null, branch:null, started_at:null,
           last_heartbeat:null, expires_at:null, keep_alive:false, extends_count:0}
        ]' > "$RL_STATE_DIR/claims.json"
    echo '[]' > "$RL_STATE_DIR/queue.json"
    jq -n --arg slug "$SLUG" --arg t "$now" '
        [{slug:$slug, slot:1, image:"x", ttl:"24h", created_at:$t, last_touched:$t,
          public_domain:"x.lan", pinned:false, claimable_by_next:false,
          created_for_branch:"a3b"}]' > "$RL_STATE_DIR/env-registry.json"
}

# A task JSON claiming to run on $slot. pidfile_age:
#   "fresh"   -> pidfile touched now (supervisor alive)
#   "stale"   -> pidfile mtime 600s old (supervisor dead)
#   "missing" -> no pidfile at all
_seed_task() {
    local task_id="$1" slot="$2" status="$3" pidfile_age="$4"
    local now
    now=$(date -u +%FT%TZ)
    jq -n --arg id "$task_id" --argjson slot "$slot" --arg st "$status" --arg t "$now" '
        {task_id:$id, tool:"rl_validate_ci", slot:$slot, agent_id:"'"$AGENT"'",
         args_summary:"--static", cmd:["/bin/sleep","900"],
         log_path:"", pid:4242, status:$st, script_exit_code:null,
         started_at:$t, finished_at:null, cancel_reason:null, steps:[]}
    ' > "$RL_TASKS_DIR/$task_id.json"
    : > "$RL_TASKS_DIR/$task_id.log"
    case "$pidfile_age" in
        fresh)  echo 4242 > "$RL_TASKS_DIR/$task_id.pid" ;;
        stale)  echo 4242 > "$RL_TASKS_DIR/$task_id.pid"; _touch_ago "$RL_TASKS_DIR/$task_id.pid" 600 ;;
        missing) rm -f "$RL_TASKS_DIR/$task_id.pid" ;;
    esac
}

# docker shim. `ps` answers ONLY the §1 dead-claim query (which filters on
# rl.slot=N); every other ps form returns nothing so the TTL/orphan sections
# can't reap our env and contaminate the signal. `inspect` reports the allinone
# as present + healthy for the same reason. All rm/volume calls are recorded.
_install_docker_shim() {
    local shim_dir="$1" reap_log="$2"
    mkdir -p "$shim_dir"
    cat > "$shim_dir/docker" <<EOF
#!/usr/bin/env bash
case "\$1" in
    ps)
        if [[ "\$*" == *"rl.slot="* ]]; then
            echo "$SLUG fakecid001"
        fi
        ;;
    inspect)
        case "\$*" in
            *Health.Status*) echo "healthy" ;;
            *StartedAt*)     date -u +%FT%TZ ;;
            *Config.Labels*) echo '{}' ;;
            *)               exit 0 ;;
        esac
        ;;
    rm|volume|image|container)
        echo "docker \$*" >> "$reap_log"
        ;;
esac
exit 0
EOF
    chmod +x "$shim_dir/docker"
}

# Run the sweeper against the temp state dir. Echoes nothing; state is the output.
_run_sweep() {
    local shim_dir="$1" reap_log="$2"
    PATH="$shim_dir:$PATH" \
        STATE_DIR="$RL_STATE_DIR" \
        RL_STATE_DIR="$RL_STATE_DIR" \
        TASKS_DIR="$RL_TASKS_DIR" \
        RL_TASKS_DIR="$RL_TASKS_DIR" \
        CLAIM_HEARTBEAT_TIMEOUT_SECONDS="$HB_TIMEOUT" \
        ORCHESTRATOR_BIN_DIR="$RL_STATE_DIR/no-such-bin" \
        bash "$SWEEP_SCRIPT" >/dev/null 2>&1 || true
    [[ -f "$reap_log" ]] || : > "$reap_log"
}

_claimed_flag() { jq -r '.[] | select(.slot == 1) | .claimed' "$RL_STATE_DIR/claims.json"; }
_claim_agent()  { jq -r '.[] | select(.slot == 1) | .agent_id // "null"' "$RL_STATE_DIR/claims.json"; }

_prepare() {
    SHIM_DIR=$(mktemp -d -t rl-guard-shim.XXXXXX)
    REAP_LOG="$RL_STATE_DIR/reap.log"
    : > "$REAP_LOG"
    _seed_lapsed_claim
    _install_docker_shim "$SHIM_DIR" "$REAP_LOG"
}

_cleanup_shim() { [[ -n "${SHIM_DIR:-}" ]] && rm -rf "$SHIM_DIR"; }

# --- AC1: running work defeats the lapsed-heartbeat reaper -------------------
test_running_task_protects_slot_and_envs() {
    CURRENT_TEST_NAME="AC1: lapsed heartbeat + LIVE task -> slot and envs survive"
    _prepare
    _seed_task "livetask01" 1 "running" "fresh"

    _run_sweep "$SHIM_DIR" "$REAP_LOG"

    assert_eq "$(_claimed_flag)" "true" \
        "slot 1 must remain claimed: task livetask01 is running (fresh pidfile) even though last_heartbeat is ${LAPSED_SECONDS}s old vs a ${HB_TIMEOUT}s timeout"
    assert_eq "$(_claim_agent)" "$AGENT" \
        "slot 1 must still be held by $AGENT — the dead-claim reaper stole a slot with live work on it"
    assert_absent "$(cat "$REAP_LOG")" "rm -f fakecid001" \
        "env '$SLUG' (container fakecid001) must NOT be destroyed while task livetask01 is running on its slot"
    assert_absent "$(cat "$REAP_LOG")" "volume rm rl-data-$SLUG" \
        "volume rl-data-$SLUG must NOT be removed while task livetask01 is running on its slot"
    _cleanup_shim
}

# --- AC2: converse — the guard must not become a blanket amnesty -------------
test_no_running_task_still_reaped() {
    CURRENT_TEST_NAME="AC2: lapsed heartbeat + NO running task -> slot IS reaped"
    _prepare
    _seed_task "donetask01" 1 "succeeded" "missing"

    _run_sweep "$SHIM_DIR" "$REAP_LOG"

    assert_eq "$(_claimed_flag)" "false" \
        "slot 1 must be released: no task is running and last_heartbeat is ${LAPSED_SECONDS}s old vs a ${HB_TIMEOUT}s timeout"
    assert_eq "$(_claim_agent)" "null" \
        "slot 1 agent_id must be cleared after the dead-claim reap"
    assert_contains "$(cat "$REAP_LOG")" "rm -f fakecid001" \
        "env '$SLUG' (container fakecid001) must be destroyed with its dead claim when no work is running"
    _cleanup_shim
}

# --- AC3: dead agent, dead supervisor — must stay reclaimable ----------------
test_stale_pidfile_does_not_protect_slot() {
    CURRENT_TEST_NAME="AC3: task JSON says running but supervisor is dead (stale pidfile) -> slot IS reaped"
    _prepare
    _seed_task "zombietask" 1 "running" "stale"

    _run_sweep "$SHIM_DIR" "$REAP_LOG"

    assert_eq "$(_claimed_flag)" "false" \
        "slot 1 must be reclaimable: zombietask's pidfile is 600s stale (> PIDFILE_STALE_SECONDS), so the work is dead and a status of 'running' must not hold the lease"
    assert_eq "$(_claim_agent)" "null" \
        "slot 1 agent_id must be cleared — a stale-pidfile task must never leak a slot permanently"
    _cleanup_shim
}

# --- AC4: the guard is slot-scoped ------------------------------------------
test_running_task_on_other_slot_does_not_protect() {
    CURRENT_TEST_NAME="AC4: live task on slot 2 does not protect slot 1"
    _prepare
    _seed_task "otherslot1" 2 "running" "fresh"

    _run_sweep "$SHIM_DIR" "$REAP_LOG"

    assert_eq "$(_claimed_flag)" "false" \
        "slot 1 must be released: the only live task (otherslot1) runs on slot 2, so slot 1's lapsed heartbeat is unprotected"
    _cleanup_shim
}

run_test "AC1 running task protects slot+envs" test_running_task_protects_slot_and_envs
run_test "AC2 no running task still reaped"    test_no_running_task_still_reaped
run_test "AC3 stale pidfile does not protect"  test_stale_pidfile_does_not_protect_slot
run_test "AC4 guard is slot-scoped"            test_running_task_on_other_slot_does_not_protect

print_test_summary
