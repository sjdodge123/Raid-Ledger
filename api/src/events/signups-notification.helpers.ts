/**
 * Notification helpers for SignupsService.
 * Contains roster update notifications and role-change notification logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { UpdateRosterDto } from '@raid-ledger/contract';
import type { Tx } from './signups.service.types';
import { formatRoleLabel } from './signups-roster.helpers';
import type { NotificationService } from '../notifications/notification.service';

export async function fetchNotificationContext(
  notificationService: NotificationService,
  eventId: number,
): Promise<Record<string, string>> {
  const [discordUrl, voiceChannelId] = await Promise.all([
    notificationService.getDiscordEmbedUrl(eventId),
    notificationService.resolveVoiceChannelForEvent(eventId),
  ]);
  return {
    ...(discordUrl ? { discordUrl } : {}),
    ...(voiceChannelId ? { voiceChannelId } : {}),
  };
}

export async function notifyRoleChanges(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  newAssignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  oldRoleBySignupId: Map<number, string | null>,
  extraPayload: Record<string, string>,
): Promise<void> {
  for (const assignment of newAssignments) {
    if (!assignment.userId) continue;
    const signup = signupByUserId.get(assignment.userId);
    if (!signup) continue;
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    const newRole = assignment.slot;
    if (oldRole === newRole || oldRole === null || newRole === null) continue;
    await sendRoleChangeNotification(
      notificationService,
      assignment.userId,
      eventId,
      eventTitle,
      oldRole,
      newRole,
      extraPayload,
    );
  }
}

async function sendRoleChangeNotification(
  notificationService: NotificationService,
  userId: number,
  eventId: number,
  eventTitle: string,
  oldRole: string,
  newRole: string,
  extraPayload: Record<string, string>,
): Promise<void> {
  if (oldRole === 'bench' && newRole !== 'bench') {
    await notificationService.create({
      userId,
      type: 'bench_promoted',
      title: 'Promoted from Bench',
      message: `You've been moved from bench to ${formatRoleLabel(newRole)} for ${eventTitle}`,
      payload: { eventId, ...extraPayload },
    });
  } else {
    const isBenched = newRole === 'bench';
    await notificationService.create({
      userId,
      type: 'roster_reassigned',
      title: isBenched ? 'Moved to Bench' : 'Role Changed',
      message: isBenched
        ? `You've been moved from ${formatRoleLabel(oldRole)} to bench for ${eventTitle}`
        : `Your role changed from ${formatRoleLabel(oldRole)} to ${formatRoleLabel(newRole)} for ${eventTitle}`,
      payload: { eventId, oldRole, newRole, ...extraPayload },
    });
  }
}

export async function notifyNewAssignments(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  newAssignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  oldRoleBySignupId: Map<number, string | null>,
  extraPayload: Record<string, string>,
): Promise<void> {
  for (const assignment of newAssignments) {
    if (!assignment.userId) continue;
    const signup = signupByUserId.get(assignment.userId);
    if (!signup) continue;
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    const newRole = assignment.slot;
    if (oldRole !== null || newRole === null) continue;
    const isGeneric = newRole === 'player';
    await notificationService.create({
      userId: assignment.userId,
      type: 'roster_reassigned',
      title: 'Roster Assignment',
      message: isGeneric
        ? `You've been assigned to the roster for ${eventTitle}`
        : `You've been assigned to the ${formatRoleLabel(newRole)} role for ${eventTitle}`,
      payload: { eventId, newRole, ...extraPayload },
    });
  }
}

export async function validateRosterAssignments(
  db: Tx,
  eventId: number,
  assignments: UpdateRosterDto['assignments'],
) {
  const { BadRequestException } = await import('@nestjs/common');
  const signups = await db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  const signupByUserId = new Map(signups.map((s) => [s.userId, s]));
  for (const a of assignments) {
    if (!signupByUserId.get(a.userId)) {
      throw new BadRequestException(
        `User ${a.userId} is not signed up for this event`,
      );
    }
  }
  return signupByUserId;
}

export async function captureOldAssignments(db: Tx, eventId: number) {
  const old = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
  return new Map(old.map((a) => [a.signupId, a.role]));
}

export async function replaceRosterAssignments(
  db: Tx,
  eventId: number,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  benchPromotionService: {
    cancelPromotion: (
      eventId: number,
      role: string,
      position: number,
    ) => Promise<void>;
  },
) {
  await db
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
  await updateCharacterOverrides(db, assignments, signupByUserId);
  if (assignments.length > 0) {
    await insertNewAssignments(
      db,
      eventId,
      assignments,
      signupByUserId,
      benchPromotionService,
    );
  }
}

async function updateCharacterOverrides(
  db: Tx,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
) {
  for (const a of assignments) {
    if (!a.characterId) continue;
    const signup = signupByUserId.get(a.userId);
    if (signup) {
      await db
        .update(schema.eventSignups)
        .set({ characterId: a.characterId, confirmationStatus: 'confirmed' })
        .where(eq(schema.eventSignups.id, signup.id));
    }
  }
}

async function insertNewAssignments(
  db: Tx,
  eventId: number,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  benchPromotionService: {
    cancelPromotion: (
      eventId: number,
      role: string,
      position: number,
    ) => Promise<void>;
  },
) {
  const values = assignments.map((a) => ({
    eventId,
    signupId: a.signupId ?? signupByUserId.get(a.userId)!.id,
    role: a.slot,
    position: a.position,
    isOverride: a.isOverride ? 1 : 0,
  }));
  await db.insert(schema.rosterAssignments).values(values);
  await confirmNonBenchSignups(db, assignments, signupByUserId);
  for (const a of assignments) {
    if (a.slot && a.slot !== 'bench') {
      await benchPromotionService.cancelPromotion(eventId, a.slot, a.position);
    }
  }
}

async function confirmNonBenchSignups(
  db: Tx,
  assignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
) {
  const ids = assignments
    .filter((a) => a.slot && a.slot !== 'bench')
    .map((a) => signupByUserId.get(a.userId)!)
    .filter((s) => s.confirmationStatus === 'pending')
    .map((s) => s.id);
  if (ids.length > 0) {
    await db
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(inArray(schema.eventSignups.id, ids));
  }
}
