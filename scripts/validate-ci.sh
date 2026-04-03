#!/bin/bash
# =============================================================================
# validate-ci.sh - Unified Local CI Validation
# =============================================================================
# Runs the complete CI pipeline locally: build, typecheck, lint, unit tests
# with coverage, integration tests, plus conditional migration and container
# validation based on changed files.
#
# Usage:
#   ./scripts/validate-ci.sh          # Run all checks
#   ./scripts/validate-ci.sh --full   # Same (accepted for explicitness)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Result tracking
declare -a CHECK_NAMES=()
declare -a CHECK_RESULTS=()
FAILURES=0

# Scope flags
migrations_changed=false
container_changed=false

# ---------------------------------------------------------------------------
# Result tracking helpers
# ---------------------------------------------------------------------------

record_result() {
  CHECK_NAMES+=("$1")
  CHECK_RESULTS+=("$2")
  if [ "$2" = "FAIL" ]; then
    FAILURES=$((FAILURES + 1))
  fi
}

run_step() {
  local name="$1"
  shift
  echo ""
  echo -e "${YELLOW}========== $name ==========${NC}"
  local rc=0
  "$@" || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo -e "${GREEN}$name: PASS${NC}"
    record_result "$name" "PASS"
  elif [ "$rc" -eq 2 ]; then
    echo -e "${YELLOW}$name: SKIPPED${NC}"
    record_result "$name" "SKIPPED"
  else
    echo -e "${RED}$name: FAIL${NC}"
    record_result "$name" "FAIL"
    print_summary
    echo -e "${RED}Stopping on first failure.${NC}"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Scope detection
# ---------------------------------------------------------------------------

detect_scope() {
  echo -e "${YELLOW}Detecting change scope against origin/main...${NC}"
  git fetch origin --quiet 2>/dev/null || true

  local changed_files
  changed_files="$(git diff --name-only origin/main 2>/dev/null || echo '')"

  if echo "$changed_files" | grep -q 'drizzle/migrations'; then
    migrations_changed=true
    echo -e "  Migrations changed: ${YELLOW}yes${NC}"
  else
    echo -e "  Migrations changed: no"
  fi

  if echo "$changed_files" | grep -qE 'Dockerfile|nginx/|docker-entrypoint'; then
    container_changed=true
    echo -e "  Container files changed: ${YELLOW}yes${NC}"
  else
    echo -e "  Container files changed: no"
  fi
}

# ---------------------------------------------------------------------------
# CI check functions
# ---------------------------------------------------------------------------

run_build() {
  npm run build -w packages/contract
  npm run build -w api
  npm run build -w web
}

run_typecheck() {
  npx tsc --noEmit -p api/tsconfig.json
  npx tsc --noEmit -p web/tsconfig.json
}

run_lint() {
  npm run lint -w api
  npm run lint -w web
}

run_unit_tests() {
  npm run test:cov -w api -- --passWithNoTests
  (cd "$REPO_ROOT/web" && npx vitest run --coverage)
}

run_integration_tests() {
  npm run test:integration -w api
}

run_migration_validation() {
  if ! $migrations_changed; then
    echo -e "No migration files changed — skipping"
    return 2  # SKIPPED
  fi
  "$REPO_ROOT/scripts/validate-migrations.sh"
}

run_container_validation() {
  if ! $container_changed; then
    echo -e "No container files changed — skipping"
    return 2  # SKIPPED
  fi

  local cname="rl-ci-test-$$"
  # Ensure cleanup on any exit path
  trap "docker stop '$cname' >/dev/null 2>&1 || true" RETURN

  docker build -f Dockerfile.allinone -t rl:ci-test .
  docker run --rm -d \
    --name "$cname" \
    -p 8080:80 \
    -e ADMIN_PASSWORD=ci-test \
    rl:ci-test

  _wait_for_container_health "$cname"
}

_wait_for_container_health() {
  local cname="$1"
  local elapsed=0

  # Wait for API health (port 3000 direct — matches GitHub CI)
  while ! docker exec "$cname" \
    wget -qO- http://127.0.0.1:3000/health 2>/dev/null \
    | grep -q '"status":"ok"'; do
    sleep 2
    elapsed=$((elapsed + 2))
    if [ "$elapsed" -ge 120 ]; then
      echo -e "${RED}API health check failed after 120s${NC}"
      docker logs "$cname" --tail 30
      return 1
    fi
  done
  echo -e "${GREEN}API healthy after ${elapsed}s${NC}"

  # Verify Redis via Unix socket
  if ! docker exec "$cname" redis-cli -s /tmp/redis.sock ping \
    | grep -q PONG; then
    echo -e "${RED}Redis ping failed${NC}"
    return 1
  fi
  echo -e "${GREEN}Redis: PONG${NC}"

  # Verify nginx proxy (from host, matches GitHub CI)
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    http://127.0.0.1:8080/api/health)
  if [ "$http_code" != "200" ]; then
    echo -e "${RED}Nginx proxy returned $http_code${NC}"
    return 1
  fi
  echo -e "${GREEN}Nginx proxy: healthy${NC}"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print_summary() {
  echo ""
  echo -e "${YELLOW}========== Summary ==========${NC}"
  printf "%-30s %s\n" "Check" "Result"
  printf "%-30s %s\n" "-----" "------"
  for i in "${!CHECK_NAMES[@]}"; do
    local color="$GREEN"
    if [ "${CHECK_RESULTS[$i]}" = "FAIL" ]; then
      color="$RED"
    elif [ "${CHECK_RESULTS[$i]}" = "SKIPPED" ]; then
      color="$YELLOW"
    fi
    printf "%-30s ${color}%s${NC}\n" "${CHECK_NAMES[$i]}" "${CHECK_RESULTS[$i]}"
  done
  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  # Accept --full for explicitness (default behavior)
  while [ $# -gt 0 ]; do
    case "$1" in
      --full) shift ;;
      *) echo -e "${RED}Unknown argument: $1${NC}"; exit 1 ;;
    esac
  done

  echo -e "${GREEN}Starting local CI validation...${NC}"
  detect_scope

  run_step "Build (all workspaces)" run_build
  run_step "TypeScript (all)" run_typecheck
  run_step "Lint (all)" run_lint
  run_step "Unit tests + coverage" run_unit_tests
  run_step "Integration tests (api)" run_integration_tests

  # Migration and container checks handle their own SKIPPED/PASS/FAIL recording
  run_step "Migration validation" run_migration_validation
  run_step "Container startup" run_container_validation

  print_summary
  echo -e "${GREEN}All checks passed!${NC}"
}

main "$@"
