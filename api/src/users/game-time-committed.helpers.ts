/**
 * Committed template slot helpers for GameTimeService.
 * Extracted from game-time.service.ts for file size compliance (ROK-719).
 */
import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Fetch signed-up events within the next 2 weeks. */
export async function fetchUpcomingSignedUpEvents(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<Array<{ duration: [Date, Date] }>> {
  const now = new Date();
  const twoWeeksLater = new Date(now);
  twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
  const rangeStr = `[${now.toISOString()},${twoWeeksLater.toISOString()})`;
  return db
    .select({ duration: schema.events.duration })
    .from(schema.eventSignups)
    .innerJoin(schema.events, eq(schema.eventSignups.eventId, schema.events.id))
    .where(
      and(
        eq(schema.eventSignups.userId, userId),
        sql`${schema.events.duration} && ${rangeStr}::tsrange`,
      ),
    );
}

/** Convert event durations to DB-convention day:hour keys. */
export function buildCommittedDbKeys(
  events: Array<{ duration: [Date, Date] }>,
): Set<string> {
  const committedKeys = new Set<string>();
  for (const event of events) {
    const [eventStart, eventEnd] = event.duration;
    const cursor = new Date(eventStart);
    cursor.setUTCMinutes(0, 0, 0);
    if (cursor < eventStart) cursor.setUTCHours(cursor.getUTCHours() + 1);
    while (cursor < eventEnd) {
      const dbDay = (cursor.getUTCDay() + 6) % 7;
      committedKeys.add(`${dbDay}:${cursor.getUTCHours()}`);
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }
  }
  return committedKeys;
}
