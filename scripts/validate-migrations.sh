#!/bin/bash
# =============================================================================
# validate-migrations.sh - Validate Drizzle Migrations Against Real Postgres
# =============================================================================
# Spins up a temporary Postgres container, runs all Drizzle migrations, and
# reports success or failure. Used by validate-ci.sh and can be run standalone.
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
  while ! docker exec "$CONTAINER_NAME" pg_isready -U user -q 2>/dev/null; do
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
  local port="$1"
  local db_url="postgresql://user:password@localhost:${port}/raid_ledger"
  echo -e "${YELLOW}Running Drizzle migrations...${NC}"
  (cd "$REPO_ROOT/api" && DATABASE_URL="$db_url" npx drizzle-kit migrate)
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
