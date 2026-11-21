import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';
import { getCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_NEEDS_RECONNECT_EVENT,
  type CalendarNeedsReconnectPayload,
} from '../calendar-sync/calendar-needs-reconnect.events';
import {
  buildReconnectNudgeInput,
  claimReconnectNudge,
} from './calendar-reconnect-nudge.helpers';

/**
 * ROK-1866: sends the one "reconnect your calendar" nudge per
 * `needs_reconnect` episode. Sync off → nothing and no claim (D6); the
 * atomic claim is the only dedupe (D1/D3). Channel prefs and deactivated
 * users are also enforced by `NotificationService.create`. The claim runs
 * before the create, so delivery is at-most-once per episode (a create that
 * throws after the claim is logged at error level, never retried). Never
 * rejects (an `@OnEvent` throw would be unhandled).
 */
@Injectable()
export class CalendarReconnectNudgeListener {
  private readonly logger = new Logger(CalendarReconnectNudgeListener.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly settingsService: SettingsService,
  ) {}

  /** Returns true when the nudge was claimed and created. */
  @OnEvent(CALENDAR_NEEDS_RECONNECT_EVENT)
  async handle(payload: CalendarNeedsReconnectPayload): Promise<boolean> {
    try {
      return await this.notify(payload.connectionId);
    } catch (err) {
      this.logger.warn(
        `ROK-1866: reconnect nudge failed for connection ${payload.connectionId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  private async notify(connectionId: number): Promise<boolean> {
    if (!(await getCalendarSyncEnabled(this.settingsService))) return false;
    const claimed = await claimReconnectNudge(this.db, connectionId);
    if (!claimed) return false;
    try {
      const created = await this.notificationService.create(
        buildReconnectNudgeInput(claimed, connectionId),
      );
      return created !== null;
    } catch (err) {
      this.reportLostNudge(connectionId, err);
      return false;
    }
  }

  /**
   * Claim-then-create is at-most-once by design: the episode stays stamped,
   * so a create that throws after the claim means this member gets no nudge
   * until they reconnect. Loud on purpose — error level + Sentry.
   */
  private reportLostNudge(connectionId: number, err: unknown): void {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    this.logger.error(
      `ROK-1866: nudge claimed but not created for connection ${connectionId}; it will not be retried this episode: ${msg}`,
    );
    Sentry.captureException(err, {
      tags: { context: 'calendar-reconnect-nudge' },
    });
  }
}
