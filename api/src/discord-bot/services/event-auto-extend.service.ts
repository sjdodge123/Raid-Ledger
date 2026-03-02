import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ScheduledEventService } from './scheduled-event.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { CronJobService } from '../../cron-jobs/cron-job.service';

/** Look-ahead window: find events ending within the next 5 minutes (ms). */
const WINDOW_AHEAD_MS = 5 * 60 * 1000;

/** Look-behind window: catch events that ended within the last 2 minutes (ms). */
const WINDOW_BEHIND_MS = 2 * 60 * 1000;

/**
 * Auto-extends events (scheduled and ad-hoc) when voice channel activity
 * persists past the event's end time (ROK-576).
 *
 * Runs every 60 seconds. For each eligible event approaching or past its
 * effective end time, checks if enough participants are still in voice.
 * If so, extends `extendedUntil` by the configured increment (default 15 min),
 * capped at a maximum overage (default 12 hours).
 *
 * When voice activity drops below the threshold, the event is NOT extended
 * further. For scheduled events, the classification cron finalizes after
 * `extendedUntil` passes. For ad-hoc events, the grace period queue handles
 * finalization when all members leave.
 */
@Injectable()
export class EventAutoExtendService {
  private readonly logger = new Logger(EventAutoExtendService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly voiceAttendanceService: VoiceAttendanceService,
    private readonly scheduledEventService: ScheduledEventService,
    private readonly adHocNotificationService: AdHocNotificationService,
    private readonly adHocGateway: AdHocEventsGateway,
    private readonly cronJobService: CronJobService,
  ) {}

  @Cron('0 */1 * * * *', {
    name: 'EventAutoExtendService_checkExtensions',
    waitForCompletion: true,
  })
  async handleCheckExtensions(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EventAutoExtendService_checkExtensions',
      async () => {
        await this.checkAndExtendEvents();
      },
    );
  }

  async checkAndExtendEvents(): Promise<void> {
    const enabled = await this.settingsService.getEventAutoExtendEnabled();
    if (!enabled) return;

    const [incrementMinutes, maxOverageMinutes, minVoiceMembers] =
      await Promise.all([
        this.settingsService.getEventAutoExtendIncrementMinutes(),
        this.settingsService.getEventAutoExtendMaxOverageMinutes(),
        this.settingsService.getEventAutoExtendMinVoiceMembers(),
      ]);

    const now = new Date();
    // Look for events whose effective end time is within the look-ahead window
    // or has passed within the look-behind window (to catch events that just ended).
    const windowAhead = new Date(now.getTime() + WINDOW_AHEAD_MS);
    const windowBehind = new Date(now.getTime() - WINDOW_BEHIND_MS);

    // Find events (scheduled and ad-hoc) that are candidates for extension:
    // - Not cancelled
    // - Start time has passed (event is live)
    // - For ad-hoc: must still be in 'live' status (not grace_period/ended)
    // - Effective end time (COALESCE(extended_until, upper(duration))) is
    //   between windowBehind and windowAhead
    const candidates = await this.db
      .select({
        id: schema.events.id,
        duration: schema.events.duration,
        extendedUntil: schema.events.extendedUntil,
        discordScheduledEventId: schema.events.discordScheduledEventId,
        isAdHoc: schema.events.isAdHoc,
        channelBindingId: schema.events.channelBindingId,
      })
      .from(schema.events)
      .where(
        and(
          sql`${schema.events.cancelledAt} IS NULL`,
          sql`(${schema.events.isAdHoc} = false OR ${schema.events.adHocStatus} = 'live')`,
          sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${windowBehind.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) <= ${windowAhead.toISOString()}::timestamptz`,
        ),
      );

    if (candidates.length === 0) return;

    for (const candidate of candidates) {
      // Unified voice count — all events track via VoiceAttendanceService
      const activeCount = this.voiceAttendanceService.getActiveCount(
        candidate.id,
      );

      if (activeCount < minVoiceMembers) {
        this.logger.debug(
          `Event ${candidate.id}: ${activeCount} active voice members (threshold: ${minVoiceMembers}), not extending`,
        );
        continue;
      }

      const originalEnd = candidate.duration[1];
      const currentEffectiveEnd = candidate.extendedUntil ?? originalEnd;

      // Check max overage cap
      const currentOverageMs =
        currentEffectiveEnd.getTime() - originalEnd.getTime();
      const maxOverageMs = maxOverageMinutes * 60 * 1000;

      if (currentOverageMs >= maxOverageMs) {
        this.logger.debug(
          `Event ${candidate.id}: max overage reached (${maxOverageMinutes} min), not extending further`,
        );
        continue;
      }

      // Calculate new extended end time
      const incrementMs = incrementMinutes * 60 * 1000;
      let newExtendedUntil = new Date(
        currentEffectiveEnd.getTime() + incrementMs,
      );

      // Cap at max overage
      const maxEnd = new Date(originalEnd.getTime() + maxOverageMs);
      if (newExtendedUntil > maxEnd) {
        newExtendedUntil = maxEnd;
      }

      // Update the event
      await this.db
        .update(schema.events)
        .set({
          extendedUntil: newExtendedUntil,
          updatedAt: new Date(),
        })
        .where(eq(schema.events.id, candidate.id));

      this.logger.log(
        `Extended event ${candidate.id} until ${newExtendedUntil.toISOString()} (${activeCount} active voice members)`,
      );

      // Emit WebSocket event for real-time UI update
      this.adHocGateway.emitEndTimeExtended(
        candidate.id,
        newExtendedUntil.toISOString(),
      );

      // Update Discord embed for ad-hoc events so duration stays current
      if (candidate.isAdHoc && candidate.channelBindingId) {
        this.adHocNotificationService.queueUpdate(
          candidate.id,
          candidate.channelBindingId,
        );
      }

      // Update Discord Scheduled Event end time
      if (candidate.discordScheduledEventId) {
        this.scheduledEventService
          .updateEndTime(candidate.id, newExtendedUntil)
          .catch((err: unknown) => {
            this.logger.warn(
              `Failed to update Discord scheduled event end time for event ${candidate.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
            );
          });
      }
    }
  }
}
