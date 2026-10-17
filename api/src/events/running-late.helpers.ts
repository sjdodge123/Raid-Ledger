/**
 * "Running late" signup-flag helpers (ROK-1379).
 *
 * A late marker is a nullable `running_late_at` timestamp on the signup row —
 * NOT a `status` enum value (late is not a change of attendance intent, so the
 * roster / auto-allocation / attendance logic stays untouched).
 *
 * Both operations are idempotent and a no-op when the user has no signup row
 * for the event (the host path is delay, not the late-marker).
 */
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/**
 * Marks an attendee as running late on their signup row.
 *
 * @returns `true` when a row was updated, `false` when already late or the
 *   user has no signup row for the event (both no-ops).
 */
export async function setRunningLate(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  minutes?: number,
): Promise<boolean> {
  const updated = await db
    .update(schema.eventSignups)
    .set({ runningLateAt: new Date(), lateMinutes: minutes ?? null })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
        isNull(schema.eventSignups.runningLateAt),
      ),
    )
    .returning({ id: schema.eventSignups.id });
  return updated.length > 0;
}

/**
 * Clears a running-late marker (voice auto-clear / "I'm here now").
 *
 * @returns `true` when a row was cleared, `false` when not currently late or
 *   the user has no signup row (both no-ops).
 */
export async function clearRunningLate(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const updated = await db
    .update(schema.eventSignups)
    .set({ runningLateAt: null, lateMinutes: null })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
        isNotNull(schema.eventSignups.runningLateAt),
      ),
    )
    .returning({ id: schema.eventSignups.id });
  return updated.length > 0;
}
