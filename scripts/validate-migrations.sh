#!/bin/bash
# =============================================================================
# validate-migrations.sh - Validate Drizzle Migrations Against Real Postgres
# =============================================================================
# Spins up a temporary Postgres container, applies every migration listed in
# drizzle/migrations/meta/_journal.json in journal order via psql, and reports
# success or failure. Used by validate-ci.sh and can be run standalone.
#
# Why psql instead of `drizzle-kit migrate`? The CLI silently swallows its own
# errors via the hanji spinner UX — when it fails, no message reaches stdout/
# stderr (verified 2026-05-22 with --no-color, TERM=dumb, script -qec, raw fd
# capture). Applying SQL files directly with `psql -v ON_ERROR_STOP=1` gives a
# real error message on failure and matches what GitHub CI does at boot time
# via `api/scripts/run-migrations-with-sentry.ts`. ROK-1335.
#
# Before any of that, a snapshot-drift check (TDB:1167, no Docker needed)
# fails when schema.ts disagrees with the latest meta snapshot — i.e. a schema
# edit shipped without `npm run db:generate -w api`.
#
# Usage:
#   ./scripts/validate-migrations.sh               # drift check + apply all migrations
#   ./scripts/validate-migrations.sh --drift-only  # drift check only (no Docker, ~1s)
#   ./scripts/validate-migrations.sh --skip-drift  # apply migrations only
#
# Test hooks: RL_DRIFT_SCHEMA / RL_DRIFT_MIGRATIONS_DIR override the schema
# entry point / migrations dir the drift check reads (scripts/*.spec.mjs).
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CONTAINER_NAME="rl-migrate-validate-$$"
CONTAINER_STARTED=false
DRIFT_TMP=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

cleanup() {
  if [ -n "$DRIFT_TMP" ]; then rm -rf "$DRIFT_TMP"; fi
  if [ "$CONTAINER_STARTED" != true ]; then return 0; fi
  if docker ps -q --filter "name=$CONTAINER_NAME" | grep -q .; then
    echo -e "${YELLOW}Cleaning up container ${CONTAINER_NAME}...${NC}"
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

preflight_check() {
  echo -e "${YELLOW}Pre-flight: checking migration journal order...${NC}"
  # Invoked via `bash`, not as an executable: Mutagen does not preserve the
  # executable bit when it syncs the worktree to a fleet runner, so 14 of the
  # 15 scripts in scripts/ land there as 0644 despite being 0755 in git. The
  # one exception is this file, which validate-ci.sh chmod +x's at its call
  # site (validate-ci.sh:722) — a workaround for the same root cause that was
  # never extended to this nested call. Running through the interpreter is
  # mode-independent and needs no working-tree mutation. See TECH-DEBT-BACKLOG
  # 2026-09-01 for the root-cause entry.
  bash "$REPO_ROOT/scripts/fix-migration-order.sh" --check
}

# TDB:1167 — drizzle-kit 0.31 has no dry-run, so `generate` runs against a
# throwaway COPY of the migrations dir; any file it adds there means schema.ts
# and the latest snapshot disagree. The real migrations dir is never written.
# drizzle-kit's exit status is NOT trusted: it exits 0 after crashing (a bad
# --out, or a rename/drop ambiguity it cannot prompt about without a TTY), so
# a pass needs BOTH an unchanged file list AND its "No schema changes" line.
check_snapshot_drift() {
  local schema="${RL_DRIFT_SCHEMA:-$REPO_ROOT/api/src/drizzle/schema.ts}"
  local src="${RL_DRIFT_MIGRATIONS_DIR:-$REPO_ROOT/api/src/drizzle/migrations}"
  local kit="$REPO_ROOT/node_modules/drizzle-kit/bin.cjs"
  echo -e "${YELLOW}Pre-flight: checking schema.ts against the latest snapshot...${NC}"
  if [ ! -f "$kit" ]; then
    echo -e "${RED}drizzle-kit not installed at $kit — run npm ci first${NC}"
    return 1
  fi
  DRIFT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/rl-drift.XXXXXX")"
  cp -R "$src" "$DRIFT_TMP/migrations"
  (cd "$src" && find . -type f | sort) > "$DRIFT_TMP/before.txt"
  # --out is relative on purpose: drizzle-kit prefixes "./" to it, which
  # turns an absolute path into a missing one.
  (cd "$DRIFT_TMP" && node "$kit" generate --dialect postgresql \
    --schema "$schema" --out migrations < /dev/null > drizzle-kit.log 2>&1) || true
  report_snapshot_drift
}

report_snapshot_drift() {
  local added
  added="$(cd "$DRIFT_TMP/migrations" && find . -type f | sort \
    | comm -13 "$DRIFT_TMP/before.txt" -)"
  if [ -n "$added" ]; then
    echo -e "${RED}Snapshot drift: schema.ts differs from the latest snapshot.${NC}"
    echo "drizzle-kit generate would add:"
    echo "$added" | sed 's/^/  /'
    local f
    for f in $added; do
      case "$f" in *.sql) sed -n '1,40p' "$DRIFT_TMP/migrations/$f" ;; esac
    done
    echo -e "${RED}Run 'npm run db:generate -w api' and commit the result.${NC}"
    return 1
  fi
  if ! grep -q 'No schema changes' "$DRIFT_TMP/drizzle-kit.log"; then
    echo -e "${RED}drizzle-kit generate did not report 'No schema changes'.${NC}"
    echo "A rename/drop it cannot resolve without a TTY also lands here —"
    echo "run 'npm run db:generate -w api' in a terminal. Log tail:"
    tail -n 25 "$DRIFT_TMP/drizzle-kit.log" >&2
    return 1
  fi
  echo -e "${GREEN}No snapshot drift: schema.ts matches the latest snapshot${NC}"
}

start_postgres() {
  echo -e "${YELLOW}Starting temporary Postgres container...${NC}"
  CONTAINER_STARTED=true
  docker run --rm -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=user \
    -e POSTGRES_PASSWORD=password \
    -e POSTGRES_DB=raid_ledger \
    -p 0:5432 \
    pgvector/pgvector:pg16 >/dev/null
}

get_mapped_port() {
  docker port "$CONTAINER_NAME" 5432 | head -1 | sed 's/.*://'
}

wait_for_postgres() {
  local port="$1"
  local elapsed=0
  echo -e "${YELLOW}Waiting for Postgres to be ready (port $port)...${NC}"
  # pg_isready alone races initdb: it reports ready against the temporary
  # bootstrap server BEFORE the init scripts create POSTGRES_DB, so the first
  # migration could fail with "database raid_ledger does not exist". Polling
  # an actual query against raid_ledger over TCP closes the race completely:
  # the bootstrap server is socket-only (listen_addresses=''), so a TCP
  # success can only come from the final server — a socket-based poll could
  # still pass in the window between DB creation and bootstrap shutdown.
  while ! docker exec -e PGPASSWORD=password "$CONTAINER_NAME" \
    psql -h 127.0.0.1 -U user -d raid_ledger -c 'SELECT 1' >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge 30 ]; then
      echo -e "${RED}Postgres did not become ready within 30s${NC}"
      return 1
    fi
  done
  echo -e "${GREEN}Postgres ready after ${elapsed}s${NC}"
}

run_migrations() {
  local journal="$REPO_ROOT/api/src/drizzle/migrations/meta/_journal.json"
  local migrations_dir="$REPO_ROOT/api/src/drizzle/migrations"
  echo -e "${YELLOW}Applying migrations via psql in journal order...${NC}"
  if [ ! -f "$journal" ]; then
    echo -e "${RED}Journal not found at $journal${NC}"
    return 1
  fi
  local applied=0 missing=0
  while IFS= read -r tag; do
    local sql_file="$migrations_dir/${tag}.sql"
    if [ ! -f "$sql_file" ]; then
      echo -e "${RED}Missing migration file: ${tag}.sql${NC}"
      missing=$((missing + 1))
      continue
    fi
    if ! docker exec -i "$CONTAINER_NAME" \
      psql -U user -d raid_ledger -v ON_ERROR_STOP=1 -q < "$sql_file" \
      > /dev/null 2> /tmp/rl-mig-psql-err.log; then
      echo -e "${RED}Migration ${tag} FAILED:${NC}"
      cat /tmp/rl-mig-psql-err.log >&2
      return 1
    fi
    applied=$((applied + 1))
  done < <(jq -r '.entries[].tag' "$journal")
  if [ "$missing" -gt 0 ]; then
    echo -e "${RED}${missing} migration file(s) missing — see above${NC}"
    return 1
  fi
  echo -e "${GREEN}Applied ${applied} migration(s) cleanly${NC}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  local drift=true drift_only=false arg
  for arg in "$@"; do
    case "$arg" in
      --drift-only) drift_only=true ;;
      --skip-drift) drift=false ;;
      *) echo -e "${RED}Unknown argument: $arg${NC}" >&2; exit 64 ;;
    esac
  done
  trap cleanup EXIT

  if $drift || $drift_only; then check_snapshot_drift; fi
  if $drift_only; then return 0; fi
  preflight_check
  start_postgres

  local port
  port="$(get_mapped_port)"

  wait_for_postgres "$port"
  run_migrations "$port"

  echo -e "${GREEN}Migration validation PASSED${NC}"
}

main "$@"
