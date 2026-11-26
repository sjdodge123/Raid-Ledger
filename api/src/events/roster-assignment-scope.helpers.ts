/**
 * Scope a roster_assignments lookup to one event (ROK-2321).
 *
 * A roster row is keyed on (event_id, signup_id). Looking it up by signup id
 * alone would also match a row another event holds for the same signup — the
 * shape a cross-event roster PATCH could once write — and let that foreign row
 * steer this signup's bench, cancel, reconfirm or calendar logic. Every
 * signup-keyed read or delete goes through this clause instead.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

export function assignmentOfSignupInEvent(
  eventId: number,
  signupId: number,
): SQL {
  const clause = and(
    eq(schema.rosterAssignments.eventId, eventId),
    eq(schema.rosterAssignments.signupId, signupId),
  );
  // and() of two defined conditions is always defined; the guard narrows it.
  if (!clause) throw new Error('assignmentOfSignupInEvent: empty clause');
  return clause;
}

/** Whether the signup holds a roster assignment in this event (ROK-626). */
export async function hasAssignmentInEvent(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.rosterAssignments.id })
    .from(schema.rosterAssignments)
    .where(assignmentOfSignupInEvent(eventId, signupId))
    .limit(1);
  return !!row;
}
