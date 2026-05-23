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

SLUG=""
MODE="settings"
ALLOW_EMPTY_SOURCE=0
# Positional + flag parsing — keeps backward compat (`<slug> [settings|full]`)
# while also accepting `--allow-empty-source` anywhere.
while [[ $# -gt 0 ]]; do
    case "$1" in
        --allow-empty-source) ALLOW_EMPTY_SOURCE=1; shift ;;
        -h|--help) echo "usage: $0 <slug> [settings|full] [--allow-empty-source]" >&2; exit 0 ;;
        --*) echo "unknown flag: $1" >&2; exit 2 ;;
        *)
            if [[ -z "$SLUG" ]]; then SLUG="$1"
            else MODE="$1"
            fi
            shift ;;
    esac
done

[[ -z "$SLUG" ]] && { echo "usage: $0 <slug> [settings|full] [--allow-empty-source]" >&2; exit 2; }
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
RL_PROXMOX_USER="${RL_PROXMOX_USER:-rl-agent}"   # rl-agent default — orchestrator binaries on VM route docker calls via socket-proxy (no docker-group needed)
RL_PROXMOX_HOST="${RL_PROXMOX_HOST:-rl-infra}"
ENV_PG_CONTAINER="rl-env-${SLUG}-pg"
ORCH_BIN="/srv/rl-infra/orchestrator/bin"
SSH_TO_VM=(ssh -o BatchMode=yes -o ConnectTimeout=10 "${RL_PROXMOX_USER}@${RL_PROXMOX_HOST}")

# Verify local container exists + is running.
if ! docker inspect "$LOCAL_DB_CONTAINER" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    echo "ERROR: local DB container '$LOCAL_DB_CONTAINER' is not running." >&2
    echo "       Start your local dev env first: ./scripts/deploy_dev.sh --ci" >&2
    exit 3
fi

# Verify env's PG is running on the VM via orchestrator's env-inspect binary
# (routes through socket-proxy so rl-agent — no docker group — can probe).
ENV_INSPECT_JSON=$("${SSH_TO_VM[@]}" "${ORCH_BIN}/env-inspect" "$SLUG" 2>/dev/null || true)
if ! echo "$ENV_INSPECT_JSON" | jq -e '.pg.running == true' >/dev/null 2>&1; then
    echo "ERROR: env DB container '$ENV_PG_CONTAINER' is not running on $RL_PROXMOX_HOST." >&2
    echo "       Spin the env first: rl env spin --slug $SLUG" >&2
    exit 3
fi

case "$MODE" in
    settings)
        # --data-only: keep schema as-is; just refresh row data.
        # app_settings is handled separately via the re-encrypt path below
        # (operator's local rows are encrypted with operator's JWT_SECRET,
        # env runs with RL_ENV_JWT_SECRET — must decrypt + re-encrypt).
        # local_credentials has a FK to users.id and would attach the
        # operator's admin password to a non-existent user in the env's
        # fresh DB (same reason clone-prod-to-local.sh excludes it). The
        # env's allinone uses DEMO_MODE which prefills admin login, so
        # testers don't need the operator's creds anyway.
        # consumed_intent_tokens is short-lived state — no value syncing.
        # Empty DUMP_ARGS skips pg_dump entirely in settings mode; the
        # re-encrypt path below is the WHOLE sync surface for this mode.
        DUMP_ARGS=()
        PRE_SQL=""
        SYNC_DISCORD_IDENTITY=1
        ;;
    full)
        SYNC_DISCORD_IDENTITY=0
        # Full data clone. Schema preserved (env's allinone runs migrations at
        # boot). We --disable-triggers so FK ordering doesn't bite. TRUNCATE
        # pre-step + schema-drift exclusions both computed at runtime against
        # the env's actual table set.
        # app_settings is excluded here and re-injected via the re-encrypt
        # path below — same JWT-secret-mismatch reason as `settings` mode.
        DUMP_ARGS=(
            --data-only --inserts
            --disable-triggers
            --exclude-table-data='drizzle.*'
            --exclude-table-data='public.app_settings'
            --no-owner --no-privileges
        )
        # 1) Discover all user tables in the env's public schema. Use for
        #    BOTH the TRUNCATE pre-step AND schema-drift filtering.
        echo "  discovering env's public schema..." >&2
        ENV_TABLES=$("${SSH_TO_VM[@]}" "${ORCH_BIN}/env-psql" "$SLUG" -- -tA -c \
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" 2>/dev/null)
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
        ENV_SEQUENCES=$("${SSH_TO_VM[@]}" "${ORCH_BIN}/env-psql" "$SLUG" -- -tA -c \
            "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' ORDER BY sequence_name;" 2>/dev/null)
        ;;
esac

# =============================================================================
# DISCORD IDENTITY sync (settings mode only)
# =============================================================================
# Unify the operator's Discord-linked users row across local + env so that
# Discord OAuth login and admin@local /auth/local resolve to the SAME row.
# Without this, every settings-mode sync left two separate admin rows in the
# env (the operator's real discord_id row + bootstrap-admin's local:admin@local
# placeholder), and characters/preferences keyed on user_id silently diverged
# depending on which login path the operator used.
#
# Implementation:
#   1. SELECT the operator's admin row from local DB (must have discord_id
#      set AND not be a local: placeholder).
#   2. If absent → skip (operator hasn't linked Discord yet locally).
#   3. If present → emit a single BEGIN/DELETE-orphan/INSERT-ON-CONFLICT/COMMIT
#      block to the env's psql via env-psql. Uses literal-value interpolation
#      built via bash quoting (NOT $N placeholders — psql heredocs don't
#      bind prepared params). The architect explicitly flagged 2026-05-20
#      that the INSERT MUST include `username` (NOT NULL in the schema).
dump_discord_identity() {
    local row_json
    row_json=$(docker exec "$LOCAL_DB_CONTAINER" psql -U user -d raid_ledger -tA -c \
        "SELECT row_to_json(u) FROM users u WHERE u.role = 'admin' AND u.discord_id IS NOT NULL AND u.discord_id NOT LIKE 'local:%' ORDER BY u.created_at LIMIT 1;" \
        2>/dev/null | tr -d '\r')
    if [[ -z "$row_json" || "$row_json" == "null" ]]; then
        echo "  skipping discord identity sync: no admin row with discord_id found in local DB" >&2
        return 0
    fi
    # Pull fields via jq. Empty strings for absent columns; we map them to
    # SQL NULL below. `username` is NOT NULL per schema — fall back to
    # 'Admin' if somehow blank (defensive; real rows always have it).
    local discord_id steam_id username display_name avatar custom_avatar_url role
    discord_id=$(echo "$row_json" | jq -r '.discord_id // ""')
    steam_id=$(echo "$row_json" | jq -r '.steam_id // ""')
    username=$(echo "$row_json" | jq -r '.username // ""')
    display_name=$(echo "$row_json" | jq -r '.display_name // ""')
    avatar=$(echo "$row_json" | jq -r '.avatar // ""')
    custom_avatar_url=$(echo "$row_json" | jq -r '.custom_avatar_url // ""')
    role=$(echo "$row_json" | jq -r '.role // "admin"')
    [[ -z "$username" ]] && username="Admin"

    # Postgres single-quote escape: double any literal single quotes.
    # Then wrap in single quotes. Empty source -> SQL NULL.
    # NOTE: uses sed instead of bash parameter-substitution because
    # macOS bash 3.2 mis-parses the alternative (`s slash slash escape`
    # form) inside the surrounding double quotes. Sed is portable.
    sql_lit() {
        local s="$1"
        local escaped
        if [[ -z "$s" ]]; then
            printf 'NULL'
        else
            escaped=$(printf '%s' "$s" | sed "s/'/''/g")
            printf "'%s'" "$escaped"
        fi
    }
    local sql_discord_id sql_steam_id sql_username sql_display_name sql_avatar sql_custom_avatar_url sql_role
    sql_discord_id=$(sql_lit "$discord_id")
    sql_steam_id=$(sql_lit "$steam_id")
    sql_username=$(sql_lit "$username")
    sql_display_name=$(sql_lit "$display_name")
    sql_avatar=$(sql_lit "$avatar")
    sql_custom_avatar_url=$(sql_lit "$custom_avatar_url")
    sql_role=$(sql_lit "$role")

    # Build the SQL transaction. Literal-value interpolation only — psql
    # heredocs DO NOT support $N prepared-parameter binding.
    local sql
    sql=$(cat <<SQL
BEGIN;
-- Wipe any pre-existing orphan local: placeholder admin (FK from
-- local_credentials → users.id; clear creds first to satisfy FK).
DELETE FROM local_credentials WHERE email = 'admin@local';
DELETE FROM users WHERE discord_id = 'local:admin@local';
-- UPSERT the operator identity. ON CONFLICT (discord_id) handles
-- repeat syncs idempotently (apostrophe-in-word avoided because
-- macOS bash 3.2 mis-balances single quotes inside heredocs nested
-- in command substitution; works fine on bash 4+ but breaks parse
-- on operator laptops without homebrew bash). username NOT NULL.
INSERT INTO users (discord_id, steam_id, username, display_name, avatar, custom_avatar_url, role, created_at, updated_at)
VALUES (${sql_discord_id}, ${sql_steam_id}, ${sql_username}, ${sql_display_name}, ${sql_avatar}, ${sql_custom_avatar_url}, ${sql_role}, now(), now())
ON CONFLICT (discord_id) DO UPDATE SET
  steam_id = EXCLUDED.steam_id,
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  avatar = EXCLUDED.avatar,
  custom_avatar_url = EXCLUDED.custom_avatar_url,
  role = EXCLUDED.role,
  updated_at = now();
COMMIT;
SQL
)
    set +e
    echo "$sql" | "${SSH_TO_VM[@]}" "${ORCH_BIN}/env-psql" "$SLUG" -- -v ON_ERROR_STOP=1 >/dev/null 2>&1
    local rc=$?
    set -e
    if (( rc != 0 )); then
        echo "  WARN: discord identity sync exit $rc — bootstrap-admin will fall back to local: placeholder" >&2
        return 0
    fi
    echo "  synced operator users row (discord_id=${discord_id:0:6}…) into env" >&2
}

if [[ "${SYNC_DISCORD_IDENTITY:-0}" == "1" ]]; then
    dump_discord_identity
fi

echo "Sync $MODE: $LOCAL_DB_CONTAINER → $RL_PROXMOX_HOST:$ENV_PG_CONTAINER" >&2

# --single-transaction makes the whole TRUNCATE + INSERT stream atomic:
# any failure rolls back — no half-loaded state to clean up. Paired with
# ON_ERROR_STOP=1 so the first error aborts the rest of the stream.
# Routes through env-psql so rl-agent (no docker group) can stream the
# pg_dump pipe into the env's Postgres.
REMOTE_PSQL_CMD=("${ORCH_BIN}/env-psql" "$SLUG" -- -v ON_ERROR_STOP=1 --single-transaction)

# Apply pre-SQL (TRUNCATE) if any, then pipe pg_dump → psql. When sequence
# drift exists (full mode, env missing sequences operator's local has),
# pipe through awk that drops `SELECT pg_catalog.setval('public.<X>', ...)`
# lines for any <X> not in env's sequence list. Single-line setval calls
# only — multi-line setvals don't happen in pg_dump output.
#
# M-VM-1 fix: previously this script built `SEQUENCE_FILTER` as a string
# (awk program + flattened sequence list interpolated as text) and ran
# it via `eval`. Sequence names come from a trusted information_schema
# query so today's data is safe, but the failure mode if any name
# contained an apostrophe or `|` would be a shell syntax error (or worse,
# command escalation). We now pass ENV_SEQUENCES_FLAT into awk via the
# `-v` mechanism, which quotes it correctly at the awk-VM level and
# never reaches the shell parser.
#
# awk -v doesn't handle embedded newlines, so ENV_SEQUENCES_FLAT is the
# `|`-separated form built up-script (line ~161). `|` never appears in
# Postgres sequence names; if it did, we'd need a different delimiter.
sequence_filter() {
    if [[ -z "${ENV_SEQUENCES_FLAT:-}" ]]; then
        cat
        return
    fi
    awk -v seqs="$ENV_SEQUENCES_FLAT" '
        BEGIN { n = split(seqs, a, "|"); for (i=1; i<=n; i++) ok[a[i]] = 1 }
        /^SELECT pg_catalog.setval\(.public\./ {
            name = $0
            sub(/.*setval\(.public\./, "", name)
            sub(/.,.*/, "", name)
            if (!(name in ok)) next
        }
        { print }
    '
}
ENV_SEQUENCES_FLAT=""
if [[ -n "${ENV_SEQUENCES:-}" ]]; then
    ENV_SEQUENCES_FLAT=$(echo "$ENV_SEQUENCES" | tr '\n' '|')
fi
if (( ${#DUMP_ARGS[@]} > 0 )); then
    {
        [[ -n "$PRE_SQL" ]] && echo "$PRE_SQL"
        docker exec "$LOCAL_DB_CONTAINER" pg_dump "${DUMP_ARGS[@]}" "$DATABASE_URL"
    } | sequence_filter | "${SSH_TO_VM[@]}" "${REMOTE_PSQL_CMD[@]}" 2>&1 | tail -30
    SYNC_RC=${PIPESTATUS[2]}
    if (( SYNC_RC != 0 )); then
        echo "ERROR: sync transaction failed (exit $SYNC_RC). DB left at pre-transaction state." >&2
        exit "$SYNC_RC"
    fi
else
    # settings mode skips pg_dump entirely — the re-encrypt path below
    # is the whole sync surface (app_settings is the only table touched).
    echo "  (no pg_dump in $MODE mode; handled by re-encrypt path below)" >&2
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
# Look up the env's slot via env-inspect (which reads env-registry.json on
# the VM — authoritative slot source, not the container label which can drift
# on older envs). We capture rc separately so "env-inspect couldn't reach
# the VM" stays distinguishable from "env-registry doesn't know this slug"
# (M-VM-2 — older bug where SLOT="" silently bypassed URL rewrite and let
# the MCP wrapper report ok:true with broken Discord login).
SLOT=""
SLOT_LOOKUP_RC=0
SLOT_INSPECT_JSON=$("${SSH_TO_VM[@]}" "${ORCH_BIN}/env-inspect" "$SLUG" 2>/dev/null) || SLOT_LOOKUP_RC=$?
if (( SLOT_LOOKUP_RC == 0 )); then
    SLOT=$(echo "$SLOT_INSPECT_JSON" | jq -r '.slot // empty' 2>/dev/null || true)
fi

# 1. Re-encrypt + sync app_settings (ROK-1326 fix-4). The operator's local
# rows are encrypted with their JWT_SECRET. The env runs with a different
# RL_ENV_JWT_SECRET, so a straight pg_dump+restore would land rows the
# env's settings cache can't decrypt — every API key drops out and
# Discord/IGDB/ITAD/Blizzard/bot-token flows die silently. The
# rl-reencrypt-settings.mjs helper decrypts each row with the operator's
# secret, optionally substitutes env-bound URL keys (discord_callback_url,
# client_url) with the slot's external URL, then re-encrypts with the env's
# secret. SQL emitted by the helper is piped through psql in a single
# transaction so failure rolls back cleanly.
#
# When RL_PUBLIC_DOMAIN is set on the VM, this env is public-facing and the
# URL substitutions are required (Discord login won't accept localhost-shaped
# redirect_uri). When unset (LAN-only), we still re-encrypt but skip URL
# substitutes — Discord OAuth wouldn't work LAN-only anyway.
if [[ -z "$REMOTE_ENV_JWT_SECRET" ]]; then
    echo "ERROR: RL_ENV_JWT_SECRET missing in /srv/rl-infra/.env on $RL_PROXMOX_HOST." >&2
    echo "       Cannot re-encrypt app_settings for the env." >&2
    exit 4
fi

# --allow-empty-source guard: refuse to sync a wiped local app_settings into
# the env unless the operator explicitly opts in. Common failure: operator's
# local DB got reset (post `--fresh`) and a follow-on sync silently wipes
# every API key in the env. Guard runs only when settings sync is in play
# (always — both modes hit the re-encrypt path below).
LOCAL_SETTINGS_COUNT=$(docker exec "$LOCAL_DB_CONTAINER" psql -U user -d raid_ledger -tA -c \
    "SELECT count(*) FROM app_settings;" 2>/dev/null | tr -d '[:space:]')
if [[ -z "$LOCAL_SETTINGS_COUNT" || "$LOCAL_SETTINGS_COUNT" == "0" ]]; then
    if (( ALLOW_EMPTY_SOURCE != 1 )); then
        echo "ERROR: local app_settings is empty — refusing to sync (would wipe env keys)." >&2
        echo "       Pass --allow-empty-source if this is intentional." >&2
        exit 5
    fi
    echo "  WARN: local app_settings is empty; --allow-empty-source set, proceeding." >&2
fi

# Resolve LOCAL_JWT_SECRET — try (1) explicit env var, (2) operator's
# main-repo api/.env (worktree-aware via `git rev-parse --git-common-dir`),
# (3) operator's working-dir api/.env. Hard-fail if none found — silent
# decrypt failures here are the exact regression mode this section exists
# to prevent.
resolve_local_jwt_secret() {
    if [[ -n "${LOCAL_JWT_SECRET:-}" ]]; then
        local s="$LOCAL_JWT_SECRET"
        # Strip optional surrounding double or single quotes (api/.env may have either).
        s="${s%\"}"; s="${s#\"}"
        s="${s%\'}"; s="${s#\'}"
        echo "  resolved LOCAL_JWT_SECRET from \$LOCAL_JWT_SECRET env var" >&2
        printf '%s' "$s"
        return 0
    fi
    local common_dir main_repo
    common_dir=$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)
    if [[ -n "$common_dir" ]]; then
        # `git rev-parse --git-common-dir` returns either an absolute path
        # (when invoked from a worktree — the worktree's .git is a file
        # pointing at the main repo's .git/) or a relative path "."-or-".git"
        # (when invoked from the main repo). Normalize both into the main
        # repo root.
        if [[ "$common_dir" == /* ]]; then
            main_repo=$(cd "$common_dir/.." && pwd)
        else
            main_repo=$(cd "$REPO_ROOT/$common_dir/.." && pwd)
        fi
    fi
    local f
    for f in "$main_repo/api/.env" "$REPO_ROOT/api/.env"; do
        [[ -z "$f" || ! -f "$f" ]] && continue
        local secret
        secret=$(grep -E '^JWT_SECRET=' "$f" | head -1 | cut -d= -f2-)
        if [[ -n "$secret" ]]; then
            # Strip optional surrounding double or single quotes (api/.env may have either).
            secret="${secret%\"}"; secret="${secret#\"}"
            secret="${secret%\'}"; secret="${secret#\'}"
            echo "  resolved LOCAL_JWT_SECRET from $f" >&2
            printf '%s' "$secret"
            return 0
        fi
    done
    return 1
}
LOCAL_JWT_SECRET_RESOLVED=$(resolve_local_jwt_secret) || {
    echo "ERROR: cannot resolve operator's local JWT_SECRET — needed to decrypt app_settings." >&2
    echo "       Tried: \$LOCAL_JWT_SECRET env var, main-repo api/.env, working-dir api/.env." >&2
    echo "       Set LOCAL_JWT_SECRET in your environment OR ensure api/.env exists in the main repo." >&2
    exit 4
}

# Build the substitutes list. Required when RL_PUBLIC_DOMAIN is set;
# omitted in LAN-only deploys.
REENCRYPT_SUBSTITUTES=()
if [[ -n "$REMOTE_PUBLIC_DOMAIN" ]]; then
    if [[ -z "$SLOT" ]]; then
        echo "ERROR: RL_PUBLIC_DOMAIN is set but slot lookup for '${SLUG}' returned empty." >&2
        if (( SLOT_LOOKUP_RC != 0 )); then
            echo "       env-inspect via ssh exited $SLOT_LOOKUP_RC (env not running, docker host unreachable, or ssh failed)." >&2
        else
            echo "       env-registry.json has no slot for this slug (re-deploy via 'rl env spin' to register one)." >&2
        fi
        exit 4
    fi
    SLOT_URL="https://slot-${SLOT}.${REMOTE_PUBLIC_DOMAIN}"
    REENCRYPT_SUBSTITUTES+=(
        --substitute "discord_callback_url=${SLOT_URL}/api/auth/discord/callback"
        --substitute "client_url=${SLOT_URL}"
    )
    echo "  substituting discord_callback_url + client_url → ${SLOT_URL}" >&2
else
    echo "  RL_PUBLIC_DOMAIN unset on VM (LAN-only deploy) — re-encrypting without URL substitutes" >&2
fi

# Pull app_settings as TSV from operator's local DB, pipe through the
# re-encrypt helper, pipe the resulting SQL through psql on the env's DB.
# Pipeline status is captured so a failure at any stage propagates.
set +e
docker exec "$LOCAL_DB_CONTAINER" psql -U user -d raid_ledger -tA -F$'\t' -c \
    "SELECT key, encrypted_value FROM app_settings ORDER BY key;" \
| RL_REENCRYPT_SRC_SECRET="$LOCAL_JWT_SECRET_RESOLVED" \
  RL_REENCRYPT_DST_SECRET="$REMOTE_ENV_JWT_SECRET" \
  node "$SCRIPT_DIR/rl-reencrypt-settings.mjs" \
    "${REENCRYPT_SUBSTITUTES[@]}" \
| "${SSH_TO_VM[@]}" "${REMOTE_PSQL_CMD[@]}" 2>&1 | tail -20
REENCRYPT_RC=("${PIPESTATUS[@]}")
set -e
# PIPESTATUS indices: 0=psql-source, 1=re-encrypt helper, 2=ssh-psql-target
if (( REENCRYPT_RC[1] != 0 )); then
    echo "ERROR: rl-reencrypt-settings exit ${REENCRYPT_RC[1]}." >&2
    echo "       Most likely cause: LOCAL_JWT_SECRET doesn't match the secret operator's app_settings were encrypted with." >&2
    exit "${REENCRYPT_RC[1]}"
fi
if (( REENCRYPT_RC[2] != 0 )); then
    echo "ERROR: env-side psql exit ${REENCRYPT_RC[2]} — app_settings INSERTs failed." >&2
    exit "${REENCRYPT_RC[2]}"
fi
if (( REENCRYPT_RC[0] != 0 )); then
    echo "ERROR: local psql source exit ${REENCRYPT_RC[0]} — couldn't read app_settings from operator's DB." >&2
    exit "${REENCRYPT_RC[0]}"
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
    #
    # M-VM-3: pipefail issue described below — we still set local pipefail
    # off around the ssh command so we can capture PIPESTATUS, then re-enable.
    # env-exec-app handles -e flag forwarding and propagates docker exec rc.
    set +e
    "${SSH_TO_VM[@]}" "${ORCH_BIN}/env-exec-app" "$SLUG" \
        -e "ADMIN_PASSWORD=${REMOTE_ADMIN_PASSWORD}" \
        -e "RESET_PASSWORD=true" \
        -- node /app/dist/scripts/bootstrap-admin.js 2>&1 \
        | tail -5 | sed 's/^/    /'
    BOOTSTRAP_RC=${PIPESTATUS[0]}
    set -e
    if (( BOOTSTRAP_RC != 0 )); then
        echo "ERROR: admin bootstrap failed (exit $BOOTSTRAP_RC)." >&2
        echo "       /auth/local in the env will reject RL_ADMIN_PASSWORD; testers can't log in." >&2
        exit "$BOOTSTRAP_RC"
    fi
fi

# 3. Restart the env's allinone container to flush the settings cache.
#    The api's settings service caches decrypted settings on boot (30-min
#    TTL). Without a restart, the new app_settings rows we just wrote sit
#    on disk but the running api keeps serving stale cache — agents see
#    Discord OAuth still showing client_id=placeholder + localhost
#    callback and conclude the sync didn't work. This is the single most
#    common agent-hit issue with the fleet sync flow (operator note
#    2026-05-19). Same pattern as CLAUDE.md's clone-prod-to-local
#    runbook Step 4 ("Bounce the API to invalidate the settings cache").
#    Restart is best-effort: a failure here is non-fatal because the
#    operator can always restart manually, but we WARN loudly so the
#    failure surfaces in the agent's chat instead of looking like
#    success-but-broken-OAuth.
echo "  restarting env to flush settings cache..." >&2
set +e
"${SSH_TO_VM[@]}" "${ORCH_BIN}/env-restart" "$SLUG" >/dev/null
RESTART_RC=$?
set -e
if (( RESTART_RC != 0 )); then
    echo "WARN: env restart exit ${RESTART_RC} — settings cache may still be stale." >&2
    echo "       Retry manually: ssh ${RL_PROXMOX_USER}@${RL_PROXMOX_HOST} ${ORCH_BIN}/env-restart ${SLUG}" >&2
else
    # Bounded poll on env-inspect's allinone status — wait until the
    # container reports running again, up to RESTART_WAIT_SECONDS. Replaces
    # the historical blind `sleep 12`: shorter when the env recovers fast,
    # noisier when it doesn't.
    RESTART_WAIT_SECONDS="${RL_RESTART_WAIT_SECONDS:-30}"
    poll_started=$(date +%s)
    while true; do
        INSPECT_OUT=$("${SSH_TO_VM[@]}" "${ORCH_BIN}/env-inspect" "$SLUG" 2>/dev/null || echo '{}')
        ALLINONE_RUNNING=$(echo "$INSPECT_OUT" | jq -r '.allinone.running // false' 2>/dev/null || echo false)
        ALLINONE_STATUS=$(echo "$INSPECT_OUT" | jq -r '.allinone.status // "missing"' 2>/dev/null || echo missing)
        now=$(date +%s)
        if [[ "$ALLINONE_RUNNING" == "true" && "$ALLINONE_STATUS" == "running" ]]; then
            break
        fi
        if (( now - poll_started >= RESTART_WAIT_SECONDS )); then
            echo "  WARN: env still not running after ${RESTART_WAIT_SECONDS}s (status=${ALLINONE_STATUS}); proceeding anyway." >&2
            break
        fi
        sleep 1
    done
    echo "  env restarted; settings cache reloaded." >&2
fi

echo "Sync complete." >&2
