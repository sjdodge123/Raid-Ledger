/**
 * Roster operation helpers for SignupsService.
 * Contains updateRoster, adminRemoveSignup, selfUnassign orchestration logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { UpdateRosterDto } from '@raid-ledger/contract';
import * as cancelH from './signups-cancel.helpers';
import * as notifH from './signups-notification.helpers';
import type { NotificationService } from '../notifications/notification.service';

type Tx = PostgresJsDatabase<typeof schema>;
type Logger = {
  log: (msg: string, ...a: unknown[]) => void;
  warn: (msg: string, ...a: unknown[]) => void;
};

export async function findUserAssignment(
  db: Tx,
  eventId: number,
  userId: number,
) {
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
  const [assignment] = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signup.id))
    .limit(1);
  if (!assignment)
    throw new NotFoundException(
      `No roster assignment found for user ${userId} on event ${eventId}`,
    );
  return { signup, assignment };
}

export async function adminRemoveCore(
  db: Tx,
  eventId: number,
  signupId: number,
  requesterId: number,
  isAdmin: boolean,
  logger: Logger,
) {
  const event = await cancelH.verifyAdminPermission(
    db,
    eventId,
    requesterId,
    isAdmin,
  );
  const signup = await cancelH.findSignupForEvent(db, eventId, signupId);
  const assignment = await cancelH.findAssignmentForSignup(db, signup.id);
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
  logger.log(
    `Admin ${requesterId} removed signup ${signupId} from event ${eventId}`,
  );
  return { event, signup, assignment };
}

export async function notifyRemovedUser(
  notificationService: NotificationService,
  userId: number,
  eventId: number,
  eventTitle: string,
  fetchNotificationCtx: (eventId: number) => Promise<Record<string, string>>,
) {
  const extraPayload = await fetchNotificationCtx(eventId);
  await notificationService.create({
    userId,
    type: 'slot_vacated',
    title: 'Removed from Event',
    message: `You were removed from ${eventTitle}`,
    payload: { eventId, ...extraPayload },
  });
}

/** `.catch` handler: warns `msg` with the failure's reason appended. */
function logWarnReason(logger: Logger, msg: string) {
  return (err: unknown) =>
    logger.warn(
      `${msg}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
}

/** Fire both roster notification fan-outs; each failure is warned on its own. */
function sendRosterNotifications(
  args: Parameters<typeof notifH.notifyRoleChanges>,
  logger: Logger,
): void {
  const reassign = 'Failed to send roster reassign notifications';
  const assign = 'Failed to send roster assignment notifications';
  notifH.notifyRoleChanges(...args).catch(logWarnReason(logger, reassign));
  notifH.notifyNewAssignments(...args).catch(logWarnReason(logger, assign));
}

export function fireRosterNotifications(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  oldRoleBySignupId: Map<number, string | null>,
  fetchNotificationCtx: (eventId: number) => Promise<Record<string, string>>,
  logger: Logger,
) {
  fetchNotificationCtx(eventId)
    .then((extra) =>
      sendRosterNotifications(
        [
          notificationService,
          eventId,
          eventTitle,
          assignments,
          signupByUserId,
          oldRoleBySignupId,
          extra,
        ],
        logger,
      ),
    )
    .catch(logWarnReason(logger, 'Failed to fetch notification context'));
}
