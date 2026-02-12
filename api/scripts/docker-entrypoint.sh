#!/bin/sh
set -e

echo "🚀 Starting Raid-Ledger API..."

# Run database migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
    echo "📦 Running database migrations..."
    
    # Run drizzle-kit migrate using the compiled config
    # Note: drizzle.config.js is compiled to dist/drizzle.config.js
    node -e "
      const { migrate } = require('drizzle-orm/postgres-js/migrator');
      const { drizzle } = require('drizzle-orm/postgres-js');
      const postgres = require('postgres');
      
      async function runMigrations() {
        const sql = postgres(process.env.DATABASE_URL);
        const db = drizzle(sql);
        await migrate(db, { migrationsFolder: '/app/drizzle/migrations' });
        await sql.end();
        console.log('✅ Migrations completed');
      }
      
      runMigrations().catch(err => {
        console.error('Migration error:', err);
        process.exit(1);
      });
    " 2>&1

    echo "✅ Migrations complete"

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

fi

# Execute the main command
echo "🎮 Starting server..."
exec "$@"

