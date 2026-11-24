/**
 * ROK-2315: the community default timezone (`DEFAULT_TIMEZONE`) read
 * straight from `app_settings` for the poll thread reconciler, which runs on
 * a db handle or transaction with no `SettingsService` (same pattern as
 * `calendar-sync-enabled.query.ts`). A plain poll's dated title reads its
 * close date in this zone, as the Discord post does through the settings
 * cache. A missing or undecryptable row reads as null (⇒ UTC).
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema';
import { decrypt } from '../../../settings/encryption.util';
import type { DbOrTx } from '../event-discussion/event-discussion.queries';

/** The community timezone from the database or `tx`; null when unset. */
export async function readCommunityTimeZone(
  db: DbOrTx,
): Promise<string | null> {
  const t = schema.appSettings;
  const [row] = await db
    .select({ value: t.encryptedValue })
    .from(t)
    .where(eq(t.key, SETTING_KEYS.DEFAULT_TIMEZONE))
    .limit(1);
  if (!row) return null;
  try {
    return decrypt(row.value);
  } catch {
    return null;
  }
}
