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
#
# Usage:
#   ./scripts/loop-integration.sh                       # 30 runs
#   MAX_RUNS=60 ./scripts/loop-integration.sh           # extended search
#   MAX_RUNS=5 RL_TEST_SOCKET_HANDLE_AUDIT=true ./scripts/loop-integration.sh
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
SNAPSHOT_DIR="$REPO_ROOT/planning-artifacts/test-infra-snapshots"

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

# Baseline snapshot count — only count NEW snapshots created during this
# loop. Without this, an orphaned snapshot from a prior run would cause
# the first unrelated non-zero exit to be misclassified as a flake repro.
BASELINE_SNAPSHOTS=$(ls "$SNAPSHOT_DIR" 2>/dev/null | grep -c "^snapshot-")

HITS=0
HIT_RUNS=""
HIT_LOGS=""

for i in $(seq 1 "$MAX_RUNS"); do
  ts=$(date +"%H:%M:%S")
  echo "RUN $i START $ts (audit=$RL_TEST_SOCKET_HANDLE_AUDIT)"
  LOG="$LOG_DIR/run-$i.log"
  npx jest \
    --config jest.integration.config.js \
    --runInBand \
    > "$LOG" 2>&1
  code=$?
  ts2=$(date +"%H:%M:%S")
  echo "RUN $i exit=$code end=$ts2"

  hit=0
  if grep -qE "(socket hang up|ECONNRESET)" "$LOG"; then
    hit=1
  elif [ "$code" -ne 0 ]; then
    current_snapshots=$(ls "$SNAPSHOT_DIR" 2>/dev/null | grep -c "^snapshot-")
    if [ "$current_snapshots" -gt "$BASELINE_SNAPSHOTS" ]; then
      hit=1
      BASELINE_SNAPSHOTS=$current_snapshots
    fi
  fi

  if [ "$hit" -eq 1 ]; then
    echo "FLAKE_DETECTED run=$i log=$LOG"
    HITS=$((HITS + 1))
    HIT_RUNS="$HIT_RUNS $i"
    HIT_LOGS="$HIT_LOGS $LOG"
    if [ "$STOP_ON_FIRST_HIT" = "true" ]; then
      break
    fi
  elif [ "$code" -ne 0 ]; then
    echo "RUN $i non-flake failure (exit=$code) — continuing"
  fi
done

echo "---"
if [ "$HITS" -gt 0 ]; then
  echo "DONE hits=$HITS runs_hit=$HIT_RUNS"
  echo "logs:$HIT_LOGS"
  ls -la "$SNAPSHOT_DIR/" 2>/dev/null | tail -5
  exit 1
else
  echo "DONE hits=0 runs=$MAX_RUNS"
  exit 0
fi
