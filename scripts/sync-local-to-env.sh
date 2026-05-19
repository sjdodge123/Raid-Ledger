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
        ;;
    full)
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
    } | sequence_filter | ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
        "$REMOTE_PSQL" 2>&1 | tail -30
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
# Look up the env's slot label. We do NOT swallow inspect failures with
# `|| echo ''` (M-VM-2): a failed `docker inspect` (env not labeled, docker
# host unreachable) used to leave SLOT empty and fall into the skip branch
# below — which then exited 0, the MCP env-deploy wrapper reported ok:true,
# and Discord login silently didn't work because the OAuth callback URL
# wasn't rewritten.
#
# Now: capture exit code separately so we can distinguish "ssh/docker
# couldn't read the label" (real failure) from "the label is intentionally
# missing" (older env without rl.slot — caller is on LAN, decides below).
SLOT=""
SLOT_LOOKUP_RC=0
SLOT=$(ssh -o BatchMode=yes -o ConnectTimeout=5 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "docker inspect 'rl-env-${SLUG}-allinone' --format '{{ index .Config.Labels \"rl.slot\" }}' 2>/dev/null") \
    || SLOT_LOOKUP_RC=$?
# Go template prints `<no value>` for a missing label key — treat that
# as "no slot" rather than a literal value.
[[ "$SLOT" == "<no value>" ]] && SLOT=""

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

# Resolve LOCAL_JWT_SECRET — try (1) explicit env var, (2) operator's
# main-repo api/.env (worktree-aware via `git rev-parse --git-common-dir`),
# (3) operator's working-dir api/.env. Hard-fail if none found — silent
# decrypt failures here are the exact regression mode this section exists
# to prevent.
resolve_local_jwt_secret() {
    if [[ -n "${LOCAL_JWT_SECRET:-}" ]]; then
        printf '%s' "$LOCAL_JWT_SECRET"
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
        echo "ERROR: RL_PUBLIC_DOMAIN is set but slot lookup for 'rl-env-${SLUG}-allinone' returned empty." >&2
        if (( SLOT_LOOKUP_RC != 0 )); then
            echo "       docker inspect via ssh exited $SLOT_LOOKUP_RC (env not running, docker host unreachable, or ssh failed)." >&2
        else
            echo "       Container has no 'rl.slot' label (re-deploy via 'rl env spin' to attach one)." >&2
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
| node "$SCRIPT_DIR/rl-reencrypt-settings.mjs" \
    --src-secret "$LOCAL_JWT_SECRET_RESOLVED" \
    --dst-secret "$REMOTE_ENV_JWT_SECRET" \
    "${REENCRYPT_SUBSTITUTES[@]}" \
| ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
    "$REMOTE_PSQL" 2>&1 | tail -20
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
    # M-VM-3: previously this was `ssh ... "docker exec ... | tail -5" | sed`.
    # `set -euo pipefail` on the LOCAL side does not control the REMOTE
    # shell's pipeline, so a failed `docker exec` was masked by `tail`'s
    # exit 0. We now capture the docker-exec rc on the remote and
    # propagate it as the ssh exit code so the local script sees the
    # failure. The `tail -5 | sed` formatting is still applied (via a
    # subshell that captures output before tail) but no longer masks rc.
    # Local `set -e` would abort the script before we could inspect
    # PIPESTATUS, so disable it just for this command and re-enable
    # immediately after.
    set +e
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$RL_PROXMOX_USER@$RL_PROXMOX_HOST" \
        "set -o pipefail; \
         DOCKER_HOST=tcp://127.0.0.1:2375 docker exec \
             -e ADMIN_PASSWORD='$REMOTE_ADMIN_PASSWORD' \
             -e RESET_PASSWORD=true \
             rl-env-${SLUG}-allinone \
             node /app/dist/scripts/bootstrap-admin.js 2>&1 | tail -5" \
        2>&1 | sed 's/^/    /'
    BOOTSTRAP_RC=${PIPESTATUS[0]}
    set -e
    if (( BOOTSTRAP_RC != 0 )); then
        echo "ERROR: admin bootstrap failed (exit $BOOTSTRAP_RC)." >&2
        echo "       /auth/local in the env will reject RL_ADMIN_PASSWORD; testers can't log in." >&2
        exit "$BOOTSTRAP_RC"
    fi
fi

echo "Sync complete." >&2
