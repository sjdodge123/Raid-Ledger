/**
 * Attendee running-late fan-out (ROK-1379 follow-up).
 *
 * When an attendee first marks themselves running late, notify the event's
 * active attendees + host so they don't have to re-open the embed/roster to
 * learn about it. Mirrors the event_delayed notice (event-delay.helpers.ts)
 * with two deliberate deviations: recipients are filtered to active statuses
 * (declined/departed users are not told someone is late), and the event
 * creator is always included (event_reminder precedent) since the host is the
 * most interested party.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';

/** Event fields needed for the running-late notice. */
export interface RunningLateNotifyEvent {
  id: number;
  title: string;
  duration: Date[];
  creatorId: number;
}

export interface NotifyRunningLateParams {
  db: PostgresJsDatabase<typeof schema>;
  notificationService: Pick<
    NotificationService,
    'createMany' | 'getDiscordEmbedUrl' | 'resolveVoiceChannelForEvent'
  >;
  event: RunningLateNotifyEvent;
  lateUserId: number;
  lateUsername: string;
}

/** Active attendees (signed_up/tentative) plus the host, minus the late user. */
async function fetchRecipients(
  db: PostgresJsDatabase<typeof schema>,
  event: RunningLateNotifyEvent,
  lateUserId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, event.id),
        inArray(schema.eventSignups.status, ['signed_up', 'tentative']),
      ),
    );
  const ids = rows
    .map((r) => r.userId)
    .filter((id): id is number => id != null);
  return [...new Set([...ids, event.creatorId])].filter(
    (id) => id !== lateUserId,
  );
}

/** Sends the running_late notice. Never throws — the marker is already set. */
export async function notifyAttendeeRunningLate(
  params: NotifyRunningLateParams,
): Promise<void> {
  const { db, notificationService, event, lateUserId, lateUsername } = params;
  const recipients = await fetchRecipients(db, event, lateUserId);
  if (recipients.length === 0) return;
  const [discordUrl, voiceChannelId] = await Promise.all([
    notificationService.getDiscordEmbedUrl(event.id),
    notificationService.resolveVoiceChannelForEvent(event.id),
  ]);
  const payload: Record<string, unknown> = {
    eventId: event.id,
    lateUserId,
    lateUsername,
    startTime: event.duration[0]?.toISOString(),
    // Distinct Discord rate-limit key per late user (see rateLimitKeyFor):
    // two different attendees going late within 5 min both reach recipients.
    subtype: `late-${lateUserId}`,
    ...(discordUrl ? { discordUrl } : {}),
    ...(voiceChannelId ? { voiceChannelId } : {}),
  };
  await notificationService.createMany(
    recipients.map((uid) => ({
      userId: uid,
      type: 'running_late' as const,
      title: 'Running Late',
      message: `${lateUsername} is running late to "${event.title}".`,
      payload,
    })),
  );
}
