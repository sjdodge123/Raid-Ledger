#!/usr/bin/env bash
# ROK-1357 — env-spin recreate-on-image-mismatch + PG rollback + unclaimed-slot
# reclaim.
#
# Covers AC6's six cases (+ the unclaimed-slot negative case):
#   1. image-mismatch-recreate      — running image ID != current → recreate
#   2. unchanged-image-fast-path    — running image ID == current → idempotent
#   3. image-unresolvable-keeps-fast-path — empty current ID → fast path + warn
#   4. fail-fast-missing-image      — fresh spin, image not found → no PG created
#   5. trap-cleanup-after-PG        — abort after PG created → PG torn down
#   6. unclaimed-slot-reclaim       — owning slot unclaimed → proceeds (+negative)
#
# Pattern mirrors test_env_destroy_m6a.sh: a PATH-shim `docker` stub writes
# invocations to a call log and returns canned output keyed off env vars set
# per-test. `openssl` and the node bootstrap exec are stubbed too. Must run
# under macOS bash 3.2 — no associative arrays, no ${var^^}, no GNU-only flags.

set -uo pipefail

CURRENT_TEST_FILE="env-spin.test.sh"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$TEST_DIR/test_helpers.sh"

ENV_SPIN_BIN="$BIN_DIR/env-spin"

# --- fixture builder ---------------------------------------------------------

# Globals the docker stub reads (set per-test before invoking env-spin):
#   ES_APP_EXISTS         "true"/"false" — does docker inspect <app> succeed
#   ES_PG_EXISTS          "true"/"false" — does docker inspect <pg> succeed
#   ES_RUNNING_IMAGE_ID   sha256 of the running container's image
#   ES_CURRENT_IMAGE_ID   sha256 the tag resolves to (empty = unresolvable)
#   ES_APP_SLOT           rl.slot label on the existing app container
#   ES_IMAGE_INSPECT_OK   "true"/"false" — does `docker image inspect` succeed
#   ES_PULL_OK            "true"/"false" — does `docker pull` succeed
#   ES_RUN_FAILS_ON       "" | "allinone" — make `docker run` fail for the app
es_setup() {
    test_setup
    export RL_ENVS_FILE="$RL_STATE_DIR/env-registry.json"
    export RL_CLAIMS_FILE="$RL_STATE_DIR/claims.json"
    export RL_AUDIT_LOG="$RL_STATE_DIR/audit.jsonl"
    export RL_TRAEFIK_CONF_D="$RL_STATE_DIR/traefik/conf.d"
    mkdir -p "$RL_TRAEFIK_CONF_D"
    # No public domain by default — keeps Traefik rule logic to the simple
    # branch and the URL fields predictable for assertions.
    unset RL_PUBLIC_DOMAIN || true
    export RL_AGENT_ID="es-agent"
    export RL_OPERATOR=0

    # claims.json: agent es-agent holds slot 1. Slot 2 starts UNCLAIMED.
    cat > "$RL_CLAIMS_FILE" <<JSON
[
  {"slot": 1, "claimed": true,  "agent_id": "es-agent", "branch": "fix/rok-1357", "started_at": "2026-06-07T00:00:00Z", "last_heartbeat": "2026-06-07T00:00:00Z"},
  {"slot": 2, "claimed": false, "agent_id": null,        "branch": null,          "started_at": null,                    "last_heartbeat": null}
]
JSON
    echo "[]" > "$RL_ENVS_FILE"

    # Stub defaults.
    ES_APP_EXISTS="false"
    ES_PG_EXISTS="false"
    ES_RUNNING_IMAGE_ID="sha256:running"
    ES_CURRENT_IMAGE_ID="sha256:current"
    ES_APP_SLOT="1"
    ES_IMAGE_INSPECT_OK="true"
    ES_PULL_OK="true"
    ES_RUN_FAILS_ON=""
    export ES_APP_EXISTS ES_PG_EXISTS ES_RUNNING_IMAGE_ID ES_CURRENT_IMAGE_ID \
           ES_APP_SLOT ES_IMAGE_INSPECT_OK ES_PULL_OK ES_RUN_FAILS_ON

    ES_STUB_DIR="$RL_STATE_DIR/stub-bin"
    mkdir -p "$ES_STUB_DIR"
    cat > "$ES_STUB_DIR/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RL_STATE_DIR/docker-calls.log"
case "$1" in
    inspect)
        # Container inspect. Distinguish app vs pg by the container name, and
        # branch on the requested --format.
        target=""
        fmt=""
        prev=""
        for a in "$@"; do
            case "$a" in
                rl-env-*-allinone) target="app" ;;
                rl-env-*-pg)       target="pg" ;;
            esac
            if [[ "$prev" == "--format" ]]; then fmt="$a"; fi
            prev="$a"
        done
        if [[ "$target" == "app" ]]; then
            [[ "${ES_APP_EXISTS:-false}" == "true" ]] || exit 1
            if [[ "$fmt" == *".Image"* ]]; then printf '%s\n' "${ES_RUNNING_IMAGE_ID:-}"; exit 0; fi
            if [[ "$fmt" == *"rl.slot"* ]]; then printf '%s\n' "${ES_APP_SLOT:-1}"; exit 0; fi
            exit 0
        fi
        if [[ "$target" == "pg" ]]; then
            [[ "${ES_PG_EXISTS:-false}" == "true" ]] || exit 1
            exit 0
        fi
        exit 0
        ;;
    image)
        # `docker image inspect <img> --format '{{.Id}}'`
        # or `--format '{{ index .Config.Labels "rl.synced_head" }}'`
        shift
        if [[ "$1" == "inspect" ]]; then
            [[ "${ES_IMAGE_INSPECT_OK:-true}" == "true" ]] || exit 1
            if [[ "$*" == *"synced_head"* ]]; then printf '\n'; exit 0; fi
            printf '%s\n' "${ES_CURRENT_IMAGE_ID:-}"
            exit 0
        fi
        exit 0
        ;;
    pull)
        [[ "${ES_PULL_OK:-true}" == "true" ]] || exit 1
        exit 0
        ;;
    run)
        if [[ "${ES_RUN_FAILS_ON:-}" == "allinone" && "$*" == *"-allinone"* ]]; then
            echo "stub: simulated docker run failure for allinone" >&2
            exit 125
        fi
        exit 0
        ;;
    rm|exec)
        exit 0
        ;;
    ps)
        # MAX_ENVS_PER_SLOT counting path — return empty (no existing envs).
        printf '\n'
        exit 0
        ;;
esac
exit 0
STUB
    chmod +x "$ES_STUB_DIR/docker"
    # openssl stub for the admin-password fallback.
    cat > "$ES_STUB_DIR/openssl" <<'STUB'
#!/usr/bin/env bash
echo "deadbeefdeadbeef"
STUB
    chmod +x "$ES_STUB_DIR/openssl"
    export PATH="$ES_STUB_DIR:$PATH"
}

es_teardown() {
    test_teardown
    unset RL_ENVS_FILE RL_CLAIMS_FILE RL_AUDIT_LOG RL_TRAEFIK_CONF_D \
          RL_OPERATOR ES_STUB_DIR \
          ES_APP_EXISTS ES_PG_EXISTS ES_RUNNING_IMAGE_ID ES_CURRENT_IMAGE_ID \
          ES_APP_SLOT ES_IMAGE_INSPECT_OK ES_PULL_OK ES_RUN_FAILS_ON 2>/dev/null || true
}

# Run env-spin for the given slug, capturing stdout into ES_OUT and exit into
# ES_RC. The docker call log lives at $RL_STATE_DIR/docker-calls.log.
run_env_spin() {
    local slug="$1"; shift
    ES_OUT=$("$ENV_SPIN_BIN" --slug "$slug" "$@" 2>/dev/null)
    ES_RC=$?
}

# --- AC6.1: image-mismatch → recreate ---------------------------------------

test_image_mismatch_recreate() {
    CURRENT_TEST_NAME="AC6.1: image-ID mismatch recreates from fresh image (recreated:true)"
    es_setup
    export ES_APP_EXISTS="true"
    export ES_PG_EXISTS="true"
    export ES_RUNNING_IMAGE_ID="sha256:OLD"
    export ES_CURRENT_IMAGE_ID="sha256:NEW"

    # --image is EXPLICIT: the mismatch-recreate is armed only for explicit
    # images (bare re-spins never compare against the default :latest ref —
    # see test_bare_spin_never_recreates).
    run_env_spin recreate-me --image registry.rl.lan:5000/rl-allinone:recreate-me

    assert_exit_code "$ES_RC" "0" "env-spin should succeed on recreate"
    local recreated
    recreated=$(jq -r '.recreated' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$recreated" "true" "output must report recreated:true"
    local ok
    ok=$(jq -r '.ok' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$ok" "true" "output must be ok:true"
    # The stale app container must have been removed.
    local rm_line
    rm_line=$(grep -E '^rm -f rl-env-recreate-me-allinone' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_neq "$rm_line" "" "docker rm -f of the stale app container must be logged"
    # PG must NOT be re-created (existing PG reused). Match the `--name` arg
    # specifically — the allinone run line also mentions the pg container in
    # its DATABASE_URL, so a bare slug-substring grep false-positives.
    local pg_run
    pg_run=$(grep -E '^run .*--name rl-env-recreate-me-pg' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_eq "$pg_run" "" "existing PG must be reused, not re-run"
    # Exactly ONE registry row for the slug (upsert, no duplicate).
    local rows
    rows=$(jq --arg s "recreate-me" '[.[] | select(.slug == $s)] | length' "$RL_ENVS_FILE" 2>/dev/null || echo "-1")
    assert_eq "$rows" "1" "registry must hold exactly one row for the slug (no duplicate)"
    es_teardown
}

# --- AC6.2: unchanged image → fast idempotent path --------------------------

test_unchanged_image_fast_path() {
    CURRENT_TEST_NAME="AC6.2: unchanged image keeps the fast idempotent path"
    es_setup
    export ES_APP_EXISTS="true"
    export ES_PG_EXISTS="true"
    export ES_RUNNING_IMAGE_ID="sha256:SAME"
    export ES_CURRENT_IMAGE_ID="sha256:SAME"

    run_env_spin steady --image registry.rl.lan:5000/rl-allinone:steady

    assert_exit_code "$ES_RC" "0" "env-spin should succeed on idempotent re-spin"
    local idem
    idem=$(jq -r '.idempotent' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$idem" "true" "output must report idempotent:true"
    local recreated
    recreated=$(jq -r '.recreated' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$recreated" "false" "idempotent path must report recreated:false"
    # No gratuitous rm of the app container.
    local rm_line
    rm_line=$(grep -E '^rm -f rl-env-steady-allinone' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_eq "$rm_line" "" "fast path must NOT remove the running container"
    es_teardown
}

# --- AC6.3: image unresolvable → keep fast path + warn ----------------------

test_image_unresolvable_keeps_fast_path() {
    CURRENT_TEST_NAME="AC6.3: unresolvable image keeps fast path + emits warning (never destroy)"
    es_setup
    export ES_APP_EXISTS="true"
    export ES_PG_EXISTS="true"
    export ES_RUNNING_IMAGE_ID="sha256:running"
    export ES_CURRENT_IMAGE_ID=""   # docker image inspect returns empty

    run_env_spin orphan-tag --image registry.rl.lan:5000/rl-allinone:orphan-tag

    assert_exit_code "$ES_RC" "0" "env-spin must NOT fail on an inspect miss"
    local idem
    idem=$(jq -r '.idempotent' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$idem" "true" "indeterminate image must keep the idempotent path"
    local warn
    warn=$(jq -r '.image_warning' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_neq "$warn" "null" "a non-null image_warning must be surfaced"
    assert_neq "$warn" "" "image_warning must be populated"
    # The container must NOT be destroyed over the inspect miss.
    local rm_line
    rm_line=$(grep -E '^rm -f rl-env-orphan-tag-allinone' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_eq "$rm_line" "" "must NOT destroy a healthy env over an inspect miss"
    es_teardown
}

# --- AC6.3b: bare re-spin (no --image) never arms the recreate ---------------

test_bare_spin_never_recreates() {
    CURRENT_TEST_NAME="AC6.3b: bare re-spin (no --image) never compares against the default :latest"
    es_setup
    export ES_APP_EXISTS="true"
    export ES_PG_EXISTS="true"
    # A mismatch IS visible to docker (e.g. :latest exists locally and differs)
    # — but with no --image the caller expressed no opinion, so env-spin must
    # NOT recreate the env onto the default ref. Fast idempotent path, no rm.
    export ES_RUNNING_IMAGE_ID="sha256:branchbuild"
    export ES_CURRENT_IMAGE_ID="sha256:latestlocal"

    run_env_spin bare-respin

    assert_exit_code "$ES_RC" "0" "bare re-spin must succeed"
    local idem
    idem=$(jq -r '.idempotent' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$idem" "true" "bare re-spin must take the idempotent path"
    local recreated
    recreated=$(jq -r '.recreated' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$recreated" "false" "bare re-spin must report recreated:false"
    local rm_line
    rm_line=$(grep -E '^rm -f rl-env-bare-respin-allinone' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_eq "$rm_line" "" "bare re-spin must NEVER remove the running container"
    es_teardown
}

# --- AC6.4: fail-fast missing image (fresh) → no PG created ------------------

test_fail_fast_missing_image() {
    CURRENT_TEST_NAME="AC6.4: fresh spin with a missing image fails fast before any PG is created"
    es_setup
    export ES_APP_EXISTS="false"        # fresh path
    export ES_PG_EXISTS="false"
    export ES_IMAGE_INSPECT_OK="false"  # image not present locally
    export ES_PULL_OK="false"           # and not pullable

    run_env_spin doomed

    assert_exit_code "$ES_RC" "1" "env-spin must fail when the image can't be resolved"
    local err
    err=$(jq -r '.error' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$err" "image_not_found" "error must be image_not_found"
    # No PG container should have been created.
    local pg_run
    pg_run=$(grep -E '^run .*--name rl-env-doomed-pg' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_eq "$pg_run" "" "NO pg container must be created on the fail-fast path"
    es_teardown
}

# --- AC6.5: trap cleanup after PG created -----------------------------------

test_trap_cleanup_after_pg() {
    CURRENT_TEST_NAME="AC6.5: abort after PG creation tears down the orphaned PG (EXIT trap)"
    es_setup
    export ES_APP_EXISTS="false"        # fresh path
    export ES_PG_EXISTS="false"         # PG gets created this run
    export ES_IMAGE_INSPECT_OK="true"   # image resolves (passes fail-fast)
    export ES_RUN_FAILS_ON="allinone"   # allinone `docker run` fails → abort

    run_env_spin halfspun

    assert_neq "$ES_RC" "0" "env-spin should abort when the allinone run fails"
    # PG was created...
    local pg_run
    pg_run=$(grep -E '^run .*--name rl-env-halfspun-pg' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_neq "$pg_run" "" "the PG container should have been created before the abort"
    # ...and the EXIT trap must have removed it.
    local pg_rm
    pg_rm=$(grep -E '^rm -f rl-env-halfspun-pg' "$RL_STATE_DIR/docker-calls.log" 2>/dev/null | head -1 || true)
    assert_neq "$pg_rm" "" "EXIT trap must rm -f the orphaned PG container"
    es_teardown
}

# --- AC6.6a: unclaimed-slot reclaim (positive) ------------------------------

test_unclaimed_slot_reclaim_positive() {
    CURRENT_TEST_NAME="AC6.6a: slug owned by an UNCLAIMED slot is reclaimable"
    es_setup
    # The existing app container is labeled with slot 2, but slot 2 is
    # UNCLAIMED in claims.json (set up in es_setup). es-agent holds slot 1.
    export ES_APP_EXISTS="true"
    export ES_PG_EXISTS="true"
    export ES_APP_SLOT="2"
    # Force a recreate so the fresh path rewrites the slot — but even the
    # fast path would do; the key assertion is that it does NOT refuse.
    export ES_RUNNING_IMAGE_ID="sha256:OLD"
    export ES_CURRENT_IMAGE_ID="sha256:NEW"

    run_env_spin stranded

    assert_exit_code "$ES_RC" "0" "reclaim from an unclaimed slot must proceed"
    local err
    err=$(jq -r '.error // "none"' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$err" "none" "must NOT emit slug_owned_by_other_slot"
    # Audit line records the reclaim.
    local audit
    audit=$(grep 'slug-reclaimed-from-unclaimed-slot' "$RL_AUDIT_LOG" 2>/dev/null | head -1 || true)
    assert_neq "$audit" "" "audit log must record slug-reclaimed-from-unclaimed-slot"
    # Registry row now reflects THIS slot (1), and there's exactly one.
    local rows new_slot
    rows=$(jq --arg s "stranded" '[.[] | select(.slug == $s)] | length' "$RL_ENVS_FILE" 2>/dev/null || echo "-1")
    assert_eq "$rows" "1" "registry must hold exactly one row for the reclaimed slug"
    new_slot=$(jq -r --arg s "stranded" '[.[] | select(.slug == $s) | .slot] | first' "$RL_ENVS_FILE" 2>/dev/null || echo "")
    assert_eq "$new_slot" "1" "registry row must move to the reclaiming slot (1)"
    es_teardown
}

# --- AC6.6b: claimed other slot still refuses (negative) --------------------

test_claimed_slot_still_refuses() {
    CURRENT_TEST_NAME="AC6.6b: slug owned by a CLAIMED other slot still refuses"
    es_setup
    # Mark slot 2 as CLAIMED by another agent.
    cat > "$RL_CLAIMS_FILE" <<JSON
[
  {"slot": 1, "claimed": true, "agent_id": "es-agent",  "branch": "fix/rok-1357"},
  {"slot": 2, "claimed": true, "agent_id": "other-agent", "branch": "feat/other"}
]
JSON
    export ES_APP_EXISTS="true"
    export ES_PG_EXISTS="true"
    export ES_APP_SLOT="2"

    run_env_spin contested

    assert_exit_code "$ES_RC" "1" "must refuse when the owning slot is still claimed"
    local err
    err=$(jq -r '.error' <<<"$ES_OUT" 2>/dev/null || echo "")
    assert_eq "$err" "slug_owned_by_other_slot" "error must be slug_owned_by_other_slot"
    es_teardown
}

run_test "ac6.1-image-mismatch-recreate"        test_image_mismatch_recreate
run_test "ac6.2-unchanged-image-fast-path"      test_unchanged_image_fast_path
run_test "ac6.3-image-unresolvable-fast-path"   test_image_unresolvable_keeps_fast_path
run_test "ac6.3b-bare-spin-never-recreates"     test_bare_spin_never_recreates
run_test "ac6.4-fail-fast-missing-image"        test_fail_fast_missing_image
run_test "ac6.5-trap-cleanup-after-pg"          test_trap_cleanup_after_pg
run_test "ac6.6a-unclaimed-slot-reclaim"        test_unclaimed_slot_reclaim_positive
run_test "ac6.6b-claimed-slot-refuses"          test_claimed_slot_still_refuses

print_test_summary
