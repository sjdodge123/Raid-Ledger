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
  ForbiddenException,
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
  type ClaimedFromStatus,
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
  eventsService: Pick<EventsService, 'reschedule' | 'findOne'>;
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
  eventCreatorId: number | null;
  eventCancelled: boolean;
}

/**
 * Claim the reschedule poll, then move its event in place (one UPDATED from
 * the move), then archive the poll and release the event's rescheduling
 * lock. A throw before the move commits releases the claim; one after it
 * keeps the claim and finishes the lock-in. Pre-claim checks (404, 400, 403 —
 * including the event-owner check, so an unauthorised caller never holds the
 * claim) do not depend on the poll's status, so a race loser always gets the
 * claim's 409.
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
  assertMayMoveEvent(target, caller);
  assertSlotIsFuture(dto.startTime);
  const prior = await claimMatchForLockIn(
    db,
    matchId,
    ['scheduling'],
    target.eventId,
  );
  const moved = await moveOrRelease(deps, input, target, prior);
  await archiveOrLog(deps, matchId, target);
  const event = moved ?? (await deps.eventsService.findOne(target.eventId));
  return {
    event,
    eventId: target.eventId,
    eventCancelled: target.eventCancelled,
  };
}

/** `rescheduleEvent`'s owner-or-admin rule, checked before the claim. */
function assertMayMoveEvent(target: RescheduleTarget, caller: Caller): void {
  if (caller.isAdmin || caller.id === target.eventCreatorId) return;
  throw new ForbiddenException('You can only reschedule your own events');
}

/**
 * Move the claimed poll's event. A throw before the move commits puts the
 * claim back and rethrows; a throw after it (activity log, re-read) keeps the
 * claim and returns null — releasing would let a retry move the event again
 * and notify everyone twice.
 */
async function moveOrRelease(
  deps: RescheduleLockInDeps,
  input: RescheduleLockInInput,
  target: RescheduleTarget,
  prior: ClaimedFromStatus,
): Promise<EventResponseDto | null> {
  const { matchId, caller, dto } = input;
  try {
    return await deps.eventsService.reschedule(
      target.eventId,
      caller.id,
      caller.isAdmin,
      dto,
    );
  } catch (err: unknown) {
    if (await movedAnyway(deps, input, target.eventId, err)) return null;
    await releaseMatchClaim(
      deps.db,
      matchId,
      prior,
      deps.logger,
      target.eventId,
    );
    throw err;
  }
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
      eventCreatorId: schema.events.creatorId,
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
    eventCreatorId: row.eventCreatorId,
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

/** Archive + release, logged on failure so `afterComplete` still runs. */
async function archiveOrLog(
  deps: RescheduleLockInDeps,
  matchId: number,
  target: RescheduleTarget,
): Promise<void> {
  try {
    await archiveAndRelease(deps.db, target);
  } catch (err: unknown) {
    // Not rethrown: the event moved and the claim holds, so a retry can only
    // 409; `afterComplete` must still re-emit. The stale lock is ROK-2033's.
    deps.logger.error(
      `Reschedule lock-in ${matchId}: archive/release failed: ${String(err)}`,
    );
  }
}

/** True when the event already starts at `startTime` (the move committed). */
async function eventStartsAt(
  db: Db,
  eventId: number,
  startTime: string,
): Promise<boolean> {
  const [row] = await db
    .select({ duration: schema.events.duration })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return row?.duration[0].getTime() === new Date(startTime).getTime();
}

/** After a reschedule throw: did the move commit anyway? Logs when it did. */
async function movedAnyway(
  deps: RescheduleLockInDeps,
  input: RescheduleLockInInput,
  eventId: number,
  err: unknown,
): Promise<boolean> {
  if (!(await eventStartsAt(deps.db, eventId, input.dto.startTime))) {
    return false;
  }
  deps.logger.error(
    `Reschedule lock-in ${input.matchId}: moved, then ${String(err)}`,
  );
  return true;
}
