/**
 * Authorization helpers for standalone reschedule polls (ROK-1370).
 *
 * Opening a poll linked to an event is destructive — it flips the event's embed
 * to RESCHEDULING, tears down its Discord Scheduled Event, and suppresses its
 * reminder/start/completion/role-gap scans — and completing one re-emits
 * UPDATED (embed → POSTED, SE recreated). The pre-existing endpoints only
 * checked existence, so any authenticated user could target another user's
 * event; these guards restrict the destructive paths to the event/poll owner
 * or an admin. (Unlinked standalone polls stay non-destructive and unchanged.)
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Fetch an event's creatorId, or null when the event does not exist. */
async function findEventCreatorId(
  db: Db,
  eventId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ creatorId: schema.events.creatorId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row?.creatorId ?? null;
}

/**
 * P1 — authorize opening a reschedule poll against `eventId`. 404 when the
 * event is gone (preserves the pre-existing not-found contract), 403 unless the
 * caller owns the event or is an admin.
 */
export async function assertCanRescheduleEvent(
  db: Db,
  eventId: number,
  userId: number,
  isAdmin: boolean,
): Promise<void> {
  const creatorId = await findEventCreatorId(db, eventId);
  if (creatorId === null) throw new NotFoundException('Event not found');
  if (creatorId !== userId && !isAdmin) {
    throw new ForbiddenException('You can only reschedule your own events');
  }
}

/** Fetch a standalone match's linked event + poll creator, or null. */
async function fetchLinkedPollContext(
  db: Db,
  matchId: number,
): Promise<{ linkedEventId: number | null; pollCreatorId: number } | null> {
  const [ctx] = await db
    .select({
      linkedEventId: schema.communityLineupMatches.linkedEventId,
      pollCreatorId: schema.communityLineups.createdBy,
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.communityLineups,
      eq(schema.communityLineups.id, schema.communityLineupMatches.lineupId),
    )
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        sql`${schema.communityLineups.phaseDurationOverride}->>'standalone' = 'true'`,
      ),
    )
    .limit(1);
  return ctx ?? null;
}

/**
 * P2 — authorize completing (locking in) a reschedule poll. Unknown match or a
 * poll NOT linked to an event → no-op (unknown falls through to the usual 404;
 * unlinked standalone completion is non-destructive and unchanged). A LINKED
 * poll may only be completed by the poll creator, the linked event's creator,
 * or an admin.
 */
export async function assertCanCompletePoll(
  db: Db,
  matchId: number,
  userId: number,
  isAdmin: boolean,
): Promise<void> {
  const ctx = await fetchLinkedPollContext(db, matchId);
  if (!ctx || ctx.linkedEventId === null) return;
  if (isAdmin || userId === ctx.pollCreatorId) return;
  const eventCreatorId = await findEventCreatorId(db, ctx.linkedEventId);
  if (userId === eventCreatorId) return;
  throw new ForbiddenException(
    'Only the poll or event owner can lock in this reschedule',
  );
}
