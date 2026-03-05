import type { UpdateRosterDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';

type SignupRow = typeof schema.eventSignups.$inferSelect;

function formatLabel(r: string): string {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/**
 * ROK-390: Detect role changes between old and new roster assignments
 * and send notifications to affected players.
 */
export async function notifyRoleChanges(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  newAssignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
  oldRoleBySignupId: Map<number, string | null>,
): Promise<void> {
  const discordUrl = await notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await notificationService.resolveVoiceChannelForEvent(eventId);

  for (const assignment of newAssignments) {
    if (!assignment.userId) continue;

    const signup = signupByUserId.get(assignment.userId);
    if (!signup) continue;

    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    const newRole = assignment.slot;

    if (oldRole === newRole) continue;
    if (oldRole === null) continue;
    if (newRole === null) continue;

    if (oldRole === 'bench' && newRole !== 'bench') {
      await notificationService.create({
        userId: assignment.userId,
        type: 'bench_promoted',
        title: 'Promoted from Bench',
        message: `You've been moved from bench to ${formatLabel(newRole)} for ${eventTitle}`,
        payload: {
          eventId,
          ...(discordUrl ? { discordUrl } : {}),
          ...(voiceChannelId ? { voiceChannelId } : {}),
        },
      });
    } else {
      const oldLabel = formatLabel(oldRole);
      const newLabel = formatLabel(newRole);
      const isBenched = newRole === 'bench';

      await notificationService.create({
        userId: assignment.userId,
        type: 'roster_reassigned',
        title: isBenched ? 'Moved to Bench' : 'Role Changed',
        message: isBenched
          ? `You've been moved from ${oldLabel} to bench for ${eventTitle}`
          : `Your role changed from ${oldLabel} to ${newLabel} for ${eventTitle}`,
        payload: {
          eventId,
          oldRole,
          newRole,
          ...(discordUrl ? { discordUrl } : {}),
          ...(voiceChannelId ? { voiceChannelId } : {}),
        },
      });
    }
  }
}

/**
 * ROK-461: Notify players who were newly assigned to a slot.
 */
export async function notifyNewAssignments(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  newAssignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
  oldRoleBySignupId: Map<number, string | null>,
): Promise<void> {
  const discordUrl = await notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await notificationService.resolveVoiceChannelForEvent(eventId);

  for (const assignment of newAssignments) {
    if (!assignment.userId) continue;

    const signup = signupByUserId.get(assignment.userId);
    if (!signup) continue;

    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    const newRole = assignment.slot;

    if (oldRole !== null) continue;
    if (newRole === null) continue;

    const isGeneric = newRole === 'player';

    await notificationService.create({
      userId: assignment.userId,
      type: 'roster_reassigned',
      title: 'Roster Assignment',
      message: isGeneric
        ? `You've been assigned to the roster for ${eventTitle}`
        : `You've been assigned to the ${formatLabel(newRole)} role for ${eventTitle}`,
      payload: {
        eventId,
        newRole,
        ...(discordUrl ? { discordUrl } : {}),
        ...(voiceChannelId ? { voiceChannelId } : {}),
      },
    });
  }
}
