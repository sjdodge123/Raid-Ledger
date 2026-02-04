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
        await migrate(db, { migrationsFolder: './drizzle/migrations' });
        await sql.end();
        console.log('✅ Migrations completed');
      }
      
      runMigrations().catch(err => {
        console.error('Migration error:', err);
        process.exit(1);
      });
    " 2>&1 || {
        echo "⚠️ Migration failed, continuing anyway"
    }
    
    echo "✅ Migrations check complete"

    # Bootstrap admin account on first run using compiled JS
    echo "👤 Checking for initial admin account..."
    node ./dist/scripts/bootstrap-admin.js 2>&1 || {
        echo "ℹ️ Bootstrap skipped (may already exist or failed)"
    }
fi

# Execute the main command
echo "🎮 Starting server..."
exec "$@"
