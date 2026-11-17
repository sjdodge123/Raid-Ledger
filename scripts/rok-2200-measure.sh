#!/usr/bin/env bash
# ROK-2200 spike measurement (fleet runner only). Phases, in order:
#   full1 — whole integration suite, 1 worker (today's default)
#   full2 — whole integration suite, RL_INTEGRATION_WORKERS=2 (per-worker DBs)
#   loop  — spec-loop.sh 50x over the socket-heavy carrier set at 2 workers
# Usage: scripts/rok-2200-measure.sh [phase ...]   (default: full1 full2 loop)
# Results: /workspace/.rok2200/RESULTS.txt (+ per-phase logs).
set -u
OUT=/workspace/.rok2200
mkdir -p "$OUT"
TAG="rok2200-$$"
docker run -d --rm --network=rl-net --name "$TAG-redis" redis:7-alpine >/dev/null
docker run -d --rm --network=rl-net --name "$TAG-pg" -e POSTGRES_USER=test \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rl_test pgvector/pgvector:pg16 >/dev/null
trap 'docker rm -f "$TAG-redis" "$TAG-pg" >/dev/null 2>&1' EXIT
for _ in $(seq 1 60); do
  docker exec "$TAG-pg" pg_isready -U test -d rl_test >/dev/null 2>&1 && break
  sleep 1
done
export CI=true
export DATABASE_URL="postgres://test:test@$TAG-pg:5432/rl_test"
export REDIS_URL="redis://$TAG-redis:6379"
cd /workspace/api || exit 99
echo "nproc=$(nproc) node=$(node -v)" | tee -a "$OUT/RESULTS.txt"

run_full() { # $1 = label, $2 = workers
  local s e
  s=$(date +%s)
  RL_INTEGRATION_WORKERS="$2" npx jest --config jest.integration.config.js \
    > "$OUT/$1.log" 2>&1
  local ec=$?
  e=$(date +%s)
  {
    echo "== $1 workers=$2 exit=$ec wall=$((e - s))s"
    grep -E '^(Test Suites|Tests|Time):' "$OUT/$1.log"
    echo "failed suites:"; grep -E '^FAIL ' "$OUT/$1.log" | sort -u
    echo "flake-class lines: $(grep -cE 'socket hang up|ECONNRESET|Parse Error|HPE_' "$OUT/$1.log")"
  } | tee -a "$OUT/RESULTS.txt"
}

CARRIERS='processors/embed-sync\.integration|events/signups-embed-sync\.integration|events/events\.integration|testing/integration-teardown\.integration|testing/cross-suite-state\.integration|testing/bullmq-leak-|events/series-signups-race\.integration|events/signups-flows\.integration'

run_loop() {
  rm -rf "$OUT/loop"
  RL_INTEGRATION_WORKERS=2 SPEC_LOOP_JEST_ARGS="--maxWorkers=2" \
    LOG_DIR="$OUT/loop" bash /workspace/scripts/spec-loop.sh "$CARRIERS" "${LOOP_N:-50}" false \
    > "$OUT/loop.out" 2>&1
  {
    echo "== loop (2 workers, N=${LOOP_N:-50}) carriers=$CARRIERS"
    tail -5 "$OUT/loop.out"
    echo "suites per run (run 1): $(grep -E '^Test Suites:' "$OUT/loop/run-1.log")"
    echo "failing runs:"; awk -F'\t' 'NR>1 && ($2!="0" || $4!="0")' "$OUT/loop/summary.tsv"
    echo "failing tests (verbatim):"; grep -hE '^\s+● ' "$OUT"/loop/run-*.log | sort | uniq -c | head -40
  } | tee -a "$OUT/RESULTS.txt"
}

PHASES=("$@"); [ ${#PHASES[@]} -eq 0 ] && PHASES=(full1 full2 loop)
for phase in "${PHASES[@]}"; do
  case "$phase" in
    full1) run_full full1 1 ;;
    full2) run_full full2 2 ;;
    loop) run_loop ;;
    *) echo "unknown phase $phase" ;;
  esac
done
echo "== DONE $(date -u)" | tee -a "$OUT/RESULTS.txt"
