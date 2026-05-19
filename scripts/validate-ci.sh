#!/bin/bash
# =============================================================================
# validate-ci.sh - Unified Local CI Validation
# =============================================================================
# Runs the complete CI pipeline locally: build, typecheck, lint, unit tests
# with coverage, integration tests, plus conditional migration and container
# validation based on changed files.
#
# Usage:
#   ./scripts/validate-ci.sh             # Run all checks (e2e auto-scoped)
#   ./scripts/validate-ci.sh --full      # Same (accepted for explicitness)
#   ./scripts/validate-ci.sh --ci        # Hard-fail on missing local prereqs
#                                        # (e.g. pg_dump). Use in CI to ensure
#                                        # backup integration tests never silently
#                                        # skip.
#   ./scripts/validate-ci.sh --no-e2e    # Skip Playwright + Discord smoke
#                                        # (use only when you know you don't
#                                        # need browser/bot coverage; default
#                                        # is auto-scoped by diff).
#   ./scripts/validate-ci.sh --with-e2e  # Force Playwright + Discord smoke
#                                        # even if no triggering files changed
#                                        # (e.g. paranoid pre-push pass).
#   ./scripts/validate-ci.sh --only-e2e  # Skip build/typecheck/lint/tests and
#                                        # run only the diff-gated e2e steps.
#                                        # Use in post-deploy gates where the
#                                        # static checks already ran upstream.
#
# E2E auto-scope (default):
#   * Playwright runs if web/**, api/src/auth/**, api/src/admin/demo-test*,
#     playwright.config.*, or scripts/smoke/** changed AND the dev env is up
#     (curl :3000/health returns ok).
#   * Discord smoke runs if api/src/discord-bot/**, api/src/notifications/**,
#     api/src/events/signups*, api/src/events/event-lifecycle*,
#     api/src/admin/demo-test*, tools/test-bot/src/smoke/**, or
#     tools/test-bot/src/helpers/polling.ts changed AND env is up.
#   * Either step SKIPS with a clear message if scope is empty or env is down.
#     "Env down" means you skipped the deploy; re-run after deploy_dev.sh if
#     you need that coverage.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# RL_TARGET=remote shortcut — ship validation to the rl-infra runner.
# Default behavior unchanged. Opt in by exporting RL_TARGET=remote or by
# passing through rl-infra/cli/rl, which sets it on your behalf.
# ---------------------------------------------------------------------------
if [ "${RL_TARGET:-local}" = "remote" ] && [ "${RL_TARGET_DISPATCHED:-0}" != "1" ]; then
  export RL_TARGET_DISPATCHED=1   # prevent loop if rl re-execs us inside the runner
  exec "$REPO_ROOT/rl-infra/cli/rl" validate-ci "$@"
fi

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
playwright_relevant=false
discord_smoke_relevant=false

# Mode flags
ci_mode=false
# e2e_mode: auto (default — diff + env gated) | off (--no-e2e) | on (--with-e2e)
e2e_mode="auto"
# only_e2e: when true, skip everything except the e2e steps
only_e2e=false

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

  # Playwright-relevant: web UI, auth (smoke tests log in), demo-test endpoints,
  # playwright config, and the smoke specs themselves. Exclude web/src/test/**
  # and web/src/dev/** (unit-test scaffolding and DEMO_MODE wireframes don't
  # ship to the smoke surface).
  if echo "$changed_files" \
    | grep -vE '^web/src/(test|dev)/' \
    | grep -qE '^web/|^api/src/auth/|^api/src/admin/demo-test|^playwright\.config\.|^scripts/smoke/'; then
    playwright_relevant=true
    echo -e "  Playwright-relevant changes: ${YELLOW}yes${NC}"
  else
    echo -e "  Playwright-relevant changes: no"
  fi

  # Discord-smoke-relevant: the 6 trigger paths from CLAUDE.md's
  # "Files that trigger smoke test review" list. Matches discord-bot listeners,
  # notifications, signup flows, lifecycle ops, demo-test endpoints used by
  # smoke fixtures, the smoke tests themselves, and the polling helper.
  if echo "$changed_files" \
    | grep -qE '^api/src/discord-bot/|^api/src/notifications/|^api/src/events/signups|^api/src/events/event-lifecycle|^api/src/admin/demo-test|^tools/test-bot/src/smoke/|^tools/test-bot/src/helpers/polling\.ts$'; then
    discord_smoke_relevant=true
    echo -e "  Discord-smoke-relevant changes: ${YELLOW}yes${NC}"
  else
    echo -e "  Discord-smoke-relevant changes: no"
  fi
}

# Returns 0 if the dev env (API + web) is up, 1 otherwise.
# Quiet on failure — callers decide whether absence is fatal or just a skip signal.
# Local-dev mode probes API :3000 and Vite :5173 separately. Fleet mode
# (RL_TARGET=remote / rl_validate_ci with against_env_slug) probes the allinone
# at HEALTH_URL/BASE_URL — same host serves /api/health and the SPA root.
#
# Why probe the web side at all: Playwright's webServer config has
# reuseExistingServer:true with a 120s timeout, so if :5173 is down (local)
# or BASE_URL is unreachable (fleet) it'll silently try to spawn its own
# `npm run dev -w web` and only fail after 2 minutes — too slow for fail-fast.
#
# TODO (separate fix): playwright.config.ts should consume BASE_URL/PLAYWRIGHT_BASE_URL
# so the actual test runs target the fleet env instead of localhost:5173.
check_env_up() {
  # HEALTH_URL override (set by rl_validate_ci against_env_slug, points at
  # the fleet env's allinone via rl-net Docker DNS). Defaults to localhost
  # for local-dev mode.
  local health_url="${HEALTH_URL:-http://localhost:3000/health}"
  curl -fsS --max-time 3 "$health_url" 2>/dev/null \
    | grep -q '"status":"ok"' || return 1

  # Web probe URL: in fleet mode (BASE_URL set by rl_validate_ci, or
  # RL_TARGET=remote / RL_SLOT set by `rl claim`), nginx in allinone serves the
  # SPA at the same host as the API. In local-dev mode, Vite serves on :5173.
  local web_url
  if [ -n "${BASE_URL:-}" ]; then
    web_url="$BASE_URL"
  elif [ -n "${RL_SLOT:-}" ] && [ "${RL_TARGET:-local}" = "remote" ]; then
    web_url="https://slot-${RL_SLOT}.${RL_PUBLIC_DOMAIN:-gamernight.net}"
  else
    web_url="http://localhost:5173"
  fi
  curl -fsS --max-time 5 -o /dev/null "$web_url" 2>/dev/null
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
  npm run prettier:check -w api
  npm run lint -w web
}

run_unit_tests() {
  npm run test:cov -w api -- --passWithNoTests \
    && (cd "$REPO_ROOT/web" && npx vitest run --coverage)
}

check_backup_prereqs() {
  # Backup integration tests shell out to pg_dump/pg_restore. On dev machines
  # without postgresql-client installed they hard-fail with 500 → 200 mismatch
  # and obscure real failures. CI runners install postgresql-client, so the
  # binary is always present there.
  if command -v pg_dump >/dev/null 2>&1; then
    export SKIP_BACKUP_INTEGRATION=0
    return 0
  fi

  if $ci_mode; then
    echo -e "${RED}pg_dump not found on PATH.${NC}"
    echo -e "${RED}CI mode requires postgresql-client installed for backup integration tests.${NC}"
    return 1
  fi

  echo -e "${YELLOW}pg_dump not found on PATH — skipping backup integration tests.${NC}"
  echo -e "${YELLOW}Install postgresql-client (e.g. \`brew install libpq\` on macOS) to run them locally.${NC}"
  export SKIP_BACKUP_INTEGRATION=1
  return 0
}

run_integration_tests() {
  # Explicit `|| return` — `set -e` is disabled inside `||`/`&&` lists, and
  # run_step calls us with `"$@" || rc=$?`, so a bare check_backup_prereqs
  # would not halt this function on failure.
  check_backup_prereqs || return $?
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

  # Verify pgvector extension is loaded (ROK-948). Indirectly covered by the
  # migration run during startup — but an explicit check catches silent-success
  # bugs (e.g. build step swapped to a different Postgres major with no pgvector).
  if ! docker exec "$cname" su-exec postgres \
    psql -d raid_ledger -tAc "SELECT extname FROM pg_extension WHERE extname='vector'" \
    | grep -q '^vector$'; then
    echo -e "${RED}pgvector extension not loaded in allinone DB${NC}"
    return 1
  fi
  echo -e "${GREEN}pgvector: loaded${NC}"

  # Verify pg_stat_statements extension is loaded (ROK-1156). The migration is a
  # no-op IF NOT EXISTS, so a missing shared_preload_libraries flag would not
  # surface as a migration failure — but the slow-query digest cron (PR B) would
  # silently see empty stats. Explicit check catches that.
  if ! docker exec "$cname" su-exec postgres \
    psql -d raid_ledger -tAc "SELECT extname FROM pg_extension WHERE extname='pg_stat_statements'" \
    | grep -q '^pg_stat_statements$'; then
    echo -e "${RED}pg_stat_statements extension not loaded in allinone DB${NC}"
    return 1
  fi
  echo -e "${GREEN}pg_stat_statements: loaded${NC}"

  _check_container_security_headers || return 1
}

# ROK-1158: verify the 6 security headers are present on every response surface
# (SPA index, /api proxy, AND a static bundle). The bundle URL specifically
# guards against the nginx `add_header` inheritance trap — the static-asset
# location block defines its own `add_header Cache-Control`, which kills
# parent-scope inheritance, so the snippet must be `include`d there too.
_check_container_security_headers() {
  local headers index_url='http://127.0.0.1:8080/' health_url='http://127.0.0.1:8080/api/health'

  for url in "$index_url" "$health_url"; do
    headers=$(curl -sI "$url")
    _assert_security_headers "$headers" "$url" || return 1
  done

  local html bundle_path bundle_url
  html=$(curl -s "$index_url")
  bundle_path=$(echo "$html" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
  if [ -z "$bundle_path" ]; then
    echo -e "${RED}Could not locate /assets/*.js bundle URL in index.html${NC}"
    return 1
  fi
  bundle_url="http://127.0.0.1:8080${bundle_path}"
  headers=$(curl -sI "$bundle_url")
  _assert_security_headers "$headers" "$bundle_url" || return 1

  if echo "$headers" | grep -qi '^x-xss-protection:'; then
    echo -e "${RED}X-XSS-Protection must not be present (deprecated)${NC}"
    return 1
  fi

  echo -e "${GREEN}Security headers: all 6 present on /, /api/health, and ${bundle_path}${NC}"
}

run_playwright_e2e() {
  case "$e2e_mode" in
    off)
      echo -e "${YELLOW}--no-e2e passed — skipping Playwright${NC}"
      return 2
      ;;
    auto)
      if ! $playwright_relevant; then
        echo -e "No Playwright-relevant files changed — skipping"
        return 2
      fi
      if ! check_env_up; then
        echo -e "${YELLOW}Dev env not responding on :3000/health — skipping Playwright${NC}"
        echo -e "${YELLOW}  Run ./scripts/deploy_dev.sh first, then re-run validate-ci to cover the changed UI flows.${NC}"
        return 2
      fi
      ;;
    on)
      if ! check_env_up; then
        echo -e "${RED}--with-e2e requested but dev env is not responding on :3000/health.${NC}"
        echo -e "${RED}Run ./scripts/deploy_dev.sh first.${NC}"
        return 1
      fi
      ;;
  esac

  # Runs BOTH desktop + mobile projects — matches GitHub CI exactly (ROK-935).
  npx playwright test
}

run_discord_smoke() {
  case "$e2e_mode" in
    off)
      echo -e "${YELLOW}--no-e2e passed — skipping Discord smoke${NC}"
      return 2
      ;;
    auto)
      if ! $discord_smoke_relevant; then
        echo -e "No Discord-smoke-relevant files changed — skipping"
        return 2
      fi
      if ! check_env_up; then
        echo -e "${YELLOW}Dev env not responding on :3000/health — skipping Discord smoke${NC}"
        echo -e "${YELLOW}  Run ./scripts/deploy_dev.sh first, then re-run validate-ci to cover the changed bot/notification flows.${NC}"
        return 2
      fi
      ;;
    on)
      if ! check_env_up; then
        echo -e "${RED}--with-e2e requested but dev env is not responding on :3000/health.${NC}"
        echo -e "${RED}Run ./scripts/deploy_dev.sh first.${NC}"
        return 1
      fi
      ;;
  esac

  # tools/test-bot reads its own .env (companion-bot token + guild ID).
  # Missing config there surfaces as a clean failure inside `npm run smoke`,
  # not something this script needs to pre-flight.
  #
  # Fleet-wide Discord serialization. The companion bot's Discord token and
  # the Raid Ledger bot's token each only allow ONE active session at a
  # time across Discord — two slots running smoke concurrently cause a
  # bot disconnect war and non-deterministic test failures. Acquire a
  # flock on /state-locks/discord.lock (bind-mounted into the runner from
  # /srv/rl-infra/state/locks/) before running smoke, release after.
  #
  # The lock dir only exists inside fleet runners; on the operator's laptop
  # the directory is absent and we run unsynchronized (single-host = no
  # cross-slot contention possible).
  local lock_dir="${RL_DISCORD_LOCK_DIR:-/state-locks}"
  if [[ -d "$lock_dir" ]]; then
    local lock_file="$lock_dir/discord.lock"
    echo "Acquiring fleet Discord lock at $lock_file (up to 10 min)..."
    local wait_start=$(date +%s)
    # flock fd 9 against the lock file. -w 600 waits up to 10 min before
    # timing out (typical smoke is 2-3 min). Subshell scopes the fd so the
    # lock auto-releases when smoke exits.
    (
      exec 9>"$lock_file"
      if ! flock -w 600 9; then
        echo -e "${RED}Timed out (10 min) waiting for Discord lock. Another slot is hogging it.${NC}" >&2
        echo -e "${RED}  Check: docker exec <runner> cat /state-locks/discord.lock — empty file but a flock holder.${NC}" >&2
        exit 75   # sysexits.h EX_TEMPFAIL — signals lock-acquisition failure to outer shell
      fi
      local wait_end=$(date +%s)
      echo "Got Discord lock (waited $((wait_end - wait_start))s); running smoke."
      cd "$REPO_ROOT/tools/test-bot" && npm run smoke
    )
    local rc=$?
    if (( rc == 75 )); then
      return 1   # lock-timeout → fail the step
    fi
    return $rc
  fi

  (cd "$REPO_ROOT/tools/test-bot" && npm run smoke)
}

_assert_security_headers() {
  local headers="$1" target="$2"
  local h
  for h in 'Content-Security-Policy' 'Strict-Transport-Security' 'X-Content-Type-Options' 'X-Frame-Options' 'Referrer-Policy' 'Permissions-Policy'; do
    if ! echo "$headers" | grep -qi "^${h}:"; then
      echo -e "${RED}Missing header ${h} on ${target}${NC}"
      echo "$headers"
      return 1
    fi
  done
  if ! echo "$headers" | grep -qi "^Content-Security-Policy:.*report-uri /api/csp-report"; then
    echo -e "${RED}CSP missing report-uri on ${target}${NC}"
    return 1
  fi
  if ! echo "$headers" | grep -qi "^Content-Security-Policy:.*frame-ancestors 'none'"; then
    echo -e "${RED}CSP missing frame-ancestors 'none' on ${target}${NC}"
    return 1
  fi
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
  # Accept --full for explicitness (default behavior).
  # --ci hard-fails on missing local prereqs (pg_dump) instead of skipping
  # so CI never silently skips backup integration tests.
  while [ $# -gt 0 ]; do
    case "$1" in
      --full) shift ;;
      --ci) ci_mode=true; shift ;;
      --no-e2e) e2e_mode="off"; shift ;;
      --with-e2e) e2e_mode="on"; shift ;;
      --only-e2e) only_e2e=true; shift ;;
      *) echo -e "${RED}Unknown argument: $1${NC}"; exit 1 ;;
    esac
  done

  if $only_e2e && [ "$e2e_mode" = "off" ]; then
    echo -e "${RED}--only-e2e and --no-e2e are mutually exclusive.${NC}"
    exit 1
  fi

  echo -e "${GREEN}Starting local CI validation...${NC}"
  detect_scope

  if ! $only_e2e; then
    run_step "Build (all workspaces)" run_build
    run_step "TypeScript (all)" run_typecheck
    run_step "Lint (all)" run_lint
    run_step "Unit tests + coverage" run_unit_tests
    run_step "Integration tests (api)" run_integration_tests

    # Migration and container checks handle their own SKIPPED/PASS/FAIL recording
    run_step "Migration validation" run_migration_validation
    run_step "Container startup" run_container_validation
  fi

  # E2E checks are auto-scoped (diff + env gated). They SKIP cleanly when the
  # diff doesn't touch their surface or when the dev env isn't running.
  run_step "Playwright (desktop + mobile)" run_playwright_e2e
  run_step "Discord smoke (companion bot)" run_discord_smoke

  print_summary
  echo -e "${GREEN}All checks passed!${NC}"
}

main "$@"
