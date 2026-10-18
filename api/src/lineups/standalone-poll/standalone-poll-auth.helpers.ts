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
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
  matchId: number;
  lineupId: number;
  pollCreatorId: number;
  visibility: 'public' | 'private';
  linkedEventId: number | null;
}

/** Fetch a standalone match's ownership/linkage context, or null. */
async function fetchPollContext(
  db: Db,
  matchId: number,
): Promise<PollContext | null> {
  const [ctx] = await db
    .select({
      matchId: schema.communityLineupMatches.id,
      lineupId: schema.communityLineups.id,
      pollCreatorId: schema.communityLineups.createdBy,
      visibility: schema.communityLineups.visibility,
      linkedEventId: schema.communityLineupMatches.linkedEventId,
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
export interface Caller {
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
 * unlinked poll — the event created FROM this poll (`created_from_poll_id`,
 * stamped at creation by the create-event form's `schedulingMatchId`). Same
 * game / later creation date is not provenance. 404 when the event is gone.
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
      createdFromPollId: schema.events.createdFromPollId,
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
    ctx.linkedEventId === null && event.createdFromPollId === ctx.matchId;
  if (!fromThisPoll) {
    throw new ForbiddenException('That event was not created from this poll');
  }
}

/** ROK-1844 — `startTime` must be one of the poll's proposed slots (400). */
async function assertIsPollSlot(
  db: Db,
  matchId: number,
  startTime: string,
): Promise<void> {
  const at = new Date(startTime).getTime();
  const slots = await db
    .select({ proposedTime: schema.communityLineupScheduleSlots.proposedTime })
    .from(schema.communityLineupScheduleSlots)
    .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
  if (!slots.some((s) => s.proposedTime.getTime() === at)) {
    throw new BadRequestException("startTime is not one of this poll's slots");
  }
}

/** What a completion signs voters up to: the event and the winning slot. */
export interface CompletionTarget {
  eventId?: number | undefined;
  startTime?: string | undefined;
}

/**
 * P2 / ROK-1844 — authorize completing (locking in) a standalone poll, the
 * `eventId` its yes-voters will be signed up to and the slot (`startTime`)
 * that picks them. An unknown match is a no-op so the caller's usual 404
 * still applies.
 */
export async function assertCanCompletePoll(
  db: Db,
  matchId: number,
  caller: Caller,
  target: CompletionTarget = {},
): Promise<void> {
  const ctx = await fetchPollContext(db, matchId);
  if (!ctx) return;
  await assertMayCompletePoll(db, ctx, caller);
  if (target.eventId !== undefined) {
    await assertMayUseEvent(db, ctx, target.eventId, caller);
  }
  if (target.startTime !== undefined) {
    await assertIsPollSlot(db, matchId, target.startTime);
  }
}
