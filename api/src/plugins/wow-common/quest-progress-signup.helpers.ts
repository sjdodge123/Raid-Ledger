import { ForbiddenException } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { INACTIVE_SIGNUP_STATUSES } from './event-forever-progress.query';

/**
 * ROK-1757: quest progress is per-event roster state — only a user with an
 * active signup on the event may write it. Without this any member could
 * plant rows on any event id and pollute that event's quest coverage.
 */
export async function assertActiveSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<void> {
  const s = schema.eventSignups;
  const [row] = await db
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        eq(s.eventId, eventId),
        eq(s.userId, userId),
        notInArray(s.status, INACTIVE_SIGNUP_STATUSES),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ForbiddenException(
      'You must be signed up to this event to track quest progress',
    );
  }
}
