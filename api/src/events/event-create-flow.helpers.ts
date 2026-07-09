/**
 * Event creation flow helpers: recurring and single event creation.
 * Extracted from EventsService for file-size compliance (ROK-429).
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { CreateEventDto, EventResponseDto } from '@raid-ledger/contract';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { NotificationService } from '../notifications/notification.service';
import { runFollowupFanout } from '../notifications/post-event-followup-fanout.helpers';
import {
  insertRecurringEvents,
  insertSingleEvent,
  buildBaseValues,
  resolveRecurrenceGroupId,
} from './event-create.helpers';
import { buildLifecyclePayload } from './event-response.helpers';

interface CreateFlowDeps {
  db: PostgresJsDatabase<typeof schema>;
  eventEmitter: EventEmitter2;
  logger: Logger;
  findByIds: (ids: number[]) => Promise<EventResponseDto[]>;
  findOne: (id: number) => Promise<EventResponseDto>;
  /** ROK-1371: reaches `createMany` for the post-create follow-up fan-out. */
  notificationService: Pick<NotificationService, 'createMany'>;
}

/**
 * ROK-1371 post-create hook: when the new event was created as a follow-up
 * (`dto.followupForEventId` set), fan out quick-sign-up DMs to the ended event's
 * attendees. Fire-and-forget — a follow-up failure must never fail event
 * creation. The fan-out helper's tampering guard rejects a forged id.
 */
function maybeTriggerFollowupFanout(
  deps: CreateFlowDeps,
  dto: CreateEventDto,
  newEventId: number,
  creatorId: number,
): void {
  const endedEventId = dto.followupForEventId;
  if (endedEventId == null) return;
  void runFollowupFanout(
    { db: deps.db, notificationService: deps.notificationService },
    endedEventId,
    { eventId: newEventId },
    creatorId,
  ).catch((err) =>
    deps.logger.warn(
      'Follow-up fan-out failed for ended event %d: %s',
      endedEventId,
      err,
    ),
  );
}

/** Emits a lifecycle event for Discord embed updates. */
function emitLifecycle(
  emitter: EventEmitter2,
  eventName: string,
  response: EventResponseDto,
  followupForEventId?: number | null,
): void {
  emitter.emit(eventName, buildLifecyclePayload(response, followupForEventId));
}

/** Creates recurring event instances and returns the first with all IDs. */
export async function createRecurringFlow(
  deps: CreateFlowDeps,
  dto: CreateEventDto,
  baseValues: Record<string, unknown>,
  startTime: Date,
  durationMs: number,
  creatorId: number,
): Promise<EventResponseDto & { allEventIds: number[] }> {
  const events = await insertRecurringEvents(
    deps.db,
    dto,
    baseValues,
    startTime,
    durationMs,
  );
  deps.logger.log(
    `Recurring event: ${events.length} instances by user ${creatorId}`,
  );
  const allResponses = await deps.findByIds(events.map((e) => e.id));
  // ROK-1371: only the first/primary instance is the follow-up target the
  // attendees were DM'd about (its signup button points at events[0].id).
  for (const r of allResponses) {
    const followup =
      r.id === events[0].id ? (dto.followupForEventId ?? null) : null;
    emitLifecycle(deps.eventEmitter, APP_EVENT_EVENTS.CREATED, r, followup);
  }
  const first =
    allResponses.find((r) => r.id === events[0].id) ?? allResponses[0];
  return { ...first, allEventIds: events.map((e) => e.id) };
}

/** Creates a single event and returns it. */
export async function createSingleFlow(
  deps: CreateFlowDeps,
  baseValues: Record<string, unknown>,
  startTime: Date,
  endTime: Date,
  creatorId: number,
  followupForEventId?: number | null,
): Promise<EventResponseDto> {
  const event = await insertSingleEvent(
    deps.db,
    baseValues,
    startTime,
    endTime,
  );
  deps.logger.log(`Event created: ${event.id} by user ${creatorId}`);
  const created = await deps.findOne(event.id);
  emitLifecycle(
    deps.eventEmitter,
    APP_EVENT_EVENTS.CREATED,
    created,
    followupForEventId,
  );
  return created;
}

/** Emits a lifecycle event (thin wrapper for service use). */
export function emitEventLifecycle(
  eventEmitter: EventEmitter2,
  eventName: string,
  response: EventResponseDto,
): void {
  emitLifecycle(eventEmitter, eventName, response);
}

/**
 * Service-level `create` orchestration (recurring vs single + activity log).
 * Extracted from EventsService to keep that file under the 300-line limit.
 */
export async function runCreateEvent(
  deps: CreateFlowDeps,
  activityLog: Pick<ActivityLogService, 'log'>,
  creatorId: number,
  dto: CreateEventDto,
): Promise<EventResponseDto & { allEventIds?: number[] }> {
  const startTime = new Date(dto.startTime);
  const endTime = new Date(dto.endTime);
  const durationMs = endTime.getTime() - startTime.getTime();
  const groupId = resolveRecurrenceGroupId(dto);
  const baseValues = buildBaseValues(creatorId, dto, groupId);
  if (dto.recurrence) {
    const result = await createRecurringFlow(
      deps,
      dto,
      baseValues,
      startTime,
      durationMs,
      creatorId,
    );
    for (const eventId of result.allEventIds ?? []) {
      activityLog
        .log('event', eventId, 'event_created', creatorId, { title: dto.title })
        .catch((err) =>
          deps.logger.warn(
            'Activity log failed for event %d: %s',
            eventId,
            err,
          ),
        );
    }
    maybeTriggerFollowupFanout(deps, dto, result.id, creatorId);
    return result;
  }
  const result = await createSingleFlow(
    deps,
    baseValues,
    startTime,
    endTime,
    creatorId,
    dto.followupForEventId ?? null,
  );
  await activityLog.log('event', result.id, 'event_created', creatorId, {
    title: dto.title,
  });
  maybeTriggerFollowupFanout(deps, dto, result.id, creatorId);
  return result;
}
