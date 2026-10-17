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

/** A poll slot's conflicting-event titles, for the conflict-warning tooltip (ROK-1032). */
export interface SlotConflict {
  slotId: number;
  eventTitles: string[];
}

/**
 * For each poll slot, find the TITLES of the user's existing events that overlap
 * it (assuming a 2-hour event duration). Slots with no conflict are omitted.
 * Drives the "⚠ Conflicts with <event>" hover tooltip on the poll grid (ROK-1032).
 */
export async function findSlotConflicts(
  db: Db,
  userId: number,
  slots: SlotLike[],
): Promise<SlotConflict[]> {
  const result: SlotConflict[] = [];
  for (const slot of slots) {
    const startTime = new Date(slot.proposedTime);
    const endTime = new Date(startTime.getTime() + EVENT_DURATION_MS);
    const conflicts = await findConflictingEvents(db, {
      userId,
      startTime,
      endTime,
    });
    if (conflicts.length > 0) {
      result.push({
        slotId: slot.id,
        eventTitles: conflicts.map((c) => c.title),
      });
    }
  }
  return result;
}

/**
 * Find which poll slot IDs conflict with the user's existing events (ROK-1031).
 * Thin wrapper over {@link findSlotConflicts} for callers that only need IDs.
 */
export async function findConflictingSlotIds(
  db: Db,
  userId: number,
  slots: SlotLike[],
): Promise<number[]> {
  return (await findSlotConflicts(db, userId, slots)).map((c) => c.slotId);
}
