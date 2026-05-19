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
        # boot). We --disable-triggers so FK ordering doesn't bite. TRUNCATE
        # pre-step + schema-drift exclusions both computed at runtime against
        # the env's actual table set.
        DUMP_ARGS=(
            --data-only --inserts
            --disable-triggers
            --exclude-table-data='drizzle.*'
            --no-owner --no-privileges
        )
        # 1) Discover all user tables in the env's public schema. Use for
        #    BOTH the TRUNCATE pre-step AND schema-drift filtering.
        echo "  discovering env's public schema..." >&2
        ENV_TABLES=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
            "docker exec -i '$ENV_PG_CONTAINER' psql -U user -d raid_ledger -tA -c \"
                SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;\"" 2>/dev/null)
        if [[ -z "$ENV_TABLES" ]]; then
            echo "ERROR: env's public schema is empty or pg not ready." >&2
            exit 3
        fi
        # 2) TRUNCATE all of them (CASCADE handles FK ordering, RESTART IDENTITY
        #    resets sequences so synced PKs don't collide with the seed nextval).
        TRUNCATE_LIST=$(echo "$ENV_TABLES" | awk '{printf "%s%s", (NR==1?"":", "), $0}')
        PRE_SQL="TRUNCATE TABLE ${TRUNCATE_LIST} RESTART IDENTITY CASCADE;"
        # 3) Schema-drift filter — operator's local may have tables the env
        #    doesn't (agent's branch is behind on migrations, or older env
        #    image, etc.). pg_dump --exclude-table-data those so the INSERT
        #    stream doesn't try to populate tables that don't exist on the
        #    target. Skipped data is logged below for operator visibility.
        LOCAL_TABLES=$(docker exec "$LOCAL_DB_CONTAINER" psql -U user -d raid_ledger -tA -c \
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" 2>/dev/null)
        EXTRA_LOCAL=$(comm -23 \
            <(echo "$LOCAL_TABLES" | sort -u) \
            <(echo "$ENV_TABLES" | sort -u))
        if [[ -n "$EXTRA_LOCAL" ]]; then
            echo "  schema drift detected — operator has these tables, env doesn't:" >&2
            echo "$EXTRA_LOCAL" | sed 's/^/    /' >&2
            echo "  excluding them from the dump (env's branch may be behind on migrations)" >&2
            while IFS= read -r t; do
                [[ -z "$t" ]] && continue
                DUMP_ARGS+=(--exclude-table-data="public.$t")
            done <<< "$EXTRA_LOCAL"
        fi
        # 4) Sequence-drift filter. pg_dump emits SELECT pg_catalog.setval(...)
        #    lines for EVERY sequence in operator's local, regardless of
        #    --exclude-table-data on the parent table. Sequences for tables
        #    that don't exist in env fail with "relation does not exist".
        #    We capture env's sequence list now and use it later (post-dump)
        #    to filter the stream.
        ENV_SEQUENCES=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
            "docker exec -i '$ENV_PG_CONTAINER' psql -U user -d raid_ledger -tA -c \"
                SELECT sequence_name FROM information_schema.sequences
                WHERE sequence_schema = 'public' ORDER BY sequence_name;\"" 2>/dev/null)
        ;;
esac

echo "Sync $MODE: $LOCAL_DB_CONTAINER → $RL_PROXMOX_HOST:$ENV_PG_CONTAINER" >&2

# --single-transaction makes the whole TRUNCATE + INSERT stream atomic:
# any failure rolls back — no half-loaded state to clean up. Paired with
# ON_ERROR_STOP=1 so the first error aborts the rest of the stream.
REMOTE_PSQL="docker exec -i '$ENV_PG_CONTAINER' psql -U user -d raid_ledger -v ON_ERROR_STOP=1 --single-transaction"

# Apply pre-SQL (TRUNCATE) if any, then pipe pg_dump → psql. When sequence
# drift exists (full mode, env missing sequences operator's local has),
# pipe through awk that drops `SELECT pg_catalog.setval('public.<X>', ...)`
# lines for any <X> not in env's sequence list. Single-line setval calls
# only — multi-line setvals don't happen in pg_dump output.
SEQUENCE_FILTER='cat'
if [[ -n "${ENV_SEQUENCES:-}" ]]; then
    # awk -v doesn't handle embedded newlines, so flatten env's sequence
    # list with `|` (never appears in pg sequence names) and split on `|`
    # inside awk's BEGIN block.
    ENV_SEQUENCES_FLAT=$(echo "$ENV_SEQUENCES" | tr '\n' '|')
    # Parse each setval line — extract the sequence name between
    # `setval('public.` and the closing `'`. Drop the line if not in
    # env's allowed set.
    SEQUENCE_FILTER='awk -v seqs="'"$ENV_SEQUENCES_FLAT"'" '"'"'
        BEGIN { n = split(seqs, a, "|"); for (i=1; i<=n; i++) ok[a[i]] = 1 }
        /^SELECT pg_catalog.setval\(.public\./ {
            name = $0
            sub(/.*setval\(.public\./, "", name)
            sub(/.,.*/, "", name)
            if (!(name in ok)) next
        }
        { print }
    '"'"
fi
{
    [[ -n "$PRE_SQL" ]] && echo "$PRE_SQL"
    docker exec "$LOCAL_DB_CONTAINER" pg_dump "${DUMP_ARGS[@]}" "$DATABASE_URL"
} | eval "$SEQUENCE_FILTER" | ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "$REMOTE_PSQL" 2>&1 | tail -30
SYNC_RC=${PIPESTATUS[2]}
if (( SYNC_RC != 0 )); then
    echo "ERROR: sync transaction failed (exit $SYNC_RC). DB left at pre-transaction state." >&2
    exit "$SYNC_RC"
fi

# Rewrite deployment-bound URL settings so the env doesn't try to use the
# operator's localhost values. Only relevant for `settings` mode (and only
# when the operator's local DB had any of these settings to begin with).
# Today: discord_callback_url. Future: any other *_url that is per-deploy.
#
# Re-encryption: the env runs with the operator's JWT_SECRET (via
# RL_ENV_JWT_SECRET in /srv/rl-infra/.env), so we use that same secret
# to encrypt the replacement plaintext. scripts/rl-encrypt-setting.mjs
# mirrors the algorithm in api/src/settings/encryption.util.ts.
#
# The slot URL pattern (https://slot-N.${RL_PUBLIC_DOMAIN}/...) is what
# the operator has registered in the Discord developer portal — that's
# the only redirect_uri Discord will accept (ROK-1324).
# URL rewrite + admin bootstrap run for BOTH settings AND full modes.
# (The earlier `if [[ MODE == settings ]]` gate was wrong — full mode
# from clone_prod also leaves discord_callback_url pointing at the
# operator's localhost AND empties local_credentials per prod-backup
# sanitization, so the env had no admin at all.)

# Pull the inputs we need from the VM-side .env + container labels.
REMOTE_ENV_JWT_SECRET=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "sudo grep -E '^RL_ENV_JWT_SECRET=' /srv/rl-infra/.env 2>/dev/null | head -1 | cut -d= -f2- || true")
REMOTE_PUBLIC_DOMAIN=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "sudo grep -E '^RL_PUBLIC_DOMAIN=' /srv/rl-infra/.env 2>/dev/null | head -1 | cut -d= -f2- || true")
REMOTE_ADMIN_PASSWORD=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "sudo grep -E '^RL_ADMIN_PASSWORD=' /srv/rl-infra/.env 2>/dev/null | head -1 | cut -d= -f2- || true")
SLOT=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "docker inspect 'rl-env-${SLUG}-allinone' --format '{{ index .Config.Labels \"rl.slot\" }}' 2>/dev/null || echo ''")

# 1. Rewrite discord_callback_url to the slot URL. Same logic as before,
#    just no longer gated on MODE. Encrypt with env's JWT_SECRET (=operator's).
if [[ -z "$REMOTE_ENV_JWT_SECRET" || -z "$REMOTE_PUBLIC_DOMAIN" || -z "$SLOT" ]]; then
    echo "  skipping URL rewrite: RL_ENV_JWT_SECRET / RL_PUBLIC_DOMAIN / slot missing" >&2
else
    SLOT_URL="https://slot-${SLOT}.${REMOTE_PUBLIC_DOMAIN}"
    DISCORD_CB="${SLOT_URL}/api/auth/discord/callback"
    DISCORD_CB_ENC=$(node "$SCRIPT_DIR/rl-encrypt-setting.mjs" "$REMOTE_ENV_JWT_SECRET" "$DISCORD_CB")
    echo "  rewriting discord_callback_url → $DISCORD_CB" >&2
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
        "$REMOTE_PSQL" <<EOF 2>&1 | tail -10
INSERT INTO app_settings (key, encrypted_value, created_at, updated_at)
VALUES ('discord_callback_url', \$\$${DISCORD_CB_ENC}\$\$, now(), now())
ON CONFLICT (key) DO UPDATE
  SET encrypted_value = EXCLUDED.encrypted_value,
      updated_at = now();
EOF
fi

# 2. Seed admin@local in the env's DB. The sync (esp. with full mode
#    from clone_prod) leaves local_credentials empty because prod
#    backups sanitize that table. Without an admin row no one can log
#    in via /auth/local. RL_ADMIN_PASSWORD in /srv/rl-infra/.env is the
#    shared "fleet test password" — operator sets it once; every env
#    inherits the same login so agents + testers have a stable cred.
if [[ -z "$REMOTE_ADMIN_PASSWORD" ]]; then
    echo "  skipping admin bootstrap: RL_ADMIN_PASSWORD missing in /srv/rl-infra/.env" >&2
    echo "  (set it on the VM to enable /auth/local on fleet envs)" >&2
else
    echo "  bootstrapping admin@local with RL_ADMIN_PASSWORD..." >&2
    # Run bootstrap-admin INSIDE the env's allinone — it has the right
    # NODE_PATH + Drizzle + bcrypt deps + sees the env's DB via its
    # own DATABASE_URL env var. ADMIN_PASSWORD env var tells the script
    # to use a fixed password (not a random one). RESET_PASSWORD=true
    # ensures it overwrites whatever's there (handles re-deploy).
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
        "DOCKER_HOST=tcp://127.0.0.1:2375 docker exec \
             -e ADMIN_PASSWORD='$REMOTE_ADMIN_PASSWORD' \
             -e RESET_PASSWORD=true \
             rl-env-${SLUG}-allinone \
             node /app/dist/scripts/bootstrap-admin.js 2>&1 | tail -5" 2>&1 | sed 's/^/    /'
fi

echo "Sync complete." >&2
