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
import {
  insertRecurringEvents,
  insertSingleEvent,
} from './event-create.helpers';
import { buildLifecyclePayload } from './event-response.helpers';

interface CreateFlowDeps {
  db: PostgresJsDatabase<typeof schema>;
  eventEmitter: EventEmitter2;
  logger: Logger;
  findByIds: (ids: number[]) => Promise<EventResponseDto[]>;
  findOne: (id: number) => Promise<EventResponseDto>;
}

/** Emits a lifecycle event for Discord embed updates. */
function emitLifecycle(
  emitter: EventEmitter2,
  eventName: string,
  response: EventResponseDto,
): void {
  emitter.emit(eventName, buildLifecyclePayload(response));
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
  for (const r of allResponses) {
    emitLifecycle(deps.eventEmitter, APP_EVENT_EVENTS.CREATED, r);
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
): Promise<EventResponseDto> {
  const event = await insertSingleEvent(
    deps.db,
    baseValues,
    startTime,
    endTime,
  );
  deps.logger.log(`Event created: ${event.id} by user ${creatorId}`);
  const created = await deps.findOne(event.id);
  emitLifecycle(deps.eventEmitter, APP_EVENT_EVENTS.CREATED, created);
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
