import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import { handleVacatedSlot } from './signup-cancel.helpers';
import { notifyRemovedUser } from './signup-roster-update.helpers';

const logger = new Logger('SignupManagement');

type AssignmentRow = typeof schema.rosterAssignments.$inferSelect;
type SignupRow = typeof schema.eventSignups.$inferSelect;

async function findUserSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<SignupRow> {
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  if (!signup)
    throw new NotFoundException(
      `Signup not found for user ${userId} on event ${eventId}`,
    );
  return signup;
}

async function findSignupAssignment(
  db: PostgresJsDatabase<typeof schema>,
  signupId: number,
  userId: number,
  eventId: number,
): Promise<AssignmentRow> {
  const [assignment] = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);
  if (!assignment)
    throw new NotFoundException(
      `No roster assignment found for user ${userId} on event ${eventId}`,
    );
  return assignment;
}

async function fetchEventAndUser(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
) {
  const [[event], [user]] = await Promise.all([
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
  return { event, user };
}

export async function selfUnassign(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  benchPromo: BenchPromotionService,
  rosterNotificationBuffer: RosterNotificationBufferService,
  eventEmitter: EventEmitter2,
): Promise<void> {
  const signup = await findUserSignup(db, eventId, userId);
  const assignment = await findSignupAssignment(db, signup.id, userId, eventId);
  const { event, user } = await fetchEventAndUser(db, eventId, userId);
  await db
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.id, assignment.id));
  logger.log(
    `User ${userId} self-unassigned from ${assignment.role} slot for event ${eventId}`,
  );
  emitSelfUnassign(eventEmitter, eventId, userId, signup.id);
  bufferLeave(
    rosterNotificationBuffer,
    event,
    eventId,
    userId,
    user,
    assignment,
  );
  await scheduleBenchPromotion(benchPromo, eventId, assignment);
}

function emitSelfUnassign(
  eventEmitter: EventEmitter2,
  eventId: number,
  userId: number,
  signupId: number,
): void {
  eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
    eventId,
    userId,
    signupId,
    action: 'self_unassigned',
  } satisfies SignupEventPayload);
}

function bufferLeave(
  rosterNotificationBuffer: RosterNotificationBufferService,
  event: { creatorId: number; title: string },
  eventId: number,
  userId: number,
  user: { username: string } | undefined,
  assignment: AssignmentRow,
): void {
  rosterNotificationBuffer.bufferLeave({
    organizerId: event.creatorId,
    eventId,
    eventTitle: event.title,
    userId,
    displayName: user?.username ?? 'Unknown',
    vacatedRole: assignment.role ?? 'assigned',
  });
}

async function scheduleBenchPromotion(
  benchPromo: BenchPromotionService,
  eventId: number,
  assignment: AssignmentRow,
): Promise<void> {
  if (!assignment.role || assignment.role === 'bench') return;
  if (!(await benchPromo.isEligible(eventId))) return;
  await benchPromo.schedulePromotion(
    eventId,
    assignment.role,
    assignment.position,
  );
}

async function validateAdminAccess(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  requesterId: number,
  isAdmin: boolean,
): Promise<typeof schema.events.$inferSelect> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) throw new NotFoundException(`Event with ID ${eventId} not found`);
  if (event.creatorId !== requesterId && !isAdmin) {
    throw new ForbiddenException(
      'Only event creator or admin/operator can remove users from an event',
    );
  }
  return event;
}

async function findSignupForRemoval(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
) {
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.id, signupId),
        eq(schema.eventSignups.eventId, eventId),
      ),
    )
    .limit(1);
  if (!signup)
    throw new NotFoundException(
      `Signup ${signupId} not found for event ${eventId}`,
    );
  return signup;
}

async function deleteSignupAndPugs(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signup: typeof schema.eventSignups.$inferSelect,
): Promise<void> {
  if (signup.userId) {
    await db
      .delete(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.eventId, eventId),
          eq(schema.pugSlots.claimedByUserId, signup.userId),
        ),
      );
  }
  await db
    .delete(schema.eventSignups)
    .where(eq(schema.eventSignups.id, signup.id));
}

export async function adminRemoveSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  requesterId: number,
  isAdmin: boolean,
  notificationService: NotificationService,
  benchPromo: BenchPromotionService,
  eventEmitter: EventEmitter2,
): Promise<void> {
  const event = await validateAdminAccess(db, eventId, requesterId, isAdmin);
  const signup = await findSignupForRemoval(db, eventId, signupId);
  const assignment = await findOptionalAssignment(db, signup.id);
  await deleteSignupAndPugs(db, eventId, signup);
  logger.log(
    `Admin ${requesterId} removed signup ${signupId} from event ${eventId}`,
  );
  await postRemoveCleanup(
    db,
    eventId,
    signup,
    event,
    assignment,
    notificationService,
    benchPromo,
    eventEmitter,
  );
}

async function postRemoveCleanup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signup: SignupRow,
  event: typeof schema.events.$inferSelect,
  assignment: AssignmentRow | undefined,
  notificationService: NotificationService,
  benchPromo: BenchPromotionService,
  eventEmitter: EventEmitter2,
): Promise<void> {
  eventEmitter.emit(SIGNUP_EVENTS.DELETED, {
    eventId,
    userId: signup.userId,
    signupId: signup.id,
    action: 'admin_removed',
  } satisfies SignupEventPayload);
  if (signup.userId)
    await notifyRemovedUser(
      notificationService,
      eventId,
      signup.userId,
      event.title,
    );
  await handleVacatedSlot(db, eventId, assignment, benchPromo, eventEmitter);
}

async function findOptionalAssignment(
  db: PostgresJsDatabase<typeof schema>,
  signupId: number,
): Promise<AssignmentRow | undefined> {
  const [assignment] = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);
  return assignment;
}
