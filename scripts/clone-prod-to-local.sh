#!/usr/bin/env bash
# =============================================================================
# clone-prod-to-local.sh - Sanitized prod -> local DB clone (ROK-1279, ROK-2263)
# =============================================================================
# Triggers a sanitized backup on prod, downloads it to a temp dir, and restores
# it STRAIGHT INTO the local Postgres container with pg_restore (no local API,
# no local login). Then resets the local admin password. Preserves local
# app_settings (API keys) across the clone unless explicitly disabled.
#
# Sanitization (server-side, baked into BackupService) excludes ROW DATA for:
#   app_settings, local_credentials, sessions, consumed_intent_tokens,
#   backup_export_tokens
# Schema is preserved, rows are empty after restore.
#
# Migration journal (ROK-2263 D11): the restore KEEPS the dump's
# drizzle.__drizzle_migrations, so the local journal matches prod's data. A
# branch migration therefore shows as pending and runs for real on the cloned
# data at the next API boot / `npm run db:migrate -w api` from your tree.
#
# Safety rails (HARDCODED):
#   - prod_post_safe()/prod_get_safe() whitelist the paths this script may
#     call against $PROD_URL. Anything else aborts.
#   - DATABASE_URL (and LOCAL_URL, if set) must point at localhost — checked
#     before anything touches the DB. Prevents accidental clone-into-staging.
#   - NEVER issues restore / reset-instance / DELETE against $PROD_URL.
#   - A pre-clone pg_dump of the local DB goes to ~/.cache/raid-ledger/pre-clone/
#     (last 3 kept) before the restore overwrites it.
#   - Interactive confirmation: operator must type 'clone' (--yes skips).
#
# Env file (first found wins — scripts/lib/clone-prod-env.sh):
#   $RL_ENV_CLONE_FILE → ~/.config/raid-ledger/env.clone → <tree>/.env.clone
#   → <main checkout>/.env.clone
# Required: PROD_URL, DATABASE_URL, and prod auth:
#   PROD_BACKUP_TOKEN=rlbx_…   (Admin -> Backups -> Clone access tokens)
#   deprecated fallbacks: PROD_BEARER_TOKEN (JWT) or
#                         PROD_ADMIN_EMAIL + PROD_ADMIN_PASSWORD
# Optional:
#   PRESERVE_LOCAL_APP_SETTINGS=true   (default: true)
#   LOCAL_DB_CONTAINER=raid-ledger-db  (default)
#   LOCAL_URL=http://localhost:3000    (only printed in the summary)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/clone-prod-env.sh
source "$SCRIPT_DIR/lib/clone-prod-env.sh"

# Whitelists. ANYTHING not on these lists is rejected.
# PROD_POST_ALLOWED / PROD_GET_ALLOWED_PREFIX + prod_post_safe/prod_get_safe
# live in lib/clone-prod-env.sh (shared with clone-prod-measure-migration.sh).

# Row data of these tables must never be in a prod dump (sanity check, step 4).
SANITIZED_TABLES=(app_settings local_credentials sessions consumed_intent_tokens backup_export_tokens)
PRE_CLONE_DIR="$HOME/.cache/raid-ledger/pre-clone"
PRE_CLONE_KEEP=3
CONTAINER_DUMP="/tmp/rl-clone-restore.dump"

MODE="fresh"   # default per locked decision #5
SKIP_PROMPT=false
TREE=""
PRESERVED_NOTE="none"
RESET_NOTE="done"

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

usage() {
    cat <<'EOF'
clone-prod-to-local.sh — sanitized prod -> local DB clone

USAGE:
  ./scripts/clone-prod-to-local.sh [--fresh|--latest] [--tree <path>] [--yes]
  ./scripts/clone-prod-to-local.sh --help

FLAGS:
  --fresh         (default) Trigger a NEW backup on prod, then download it.
  --latest        Skip the create step; download the most recent existing backup.
  --tree <path>   The checkout whose bootstrap-admin.ts resets the admin password and
                  whose .env.clone is a fallback. Default: the git top-level of
                  the current directory, else this script's checkout.
  --yes           Skip the destructive-action confirmation prompt.
  --force         Accepted for compatibility; no effect (dumps go to a temp dir).
  --help          Show this help.

ENV FILE (first found wins):
  $RL_ENV_CLONE_FILE
  ~/.config/raid-ledger/env.clone        <- recommended, shared by every tree
  <tree>/.env.clone
  <main checkout>/.env.clone

  PROD_URL=https://raid.gamernight.net
  PROD_BACKUP_TOKEN=rlbx_...             # Admin -> Backups -> Clone access tokens
  DATABASE_URL=postgresql://user:password@localhost:5432/raid_ledger

  Deprecated (one release): PROD_BEARER_TOKEN, or PROD_ADMIN_EMAIL + PROD_ADMIN_PASSWORD.
  Optional: LOCAL_DB_CONTAINER=raid-ledger-db, PRESERVE_LOCAL_APP_SETTINGS=true,
            LOCAL_URL=http://localhost:3000 (summary only)

NEEDS: the local Postgres container running (deploy_dev.sh starts it), docker,
curl, jq. The local API does NOT need to be running.

SAFETY RAILS (HARDCODED):
  * Prod allowed paths:
      POST  /auth/local           (deprecated login fallback)
      POST  /admin/backups        (create new sanitized backup)
      GET   /admin/backups        (list)
      GET   /admin/backups/.../download   (stream file)
  * NEVER issued against PROD_URL:
      POST  /admin/backups/.../restore
      POST  /admin/backups/reset-instance
      DELETE *
  * DATABASE_URL must point at localhost/127.0.0.1/::1.
  * The local DB is dumped to ~/.cache/raid-ledger/pre-clone/ first (last 3 kept).

Operator triggered only. Production clone never writes back to prod.
EOF
}

# ─── Argument parsing ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fresh)  MODE="fresh"; shift ;;
        --latest) MODE="latest"; shift ;;
        --force)  shift ;;
        --tree)
            [[ $# -ge 2 ]] || { red "--tree needs a path"; exit 1; }
            TREE="$2"; shift 2 ;;
        --yes|-y) SKIP_PROMPT=true; shift ;;
        --help|-h) usage; exit 0 ;;
        *) red "Unknown flag: $1"; usage; exit 1 ;;
    esac
done

[[ -n "$TREE" ]] || TREE="$(clone_env_default_tree)"
[[ -n "$TREE" ]] || TREE="$REPO_ROOT"
if [[ ! -d "$TREE" ]]; then
    red "--tree is not a directory: $TREE"
    exit 1
fi
TREE="$(cd "$TREE" && pwd)"

# ─── Load env ─────────────────────────────────────────────────────────────
ENV_FILE="$(clone_env_resolve_file "$TREE")" || exit 1
clone_env_load "$ENV_FILE"
bold "Using clone env file: $ENV_FILE"

for v in PROD_URL DATABASE_URL; do
    if [[ -z "${!v:-}" ]]; then
        red "Missing required var in $ENV_FILE: $v"
        exit 1
    fi
done
clone_env_select_auth || exit 1

# Defaults for optional vars.
: "${PRESERVE_LOCAL_APP_SETTINGS:=true}"
: "${LOCAL_DB_CONTAINER:=raid-ledger-db}"
: "${LOCAL_URL:=}"

# ─── Localhost guard (STRICT) ─────────────────────────────────────────────
if ! clone_env_assert_local_db_url "$DATABASE_URL"; then
    red "Refusing to proceed; clone-prod-to-local NEVER writes to staging."
    exit 1
fi
if [[ -n "$LOCAL_URL" ]] \
    && ! [[ "$LOCAL_URL" =~ ^https?://(localhost|127\.0\.0\.1|::1)(:[0-9]+)?(/.*)?$ ]]; then
    red "LOCAL_URL must be localhost/127.0.0.1/::1 — got: $LOCAL_URL"
    exit 1
fi

db_exec() { docker exec "$LOCAL_DB_CONTAINER" "$@"; }
db_psql_value() { db_exec psql "$DATABASE_URL" -tAX -c "$1"; }

# ─── Step 0: local Postgres container ─────────────────────────────────────
bold "Step 0: checking local Postgres container '$LOCAL_DB_CONTAINER' ..."
if [[ "$(docker inspect -f '{{.State.Running}}' "$LOCAL_DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
    red "Container '$LOCAL_DB_CONTAINER' is not running."
    yellow "Start it with ./scripts/deploy_dev.sh --ci (the API does not need to stay up)."
    exit 2
fi
green "  container running"

# ─── Confirmation prompt (destructive action) ─────────────────────────────
preserve_line="WILL BE PRESERVED:  app_settings (your API keys)"
if [[ "$PRESERVE_LOCAL_APP_SETTINGS" != "true" ]]; then
    preserve_line="WILL BE EMPTY AFTER: app_settings (PRESERVE_LOCAL_APP_SETTINGS=false)"
fi
cat <<EOF

$(bold "This will WIPE your local Raid Ledger DB (container $LOCAL_DB_CONTAINER)")
and replace it with a sanitized clone of $PROD_URL.

WILL BE WIPED THEN REPLACED: users, events, games, characters, all non-secret tables,
                             and the migration journal (replaced by prod's)
WILL BE EMPTY AFTER:         local_credentials (admin password reset), sessions,
                             consumed_intent_tokens, backup_export_tokens
$preserve_line
SAFETY COPY FIRST:           $PRE_CLONE_DIR (last $PRE_CLONE_KEEP kept)

Local admin password will be regenerated and printed at the end.

EOF
if [[ "$SKIP_PROMPT" != "true" ]]; then
    read -r -p "Type 'clone' to continue: " confirm
    if [[ "$confirm" != "clone" ]]; then
        yellow "Aborted (confirmation not given)."
        exit 0
    fi
fi

WORK_DIR="$(mktemp -d -t rl-clone.XXXXXX)"
cleanup() {
    rm -rf "$WORK_DIR"
    db_exec rm -f "$CONTAINER_DUMP" >/dev/null 2>&1 || true
}
trap cleanup EXIT
AUTH_HEADER_FILE="$WORK_DIR/auth.header"
PRESERVE_FILE="$WORK_DIR/preserved-app-settings.sql"

# ─── Step 0.5: preserve local app_settings (if enabled) ───────────────────
if [[ "$PRESERVE_LOCAL_APP_SETTINGS" == "true" ]]; then
    bold "Step 0.5: preserving local app_settings (API keys) ..."
    if db_exec pg_dump --data-only --inserts --table=public.app_settings \
            "$DATABASE_URL" >"$PRESERVE_FILE" 2>/dev/null; then
        if grep -qE '^INSERT INTO ' "$PRESERVE_FILE"; then
            row_count=$(grep -cE '^INSERT INTO ' "$PRESERVE_FILE")
            green "  preserved $row_count app_settings row(s)"
            PRESERVED_NOTE="app_settings ($row_count rows)"
        else
            yellow "  no app_settings rows to preserve (empty table) — skipping re-apply"
            rm -f "$PRESERVE_FILE"
            PRESERVED_NOTE="app_settings (empty — nothing to preserve)"
        fi
    else
        yellow "  pg_dump of local app_settings failed — continuing without preserve."
        yellow "  Re-configure API keys via /admin/settings after clone."
        rm -f "$PRESERVE_FILE"
        PRESERVED_NOTE="app_settings (preserve failed)"
    fi
else
    yellow "Skipping app_settings preserve (PRESERVE_LOCAL_APP_SETTINGS=false)."
    PRESERVED_NOTE="none (disabled by env)"
fi

# ─── Step 1: prod auth ────────────────────────────────────────────────────
if [[ "$CLONE_AUTH_MODE" == "login" ]]; then
    bold "Step 1: prod login as $PROD_ADMIN_EMAIL (deprecated) ..."
    # Password goes jq-stdin → curl-stdin, never into any argv (review fix B6).
    LOGIN_RESP=$(printf '%s' "$PROD_ADMIN_PASSWORD" \
        | jq -Rs --arg e "$PROD_ADMIN_EMAIL" '{email:$e, password:.}' \
        | prod_post_safe /auth/local \
            -H 'Content-Type: application/json' \
            --data-binary @-) || {
        red "Prod login failed (PROD_ADMIN_EMAIL=$PROD_ADMIN_EMAIL; password not shown)."
        exit 1
    }
    CLONE_AUTH_TOKEN=$(printf '%s' "$LOGIN_RESP" | jq -r '.access_token // empty')
    if [[ -z "$CLONE_AUTH_TOKEN" ]]; then
        red "Prod login: no access_token in response."
        exit 1
    fi
    green "  authenticated"
else
    bold "Step 1: checking the prod token against /admin/backups ..."
fi
# The header lives in a 0600 file so the token never shows in a process list.
clone_env_write_auth_header "$AUTH_HEADER_FILE"
prod_auth=( -H "@$AUTH_HEADER_FILE" )
if ! prod_get_safe /admin/backups "${prod_auth[@]}" -o /dev/null >/dev/null 2>&1; then
    red "Token rejected by $PROD_URL/admin/backups (revoked, expired, or owner no longer admin?)."
    exit 1
fi
green "  token accepted"

# ─── Step 2: create new dump (--fresh) OR pick latest ─────────────────────
if [[ "$MODE" == "fresh" ]]; then
    bold "Step 2: triggering new sanitized backup on prod ..."
    CREATE_RESP=""
    for attempt in 1 2; do
        if CREATE_RESP=$(prod_post_safe /admin/backups "${prod_auth[@]}"); then
            break
        fi
        if [[ "$attempt" -lt 2 ]]; then
            yellow "  create attempt $attempt failed; retrying in 5s ..."
            sleep 5
        else
            red "Prod backup create failed after 2 attempts."
            exit 1
        fi
    done
    FILENAME=$(printf '%s' "$CREATE_RESP" | jq -r '.backup.filename // empty')
    if [[ -z "$FILENAME" ]]; then
        red "Prod backup create returned no filename."
        exit 1
    fi
    green "  created: $FILENAME"
else
    bold "Step 2: picking latest existing prod backup ..."
    LIST_RESP=$(prod_get_safe /admin/backups "${prod_auth[@]}")
    FILENAME=$(printf '%s' "$LIST_RESP" \
        | jq -r '[.backups[] | select(.type=="daily")] | sort_by(.createdAt) | reverse | .[0].filename // empty')
    if [[ -z "$FILENAME" ]]; then
        red "No daily backups available on prod."
        exit 1
    fi
    green "  latest: $FILENAME"
fi

# ─── Step 3: download to the temp dir, copy into the container ────────────
bold "Step 3: downloading $FILENAME ..."
LOCAL_FILE="$WORK_DIR/prod.dump"
if ! prod_get_safe "/admin/backups/daily/$FILENAME/download" \
    "${prod_auth[@]}" -o "$LOCAL_FILE"; then
    red "Download failed."
    exit 1
fi
green "  downloaded ($(du -h "$LOCAL_FILE" | awk '{print $1}'))"
docker cp "$LOCAL_FILE" "$LOCAL_DB_CONTAINER:$CONTAINER_DUMP" >/dev/null

# ─── Step 4: sanitization + journal sanity check ──────────────────────────
bold "Step 4: verifying dump is sanitized (pg_restore --list) ..."
LIST_OUT=$(db_exec pg_restore --list "$CONTAINER_DUMP")
for t in "${SANITIZED_TABLES[@]}"; do
    if grep -qE "^\s*[0-9]+;\s+[0-9]+\s+[0-9]+\s+TABLE DATA\s+\S+\s+${t}\b" <<<"$LIST_OUT"; then
        red "ABORT: prod backup is NOT sanitized — data segment for '$t' present."
        red "Server config drift: re-deploy prod with the sanitized-tables list."
        exit 1
    fi
done
green "  sanitized (no data segments for ${SANITIZED_TABLES[*]})"
if grep -qE 'TABLE DATA\s+drizzle\s+__drizzle_migrations\b' <<<"$LIST_OUT"; then
    green "  dump carries prod's migration journal (it replaces the local one)"
else
    yellow "  WARN: dump has no drizzle journal — the local journal survives the restore."
fi

# ─── Step 5: pre-clone safety dump of the local DB ────────────────────────
bold "Step 5: saving a safety copy of the local DB ..."
mkdir -p "$PRE_CLONE_DIR"
SAFETY_FILE="$PRE_CLONE_DIR/pre-clone-$(date -u +%Y%m%dT%H%M%SZ).dump"
# umask 077: the safety copy holds the whole local DB (review fix B8).
if ! ( umask 077 && db_exec pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" >"$SAFETY_FILE" ); then
    rm -f "$SAFETY_FILE"
    red "Safety dump of the local DB failed — refusing to overwrite it."
    exit 1
fi
# Keep only the newest $PRE_CLONE_KEEP safety dumps.
ls -1t "$PRE_CLONE_DIR"/pre-clone-*.dump 2>/dev/null | tail -n +$((PRE_CLONE_KEEP + 1)) \
    | while IFS= read -r old; do rm -f "$old"; done
green "  saved: $SAFETY_FILE"

# ─── Step 6: restore into a clean slate ───────────────────────────────────
# drizzle + public are dropped first so no local-only table/type/index from a
# branch migration survives beside prod's journal (D11), and any pg_restore
# error fails the clone — never a half-restored DB (review fix B1).
bold "Step 6: restoring into the local DB (clean slate + pg_restore) ..."
RESTORE_ERR="$WORK_DIR/restore.err"
if ! clone_env_restore_fresh "$LOCAL_DB_CONTAINER" "$DATABASE_URL" "$CONTAINER_DUMP" "$RESTORE_ERR"; then
    red "Local restore failed (any pg_restore error fails the clone):"
    sed 's/^/    /' "$RESTORE_ERR" >&2
    red "Your previous DB is saved at $SAFETY_FILE"
    exit 1
fi
green "  restored"

# ─── Step 6.5: re-apply preserved local app_settings ──────────────────────
if [[ -f "$PRESERVE_FILE" ]]; then
    bold "Step 6.5: re-applying preserved local app_settings ..."
    if ! db_exec psql "$DATABASE_URL" -c "TRUNCATE app_settings" >/dev/null 2>&1; then
        yellow "  TRUNCATE app_settings failed — re-apply may collide with existing rows."
    fi
    if docker exec -i "$LOCAL_DB_CONTAINER" psql "$DATABASE_URL" \
            <"$PRESERVE_FILE" >/dev/null 2>&1; then
        green "  re-applied $(grep -cE '^INSERT INTO ' "$PRESERVE_FILE") row(s)"
    else
        yellow "  re-apply failed — local app_settings is now empty."
        yellow "  Re-configure API keys via /admin/settings."
        PRESERVED_NOTE="app_settings (re-apply failed)"
    fi
fi

# ─── Step 6.8: branch migrations the migrator would skip ──────────────────
# Drizzle skips a pending migration whose `when` is not newer than the newest
# applied one. Warn so a branch migration is not silently left unapplied.
JOURNAL="$TREE/api/src/drizzle/migrations/meta/_journal.json"
if [[ -f "$JOURNAL" ]]; then
    applied="$(db_psql_value 'SELECT created_at FROM drizzle.__drizzle_migrations' 2>/dev/null || true)"
    max_applied="$(printf '%s\n' "$applied" | sort -n | tail -1)"
    if [[ -n "$max_applied" ]]; then
        skipped="$(jq -r --argjson max "$max_applied" --arg applied "$applied" \
            '($applied | split("\n")) as $a
             | .entries[] | select(.when <= $max)
             | select((.when | tostring) as $w | ($a | any(. == $w)) | not)
             | .tag' "$JOURNAL")"
        if [[ -n "$skipped" ]]; then
            yellow "  WARN: these $TREE migrations are older than prod's newest and would be SKIPPED:"
            printf '%s\n' "$skipped" | sed 's/^/    /'
            yellow "  Fix: ./scripts/fix-migration-order.sh on the branch, then re-run db:migrate."
        fi
    fi
fi

# ─── Step 7: reset local admin password (non-fatal, D13) ──────────────────
bold "Step 7: resetting local admin password (from $TREE) ..."
# Pinned to the clone DATABASE_URL — never via deploy_dev.sh, whose load_env
# re-sources .env and can re-point it at another database (Codex r2 P2).
RESET_TREE="$TREE"
[[ -f "$RESET_TREE/api/scripts/bootstrap-admin.ts" ]] || RESET_TREE="$REPO_ROOT"
if clone_env_reset_admin_password "$RESET_TREE" "$DATABASE_URL"; then
    green "  reset done — see the bootstrap-admin output above for the new password."
else
    RESET_NOTE="FAILED"
    yellow "WARN: the restore succeeded but the admin password reset failed."
    yellow "  Recover with: (cd <an up-to-date checkout> && DATABASE_URL=<this clone's DATABASE_URL> RESET_PASSWORD=true npx ts-node api/scripts/bootstrap-admin.ts)"
fi

# ─── Summary ──────────────────────────────────────────────────────────────
bold ""
green "DONE."
printf '  Prod file:        %s\n' "$FILENAME"
printf '  Env file:         %s\n' "$ENV_FILE"
printf '  Tree:             %s\n' "$TREE"
printf '  Safety copy:      %s\n' "$SAFETY_FILE"
printf '  Mode:             %s\n' "$MODE"
printf '  Preserved tables: %s\n' "$PRESERVED_NOTE"
printf '  Password reset:   %s\n' "$RESET_NOTE"
[[ "$RESET_NOTE" == "done" ]] || printf 'WARN: admin password reset failed — run the recovery command above.\n'
printf 'Next: run `npm run db:migrate -w api` from %s to apply branch migrations to the clone.\n' "$TREE"
[[ -z "$LOCAL_URL" ]] || printf 'Then log in at %s with the new password above.\n' "$LOCAL_URL"
