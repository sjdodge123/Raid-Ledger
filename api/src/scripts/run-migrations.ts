/**
 * Plain programmatic Migration Runner (`db:migrate` CLI).
 *
 * Runs Drizzle migrations programmatically via `drizzle-orm/postgres-js/migrator`
 * (NOT the drizzle-kit CLI — that path silently swallows errors per upstream
 * issues drizzle-team/drizzle-orm#5601, #5521, #5520).
 *
 * Role vs. the boot runner (ROK-1322):
 *   This is the LEAN migrate primitive: `migrate()` + Sentry capture, nothing
 *   more. It does NOT refresh `games_dedup_audit` or run `validateMigrationState`.
 *   The BOOT + RESTORE paths deliberately use the richer
 *   `api/scripts/run-migrations-with-sentry.ts::runBootMigrations`, which wraps
 *   this migrate step with the pre-migrate dedup-audit refresh and post-migrate
 *   validation. Do NOT re-point boot/restore back here — that would drop the
 *   ROK-1278 incident-prevention refresh.
 *
 * Still used by (so this file is NOT callerless — do not delete):
 *   - `api/package.json` -> `db:migrate` (local dev / operator-driven)
 *   - `scripts/validate-migrations.sh` documents this runner as the boot-time
 *     equivalent it mirrors via psql (see that script's header comment)
 *
 * ROK-1343: Sentry-instrumented + safe-to-import (`require.main === module`
 * guard) so the unit test can verify the capture contract without forking.
 */
import '../sentry/instrument'; // MUST be first — installs Sentry handlers
import * as Sentry from '@sentry/nestjs';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export async function runMigrations(migrationsFolder?: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Default matches `api/drizzle.config.ts` `out:` — migrations live at
  // `api/src/drizzle/migrations` in source. The allinone image overrides this
  // to `/app/drizzle/migrations` via the MIGRATIONS_FOLDER env var (see
  // docker-entrypoint.sh).
  const folder =
    migrationsFolder ??
    process.env.MIGRATIONS_FOLDER ??
    './src/drizzle/migrations';

  console.log('📦 Connecting to database...');

  const migrationClient = postgres(databaseUrl, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    console.log(`🔄 Running migrations from ${folder}...`);
    await migrate(db, { migrationsFolder: folder });
    console.log('✅ Migrations completed successfully');
  } finally {
    await migrationClient.end();
  }
}

/**
 * Capture a restore-time migration failure to Sentry, wait for the event to
 * flush, then return. Extracted from the script's catch handler so the
 * Sentry-capture contract is unit-testable without forking a Node process.
 */
export async function reportMigrationFailure(err: unknown): Promise<void> {
  console.error('❌ Migration failed:', err);
  Sentry.captureException(err, { tags: { context: 'restore-migration' } });
  await Sentry.flush(2000);
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(async (err) => {
      await reportMigrationFailure(err);
      process.exit(1);
    });
}
