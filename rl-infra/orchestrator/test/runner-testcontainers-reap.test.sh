#!/usr/bin/env bash
# ROK-1331 M8 — testcontainers orphan reaper.
#
# Real bug discovered during Step 3 Probe 1: when a jest --runInBand process
# dies mid-suite without graceful teardown (or a claim transitions to a new
# agent), the postgres+redis containers spawned by `@testcontainers/postgresql`
# leak on the docker daemon. 10+ pgvector/pgvector:pg16 containers from
# rok-1332/rok-1335 sessions sat on the host contending with CI's new
# containers — each suite took 1-2 min instead of 5-15s.
#
# Fix: a new `runner-testcontainers-reap <slot|all>` binary that enumerates
# containers labelled `org.testcontainers=true`, classifies each as orphan
# (parent jest dead OR owning ryuk session container is gone) vs active
# (live jest on an active claim slot), and `docker rm -f` the orphans. Hook
# into release (per-slot scope) AND gc-sweeper (periodic `all` scope) so any
# orphans missed by release get cleaned within one sweep cycle.
#
# Tests stub `docker` via a tmp dir prepended to PATH (same pattern used by
# release-runner-cleanup.test.sh — see header comments there).

set -uo pipefail

CURRENT_TEST_FILE="runner-testcontainers-reap.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

REAP_BIN="$BIN_DIR/runner-testcontainers-reap"

# Seed a claims.json with slot N marked claimed by AGENT for BRANCH (so the
# reaper's "active claim" probe can distinguish active runners from released
# ones). Pass slot=0 to seed an empty claims array.
_seed_claims() {
    local slot="$1" agent="$2" branch="$3"
    if [[ "$slot" == "0" ]]; then
        echo "[]" > "$RL_STATE_DIR/claims.json"
        return
    fi
    local now
    now=$(date -u +%FT%TZ)
    jq -n --argjson s "$slot" --arg a "$agent" --arg b "$branch" --arg t "$now" '
        [
            {slot:$s, claimed:true, agent_id:$a, branch:$b, started_at:$t, last_heartbeat:$t, keep_alive:false, expires_at:null, extends_count:0}
        ]
    ' > "$RL_STATE_DIR/claims.json"
    echo "[]" > "$RL_STATE_DIR/env-registry.json"
}

# Install a fake `docker` shim that reads scripted output from a fixture file.
# The fixture file is a JSON object:
#   {
#     "containers": [
#       {"id":"abc","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"sess-1"}, "image":"pgvector/pgvector:pg16"},
#       ...
#     ],
#     "live_pids": ["pid-1234"]   // PIDs the reaper's process-liveness probe should see as alive
#   }
#
# The shim handles:
#   - `docker ps -a --filter label=... --format '<template>'`
#     Template tokens we honor: {{.ID}}, {{.Image}}, {{.Label "<key>"}}.
#     The shim splits the template on space (default) — callers wanting
#     unambiguous parsing should use a literal separator like '|'.
#   - `docker rm -f <id>` (record into sentinel)
#   - `docker inspect <id>` (exit 0 if container exists, 1 otherwise)
#   - `docker exec rl-runner-<slot> sh -c 'pgrep ...'`
#
# Removed container IDs are appended to $REMOVAL_SENTINEL one per line so
# tests can assert exact rm calls.
_install_fake_docker() {
    local fixture_file="$1" removal_sentinel="$2"
    FAKE_BIN=$(mktemp -d -t rl-fake-bin.XXXXXX)
    cat > "$FAKE_BIN/docker" <<EOF
#!/usr/bin/env bash
FIXTURE="$fixture_file"
SENTINEL="$removal_sentinel"

# docker ps -a (with various filters + formats)
if [[ "\$1" == "ps" ]]; then
    # Walk argv to collect filters + the format template string.
    filters=""
    fmt=""
    expect_filter=0
    expect_format=0
    for arg in "\$@"; do
        if (( expect_filter == 1 )); then
            expect_filter=0
            case "\$arg" in
                label=org.testcontainers.session-id=*)
                    filters="\$filters session_id=\${arg#label=org.testcontainers.session-id=}"
                    ;;
                label=org.testcontainers=true)
                    filters="\$filters tc_true"
                    ;;
            esac
            continue
        fi
        if (( expect_format == 1 )); then
            expect_format=0
            fmt="\$arg"
            continue
        fi
        case "\$arg" in
            --filter) expect_filter=1 ;;
            --format) expect_format=1 ;;
        esac
    done

    # Default format when caller passed bare ps with no --format.
    if [[ -z "\$fmt" ]]; then
        fmt='{{.ID}}'
    fi

    # Use python to render docker's --format template against the fixture.
    # python is available everywhere bash is on the operator's mac + the VM.
    python3 - "\$FIXTURE" "\$fmt" "\$filters" <<'PYEOF'
import json, re, sys

fixture_path, fmt, filters = sys.argv[1], sys.argv[2], sys.argv[3]
with open(fixture_path) as f:
    data = json.load(f)

# Determine the selector predicate from the filters string.
def matches(container):
    if "tc_true" in filters:
        return container.get("labels", {}).get("org.testcontainers") == "true"
    if "session_id=" in filters:
        wanted = filters.split("session_id=", 1)[1].split()[0]
        return container.get("labels", {}).get("org.testcontainers.session-id") == wanted
    return False

def render(template, c):
    out = template
    out = out.replace("{{.ID}}", c.get("id", ""))
    out = out.replace("{{.Image}}", c.get("image", ""))
    # {{.Label "key"}} substitution
    def label_sub(m):
        k = m.group(1)
        return c.get("labels", {}).get(k, "") or ""
    out = re.sub(r'\\{\\{\\.Label "([^"]+)"\\}\\}', label_sub, out)
    return out

for c in data.get("containers", []):
    if matches(c):
        print(render(fmt, c))
PYEOF
    exit 0
fi

# docker inspect <id> — used to probe ryuk container existence.
if [[ "\$1" == "inspect" ]]; then
    target="\$2"
    found=\$(jq -r --arg id "\$target" '.containers[] | select(.id == \$id) | .id' "\$FIXTURE" 2>/dev/null)
    if [[ -n "\$found" ]]; then
        echo "[{\"Id\":\"\$target\"}]"
        exit 0
    fi
    echo "Error: No such object: \$target" >&2
    exit 1
fi

# docker rm -f <id...>
if [[ "\$1" == "rm" && "\$2" == "-f" ]]; then
    shift 2
    for id in "\$@"; do
        echo "\$id" >> "\$SENTINEL"
    done
    exit 0
fi

# docker exec rl-runner-<slot> sh -c '<cmd>'  — only used to probe live jest
# inside the runner. We treat the fixture's "live_pids" array as the set of
# processes pgrep would find. Print one PID per line for each entry, then
# exit 0 (pgrep behavior).
if [[ "\$1" == "exec" ]]; then
    runner_name="\$2"
    # Look up the runner's slot from the name (rl-runner-N → N).
    slot=\${runner_name##*-}
    # If the runner has any live_pids in the fixture, echo them so pgrep's
    # caller sees non-empty output. The fixture can scope live PIDs per slot
    # using the "live_pids_slot_N" key; fall back to "live_pids".
    pids=\$(jq -r --arg key "live_pids_slot_\$slot" '.[\$key] // .live_pids // [] | .[]' "\$FIXTURE" 2>/dev/null)
    if [[ -n "\$pids" ]]; then
        echo "\$pids"
    fi
    exit 0
fi

exit 0
EOF
    chmod +x "$FAKE_BIN/docker"
}

_cleanup_fake() {
    [[ -n "${FAKE_BIN:-}" && -d "$FAKE_BIN" ]] && rm -rf "$FAKE_BIN"
    unset FAKE_BIN
}

# AC-M8-1: orphan testcontainer (no live jest parent) gets removed.
test_reaps_orphan_testcontainer() {
    CURRENT_TEST_NAME="AC-M8-1: orphan testcontainer (no live jest parent) reaped"
    _seed_claims 0 "" ""   # no active claims

    local fixture="$RL_STATE_DIR/fixture.json"
    local sentinel="$RL_STATE_DIR/removed.txt"
    : > "$sentinel"
    cat > "$fixture" <<'EOF'
{
  "containers": [
    {"id":"orphan-pg-1","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"sess-orphan"},"image":"pgvector/pgvector:pg16"}
  ],
  "live_pids": []
}
EOF
    _install_fake_docker "$fixture" "$sentinel"

    if [[ ! -x "$REAP_BIN" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $REAP_BIN missing or not executable")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $REAP_BIN missing/non-exec"
        _cleanup_fake
        return
    fi

    PATH="$FAKE_BIN:$PATH" "$REAP_BIN" all >/dev/null 2>&1 || true

    if grep -qx "orphan-pg-1" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: orphan-pg-1 not removed")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] orphan-pg-1 should have been removed"
        echo "removal sentinel:"
        cat "$sentinel" 2>/dev/null | sed 's/^/  /'
    fi

    _cleanup_fake
}

# AC-M8-2: active testcontainer (live jest parent on active claim slot) stays.
test_active_testcontainer_preserved() {
    CURRENT_TEST_NAME="AC-M8-2: active testcontainer with live jest parent NOT reaped"
    _seed_claims 1 "agent-active" "feat-x"

    local fixture="$RL_STATE_DIR/fixture.json"
    local sentinel="$RL_STATE_DIR/removed.txt"
    : > "$sentinel"
    # live_pids_slot_1 means pgrep on rl-runner-1 returns a non-empty list →
    # jest is alive there. The container's session id ties it to slot 1 via
    # the reaper's discovery of "any active claim slot has live jest".
    cat > "$fixture" <<'EOF'
{
  "containers": [
    {"id":"active-pg-1","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"sess-active","rl.slot":"1"},"image":"pgvector/pgvector:pg16"}
  ],
  "live_pids_slot_1": ["1234"],
  "live_pids": []
}
EOF
    _install_fake_docker "$fixture" "$sentinel"

    if [[ ! -x "$REAP_BIN" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $REAP_BIN missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $REAP_BIN missing"
        _cleanup_fake
        return
    fi

    PATH="$FAKE_BIN:$PATH" "$REAP_BIN" all >/dev/null 2>&1 || true

    if grep -qx "active-pg-1" "$sentinel" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: active-pg-1 was incorrectly reaped")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] active-pg-1 should have been PRESERVED (live jest on active claim slot 1)"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    _cleanup_fake
}

# AC-M8-3: ryuk-only session (ryuk container gone, child remains) → child reaped.
test_ryuk_gone_children_reaped() {
    CURRENT_TEST_NAME="AC-M8-3: ryuk session container gone → child containers reaped"
    _seed_claims 0 "" ""

    local fixture="$RL_STATE_DIR/fixture.json"
    local sentinel="$RL_STATE_DIR/removed.txt"
    : > "$sentinel"
    # Child container survives but no ryuk row exists with image testcontainers/ryuk.
    # The reaper should classify the orphaned child as an orphan via the ryuk-gone path.
    cat > "$fixture" <<'EOF'
{
  "containers": [
    {"id":"ryuk-orphan-pg","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"sess-noryuk"},"image":"pgvector/pgvector:pg16"}
  ],
  "live_pids": []
}
EOF
    _install_fake_docker "$fixture" "$sentinel"

    if [[ ! -x "$REAP_BIN" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $REAP_BIN missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $REAP_BIN missing"
        _cleanup_fake
        return
    fi

    PATH="$FAKE_BIN:$PATH" "$REAP_BIN" all >/dev/null 2>&1 || true

    if grep -qx "ryuk-orphan-pg" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: ryuk-orphan-pg not reaped")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] orphan child of dead ryuk session should be reaped"
    fi

    _cleanup_fake
}

# AC-M8-4: <slot> arg scopes reap to that slot's containers only.
test_slot_arg_scopes_to_owning_slot() {
    CURRENT_TEST_NAME="AC-M8-4: <slot> arg scopes reap to that slot's containers"
    _seed_claims 2 "agent-other" "feat-other"

    local fixture="$RL_STATE_DIR/fixture.json"
    local sentinel="$RL_STATE_DIR/removed.txt"
    : > "$sentinel"
    # Slot 1 has an orphan; slot 2 has an active claim with a container; both
    # have label rl.slot. With arg "1", only slot-1 should be reaped.
    cat > "$fixture" <<'EOF'
{
  "containers": [
    {"id":"slot1-orphan","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"sess-1","rl.slot":"1"},"image":"pgvector/pgvector:pg16"},
    {"id":"slot2-other","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"sess-2","rl.slot":"2"},"image":"pgvector/pgvector:pg16"}
  ],
  "live_pids": [],
  "live_pids_slot_2": ["999"]
}
EOF
    _install_fake_docker "$fixture" "$sentinel"

    if [[ ! -x "$REAP_BIN" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $REAP_BIN missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $REAP_BIN missing"
        _cleanup_fake
        return
    fi

    PATH="$FAKE_BIN:$PATH" "$REAP_BIN" 1 >/dev/null 2>&1 || true

    if grep -qx "slot1-orphan" "$sentinel" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: slot1-orphan not reaped")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] slot1-orphan should be reaped under arg=1"
    fi

    if grep -qx "slot2-other" "$sentinel" 2>/dev/null; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: slot2-other reaped despite arg=1 scope")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] slot2-other should NOT be reaped under arg=1"
    else
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    _cleanup_fake
}

# AC-M8-5: `all` arg reaps across all slots (no active claims → reap all).
test_all_arg_reaps_across_slots() {
    CURRENT_TEST_NAME="AC-M8-5: 'all' arg reaps orphans across every slot"
    _seed_claims 0 "" ""   # no active claims

    local fixture="$RL_STATE_DIR/fixture.json"
    local sentinel="$RL_STATE_DIR/removed.txt"
    : > "$sentinel"
    cat > "$fixture" <<'EOF'
{
  "containers": [
    {"id":"slot1-pg","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"s1","rl.slot":"1"},"image":"pgvector/pgvector:pg16"},
    {"id":"slot2-pg","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"s2","rl.slot":"2"},"image":"pgvector/pgvector:pg16"},
    {"id":"noslot-pg","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"s3"},"image":"pgvector/pgvector:pg16"}
  ],
  "live_pids": []
}
EOF
    _install_fake_docker "$fixture" "$sentinel"

    if [[ ! -x "$REAP_BIN" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $REAP_BIN missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $REAP_BIN missing"
        _cleanup_fake
        return
    fi

    PATH="$FAKE_BIN:$PATH" "$REAP_BIN" all >/dev/null 2>&1 || true

    local all_ok=1
    for id in slot1-pg slot2-pg noslot-pg; do
        if ! grep -qx "$id" "$sentinel" 2>/dev/null; then
            all_ok=0
            TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
            TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $id not reaped")
            echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $id should have been reaped under 'all'"
        fi
    done
    if (( all_ok == 1 )); then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    fi

    _cleanup_fake
}

# AC-M8-6: gc-sweeper invokes `runner-testcontainers-reap all` every cycle.
test_sweeper_invokes_reaper() {
    CURRENT_TEST_NAME="AC-M8-6: gc-sweeper invokes runner-testcontainers-reap all"
    # Use a stub-reaper that writes a sentinel when called, then point the
    # sweeper at it via $ORCHESTRATOR_BIN_DIR. We rely on the production
    # sweeper script that ships in this repo.
    SWEEPER_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"
    if [[ ! -f "$SWEEPER_SCRIPT" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sweep.sh missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] sweep.sh missing"
        return
    fi

    # Bootstrap state files the sweeper expects.
    echo "[]" > "$RL_STATE_DIR/claims.json"
    echo "[]" > "$RL_STATE_DIR/env-registry.json"
    echo "[]" > "$RL_STATE_DIR/queue.json"

    # Build a fake orchestrator/bin dir holding ONLY a fake reaper that
    # writes a sentinel. The sweeper resolves it via $ORCHESTRATOR_BIN_DIR.
    local fake_orch
    fake_orch=$(mktemp -d -t rl-fake-orch.XXXXXX)
    mkdir -p "$fake_orch/bin"
    local invoked="$RL_STATE_DIR/sweeper-invoked-reaper.txt"
    : > "$invoked"
    cat > "$fake_orch/bin/runner-testcontainers-reap" <<EOF
#!/usr/bin/env bash
echo "runner-testcontainers-reap \$*" >> "$invoked"
exit 0
EOF
    chmod +x "$fake_orch/bin/runner-testcontainers-reap"
    # Provide a stub lease-advance so the sweeper's other paths don't fail.
    cat > "$fake_orch/bin/lease-advance" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$fake_orch/bin/lease-advance"

    # Also stub `docker` so the sweeper's docker calls don't blow up on a
    # local mac without docker daemon access. All return empty / success.
    local fake_path
    fake_path=$(mktemp -d -t rl-fake-path.XXXXXX)
    cat > "$fake_path/docker" <<'EOF'
#!/usr/bin/env bash
# minimal stub — return empty for any ps query, success for any other op
if [[ "$1" == "ps" ]]; then exit 0; fi
exit 0
EOF
    chmod +x "$fake_path/docker"

    TASKS_DIR="$RL_TASKS_DIR" \
        RL_STATE_DIR="$RL_STATE_DIR" \
        RL_TASKS_DIR="$RL_TASKS_DIR" \
        STATE_DIR="$RL_STATE_DIR" \
        ORCHESTRATOR_BIN_DIR="$fake_orch/bin" \
        PATH="$fake_path:$PATH" \
        bash "$SWEEPER_SCRIPT" >/dev/null 2>&1 || true

    if grep -q "runner-testcontainers-reap all" "$invoked" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: sweeper did not invoke reaper with 'all'")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] sweeper should call runner-testcontainers-reap all"
        echo "invoked sentinel:"
        cat "$invoked" 2>/dev/null | sed 's/^/  /'
    fi

    rm -rf "$fake_orch" "$fake_path"
}

# AC-M8-bonus: reaper exits 0 even when 0 containers are reaped.
test_zero_containers_exit_zero() {
    CURRENT_TEST_NAME="AC-M8-bonus: zero containers to reap → exit 0"
    _seed_claims 0 "" ""

    local fixture="$RL_STATE_DIR/fixture.json"
    local sentinel="$RL_STATE_DIR/removed.txt"
    : > "$sentinel"
    cat > "$fixture" <<'EOF'
{
  "containers": [],
  "live_pids": []
}
EOF
    _install_fake_docker "$fixture" "$sentinel"

    if [[ ! -x "$REAP_BIN" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $REAP_BIN missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $REAP_BIN missing"
        _cleanup_fake
        return
    fi

    PATH="$FAKE_BIN:$PATH" "$REAP_BIN" all >/dev/null 2>&1
    local exit_code=$?

    if [[ "$exit_code" == "0" ]]; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: exit code $exit_code (expected 0)")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] exit must be 0 with no containers"
    fi

    _cleanup_fake
}

# AC-M8-bonus2: reaper audit-logs each removal so operators can correlate.
test_reaper_audit_logged() {
    CURRENT_TEST_NAME="AC-M8-bonus2: reaper writes audit.log entries for each removal"
    _seed_claims 0 "" ""

    local fixture="$RL_STATE_DIR/fixture.json"
    local sentinel="$RL_STATE_DIR/removed.txt"
    : > "$sentinel"
    cat > "$fixture" <<'EOF'
{
  "containers": [
    {"id":"audit-test-1","labels":{"org.testcontainers":"true","org.testcontainers.session-id":"audit-sess"},"image":"pgvector/pgvector:pg16"}
  ],
  "live_pids": []
}
EOF
    _install_fake_docker "$fixture" "$sentinel"

    if [[ ! -x "$REAP_BIN" ]]; then
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: $REAP_BIN missing")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] $REAP_BIN missing"
        _cleanup_fake
        return
    fi

    PATH="$FAKE_BIN:$PATH" "$REAP_BIN" all >/dev/null 2>&1 || true

    if grep -q 'audit-test-1' "$RL_STATE_DIR/audit.log" 2>/dev/null \
       && grep -q 'reap' "$RL_STATE_DIR/audit.log" 2>/dev/null; then
        TEST_PASS_COUNT=$((TEST_PASS_COUNT + 1))
    else
        TEST_FAIL_COUNT=$((TEST_FAIL_COUNT + 1))
        TEST_FAIL_NAMES+=("$CURRENT_TEST_NAME: audit.log missing reap entry for audit-test-1")
        echo "FAIL [$CURRENT_TEST_FILE::$CURRENT_TEST_NAME] expected audit log entry for reaped container"
        echo "audit.log contents:"
        cat "$RL_STATE_DIR/audit.log" 2>/dev/null | sed 's/^/  /'
    fi

    _cleanup_fake
}

run_test "ac-m8-1-reaps-orphan-testcontainer" test_reaps_orphan_testcontainer
run_test "ac-m8-2-active-preserved" test_active_testcontainer_preserved
run_test "ac-m8-3-ryuk-gone-children-reaped" test_ryuk_gone_children_reaped
run_test "ac-m8-4-slot-arg-scopes" test_slot_arg_scopes_to_owning_slot
run_test "ac-m8-5-all-arg-across-slots" test_all_arg_reaps_across_slots
run_test "ac-m8-6-sweeper-invokes-reaper" test_sweeper_invokes_reaper
run_test "ac-m8-bonus-zero-containers-exit-zero" test_zero_containers_exit_zero
run_test "ac-m8-bonus2-audit-logged" test_reaper_audit_logged

print_test_summary
