/**
 * Conflict warning helpers for Discord signup ephemeral replies (ROK-1031).
 * Appended to the signup success message when the user has overlapping events.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  findConflictingEvents,
  type ConflictingEvent,
} from '../../events/event-conflict.helpers';

/** Format conflict titles into a warning suffix. */
export function buildConflictWarning(conflicts: ConflictingEvent[]): string {
  if (conflicts.length === 0) return '';
  const titles = conflicts.map((c) => `**${c.title}**`).join(', ');
  return `\n⚠️ Note: you also have ${titles} at this time.`;
}

/** Fetch conflict warning suffix for a signup reply. Swallows errors. */
export async function getConflictSuffix(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  eventId: number,
): Promise<string> {
  try {
    const [event] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event) return '';
    const conflicts = await findConflictingEvents(db, {
      userId,
      startTime: event.duration[0],
      endTime: event.duration[1],
      excludeEventId: eventId,
    });
    return buildConflictWarning(conflicts);
  } catch {
    return '';
  }
}
