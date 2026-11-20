import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { setRunningLate, clearRunningLate } from './running-late.helpers';
import { NotificationService } from '../notifications/notification.service';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot/discord-bot.constants';
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
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Marks the attendee running late. No-op without a signup row. Every
   * caller (DM button, host button) goes through here, so the change is
   * announced once: ROK-2271 C4 posts the late line in the event thread
   * at once (`urgent`).
   */
  async setRunningLate(
    eventId: number,
    userId: number,
    minutes?: number,
  ): Promise<boolean> {
    const marked = await setRunningLate(this.db, eventId, userId, minutes);
    if (marked) this.announce(eventId, userId, 'running_late');
    return marked;
  }

  /**
   * Clears the running-late marker ("I'm here now" button, voice auto-clear).
   * No-op when not currently late; a real clear posts "on time again" at once.
   */
  async clearRunningLate(eventId: number, userId: number): Promise<boolean> {
    const cleared = await clearRunningLate(this.db, eventId, userId);
    if (cleared) this.announce(eventId, userId, 'running_late_cleared');
    return cleared;
  }

  private announce(eventId: number, userId: number, action: string): void {
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId,
      action,
      urgent: true,
    } satisfies SignupEventPayload);
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
