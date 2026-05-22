#!/bin/bash
# =============================================================================
# recover-stuck-migration.sh — Last-resort runbook for a stuck migration row
# =============================================================================
# ROK-1343 (TECH-DEBT 186-187). Marks a single migration as applied in
# `drizzle.__drizzle_migrations` WITHOUT re-running its SQL. Use when:
#   - a migration failed partway and was patched by hand
#   - the schema effects already exist but the journal row is missing
#   - drizzle-kit silently exited and left state inconsistent (ROK-1278/1281)
#
# This is NOT a substitute for `scripts/reconcile-migrations.mjs`. Reconcile
# probes every journal entry and re-runs anything truly missing. THIS script
# operates on a single named tag and only inserts the hash row.
#
# Usage:
#   ./scripts/recover-stuck-migration.sh <migration-tag> [--db-url <url>] [--dry-run]
#
# Example:
#   ./scripts/recover-stuck-migration.sh 0140_lineup_promotion
#
# Environment:
#   DATABASE_URL — required unless --db-url is passed.
#
# Exit codes:
#   0  success or already-applied no-op
#   1  argv error, journal lookup failed, DB unreachable, INSERT failed
#   2  --help shown
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
JOURNAL_PATH="$REPO_ROOT/api/src/drizzle/migrations/meta/_journal.json"
MIGRATIONS_DIR="$REPO_ROOT/api/src/drizzle/migrations"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

usage() {
  cat <<'EOF'
recover-stuck-migration.sh — mark a single drizzle migration as applied

Usage:
  recover-stuck-migration.sh <migration-tag> [--db-url <url>] [--dry-run]

Example:
  ./scripts/recover-stuck-migration.sh 0140_lineup_promotion

Description:
  Inserts a row into drizzle.__drizzle_migrations for <migration-tag> so the
  boot-time `migrate()` call skips it. Use this when a migration's SQL has
  ALREADY been applied to the database (manually, by a half-completed run,
  or by a backup restore) but the journal row is missing.

  Hash: SHA-256 of the file `api/src/drizzle/migrations/<tag>.sql`. This is
  the same hash drizzle's migrator would compute on a normal run.

  Idempotent: a second invocation on the same tag is a no-op ("already
  applied at <ts>").

Options:
  --db-url <url>    Override DATABASE_URL.
  --dry-run         Print the SQL that would run; do not modify the DB.
  -h, --help        Show this help.

Environment:
  DATABASE_URL      Required unless --db-url is passed. psql connection URL.

Exit codes:
  0  Success, or already-applied no-op.
  1  Argv error, tag not in journal, DB unreachable, INSERT failed.
  2  Help requested.

Warning:
  This is a LAST-RESORT recovery path. Most stuck-migration scenarios are
  better handled by `scripts/reconcile-migrations.mjs`, which probes every
  journal entry and re-runs anything truly missing. Reach for THIS script
  only when you have already verified the migration's effects exist in the
  DB and you just need the journal row.

References:
  - TECH-DEBT-BACKLOG.md (entries 186-187) — original gap surfaced during
    the ROK-1278/1281 prod outage.
  - CLAUDE.md "Migration State Recovery" — the broader recovery guide.
EOF
}

die() {
  echo -e "${RED}ERROR: $1${NC}" >&2
  exit "${2:-1}"
}

# ---------------------------------------------------------------------------
# Argv parsing
# ---------------------------------------------------------------------------

TAG=""
DB_URL=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 2
      ;;
    --db-url)
      [[ $# -ge 2 ]] || die "--db-url requires a value"
      DB_URL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      if [[ -n "$TAG" ]]; then
        die "unexpected extra argument: $1"
      fi
      TAG="$1"
      shift
      ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo -e "${RED}ERROR: migration tag is required${NC}" >&2
  echo "" >&2
  usage >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Dependency checks (journal + hash tooling) — these must pass BEFORE we
# bother with DB connectivity so a bad tag fails fast even without a DB.
# ---------------------------------------------------------------------------

if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
  die "neither shasum nor sha256sum is on PATH"
fi

if [[ ! -f "$JOURNAL_PATH" ]]; then
  die "journal not found at $JOURNAL_PATH (run from a Raid-Ledger checkout)"
fi

# ---------------------------------------------------------------------------
# Validate tag exists in the journal
# ---------------------------------------------------------------------------

# Use python3 (always present on macOS + most linux distros) to parse JSON
# without taking a node/jq dependency. If python3 is missing we fall back to
# grep — works for the canonical compact-pretty journal format drizzle emits.
JOURNAL_HAS_TAG=""
if command -v python3 >/dev/null 2>&1; then
  # 2>&1 captures Python's traceback inside the assignment so we can re-emit
  # it in our own ERROR: style instead of leaking it to the operator. `set -e`
  # does not abort on $(...) failures, so the explicit `if !` is mandatory.
  if ! JOURNAL_HAS_TAG="$(python3 -c "
import json, sys
try:
    with open('$JOURNAL_PATH') as f:
        data = json.load(f)
except json.JSONDecodeError as e:
    print(f'__PARSE_ERROR__: {e}', file=sys.stderr)
    sys.exit(2)
tags = [e.get('tag') for e in data.get('entries', [])]
print('yes' if '$TAG' in tags else 'no')
" 2>&1)"; then
    # Extract the parse error line if we tagged it, otherwise show the
    # raw stderr without the traceback noise.
    detail="$(echo "$JOURNAL_HAS_TAG" | grep '^__PARSE_ERROR__:' | sed 's/^__PARSE_ERROR__: //' | head -1)"
    if [[ -z "$detail" ]]; then
      detail="$(echo "$JOURNAL_HAS_TAG" | tail -1)"
    fi
    die "could not parse $JOURNAL_PATH — is it valid JSON? ($detail)"
  fi
else
  if grep -q "\"tag\": \"$TAG\"" "$JOURNAL_PATH"; then
    JOURNAL_HAS_TAG="yes"
  else
    JOURNAL_HAS_TAG="no"
  fi
fi

if [[ "$JOURNAL_HAS_TAG" != "yes" ]]; then
  die "tag '$TAG' not found in $JOURNAL_PATH"
fi

SQL_FILE="$MIGRATIONS_DIR/${TAG}.sql"
if [[ ! -f "$SQL_FILE" ]]; then
  die "migration SQL file missing: $SQL_FILE"
fi

# ---------------------------------------------------------------------------
# Compute hash (SHA-256 of the migration's SQL file)
# ---------------------------------------------------------------------------

if command -v sha256sum >/dev/null 2>&1; then
  HASH="$(sha256sum "$SQL_FILE" | awk '{print $1}')"
else
  HASH="$(shasum -a 256 "$SQL_FILE" | awk '{print $1}')"
fi

if [[ -z "$HASH" || ${#HASH} -ne 64 ]]; then
  die "failed to compute SHA-256 hash (got '$HASH')"
fi

echo -e "${YELLOW}Tag:${NC}  $TAG"
echo -e "${YELLOW}Hash:${NC} $HASH"

# ---------------------------------------------------------------------------
# DB connectivity prerequisites (validated AFTER the tag, so a bad tag fails
# without needing a DB).
# ---------------------------------------------------------------------------

if [[ -z "$DB_URL" ]]; then
  DB_URL="${DATABASE_URL:-}"
fi
if [[ -z "$DB_URL" && "$DRY_RUN" -eq 0 ]]; then
  die "DATABASE_URL is not set and --db-url was not passed"
fi

if [[ "$DRY_RUN" -eq 0 ]] && ! command -v psql >/dev/null 2>&1; then
  die "psql is not on PATH (install postgresql-client)"
fi

# ---------------------------------------------------------------------------
# Check for existing row, INSERT if missing
# ---------------------------------------------------------------------------

# Ensure the drizzle schema + metadata table exist (drizzle creates them on
# first migrate; if we're reaching for this script that may not have happened
# yet on a fresh DB).
PSQL_BASE=(psql "$DB_URL" -v ON_ERROR_STOP=1 -At)

ensure_table_sql="CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);"

select_sql="SELECT created_at FROM drizzle.__drizzle_migrations WHERE hash = '$HASH' LIMIT 1;"

# created_at is a millisecond epoch (matches drizzle's own writes).
NOW_MS="$(date +%s)000"
insert_sql="INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('$HASH', $NOW_MS);"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo -e "${YELLOW}--dry-run: SQL that would execute:${NC}"
  echo "-- ensure table"
  echo "$ensure_table_sql"
  echo "-- check existing"
  echo "$select_sql"
  echo "-- insert if missing"
  echo "$insert_sql"
  exit 0
fi

if ! "${PSQL_BASE[@]}" -c "$ensure_table_sql" >/dev/null; then
  die "failed to ensure drizzle.__drizzle_migrations exists (check DB connectivity)"
fi

EXISTING="$("${PSQL_BASE[@]}" -c "$select_sql" || true)"
if [[ -n "$EXISTING" ]]; then
  echo -e "${GREEN}Already applied at created_at=${EXISTING} (no-op).${NC}"
  exit 0
fi

if ! "${PSQL_BASE[@]}" -c "$insert_sql" >/dev/null; then
  die "INSERT into drizzle.__drizzle_migrations failed"
fi

echo -e "${GREEN}✅ Migration ${TAG} marked applied.${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart the api container (so the running process re-reads journal)."
echo "  2. Verify schema with \\dt in psql."
echo "  3. Tail logs for any boot-time errors."
