/**
 * Notification helpers for SignupsService.
 * Contains roster update notifications and role-change notification logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { UpdateRosterDto } from '@raid-ledger/contract';
import type { Tx } from './signups.service.types';
import { formatRoleLabel } from './signups-roster.helpers';
import type { NotificationService } from '../notifications/notification.service';
import type { CreateNotificationInput } from '../notifications/notification.types';
import { appendVoiceAccessLine } from '../notifications/voice-access-lost.helpers';

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
  /** ROK-1769: benched members who lost private voice — line rides on the DM. */
  voiceLostUserIds: ReadonlySet<number> = new Set(),
): Promise<void> {
  for (const assignment of newAssignments) {
    if (!assignment.userId) continue;
    const signup = signupByUserId.get(assignment.userId);
    if (!signup) continue;
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    const newRole = assignment.slot;
    if (oldRole === newRole || oldRole === null || newRole === null) continue;
    const input = roleChangeInput(
      assignment.userId,
      eventId,
      eventTitle,
      oldRole,
      newRole,
      extraPayload,
    );
    const lostVoice =
      newRole === 'bench' && voiceLostUserIds.has(assignment.userId);
    await notificationService.create(
      lostVoice ? appendVoiceAccessLine(input) : input,
    );
  }
}

function roleChangeInput(
  userId: number,
  eventId: number,
  eventTitle: string,
  oldRole: string,
  newRole: string,
  extraPayload: Record<string, string>,
): CreateNotificationInput {
  if (oldRole === 'bench' && newRole !== 'bench') {
    return {
      userId,
      type: 'bench_promoted',
      title: 'Promoted from Bench',
      message: `You've been moved from bench to ${formatRoleLabel(newRole)} for ${eventTitle}`,
      payload: { eventId, ...extraPayload },
    };
  }
  const isBenched = newRole === 'bench';
  return {
    userId,
    type: 'roster_reassigned',
    title: isBenched ? 'Moved to Bench' : 'Role Changed',
    message: isBenched
      ? `You've been moved from ${formatRoleLabel(oldRole)} to bench for ${eventTitle}`
      : `Your role changed from ${formatRoleLabel(oldRole)} to ${formatRoleLabel(newRole)} for ${eventTitle}`,
    payload: { eventId, oldRole, newRole, ...extraPayload },
  };
}

export async function notifyNewAssignments(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  newAssignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  oldRoleBySignupId: Map<number, string | null>,
  extraPayload: Record<string, string>,
  /** ROK-1769: pool → bench loses private voice; the line rides on the DM. */
  voiceLostUserIds: ReadonlySet<number> = new Set(),
): Promise<void> {
  for (const assignment of newAssignments) {
    if (!assignment.userId) continue;
    const signup = signupByUserId.get(assignment.userId);
    if (!signup) continue;
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    const newRole = assignment.slot;
    if (oldRole !== null || newRole === null) continue;
    const input = newAssignmentInput(
      assignment.userId,
      eventId,
      eventTitle,
      newRole,
      extraPayload,
    );
    const lostVoice =
      newRole === 'bench' && voiceLostUserIds.has(assignment.userId);
    await notificationService.create(
      lostVoice ? appendVoiceAccessLine(input) : input,
    );
  }
}

function newAssignmentInput(
  userId: number,
  eventId: number,
  eventTitle: string,
  newRole: string,
  extraPayload: Record<string, string>,
) {
  const isGeneric = newRole === 'player';
  return {
    userId,
    type: 'roster_reassigned' as const,
    title: 'Roster Assignment',
    message: isGeneric
      ? `You've been assigned to the roster for ${eventTitle}`
      : `You've been assigned to the ${formatRoleLabel(newRole)} role for ${eventTitle}`,
    payload: { eventId, newRole, ...extraPayload },
  };
}

export async function captureOldAssignments(db: Tx, eventId: number) {
  const old = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
  return new Map(old.map((a) => [a.signupId, a.role]));
}
