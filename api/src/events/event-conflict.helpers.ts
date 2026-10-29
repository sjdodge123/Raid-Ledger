/**
 * Shared event conflict detection (ROK-1031 Part 4).
 * Finds events that overlap a given time range for a specific user,
 * excluding cancelled events and signups that released the slot
 * (declined, roached_out, departed).
 */
import { and, eq, inArray, isNull, sql, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ACTIVE_SIGNUP_STATUSES } from '../lineups/scheduling/active-signup-statuses.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** Shape of a conflicting event returned by the query. */
export interface ConflictingEvent {
  id: number;
  title: string;
  duration: [Date, Date];
  cancelledAt: Date | null;
}

/** Parameters for the conflict detection query. */
export interface FindConflictsParams {
  userId: number;
  startTime: Date;
  endTime: Date;
  /** Exclude a specific event from results (e.g., the event being viewed). */
  excludeEventId?: number;
}

/**
 * Find events that overlap a given time range for a user.
 * Only active signups count (ACTIVE_SIGNUP_STATUSES): leaving an event within
 * 23h writes `roached_out`, which must not read as a conflict (ROK-2041).
 * @param db - Database connection
 * @param params - Conflict search parameters
 * @returns Array of conflicting events
 */
export async function findConflictingEvents(
  db: Db,
  params: FindConflictsParams,
): Promise<ConflictingEvent[]> {
  const { userId, startTime, endTime, excludeEventId } = params;
  const rangeStr = `[${startTime.toISOString()},${endTime.toISOString()})`;

  const conditions = [
    sql`${schema.events.duration} && ${rangeStr}::tsrange`,
    isNull(schema.events.cancelledAt),
    eq(schema.eventSignups.userId, userId),
    inArray(schema.eventSignups.status, [...ACTIVE_SIGNUP_STATUSES]),
  ];

  if (excludeEventId !== undefined) {
    conditions.push(ne(schema.events.id, excludeEventId));
  }

  return db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      duration: schema.events.duration,
      cancelledAt: schema.events.cancelledAt,
    })
    .from(schema.events)
    .innerJoin(
      schema.eventSignups,
      eq(schema.events.id, schema.eventSignups.eventId),
    )
    .where(and(...conditions));
}
