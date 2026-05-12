#!/usr/bin/env bash
# Loop the integration suite repeatedly to repro the residual rotating-suite
# TCP-RST flake that survived ROK-1250's layer-2 fix.
#
# ROK-1264 layer-4 reproduction script. The predecessor /tmp loops from
# ROK-1249/1250 were not version-controlled; this lives in repo so the
# spike + smoke runs are reproducible across sessions.
#
# Modes:
#   * Default (AC1 repro): RL_TEST_SOCKET_HANDLE_AUDIT=false, snapshot dump
#     on first failure, MAX_RUNS=30.
#   * Smoke (AC3): MAX_RUNS=5 RL_TEST_SOCKET_HANDLE_AUDIT=true — audit on,
#     no early-stop on hit so the table shows the full 5 outcomes.
#   * Single-run (Lead-driven outside the 10-min Bash harness window — see
#     ROK-1264 dev-report-park §Blocker B): START_RUN=N MAX_RUNS=1 invokes
#     exactly one iteration labeled as RUN N. Lead drives N tiers from
#     outside, reading $LOG_DIR/table.tsv to stitch the per-tier summary.
#
# Usage:
#   ./scripts/loop-integration.sh                       # 30 runs starting at 1
#   MAX_RUNS=60 ./scripts/loop-integration.sh           # extended search
#   MAX_RUNS=5 RL_TEST_SOCKET_HANDLE_AUDIT=true ./scripts/loop-integration.sh
#   START_RUN=7 MAX_RUNS=1 ./scripts/loop-integration.sh # only RUN 7
#   LOG_DIR=/tmp/rok-1264-runs ./scripts/loop-integration.sh
#
# Exit codes:
#   0 — completed all runs with no socket-RST hit
#   1 — at least one socket hang up / ECONNRESET captured

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/api" || exit 99

LOG_DIR="${LOG_DIR:-/tmp/rok-1264-loop-runs}"
MAX_RUNS="${MAX_RUNS:-30}"
# ROK-1264: single-run mode for Lead-driven per-call invocation. START_RUN
# is the numeric label of the FIRST iteration this invocation runs. Defaults
# to 1 (back-compat with the multi-run mode). Pair with MAX_RUNS=1 to run
# exactly one iteration labeled RUN $START_RUN. The TSV table at
# $LOG_DIR/table.tsv accumulates across invocations.
START_RUN="${START_RUN:-1}"
SNAPSHOT_DIR="$REPO_ROOT/planning-artifacts/test-infra-snapshots"
RUN_TABLE="$LOG_DIR/table.tsv"

# Two modes — the smoke (AC3) run wants the FULL run table, so it must
# not abort on first hit. The AC1 repro is happy to short-circuit once a
# snapshot is captured.
STOP_ON_FIRST_HIT="${STOP_ON_FIRST_HIT:-true}"

# Audit gate from ROK-1250 — keep OFF for AC1 repro so we don't perturb
# teardown timing, but allow opt-in for AC3 smoke validation.
RL_TEST_SOCKET_HANDLE_AUDIT="${RL_TEST_SOCKET_HANDLE_AUDIT:-false}"

# Socket-debug instrumentation: ALWAYS on for this loop. The supertest
# interceptor in socket-debug.ts is what triggers `dumpFailureSnapshot`
# on the trapped `socket hang up` / ECONNRESET promise.
export RL_TEST_SOCKET_DEBUG=true
export RL_TEST_SOCKET_HANDLE_AUDIT

mkdir -p "$LOG_DIR"
mkdir -p "$SNAPSHOT_DIR"
# Initialize run-table on first invocation (single-run mode appends to it
# across calls so Lead can read a stitched summary). Header lines are
# idempotent — only written if the file is fresh.
if [ ! -s "$RUN_TABLE" ]; then
  echo -e "run\tresult\tduration_s\texit_code\tlog" > "$RUN_TABLE"
fi

# Baseline snapshot count — only count NEW snapshots created during this
# loop. Without this, an orphaned snapshot from a prior run would cause
# the first unrelated non-zero exit to be misclassified as a flake repro.
BASELINE_SNAPSHOTS=$(ls "$SNAPSHOT_DIR" 2>/dev/null | grep -c "^snapshot-")

HITS=0
HIT_RUNS=""
HIT_LOGS=""
# ROK-1264: third state — testcontainer port-bind timeouts are NOT
# socket-RST flakes (different carrier entirely), but they DO produce a
# non-zero exit. Without a separate bucket the budget tracker
# misclassifies them as either "pass" (wrong) or "flake hit" (wrong).
# These runs are retried implicitly — they do not count toward MAX_RUNS
# completion.
INCONCLUSIVE=0
INCONCLUSIVE_RUNS=""

# ROK-1264: docker-orphan cleanup helper. Kill leaked pgvector +
# testcontainers-ryuk instances between RUN iterations. Filters by NAME
# (not image-ancestor) so we never collateral-kill `raid-ledger-db`
# which uses the same pgvector image. Name-exclusion is the safe pattern.
cleanup_testcontainer_orphans() {
  docker ps --filter "ancestor=pgvector/pgvector:pg16" --format "{{.Names}}" \
    | grep -v "^raid-ledger" | xargs -r docker kill >/dev/null 2>&1 || true
  docker ps --filter "ancestor=testcontainers/ryuk" --format "{{.Names}}" \
    | grep -v "^raid-ledger" | xargs -r docker kill >/dev/null 2>&1 || true
}

END_RUN=$((START_RUN + MAX_RUNS - 1))
for i in $(seq "$START_RUN" "$END_RUN"); do
  ts=$(date +"%H:%M:%S")
  echo "RUN $i START $ts (audit=$RL_TEST_SOCKET_HANDLE_AUDIT)"
  LOG="$LOG_DIR/run-$i.log"
  start_epoch=$(date +%s)
  npx jest \
    --config jest.integration.config.js \
    --runInBand \
    > "$LOG" 2>&1
  code=$?
  end_epoch=$(date +%s)
  duration=$((end_epoch - start_epoch))
  ts2=$(date +"%H:%M:%S")
  echo "RUN $i exit=$code end=$ts2 duration=${duration}s"

  # Cleanup orphans after every iteration so the next RUN starts from a
  # clean Docker state regardless of jest's outcome. Idempotent.
  cleanup_testcontainer_orphans

  hit=0
  inconclusive=0
  # ROK-1264: extended FLAKE detection — Parse Error / HPE_* errors are
  # in the same TCP-RST class (HTTP parser reading non-HTTP bytes from a
  # stale/half-closed socket). Matches the architect's H2 mechanism.
  if grep -qE "(socket hang up|ECONNRESET|Parse Error: Expected HTTP|HPE_INVALID)" "$LOG"; then
    hit=1
  elif grep -qE "PostgreSqlContainer.start.*Timed out|Timed out after .* while waiting for container ports" "$LOG"; then
    inconclusive=1
  elif [ "$code" -ne 0 ]; then
    current_snapshots=$(ls "$SNAPSHOT_DIR" 2>/dev/null | grep -c "^snapshot-")
    if [ "$current_snapshots" -gt "$BASELINE_SNAPSHOTS" ]; then
      hit=1
      BASELINE_SNAPSHOTS=$current_snapshots
    fi
  fi

  if [ "$hit" -eq 1 ]; then
    result="FLAKE"
    echo "FLAKE_DETECTED run=$i log=$LOG"
    HITS=$((HITS + 1))
    HIT_RUNS="$HIT_RUNS $i"
    HIT_LOGS="$HIT_LOGS $LOG"
  elif [ "$inconclusive" -eq 1 ]; then
    result="INCONCLUSIVE"
    echo "INCONCLUSIVE_TESTCONTAINER_TIMEOUT run=$i log=$LOG (not counted as flake hit OR as clean pass)"
    INCONCLUSIVE=$((INCONCLUSIVE + 1))
    INCONCLUSIVE_RUNS="$INCONCLUSIVE_RUNS $i"
  elif [ "$code" -ne 0 ]; then
    result="NON_FLAKE_FAIL"
    echo "RUN $i non-flake failure (exit=$code) — continuing"
  else
    result="CLEAN"
  fi

  # Append to run-table — one line per iteration. Lead reads this between
  # single-run invocations to track progress across the AC1 budget.
  echo -e "$i\t$result\t$duration\t$code\t$LOG" >> "$RUN_TABLE"

  if [ "$hit" -eq 1 ] && [ "$STOP_ON_FIRST_HIT" = "true" ]; then
    break
  fi
done

echo "---"
if [ "$HITS" -gt 0 ]; then
  echo "DONE hits=$HITS runs_hit=$HIT_RUNS inconclusive=$INCONCLUSIVE inconclusive_runs=$INCONCLUSIVE_RUNS"
  echo "logs:$HIT_LOGS"
  ls -la "$SNAPSHOT_DIR/" 2>/dev/null | tail -5
  exit 1
else
  echo "DONE hits=0 runs=$MAX_RUNS inconclusive=$INCONCLUSIVE inconclusive_runs=$INCONCLUSIVE_RUNS"
  exit 0
fi
