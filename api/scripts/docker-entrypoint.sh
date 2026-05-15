#!/bin/sh
set -e

echo "🚀 Starting Raid-Ledger API..."

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
    # Create backup directories (idempotent)
    mkdir -p /data/backups/daily /data/backups/migrations 2>/dev/null || true

    # Take a pre-migration snapshot before running migrations (ROK-420)
    echo "📸 Taking pre-migration database snapshot as $(whoami) (UID $(id -u))..."
    SNAPSHOT_TS=$(date +%Y-%m-%d_%H%M%S)
    SNAPSHOT_FILE="/data/backups/migrations/pre_migration_${SNAPSHOT_TS}.dump"
    if pg_dump --format=custom --no-owner --no-privileges --file="$SNAPSHOT_FILE" "$DATABASE_URL" 2>/dev/null; then
        echo "✅ Pre-migration snapshot saved: $SNAPSHOT_FILE"
    else
        echo "⚠️ Pre-migration snapshot skipped (database may not exist yet)"
        rm -f "$SNAPSHOT_FILE" 2>/dev/null || true
    fi

    echo "📦 Running database migrations (Sentry-instrumented)..."

    # ROK-1281: boot-time migration runner with Sentry capture.
    # Refreshes games_dedup_audit before drizzle migrate so data migrations
    # that consume the audit table (e.g. 0140) see current state regardless
    # of cron timing. Sentry captures + flushes any failure here.
    MIGRATIONS_FOLDER=/app/drizzle/migrations \
      node /app/dist/scripts/run-migrations-with-sentry.js 2>&1

    # Re-encrypt app_settings if migrating from a known dev JWT_SECRET (ROK-1035, ROK-1292)
    # Keep this list in sync with Dockerfile.allinone HARDCODED_DEFAULTS and the
    # docker-compose.yml JWT_SECRET fallback.
    if [ ! -f /data/.jwt_secret_migrated ]; then
        HARDCODED_DEFAULTS="raid-ledger-default-secret-change-in-production dev-secret-change-in-prod"
        echo "🔄 Checking if app_settings re-encryption is needed..."
        if [ -f /app/dist/scripts/reencrypt-settings.js ]; then
            for OLD_SECRET in $HARDCODED_DEFAULTS; do
                node /app/dist/scripts/reencrypt-settings.js \
                    --old-secret "$OLD_SECRET" \
                    --new-secret "$JWT_SECRET" 2>&1 || {
                    echo "⚠️ Re-encryption attempt with default '$OLD_SECRET' failed (non-fatal — settings may already use new key)"
                }
            done
        fi
        touch /data/.jwt_secret_migrated
        echo "✅ Re-encryption migration marker created"
    fi

    # Bootstrap admin account on first run, or sync password if ADMIN_PASSWORD is set
    echo "👤 Checking admin account..."
    node ./dist/scripts/bootstrap-admin.js 2>&1 || {
        echo "ℹ️ Bootstrap skipped (may already exist or failed)"
    }

    # Always seed games (needed for event creation, even without IGDB keys)
    echo "🎮 Seeding games cache..."

    # Seed IGDB games cache (enables game search without API keys)
    node ./dist/scripts/seed-igdb-games.js 2>&1 || {
        echo "ℹ️ IGDB games seeding skipped (may already exist)"
    }

    # Seed game registry
    node ./dist/scripts/seed-games.js 2>&1 || {
        echo "ℹ️ Game seeding skipped (may already exist)"
    }

    echo "✅ Games seeded"

    # Flush stale IGDB search cache so seed data takes precedence
    if command -v redis-cli > /dev/null 2>&1; then
        # Allinone image: Redis on Unix socket
        redis-cli -s /tmp/redis.sock KEYS 'igdb:*' 2>/dev/null | \
            xargs -r redis-cli -s /tmp/redis.sock DEL > /dev/null 2>&1 && \
            echo "🗑️ IGDB Redis cache flushed" || true
    elif [ -n "$REDIS_URL" ]; then
        # Docker compose: Redis on TCP
        node -e "
          const Redis = require('ioredis');
          const r = new Redis(process.env.REDIS_URL);
          r.keys('igdb:*').then(k => k.length ? r.del(...k) : 0)
            .then(() => { console.log('🗑️ IGDB Redis cache flushed'); r.disconnect(); })
            .catch(() => r.disconnect());
        " 2>/dev/null || true
    fi

fi

# Execute the main command
echo "🎮 Starting server..."
exec "$@"
