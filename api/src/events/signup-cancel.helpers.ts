import { eq, and, ne } from 'drizzle-orm';
import { Logger, NotFoundException } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { reslotTentativePlayer } from './signup-tentative-reslot.helpers';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';

const logger = new Logger('SignupCancel');

type SignupRow = typeof schema.eventSignups.$inferSelect;
type AssignmentRow = typeof schema.rosterAssignments.$inferSelect;

function buildActiveFilter(eventId: number) {
  return and(
    eq(schema.eventSignups.eventId, eventId),
    ne(schema.eventSignups.status, 'roached_out'),
    ne(schema.eventSignups.status, 'declined'),
    ne(schema.eventSignups.status, 'departed'),
  );
}

async function findByDiscordFallback(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  activeFilter: ReturnType<typeof buildActiveFilter>,
): Promise<SignupRow | undefined> {
  const [user] = await db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.discordId) return undefined;
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(activeFilter, eq(schema.eventSignups.discordUserId, user.discordId)),
    )
    .limit(1);
  return signup;
}

export async function findSignupForCancel(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<SignupRow | undefined> {
  const activeFilter = buildActiveFilter(eventId);
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(and(activeFilter, eq(schema.eventSignups.userId, userId)))
    .limit(1);
  if (signup) return signup;
  return findByDiscordFallback(db, userId, activeFilter);
}

export async function determineCancelStatus(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<{
  cancelStatus: 'declined' | 'roached_out';
  isGracefulDecline: boolean;
}> {
  const [event] = await db
    .select({ duration: schema.events.duration })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const eventStartTime = event?.duration?.[0];
  const hoursUntilEvent = eventStartTime
    ? (eventStartTime.getTime() - Date.now()) / (1000 * 60 * 60)
    : 0;
  const isGracefulDecline = hoursUntilEvent >= 23;
  return {
    cancelStatus: isGracefulDecline ? 'declined' : 'roached_out',
    isGracefulDecline,
  };
}

type CancelNotifyData = {
  creatorId: number;
  eventTitle: string;
  role: string | null;
  displayName: string;
};

export async function gatherCancelNotifyData(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  assignment: AssignmentRow | undefined,
): Promise<CancelNotifyData | null> {
  if (!assignment) return null;
  const [[evt], [user]] = await Promise.all([
    db
      .select({
        creatorId: schema.events.creatorId,
        title: schema.events.title,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1),
    db
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
  ]);
  return {
    creatorId: evt.creatorId,
    eventTitle: evt.title,
    role: assignment.role,
    displayName: user?.username ?? 'Unknown',
  };
}

type BufferLeaveFn = (data: {
  organizerId: number;
  eventId: number;
  eventTitle: string;
  userId: number;
  displayName: string;
  vacatedRole: string;
}) => void;

async function prepareCancelData(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
) {
  const signup = await findSignupForCancel(db, eventId, userId);
  if (!signup)
    throw new NotFoundException(
      `Signup not found for user ${userId} on event ${eventId}`,
    );
  const { cancelStatus, isGracefulDecline } = await determineCancelStatus(
    db,
    eventId,
  );
  const [assignment] = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signup.id))
    .limit(1);
  const notifyData = await gatherCancelNotifyData(
    db,
    eventId,
    userId,
    assignment,
  );
  return { signup, cancelStatus, isGracefulDecline, assignment, notifyData };
}

type CancelData = Awaited<ReturnType<typeof prepareCancelData>>;

async function applyCancellation(
  db: PostgresJsDatabase<typeof schema>,
  data: CancelData,
): Promise<void> {
  if (data.assignment)
    await db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, data.signup.id));
  await db
    .update(schema.eventSignups)
    .set({
      status: data.cancelStatus,
      roachedOutAt: data.isGracefulDecline ? null : new Date(),
    })
    .where(eq(schema.eventSignups.id, data.signup.id));
}

export async function cancelSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  benchPromo: BenchPromotionService,
  eventEmitter: EventEmitter2,
  bufferLeave: BufferLeaveFn,
): Promise<void> {
  const data = await prepareCancelData(db, eventId, userId);
  await applyCancellation(db, data);
  logger.log(
    `User ${userId} canceled signup for event ${eventId} (${data.cancelStatus})`,
  );
  emitCancelled(eventEmitter, eventId, userId, data.signup.id);
  await notifyCancellation(
    db,
    eventId,
    userId,
    data,
    bufferLeave,
    benchPromo,
    eventEmitter,
  );
}

function emitCancelled(
  eventEmitter: EventEmitter2,
  eventId: number,
  userId: number,
  signupId: number,
): void {
  eventEmitter.emit(SIGNUP_EVENTS.DELETED, {
    eventId,
    userId,
    signupId,
    action: 'signup_cancelled',
  } satisfies SignupEventPayload);
}

async function notifyCancellation(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  data: CancelData,
  bufferLeave: BufferLeaveFn,
  benchPromo: BenchPromotionService,
  eventEmitter: EventEmitter2,
): Promise<void> {
  if (!data.notifyData) return;
  bufferLeave({
    organizerId: data.notifyData.creatorId,
    eventId,
    eventTitle: data.notifyData.eventTitle,
    userId,
    displayName: data.notifyData.displayName,
    vacatedRole: data.notifyData.role ?? 'assigned',
  });
  await handleVacatedSlot(
    db,
    eventId,
    data.assignment,
    benchPromo,
    eventEmitter,
  );
}

export async function handleVacatedSlot(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  assignment: AssignmentRow | undefined,
  benchPromo: BenchPromotionService,
  eventEmitter: EventEmitter2,
): Promise<void> {
  if (!assignment || !assignment.role || assignment.role === 'bench') return;
  if (await benchPromo.isEligible(eventId)) {
    await benchPromo.schedulePromotion(
      eventId,
      assignment.role,
      assignment.position,
    );
  }
  tryReslotTentative(db, eventId, assignment, eventEmitter);
}

function tryReslotTentative(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  assignment: AssignmentRow,
  eventEmitter: EventEmitter2,
): void {
  reslotTentativePlayer(db, eventId, assignment.role!, assignment.position)
    .then((reslottedId: number | null) => {
      if (reslottedId) {
        logger.log(
          `ROK-459: Reslotted tentative signup ${reslottedId} to ${assignment.role} slot ${assignment.position}`,
        );
        eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
          eventId,
          signupId: reslottedId,
          action: 'tentative_reslotted',
        } satisfies SignupEventPayload);
      }
    })
    .catch((err: unknown) =>
      logger.warn(
        `ROK-459: Failed tentative reslot check: ${err instanceof Error ? err.message : 'Unknown error'}`,
      ),
    );
}
