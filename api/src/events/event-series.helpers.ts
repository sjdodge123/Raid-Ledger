/**
 * Event series helper functions for bulk edit/delete/cancel (ROK-429).
 * Implements Google Calendar-style scope operations:
 *  - 'this': single event only
 *  - 'this_and_following': from anchor event forward
 *  - 'all': every event in the recurrence group
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, and, gte } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { UpdateEventDto, CancelEventDto } from '@raid-ledger/contract';
import type { SeriesScope } from '@raid-ledger/contract';
import type { NotificationService } from '../notifications/notification.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import {
  findExistingOrThrow,
  assertOwnerOrAdmin,
  getSignedUpUserIds,
  notifyCancellation,
  resetSignupConfirmations,
} from './event-lifecycle.helpers';
import { buildUpdateData } from './event-update.helpers';

type EventSelect = typeof schema.events.$inferSelect;

/** Finds all events in a recurrence group, optionally from anchor forward. */
export async function findSeriesEvents(
  db: PostgresJsDatabase<typeof schema>,
  groupId: string,
  fromStart?: Date,
): Promise<EventSelect[]> {
  const conditions = [eq(schema.events.recurrenceGroupId, groupId)];
  if (fromStart) {
    conditions.push(gte(schema.events.duration, fromStart as never));
  }
  const events = await db
    .select()
    .from(schema.events)
    .where(and(...conditions))
    .orderBy(schema.events.duration);
  if (events.length === 0) {
    throw new NotFoundException('No events found in this series');
  }
  return events;
}

/** Computes millisecond delta between old start and new start. */
export function computeTimeDelta(oldStart: Date, newStartIso: string): number {
  return new Date(newStartIso).getTime() - oldStart.getTime();
}

/** Applies a millisecond delta to a duration tuple. */
export function applyTimeDelta(
  duration: [Date, Date],
  deltaMs: number,
): [Date, Date] {
  return [
    new Date(duration[0].getTime() + deltaMs),
    new Date(duration[1].getTime() + deltaMs),
  ];
}

/** Resolves the target events based on scope. */
export async function resolveTargetEvents(
  db: PostgresJsDatabase<typeof schema>,
  anchor: EventSelect,
  scope: SeriesScope,
): Promise<EventSelect[]> {
  if (scope === 'this') return [anchor];
  if (!anchor.recurrenceGroupId) {
    throw new BadRequestException('Event is not part of a series');
  }
  const fromStart =
    scope === 'this_and_following' ? anchor.duration[0] : undefined;
  return findSeriesEvents(db, anchor.recurrenceGroupId, fromStart);
}

/** Emits a lifecycle event for each target. */
function emitForTargets(
  eventEmitter: EventEmitter2,
  key: string,
  targets: EventSelect[],
): void {
  for (const evt of targets) {
    eventEmitter.emit(key, { eventId: evt.id });
  }
}

/** Updates series events within a transaction. */
export async function updateSeriesEvents(
  db: PostgresJsDatabase<typeof schema>,
  eventEmitter: EventEmitter2,
  id: number,
  userId: number,
  isAdmin: boolean,
  scope: SeriesScope,
  dto: UpdateEventDto,
): Promise<void> {
  const anchor = await findExistingOrThrow(db, id);
  assertOwnerOrAdmin(anchor, userId, isAdmin, 'update');
  const targets = await resolveTargetEvents(db, anchor, scope);
  const timeDelta = dto.startTime
    ? computeTimeDelta(anchor.duration[0], dto.startTime)
    : null;

  await db.transaction(async (tx) => {
    for (const evt of targets) {
      const updateData = buildUpdateForTarget(evt, anchor, dto, timeDelta);
      await tx
        .update(schema.events)
        .set(updateData)
        .where(eq(schema.events.id, evt.id));
      if (timeDelta) {
        await resetSignupConfirmations(tx as never, evt.id);
      }
    }
  });

  emitForTargets(eventEmitter, APP_EVENT_EVENTS.UPDATED, targets);
}

/** Builds update data for a target event, applying time delta. */
function buildUpdateForTarget(
  target: EventSelect,
  anchor: EventSelect,
  dto: UpdateEventDto,
  timeDelta: number | null,
): Record<string, unknown> {
  const dtoForTarget = { ...dto };
  if (timeDelta && target.id !== anchor.id) {
    const shifted = applyTimeDelta(target.duration, timeDelta);
    dtoForTarget.startTime = shifted[0].toISOString();
    dtoForTarget.endTime = shifted[1].toISOString();
  }
  return buildUpdateData(dtoForTarget, target);
}

/** Deletes series events within a transaction. */
export async function deleteSeriesEvents(
  db: PostgresJsDatabase<typeof schema>,
  eventEmitter: EventEmitter2,
  id: number,
  userId: number,
  isAdmin: boolean,
  scope: SeriesScope,
): Promise<void> {
  const anchor = await findExistingOrThrow(db, id);
  assertOwnerOrAdmin(anchor, userId, isAdmin, 'delete');
  const targets = await resolveTargetEvents(db, anchor, scope);
  const targetIds = targets.map((e) => e.id);
  emitForTargets(eventEmitter, APP_EVENT_EVENTS.DELETED, targets);

  await db.transaction(async (tx) => {
    for (const eid of targetIds) {
      await tx.delete(schema.events).where(eq(schema.events.id, eid));
    }
  });
}

/** Sends cancellation notifications for non-cancelled targets. */
async function notifySeriesCancellations(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  targets: EventSelect[],
  dto: CancelEventDto,
): Promise<void> {
  for (const evt of targets) {
    if (evt.cancelledAt) continue;
    const userIds = await getSignedUpUserIds(db, evt.id);
    await notifyCancellation(notificationService, evt.id, evt, dto, userIds);
  }
}

/** Cancels series events within a transaction. */
export async function cancelSeriesEvents(
  db: PostgresJsDatabase<typeof schema>,
  notificationService: NotificationService,
  id: number,
  userId: number,
  isAdmin: boolean,
  scope: SeriesScope,
  dto: CancelEventDto,
): Promise<void> {
  const anchor = await findExistingOrThrow(db, id);
  assertOwnerOrAdmin(anchor, userId, isAdmin, 'cancel');
  const targets = await resolveTargetEvents(db, anchor, scope);
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const evt of targets) {
      if (evt.cancelledAt) continue;
      await tx
        .update(schema.events)
        .set({
          cancelledAt: now,
          cancellationReason: dto.reason ?? null,
          updatedAt: now,
        })
        .where(eq(schema.events.id, evt.id));
    }
  });

  await notifySeriesCancellations(db, notificationService, targets, dto);
}
