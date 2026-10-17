/**
 * ROK-1593: the Calendar Sync kill switch read straight from `app_settings`
 * for the query layer (`calendar-busy-query.helpers.ts`), which has a db
 * handle but no `SettingsService`, and for the derive, which reads it on its
 * transaction after its locks (`runCalendarDerive`). Same decision as everywhere else —
 * `getCalendarSyncEnabled` — over the decrypted stored value. A missing or
 * undecryptable row reads as OFF (the switch defaults off).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ReadSyncTx } from './calendar-read-sync.helpers';
import type { SettingKey } from '../../drizzle/schema';
import { decrypt } from '../../settings/encryption.util';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';

/** A top-level db or a transaction — the read runs on whichever is given. */
type Db = PostgresJsDatabase<typeof schema> | ReadSyncTx;

async function readSetting(db: Db, key: SettingKey): Promise<string | null> {
  const t = schema.appSettings;
  const [row] = await db
    .select({ value: t.encryptedValue })
    .from(t)
    .where(eq(t.key, key))
    .limit(1);
  if (!row) return null;
  try {
    return decrypt(row.value);
  } catch {
    return null;
  }
}

/** Whether Calendar Sync is on, from the database or `tx` (no settings cache). */
export function readCalendarSyncEnabled(db: Db): Promise<boolean> {
  return getCalendarSyncEnabled({ get: (key) => readSetting(db, key) });
}
