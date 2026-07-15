import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { setRunningLate, clearRunningLate } from './running-late.helpers';
import { NotificationService } from '../notifications/notification.service';
import {
  notifyAttendeeRunningLate,
  type RunningLateNotifyEvent,
} from './running-late-notify.helpers';

/**
 * Service for the attendee "running late" marker (ROK-1379).
 *
 * Thin wrapper over the idempotent signup-row helpers so the Discord
 * interaction layer can mark / clear a late attendee without reaching into
 * the larger SignupsService.
 */
@Injectable()
export class RunningLateService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
  ) {}

  /** Marks the attendee running late. No-op without a signup row. */
  setRunningLate(
    eventId: number,
    userId: number,
    minutes?: number,
  ): Promise<boolean> {
    return setRunningLate(this.db, eventId, userId, minutes);
  }

  /** Clears the running-late marker. No-op when not currently late. */
  clearRunningLate(eventId: number, userId: number): Promise<boolean> {
    return clearRunningLate(this.db, eventId, userId);
  }

  /** Notifies active attendees + host that someone is running late. */
  notifyRunningLate(
    event: RunningLateNotifyEvent,
    lateUserId: number,
    lateUsername: string,
  ): Promise<void> {
    return notifyAttendeeRunningLate({
      db: this.db,
      notificationService: this.notificationService,
      event,
      lateUserId,
      lateUsername,
    });
  }
}
