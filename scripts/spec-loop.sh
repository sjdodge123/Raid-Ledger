#!/usr/bin/env bash
# Cheap validation harness — run a single Jest integration spec N times and
# tabulate results. Designed for the "cheap experiments first" workflow:
# reproduce a flake with confidence, validate a fix, A/B a config change,
# or falsify a hypothesis BEFORE paying for a full 7-minute integration run.
#
# Pattern emerged from ROK-1264's Tier-1 investigation (see
# docs/spikes/rok-1250-residual-layer-5.md). Single-file isolation is
# 7-15 seconds per run vs ~7 minutes for the full suite, so 50 iterations
# fit comfortably in one Bash window with deterministic flake-class signal.
#
# Usage:
#   ./scripts/spec-loop.sh <spec-pattern> [N] [STOP_ON_FIRST=true|false]
#
# Examples:
#   ./scripts/spec-loop.sh lineups-voting              # 50 runs, stop on first flake
#   ./scripts/spec-loop.sh events.integration 10       # 10 runs of events spec
#   ./scripts/spec-loop.sh feedback 30 false           # 30 runs, no early stop
#   N=5 ./scripts/spec-loop.sh lineups-voting          # env override for N
#
# Arguments:
#   spec-pattern    Passed to `jest --testPathPatterns=<pattern>`. Matches
#                   any file name containing the pattern.
#   N               Iteration count (default 50; env: N).
#   STOP_ON_FIRST   true/false (default true). Break on first non-zero exit
#                   OR first flake-class match.
#
# Flake-class patterns matched in each run's log:
#   socket hang up | ECONNRESET | Parse Error | HPE_*
# (Mirrors `api/src/common/testing/socket-debug.ts::isFlakeError`.)
#
# Output:
#   $LOG_DIR/spec-loop-<pattern>-<ts>/
#     run-<N>.log    — full jest stdout/stderr per iteration
#     summary.tsv    — run<TAB>exit<TAB>wallclock_s<TAB>flake_count<TAB>excerpt
#
# Exit codes:
#   0 — all iterations clean (zero exit, zero flake matches)
#   1 — at least one iteration produced a flake-class match or non-zero exit
#   2 — argument error

set -u

if [ $# -lt 1 ]; then
  echo "usage: $0 <spec-pattern> [N] [STOP_ON_FIRST=true|false]" >&2
  echo "       e.g. $0 lineups-voting 50" >&2
  exit 2
fi

SPEC_PATTERN="$1"
N="${2:-${N:-50}}"
STOP_ON_FIRST="${3:-${STOP_ON_FIRST:-true}}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/api" || exit 99

TS="$(date +%Y%m%d-%H%M%S)"
SAFE_PATTERN="$(echo "$SPEC_PATTERN" | tr '/' '_' | tr -c 'a-zA-Z0-9._-' '_')"
LOG_DIR_DEFAULT="/tmp/spec-loop-${SAFE_PATTERN}-${TS}"
LOG_DIR="${LOG_DIR:-$LOG_DIR_DEFAULT}"
mkdir -p "$LOG_DIR"

SUMMARY="$LOG_DIR/summary.tsv"
printf "run\texit\twallclock_s\tflake_count\tflake_excerpt\n" > "$SUMMARY"

FLAKE_REGEX='(socket hang up|ECONNRESET|Parse Error|HPE_)'

echo "spec-loop: pattern='$SPEC_PATTERN' N=$N stop_on_first=$STOP_ON_FIRST"
echo "spec-loop: logs -> $LOG_DIR"

any_fail=0
for i in $(seq 1 "$N"); do
  start=$(date +%s)
  log="$LOG_DIR/run-${i}.log"
  npx jest --config jest.integration.config.js --runInBand \
    --testPathPatterns="$SPEC_PATTERN" > "$log" 2>&1
  ec=$?
  end=$(date +%s)
  dur=$((end - start))
  # grep -c prints the count to stdout regardless of exit; capture it cleanly.
  flakes=$(grep -cE "$FLAKE_REGEX" "$log" 2>/dev/null) || true
  flakes="${flakes:-0}"
  excerpt=""
  if [ "$flakes" -gt 0 ]; then
    excerpt=$(grep -m 1 -E "$FLAKE_REGEX" "$log" | head -c 180 | tr '\t' ' ')
  fi
  printf "%d\t%d\t%d\t%d\t%s\n" "$i" "$ec" "$dur" "$flakes" "${excerpt:-NONE}" >> "$SUMMARY"
  printf "RUN %d/%d ec=%d dur=%ds flakes=%d\n" "$i" "$N" "$ec" "$dur" "$flakes"

  if [ "$ec" -ne 0 ] || [ "$flakes" -gt 0 ]; then
    any_fail=1
    if [ "$STOP_ON_FIRST" = "true" ]; then
      echo "spec-loop: STOP_ON_FIRST hit at run $i"
      break
    fi
  fi
done

echo "=== DONE ==="
awk -F'\t' 'NR>1' "$SUMMARY" | wc -l | awk '{print "ran",$1,"iterations"}'
awk -F'\t' 'NR>1 && $4 != "0" && $4 != "" {n++} END {print "flake hits:", n+0}' "$SUMMARY"
awk -F'\t' 'NR>1 && $2 != "0" {n++} END {print "non-zero exits:", n+0}' "$SUMMARY"
echo "summary: $SUMMARY"

exit "$any_fail"
