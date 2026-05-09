#!/usr/bin/env bash
# Reproduce the rotating-suite `socket hang up` / ECONNRESET flake.
# Runs the integration suite repeatedly with RL_TEST_SOCKET_DEBUG=true
# until a flake hits or MAX_RUNS iterations are exhausted. On hit, the
# snapshot is written automatically by the dump-failure-snapshot helper
# and this script exits with the failing run's log path printed.
#
# Usage:
#   ./scripts/repro-test-infra-flake.sh                # 20 runs
#   MAX_RUNS=30 ./scripts/repro-test-infra-flake.sh    # 30 runs
#   LOG_DIR=/tmp/my-runs ./scripts/repro-test-infra-flake.sh
#
# Origin: ROK-1249 spike. See docs/spikes/rok-1249-test-infra-layer-3.md
# for the named carrier and the analysis pattern.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/api" || exit 99

LOG_DIR="${LOG_DIR:-/tmp/rok-test-infra-flake-runs}"
MAX_RUNS="${MAX_RUNS:-20}"
SNAPSHOT_DIR="$REPO_ROOT/planning-artifacts/test-infra-snapshots"

mkdir -p "$LOG_DIR"

HIT=0
HIT_RUN=""
HIT_LOG=""

for i in $(seq 1 "$MAX_RUNS"); do
  ts=$(date +"%H:%M:%S")
  echo "RUN $i START $ts"
  LOG="$LOG_DIR/run-$i.log"
  RL_TEST_SOCKET_DEBUG=true npx jest \
    --config jest.integration.config.js \
    --runInBand --detectOpenHandles \
    > "$LOG" 2>&1
  code=$?
  ts2=$(date +"%H:%M:%S")
  echo "RUN $i exit=$code end=$ts2"

  if grep -qE "(socket hang up|ECONNRESET)" "$LOG"; then
    echo "FLAKE_DETECTED run=$i log=$LOG"
    HIT=1
    HIT_RUN=$i
    HIT_LOG="$LOG"
    break
  fi

  if [ "$code" -ne 0 ]; then
    if ls "$SNAPSHOT_DIR" 2>/dev/null | grep -q "snapshot-"; then
      echo "FLAKE_DETECTED_VIA_SNAPSHOT run=$i log=$LOG"
      HIT=1
      HIT_RUN=$i
      HIT_LOG="$LOG"
      break
    fi
    echo "RUN $i non-flake failure (exit=$code) — continuing"
  fi
done

if [ "$HIT" -eq 1 ]; then
  echo "DONE hit=true run=$HIT_RUN log=$HIT_LOG"
  ls -la "$SNAPSHOT_DIR/" 2>/dev/null | tail -3
  exit 1
else
  echo "DONE hit=false runs=$MAX_RUNS"
  exit 0
fi
