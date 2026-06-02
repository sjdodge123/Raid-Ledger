#!/usr/bin/env bash
# ROK-1319 — reconcile-migrations.mjs trust-mode effect probe.
#
# Regression for the bug where `trust` mode (schemaRestored=true) silently
# inserted a hash row for EVERY journal entry without verifying the migration's
# effect actually exists. A DB that's merely OUT OF DATE (e.g. restored from an
# older backup missing newer migrations) got phantom journal rows + missing
# tables — API boots healthy, runtime requests 500 against tables that don't
# exist.
#
# The fix probes the first DDL effect of each entry in trust mode:
#   • effect present → trust (record hash only)
#   • effect absent  → demote to a real run (actually execute the SQL)
#
# This test drives the REAL scripts/reconcile-migrations.mjs against a throwaway
# Postgres container, using RL_MIGRATIONS_DIR to point it at a fixture journal:
#
#   AC-2: a populated DB (trust mode) whose schema has every fixture migration's
#         effect EXCEPT exactly one → reconcile must RUN the missing one (table
#         lands + hash row recorded), NOT silently trust it.
#   AC-3: a populated DB where the effect already exists AND its hash row is
#         already present → reconcile is a no-op skip.

set -uo pipefail
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TEST_DIR/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/reconcile-migrations.mjs"

PASS=0
FAIL=0
FAILED_NAMES=()
pass() { PASS=$((PASS + 1)); }
fail() {
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$1")
    echo "FAIL: $1" >&2
}

[[ -f "$SCRIPT" ]] || { echo "missing $SCRIPT"; exit 1; }

command -v docker >/dev/null 2>&1 || { echo "docker not available — skipping"; exit 0; }

CONTAINER_NAME="rl-reconcile-trust-test-$$"
FIXTURE_DIR="$(mktemp -d)"

cleanup() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Build a fixture migrations dir + journal. Three migrations, each a CREATE
# TABLE — deterministic, no dependency on the real schema.
# ---------------------------------------------------------------------------
mkdir -p "$FIXTURE_DIR/meta"
cat > "$FIXTURE_DIR/0000_alpha.sql" <<'SQL'
CREATE TABLE "rl_alpha" (
	"id" integer PRIMARY KEY
);
SQL
cat > "$FIXTURE_DIR/0001_beta.sql" <<'SQL'
CREATE TABLE "rl_beta" (
	"id" integer PRIMARY KEY
);
SQL
cat > "$FIXTURE_DIR/0002_gamma.sql" <<'SQL'
CREATE TABLE "rl_gamma" (
	"id" integer PRIMARY KEY
);
SQL
cat > "$FIXTURE_DIR/meta/_journal.json" <<'JSON'
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1000, "tag": "0000_alpha", "breakpoints": true },
    { "idx": 1, "version": "7", "when": 2000, "tag": "0001_beta", "breakpoints": true },
    { "idx": 2, "version": "7", "when": 3000, "tag": "0002_gamma", "breakpoints": true }
  ]
}
JSON

# ---------------------------------------------------------------------------
# Spin up a throwaway Postgres.
# ---------------------------------------------------------------------------
echo "Starting throwaway Postgres ($CONTAINER_NAME)..."
docker run --rm -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=user \
    -e POSTGRES_PASSWORD=password \
    -e POSTGRES_DB=raid_ledger \
    -p 0:5432 \
    pgvector/pgvector:pg16 >/dev/null || { echo "failed to start container"; exit 1; }

elapsed=0
until docker exec "$CONTAINER_NAME" pg_isready -U user -q 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [[ "$elapsed" -ge 30 ]]; then echo "Postgres not ready in 30s"; exit 1; fi
done

PORT="$(docker port "$CONTAINER_NAME" 5432 | head -1 | sed 's/.*://')"
DBURL="postgresql://user:password@127.0.0.1:${PORT}/raid_ledger"

psql_exec() {
    docker exec -i "$CONTAINER_NAME" psql -U user -d raid_ledger -v ON_ERROR_STOP=1 -q -t -A
}

run_reconcile() {
    RL_MIGRATIONS_DIR="$FIXTURE_DIR" DATABASE_URL="$DBURL" \
        node "$SCRIPT" 2>&1
}

# Helper: hash of a fixture migration file (matches the script's sha256-of-file).
file_hash() {
    shasum -a 256 "$FIXTURE_DIR/$1.sql" | awk '{print $1}'
}

# ---------------------------------------------------------------------------
# AC-2 — trust mode with one missing effect must RUN the missing migration.
#
# Setup: populated `users` (→ schemaRestored=true → trust mode), the alpha and
# beta tables already exist (and their hash rows recorded), but gamma's table
# is ABSENT and its hash row missing. Pre-fix behaviour: gamma is silently
# trusted, table never created. Post-fix: gamma is RUN — table lands.
# ---------------------------------------------------------------------------
echo "AC-2 setup..."
{
    echo "CREATE TABLE users (id integer);"
    echo "INSERT INTO users (id) VALUES (1);"
    echo "CREATE TABLE rl_alpha (id integer PRIMARY KEY);"
    echo "CREATE TABLE rl_beta (id integer PRIMARY KEY);"
    echo "CREATE SCHEMA IF NOT EXISTS drizzle;"
    echo "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);"
    echo "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$(file_hash 0000_alpha)', 1000);"
    echo "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$(file_hash 0001_beta)', 2000);"
} | psql_exec >/dev/null || { echo "AC-2 setup failed"; exit 1; }

AC2_OUT="$(run_reconcile)"
echo "--- reconcile output (AC-2) ---"
echo "$AC2_OUT"
echo "-------------------------------"

# The missing migration (gamma) must be reported as RAN, not trusted.
if echo "$AC2_OUT" | grep -qE '0002_gamma\.\.\..*ran'; then
    pass
else
    fail "AC-2: 0002_gamma was not RUN in trust mode (expected 'ran', effect was missing)"
fi

# gamma table must now genuinely exist.
GAMMA_EXISTS="$(echo "SELECT to_regclass('public.rl_gamma') IS NOT NULL;" | psql_exec | tr -d '[:space:]')"
if [[ "$GAMMA_EXISTS" == "t" ]]; then
    pass
else
    fail "AC-2: rl_gamma table does not exist after reconcile (got '$GAMMA_EXISTS') — migration was silently trusted instead of run"
fi

# gamma hash row must now be recorded.
GAMMA_HASH="$(file_hash 0002_gamma)"
GAMMA_ROW="$(echo "SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash = '$GAMMA_HASH';" | psql_exec | tr -d '[:space:]')"
if [[ "$GAMMA_ROW" == "1" ]]; then
    pass
else
    fail "AC-2: gamma hash row count is '$GAMMA_ROW' (expected 1)"
fi

# ---------------------------------------------------------------------------
# AC-3 — trust mode where the effect already exists AND the hash row is present
# is a no-op skip. After AC-2 the DB is fully in sync, so a second reconcile
# must report "in sync" and touch nothing.
# ---------------------------------------------------------------------------
echo "AC-3: re-running reconcile against the now-in-sync DB..."
AC3_OUT="$(run_reconcile)"
echo "--- reconcile output (AC-3) ---"
echo "$AC3_OUT"
echo "-------------------------------"

if echo "$AC3_OUT" | grep -qiE 'in sync'; then
    pass
else
    fail "AC-3: second reconcile did not report 'in sync' (expected no-op skip)"
fi

# Belt-and-suspenders: exactly 3 hash rows, no duplicates / phantom inserts.
ROW_COUNT="$(echo "SELECT count(*) FROM drizzle.__drizzle_migrations;" | psql_exec | tr -d '[:space:]')"
if [[ "$ROW_COUNT" == "3" ]]; then
    pass
else
    fail "AC-3: expected 3 hash rows after no-op reconcile, got '$ROW_COUNT'"
fi

# ---------------------------------------------------------------------------
echo "==="
echo "reconcile-migrations-trust-probe.test.sh: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
    printf '  - %s\n' "${FAILED_NAMES[@]}"
    exit 1
fi
