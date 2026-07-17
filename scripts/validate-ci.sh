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
#   ./scripts/validate-ci.sh --static    # FAST LITE GATE (default for most
#                                        # stories): build + typecheck + lint
#                                        # only, PLUS the conditional migration
#                                        # and container checks (which auto-skip
#                                        # when no migration/infra files
#                                        # changed). Skips unit, integration,
#                                        # Playwright, and Discord smoke —
#                                        # those are deferred to GitHub CI,
#                                        # which runs them sharded + randomized
#                                        # on every PR. ~3-4 min vs ~20+ for
#                                        # --full. Use when you want the cheap
#                                        # deterministic gate that catches
#                                        # compile/type/lint breaks (the
#                                        # failures that waste a whole GitHub
#                                        # cycle) and lets behavioral coverage
#                                        # ride on GitHub. Migration/infra
#                                        # changes still get full local
#                                        # validation automatically.
#   ./scripts/validate-ci.sh --scope=auto # Narrow build+typecheck+lint to the
#                                        # single changed workspace (+contract)
#                                        # when the diff touches only api/ or only
#                                        # web/. all|api|web force a value; default
#                                        # "all" is the legacy whole-monorepo gate.
#                                        # GitHub CI still runs the full suite, so
#                                        # this only trims duplicated local work for
#                                        # a single-workspace small fix. Composes
#                                        # with --static (e.g. --static --scope=auto).
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

# ROK-1326 fix-11: when this script runs inside the rl-infra fleet runner
# (via `rl validate-ci` → run-on-runner → docker exec as root in
# /workspace owned by uid 1001), git's dubious-ownership check fires
# on every git call. GIT_CONFIG_PARAMETERS is process-scoped and writes
# no on-disk config — harmless on the laptop, required on the fleet
# runner. Whitelists everything (the laptop's own repo root, AND
# /workspace inside the runner container).
export GIT_CONFIG_PARAMETERS="'safe.directory=*'"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ROK-1326 fix-11: when this script runs inside the rl-infra fleet runner,
# node_modules is intentionally Mutagen-excluded (large + OS-specific
# binaries) so the freshly-claimed slot has an empty
# /workspace/node_modules. Without `npm ci` the build step fails
# immediately: 'sh: 1: tsc: not found' / 'sh: 1: nest: not found'. On
# laptop runs node_modules is already populated by `npm install` at
# worktree setup, so the guard is a no-op there.
if [ ! -x "$REPO_ROOT/node_modules/.bin/tsc" ]; then
  echo "[validate-ci] node_modules missing or incomplete — running npm ci..."
  npm ci --silent --no-audit --no-fund 2>&1 | tail -5
fi

# ---------------------------------------------------------------------------
# RL_TARGET=remote shortcut — ship validation to the rl-infra runner.
# Default behavior unchanged. Opt in by exporting RL_TARGET=remote or by
# passing through rl-infra/cli/rl, which sets it on your behalf.
# ---------------------------------------------------------------------------
if [ "${RL_TARGET:-local}" = "remote" ] && [ "${RL_TARGET_DISPATCHED:-0}" != "1" ] && [ "${RL_VALIDATE_CI_DRY:-0}" != "1" ]; then
  export RL_TARGET_DISPATCHED=1   # prevent loop if rl re-execs us inside the runner
  # ROK-1331 M2: the rl CLI is SYNC by default (its rl_validate_ci MCP
  # surface is wait:true under the hood), so this exec preserves the
  # operator's terminal-attached output expectation. If the CLI ever grows
  # an async dispatch flag, this caller must keep passing the equivalent
  # of wait=true (or this script's stdout/stderr surfaces will return
  # immediately with a task_id instead of streaming the run).
  # ROK-1331 M6b: the dry-run guard (RL_VALIDATE_CI_DRY=1) lets bash test
  # harnesses source the script with RL_TARGET=remote to exercise the
  # fallback chain WITHOUT actually shipping execution to the rl CLI.
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
# static_mode (--static): lite gate — build + typecheck + lint + conditional
# migration/container checks only. Skips unit, integration, and all e2e.
# Behavioral coverage is deferred to GitHub CI. See the usage header.
static_mode=false
# scope_mode (--scope=all|api|web|auto): narrows build/typecheck/lint to a single
# changed workspace (+contract) instead of all three. Default "all" preserves the
# legacy whole-monorepo gate exactly. "auto" resolves to detected_workspace (set in
# detect_scope). GitHub CI still runs the full path-filtered suite on every PR, so
# scoping the LOCAL gate loses no coverage — it only cuts duplicated build/lint work
# for a single-workspace small fix.
scope_mode="all"
detected_workspace="all"
effective_scope="all"

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

# ROK-1331 M11 — local perf emit. Inside the fleet runner the orchestrator's
# perf.log isn't writable, so we append to a runner-local file that release
# flushes back to /srv/rl-infra/state/perf.log. Local laptop runs land in
# the worktree's .rl-perf.log (cheap to inspect, gitignored).
PERF_LOG_LOCAL="${PERF_LOG_LOCAL:-${REPO_ROOT}/.rl-perf.log}"
if [ -d /workspace ]; then
  PERF_LOG_LOCAL="/workspace/.rl-perf.log"
fi

# perf_emit_local <event> <extra-json>
# Best-effort — never fails the calling step. Writes one compact JSON
# object per call (open+append+close so logrotate is safe). Inside-runner
# events get source=runner; everything else (laptop runs) is source=mcp.
#
# ROK-1336 diagnostic (2026-05-21): the original implementation swallowed
# all errors via `2>/dev/null || true`, so the runner-side perf log silently
# fails to materialize on real fleet runs (function reproduces correctly in
# isolation — bug is in the runtime context, theory undetermined). Capture
# python3's stderr to `${PERF_LOG_LOCAL}.errors` so the next failed run
# leaves behind a JSON-line trace of WHY each call failed. Best-effort
# posture preserved — the function still returns 0 on disk-side errors so
# the calling step never aborts.
perf_emit_local() {
  local event="$1"
  local extra="${2-}"
  [ -z "$extra" ] && extra='{}'
  local source_label="runner"
  [ ! -d /workspace ] && source_label="mcp"
  local ts
  ts=$(python3 -c "import datetime; print(datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.') + ('%03d' % (datetime.datetime.utcnow().microsecond // 1000)) + 'Z')" 2>/dev/null \
    || date -u +%FT%TZ)
  local slot="${RL_SLOT:-}" branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
  local emit_out emit_rc
  emit_out=$(python3 -c "
import json, sys
extra = json.loads(sys.argv[5])
extra.update({'ts': sys.argv[1], 'event': sys.argv[2], 'source': sys.argv[3], 'branch': sys.argv[4]})
if sys.argv[6]:
    try: extra['slot'] = int(sys.argv[6])
    except ValueError: pass
print(json.dumps(extra, separators=(',', ':')))
" "$ts" "$event" "$source_label" "$branch" "$extra" "$slot" 2>&1)
  emit_rc=$?
  if [ "$emit_rc" -eq 0 ]; then
    # Happy path — append to perf log. Silent ignore on disk errors so the
    # function preserves its best-effort contract.
    printf '%s\n' "$emit_out" >> "$PERF_LOG_LOCAL" 2>/dev/null || true
  else
    # Failure path — log the python3 rc + captured stderr to a sibling
    # `.errors` file. Operators tail this after a fleet run to debug why
    # validate.start / validate.step.end / validate.end never landed.
    python3 -c "
import json, sys
print(json.dumps({'ts': sys.argv[1], 'event': sys.argv[2], 'rc': int(sys.argv[3]), 'stderr': sys.argv[4], 'PERF_LOG_LOCAL': sys.argv[5]}))
" "$ts" "$event" "$emit_rc" "$emit_out" "$PERF_LOG_LOCAL" 2>/dev/null \
      >> "${PERF_LOG_LOCAL}.errors" 2>/dev/null || true
  fi
}

# perf_now_ms — millisecond timestamp via python3 (portable).
perf_now_ms() {
  python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null || echo "$(( $(date -u +%s) * 1000 ))"
}

run_step() {
  local name="$1"
  shift
  echo ""
  echo -e "${YELLOW}========== $name ==========${NC}"
  local step_start_ms
  step_start_ms=$(perf_now_ms)
  local rc=0
  "$@" || rc=$?
  local step_end_ms step_dur
  step_end_ms=$(perf_now_ms)
  step_dur=$(( step_end_ms - step_start_ms ))
  # ROK-1331 M11 — emit validate.step.end per AC2.
  local step_extra
  step_extra=$(python3 -c "
import json, sys
print(json.dumps({'step': sys.argv[1], 'duration_ms': int(sys.argv[2]), 'exit_code': int(sys.argv[3])}))
" "$name" "$step_dur" "$rc" 2>/dev/null || echo '{}')
  perf_emit_local "validate.step.end" "$step_extra"

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
  # smoke fixtures, the smoke tests themselves, and the polling helper — plus
  # standalone-poll, which enqueues embed syncs at reschedule-poll lock-in.
  if echo "$changed_files" \
    | grep -qE '^api/src/discord-bot/|^api/src/notifications/|^api/src/events/signups|^api/src/events/event-lifecycle|^api/src/admin/demo-test|^tools/test-bot/src/smoke/|^tools/test-bot/src/helpers/polling\.ts$|^api/src/lineups/standalone-poll/'; then
    discord_smoke_relevant=true
    echo -e "  Discord-smoke-relevant changes: ${YELLOW}yes${NC}"
  else
    echo -e "  Discord-smoke-relevant changes: no"
  fi

  # Single-workspace detection for --scope=auto. Sets detected_workspace to
  # api | web | all. Resolves to "all" whenever the diff crosses a workspace
  # boundary, touches packages/** (contract feeds both), or touches root
  # config/tooling that can break anything (package.json, tsconfig, eslint,
  # vitest/playwright config). Anything purely under api/ → "api"; purely under
  # web/ → "web". Conservative: unknown/empty diffs fall back to "all".
  local touches_api=false touches_web=false touches_shared=false
  echo "$changed_files" | grep -qE '^api/' && touches_api=true
  echo "$changed_files" | grep -qE '^web/' && touches_web=true
  if echo "$changed_files" | grep -vE '^(api|web)/' \
       | grep -qE '^packages/|(^|/)package(-lock)?\.json$|(^|/)tsconfig|(^|/)\.eslintrc|vitest\.config|playwright\.config'; then
    touches_shared=true
  fi
  if $touches_shared || { $touches_api && $touches_web; }; then
    detected_workspace="all"
  elif $touches_api; then
    detected_workspace="api"
  elif $touches_web; then
    detected_workspace="web"
  else
    detected_workspace="all"
  fi
  echo -e "  Detected workspace (for --scope=auto): ${YELLOW}${detected_workspace}${NC}"
}

# Resolve the canonical web target for fleet/local. Sets the global `web_url`.
# Precedence (mirrors playwright.config.ts):
#   1. BASE_URL                     — explicit override (rl_validate_ci)
#   2. PLAYWRIGHT_BASE_URL          — Playwright's own convention; honored for parity
#   3. https://slot-N.<domain>      — RL_TARGET=remote + numeric RL_SLOT
#   4. http://localhost:5173        — local-dev fallback
# RL_SLOT is validated as a positive integer when used; non-numeric input is a
# loud config error rather than a silently-broken `slot-foo.gamernight.net` URL.
_resolve_web_url() {
  if [ -n "${BASE_URL:-}" ]; then
    web_url="$BASE_URL"
    return 0
  fi
  if [ -n "${PLAYWRIGHT_BASE_URL:-}" ]; then
    web_url="$PLAYWRIGHT_BASE_URL"
    return 0
  fi
  if [ -n "${RL_SLOT:-}" ] && [ "${RL_TARGET:-local}" = "remote" ]; then
    if ! [[ "$RL_SLOT" =~ ^[0-9]+$ ]]; then
      echo -e "${RED}RL_SLOT='${RL_SLOT}' is not numeric — refusing to construct slot URL.${NC}" >&2
      return 1
    fi
    web_url="https://slot-${RL_SLOT}.${RL_PUBLIC_DOMAIN:-gamernight.net}"
    return 0
  fi
  web_url="http://localhost:5173"
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
# `curl --url "$..."` is used (not bare `curl "$..."`) so a URL whose value
# starts with `-` is parsed as a URL, not as a curl flag (option injection
# defense — codex round-3 finding).
check_env_up() {
  # Resolve the web target first; the API health URL is derived from it
  # when HEALTH_URL is not explicitly set, so a single BASE_URL is enough
  # to switch both probes to the fleet env.
  local web_url
  _resolve_web_url || return 1

  # Health URL precedence:
  #   1. HEALTH_URL (set by rl_validate_ci against_env_slug → rl-net DNS)
  #   2. <web_url>/api/health when web_url is non-localhost (fleet)
  #   3. http://localhost:3000/health (local-dev default)
  local health_url
  if [ -n "${HEALTH_URL:-}" ]; then
    health_url="$HEALTH_URL"
  elif [[ "$web_url" != "http://localhost:5173" ]]; then
    health_url="${web_url%/}/api/health"
  else
    health_url="http://localhost:3000/health"
  fi

  curl -fsS --max-time 3 --url "$health_url" 2>/dev/null \
    | grep -q '"status":"ok"' || return 1

  curl -fsS --max-time 5 -o /dev/null --url "$web_url" 2>/dev/null
}

# ---------------------------------------------------------------------------
# CI check functions
# ---------------------------------------------------------------------------

run_build() {
  # Contract is always built (both api and web depend on it). api/web are gated
  # by effective_scope so a single-workspace --scope=auto run skips the other.
  npm run build -w packages/contract || return $?
  if [ "$effective_scope" != "web" ]; then npm run build -w api || return $?; fi
  if [ "$effective_scope" != "api" ]; then npm run build -w web || return $?; fi
}

run_typecheck() {
  # ROK-1336 #5 — propagate failure of the FIRST tsc invocation. The script
  # doesn't set -e, so without `|| return $?` the function reports the exit
  # code of the LAST command only. With this missing, api/ TS2741 errors
  # printed to stderr but the step's outer `$?` capture (run_step:195) saw
  # rc=0 from the web/ check and stamped "TypeScript (all): PASS".
  if [ "$effective_scope" != "web" ]; then npx tsc --noEmit -p api/tsconfig.json || return $?; fi
  if [ "$effective_scope" != "api" ]; then npx tsc --noEmit -p web/tsconfig.json || return $?; fi
}

run_lint() {
  # Check-only by design (ROK-1404): `lint` must never mutate the tree, so the
  # lint → prettier:check order is irrelevant; use `lint:fix` for auto-fixes.
  if [ "$effective_scope" != "web" ]; then
    npm run lint -w api || return $?
    npm run prettier:check -w api || return $?
  fi
  if [ "$effective_scope" != "api" ]; then
    npm run lint -w web || return $?
  fi
}

run_shell_parse_check() {
  # bash -n parse-lint every scripts/*.sh. Bash-3.2 parse breaks have shipped
  # before (sync-local-to-env.sh) because shell scripts were never
  # syntax-checked. Scope is scripts/*.sh only — rl-infra/** is a larger
  # surface, out of scope here. Mirrors the `lint` job's shell-parse step in CI.
  local f
  for f in "$REPO_ROOT"/scripts/*.sh; do
    [ -e "$f" ] || continue
    bash -n "$f" || return $?
  done
}

# Tools MCP-server vitest suites. CI runs these via the `tools-tests` matrix
# job; mirror it locally so a broken tools test (e.g. env-lock.test.ts) is
# caught by the local gate too. Each suite is sub-second. test-bot is NOT a
# workspace and has no `test` script — it's intentionally excluded (its
# coverage is the Discord smoke suite, gated separately).
run_tools_tests() {
  local ws pkg
  for ws in mcp-rl-fleet mcp-env mcp-discord; do
    pkg="$REPO_ROOT/tools/$ws/package.json"
    # Guard: skip any workspace lacking a `test` script so the gate never
    # fails on a missing script (defensive — all three define one today).
    if ! python3 -c "import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get('scripts',{}).get('test') else 1)" "$pkg" 2>/dev/null; then
      echo "tools/$ws has no test script — skipping"
      continue
    fi
    echo "--- tools/$ws (vitest) ---"
    npm test -w "@raid-ledger/$ws" || return $?
  done
}

run_unit_tests() {
  npm run test:cov -w api -- --passWithNoTests || return $?
  # ROK-1331 M6b MED-5: vitest coverage race on fleet runners. When
  # RL_TARGET=remote, fall through a three-step chain before declaring
  # failure. Step (a) is the normal attempt; (b) retries (relies on the
  # mutagen recursive **/coverage/** ignore in rl-infra/cli/rl /
  # mutagen/sync-template.yml to break the race); (c) re-runs with
  # --pool=forks --poolOptions.forks.singleFork=true. If all three fail,
  # exit non-zero with an explicit PAUSED message — never silently drop
  # --coverage. Operator approval is required to ship a no-coverage
  # workaround for the fleet only.
  if [ "${RL_TARGET:-local}" = "remote" ]; then
    (
      cd "$REPO_ROOT/web"
      if npx vitest run --coverage; then exit 0; fi
      echo "[validate-ci] vitest coverage race detected (step a); retrying (step b — relies on mutagen **/coverage/** recursive ignore)" >&2
      if npx vitest run --coverage; then exit 0; fi
      echo "[validate-ci] step (b) still failing; falling back to step (c) — --pool=forks --poolOptions.forks.singleFork=true" >&2
      if npx vitest run --coverage --pool=forks --poolOptions.forks.singleFork=true; then exit 0; fi
      echo "[validate-ci] PAUSED awaiting operator approval — all three remote fallback steps failed for the vitest coverage run. Refusing to silently degrade to a no-coverage run; the operator must explicitly authorize that workaround for the fleet only." >&2
      exit 1
    )
  else
    (cd "$REPO_ROOT/web" && npx vitest run --coverage)
  fi
}

check_backup_prereqs() {
  # Backup integration tests shell out to pg_dump/pg_restore. On dev machines
  # without postgresql-client installed they hard-fail with 500 → 200 mismatch
  # and obscure real failures. CI runners install postgresql-client, so the
  # binary is always present there.
  if command -v pg_dump >/dev/null 2>&1; then
    # ROK-1144: backup.integration.spec.ts gates on `=== '1'`, so the
    # "no env var = run" model is the source of truth. Unset (rather than
    # export 0) on the success path so a stale SKIP_BACKUP_INTEGRATION=1 from
    # an earlier shell can't survive and silently skip the suite.
    unset SKIP_BACKUP_INTEGRATION
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

  # ROK-1331 M9: per-slot Redis sidecar for fleet integration tests.
  # The fleet runner image ships only redis-tools (CLI), not redis-server,
  # so any integration spec that boots a BullMQ worker (which spawns its
  # own ioredis to the configured REDIS_URL) hits ECONNREFUSED on
  # localhost:6379. We spawn an ephemeral sidecar on rl-net so the runner
  # can reach it by DNS, then point REDIS_URL at it. Per-slot naming keeps
  # concurrent slots isolated. Skipped in local mode — laptop
  # deploy_dev.sh already manages Redis on localhost:6379.
  _spawn_redis_sidecar_if_remote || return $?

  # ROK-1331 M5b — when validate-ci runs inside the fleet runner, surface
  # per-test progress via jest --verbose. Otherwise a 12-min silent
  # window during the integration suite looks like the run is hung
  # (comment 23:21 B). Local runs stay quiet.
  #
  # ROK-1331 dogfood fix (2026-05-20): the inner script (running INSIDE the
  # runner via ssh-dispatched run-on-runner) does NOT inherit the laptop's
  # RL_TARGET=remote env. Detect "inside runner" via /workspace existing —
  # that's the orchestrator's bind-mount and is the canonical marker.
  #
  # ROK-1331 M10 (scope-add, 2026-05-20): on the fleet runner, jest
  # --runInBand accumulates ~98 integration suites' module state in one
  # Node process; V8 heap hit 3 GB and SIGABRT'd ~50 suites in (Probe 1
  # attempt 5). Split the run into $INTEGRATION_SHARDS shards (default 4)
  # so each shard is its own Node process; heap frees between shards.
  # Local laptop path stays single-process (more RAM headroom).
  if [ -d /workspace ] || [ "${RL_TARGET:-local}" = "remote" ]; then
    local shards="${INTEGRATION_SHARDS:-4}"
    local shard_results=()
    local i
    for i in $(seq 1 "$shards"); do
      echo "=== Integration shard ${i}/${shards} ==="
      # `npx jest` directly so each shard is its own Node process. We `cd api`
      # FIRST so the jest config's relative paths (rootDir, transforms,
      # ts-jest's tsconfig resolution) match what `npm run test:integration
      # -w api` would produce. Without cd, jest loads config from repo root
      # and ts-jest mis-resolves --ignoreDeprecations to an empty value
      # (TS5103). Discovered ROK-1331 Probe 1 attempt 6 (2026-05-20).
      #
      # NODE_OPTIONS=--max-old-space-size=4096 gives V8 a 4 GB heap ceiling
      # per shard (vs 1.4 GB default) which is ample headroom for ~25 suites
      # per shard. Raised 3072 -> 4096 (ROK-1268): 3 GB was tripping the OOM
      # carrier under sustained re-runs while still leaving margin on the
      # 7 GB fleet/CI runners (one shard process runs at a time here).
      # ROK-1331 M11 — JEST_SHARD_ID + JEST_TOTAL_SHARDS feed the perf
       # reporter so jest.suite.end events carry shard labels.
       # --logHeapUsage feeds the reporter's heap_used_mb sample.
      if (cd api && NODE_OPTIONS="--max-old-space-size=4096" \
         JEST_SHARD_ID="${i}" JEST_TOTAL_SHARDS="${shards}" \
         npx jest --config ./jest.integration.config.js \
                  --runInBand --verbose --logHeapUsage --shard="${i}/${shards}"); then
        shard_results+=("PASS")
      else
        shard_results+=("FAIL")
        echo "Shard ${i}/${shards} FAILED — stopping early"
        break
      fi
    done
    echo "=== Shard results: ${shard_results[*]} ==="
    local r
    for r in "${shard_results[@]}"; do
      if [ "$r" = "FAIL" ]; then return 1; fi
    done
  else
    npm run test:integration -w api
  fi
}

# ROK-1331 M9 — per-slot Redis sidecar for fleet integration tests.
# Idempotent (docker rm -f any stale container first), bounded ping-wait
# (30s), trap-cleaned on EXIT. Local mode is a no-op so deploy_dev.sh's
# Redis on localhost:6379 stays authoritative.
#
# ROK-1331 dogfood fix (2026-05-20): when validate-ci.sh runs INSIDE the
# fleet runner (post-ssh-dispatch), the runner does NOT inherit the laptop's
# RL_TARGET=remote. Detect "am I in the runner that should spawn a sidecar?"
# via /workspace bind-mount + RL_SLOT (both set by the orchestrator's
# docker-compose runner config). Local laptop runs lack both → no-op.
_spawn_redis_sidecar_if_remote() {
  # Skip if NEITHER inside-runner signals nor explicit remote flag are present.
  if [ ! -d /workspace ] && [ "${RL_TARGET:-local}" != "remote" ]; then
    return 0
  fi
  local slot="${RL_SLOT:-}"
  if [ -z "$slot" ]; then
    echo -e "${YELLOW}[rl-test-redis] inside-runner detected but RL_SLOT unset — skipping sidecar spawn${NC}" >&2
    return 0
  fi

  local cname="rl-test-redis-${slot}"
  echo "[rl-test-redis] spawning sidecar ${cname} on rl-net (slot=${slot})"

  # Idempotency: clear any stale container by that name (previous crash, etc.).
  docker rm -f "$cname" >/dev/null 2>&1 || true

  # Teardown on EXIT — even on jest panic / set -e abort. --rm on the run
  # call means `docker stop` removes the container too, but we also issue
  # an explicit `docker rm -f` for the rare case where stop times out.
  # Container name pattern: rl-test-redis-${slot}
  trap "docker stop 'rl-test-redis-${slot}' >/dev/null 2>&1 || true; docker rm -f 'rl-test-redis-${slot}' >/dev/null 2>&1 || true" EXIT

  docker run -d --rm \
    --name "$cname" \
    --network rl-net \
    --label "rl.role=test-redis" \
    --label "rl.slot=${slot}" \
    redis:7-alpine \
    redis-server --save "" --appendonly no >/dev/null

  # Bounded ping-wait (30s). The sidecar typically answers within 1s, but
  # cold image pulls can stretch this to ~10s on a freshly-claimed slot.
  local elapsed=0
  while ! docker exec "$cname" redis-cli ping 2>/dev/null | grep -q PONG; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge 30 ]; then
      echo -e "${RED}[rl-test-redis] sidecar ${cname} failed PING after 30s${NC}" >&2
      docker logs "$cname" --tail 30 >&2 || true
      return 1
    fi
  done

  # REDIS_URL=redis://rl-test-redis-${slot}:6379
  export REDIS_URL="redis://rl-test-redis-${slot}:6379"
  echo "[rl-test-redis] ${cname} ready after ${elapsed}s — REDIS_URL=${REDIS_URL}"
}

run_migration_validation() {
  if ! $migrations_changed; then
    echo -e "No migration files changed — skipping"
    return 2  # SKIPPED
  fi
  # ROK-1343: Mutagen sync on the rl-infra fleet runner strips POSIX exec
  # bits even though git stores `scripts/validate-migrations.sh` as 100755.
  # GitHub CI honors the git mode; the fleet does not. Re-assert +x defensively
  # so the step survives both environments. See TECH-DEBT-BACKLOG.md 2026-05-22
  # for the upstream Mutagen-side fix tracking.
  chmod +x "$REPO_ROOT/scripts/validate-migrations.sh"
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

  # ROK-1331 M13: choose a non-conflicting host port for the allinone container.
  # The fleet VM's rl-dashboard service permanently occupies :8080, so the
  # legacy `docker run -p 8080:80` fails with "port is already allocated".
  # Resolution order: explicit RL_CONTAINER_STARTUP_PORT > fleet default 8090
  # (detected via /workspace mount) > laptop default 8080.
  local host_port="${RL_CONTAINER_STARTUP_PORT:-}"
  if [ -z "$host_port" ]; then
    if [ -d /workspace ]; then
      host_port=8090
    else
      host_port=8080
    fi
  fi

  docker build -f Dockerfile.allinone -t rl:ci-test .
  docker run --rm -d \
    --name "$cname" \
    -p ${host_port}:80 \
    -e ADMIN_PASSWORD=ci-test \
    rl:ci-test

  _wait_for_container_health "$cname" "$host_port"
}

_wait_for_container_health() {
  local cname="$1"
  local host_port="${2:-8080}"
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

  # Verify nginx proxy.
  # Laptop path: curl from host, the `-p 8080:80` mapping is visible on
  # localhost. Github CI same shape.
  # ROK-1331 dogfood fix (2026-05-20): on the fleet, validate-ci.sh runs
  # INSIDE the runner container. The host port mapping is bound on the VM
  # host, not on runner-1's localhost — curl-from-runner-1 returns HTTP
  # 000. Docker-exec into the test container itself and curl nginx on
  # its internal port 80 to validate the proxy without depending on
  # cross-container port visibility.
  local http_code
  if [ -d /workspace ]; then
    http_code=$(docker exec "$cname" sh -c \
      "wget -qS -O /dev/null http://127.0.0.1:80/api/health 2>&1 | awk '/HTTP/{print \$2; exit}'" \
      2>/dev/null || echo 000)
  else
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      http://127.0.0.1:${host_port}/api/health)
  fi
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

  _check_container_security_headers "$host_port" "$cname" || return 1
}

# ROK-1158: verify the 6 security headers are present on every response surface
# (SPA index, /api proxy, AND a static bundle). The bundle URL specifically
# guards against the nginx `add_header` inheritance trap — the static-asset
# location block defines its own `add_header Cache-Control`, which kills
# parent-scope inheritance, so the snippet must be `include`d there too.
#
# ROK-1331 dogfood fix (2026-05-21): on the fleet, validate-ci.sh runs INSIDE
# the runner container. `-p ${host_port}:80` binds the test container's port
# on the VM HOST, not on runner-1's localhost — `curl -sI http://127.0.0.1:8090/`
# from inside runner-1 hits the runner's own loopback and returns empty. Use
# docker-exec-into-cname-and-curl-port-80 (the same shape as the API proxy
# check in _wait_for_container_health) when /workspace is mounted (i.e. inside
# a fleet runner).
_check_container_security_headers() {
  local host_port="${1:-8080}" cname="${2-}"
  local headers
  local index_url="http://127.0.0.1:${host_port}/"
  local health_url="http://127.0.0.1:${host_port}/api/health"

  _fetch_headers() {
    local url="$1" path
    if [ -d /workspace ] && [ -n "$cname" ]; then
      path="${url#http://127.0.0.1:${host_port}}"
      docker exec "$cname" wget -qS -O /dev/null "http://127.0.0.1:80${path}" 2>&1 \
        | sed -E 's/^[[:space:]]+//' \
        | grep -E '^(HTTP|[A-Za-z][A-Za-z0-9-]+:)'
    else
      curl -sI "$url"
    fi
  }
  _fetch_body() {
    local url="$1" path
    if [ -d /workspace ] && [ -n "$cname" ]; then
      path="${url#http://127.0.0.1:${host_port}}"
      docker exec "$cname" wget -qO- "http://127.0.0.1:80${path}" 2>/dev/null
    else
      curl -s "$url"
    fi
  }

  for url in "$index_url" "$health_url"; do
    headers=$(_fetch_headers "$url")
    _assert_security_headers "$headers" "$url" || return 1
  done

  local html bundle_path bundle_url
  html=$(_fetch_body "$index_url")
  bundle_path=$(echo "$html" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
  if [ -z "$bundle_path" ]; then
    echo -e "${RED}Could not locate /assets/*.js bundle URL in index.html${NC}"
    return 1
  fi
  bundle_url="http://127.0.0.1:${host_port}${bundle_path}"
  headers=$(_fetch_headers "$bundle_url")
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
        if [ "${RL_TARGET:-local}" = "remote" ]; then
          echo -e "${YELLOW}  Slot URL probe failed — ensure your \`rl claim\` slot is up via \`rl_env_deploy({slug: ...})\`.${NC}"
        else
          echo -e "${YELLOW}  Run ./scripts/deploy_dev.sh first, then re-run validate-ci to cover the changed UI flows.${NC}"
        fi
        return 2
      fi
      ;;
    on)
      if ! check_env_up; then
        echo -e "${RED}--with-e2e requested but dev env is not responding on :3000/health.${NC}"
        if [ "${RL_TARGET:-local}" = "remote" ]; then
          echo -e "${RED}Slot URL probe failed — ensure your \`rl claim\` slot is up via \`rl_env_deploy({slug: ...})\`.${NC}"
        else
          echo -e "${RED}Run ./scripts/deploy_dev.sh first.${NC}"
        fi
        return 1
      fi
      ;;
  esac

  # Resolve the target URL the env probe just validated and export it so
  # Playwright's `use.baseURL` (playwright.config.ts) actually targets the
  # fleet env in remote mode. Without this, validate-ci would happily probe
  # https://slot-N.gamernight.net AND THEN run tests against localhost:5173
  # (codex round-3 HIGH).
  local web_url
  if _resolve_web_url; then
    export PLAYWRIGHT_BASE_URL="$web_url"
    echo -e "${YELLOW}Playwright targeting: ${PLAYWRIGHT_BASE_URL}${NC}"
  fi

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
        if [ "${RL_TARGET:-local}" = "remote" ]; then
          echo -e "${YELLOW}  Slot URL probe failed — ensure your \`rl claim\` slot is up via \`rl_env_deploy({slug: ...})\`.${NC}"
        else
          echo -e "${YELLOW}  Run ./scripts/deploy_dev.sh first, then re-run validate-ci to cover the changed bot/notification flows.${NC}"
        fi
        return 2
      fi
      ;;
    on)
      if ! check_env_up; then
        echo -e "${RED}--with-e2e requested but dev env is not responding on :3000/health.${NC}"
        if [ "${RL_TARGET:-local}" = "remote" ]; then
          echo -e "${RED}Slot URL probe failed — ensure your \`rl claim\` slot is up via \`rl_env_deploy({slug: ...})\`.${NC}"
        else
          echo -e "${RED}Run ./scripts/deploy_dev.sh first.${NC}"
        fi
        return 1
      fi
      ;;
  esac

  # tools/test-bot is a standalone package, NOT an npm workspace, so the root
  # `npm install` (and the fleet runner image's baked install) does NOT cover
  # it. On a fresh fleet runner its node_modules are absent and the smoke
  # harness dies at import (ERR_MODULE_NOT_FOUND: @discordjs/voice). Install
  # them here if missing — NO-OP when node_modules already exists (laptop runs
  # and warm runners pay nothing). Prefer `npm ci` (lockfile-exact); fall back
  # to `npm install` if ci fails (e.g. lockfile drift).
  if [[ ! -d "$REPO_ROOT/tools/test-bot/node_modules" ]]; then
    echo -e "${YELLOW}tools/test-bot/node_modules missing — installing companion-bot deps before smoke...${NC}"
    if ! (cd "$REPO_ROOT/tools/test-bot" && npm ci); then
      echo -e "${YELLOW}npm ci failed (likely lockfile drift) — retrying with npm install...${NC}"
      (cd "$REPO_ROOT/tools/test-bot" && npm install) || return 1
    fi
  fi

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
      --static) static_mode=true; shift ;;
      --scope=*) scope_mode="${1#--scope=}"; shift ;;
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

  if $static_mode && $only_e2e; then
    echo -e "${RED}--static and --only-e2e are mutually exclusive (static skips all e2e).${NC}"
    exit 1
  fi

  if $static_mode && [ "$e2e_mode" = "on" ]; then
    echo -e "${RED}--static and --with-e2e are mutually exclusive (static skips all e2e).${NC}"
    exit 1
  fi

  echo -e "${GREEN}Starting local CI validation...${NC}"
  detect_scope

  # Resolve --scope into effective_scope (auto → detected_workspace from detect_scope).
  case "$scope_mode" in
    auto) effective_scope="$detected_workspace" ;;
    all|api|web) effective_scope="$scope_mode" ;;
    *) echo -e "${RED}Invalid --scope=${scope_mode} (expected all|api|web|auto)${NC}"; exit 1 ;;
  esac
  if [ "$effective_scope" != "all" ]; then
    echo -e "${YELLOW}Scope-narrowed gate: build/typecheck/lint for '${effective_scope}' workspace (+contract) only — GitHub CI still runs the full path-filtered suite.${NC}"
  fi

  # ROK-1331 M11 — bookend the full validate-ci run with paired events so
  # dashboards can show "last validate-ci on branch X took T seconds, exit
  # code C". validate.end fires from an EXIT trap so abort paths (set -e,
  # ctrl-C, run_step's fail-fast exit) still produce a terminal event.
  #
  # ROK-1336 fix: validate_start_ms + ci_flags must be SCRIPT-SCOPE, not
  # `local` to main(). The EXIT trap fires AFTER main() returns, at which
  # point locals are out of scope — under set -u the trap aborted with
  # `validate_start_ms: unbound variable` and validate.end never landed
  # in the perf log. (Discovered by running validate-ci --only-e2e directly
  # on the runner and reading the trap's error to stderr.)
  validate_start_ms=$(perf_now_ms)
  validate_ci_flags="$*"
  perf_emit_local "validate.start" "$(python3 -c "
import json, sys
print(json.dumps({'ci_flags': sys.argv[1]}))
" "$validate_ci_flags" 2>/dev/null || echo '{}')"
  _perf_validate_end() {
    local rc="$?"
    local end_ms dur
    end_ms=$(perf_now_ms)
    dur=$(( end_ms - validate_start_ms ))
    perf_emit_local "validate.end" "$(python3 -c "
import json, sys
print(json.dumps({'duration_ms': int(sys.argv[1]), 'exit_code': int(sys.argv[2]), 'ci_flags': sys.argv[3]}))
" "$dur" "$rc" "$validate_ci_flags" 2>/dev/null || echo '{}')"
  }
  trap _perf_validate_end EXIT

  if ! $only_e2e; then
    run_step "Build (all workspaces)" run_build
    run_step "TypeScript (all)" run_typecheck
    run_step "Lint (all)" run_lint
    # Static, deterministic check — runs in BOTH static and full gates.
    run_step "Shell parse check (scripts/*.sh)" run_shell_parse_check

    # Unit + integration are the slow, behavioral checks. In --static (lite
    # gate) mode they're deferred to GitHub CI, which runs them sharded +
    # randomized on every PR. Full mode keeps them local.
    if ! $static_mode; then
      run_step "Unit tests + coverage" run_unit_tests
      run_step "Tools unit tests (mcp servers)" run_tools_tests
      run_step "Integration tests (api)" run_integration_tests
    fi

    # Migration and container checks handle their own SKIPPED/PASS/FAIL
    # recording. They run in BOTH static and full modes: cheap (auto-SKIP)
    # when no migration/infra files changed, and critical local-validation
    # carve-outs when they DID change — a bad migration can wedge a deploy
    # and a bad allinone image caused a prod outage (CLAUDE.md STRICT).
    run_step "Migration validation" run_migration_validation
    run_step "Container startup" run_container_validation
  fi

  # E2E checks are auto-scoped (diff + env gated). They SKIP cleanly when the
  # diff doesn't touch their surface or when the dev env isn't running.
  # In --static mode they're skipped entirely (deferred to GitHub CI).
  if ! $static_mode; then
    run_step "Playwright (desktop + mobile)" run_playwright_e2e
    run_step "Discord smoke (companion bot)" run_discord_smoke
  fi

  print_summary
  echo -e "${GREEN}All checks passed!${NC}"
}

# ROK-1331 M6b: when sourced with RL_VALIDATE_CI_DRY=1, expose all
# functions without auto-running the main pipeline. Lets bash test
# harnesses source the script and invoke `run_unit_tests` directly with
# stubbed npm/npx in PATH. Production callers (operators, /push, CI) do
# NOT set this var so the existing behavior is unchanged.
if [ "${RL_VALIDATE_CI_DRY:-0}" != "1" ]; then
  main "$@"
fi
