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
# Usage:
#   ./scripts/validate-migrations.sh
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

CONTAINER_NAME="rl-migrate-validate-$$"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

cleanup() {
  if docker ps -q --filter "name=$CONTAINER_NAME" | grep -q .; then
    echo -e "${YELLOW}Cleaning up container ${CONTAINER_NAME}...${NC}"
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

preflight_check() {
  echo -e "${YELLOW}Pre-flight: checking migration journal order...${NC}"
  "$REPO_ROOT/scripts/fix-migration-order.sh" --check
}

start_postgres() {
  echo -e "${YELLOW}Starting temporary Postgres container...${NC}"
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
  trap cleanup EXIT

  preflight_check
  start_postgres

  local port
  port="$(get_mapped_port)"

  wait_for_postgres "$port"
  run_migrations "$port"

  echo -e "${GREEN}Migration validation PASSED${NC}"
}

main "$@"
