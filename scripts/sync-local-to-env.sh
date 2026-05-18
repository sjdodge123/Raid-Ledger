#!/usr/bin/env bash
# =============================================================================
# sync-local-to-env.sh - Copy operator's local DB data into an rl-infra test env
# =============================================================================
# Pipes `pg_dump --data-only` from the operator's local raid-ledger-db container
# into `psql` running inside the env's Postgres container on the rl-infra VM,
# over SSH. No intermediate files. Used by the rl_env_sync_from_local MCP tool
# (tools/mcp-rl-fleet/src/tools/env-sync.ts) and as a manual command.
#
# Modes:
#   settings   pg_dump --table=app_settings --table=local_credentials
#              --table=consumed_intent_tokens. Default. Gets API keys + admin
#              creds into the env so testers can log in + the Discord/Blizzard/
#              ITAD/OAuth flows work. CAVEAT: app_settings rows are encrypted
#              with the operator's JWT_SECRET — the env must have the same
#              JWT_SECRET (set via RL_ENV_JWT_SECRET in /srv/rl-infra/.env)
#              for decryption to work.
#   full       pg_dump --data-only of everything. Use this AFTER cloning prod
#              into local, to push prod-shaped data into the env.
#
# Usage:
#   ./scripts/sync-local-to-env.sh <slug> [settings|full]
#
# Required env (or .env.clone in repo root):
#   LOCAL_DB_CONTAINER=raid-ledger-db   (default)
#   DATABASE_URL=postgresql://user:password@localhost:5432/raid_ledger
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SLUG="${1:-}"
MODE="${2:-settings}"

[[ -z "$SLUG" ]] && { echo "usage: $0 <slug> [settings|full]" >&2; exit 2; }
[[ "$SLUG" =~ ^[a-z0-9-]+$ ]] || { echo "slug must be [a-z0-9-]+" >&2; exit 2; }
[[ "$MODE" == "settings" || "$MODE" == "full" ]] || { echo "mode must be 'settings' or 'full'" >&2; exit 2; }

# Optional .env.clone — same file the prod-clone script uses.
if [[ -f "$REPO_ROOT/.env.clone" ]]; then
    set -a; . "$REPO_ROOT/.env.clone"; set +a
fi
# Fall back to root .env for DATABASE_URL etc.
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a; . "$REPO_ROOT/.env"; set +a
fi

LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-raid-ledger-db}"
DATABASE_URL="${DATABASE_URL:-postgresql://user:password@localhost:5432/raid_ledger}"
RL_PROXMOX_USER="${RL_PROXMOX_USER:-rl}"   # SSH as rl (operator) for the env-pg exec
RL_PROXMOX_HOST="${RL_PROXMOX_HOST:-rl-infra}"
ENV_PG_CONTAINER="rl-env-${SLUG}-pg"

# Verify local container exists + is running.
if ! docker inspect "$LOCAL_DB_CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    echo "ERROR: local DB container '$LOCAL_DB_CONTAINER' is not running." >&2
    echo "       Start your local dev env first: ./scripts/deploy_dev.sh --ci" >&2
    exit 3
fi

# Verify env's PG is running on the VM.
if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
        "docker inspect '$ENV_PG_CONTAINER' --format '{{.State.Running}}'" 2>/dev/null | grep -q true; then
    echo "ERROR: env DB container '$ENV_PG_CONTAINER' is not running on $RL_PROXMOX_HOST." >&2
    echo "       Spin the env first: rl env spin --slug $SLUG" >&2
    exit 3
fi

case "$MODE" in
    settings)
        # --data-only: keep schema as-is; just refresh row data.
        # ONLY app_settings — local_credentials has a FK to users.id and
        # would attach the operator's admin password to a non-existent
        # user in the env's fresh DB (same reason clone-prod-to-local.sh
        # excludes it). The env's allinone uses DEMO_MODE which prefills
        # admin login, so testers don't need the operator's creds anyway.
        # consumed_intent_tokens is short-lived state — no value syncing.
        DUMP_ARGS=(
            --data-only --inserts
            --table=app_settings
            --no-owner --no-privileges
        )
        PRE_SQL="TRUNCATE app_settings CASCADE;"
        ;;
    full)
        # Full data clone. Schema preserved (env's allinone runs migrations at
        # boot). We --disable-triggers so FK ordering doesn't bite.
        DUMP_ARGS=(
            --data-only --inserts
            --disable-triggers
            --exclude-table-data='drizzle.*'
            --no-owner --no-privileges
        )
        PRE_SQL=""  # don't truncate everything; allinone migrations + env-spin start with fresh DB
        ;;
esac

echo "Sync $MODE: $LOCAL_DB_CONTAINER → $RL_PROXMOX_HOST:$ENV_PG_CONTAINER" >&2

REMOTE_PSQL="docker exec -i '$ENV_PG_CONTAINER' psql -U user -d raid_ledger -v ON_ERROR_STOP=1"

# Apply pre-SQL (TRUNCATE) if any, then pipe pg_dump → psql.
{
    [[ -n "$PRE_SQL" ]] && echo "$PRE_SQL"
    docker exec "$LOCAL_DB_CONTAINER" pg_dump "${DUMP_ARGS[@]}" "$DATABASE_URL"
} | ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "$REMOTE_PSQL" 2>&1 | tail -30

echo "Sync complete." >&2
