import type { UpdateRosterDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';

type SignupRow = typeof schema.eventSignups.$inferSelect;

function formatLabel(r: string): string {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

type NotifyContext = {
  discordUrl: string | null;
  voiceChannelId: string | null;
};

/** Resolves notification context (Discord URL + voice channel). */
async function resolveContext(
  notificationService: NotificationService,
  eventId: number,
): Promise<NotifyContext> {
  const discordUrl = await notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await notificationService.resolveVoiceChannelForEvent(eventId);
  return { discordUrl, voiceChannelId };
}

/** Builds the optional payload fields from notification context. */
function contextPayload(ctx: NotifyContext): Record<string, string> {
  return {
    ...(ctx.discordUrl ? { discordUrl: ctx.discordUrl } : {}),
    ...(ctx.voiceChannelId ? { voiceChannelId: ctx.voiceChannelId } : {}),
  };
}

/** Sends a bench-promoted notification. */
async function notifyBenchPromotion(
  svc: NotificationService,
  userId: number,
  eventId: number,
  eventTitle: string,
  newRole: string,
  ctx: NotifyContext,
): Promise<void> {
  await svc.create({
    userId,
    type: 'bench_promoted',
    title: 'Promoted from Bench',
    message: `You've been moved from bench to ${formatLabel(newRole)} for ${eventTitle}`,
    payload: { eventId, ...contextPayload(ctx) },
  });
}

/** Sends a role-change notification (non-bench). */
async function notifyRoleChange(
  svc: NotificationService,
  userId: number,
  eventId: number,
  eventTitle: string,
  oldRole: string,
  newRole: string,
  ctx: NotifyContext,
): Promise<void> {
  const isBenched = newRole === 'bench';
  await svc.create({
    userId,
    type: 'roster_reassigned',
    title: isBenched ? 'Moved to Bench' : 'Role Changed',
    message: isBenched
      ? `You've been moved from ${formatLabel(oldRole)} to bench for ${eventTitle}`
      : `Your role changed from ${formatLabel(oldRole)} to ${formatLabel(newRole)} for ${eventTitle}`,
    payload: { eventId, oldRole, newRole, ...contextPayload(ctx) },
  });
}

/** Sends the appropriate role-change notification for a single assignment. */
async function notifySingleRoleChange(
  svc: NotificationService,
  userId: number,
  eventId: number,
  eventTitle: string,
  oldRole: string,
  newSlot: string,
  ctx: NotifyContext,
): Promise<void> {
  if (oldRole === 'bench' && newSlot !== 'bench') {
    await notifyBenchPromotion(svc, userId, eventId, eventTitle, newSlot, ctx);
  } else {
    await notifyRoleChange(
      svc,
      userId,
      eventId,
      eventTitle,
      oldRole,
      newSlot,
      ctx,
    );
  }
}

/** Detects role changes and sends notifications to affected players. */
export async function notifyRoleChanges(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  newAssignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
  oldRoleBySignupId: Map<number, string | null>,
): Promise<void> {
  const ctx = await resolveContext(notificationService, eventId);
  for (const a of newAssignments) {
    if (!a.userId) continue;
    const signup = signupByUserId.get(a.userId);
    if (!signup) continue;
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    if (oldRole === a.slot || oldRole === null || a.slot === null) continue;
    await notifySingleRoleChange(
      notificationService,
      a.userId,
      eventId,
      eventTitle,
      oldRole,
      a.slot,
      ctx,
    );
  }
}

/** Notifies players who were newly assigned to a slot. */
export async function notifyNewAssignments(
  notificationService: NotificationService,
  eventId: number,
  eventTitle: string,
  newAssignments: UpdateRosterDto['assignments'],
  signupByUserId: Map<number | null, SignupRow>,
  oldRoleBySignupId: Map<number, string | null>,
): Promise<void> {
  const ctx = await resolveContext(notificationService, eventId);
  for (const a of newAssignments) {
    if (!a.userId) continue;
    const signup = signupByUserId.get(a.userId);
    if (!signup) continue;
    const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
    if (oldRole !== null || a.slot === null) continue;
    const isGeneric = a.slot === 'player';
    await notificationService.create({
      userId: a.userId,
      type: 'roster_reassigned',
      title: 'Roster Assignment',
      message: isGeneric
        ? `You've been assigned to the roster for ${eventTitle}`
        : `You've been assigned to the ${formatLabel(a.slot)} role for ${eventTitle}`,
      payload: { eventId, newRole: a.slot, ...contextPayload(ctx) },
    });
  }
}
