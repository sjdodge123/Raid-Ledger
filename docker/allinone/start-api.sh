#!/bin/bash
set -e

# ROK-1036: identity + write-permission diagnostic at the very top.
echo "🔒 API running as: $(id)"
echo "   Can write /data/logs:    $(test -w /data/logs    && echo 'yes' || echo 'NO — PERMISSION DENIED')"
echo "   Can write /data/backups: $(test -w /data/backups && echo 'yes' || echo 'NO — PERMISSION DENIED')"
echo "   Can write /data/avatars: $(test -w /data/avatars && echo 'yes' || echo 'NO — PERMISSION DENIED')"
echo "   Can write /data/uploads: $(test -w /data/uploads && echo 'yes' || echo 'NO — PERMISSION DENIED')"
echo "   Redis socket readable:   $(test -r /tmp/redis.sock && echo 'yes' || echo 'not yet / NO')"

# ROK-1576: a "NO — PERMISSION DENIED" above always ended in a supervisor crash
# loop (the API dies creating /data/.jwt_secret_migrated a minute later), so
# stop here instead. entrypoint.sh normally catches this first and prints the
# full explanation; this is the race-proof backstop.
for probe_path in /data /data/logs /data/backups /data/avatars /data/uploads /data/.jwt_secret; do
  if [ ! -w "$probe_path" ]; then
    echo "❌ FATAL: $probe_path is not writable by the app user (uid 1001) — see the FATAL block at the top of the log (README → Quick Deploy → Portainer / Synology)."
    exit 1
  fi
done

# Wait for PostgreSQL to be ready (TCP probe; `app` cannot `su-exec postgres`).
# Probe as the `raid_ledger` role (created by init-db.sh) so `pg_isready` does
# not default to the OS user (`app`), which has no Postgres role.
echo "⏳ Waiting for PostgreSQL..."
until pg_isready -h localhost -U raid_ledger -d raid_ledger -q; do
  sleep 1
done
echo "✅ PostgreSQL is ready"

# Wait for Redis to be ready (Unix socket)
echo "⏳ Waiting for Redis..."
until redis-cli -s /tmp/redis.sock ping > /dev/null 2>&1; do
  sleep 1
done
echo "✅ Redis is ready"

# ── JWT_SECRET resolution (ROK-1035, ROK-1292) ────────────────────
# Priority: 1) env var (must NOT be a known dev default — fail fast)
#           2) /data/.jwt_secret file exists & non-empty → read it
#           3) generate new secret, persist to /data/.jwt_secret
# Known dev defaults rejected by both guards below — keep in sync with
# api/scripts/docker-entrypoint.sh and docker-compose.yml.
HARDCODED_DEFAULTS="raid-ledger-default-secret-change-in-production dev-secret-change-in-prod"

is_known_default() {
  for d in $HARDCODED_DEFAULTS; do
    [ "$1" = "$d" ] && return 0
  done
  return 1
}

# ROK-1292: fail fast if env var is explicitly a known default.
# (Original ROK-1035 code fell through to file/generate which silently
# overwrote JWT_SECRET — the post-resolution guard then checked the *new*
# random value and never fired. Net effect pre-ROK-1292: known-bad env
# var was accepted in practice.)
if [ -n "$JWT_SECRET" ] && is_known_default "$JWT_SECRET"; then
  echo "❌ FATAL: JWT_SECRET is still an insecure hardcoded default ($JWT_SECRET)."
  echo "   Remove the env var override or set a real secret."
  exit 1
fi

if [ -n "$JWT_SECRET" ]; then
  echo "🔑 JWT_SECRET: using explicit env var"
elif [ -s /data/.jwt_secret ]; then
  # ROK-1036: `-s` instead of `-f` because entrypoint.sh pre-touches the
  # file as root + chown to app (the parent /data is root-owned by VOLUME
  # so app cannot create files directly under it). An empty pre-touched
  # file falls through to the generation path.
  export JWT_SECRET=$(cat /data/.jwt_secret)
  echo "🔑 JWT_SECRET: loaded from /data/.jwt_secret"
else
  export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
  printf '%s' "$JWT_SECRET" > /data/.jwt_secret
  chmod 600 /data/.jwt_secret
  echo "🔑 JWT_SECRET: generated new secret → /data/.jwt_secret"
fi

# Guard: catch a /data/.jwt_secret file that was pre-populated with an
# insecure historical literal (legacy install before ROK-1035).
if is_known_default "$JWT_SECRET"; then
  echo "❌ FATAL: JWT_SECRET loaded from /data/.jwt_secret is an insecure hardcoded default."
  echo "   Delete /data/.jwt_secret and restart to generate a new one."
  exit 1
fi

# Auto-derive CORS_ORIGIN for all-in-one image if not explicitly set.
# Render provides RENDER_EXTERNAL_URL; otherwise keep "auto" so the API
# dynamically allows the request's own origin (works on any hostname).
if [ -z "$CORS_ORIGIN" ]; then
  export CORS_ORIGIN="auto"
fi
if [ "$CORS_ORIGIN" = "auto" ] && [ -n "$RENDER_EXTERNAL_URL" ]; then
  export CORS_ORIGIN="$RENDER_EXTERNAL_URL"
  echo "🌐 CORS_ORIGIN derived from Render: $CORS_ORIGIN"
else
  echo "🌐 CORS_ORIGIN: $CORS_ORIGIN"
fi

# Auto-derive CLIENT_URL from CORS_ORIGIN when not explicitly set.
# The /event plan Discord command and poll embeds need this to generate links.
if [ -z "$CLIENT_URL" ] && [ -n "$CORS_ORIGIN" ] && [ "$CORS_ORIGIN" != "auto" ]; then
  export CLIENT_URL="$CORS_ORIGIN"
  echo "🔗 CLIENT_URL derived from CORS_ORIGIN: $CLIENT_URL"
fi

# Run entrypoint (migrations, admin bootstrap, seeding)
cd /app
exec /usr/local/bin/docker-entrypoint.sh node /app/dist/src/main.js
