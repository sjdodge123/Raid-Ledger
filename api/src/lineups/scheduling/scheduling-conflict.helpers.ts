/**
 * Scheduling-specific conflict detection wrapper (ROK-1031).
 * Wraps the shared findConflictingEvents helper for poll slot context.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { findConflictingEvents } from '../../events/event-conflict.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Minimal slot shape needed for conflict detection. */
interface SlotLike {
  id: number;
  proposedTime: Date;
}

/** Default event duration for conflict range calculation (2 hours). */
const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

/**
 * Find which poll slot IDs conflict with the user's existing events.
 * For each slot, checks if an event with a 2-hour duration would overlap
 * any event the user is signed up for.
 * @param db - Database connection
 * @param userId - Authenticated user ID
 * @param slots - Schedule slots to check
 * @returns Array of slot IDs that have conflicts
 */
export async function findConflictingSlotIds(
  db: Db,
  userId: number,
  slots: SlotLike[],
): Promise<number[]> {
  const conflicting: number[] = [];
  for (const slot of slots) {
    const startTime = new Date(slot.proposedTime);
    const endTime = new Date(startTime.getTime() + EVENT_DURATION_MS);
    const conflicts = await findConflictingEvents(db, {
      userId,
      startTime,
      endTime,
    });
    if (conflicts.length > 0) {
      conflicting.push(slot.id);
    }
  }
  return conflicting;
}
