#!/usr/bin/env bash
# ROK-1600 — gc-sweeper TTL decision: registry-aware age clock + the
# pending-test-plan grace.
#
# Two layers:
#   1. The predicate in orchestrator/bin/_env_ttl.sh, called directly. It is
#      pure logic (jq + arithmetic, no docker), so both directions of every
#      branch are cheap to assert — including the ceiling that guarantees an
#      abandoned env with a forgotten plan still dies.
#   2. One end-to-end pass through sweep.sh with a `docker` shim on PATH,
#      proving the predicate is actually WIRED into step 2 — the lib being
#      correct while the sweeper ignores it is exactly the failure mode that
#      lost rok1564a's 9 pending plans.

set -uo pipefail

CURRENT_TEST_FILE="gc-sweeper-plan-guard.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

SWEEP_SCRIPT="$(cd "$TEST_DIR/../../gc-sweeper" && pwd)/sweep.sh"
ENV_TTL_LIB="$(cd "$TEST_DIR/../bin" && pwd)/_env_ttl.sh"
# shellcheck disable=SC1090
source "$ENV_TTL_LIB"

# ISO timestamp N hours ago (GNU date first, BSD/macOS fallback).
iso_hours_ago() {
    local hours="$1"
    date -u -d "now - ${hours} hours" +%FT%TZ 2>/dev/null \
        || date -u -v-"${hours}"H +%FT%TZ 2>/dev/null \
        || date -u +%FT%TZ
}

# Write TEST_PLANS_DIR/<slug>/<plan>.json with `pending` verdictless steps
# and `done` steps that already carry a pass.
seed_plan() {
    local plans_dir="$1" slug="$2" plan_id="$3" pending="$4" done_count="$5"
    mkdir -p "$plans_dir/$slug"
    jq -nc --arg slug "$slug" --arg plan_id "$plan_id" \
        --argjson pending "$pending" --argjson done_count "$done_count" \
        '{slug:$slug, plan_id:$plan_id, story_id:"ROK-1600", goal:"guard the sweeper",
          created_at:"2026-09-16T00:00:00Z",
          steps: ([range(0; $done_count) | {id:(.+1), description:"done", results:[{tester:"op", verdict:"pass", ts:"2026-09-16T01:00:00Z"}]}]
                  + [range(0; $pending) | {id:(.+$done_count+1), description:"pending", results:[]}])}' \
        > "$plans_dir/$slug/$plan_id.json"
}

# ---------------------------------------------------------------------------
# Layer 1 — the predicate.
# ---------------------------------------------------------------------------

# An env past its TTL with a verdictless step is spared, and the SAME env with
# every step answered is reaped. Both directions, one fixture.
test_pending_plan_spares_answered_plan_reaped() {
    CURRENT_TEST_NAME="AC1: pending plan spares the env, answered plan does not"
    local plans_dir="$TMP_STATE/test-plans" now
    now=$(date -u +%s)
    seed_plan "$plans_dir" "rok1600a" "2026-09-16-0300-ab12" 3 1

    local pending decision
    pending=$(env_ttl::pending_plan_steps "rok1600a" "$plans_dir")
    assert_eq "$pending" "3" "three verdictless steps should count as pending"
    decision=$(env_ttl::decision "$now" "$(( now - 25 * 3600 ))" 24 "$pending" 24)
    assert_eq "${decision%% *}" "plan_grace" "25h-old env with pending steps must be spared"

    # Same env, every step answered.
    seed_plan "$plans_dir" "rok1600a" "2026-09-16-0300-ab12" 0 4
    pending=$(env_ttl::pending_plan_steps "rok1600a" "$plans_dir")
    assert_eq "$pending" "0" "fully-verdicted plan has no pending steps"
    decision=$(env_ttl::decision "$now" "$(( now - 25 * 3600 ))" 24 "$pending" 24)
    assert_eq "${decision%% *}" "reap" "25h-old env with no pending steps must be reaped"
}

# The guarantee that keeps this fix from becoming a disk leak: the grace is an
# absolute ceiling, not a renewal. A plan nobody ever answers cannot pin a slot.
test_grace_is_an_absolute_ceiling() {
    CURRENT_TEST_NAME="AC2: pending plan delays the reap, never blocks it"
    local now
    now=$(date -u +%s)

    local at_47 at_48 at_500
    at_47=$(env_ttl::decision "$now" "$(( now - 47 * 3600 ))" 24 5 24)
    at_48=$(env_ttl::decision "$now" "$(( now - 48 * 3600 ))" 24 5 24)
    at_500=$(env_ttl::decision "$now" "$(( now - 500 * 3600 ))" 24 5 24)
    assert_eq "${at_47%% *}" "plan_grace" "47h < ttl+grace(48h) — still spared"
    assert_eq "${at_48%% *}" "reap" "48h == ttl+grace — reaped despite pending steps"
    assert_eq "${at_500%% *}" "reap" "a forgotten plan cannot keep an env alive forever"
    assert_eq "$at_48" "reap 48 48" "deadline reported as ttl+grace for the audit record"

    # grace=0 is the operator escape hatch: guard off, old behaviour exactly.
    local no_grace
    no_grace=$(env_ttl::decision "$now" "$(( now - 25 * 3600 ))" 24 5 0)
    assert_eq "${no_grace%% *}" "reap" "TEST_PLAN_GRACE_HOURS=0 disables the guard"
}

# A healthy env inside its TTL is untouched whether or not plans exist, and a
# missing/empty plan dir must not be read as "pending" (fail open).
test_inside_ttl_and_missing_plans() {
    CURRENT_TEST_NAME="AC3: inside TTL kept; absent plan dir counts zero"
    local now plans_dir="$TMP_STATE/test-plans"
    now=$(date -u +%s)
    assert_eq "$(env_ttl::pending_plan_steps "never-had-a-plan" "$plans_dir")" "0" \
        "absent plan dir must count 0 pending, not spare the env"
    mkdir -p "$plans_dir/broken"
    echo 'not json at all' > "$plans_dir/broken/2026-09-16-0300-ffff.json"
    assert_eq "$(env_ttl::pending_plan_steps "broken" "$plans_dir")" "0" \
        "unparseable plan file must fail open (0 pending), not make the env immortal"
    assert_eq "$(env_ttl::decision "$now" "$(( now - 3 * 3600 ))" 24 0 24 | cut -d' ' -f1)" "keep" \
        "3h-old env is inside its TTL"
}

# Defect 2: the age clock. env-spin reuses the PG container, so its label
# keeps the ORIGINAL spin time; the registry row is what a redeploy bumps.
test_registry_last_touched_beats_stale_label() {
    CURRENT_TEST_NAME="AC4: redeploy resets the clock via the registry row"
    local envs="$TMP_STATE/env-registry.json" now
    now=$(date -u +%s)
    jq -nc --arg lt "$(iso_hours_ago 1)" \
        '[{slug:"rok1570a", slot:1, image:"img", ttl:"24h", created_at:"2026-09-15T22:37:00Z", last_touched:$lt}]' \
        > "$envs"

    # Stale PG label (26h) + fresh registry row (1h) => env is 1h old.
    local ref age
    ref=$(env_ttl::reference_epoch "$(iso_hours_ago 26)" "rok1570a" "$envs")
    age=$(( (now - ref) / 3600 ))
    assert_le "$age" "1" "registry last_touched must win over the reused PG's stale label"
    assert_eq "$(env_ttl::decision "$now" "$ref" 24 0 24 | cut -d' ' -f1)" "keep" \
        "a redeployed env must NOT be reaped off its sidecar's stale label"

    # No registry row (orphan container) => the label still governs, so an
    # orphan does not become immortal.
    local orphan_ref
    orphan_ref=$(env_ttl::reference_epoch "$(iso_hours_ago 26)" "not-in-registry" "$envs")
    assert_eq "$(env_ttl::decision "$now" "$orphan_ref" 24 0 24 | cut -d' ' -f1)" "reap" \
        "container with no registry row still ages off its own label"
}

# ---------------------------------------------------------------------------
# Layer 2 — wiring. Run sweep.sh against a docker shim.
# ---------------------------------------------------------------------------

# Shim: one env container, labels supplied by the caller. Records `docker rm`
# targets so we can assert what the sweeper tried to destroy.
_make_docker_shim() {
    local shim_dir="$1" labels="$2" rm_log="$3"
    mkdir -p "$shim_dir"
    cat > "$shim_dir/docker" <<EOF
#!/usr/bin/env bash
RM_LOG="$rm_log"
LABELS='$labels'
EOF
    cat >> "$shim_dir/docker" <<'EOF'
case "$1" in
    ps)
        # Step 2 is the only caller using --format '{{.ID}}'; every other
        # ps call (-aq slot filters, counts) must stay empty.
        for a in "$@"; do [[ "$a" == "{{.ID}}" ]] && { echo "envcid1"; exit 0; }; done
        exit 0 ;;
    inspect)
        # Step 1b prunes any registry slug whose allinone container is
        # missing, and reaps it when health is 'unhealthy'. Answer both so
        # step 2's TTL decision is the only thing under test here.
        for a in "$@"; do
            [[ "$a" == "{{json .Config.Labels}}" ]] && { echo "$LABELS"; exit 0; }
            [[ "$a" == "{{.State.Health.Status}}" ]] && { echo "healthy"; exit 0; }
        done
        echo "[]"; exit 0 ;;
    rm) shift; echo "$*" >> "$RM_LOG"; exit 0 ;;
    *) exit 0 ;;
esac
EOF
    chmod +x "$shim_dir/docker"
}

_run_sweeper_with() {
    local shim_dir="$1" plans_dir="$2" grace="$3"
    PATH="$shim_dir:$PATH" \
        STATE_DIR="$RL_STATE_DIR" \
        RL_STATE_DIR="$RL_STATE_DIR" \
        TEST_PLANS_DIR="$plans_dir" \
        TEST_PLAN_GRACE_HOURS="$grace" \
        ENV_TTL_LIB="$ENV_TTL_LIB" \
        bash "$SWEEP_SCRIPT" >/dev/null 2>&1 || true
}

test_sweeper_spares_env_with_pending_plan() {
    CURRENT_TEST_NAME="AC5: sweep.sh step 2 honours the pending-plan guard"
    local plans_dir="$TMP_STATE/test-plans" shim_dir="$TMP_STATE/shim"
    local rm_log="$TMP_STATE/rm.log" labels
    : > "$rm_log"
    echo '[]' > "$RL_STATE_DIR/claims.json"
    echo '[]' > "$RL_STATE_DIR/queue.json"
    jq -nc --arg lt "$(iso_hours_ago 30)" \
        '[{slug:"rok1600e", slot:1, image:"img", ttl:"24h", created_at:"2026-09-16T00:00:00Z", last_touched:$lt}]' \
        > "$RL_STATE_DIR/env-registry.json"
    labels=$(jq -nc --arg lt "$(iso_hours_ago 30)" \
        '{"rl.role":"env","rl.env_slug":"rok1600e","rl.ttl":"24h","rl.slot":"1","rl.last_touched":$lt}')
    _make_docker_shim "$shim_dir" "$labels" "$rm_log"
    seed_plan "$plans_dir" "rok1600e" "2026-09-16-0300-ab12" 2 1

    _run_sweeper_with "$shim_dir" "$plans_dir" 24

    # grep -c prints 0 AND exits 1 on no-match; `|| true` keeps the single 0.
    assert_eq "$(grep -c 'rok1600e' "$rm_log" 2>/dev/null || true)" "0" \
        "30h-old env with 2 pending steps must NOT be destroyed (ttl+grace = 48h)"
    assert_eq "$(jq -r '.[0].slug // "gone"' "$RL_STATE_DIR/env-registry.json")" "rok1600e" \
        "spared env must stay in the registry (its removal is what prunes the plans)"
    assert_contains "$(cat "$RL_STATE_DIR/audit.log" 2>/dev/null || echo "")" \
        "env_ttl_extended_pending_plan" "the spare must be auditable"
}

test_sweeper_reaps_env_without_pending_plan() {
    CURRENT_TEST_NAME="AC6: sweep.sh still reaps an expired env with no pending steps"
    local plans_dir="$TMP_STATE/test-plans" shim_dir="$TMP_STATE/shim"
    local rm_log="$TMP_STATE/rm.log" labels
    : > "$rm_log"
    echo '[]' > "$RL_STATE_DIR/claims.json"
    echo '[]' > "$RL_STATE_DIR/queue.json"
    jq -nc --arg lt "$(iso_hours_ago 30)" \
        '[{slug:"rok1600f", slot:1, image:"img", ttl:"24h", created_at:"2026-09-16T00:00:00Z", last_touched:$lt}]' \
        > "$RL_STATE_DIR/env-registry.json"
    labels=$(jq -nc --arg lt "$(iso_hours_ago 30)" \
        '{"rl.role":"env","rl.env_slug":"rok1600f","rl.ttl":"24h","rl.slot":"1","rl.last_touched":$lt}')
    _make_docker_shim "$shim_dir" "$labels" "$rm_log"
    seed_plan "$plans_dir" "rok1600f" "2026-09-16-0300-cd34" 0 3

    _run_sweeper_with "$shim_dir" "$plans_dir" 24

    assert_contains "$(cat "$rm_log")" "rl-env-rok1600f-allinone" \
        "expired env with every step verdicted must still be destroyed"
    assert_eq "$(jq -r '.[0].slug // "gone"' "$RL_STATE_DIR/env-registry.json")" "gone" \
        "reaped env must be dropped from the registry"
}

run_test "ac1-pending-spares-answered-reaps" test_pending_plan_spares_answered_plan_reaped
run_test "ac2-grace-is-absolute-ceiling" test_grace_is_an_absolute_ceiling
run_test "ac3-inside-ttl-and-missing-plans" test_inside_ttl_and_missing_plans
run_test "ac4-registry-beats-stale-label" test_registry_last_touched_beats_stale_label
run_test "ac5-sweeper-spares-pending-plan" test_sweeper_spares_env_with_pending_plan
run_test "ac6-sweeper-reaps-without-plan" test_sweeper_reaps_env_without_pending_plan

print_test_summary
