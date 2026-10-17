#!/usr/bin/env bash
# =============================================================================
# migration-drift-probe.test.sh — ROK-1320 regression
# =============================================================================
# Unit-tests the migration-drift probe added to scripts/deploy_dev.sh WITHOUT
# requiring a live Postgres. We source deploy_dev.sh (its sourcing guard makes
# it define functions but skip arg-parse/action dispatch), point the journal
# helpers at throwaway fixtures, and stub `gather_db_hashes` / `npm` to feed
# controlled tag/hash sets into the probe.
#
# Run directly:        ./scripts/test/migration-drift-probe.test.sh
# Or via the runner:   ./scripts/test/run-all.sh
# Exit 0 = all cases passed; non-zero = a case failed (with diagnostics).
#
# Cases:
#   1. compute_migration_drift — parity                → no output
#   2. compute_migration_drift — journal ahead of db   → missing:<hash>
#   3. compute_migration_drift — phantom db rows       → phantom:<hash>
#   4. gather_journal_hashes — fixture journal         → sha256(<tag>.sql)
#   5. check_migration_drift — parity (stubbed db)     → exit 0, "in sync"
#   6. check_migration_drift — drift, migrate fixes it → exit 0, "resolved"
#   7. check_migration_drift — drift, migrate FAILS    → exit 3, "NOT starting"
#   8. check_migration_drift — phantom rows            → exit 3, reconcile hint
#   9. check_migration_drift — DB not queryable        → exit 0, "skipped"
# =============================================================================

set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/scripts/deploy_dev.sh"

[[ -f "$DEPLOY_SCRIPT" ]] || { echo "missing $DEPLOY_SCRIPT"; exit 1; }

# Counters live in temp files so increments inside case subshells survive back
# to the parent (subshell variable writes wouldn't otherwise propagate).
COUNT_DIR="$(mktemp -d)"
echo 0 > "$COUNT_DIR/pass"
echo 0 > "$COUNT_DIR/fail"
trap 'rm -rf "$COUNT_DIR"' EXIT

pass() { echo "  ✓ $1"; echo $(( $(cat "$COUNT_DIR/pass") + 1 )) > "$COUNT_DIR/pass"; }
fail() { echo "  ✗ $1"; echo $(( $(cat "$COUNT_DIR/fail") + 1 )) > "$COUNT_DIR/fail"; }

# --- Fixture builders --------------------------------------------------------
# Build a temp migrations dir with a journal + per-tag .sql files so the real
# gather_journal_hashes can sha256 them exactly as production does.
make_fixture_migrations() {
    local dir="$1"; shift
    mkdir -p "$dir/meta"
    local entries=""
    local idx=0
    for tag in "$@"; do
        # Deterministic, tag-unique SQL content → deterministic hash.
        printf 'CREATE TABLE %s (id int);\n' "$tag" > "$dir/$tag.sql"
        [ -n "$entries" ] && entries+=","
        entries+=$(printf '{"idx":%d,"version":"7","when":%d,"tag":"%s","breakpoints":true}' \
            "$idx" "$((1770000000000 + idx))" "$tag")
        idx=$((idx + 1))
    done
    printf '{"version":"7","dialect":"postgresql","entries":[%s]}\n' "$entries" \
        > "$dir/meta/_journal.json"
}

# Compute the hash deploy_dev.sh would store for a fixture tag.
fixture_hash() {
    local dir="$1" tag="$2"
    local h
    h=$(shasum -a 256 "$dir/$tag.sql" 2>/dev/null | awk '{print $1}')
    [ -z "$h" ] && h=$(sha256sum "$dir/$tag.sql" 2>/dev/null | awk '{print $1}')
    echo "$h"
}

# =============================================================================
# Cases 1-3: pure diff logic (compute_migration_drift)
# =============================================================================
echo "compute_migration_drift (pure diff):"
(
    # shellcheck source=/dev/null
    source "$DEPLOY_SCRIPT"
    set +e  # deploy_dev.sh re-enables set -e at its top; disable it for assertions

    # Case 1: parity → empty
    out=$(compute_migration_drift $'a\nb\nc' $'a\nb\nc')
    if [ -z "$out" ]; then pass "parity → no drift output"; else fail "parity produced: $out"; fi

    # Case 2: journal ahead of db → missing
    out=$(compute_migration_drift $'a\nb\nc' $'a\nb')
    if [ "$out" = "missing:c" ]; then pass "journal ahead → missing:c"; else fail "expected missing:c, got: $out"; fi

    # Case 3: phantom db rows → phantom
    out=$(compute_migration_drift $'a\nb' $'a\nb\nz')
    if [ "$out" = "phantom:z" ]; then pass "phantom row → phantom:z"; else fail "expected phantom:z, got: $out"; fi

    # Bonus: both directions at once
    out=$(compute_migration_drift $'a\nb\nc' $'a\nb\nz')
    if echo "$out" | grep -q '^missing:c$' && echo "$out" | grep -q '^phantom:z$'; then
        pass "mixed drift → both missing:c and phantom:z"
    else
        fail "mixed drift wrong: $out"
    fi
)

# =============================================================================
# Case 4: gather_journal_hashes against a fixture journal
# =============================================================================
echo "gather_journal_hashes (fixture journal):"
(
    FIX=$(mktemp -d)
    make_fixture_migrations "$FIX" 0000_alpha 0001_beta 0002_gamma
    # shellcheck source=/dev/null
    source "$DEPLOY_SCRIPT"
    set +e  # deploy_dev.sh re-enables set -e at its top; disable it for assertions
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    MIGRATIONS_DIR="$FIX"
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    JOURNAL_PATH="$FIX/meta/_journal.json"

    out=$(gather_journal_hashes)
    expected_h=$(fixture_hash "$FIX" 0001_beta)
    if echo "$out" | grep -q "$expected_h 0001_beta"; then
        pass "emits sha256(<tag>.sql) + tag for each entry"
    else
        fail "missing expected hash/tag line. got:\n$out"
    fi
    n=$(echo "$out" | grep -c .)
    if [ "$n" -eq 3 ]; then pass "one line per journal entry (3)"; else fail "expected 3 lines, got $n"; fi
    rm -rf "$FIX"
)

# =============================================================================
# Cases 5-9: check_migration_drift orchestration (stubbed db + npm)
# =============================================================================
# Each case runs in a subshell so stubs/overrides don't leak. We source the
# script, point the journal helpers at a fixture, then override gather_db_hashes
# (and npm where needed) to feed controlled inputs. run_probe captures the
# probe's combined output + exit code (its `exit 3` exits only the command
# substitution, not the case subshell).
echo "check_migration_drift (orchestration):"

# Helper used inside each case subshell: run the probe, capture out+code.
run_probe() {
    local _out _code
    _out=$(check_migration_drift 2>&1); _code=$?
    printf '%s\n' "$_out"
    return $_code
}

# --- Case 5: parity → exit 0, "in sync" ---
(
    FIX=$(mktemp -d); make_fixture_migrations "$FIX" 0000_a 0001_b
    # shellcheck source=/dev/null
    source "$DEPLOY_SCRIPT"
    set +e  # deploy_dev.sh re-enables set -e at its top; disable it for assertions
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    MIGRATIONS_DIR="$FIX"
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    JOURNAL_PATH="$FIX/meta/_journal.json"
    HA=$(fixture_hash "$FIX" 0000_a); HB=$(fixture_hash "$FIX" 0001_b)
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    gather_db_hashes() { printf '%s\n%s\n' "$HA" "$HB"; return 0; }
    out=$(run_probe); code=$?
    if [ "$code" -eq 0 ] && echo "$out" | grep -q "in sync"; then
        pass "parity → exit 0, reports in sync"
    else
        fail "parity: code=$code out=$out"
    fi
    rm -rf "$FIX"
)

# --- Case 6: drift, db:migrate applies it → exit 0, "resolved" ---
(
    FIX=$(mktemp -d); make_fixture_migrations "$FIX" 0000_a 0001_b
    # shellcheck source=/dev/null
    source "$DEPLOY_SCRIPT"
    set +e  # deploy_dev.sh re-enables set -e at its top; disable it for assertions
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    MIGRATIONS_DIR="$FIX"
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    JOURNAL_PATH="$FIX/meta/_journal.json"
    HA=$(fixture_hash "$FIX" 0000_a); HB=$(fixture_hash "$FIX" 0001_b)
    # First probe: db missing 0001_b. After "migrate", db has both.
    STATE_FILE="$FIX/.migrated"
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    gather_db_hashes() {
        if [ -f "$STATE_FILE" ]; then printf '%s\n%s\n' "$HA" "$HB"; else printf '%s\n' "$HA"; fi
        return 0
    }
    # Stub npm so `npm run db:migrate -w api` "succeeds" and advances state.
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    npm() { touch "$STATE_FILE"; return 0; }
    out=$(run_probe); code=$?
    if [ "$code" -eq 0 ] && echo "$out" | grep -q "resolved"; then
        pass "drift + migrate succeeds → exit 0, drift resolved"
    else
        fail "drift-fix: code=$code out=$out"
    fi
    rm -rf "$FIX"
)

# --- Case 7: drift, db:migrate FAILS → exit 3, "NOT starting" ---
(
    FIX=$(mktemp -d); make_fixture_migrations "$FIX" 0000_a 0001_b
    # shellcheck source=/dev/null
    source "$DEPLOY_SCRIPT"
    set +e  # deploy_dev.sh re-enables set -e at its top; disable it for assertions
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    MIGRATIONS_DIR="$FIX"
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    JOURNAL_PATH="$FIX/meta/_journal.json"
    HA=$(fixture_hash "$FIX" 0000_a)
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    gather_db_hashes() { printf '%s\n' "$HA"; return 0; }  # never gets 0001_b
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    npm() { echo "migrate boom"; return 1; }               # migrate always fails
    out=$(run_probe); code=$?
    if [ "$code" -eq 3 ] && echo "$out" | grep -q "NOT starting the API"; then
        pass "drift + migrate fails → exit 3, NOT starting the API"
    else
        fail "migrate-fail: code=$code out=$out"
    fi
    rm -rf "$FIX"
)

# --- Case 8: phantom rows → exit 3, reconcile hint ---
(
    FIX=$(mktemp -d); make_fixture_migrations "$FIX" 0000_a 0001_b
    # shellcheck source=/dev/null
    source "$DEPLOY_SCRIPT"
    set +e  # deploy_dev.sh re-enables set -e at its top; disable it for assertions
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    MIGRATIONS_DIR="$FIX"
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    JOURNAL_PATH="$FIX/meta/_journal.json"
    HA=$(fixture_hash "$FIX" 0000_a); HB=$(fixture_hash "$FIX" 0001_b)
    # DB has an extra orphan hash not in the journal.
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    gather_db_hashes() { printf '%s\n%s\n%s\n' "$HA" "$HB" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; return 0; }
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    npm() { echo "npm should NOT be called for phantom"; return 0; }
    out=$(run_probe); code=$?
    if [ "$code" -eq 3 ] && echo "$out" | grep -q "reconcile-migrations.mjs" && echo "$out" | grep -q "orphan"; then
        pass "phantom rows → exit 3, points at reconcile-migrations.mjs"
    else
        fail "phantom: code=$code out=$out"
    fi
    rm -rf "$FIX"
)

# --- Case 9: DB not queryable → exit 0, "skipped" ---
(
    FIX=$(mktemp -d); make_fixture_migrations "$FIX" 0000_a
    # shellcheck source=/dev/null
    source "$DEPLOY_SCRIPT"
    set +e  # deploy_dev.sh re-enables set -e at its top; disable it for assertions
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions
    MIGRATIONS_DIR="$FIX"
    # shellcheck disable=SC2034  # consumed by sourced deploy_dev.sh functions (unused on the DB-down path)
    JOURNAL_PATH="$FIX/meta/_journal.json"
    # shellcheck disable=SC2329  # invoked indirectly by sourced check_migration_drift
    gather_db_hashes() { return 1; }  # simulate DB/table not up yet
    out=$(run_probe); code=$?
    if [ "$code" -eq 0 ] && echo "$out" | grep -q "skipped"; then
        pass "DB not queryable → exit 0, probe skipped (no false abort)"
    else
        fail "db-down: code=$code out=$out"
    fi
    rm -rf "$FIX"
)

# =============================================================================
echo ""
PASS=$(cat "$COUNT_DIR/pass")
FAIL=$(cat "$COUNT_DIR/fail")
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
