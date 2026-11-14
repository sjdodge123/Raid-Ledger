/**
 * Integration-suite migrations, shared by the jest globalSetup and the
 * per-file `test-app.ts::setupDatabase`. ROK-2196.
 *
 * On CI the globalSetup migrates the shard's one shared DB ONCE and records
 * its URL in `MIGRATED_TEST_DB_URL_ENV`. Every spec file then skips its own
 * `migrate()` for that exact URL instead of re-reading and re-hashing every
 * migration file. A spec that boots against any other DB still migrates it.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as path from 'path';
import postgres from 'postgres';

/** URL of the DB the globalSetup already migrated in this jest run. */
export const MIGRATED_TEST_DB_URL_ENV = 'RL_INTEGRATION_MIGRATED_DB_URL';

const MIGRATIONS_FOLDER = path.join(__dirname, '../../drizzle/migrations');

/** Apply every pending migration to `connectionString` (idempotent). */
export async function runTestMigrations(
  connectionString: string,
): Promise<void> {
  const client = postgres(connectionString, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

/** Record that `connectionString` is migrated for the rest of this run. */
export function markTestDbMigrated(connectionString: string): void {
  process.env[MIGRATED_TEST_DB_URL_ENV] = connectionString;
}

/** True only when the globalSetup migrated this exact DB in this run. */
export function isTestDbMigrated(connectionString: string): boolean {
  return (
    connectionString !== '' &&
    process.env[MIGRATED_TEST_DB_URL_ENV] === connectionString
  );
}

/** Migrate `connectionString` unless the globalSetup already did. */
export async function ensureTestDbMigrated(
  connectionString: string,
): Promise<void> {
  if (isTestDbMigrated(connectionString)) return;
  await runTestMigrations(connectionString);
}
