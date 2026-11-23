#!/usr/bin/env bash
# lane-check.sh — what a lane runs before it reports "green" (ROK-2310).
#
# Lanes used to run only the suites they touched, without typechecking specs;
# the misses surfaced stages later. From the branch's diff vs origin/main
# (merge-base, plus uncommitted and untracked files) this runs, SERIALLY:
#   1. the spec typecheck of every touched workspace
#   2. jest / vitest for each WHOLE touched folder (related tests for a file
#      sitting directly in api/src or web/src), workers capped
#   3. the contract's own tests, each touched tool's tests, and node --test
#      for touched scripts/*.mjs specs (bash -n for scripts/**/*.sh)
#   4. eslint on the changed files
#   5. a grep of scripts/smoke/** and tools/test-bot/src/smoke/** for string
#      literals the diff removed from non-test source (a hit = FAIL)
# then prints ONE table (Step | Target | Result | Seconds) and exits 1 on any
# FAIL. Selection logic: scripts/lane-check-plan.mjs (pure, node:test spec).
#
# Serial on purpose: two or three lanes share a 16 GB laptop. Typecheck never
# runs in parallel, jest/vitest run with --maxWorkers=$LANE_CHECK_WORKERS (2).
#
# Usage: scripts/lane-check.sh [--plan]
#   --plan   print the plan (JSON) and exit 0 without running anything.
# Env:     LANE_CHECK_WORKERS (default 2), LANE_CHECK_BASE (default origin/main)
# Exit:    0 all PASS/SKIPPED · 1 a FAIL · 2 usage / git error.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "lane-check: not in a git repo" >&2; exit 2; }
BASE="${LANE_CHECK_BASE:-origin/main}"
WORKERS="${LANE_CHECK_WORKERS:-2}"
PLAN_ONLY=false
case "${1:-}" in
  --plan) PLAN_ONLY=true ;;
  -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
  "") ;;
  *) echo "lane-check: unknown argument $1" >&2; exit 2 ;;
esac

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lane-check.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
cd "$REPO_ROOT" || exit 2

# Same collection as validate-ci.sh's _scoped_changed_files (mode-only
# uncommitted changes ignored — Mutagen lands synced files at 0644).
changed_files() {
  local committed uncommitted untracked
  committed=$(git diff --no-renames --name-only "$BASE...HEAD") || return 1
  uncommitted=$(GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fileMode GIT_CONFIG_VALUE_0=false \
    git diff --no-renames --name-only HEAD) || return 1
  untracked=$(git ls-files --others --exclude-standard) || return 1
  printf '%s\n%s\n%s\n' "$committed" "$uncommitted" "$untracked" | sort -u
}

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
  echo "lane-check: base $BASE does not resolve — git fetch origin main" >&2; exit 2
fi
changed_files >"$TMP/files" || { echo "lane-check: git diff failed" >&2; exit 2; }
{ git diff --no-renames "$BASE...HEAD"; git diff --no-renames HEAD; } >"$TMP/diff" 2>/dev/null

if $PLAN_ONLY; then
  node scripts/lane-check-plan.mjs --diff "$TMP/diff" <"$TMP/files"
  exit 0
fi
node scripts/lane-check-plan.mjs --diff "$TMP/diff" --lines <"$TMP/files" >"$TMP/plan" || exit 2

# Read every row first: npx inside the loop would otherwise eat the plan's stdin.
KINDS=(); TARGETS=()
while IFS=$'\t' read -r kind target; do
  [ -n "$kind" ] || continue
  KINDS+=("$kind"); TARGETS+=("$target")
done <"$TMP/plan"

ROWS=(); FAILED=0; N=0
row() { ROWS+=("$(printf '%-14s | %-48.48s | %-7s | %s' "$1" "$2" "$3" "$4")"); }

# run_step STEP TARGET CMD... — runs in a subshell, logs to a file, prints the
# log tail on failure so the lane sees why without re-running.
run_step() {
  local step="$1" target="$2" start rc log
  shift 2
  N=$((N + 1)); log="$TMP/step-$N.log"; start=$(date +%s)
  echo "==> $step $target"
  ( "$@" ) >"$log" 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then row "$step" "$target" PASS "$(( $(date +%s) - start ))"
  else
    FAILED=1; row "$step" "$target" FAIL "$(( $(date +%s) - start ))"
    echo "---- $step $target FAILED (exit $rc), last 40 lines ----"; tail -n 40 "$log"
  fi
}

typecheck() {
  case "$1" in
    api) NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p api/tsconfig.json ;;
    web) npx tsc --noEmit -p web/tsconfig.test.json ;;
    contract) npx tsc --noEmit -p packages/contract/tsconfig.json ;;
    smoke) npx tsc --noEmit -p scripts/smoke/tsconfig.typecheck.json ;;
    tool:test-bot) (cd tools/test-bot && npx tsc --noEmit -p tsconfig.json) ;;
    tool:*) npx tsc --noEmit -p "tools/${1#tool:}/tsconfig.json" ;;
    *) echo "no typecheck for $1"; return 1 ;;
  esac
}

# Paths in the plan are repo-relative; the runners take workspace-relative ones.
# A trailing / keeps api/src/a from also matching api/src/ab.
jest_folder() { (cd api && npx jest --maxWorkers="$WORKERS" --passWithNoTests "${1#api/}/"); }
vitest_folder() { (cd web && npx vitest run --maxWorkers="$WORKERS" "${1#web/}/"); }
# strip_ws PREFIX "a b c" — drop a leading PREFIX/ from each space-joined path.
strip_ws() { printf '%s\n' $2 | sed "s#^$1/##"; }  # shellcheck disable=SC2086
# shellcheck disable=SC2046 # one path per word, from the planner
jest_related() { (cd api && npx jest --maxWorkers="$WORKERS" --passWithNoTests --findRelatedTests $(strip_ws api "$1")); }
# shellcheck disable=SC2046
vitest_related() { (cd web && npx vitest related --run --maxWorkers="$WORKERS" --passWithNoTests $(strip_ws web "$1")); }
contract_tests() { npm test -w @raid-ledger/contract -- --maxWorkers="$WORKERS"; }
tool_tests() {
  if [ "$1" = "test-bot" ]; then npm test --prefix tools/test-bot
  else npm test -w "@raid-ledger/$1" -- --maxWorkers="$WORKERS"; fi
}
# shellcheck disable=SC2086
eslint_files() {
  local dir
  case "$1" in api) dir=api ;; web) dir=web ;; tool:test-bot) dir=tools/test-bot ;; *) return 1 ;; esac
  (cd "$dir" && npx eslint $2)
}
smoke_grep() {
  local hits
  hits=$(grep -rnIF -- "$1" scripts/smoke tools/test-bot/src/smoke 2>/dev/null)
  [ -z "$hits" ] && return 0
  echo "A smoke spec still pins text this diff removed: \"$1\""; echo "$hits"; return 1
}

# Order: typechecks first (serial), then tests, then lint, then smoke strings.
[ "${#KINDS[@]}" -gt 0 ] && for phase in typecheck tests lint smoke skipped; do
  for i in "${!KINDS[@]}"; do
    k="${KINDS[$i]}"; t="${TARGETS[$i]}"
    case "$phase:$k" in
      typecheck:typecheck) run_step typecheck "$t" typecheck "$t" ;;
      tests:jest) run_step jest "$t" jest_folder "$t" ;;
      tests:jest-related) run_step jest-related "$t" jest_related "$t" ;;
      tests:vitest) run_step vitest "$t" vitest_folder "$t" ;;
      tests:vitest-related) run_step vitest-related "$t" vitest_related "$t" ;;
      tests:contract-tests) run_step contract-tests "$t" contract_tests ;;
      tests:tool-tests) run_step tool-tests "$t" tool_tests "$t" ;;
      tests:node-test) run_step node-test "$t" node --test "$t" ;;
      lint:bash-n) run_step bash-n "$t" bash -n "$t" ;;
      lint:eslint:*) run_step "eslint" "${k#eslint:}: $t" eslint_files "${k#eslint:}" "$t" ;;
      smoke:smoke-string) run_step smoke-string "$t" smoke_grep "$t" ;;
      skipped:skipped) row skipped "$t" SKIPPED 0 ;;
    esac
  done
done

echo
echo "lane-check summary (base $BASE, workers $WORKERS)"
printf '%-14s | %-48s | %-7s | %s\n' Step Target Result Seconds
printf '%s\n' "---------------+--------------------------------------------------+---------+--------"
if [ "${#ROWS[@]}" -eq 0 ]; then echo "(nothing to check for this diff)"
else printf '%s\n' "${ROWS[@]}"; fi
[ "$FAILED" -eq 0 ] && { echo "RESULT: PASS"; exit 0; }
echo "RESULT: FAIL"; exit 1
