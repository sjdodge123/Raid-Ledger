/**
 * ROK-2040 — claim-first reschedule lock-in.
 *
 * A reschedule poll used to lock in as `PATCH /events/:id/reschedule` and then
 * `POST …/complete`, so two organizers locking in at once both moved the
 * event and both emitted UPDATED; only the second `/complete` 409'd. This
 * door claims the poll first with the ROK-2032 claim
 * (`claimMatchForLockIn`, matched on the poll's own linked event) and moves
 * the event only once claimed. The loser gets the same 409
 * (`SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE`) and moves nothing.
 */
import {
  BadRequestException,
  NotFoundException,
  type Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  EventResponseDto,
  RescheduleEventDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { EventsService } from '../../events/events.service';
import {
  claimMatchForLockIn,
  releaseMatchClaim,
} from '../scheduling/scheduling-lockin-claim.helpers';
import { assertSlotIsFuture } from '../scheduling/scheduling-lock-in.helpers';
import {
  assertCanCompletePoll,
  type Caller,
} from './standalone-poll-auth.helpers';
import { clearReschedulingPollId } from './standalone-poll-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** What the reschedule lock-in needs from its service. */
export interface RescheduleLockInDeps {
  db: Db;
  eventsService: Pick<EventsService, 'reschedule'>;
  logger: Pick<Logger, 'error'>;
}

/** One reschedule lock-in request. */
export interface RescheduleLockInInput {
  matchId: number;
  caller: Caller;
  dto: RescheduleEventDto;
}

/** The moved event, as the lock-in side effects need it. */
export interface RescheduledPoll {
  event: EventResponseDto;
  eventId: number;
  eventCancelled: boolean;
}

/** The poll row a reschedule lock-in works on. */
interface RescheduleTarget {
  lineupId: number;
  eventId: number;
  eventCancelled: boolean;
}

/**
 * Claim the reschedule poll, then move its event in place (one UPDATED from
 * the move), then archive the poll and release the event's rescheduling
 * lock. A throw from the move releases the claim. Pre-claim checks (404,
 * 400, 403) do not depend on the poll's status, so a race loser always gets
 * the claim's 409.
 */
export async function rescheduleLockedInPoll(
  deps: RescheduleLockInDeps,
  input: RescheduleLockInInput,
): Promise<RescheduledPoll> {
  const { db } = deps;
  const { matchId, caller, dto } = input;
  const target = await loadRescheduleTarget(db, matchId);
  await assertCanCompletePoll(db, matchId, caller, {
    startTime: dto.startTime,
  });
  assertSlotIsFuture(dto.startTime);
  const prior = await claimMatchForLockIn(
    db,
    matchId,
    ['scheduling'],
    target.eventId,
  );
  let event: EventResponseDto;
  try {
    event = await deps.eventsService.reschedule(
      target.eventId,
      caller.id,
      caller.isAdmin,
      dto,
    );
  } catch (err: unknown) {
    await releaseMatchClaim(db, matchId, prior, deps.logger, target.eventId);
    throw err;
  }
  await archiveAndRelease(db, target);
  return {
    event,
    eventId: target.eventId,
    eventCancelled: target.eventCancelled,
  };
}

/** The poll's lineup and linked event; 404 unknown, 400 not a reschedule poll. */
async function loadRescheduleTarget(
  db: Db,
  matchId: number,
): Promise<RescheduleTarget> {
  const m = schema.communityLineupMatches;
  const [row] = await db
    .select({
      lineupId: m.lineupId,
      eventId: m.linkedEventId,
      cancelledAt: schema.events.cancelledAt,
    })
    .from(m)
    .leftJoin(schema.events, eq(schema.events.id, m.linkedEventId))
    .where(eq(m.id, matchId));
  if (!row) throw new NotFoundException('Poll not found');
  if (row.eventId === null) {
    throw new BadRequestException('This poll is not a reschedule poll');
  }
  return {
    lineupId: row.lineupId,
    eventId: row.eventId,
    eventCancelled: row.cancelledAt !== null,
  };
}

/** What `/complete` does after its flip: archive the lineup, release the lock. */
async function archiveAndRelease(
  db: Db,
  target: RescheduleTarget,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, target.lineupId));
    await clearReschedulingPollId(tx, target.eventId);
  });
}
