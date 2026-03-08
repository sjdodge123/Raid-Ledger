/**
 * Sub-service for event series bulk operations (ROK-429).
 * Handles update/delete/cancel across recurrence groups.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  UpdateEventDto,
  CancelEventDto,
  SeriesScope,
} from '@raid-ledger/contract';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationService } from '../notifications/notification.service';
import { APP_EVENT_EVENTS } from '../discord-bot/discord-bot.constants';
import { findOneEvent } from './event-find.helpers';
import {
  mapEventToResponse,
  buildLifecyclePayload,
} from './event-response-map.helpers';
import {
  updateSeriesEvents,
  deleteSeriesEvents,
  cancelSeriesEvents,
} from './event-series.helpers';

@Injectable()
export class EventSeriesService {
  private readonly logger = new Logger(EventSeriesService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Updates a series of events with scope selection. */
  async update(
    id: number,
    userId: number,
    isAdmin: boolean,
    scope: SeriesScope,
    dto: UpdateEventDto,
  ): Promise<void> {
    const ids = await updateSeriesEvents(
      this.db,
      id,
      userId,
      isAdmin,
      scope,
      dto,
    );
    this.logger.log(`Series updated: ${id} scope=${scope} by user ${userId}`);
    await this.emitLifecycleForIds(ids, APP_EVENT_EVENTS.UPDATED);
  }

  /** Deletes a series of events with scope selection. */
  async delete(
    id: number,
    userId: number,
    isAdmin: boolean,
    scope: SeriesScope,
  ): Promise<void> {
    const ids = await deleteSeriesEvents(this.db, id, userId, isAdmin, scope);
    this.logger.log(`Series deleted: ${id} scope=${scope} by user ${userId}`);
    for (const eid of ids) {
      this.eventEmitter.emit(APP_EVENT_EVENTS.DELETED, { eventId: eid });
    }
  }

  /** Cancels a series of events with scope selection. */
  async cancel(
    id: number,
    userId: number,
    isAdmin: boolean,
    scope: SeriesScope,
    dto: CancelEventDto,
  ): Promise<void> {
    const ids = await cancelSeriesEvents(
      this.db,
      this.notificationService,
      id,
      userId,
      isAdmin,
      scope,
      dto,
    );
    this.logger.log(`Series cancelled: ${id} scope=${scope} by user ${userId}`);
    await this.emitLifecycleForIds(ids, APP_EVENT_EVENTS.CANCELLED);
  }

  /** Re-fetches events and emits full lifecycle payloads. */
  private async emitLifecycleForIds(
    ids: number[],
    eventName: string,
  ): Promise<void> {
    for (const eid of ids) {
      try {
        const row = await findOneEvent(this.db, eid);
        const response = mapEventToResponse(row);
        this.eventEmitter.emit(eventName, buildLifecyclePayload(response));
      } catch {
        this.logger.warn(`Could not emit ${eventName} for event ${eid}`);
      }
    }
  }
}
