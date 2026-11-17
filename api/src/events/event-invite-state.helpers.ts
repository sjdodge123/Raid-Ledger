/**
 * ROK-2217 review round 1: event-state and repeat-invite checks for member
 * invites. Kept apart from event-invite.helpers.ts so that file stays small.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** The 400 for an invite to a cancelled event. */
export const INVITE_EVENT_CANCELLED_MESSAGE = 'This event is cancelled';
/** The 400 for an invite to an event that has already ended. */
export const INVITE_EVENT_ENDED_MESSAGE = 'This event has ended';
/** Title every member-invite notification carries (see emitMemberInvite). */
export const MEMBER_INVITE_TITLE = 'Event Invitation';

/**
 * Refuses member invites to a cancelled or ended event — for managers too.
 * The web hides the button there; this is the server-side rule.
 */
export function assertEventOpenForInvites(
  event: { cancelledAt?: string | null | undefined; endTime: string },
  now: Date = new Date(),
): void {
  if (event.cancelledAt) {
    throw new BadRequestException(INVITE_EVENT_CANCELLED_MESSAGE);
  }
  if (new Date(event.endTime).getTime() <= now.getTime()) {
    throw new BadRequestException(INVITE_EVENT_ENDED_MESSAGE);
  }
}

/**
 * True when `userId` already holds an unexpired member-invite notification
 * for `eventId`, from anyone. A signed-up invitee is refused earlier (400),
 * so an existing invite here is one still unanswered.
 */
export async function hasPendingMemberInvite(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const n = schema.notifications;
  const [row] = await db
    .select({ id: n.id })
    .from(n)
    .where(
      and(
        eq(n.userId, userId),
        eq(n.type, 'new_event'),
        eq(n.title, MEMBER_INVITE_TITLE),
        sql`${n.payload}->>'eventId' = ${String(eventId)}`,
        or(isNull(n.expiresAt), gt(n.expiresAt, now)),
      ),
    )
    .limit(1);
  return row !== undefined;
}
