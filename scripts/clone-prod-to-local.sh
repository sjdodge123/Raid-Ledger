#!/usr/bin/env bash
# =============================================================================
# clone-prod-to-local.sh - Sanitized prod -> local DB clone (ROK-1279)
# =============================================================================
# Triggers a sanitized backup on prod, downloads it, restores into the local
# DB, then resets the local admin password. Preserves local app_settings
# (API keys) across the clone unless explicitly disabled.
#
# Sanitization (server-side, baked into BackupService) excludes ROW DATA for:
#   app_settings, local_credentials, sessions, consumed_intent_tokens
# Schema is preserved, rows are empty after restore.
#
# Local preservation: app_settings is dumped (pg_dump --data-only --inserts)
# BEFORE restore, then re-applied AFTER restore. Operator's IGDB/ITAD/Blizzard
# /OAuth/Sentry keys survive the clone. The other 3 sanitized tables stay
# empty — local_credentials/sessions have FK→users.id and would attach the
# local admin password to a now-prod user if preserved.
#
# Safety rails (HARDCODED):
#   - prod_post_safe()/prod_get_safe() whitelist the paths this script may
#     call against $PROD_URL. Anything else aborts.
#   - LOCAL_URL must resolve to localhost/127.0.0.1/::1 — checked before any
#     local curl. Prevents accidental clone-into-staging.
#   - NEVER issues restore / reset-instance / DELETE against $PROD_URL.
#   - Interactive confirmation: operator must type 'clone' (--yes skips).
#
# Env file: .env.clone at repo root (gitignored), required vars:
#   PROD_URL, LOCAL_URL, LOCAL_ADMIN_EMAIL, DATABASE_URL
# Prod auth (pick ONE):
#   PROD_BEARER_TOKEN                  (paste from browser/DM auth)
#   PROD_ADMIN_EMAIL + PROD_ADMIN_PASSWORD  (script logs in via /auth/local)
# Optional:
#   PRESERVE_LOCAL_APP_SETTINGS=true   (default: true)
#   LOCAL_DB_CONTAINER=raid-ledger-db  (default)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.clone"

# Whitelists. ANYTHING not on these lists is rejected.
PROD_POST_ALLOWED=("/auth/local" "/admin/backups")
PROD_GET_ALLOWED_PREFIX="/admin/backups"  # exact list endpoint or (daily|migration)/<file>/download

MODE="fresh"   # default per locked decision #5
FORCE=false
SKIP_PROMPT=false
PRESERVE_FILE="/tmp/rl-preserved-app-settings.sql"
PRESERVED_NOTE="none"

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

usage() {
    cat <<'EOF'
clone-prod-to-local.sh — sanitized prod -> local DB clone

USAGE:
  ./scripts/clone-prod-to-local.sh [--fresh|--latest] [--force] [--yes]
  ./scripts/clone-prod-to-local.sh --help

FLAGS:
  --fresh    (default) Trigger a NEW backup on prod, then download it.
  --latest   Skip the create step; download the most recent existing backup.
  --force    Overwrite a local dump file if one already exists with the same
             name. Default refuses with a helpful message.
  --yes      Skip the destructive-action confirmation prompt. Use for
             non-interactive runs. Default: prompt the operator to type
             'clone' before any prod call.
  --help     Show this help.

REQUIRED .env.clone (repo root, gitignored):
  PROD_URL=https://raid.gamernight.net
  PROD_ADMIN_EMAIL=admin@...
  PROD_ADMIN_PASSWORD=...
  LOCAL_URL=http://localhost:3000
  LOCAL_ADMIN_EMAIL=admin@local
  DATABASE_URL=postgresql://user:password@localhost:5432/raid_ledger

OPTIONAL .env.clone:
  LOCAL_ADMIN_PASSWORD=...            # for the local login step (auto-reset later)
  LOCAL_DB_CONTAINER=raid-ledger-db   # docker container name for local Postgres
  PRESERVE_LOCAL_APP_SETTINGS=true    # preserve API keys across clones (default: true)

SAFETY RAILS (HARDCODED):
  * Prod allowed paths:
      POST  /auth/local           (login)
      POST  /admin/backups        (create new sanitized backup)
      GET   /admin/backups        (list)
      GET   /admin/backups/.../download   (stream file)
  * NEVER issued against PROD_URL:
      POST  /admin/backups/.../restore
      POST  /admin/backups/reset-instance
      DELETE *
  * LOCAL_URL must match ^https?://(localhost|127\.0\.0\.1|::1) — verified
    before any local curl.

Operator triggered only. Production clone never writes back to prod.
EOF
}

# ─── Argument parsing ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --fresh)  MODE="fresh"; shift ;;
        --latest) MODE="latest"; shift ;;
        --force)  FORCE=true; shift ;;
        --yes|-y) SKIP_PROMPT=true; shift ;;
        --help|-h) usage; exit 0 ;;
        *) red "Unknown flag: $1"; usage; exit 1 ;;
    esac
done

# ─── Load env ─────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    red "Missing $ENV_FILE"
    yellow "Create it at $ENV_FILE with the variables listed in --help."
    exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

REQUIRED_VARS=(PROD_URL LOCAL_URL LOCAL_ADMIN_EMAIL DATABASE_URL)
for v in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!v:-}" ]]; then
        red "Missing required var in .env.clone: $v"
        exit 1
    fi
done

# Either PROD_BEARER_TOKEN (preferred — paste from Discord/web session)
# OR PROD_ADMIN_EMAIL + PROD_ADMIN_PASSWORD (script logs in via /auth/local).
if [[ -z "${PROD_BEARER_TOKEN:-}" ]]; then
    for v in PROD_ADMIN_EMAIL PROD_ADMIN_PASSWORD; do
        if [[ -z "${!v:-}" ]]; then
            red "Missing prod auth: set PROD_BEARER_TOKEN, or set both PROD_ADMIN_EMAIL+PROD_ADMIN_PASSWORD."
            exit 1
        fi
    done
fi

# Defaults for optional vars.
: "${PRESERVE_LOCAL_APP_SETTINGS:=true}"
: "${LOCAL_DB_CONTAINER:=raid-ledger-db}"

# ─── Localhost guard (STRICT) ─────────────────────────────────────────────
if ! [[ "$LOCAL_URL" =~ ^https?://(localhost|127\.0\.0\.1|::1)(:[0-9]+)?(/.*)?$ ]]; then
    red "LOCAL_URL must be localhost/127.0.0.1/::1 — got: $LOCAL_URL"
    red "Refusing to proceed; clone-prod-to-local NEVER writes to staging."
    exit 1
fi

# ─── Prod-safe HTTP wrappers ──────────────────────────────────────────────
prod_post_safe() {
    # Usage: prod_post_safe <path> [curl args...]
    local pth="$1"; shift
    local allowed=false
    for ap in "${PROD_POST_ALLOWED[@]}"; do
        if [[ "$pth" == "$ap" ]]; then allowed=true; break; fi
    done
    if ! $allowed; then
        red "BLOCKED: POST $pth is not on the prod-safe whitelist."
        red "Allowed: ${PROD_POST_ALLOWED[*]}"
        exit 1
    fi
    curl -fsS -X POST "$PROD_URL$pth" "$@"
}

prod_get_safe() {
    # Usage: prod_get_safe <path> [curl args...]
    local pth="$1"; shift
    if [[ "$pth" != "$PROD_GET_ALLOWED_PREFIX" \
        && ! "$pth" =~ ^/admin/backups/(daily|migration)/[A-Za-z0-9_][A-Za-z0-9_.-]*/download$ ]]; then
        red "BLOCKED: GET $pth is not on the prod-safe whitelist."
        red "Allowed: $PROD_GET_ALLOWED_PREFIX  OR  $PROD_GET_ALLOWED_PREFIX/(daily|migration)/<file>/download"
        exit 1
    fi
    curl -fsS "$PROD_URL$pth" "$@"
}

local_curl() {
    # Convenience wrapper around curl that uses LOCAL_URL only.
    # The localhost guard above is the actual safety check; this wrapper
    # just makes it obvious which calls target the local API.
    local method="$1"; shift
    local pth="$1"; shift
    curl -fsS -X "$method" "$LOCAL_URL$pth" "$@"
}

# ─── Step 0: local API health check ───────────────────────────────────────
bold "Step 0: checking local API at $LOCAL_URL ..."
if ! curl -fsS -o /dev/null "$LOCAL_URL/api/health" 2>/dev/null \
    && ! curl -fsS -o /dev/null "$LOCAL_URL/health" 2>/dev/null; then
    red "Local API is not responding at $LOCAL_URL."
    yellow "Run ./scripts/deploy_dev.sh --ci then retry."
    exit 2
fi
green "  local API healthy"

# ─── Confirmation prompt (destructive action) ─────────────────────────────
preserve_line="WILL BE PRESERVED:  app_settings (your API keys)"
if [[ "$PRESERVE_LOCAL_APP_SETTINGS" != "true" ]]; then
    preserve_line="WILL BE EMPTY AFTER: app_settings (PRESERVE_LOCAL_APP_SETTINGS=false)"
fi
cat <<EOF

$(bold "This will WIPE your local Raid Ledger DB at $LOCAL_URL")
and replace it with a sanitized clone of $PROD_URL.

WILL BE WIPED THEN REPLACED: users, events, games, characters, all non-secret tables
WILL BE EMPTY AFTER:         local_credentials (admin password reset), sessions, consumed_intent_tokens
$preserve_line

Local admin password will be regenerated and printed at the end.

EOF
if [[ "$SKIP_PROMPT" != "true" ]]; then
    read -r -p "Type 'clone' to continue: " confirm
    if [[ "$confirm" != "clone" ]]; then
        yellow "Aborted (confirmation not given)."
        exit 0
    fi
fi

# ─── Step 0.5: preserve local app_settings (if enabled) ───────────────────
if [[ "$PRESERVE_LOCAL_APP_SETTINGS" == "true" ]]; then
    bold "Step 0.5: preserving local app_settings (API keys) ..."
    rm -f "$PRESERVE_FILE"
    if docker exec "$LOCAL_DB_CONTAINER" pg_dump \
            --data-only --inserts --table=public.app_settings \
            "$DATABASE_URL" >"$PRESERVE_FILE" 2>/dev/null; then
        # Check whether any INSERT lines actually landed in the file.
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
        yellow "  pg_dump of local app_settings failed (container=$LOCAL_DB_CONTAINER not running?)"
        yellow "  Continuing without preserve — re-configure API keys via /admin/settings after clone."
        rm -f "$PRESERVE_FILE"
        PRESERVED_NOTE="app_settings (preserve failed)"
    fi
else
    yellow "Skipping app_settings preserve (PRESERVE_LOCAL_APP_SETTINGS=false)."
    PRESERVED_NOTE="none (disabled by env)"
fi

# ─── Step 1: prod auth ────────────────────────────────────────────────────
if [[ -n "${PROD_BEARER_TOKEN:-}" ]]; then
    bold "Step 1: using PROD_BEARER_TOKEN (skipping /auth/local login) ..."
    TOKEN="$PROD_BEARER_TOKEN"
    # Sanity-check the token by hitting the allow-listed list endpoint.
    if ! prod_get_safe /admin/backups \
            -H "Authorization: Bearer $TOKEN" \
            -o /dev/null >/dev/null 2>&1; then
        red "Token rejected by $PROD_URL/admin/backups (expired or insufficient role?)."
        exit 1
    fi
    green "  token accepted"
else
    bold "Step 1: prod login as $PROD_ADMIN_EMAIL ..."
    LOGIN_BODY=$(jq -n --arg e "$PROD_ADMIN_EMAIL" --arg p "$PROD_ADMIN_PASSWORD" \
        '{email:$e, password:$p}')
    LOGIN_RESP=$(prod_post_safe /auth/local \
        -H 'Content-Type: application/json' \
        -d "$LOGIN_BODY") || {
        red "Prod login failed."
        red "  PROD_URL=$PROD_URL  PROD_ADMIN_EMAIL=$PROD_ADMIN_EMAIL"
        red "  (password not shown)"
        exit 1
    }
    TOKEN=$(printf '%s' "$LOGIN_RESP" | jq -r '.access_token // empty')
    if [[ -z "$TOKEN" ]]; then
        red "Prod login: no access_token in response."
        exit 1
    fi
    green "  authenticated"
fi

prod_auth=( -H "Authorization: Bearer $TOKEN" )

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

# ─── Step 3: download ─────────────────────────────────────────────────────
LOCAL_DAILY_DIR="$REPO_ROOT/api/backups/daily"
mkdir -p "$LOCAL_DAILY_DIR"
LOCAL_FILE="$LOCAL_DAILY_DIR/$FILENAME"

if [[ -f "$LOCAL_FILE" && "$FORCE" != "true" ]]; then
    red "Local file already exists: $LOCAL_FILE"
    yellow "Re-run with --force to overwrite."
    exit 1
fi

bold "Step 3: downloading $FILENAME ..."
TMP_FILE="$(mktemp -t rl-clone.XXXXXX)"
trap 'rm -f "$TMP_FILE"' EXIT
if ! prod_get_safe "/admin/backups/daily/$FILENAME/download" \
    "${prod_auth[@]}" -o "$TMP_FILE"; then
    red "Download failed."
    exit 1
fi
mv "$TMP_FILE" "$LOCAL_FILE"
trap - EXIT
green "  saved: $LOCAL_FILE ($(du -h "$LOCAL_FILE" | awk '{print $1}'))"

# ─── Step 4: sanitization sanity check ────────────────────────────────────
bold "Step 4: verifying dump is sanitized (pg_restore --list) ..."
if ! command -v pg_restore >/dev/null 2>&1; then
    yellow "  pg_restore not on PATH — skipping the sanity check."
    yellow "  Install postgresql-client to enable (brew install libpq on macOS)."
else
    LIST_OUT=$(pg_restore --list "$LOCAL_FILE")
    for t in app_settings local_credentials sessions consumed_intent_tokens; do
        if printf '%s' "$LIST_OUT" \
            | grep -E "^\s*[0-9]+;\s+[0-9]+\s+[0-9]+\s+TABLE DATA\s+\S+\s+${t}\b" \
            >/dev/null; then
            red "ABORT: prod backup is NOT sanitized — data segment for '$t' present."
            red "Server config drift: re-deploy prod with ROK-1279 changes."
            rm -f "$LOCAL_FILE"
            exit 1
        fi
    done
    green "  sanitized (no data segments for the 4 protected tables)"
fi

# ─── Step 5: local login ──────────────────────────────────────────────────
bold "Step 5: local login as $LOCAL_ADMIN_EMAIL ..."
LOCAL_LOGIN_BODY=$(jq -n --arg e "$LOCAL_ADMIN_EMAIL" --arg p "${LOCAL_ADMIN_PASSWORD:-}" \
    '{email:$e, password:$p}')
LOCAL_LOGIN_RESP=$(local_curl POST /auth/local \
    -H 'Content-Type: application/json' \
    -d "$LOCAL_LOGIN_BODY") || {
    red "Local login failed."
    yellow "Try ./scripts/deploy_dev.sh --reset-password first, then export LOCAL_ADMIN_PASSWORD and retry."
    exit 1
}
LOCAL_TOKEN=$(printf '%s' "$LOCAL_LOGIN_RESP" | jq -r '.access_token // empty')
if [[ -z "$LOCAL_TOKEN" ]]; then
    red "Local login: no access_token in response."
    exit 1
fi
green "  authenticated"

# ─── Step 6: local restore ────────────────────────────────────────────────
bold "Step 6: restoring into local DB ..."
RESTORE_RESP=$(local_curl POST "/admin/backups/daily/$FILENAME/restore" \
    -H "Authorization: Bearer $LOCAL_TOKEN") || {
    red "Local restore failed."
    yellow "Try: node scripts/reconcile-migrations.mjs"
    red "Response: $RESTORE_RESP"
    exit 1
}
green "  restored"

# ─── Step 6.5: re-apply preserved local app_settings ──────────────────────
if [[ -f "$PRESERVE_FILE" ]]; then
    bold "Step 6.5: re-applying preserved local app_settings ..."
    # Defensive truncate: sanitized restore leaves zero rows but a server-config
    # drift could leave junk; truncate first so the INSERTs from the preserve
    # file are the only rows.
    if ! docker exec "$LOCAL_DB_CONTAINER" psql "$DATABASE_URL" \
            -c "TRUNCATE app_settings" >/dev/null 2>&1; then
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
    rm -f "$PRESERVE_FILE"
fi

# ─── Step 7: reset local admin password ───────────────────────────────────
bold "Step 7: resetting local admin password ..."
bash "$SCRIPT_DIR/deploy_dev.sh" --reset-password --ci || {
    red "deploy_dev.sh --reset-password failed; restore succeeded but admin login may be broken."
    yellow "Run ./scripts/deploy_dev.sh --reset-password manually to recover."
    exit 1
}
green "  reset done — see deploy_dev.sh output above for the new password."

# ─── Summary ──────────────────────────────────────────────────────────────
bold ""
green "DONE."
printf '  Prod file:        %s\n' "$FILENAME"
printf '  Local file:       %s\n' "$LOCAL_FILE"
printf '  Local URL:        %s\n' "$LOCAL_URL"
printf '  Mode:             %s\n' "$MODE"
printf '  Preserved tables: %s\n' "$PRESERVED_NOTE"
printf 'Next: log in at %s with the new password above.\n' "$LOCAL_URL"
