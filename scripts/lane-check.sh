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
#      for touched scripts/*.mjs specs (bash -n for scripts/**/*.sh), and
#      scripts/test/run-all.sh (CI's scripts-tests harnesses) for any scripts/ change
#   4. eslint on the changed files
#   5. a grep of scripts/smoke/** and tools/test-bot/src/smoke/** for string
#      literals the diff removed from non-test source (a hit = FAIL)
# then prints ONE table (Step | Target | Result | Seconds) and exits 1 on any
# FAIL. Selection logic: scripts/lane-check-plan.mjs (pure, node:test spec).
#
# Serial on purpose: two or three lanes share a 16 GB laptop. Typecheck never
# runs in parallel, jest/vitest run with --maxWorkers=$LANE_CHECK_WORKERS (2).
# One run peaks at ~4.7 GB, so runs are serialised MACHINE-WIDE: a run takes
# an atomic mkdir lock (pid inside) and waits for a live holder; a lock whose
# pid is dead, or that has no pid file after LANE_CHECK_LOCK_GRACE seconds, is
# stale and taken over under a second mkdir mutex. --plan never takes the lock.
#
# Usage: scripts/lane-check.sh [--plan]
#   --plan   print the plan (JSON) and exit 0 without running anything.
# Env:     LANE_CHECK_WORKERS (default 2), LANE_CHECK_BASE (default origin/main),
#          LANE_CHECK_ONLY (comma list of phases: typecheck,tests,lint,smoke),
#          LANE_CHECK_LOCK_DIR (default $TMPDIR/rl-lane-check.lock),
#          LANE_CHECK_LOCK_WAIT (seconds, default 900), LANE_CHECK_LOCK_POLL (5),
#          LANE_CHECK_LOCK_GRACE (seconds a pid-less lock is left alone, 10).
# Exit:    0 all PASS/SKIPPED · 1 a FAIL · 2 usage / git error ·
#          75 another lane-check still held the lock after LANE_CHECK_LOCK_WAIT.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "lane-check: not in a git repo" >&2; exit 2; }
BASE="${LANE_CHECK_BASE:-origin/main}"
WORKERS="${LANE_CHECK_WORKERS:-2}"
ONLY="${LANE_CHECK_ONLY:-}"
PLAN_ONLY=false
case "${1:-}" in
  --plan) PLAN_ONLY=true ;;
  -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
  "") ;;
  *) echo "lane-check: unknown argument $1" >&2; exit 2 ;;
esac

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lane-check.XXXXXX")"
LOCK_DIR="${LANE_CHECK_LOCK_DIR:-${TMPDIR:-/tmp}/rl-lane-check.lock}"
LOCK_WAIT="${LANE_CHECK_LOCK_WAIT:-900}"
LOCK_POLL="${LANE_CHECK_LOCK_POLL:-5}"
LOCK_GRACE="${LANE_CHECK_LOCK_GRACE:-10}"
HAVE_LOCK=false
cleanup() { rm -rf "$TMP"; if $HAVE_LOCK; then rm -rf "$LOCK_DIR"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
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

# Machine-wide lock: mkdir is atomic, so exactly one run holds it. A holder
# whose pid is gone (killed lane, crashed shell), or a lock dir still without a
# pid file after LOCK_GRACE seconds (killed between mkdir and the pid write),
# is stale and is taken over.
mtime_of() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }
older_than() { local m; m=$(mtime_of "$1") && [ -n "$m" ] && [ $(( $(date +%s) - m )) -ge "$2" ]; }
# lock_stale PID — PID is what $LOCK_DIR/pid held ("" = no pid file).
lock_stale() {
  if [ -n "$1" ]; then ! ps -p "$1" >/dev/null 2>&1; else older_than "$LOCK_DIR" "$LOCK_GRACE"; fi
}
# take_over PID — only one waiter at a time (a second mkdir mutex) may remove a
# stale lock, and only if it still holds the PID that waiter judged dead, so a
# waiter can never remove a lock another waiter has just taken. A mutex left
# by a killed run is cleared after 60 s. Returns 1 if another waiter has it.
take_over() {
  local seen="$1" mutex="$LOCK_DIR.takeover"
  if ! mkdir "$mutex" 2>/dev/null; then
    older_than "$mutex" 60 && rm -rf "$mutex"
    return 1
  fi
  if [ -d "$LOCK_DIR" ] && [ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$seen" ] && lock_stale "$seen"; then
    echo "lane-check: taking over a stale lock from ${seen:+dead pid $seen}${seen:-a run that died before writing its pid}"
    mv "$LOCK_DIR" "$LOCK_DIR.stale.$$" 2>/dev/null && rm -rf "$LOCK_DIR.stale.$$"
  fi
  rmdir "$mutex" 2>/dev/null; return 0
}
acquire_lock() {
  local start pid said=false
  start=$(date +%s)
  while :; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "$$" >"$LOCK_DIR/pid"; HAVE_LOCK=true; return 0
    fi
    pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    if lock_stale "$pid" && take_over "$pid"; then continue; fi
    if [ $(( $(date +%s) - start )) -ge "$LOCK_WAIT" ]; then
      echo "lane-check: gave up after ${LOCK_WAIT}s — lane-check pid ${pid:-?} still holds $LOCK_DIR (one run at a time per laptop)" >&2
      exit 75
    fi
    $said || { echo "waiting for lane-check pid ${pid:-?}"; said=true; }
    sleep "$LOCK_POLL"
  done
}
acquire_lock

node scripts/lane-check-plan.mjs --diff "$TMP/diff" --lines <"$TMP/files" >"$TMP/plan" || exit 2
# The planner ends --lines with an `end` row. Without it the plan is empty for
# the wrong reason, and an empty table must never read as PASS.
if [ "$(tail -n 1 "$TMP/plan")" != "$(printf 'end\tplan')" ]; then
  echo "lane-check: scripts/lane-check-plan.mjs printed no plan (no end row) — nothing was checked" >&2
  echo "RESULT: FAIL"; exit 1
fi

# Read every row first: npx inside the loop would otherwise eat the plan's stdin.
KINDS=(); TARGETS=()
while IFS=$'\t' read -r kind target; do
  [ -n "$kind" ] && [ "$kind" != end ] || continue
  KINDS+=("$kind"); TARGETS+=("$target")
done <"$TMP/plan"

ROWS=(); FAILED=0; N=0
# row STEP TARGET RESULT SECONDS [NOTE]
row() { ROWS+=("$(printf '%-14s | %-48.48s | %-7s | %s%s' "$1" "$2" "$3" "$4" "${5:+  ($5)}")"); }
# skip_note STEP LOG — why a passing step is really SKIPPED, if it is.
skip_note() {
  local marker
  marker=$(grep -m1 '^LANE_CHECK_SKIP: ' "$2" 2>/dev/null) && { echo "${marker#LANE_CHECK_SKIP: }"; return; }
  case "$1" in jest*|vitest*) grep -qE 'No test files found|No tests found' "$2" && echo "no tests" ;; esac
}

# run_step STEP TARGET CMD... — runs in a subshell, logs to a file, prints the
# log tail on failure so the lane sees why without re-running.
run_step() {
  local step="$1" target="$2" start rc log note
  shift 2
  N=$((N + 1)); log="$TMP/step-$N.log"; start=$(date +%s)
  echo "==> $step $target"
  ( "$@" ) >"$log" 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then
    note=$(skip_note "$step" "$log")
    if [ -n "$note" ]; then row "$step" "$target" SKIPPED "$(( $(date +%s) - start ))" "$note"
    else row "$step" "$target" PASS "$(( $(date +%s) - start ))"; fi
  else
    FAILED=1; row "$step" "$target" FAIL "$(( $(date +%s) - start ))"
    echo "---- $step $target FAILED (exit $rc), last 40 lines ----"; tail -n 40 "$log"
  fi
}

# A fresh worktree has no tools/test-bot install; say so instead of a TS2307 wall.
tb_installed() {
  [ -d tools/test-bot/node_modules ] && return 0
  echo "tools/test-bot has no node_modules — run (cd tools/test-bot && npm ci) and re-run"; return 1
}
typecheck() {
  case "$1" in
    api) NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit -p api/tsconfig.json ;;
    web) npx tsc --noEmit -p web/tsconfig.test.json ;;
    contract) npx tsc --noEmit -p packages/contract/tsconfig.json ;;
    smoke) npx tsc --noEmit -p scripts/smoke/tsconfig.typecheck.json ;;
    tool:test-bot) tb_installed && (cd tools/test-bot && npx tsc --noEmit -p tsconfig.json) ;;
    tool:*) npx tsc --noEmit -p "tools/${1#tool:}/tsconfig.json" ;;
    *) echo "no typecheck for $1"; return 1 ;;
  esac
}

# Paths in the plan are repo-relative; the runners take workspace-relative ones.
# A trailing / keeps api/src/a from also matching api/src/ab.
jest_folder() { (cd api && npx jest --maxWorkers="$WORKERS" --passWithNoTests "${1#api/}/"); }
vitest_folder() { (cd web && npx vitest run --maxWorkers="$WORKERS" --passWithNoTests "${1#web/}/"); }
# strip_ws PREFIX "a b c" — drop a leading PREFIX/ from each space-joined path.
strip_ws() { printf '%s\n' $2 | sed "s#^$1/##"; }  # shellcheck disable=SC2086
# shellcheck disable=SC2046 # one path per word, from the planner
jest_related() { (cd api && npx jest --maxWorkers="$WORKERS" --passWithNoTests --findRelatedTests $(strip_ws api "$1")); }
# shellcheck disable=SC2046
vitest_related() { (cd web && npx vitest related --run --maxWorkers="$WORKERS" --passWithNoTests $(strip_ws web "$1")); }
# api/web/smoke typecheck against packages/contract/dist: rebuild it first when
# the branch changes the contract, or when it was never built.
contract_build() { npm run build -w packages/contract; }
needs_contract_build() {
  local k t i
  for k in "${KINDS[@]}"; do [ "$k" = contract-tests ] && return 0; done
  [ -d packages/contract/dist ] && return 1
  for i in "${!KINDS[@]}"; do
    k="${KINDS[$i]}"; t="${TARGETS[$i]}"
    [ "$k" = typecheck ] && [ "$t" != contract ] && return 0
  done
  return 1
}
contract_tests() { npm test -w @raid-ledger/contract -- --maxWorkers="$WORKERS"; }
tool_tests() {
  if [ "$1" = "test-bot" ]; then tb_installed && npm test --prefix tools/test-bot
  else npm test -w "@raid-ledger/$1" -- --maxWorkers="$WORKERS"; fi
}
# shellcheck disable=SC2086
eslint_files() {
  local dir
  case "$1" in api) dir=api ;; web) dir=web ;; tool:test-bot) tb_installed || return 1; dir=tools/test-bot ;; *) return 1 ;; esac
  (cd "$dir" && npx eslint $2)
}
smoke_grep() {
  local hits
  hits=$(grep -rnIF -- "$1" scripts/smoke tools/test-bot/src/smoke 2>/dev/null)
  [ -z "$hits" ] && return 0
  # Removed here but still rendered elsewhere: the smoke spec still holds.
  if git grep -qF --untracked -- "$1" -- api/src web/src packages/contract/src \
    ':!*.spec.*' ':!*.test.*' ':!*/__tests__/*' ':!*/test/*' ':!*/tests/*' 2>/dev/null; then
    echo "LANE_CHECK_SKIP: still in source"; echo "$hits"; return 0
  fi
  echo "A smoke spec still pins text this diff removed: \"$1\""; echo "$hits"; return 1
}

# Order: typechecks first (serial), then tests, then lint, then smoke strings.
[ "${#KINDS[@]}" -gt 0 ] && for phase in typecheck tests lint smoke skipped; do
  [ -z "$ONLY" ] || [ "$phase" = skipped ] || [[ ",$ONLY," == *",$phase,"* ]] || continue
  if [ "$phase" = typecheck ] && needs_contract_build; then
    run_step contract-build packages/contract contract_build
  fi
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
      tests:shell-tests) run_step shell-tests "$t" bash "$t" ;;
      lint:bash-n) run_step bash-n "$t" bash -n "$t" ;;
      lint:eslint:*) run_step "eslint" "${k#eslint:}: $t" eslint_files "${k#eslint:}" "$t" ;;
      smoke:smoke-string) run_step smoke-string "$t" smoke_grep "$t" ;;
      skipped:skipped) row skipped "$t" SKIPPED 0 ;;
    esac
  done
done

echo
echo "lane-check summary (base $BASE, workers $WORKERS${ONLY:+, only $ONLY})"
printf '%-14s | %-48s | %-7s | %s\n' Step Target Result Seconds
printf '%s\n' "---------------+--------------------------------------------------+---------+--------"
if [ "${#ROWS[@]}" -eq 0 ]; then echo "(nothing to check for this diff)"
else printf '%s\n' "${ROWS[@]}"; fi
[ "$FAILED" -eq 0 ] && { echo "RESULT: PASS"; exit 0; }
echo "RESULT: FAIL"; exit 1
