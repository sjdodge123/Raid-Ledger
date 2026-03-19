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
  const event = await cancelH.verifyAdminPermission(db, eventId, requesterId, isAdmin);
  const signup = await cancelH.findSignupForEvent(db, eventId, signupId);
  const assignment = await cancelH.findAssignmentForSignup(db, signup.id);
  if (signup.userId) {
    await db.delete(schema.pugSlots).where(
      and(eq(schema.pugSlots.eventId, eventId), eq(schema.pugSlots.claimedByUserId, signup.userId)),
    );
  }
  await db.delete(schema.eventSignups).where(eq(schema.eventSignups.id, signup.id));
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
  const logError = (msg: string) => (err: unknown) =>
    logger.warn(msg, err instanceof Error ? err.message : 'Unknown error');
  fetchNotificationCtx(eventId)
    .then((extra) => {
      const args = [notificationService, eventId, eventTitle, assignments, signupByUserId, oldRoleBySignupId, extra] as const;
      notifH.notifyRoleChanges(...args).catch(logError('Failed to send roster reassign notifications: %s'));
      notifH.notifyNewAssignments(...args).catch(logError('Failed to send roster assignment notifications: %s'));
    })
    .catch(logError('Failed to fetch notification context: %s'));
}
