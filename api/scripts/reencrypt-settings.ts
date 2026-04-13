#!/usr/bin/env ts-node
/**
 * Re-encrypt Settings Script (ROK-1035)
 *
 * Decrypts all app_settings.encryptedValue rows with the old key and
 * re-encrypts them with a new key. Used during JWT_SECRET migration
 * from the hardcoded default to an auto-generated secret.
 *
 * Usage (standalone):
 *   node dist/scripts/reencrypt-settings.js --old-secret <old> --new-secret <new>
 *
 * The exported `reencryptAllSettings` function is also used by integration tests.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { appSettings } from '../src/drizzle/schema';
import {
  deriveKey,
  encryptWithKey,
  decryptWithKey,
} from '../src/settings/encryption.util';

/** Minimal DB interface for re-encryption (accepts any Drizzle schema). */
type DrizzleDb = PostgresJsDatabase<Record<string, unknown>>;

/** Row shape returned by select from appSettings. */
interface SettingsRow {
  id: number;
  key: string;
  encryptedValue: string;
}

/**
 * Re-encrypts all app_settings rows from oldKey to newKey.
 * Returns the number of successfully re-encrypted rows.
 * Rows that can't be decrypted with oldKey are skipped (logged).
 */
export async function reencryptAllSettings(
  db: DrizzleDb,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<number> {
  const rows: SettingsRow[] = await db.select().from(appSettings);

  if (rows.length === 0) {
    console.log('[reencrypt] No app_settings rows found. Nothing to do.');
    return 0;
  }

  console.log(`[reencrypt] Found ${rows.length} app_settings row(s).`);

  let successCount = 0;
  let skipCount = 0;

  for (const row of rows) {
    const result = await reencryptRow(db, row, oldKey, newKey);
    if (result) {
      successCount++;
    } else {
      skipCount++;
    }
  }

  logSummary(successCount, skipCount);
  return successCount;
}

/** Re-encrypt a single row. Returns true on success, false on skip. */
async function reencryptRow(
  db: DrizzleDb,
  row: SettingsRow,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<boolean> {
  try {
    const plaintext = decryptWithKey(row.encryptedValue, oldKey);
    const newCiphertext = encryptWithKey(plaintext, newKey);
    await db
      .update(appSettings)
      .set({ encryptedValue: newCiphertext })
      .where(eq(appSettings.id, row.id));
    console.log(`[reencrypt]   ✅ ${row.key} — re-encrypted`);
    return true;
  } catch {
    console.log(
      `[reencrypt]   ⏭️  ${row.key} — skipped (could not decrypt with old key)`,
    );
    return false;
  }
}

function logSummary(success: number, skipped: number): void {
  console.log('🔐 JWT_SECRET MIGRATION COMPLETE');
  console.log(`   Succeeded: ${success}/${success + skipped}`);
  console.log(`   Skipped: ${skipped}`);
  if (skipped > 0) {
    console.log('   ⚠️  Skipped rows were already encrypted with a different key');
  }
  console.log('');
  console.log('   ⚠️  RECOVERY NOTE: If you restore a database backup from before');
  console.log('   this migration, you must either:');
  console.log('     1. Delete /data/.jwt_secret_migrated to re-run on next startup');
  console.log('     2. Set JWT_SECRET to the old default to decrypt old backups:');
  console.log('        -e JWT_SECRET=raid-ledger-default-secret-change-in-production');
}

/** Parse --old-secret and --new-secret from CLI args. */
function parseCliArgs(): { oldSecret: string; newSecret: string } {
  const args = process.argv.slice(2);
  const oldIdx = args.indexOf('--old-secret');
  const newIdx = args.indexOf('--new-secret');

  if (oldIdx === -1 || newIdx === -1) {
    console.error(
      'Usage: node reencrypt-settings.js --old-secret <old> --new-secret <new>',
    );
    process.exit(1);
  }

  return {
    oldSecret: args[oldIdx + 1],
    newSecret: args[newIdx + 1],
  };
}

/** Standalone entry point — only runs when executed directly. */
async function main(): Promise<void> {
  const { oldSecret, newSecret } = parseCliArgs();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('🔐 JWT_SECRET MIGRATION STARTED');
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log(`   Old secret (hardcoded default): ${oldSecret}`);
  console.log(`   New secret: ${newSecret}`);
  console.log(`   New secret file: /data/.jwt_secret`);

  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);

  const sql = postgres(databaseUrl);
  const db = drizzle(sql);

  try {
    await reencryptAllSettings(db, oldKey, newKey);
  } finally {
    await sql.end();
  }
}

// Run main() only when executed directly (not when imported by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error('[reencrypt] Fatal error:', err);
    process.exit(1);
  });
}
