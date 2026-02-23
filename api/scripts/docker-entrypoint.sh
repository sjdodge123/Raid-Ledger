#!/bin/sh
set -e

echo "🚀 Starting Raid-Ledger API..."

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
    # Create backup directories (idempotent)
    mkdir -p /data/backups/daily /data/backups/migrations 2>/dev/null || true

    # Take a pre-migration snapshot before running migrations (ROK-420)
    echo "📸 Taking pre-migration database snapshot..."
    SNAPSHOT_TS=$(date +%Y-%m-%d_%H%M%S)
    SNAPSHOT_FILE="/data/backups/migrations/pre_migration_${SNAPSHOT_TS}.dump"
    if pg_dump --format=custom --no-owner --no-privileges --file="$SNAPSHOT_FILE" "$DATABASE_URL" 2>/dev/null; then
        echo "✅ Pre-migration snapshot saved: $SNAPSHOT_FILE"
    else
        echo "⚠️ Pre-migration snapshot skipped (database may not exist yet)"
        rm -f "$SNAPSHOT_FILE" 2>/dev/null || true
    fi

    echo "📦 Running database migrations..."

    # Run drizzle-kit migrate using the compiled config
    # Note: drizzle.config.js is compiled to dist/drizzle.config.js
    node -e "
      const { migrate } = require('drizzle-orm/postgres-js/migrator');
      const { drizzle } = require('drizzle-orm/postgres-js');
      const postgres = require('postgres');
      const fs = require('fs');

      async function runMigrations() {
        const sql = postgres(process.env.DATABASE_URL);
        const db = drizzle(sql);
        await migrate(db, { migrationsFolder: '/app/drizzle/migrations' });

        // Validate: count applied migrations vs journal entries
        const journal = JSON.parse(fs.readFileSync('/app/drizzle/migrations/meta/_journal.json', 'utf8'));
        const expectedCount = journal.entries.length;
        const [row] = await sql\`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations\`;
        const appliedCount = row.applied;

        if (appliedCount < expectedCount) {
          console.error('⚠️  MIGRATION MISMATCH: ' + appliedCount + ' applied vs ' + expectedCount + ' in journal.');
          console.error('   This usually means journal timestamps are out of order.');
          console.error('   Run: ./scripts/fix-migration-order.sh');
        } else {
          console.log('✅ Migrations completed (' + appliedCount + '/' + expectedCount + ' applied)');
        }

        await sql.end();
      }

      runMigrations().catch(err => {
        console.error('Migration error:', err);
        process.exit(1);
      });
    " 2>&1

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

