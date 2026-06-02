import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/**
 * Resolve a single user's IANA timezone preference for DM/ephemeral rendering.
 *
 * Resolution chain (ROK-1112):
 *   1. Per-user `user_preferences` row, key='timezone' — used unless null/empty
 *      or the `'auto'` sentinel.
 *   2. The provided guild default.
 *   3. (Caller's responsibility) pass 'UTC' as `defaultTimezone` for the final
 *      fallback when no guild default is configured.
 *
 * This is the single-user generalization of
 * `RoleGapAlertService.resolveCreatorTimezone` and mirrors the 'auto'→default
 * handling in `fetchUserTimezones` (event-reminder.helpers).
 */
export async function resolveUserTimezone(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  defaultTimezone: string,
): Promise<string> {
  const rows = await db
    .select({ value: schema.userPreferences.value })
    .from(schema.userPreferences)
    .where(
      and(
        eq(schema.userPreferences.key, 'timezone'),
        eq(schema.userPreferences.userId, userId),
      ),
    );

  if (rows.length === 0) return defaultTimezone;
  const tz = rows[0].value as string;
  return tz && tz !== 'auto' ? tz : defaultTimezone;
}
