#!/bin/bash
# =============================================================================
# backup-restore-drill.sh - ROK-1160 weekly backup restore drill (slice A)
# =============================================================================
# Restores a daily backup into a THROWAWAY Postgres container, reconciles the
# migration journal, runs the five assertion tiers (A1-A5), optionally boots
# the API against the result, and writes restore-drill-report.json.
#
# WHY `reconcile-migrations.mjs` AND NOT `runMigrations` (D4 / RULING 1) --
# DO NOT "FIX" THIS BACK TO THE PROGRAMMATIC MIGRATOR:
#   Every dump carries `--exclude-schema=drizzle` (backup.helpers.ts:35,69 --
#   ROK-1413), so a restored database has ZERO rows in
#   `drizzle.__drizzle_migrations`. `runMigrations` (backup.helpers.ts:198) ->
#   `runBootMigrations` would therefore see nothing applied, start at 0001
#   against an already-populated `public` schema, and die on the first
#   `CREATE TABLE` with "relation already exists" -- a guaranteed weekly false
#   failure. `scripts/reconcile-migrations.mjs` is a DIFFERENT tool, built for
#   exactly this case (its own header, :13-16): it probes each statement in a
#   savepoint and treats "already exists" codes as skip-ok. Exit 0 is asserted;
#   exit 1 (real non-idempotent drift) and exit 2 (bad input -- a harness bug,
#   not a backup defect) are reported distinctly.
#
# Usage:
#   ./scripts/backup-restore-drill.sh --dump-file <path/to.dump> [options]
#     --report <path>   report JSON destination (default restore-drill-report.json)
#     --boot-check      boot the API against the restored DB and assert /api/health
#     --keep            leave the container running (debugging)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

CONTAINER_NAME="rl-restore-drill-$$"
DRILL_IMAGE="pgvector/pgvector:pg16"
DRILL_DB_NAME="raid_ledger"
DUMP_FILE=""
REPORT_PATH="$REPO_ROOT/restore-drill-report.json"
BOOT_CHECK=0
KEEP=0
META_FILE=""
START_EPOCH_MS=$(( $(date +%s) * 1000 ))

cleanup() {
  [ -n "$META_FILE" ] && rm -f "$META_FILE"
  if [ "$KEEP" = "1" ]; then return 0; fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dump-file) DUMP_FILE="$2"; shift 2 ;;
      --report) REPORT_PATH="$2"; shift 2 ;;
      --boot-check) BOOT_CHECK=1; shift ;;
      --keep) KEEP=1; shift ;;
      *) echo -e "${RED}Unknown argument: $1${NC}" >&2; exit 2 ;;
    esac
  done
  if [ -z "$DUMP_FILE" ]; then
    # SLICE-B/C SEAM: fetching the newest daily dump over the admin HTTPS API
    # (D3) is blocked on flag 1 (the operator's credential decision). Until
    # then the drill is driven with an explicit --dump-file, which is also how
    # the corruption path (T-C2) is exercised.
    echo -e "${RED}--dump-file is required (D3 fetch is slice C, flag 1)${NC}" >&2
    exit 2
  fi
  [ -f "$DUMP_FILE" ] || { echo -e "${RED}No such dump: $DUMP_FILE${NC}" >&2; exit 2; }
}

# A1 runs BEFORE any container work, so a bad archive costs nothing.
run_archive_check() {
  echo -e "${YELLOW}A1: checking archive integrity...${NC}"
  if ! pg_restore --list "$DUMP_FILE" > /tmp/rl-drill-toc.txt 2>/tmp/rl-drill-toc.err; then
    ARCHIVE_DETAIL="pg_restore --list failed: $(tr '\n' ' ' < /tmp/rl-drill-toc.err)"
    return 1
  fi
  local entries
  entries=$(grep -c 'TABLE DATA' /tmp/rl-drill-toc.txt || true)
  if [ "$entries" -lt 20 ]; then
    ARCHIVE_DETAIL="archive TOC lists $entries TABLE DATA entries, expected >= 20"
    return 1
  fi
  ARCHIVE_DETAIL="$entries TABLE DATA entries"
}

start_postgres() {
  echo -e "${YELLOW}Starting throwaway Postgres ($DRILL_IMAGE)...${NC}"
  docker run --rm -d --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=user -e POSTGRES_PASSWORD=password \
    -e "POSTGRES_DB=$DRILL_DB_NAME" -p 0:5432 "$DRILL_IMAGE" >/dev/null
}

get_mapped_port() { docker port "$CONTAINER_NAME" 5432 | head -1 | sed 's/.*://'; }

# Polls a real query, not pg_isready: pg_isready reports ready against the
# socket-only bootstrap server BEFORE the init scripts create POSTGRES_DB.
# Copied deliberately from validate-migrations.sh:72-82 (D2) -- re-deriving it
# reintroduces a race that was already solved there.
wait_for_postgres() {
  local elapsed=0
  while ! docker exec -e PGPASSWORD=password "$CONTAINER_NAME" \
    psql -h 127.0.0.1 -U user -d "$DRILL_DB_NAME" -c 'SELECT 1' >/dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge 60 ]; then
      echo -e "${RED}Postgres did not become ready within 60s${NC}" >&2
      return 1
    fi
  done
  echo -e "${GREEN}Postgres ready after ${elapsed}s${NC}"
}

# D11 rails, evaluated BEFORE any DDL. Delegated to the node module so the
# shell and the unit spec (T-U7) share one implementation.
assert_rails() {
  RL_DRILL_URL="$DRILL_URL" RL_DRILL_DB="$DRILL_DB_NAME" \
    RL_DRILL_MODULE="$REPO_ROOT/scripts/restore-drill-assertions.mjs" \
    node --input-type=module -e '
      const m = await import(process.env.RL_DRILL_MODULE);
      m.assertRails({
        databaseUrl: process.env.RL_DRILL_URL,
        dbName: process.env.RL_DRILL_DB,
      });
    '
}

# D5: the pass criterion is the stderr classifier, NOT pg_restore's exit
# status. `isRestoreFatal` (backup.helpers.ts:145) already waves through
# "errors ignored on restore"; inheriting that tolerance builds a drill that
# passes without really restoring. Arg list mirrors pgRestoreArgs :63 exactly.
#
# T-I7 measured (2026-09-12, pgvector/pgvector:pg16 = PostgreSQL 16.13): a
# HOST pg_restore 18 against that server exits 1 and emits exactly one
# `pg_restore: error:` line — `unrecognized configuration parameter
# "transaction_timeout"`, from the `SET transaction_timeout = 0` that clients
# >= 17 prepend. That is pure client/server version skew, and allowlisting it
# would blind the classifier to real skew. So the drill restores with the
# CONTAINER's own pg_restore (same shape as `runPgRestoreDocker`,
# backup.helpers.ts:120-142), which makes client major == server major by
# construction and needs no allowlist entry at all.
run_restore() {
  echo -e "${YELLOW}Restoring dump...${NC}"
  RESTORE_START=$(date +%s)
  docker cp "$DUMP_FILE" "$CONTAINER_NAME:/tmp/drill.dump" >/dev/null
  set +e
  docker exec "$CONTAINER_NAME" pg_restore --clean --if-exists --no-owner \
    --no-privileges --exclude-schema=drizzle \
    --dbname="postgresql://user:password@127.0.0.1:5432/${DRILL_DB_NAME}" \
    /tmp/drill.dump >/tmp/rl-drill-restore.out 2>/tmp/rl-drill-restore.err
  RESTORE_EXIT=$?
  set -e
  RESTORE_MS=$(( ($(date +%s) - RESTORE_START) * 1000 ))
  echo -e "  pg_restore exit=${RESTORE_EXIT} (informational; classifier decides)"
  RESTORE_FATAL="$(grep 'pg_restore: error:' /tmp/rl-drill-restore.err || true)"
  if [ -n "$RESTORE_FATAL" ]; then
    echo -e "${RED}pg_restore emitted error lines:${NC}" >&2
    echo "$RESTORE_FATAL" >&2
    return 1
  fi
}

# D4 -- see the header. Exit 1 and exit 2 are reported distinctly.
run_reconcile() {
  echo -e "${YELLOW}Reconciling migration journal...${NC}"
  RECONCILE_START=$(date +%s)
  set +e
  DATABASE_URL="$DRILL_URL" node "$REPO_ROOT/scripts/reconcile-migrations.mjs" \
    >/tmp/rl-drill-reconcile.out 2>&1
  RECONCILE_EXIT=$?
  set -e
  RECONCILE_MS=$(( ($(date +%s) - RECONCILE_START) * 1000 ))
  case "$RECONCILE_EXIT" in
    0) RECONCILE_DETAIL="reconcile exited 0" ;;
    1) RECONCILE_DETAIL="reconcile exited 1 — non-idempotent migration drift" ;;
    2) RECONCILE_DETAIL="reconcile exited 2 — bad input (drill-harness bug)" ;;
    *) RECONCILE_DETAIL="reconcile exited $RECONCILE_EXIT — unexpected" ;;
  esac
  [ "$RECONCILE_EXIT" = "0" ] || tail -30 /tmp/rl-drill-reconcile.out >&2
}

json_finding() {
  printf '{"id":"%s","tier":"%s","status":"%s","detail":"%s"}' \
    "$1" "$2" "$3" "$(printf '%s' "$4" | tr -d '"' | tr '\n' ' ')"
}

# D7. Slice A leaves this opt-in: without --boot-check the tier is recorded as
# informational rather than silently claimed. T-I8 is assigned to slice C.
boot_api_check() {
  BOOT_MS=0
  if [ "$BOOT_CHECK" != "1" ]; then
    BOOT_FINDING="$(json_finding boot-health boot informational 'skipped (no --boot-check)')"
    return 0
  fi
  local start; start=$(date +%s); local elapsed=0
  DATABASE_URL="$DRILL_URL" node "$REPO_ROOT/api/dist/main.js" >/tmp/rl-drill-boot.log 2>&1 &
  local pid=$!
  while ! curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; do
    sleep 1; elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge 90 ] || ! kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      BOOT_FINDING="$(json_finding boot-health boot failed "$(tail -20 /tmp/rl-drill-boot.log)")"
      BOOT_MS=$(( ($(date +%s) - start) * 1000 ))
      return 0
    fi
  done
  kill "$pid" 2>/dev/null || true
  BOOT_MS=$(( ($(date +%s) - start) * 1000 ))
  BOOT_FINDING="$(json_finding boot-health boot passed 'GET /api/health returned 200')"
}

# The report body both emitters share. `$4` appends the fields the node CLI
# would otherwise add (finishedAt/status); only the failure path passes it.
write_report_body() {
  local a1_status="$1" reconcile_status="$2" dest="$3" extra="${4:-}"
  {
    printf '{"startedAt":"%s","dumpFilename":"%s","dumpSizeBytes":%s,' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$DUMP_FILE")" \
      "$(wc -c < "$DUMP_FILE" | tr -d ' ')"
    printf '"dumpTakenAt":null,"stale":false,"error":null,'
    printf '"restoreDurationMs":%s,"reconcileDurationMs":%s,"bootDurationMs":%s,"totalDurationMs":%s,' \
      "${RESTORE_MS:-0}" "${RECONCILE_MS:-0}" "${BOOT_MS:-0}" \
      "$(( $(date +%s) * 1000 - START_EPOCH_MS ))"
    printf '"findings":[%s,%s,%s]%s}' \
      "$(json_finding a1-toc-entries A1 "$a1_status" "$ARCHIVE_DETAIL")" \
      "$(json_finding reconcile-exit reconcile "$reconcile_status" "$RECONCILE_DETAIL")" \
      "$BOOT_FINDING" "$extra"
  } > "$dest"
}

# Step 15. The node CLI appends the database tiers and decides the status.
emit_report() {
  META_FILE="$(mktemp -t rl-drill-meta)"
  write_report_body "$1" "$2" "$META_FILE"
  node "$REPO_ROOT/scripts/restore-drill-assertions.mjs" \
    --meta "$META_FILE" --out "$REPORT_PATH" --database-url "$DRILL_URL" \
    --schema-dir "$REPO_ROOT/api/src/drizzle/schema"
}

# A1 fails BEFORE any container exists, so the node CLI cannot be the emitter
# here -- it needs a live --database-url for the database tiers. Writing the
# body plus finishedAt/status straight to --report is what makes AC3's "the
# report's status is failed" reachable on the failure path (T-C2); without it
# main() exited with nothing but a log line. The later tiers were never reached,
# so they contribute no findings rather than fake `passed` ones.
emit_failure_report() {
  RECONCILE_DETAIL="not reached — A1 failed before the container started"
  BOOT_FINDING="$(json_finding boot-health boot informational 'not reached (A1 failed)')"
  write_report_body failed informational "$REPORT_PATH" \
    ",\"finishedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"failed\""
}

main() {
  trap cleanup EXIT
  parse_args "$@"

  if ! run_archive_check; then
    echo -e "${RED}DRILL FAILED (A1): $ARCHIVE_DETAIL${NC}" >&2
    emit_failure_report
    echo -e "${RED}Failure report at $REPORT_PATH${NC}" >&2
    exit 1
  fi

  start_postgres
  local port; port="$(get_mapped_port)"
  DRILL_URL="postgresql://user:password@127.0.0.1:${port}/${DRILL_DB_NAME}"
  wait_for_postgres
  assert_rails

  if ! run_restore; then
    echo -e "${RED}DRILL FAILED (D5 classifier): $RESTORE_FATAL${NC}" >&2
    exit 1
  fi
  run_reconcile
  boot_api_check

  local reconcile_status="failed"
  [ "$RECONCILE_EXIT" = "0" ] && reconcile_status="passed"

  emit_report passed "$reconcile_status"
  echo -e "${GREEN}DRILL PASSED — report at $REPORT_PATH${NC}"
}

main "$@"
