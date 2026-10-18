/**
 * Authorization helpers for standalone reschedule polls (ROK-1370).
 *
 * Opening a poll linked to an event is destructive — it flips the event's embed
 * to RESCHEDULING, tears down its Discord Scheduled Event, and suppresses its
 * reminder/start/completion/role-gap scans — and completing one re-emits
 * UPDATED (embed → POSTED, SE recreated). The pre-existing endpoints only
 * checked existence, so any authenticated user could target another user's
 * event; these guards restrict the destructive paths to the event/poll owner
 * or an admin.
 *
 * ROK-1844: completing an UNLINKED poll is not harmless either — it closes the
 * poll for everyone and, with an `eventId`, signs every yes-voter onto that
 * event, hearts the game and DMs them. Every completion is now owner/staff
 * only, and the `eventId` must be the caller's and come from this poll.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { assertCallerMayViewPoll } from '../scheduling/scheduling-guard.helpers';

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

/** What the completion guard needs to know about a standalone poll. */
interface PollContext {
  lineupId: number;
  pollCreatorId: number;
  visibility: 'public' | 'private';
  linkedEventId: number | null;
  gameId: number;
  openedAt: Date;
}

/** Fetch a standalone match's ownership/linkage context, or null. */
async function fetchPollContext(
  db: Db,
  matchId: number,
): Promise<PollContext | null> {
  const [ctx] = await db
    .select({
      lineupId: schema.communityLineups.id,
      pollCreatorId: schema.communityLineups.createdBy,
      visibility: schema.communityLineups.visibility,
      linkedEventId: schema.communityLineupMatches.linkedEventId,
      gameId: schema.communityLineupMatches.gameId,
      openedAt: schema.communityLineupMatches.createdAt,
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

/** The caller of a completion: their id and whether they are staff. */
interface Caller {
  id: number;
  isAdmin: boolean;
}

/**
 * AC1 — the poll creator, the linked event's creator or staff may complete.
 * Anyone else gets 403, or the private-poll 404 when they cannot even view it.
 */
async function assertMayCompletePoll(
  db: Db,
  ctx: PollContext,
  caller: Caller,
): Promise<void> {
  if (caller.isAdmin || caller.id === ctx.pollCreatorId) return;
  if (ctx.linkedEventId !== null) {
    const eventCreatorId = await findEventCreatorId(db, ctx.linkedEventId);
    if (caller.id === eventCreatorId) return;
  }
  await assertCallerMayViewPoll(
    db,
    {
      id: ctx.lineupId,
      createdBy: ctx.pollCreatorId,
      visibility: ctx.visibility,
    },
    { id: caller.id },
  );
  throw new ForbiddenException('Only the poll owner can lock in this poll');
}

/**
 * AC3 — the event the yes-voters are signed up to must be the caller's (or
 * staff's) and must come from this poll: its linked event, or — for an
 * unlinked poll — an event for the poll's game created after the poll opened
 * (the create-event form's lock-in path). 404 when the event is gone.
 */
async function assertMayUseEvent(
  db: Db,
  ctx: PollContext,
  eventId: number,
  caller: Caller,
): Promise<void> {
  const [event] = await db
    .select({
      creatorId: schema.events.creatorId,
      gameId: schema.events.gameId,
      createdAt: schema.events.createdAt,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) throw new NotFoundException('Event not found');
  if (!caller.isAdmin && event.creatorId !== caller.id) {
    throw new ForbiddenException(
      'You can only sign voters up to your own event',
    );
  }
  if (eventId === ctx.linkedEventId) return;
  const fromThisPoll =
    ctx.linkedEventId === null &&
    event.gameId === ctx.gameId &&
    event.createdAt >= ctx.openedAt;
  if (!fromThisPoll) {
    throw new ForbiddenException('That event was not created from this poll');
  }
}

/**
 * P2 / ROK-1844 — authorize completing (locking in) a standalone poll, and the
 * `eventId` its yes-voters will be signed up to. An unknown match is a no-op
 * so the caller's usual 404 still applies.
 */
export async function assertCanCompletePoll(
  db: Db,
  matchId: number,
  userId: number,
  isAdmin: boolean,
  eventId?: number,
): Promise<void> {
  const ctx = await fetchPollContext(db, matchId);
  if (!ctx) return;
  const caller = { id: userId, isAdmin };
  await assertMayCompletePoll(db, ctx, caller);
  if (eventId !== undefined) await assertMayUseEvent(db, ctx, eventId, caller);
}
