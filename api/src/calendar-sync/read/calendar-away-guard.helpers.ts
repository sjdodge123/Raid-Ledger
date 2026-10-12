/**
 * ROK-1593 PR-B review MAJOR-1 (derive half): what `runCalendarDerive` does
 * right after taking the per-user advisory lock, so a derive can never
 * re-create synced away days behind the kill-switch purge.
 *
 * 1. `lockUserConnections` — `FOR KEY SHARE` on ALL of the user's connection
 *    rows in id order (the purge locks them `FOR UPDATE` in the same order).
 *    A purge in flight therefore makes the derive wait until it commits; a
 *    derive that got there first makes the purge wait until the derive
 *    commits, and the purge then deletes what the derive wrote.
 * 2. `readCalendarSyncEnabledOn(tx)` — the kill switch read AFTER those locks
 *    (READ COMMITTED: a fresh snapshot per statement, so a committed purge
 *    is visible). Off → `purgeCalendarAbsences` and no insert at all.
 *
 * Every statement runs on the caller's `tx`. Manual rows are never touched.
 */
import { and, asc, eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { SettingKey } from '../../drizzle/schema';
import { decrypt } from '../../settings/encryption.util';
import { getCalendarSyncEnabled } from '../../settings/settings-calendar-sync.helpers';
import type { ReadSyncTx } from './calendar-read-sync.helpers';

/** `FOR KEY SHARE` on every connection row of `userId`, lowest id first. */
export async function lockUserConnections(
  tx: ReadSyncTx,
  userId: number,
): Promise<void> {
  const c = schema.calendarConnections;
  await tx
    .select({ id: c.id })
    .from(c)
    .where(eq(c.userId, userId))
    .orderBy(asc(c.id))
    .for('key share');
}

async function readSettingOn(
  tx: ReadSyncTx,
  key: SettingKey,
): Promise<string | null> {
  const t = schema.appSettings;
  const [row] = await tx
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

/**
 * The kill switch read on `tx` — same decision as `readCalendarSyncEnabled`
 * (`calendar-sync-enabled.query.ts`), which only accepts a top-level db.
 * A missing or undecryptable row reads as OFF.
 */
export function readCalendarSyncEnabledOn(tx: ReadSyncTx): Promise<boolean> {
  return getCalendarSyncEnabled({ get: (key) => readSettingOn(tx, key) });
}

/** Delete every synced (`source='calendar'`) absence of `userId`; returns the count. */
export async function purgeCalendarAbsences(
  tx: ReadSyncTx,
  userId: number,
): Promise<number> {
  const a = schema.gameTimeAbsences;
  const deleted = await tx
    .delete(a)
    .where(and(eq(a.userId, userId), eq(a.source, 'calendar')))
    .returning({ id: a.id });
  return deleted.length;
}
