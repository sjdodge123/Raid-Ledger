#!/usr/bin/env bash
# =============================================================================
# clone-prod-measure-migration.sh — measure a branch migration's effect on
# prod-shaped data WITHOUT touching the local DB (ROK-2263, decision D12).
#
#   ./scripts/clone-prod-measure-migration.sh --dump <file|latest> \
#       --migration <tag> --query <sql> [--query <sql> …] [--tree <path>]
#
# 1. Creates a per-run scratch DB rl_clone_scratch_<pid>_<epoch> in the container
#    (never the DB in DATABASE_URL) and restores the dump into it WITH its
#    migration journal.
# 2. Refuses when <tag> is already in the dump's journal, is missing from the
#    tree's journal, or uses CONCURRENTLY (cannot run in a transaction).
#    Warns when <tag> is older than prod's newest applied migration — drizzle's
#    migrator would skip it on prod.
# 3. Applies (committed) the tree's earlier migrations the dump lacks.
# 4. One psql session: BEGIN; <queries>; <tag>.sql; <queries>; ROLLBACK;
# 5. Prints {migration, before:[{sql,rows}], after:[…], pending_applied,
#    warnings, error?} on stdout and drops the scratch DB.
#
# --dump latest downloads prod's newest daily backup (read-only GETs, needs
# PROD_BACKUP_TOKEN in the clone env file — see clone-prod-to-local.sh --help).
# --tree defaults to the git top-level of $PWD; its api/src/drizzle/migrations
# supplies <tag>.sql and the journal. DATABASE_URL comes from the environment,
# else from the clone env file; it must point at localhost.
# Exit: 0 measured · 1 failure · 2 usage · 3 refused.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/clone-prod-env.sh
source "$SCRIPT_DIR/lib/clone-prod-env.sh"
MEASURE="$SCRIPT_DIR/lib/clone-prod-measure.mjs"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi

WORK_DIR="$(mktemp -d)"
# Unique per run so parallel runs never drop each other's DB (review fix B10).
SCRATCH_NAME="rl_clone_scratch_$$_$(date +%s)"
SCRATCH_CREATED=""
cleanup() {
    if [[ -n "$SCRATCH_CREATED" ]]; then
        admin_sql "DROP DATABASE IF EXISTS \"$SCRATCH_NAME\"" >/dev/null 2>&1 || true
        db_exec rm -f "$CONTAINER_DUMP" >/dev/null 2>&1 || true
    fi
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT
CONFIG="$WORK_DIR/config.json"
node "$MEASURE" parse-args "$@" >"$CONFIG" || exit 2

cfg() { jq -r ".$1" "$CONFIG"; }
DUMP="$(cfg dump)"
MIGRATION="$(cfg migration)"
TREE="$(cfg tree)"
[[ -n "$TREE" ]] || TREE="$(clone_env_default_tree)"
[[ -n "$TREE" ]] || { clone_env_err "not inside a git checkout; pass --tree <path>"; exit 2; }
MIGRATIONS_DIR="$TREE/api/src/drizzle/migrations"
[[ -f "$MIGRATIONS_DIR/$MIGRATION.sql" ]] \
    || { clone_env_err "no $MIGRATION.sql under $MIGRATIONS_DIR"; exit 2; }

ENV_FILE=""
load_clone_env() {
    [[ -n "$ENV_FILE" ]] && return 0
    ENV_FILE="$(clone_env_resolve_file "$TREE")" || exit 1
    clone_env_load "$ENV_FILE"
}
[[ -n "${DATABASE_URL:-}" ]] || load_clone_env
[[ -n "${DATABASE_URL:-}" ]] || { clone_env_err "DATABASE_URL is not set"; exit 1; }
if ! [[ "$DATABASE_URL" =~ ^postgres(ql)?://([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/ ]]; then
    clone_env_err "DATABASE_URL must point at localhost/127.0.0.1/::1 (host redacted)."
    exit 1
fi
SCRATCH_URL="$(node "$MEASURE" scratch-url "$DATABASE_URL" "$SCRATCH_NAME")" || exit 2
: "${LOCAL_DB_CONTAINER:=raid-ledger-db}"
CONTAINER_DUMP="/tmp/rl-measure-$$.dump"

db_exec() { docker exec "$LOCAL_DB_CONTAINER" "$@"; }
admin_sql() { db_exec psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX -c "$1"; }
scratch_sql() { db_exec psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -qtAX -c "$1"; }
scratch_file() { docker exec -i "$LOCAL_DB_CONTAINER" psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -qtAX "$@"; }

if [[ "$(docker inspect -f '{{.State.Running}}' "$LOCAL_DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
    clone_env_err "Postgres container '$LOCAL_DB_CONTAINER' is not running (./scripts/deploy_dev.sh --ci)."
    exit 1
fi

# --dump latest: read-only download of prod's newest daily backup.
download_latest() {
    load_clone_env
    [[ -n "${PROD_URL:-}" ]] || { clone_env_err "PROD_URL is not set in $ENV_FILE"; exit 1; }
    clone_env_select_auth || exit 1
    if [[ "$CLONE_AUTH_MODE" != "token" ]]; then
        clone_env_err "--dump latest needs PROD_BACKUP_TOKEN (or pass --dump <file>)"
        exit 1
    fi
    local hdr="$WORK_DIR/auth.header" list name
    clone_env_write_auth_header "$hdr"
    list="$(prod_get_safe /admin/backups -H "@$hdr")" \
        || { clone_env_err "GET /admin/backups failed"; exit 1; }
    name="$(printf '%s' "$list" | jq -r \
        '[.backups[] | select(.type=="daily")] | sort_by(.createdAt) | reverse | .[0].filename // empty')"
    [[ "$name" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || { clone_env_err "no daily backup on prod"; exit 1; }
    prod_get_safe "/admin/backups/daily/$name/download" -H "@$hdr" -o "$WORK_DIR/latest.dump" \
        || { clone_env_err "download of $name failed"; exit 1; }
    printf '%s\n' "$WORK_DIR/latest.dump"
}
[[ "$DUMP" == "latest" ]] && DUMP="$(download_latest)"
[[ -f "$DUMP" ]] || { clone_env_err "dump file not found: $DUMP"; exit 2; }

# 1. Scratch DB + restore WITH the journal.
echo "Restoring $(basename "$DUMP") into scratch DB $SCRATCH_NAME ..." >&2
SCRATCH_CREATED=1
admin_sql "CREATE DATABASE \"$SCRATCH_NAME\"" >/dev/null
docker cp "$DUMP" "$LOCAL_DB_CONTAINER:$CONTAINER_DUMP" >/dev/null
# Any pg_restore error refuses: a half-restored scratch DB measures nonsense (B3).
if ! clone_env_restore_fresh "$LOCAL_DB_CONTAINER" "$SCRATCH_URL" "$CONTAINER_DUMP" "$WORK_DIR/restore.err"; then
    cat "$WORK_DIR/restore.err" >&2
    clone_env_err "pg_restore into the scratch DB failed; refusing to measure a partial restore"
    exit 1
fi

# 2. Plan against the dump's journal.
[[ "$(scratch_sql "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL")" == "t" ]] \
    || { clone_env_err "the dump has no drizzle.__drizzle_migrations journal"; exit 1; }
scratch_sql "SELECT coalesce(json_agg(json_build_object('hash', hash, 'created_at', created_at)), '[]'::json)
             FROM drizzle.__drizzle_migrations" >"$WORK_DIR/applied.json"
PLAN="$WORK_DIR/plan.json"
plan_code=0
node "$MEASURE" plan "$CONFIG" "$MIGRATIONS_DIR" "$WORK_DIR/applied.json" >"$PLAN" || plan_code=$?
if [[ "$plan_code" -ne 0 ]]; then
    jq -c --arg m "$MIGRATION" '{migration: $m, error: (.error // "plan failed")}' "$PLAN" 2>/dev/null \
        || echo "{\"migration\":\"$MIGRATION\",\"error\":\"plan failed\"}"
    exit "$plan_code"
fi
jq -r '.warnings[]' "$PLAN" | while IFS= read -r w; do clone_env_warn "$w"; done

# 3. Earlier tree migrations the dump lacks — committed, scratch DB only.
for tag in $(jq -r '.pending[]' "$PLAN"); do
    echo "Applying pending $tag ..." >&2
    scratch_file <"$MIGRATIONS_DIR/$tag.sql" >/dev/null || { clone_env_err "pending $tag failed"; exit 1; }
done

# 4. The measured session, rolled back.
node "$MEASURE" script "$CONFIG" "$MIGRATIONS_DIR" >"$WORK_DIR/measure.sql"
psql_code=0
scratch_file <"$WORK_DIR/measure.sql" >"$WORK_DIR/measure.out" 2>"$WORK_DIR/measure.err" || psql_code=$?

# 5. Report (cleanup drops the scratch DB).
node "$MEASURE" report "$CONFIG" "$PLAN" "$WORK_DIR/measure.out" "$WORK_DIR/measure.err" "$psql_code"
[[ "$psql_code" -eq 0 ]] || exit 1
