/**
 * Lightweight host "delay event" flow (ROK-1379).
 *
 * Distinct from `rescheduleEvent`: a delay shifts the event start/end by a
 * small offset (+15 / +30) WITHOUT resetting signup confirmations and sends a
 * `event_delayed` notice (no confirm/decline buttons) instead of the heavy
 * reschedule DM. The Discord scheduled-event + channel-embed re-render is
 * driven by the caller emitting `APP_EVENT_EVENTS.UPDATED`.
 */
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import { resolveUserTimezones } from '../notifications/timezone.helpers';
import {
  findExistingOrThrow,
  assertOwnerOrAdmin,
  getSignedUpUserIds,
} from './event-lifecycle.helpers';

type EventSelect = typeof schema.events.$inferSelect;

const MS_PER_MINUTE = 60_000;

/**
 * Builds the recipient-facing delay message with the new start baked in the
 * recipient's timezone (ROK-1112 pattern). Discord `<t:...>` markup is NOT
 * used here: the stored message is also the DM plaintext content, the phone
 * push preview, and the web in-app text — none of which parse the markup.
 */
export function buildDelayMessage(
  title: string,
  newStart: Date,
  minutes: number,
  timeZone: string,
): string {
  const when = newStart.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
    timeZone,
  });
  return `"${title}" has been delayed by ${minutes} minutes to ${when}`;
}

/** Builds the payload for an event_delayed notification. */
function buildDelayPayload(
  eventId: number,
  existing: EventSelect,
  newStart: Date,
  newEnd: Date,
  discordUrl: string | null,
  voiceChannelId: string | null,
): Record<string, unknown> {
  return {
    eventId,
    oldStartTime: existing.duration[0].toISOString(),
    newStartTime: newStart.toISOString(),
    newEndTime: newEnd.toISOString(),
    startTime: newStart.toISOString(),
    ...(discordUrl ? { discordUrl } : {}),
    ...(voiceChannelId ? { voiceChannelId } : {}),
  };
}

/** Sends the event_delayed notice to signed-up users except the actor. */
async function notifyEventDelayed(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  eventId: number,
  existing: EventSelect,
  actorUserId: number,
  newStart: Date,
  newEnd: Date,
  minutes: number,
  defaultTimezone: string,
): Promise<void> {
  const usersToNotify = (await getSignedUpUserIds(db, eventId)).filter(
    (id) => id !== actorUserId,
  );
  if (usersToNotify.length === 0) return;
  const discordUrl = await notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await notificationService.resolveVoiceChannelForEvent(eventId);
  const tzMap = await resolveUserTimezones(db, usersToNotify, defaultTimezone);
  const payload = buildDelayPayload(
    eventId,
    existing,
    newStart,
    newEnd,
    discordUrl,
    voiceChannelId,
  );
  await notificationService.createMany(
    usersToNotify.map((uid) => ({
      userId: uid,
      type: 'event_delayed' as const,
      title: 'Event Delayed',
      message: buildDelayMessage(
        existing.title,
        newStart,
        minutes,
        tzMap.get(uid) ?? defaultTimezone,
      ),
      payload,
    })),
  );
}

/**
 * Shifts an event's start+end by `minutes` (host-only) and notifies attendees.
 * Does NOT reset signup confirmations.
 *
 * @returns the new start/end times.
 */
export async function applyEventDelay(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  eventId: number,
  minutes: number,
  actorUserId: number,
  isAdmin = false,
  defaultTimezone = 'UTC',
): Promise<{ newStart: Date; newEnd: Date }> {
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new BadRequestException('Delay minutes must be a positive number');
  const existing = await findExistingOrThrow(db, eventId);
  assertOwnerOrAdmin(existing, actorUserId, isAdmin, 'delay');
  const shiftMs = minutes * MS_PER_MINUTE;
  const newStart = new Date(existing.duration[0].getTime() + shiftMs);
  const newEnd = new Date(existing.duration[1].getTime() + shiftMs);
  await db
    .update(schema.events)
    .set({ duration: [newStart, newEnd], updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
  await notifyEventDelayed(
    db,
    notificationService,
    eventId,
    existing,
    actorUserId,
    newStart,
    newEnd,
    minutes,
    defaultTimezone,
  );
  return { newStart, newEnd };
}

/**
 * Orchestrates the service-level `delayEvent` (apply the delay, then run the
 * shared post-mutation log/emit/refetch). Extracted from EventsService to keep
 * that file under the 300-line limit; `postMutate` is passed in bound so the
 * service's private re-fetch/emit logic is reused without duplication.
 */
export async function runDelayEvent(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  postMutate: (
    eventId: number,
    userId: number,
    action: string,
    emitKey: string,
  ) => Promise<EventResponseDto>,
  eventId: number,
  minutes: number,
  actorUserId: number,
  isAdmin = false,
  defaultTimezone = 'UTC',
): Promise<EventResponseDto> {
  await applyEventDelay(
    db,
    notificationService,
    eventId,
    minutes,
    actorUserId,
    isAdmin,
    defaultTimezone,
  );
  return postMutate(eventId, actorUserId, 'delayed', APP_EVENT_EVENTS.UPDATED);
}
