import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

/**
 * Pure resolution gate for ephemeral voice channels (ROK-1352).
 *
 * Resolution order (spec AC2):
 *   1. Global master toggle off    → false  (master gate)
 *   2. Per-event override non-null  → use it (override wins)
 *   3. else per-series flag true    → true
 *   4. else                         → false (default off)
 *
 * Takes already-resolved inputs so it is unit-testable with no infrastructure.
 */
export function shouldCreateEphemeralChannel(
  globalEnabled: boolean,
  eventOverride: boolean | null,
  seriesEnabled: boolean,
): boolean {
  if (!globalEnabled) return false;
  if (eventOverride !== null) return eventOverride;
  return seriesEnabled;
}

/**
 * Look up whether a series (recurrence group) has opted into ephemeral voice.
 * Returns false when no `recurrenceGroupId` or no settings row exists.
 */
export async function fetchSeriesEphemeralEnabled(
  db: PostgresJsDatabase<typeof schema>,
  recurrenceGroupId: string | null | undefined,
): Promise<boolean> {
  if (!recurrenceGroupId) return false;
  const [row] = await db
    .select({ enabled: schema.eventSeriesSettings.ephemeralVoiceEnabled })
    .from(schema.eventSeriesSettings)
    .where(eq(schema.eventSeriesSettings.recurrenceGroupId, recurrenceGroupId))
    .limit(1);
  return row?.enabled ?? false;
}
