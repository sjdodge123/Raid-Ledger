#!/bin/bash
set -e

# Ensure /data subdirectories exist and have correct ownership
# (volume mounts may arrive as root-owned empty dirs)
mkdir -p /data/postgresql /data/redis /data/backups/daily /data/backups/migrations /data/logs /data/ollama/models
chown -R postgres:postgres /data/postgresql
chown -R redis:redis /data/redis

# ROK-1036: prepare app-owned filesystem state. The API now runs as `app`
# (UID 1001) and needs write access to logs, backups, avatars, uploads, and
# the persisted JWT secret. Runs synchronously before supervisord so the
# child processes never observe a half-chowned tree.
mkdir -p /data/logs /data/backups/daily /data/backups/migrations /data/avatars /data/uploads/branding
chown -R app:app /data/logs /data/backups /data/avatars /data/uploads || true

# /data parent must be app-writable so the API can CREATE new files at
# runtime (the ROK-1035 re-encryption sentinel `.jwt_secret_migrated` is
# created by `api/scripts/docker-entrypoint.sh` after the migration runs;
# `app` cannot otherwise add new files because Docker's `VOLUME /data`
# declaration leaves the parent root-owned). Subdirs retain their own
# ownership (postgres/redis/etc — not affected).
chown app:app /data

# ROK-1035 .jwt_secret: pre-touch as root so the existing root:root 600 file
# on upgraded volumes flips to app:app 600 without start-api.sh needing
# parent-directory write permission. chmod 600 matches start-api.sh's
# invariant. The redirect that start-api.sh performs
# (`printf '%s' "$JWT_SECRET" > /data/.jwt_secret`) overwrites the existing
# app-owned file without touching the parent directory.
touch /data/.jwt_secret
chmod 600 /data/.jwt_secret
chown app:app /data/.jwt_secret

# ROK-1035 .jwt_secret_migrated: this is the re-encryption sentinel —
# `docker-entrypoint.sh:32` skips the migration block when the file exists,
# so we MUST NOT pre-create it. Only fix ownership if a previous boot
# already wrote it (pre-ROK-1036 upgrade after ROK-1035 already ran).
[ -e /data/.jwt_secret_migrated ] && chown app:app /data/.jwt_secret_migrated || true

# Log file for the api program's tee pipeline. Flip api.log to `app` so the
# unprivileged tee can append.
touch /data/logs/api.log
chown app:app /data/logs/api.log
# ROK-1164: nginx.log is no longer written (nginx logs to nginx-access.log /
# nginx-error.log). Remove the empty placeholder earlier images left behind;
# keep it if it holds anything.
[ -s /data/logs/nginx.log ] || rm -f /data/logs/nginx.log

# Restore log ownership for the postgres/redis programs after the recursive
# chown swept their files to `app`. Touch-and-chown so existing files survive
# unchanged and fresh-install creates an empty file with the right owner.
touch /data/logs/postgresql.log
chown postgres:postgres /data/logs/postgresql.log || true
touch /data/logs/redis.log
chown redis:redis /data/logs/redis.log || true

# Diagnostic block — one `docker logs` look answers "did chown run?".
echo "🔒 PRIVILEGE DROP: filesystem prepared for app (UID 1001)"
echo "   /data/logs          → $(ls -ld /data/logs    | awk '{print $3":"$4}')"
echo "   /data/backups       → $(ls -ld /data/backups | awk '{print $3":"$4}')"
echo "   /data/avatars       → $(ls -ld /data/avatars | awk '{print $3":"$4}')"
echo "   /data/uploads       → $(ls -ld /data/uploads | awk '{print $3":"$4}')"
echo "   .jwt_secret owner   → $(ls -l /data/.jwt_secret 2>/dev/null | awk '{print $3":"$4}' || echo 'not yet created')"
echo "   /tmp/redis.sock     → $(ls -la /tmp/redis.sock 2>/dev/null || echo 'not yet created')"
echo "   app user groups     → $(id app)"

# ROK-1576: fail fast when /data is NOT writable by `app` (uid 1001). Host-folder
# bind mounts on NAS devices (Synology DSM ACLs, unRAID) silently defeat the
# chown above — migrations run, then the API hits "Permission denied" creating
# /data/.jwt_secret_migrated, exits 1, and supervisor restarts it every ~4s
# forever while the container just reports "unhealthy". Probe AS the app user
# (root can write anything, so a root-side test proves nothing) and refuse to
# start rather than hand the operator a crash loop.
# Each directory is probed by CREATING a file in it, not `test -w`: an ACL can
# report a directory writable while refusing new entries, and start-api.sh
# creates /data/.jwt_secret_migrated in /data itself (Codex, ROK-1576).
if [ ! -x /sbin/su-exec ]; then
  # A broken image layer must not be reported as a /data permission problem.
  echo "⚠️  su-exec missing — skipping the /data writability probe"
fi
UNWRITABLE=""
[ -x /sbin/su-exec ] && for probe_path in /data /data/logs /data/backups /data/avatars /data/uploads; do
  /sbin/su-exec app sh -c "f=\"$probe_path/.rl-write-probe.\$\$\"; : > \"\$f\" && rm -f \"\$f\"" 2>/dev/null \
    || UNWRITABLE="$UNWRITABLE $probe_path"
done
[ -x /sbin/su-exec ] && { /sbin/su-exec app sh -c "test -w /data/.jwt_secret" 2>/dev/null || UNWRITABLE="$UNWRITABLE /data/.jwt_secret"; }
if [ -n "$UNWRITABLE" ]; then
  echo ""
  echo "❌ FATAL: /data is not writable by the app user (uid 1001)."
  echo "   Not writable:$UNWRITABLE"
  echo "   This happens with host-folder bind mounts on NAS devices (Synology DSM ACLs, unRAID, …):"
  echo "   the container's chown does not stick, and the API would crash-loop."
  echo "   Fix (pick one), then start the container again:"
  echo "     • use a named Docker volume:   -v raid-ledger-data:/data      (recommended)"
  echo "     • or make the folder writable: chmod -R a+rwX /path/to/your/host/folder"
  echo "   Docs: README → Quick Deploy → Portainer / Synology"
  echo ""
  exit 1
fi
echo "   /data writable by app → yes"

# Initialize database on first run
/app/init-db.sh

# ROK-1036: ensure postgres extensions on existing volumes. init-db.sh handles
# fresh installs; existing volumes (PG_VERSION present) skipped that path and
# start-api.sh can no longer install extensions (it now runs as `app` and
# cannot `su-exec`). Start postgres temporarily on the standard socket path,
# create extensions idempotently, stop cleanly — all before supervisord
# launches `[program:postgres]`.
if [ -s "${PGDATA}/PG_VERSION" ]; then
  echo "🔍 Ensuring postgres extensions (vector, pg_stat_statements) and grants..."
  /sbin/su-exec postgres pg_ctl -D "${PGDATA}" \
    -o "-k /run/postgresql -c log_min_messages=FATAL" -w start
  /sbin/su-exec postgres psql -v ON_ERROR_STOP=1 -qt -d raid_ledger \
    -c "CREATE EXTENSION IF NOT EXISTS vector;" \
    -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" \
    -c "GRANT EXECUTE ON FUNCTION pg_stat_statements_reset(oid, oid, bigint) TO raid_ledger;"
  /sbin/su-exec postgres pg_ctl -D "${PGDATA}" -m fast -w stop
  echo "✅ Extensions and grants ensured"
fi

# Resolve nginx listen port from $PORT (Render injects PORT=10000)
export NGINX_PORT="${PORT:-80}"
envsubst '${NGINX_PORT}' < /etc/nginx/http.d/default.conf.template > /etc/nginx/http.d/default.conf

# Start all services via supervisor
exec supervisord -c /etc/supervisor.d/raid-ledger.ini
