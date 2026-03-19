/**
 * Event lifecycle helpers: cancel, reschedule, delete, invite.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CancelEventDto, RescheduleEventDto } from '@raid-ledger/contract';
import type { NotificationService } from '../notifications/notification.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import { toDiscordTimestamp } from '../discord-bot/utils/time-parser';

type EventSelect = typeof schema.events.$inferSelect;

/** Finds an event or throws NotFoundException. */
export async function findExistingOrThrow(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<EventSelect> {
  const [existing] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id))
    .limit(1);
  if (!existing) throw new NotFoundException(`Event with ID ${id} not found`);
  return existing;
}

/** Asserts the user owns the event or is an admin. */
export function assertOwnerOrAdmin(
  event: EventSelect,
  userId: number,
  isAdmin: boolean,
  action: string,
): void {
  if (event.creatorId !== userId && !isAdmin)
    throw new ForbiddenException(`You can only ${action} your own events`);
}

/** Deletes an event after ownership verification. */
export async function deleteEvent(
  db: PostgresJsDatabase<typeof schema>,
  eventEmitter: EventEmitter2,
  id: number,
  userId: number,
  isAdmin: boolean,
): Promise<void> {
  const existing = await findExistingOrThrow(db, id);
  assertOwnerOrAdmin(existing, userId, isAdmin, 'delete');
  await eventEmitter.emitAsync(APP_EVENT_EVENTS.DELETED, { eventId: id });
  await db.delete(schema.events).where(eq(schema.events.id, id));
}

/** Fetches user IDs signed up for an event (for notification). */
export async function getSignedUpUserIds(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<number[]> {
  const signups = await db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return signups.map((s) => s.userId).filter((id): id is number => id !== null);
}

/** Sends cancellation notifications to all signed-up users. */
export async function notifyCancellation(
  notificationService: NotificationService,
  eventId: number,
  existing: EventSelect,
  dto: CancelEventDto,
  usersToNotify: number[],
): Promise<void> {
  const reasonSuffix = dto.reason ? ` Reason: ${dto.reason}` : '';
  const discordUrl = await notificationService.getDiscordEmbedUrl(eventId);
  await Promise.all(
    usersToNotify.map((uid) =>
      notificationService.create({
        userId: uid,
        type: 'event_cancelled',
        title: 'Event Cancelled',
        message: `"${existing.title}" has been cancelled.${reasonSuffix}`,
        payload: {
          eventId,
          reason: dto.reason ?? null,
          startTime: existing.duration[0].toISOString(),
          ...(discordUrl ? { discordUrl } : {}),
        },
      }),
    ),
  );
}

/** Cancels an event and notifies signed-up users. */
export async function cancelEvent(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  eventId: number,
  userId: number,
  isAdmin: boolean,
  dto: CancelEventDto,
): Promise<void> {
  const existing = await findExistingOrThrow(db, eventId);
  assertOwnerOrAdmin(existing, userId, isAdmin, 'cancel');
  if (existing.cancelledAt)
    throw new BadRequestException('This event has already been cancelled');
  await db
    .update(schema.events)
    .set({
      cancelledAt: new Date(),
      cancellationReason: dto.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.events.id, eventId));
  const usersToNotify = await getSignedUpUserIds(db, eventId);
  await notifyCancellation(
    notificationService,
    eventId,
    existing,
    dto,
    usersToNotify,
  );
}

/** Resets confirmation status for active signups after reschedule. */
export async function resetSignupConfirmations(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  await db
    .delete(schema.eventRemindersSent)
    .where(eq(schema.eventRemindersSent.eventId, eventId));
  await db
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'pending', status: 'signed_up' })
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        ne(schema.eventSignups.status, 'declined'),
        ne(schema.eventSignups.status, 'departed'),
      ),
    );
}

/** Formats a date for Discord notification display using native timestamps. */
function formatDiscordTime(d: Date): string {
  return `${toDiscordTimestamp(d, 'f')} (${toDiscordTimestamp(d, 'R')})`;
}

/** Builds the payload for a reschedule notification. */
function buildReschedulePayload(
  eventId: number,
  existing: EventSelect,
  dto: RescheduleEventDto,
  discordUrl: string | null,
  voiceChannelId: string | null,
): Record<string, unknown> {
  return {
    eventId,
    oldStartTime: existing.duration[0].toISOString(),
    oldEndTime: existing.duration[1].toISOString(),
    newStartTime: dto.startTime,
    newEndTime: dto.endTime,
    startTime: dto.startTime,
    ...(discordUrl ? { discordUrl } : {}),
    ...(voiceChannelId ? { voiceChannelId } : {}),
  };
}

/** Resolves notification context (URLs) for a reschedule. */
async function resolveRescheduleContext(
  notificationService: NotificationService,
  eventId: number,
): Promise<{ discordUrl: string | null; voiceChannelId: string | null }> {
  const discordUrl = await notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await notificationService.resolveVoiceChannelForEvent(eventId);
  return { discordUrl, voiceChannelId };
}

/** Sends a batch of reschedule notifications to the given users. */
async function sendRescheduleNotifications(
  notificationService: NotificationService,
  userIds: number[],
  message: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await Promise.all(
    userIds.map((uid) =>
      notificationService.create({
        userId: uid,
        type: 'event_rescheduled',
        title: 'Event Rescheduled',
        message,
        payload,
      }),
    ),
  );
}

/** Builds the full reschedule payload including Discord context. */
async function buildFullReschedulePayload(
  notificationService: NotificationService,
  eventId: number,
  existing: EventSelect,
  dto: RescheduleEventDto,
): Promise<Record<string, unknown>> {
  const ctx = await resolveRescheduleContext(notificationService, eventId);
  return buildReschedulePayload(
    eventId,
    existing,
    dto,
    ctx.discordUrl,
    ctx.voiceChannelId,
  );
}

/** Sends reschedule notifications to signed-up users (excluding the rescheduler). */
async function notifyReschedule(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  eventId: number,
  userId: number,
  existing: EventSelect,
  newStart: Date,
  dto: RescheduleEventDto,
): Promise<void> {
  const usersToNotify = (await getSignedUpUserIds(db, eventId)).filter(
    (id) => id !== userId,
  );
  const payload = await buildFullReschedulePayload(
    notificationService,
    eventId,
    existing,
    dto,
  );
  const message = `"${existing.title}" has been rescheduled to ${formatDiscordTime(newStart)}`;
  await sendRescheduleNotifications(
    notificationService,
    usersToNotify,
    message,
    payload,
  );
}

/** Reschedules an event to new times and notifies participants. */
export async function rescheduleEvent(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  eventId: number,
  userId: number,
  isAdmin: boolean,
  dto: RescheduleEventDto,
): Promise<void> {
  const existing = await findExistingOrThrow(db, eventId);
  assertOwnerOrAdmin(existing, userId, isAdmin, 'reschedule');
  const newStart = new Date(dto.startTime);
  await db
    .update(schema.events)
    .set({ duration: [newStart, new Date(dto.endTime)], updatedAt: new Date() })
    .where(eq(schema.events.id, eventId));
  await resetSignupConfirmations(db, eventId);
  await notifyReschedule(
    db,
    notificationService,
    eventId,
    userId,
    existing,
    newStart,
    dto,
  );
}
