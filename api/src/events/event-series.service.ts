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
    await updateSeriesEvents(
      this.db,
      this.eventEmitter,
      id,
      userId,
      isAdmin,
      scope,
      dto,
    );
    this.logger.log(`Series updated: ${id} scope=${scope} by user ${userId}`);
  }

  /** Deletes a series of events with scope selection. */
  async delete(
    id: number,
    userId: number,
    isAdmin: boolean,
    scope: SeriesScope,
  ): Promise<void> {
    await deleteSeriesEvents(
      this.db,
      this.eventEmitter,
      id,
      userId,
      isAdmin,
      scope,
    );
    this.logger.log(`Series deleted: ${id} scope=${scope} by user ${userId}`);
  }

  /** Cancels a series of events with scope selection. */
  async cancel(
    id: number,
    userId: number,
    isAdmin: boolean,
    scope: SeriesScope,
    dto: CancelEventDto,
  ): Promise<void> {
    await cancelSeriesEvents(
      this.db,
      this.notificationService,
      id,
      userId,
      isAdmin,
      scope,
      dto,
    );
    this.logger.log(`Series cancelled: ${id} scope=${scope} by user ${userId}`);
  }
}
