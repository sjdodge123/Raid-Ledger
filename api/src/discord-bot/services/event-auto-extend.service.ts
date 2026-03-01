import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ScheduledEventService } from './scheduled-event.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { CronJobService } from '../../cron-jobs/cron-job.service';

/**
 * Auto-extends scheduled events when voice channel activity persists
 * past the event's end time (ROK-576).
 *
 * Runs every 60 seconds. For each eligible event approaching or past its
 * effective end time, checks if enough participants are still in voice.
 * If so, extends `extendedUntil` by the configured increment (default 15 min),
 * capped at a maximum overage (default 2 hours).
 *
 * When voice activity drops below the threshold, the event is NOT extended
 * further — the classification cron will finalize it after the current
 * `extendedUntil` passes.
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
    // Look for events whose effective end time is within the next 5 minutes
    // or has passed within the last 2 minutes (to catch events that just ended).
    const windowAhead = new Date(now.getTime() + 5 * 60 * 1000);
    const windowBehind = new Date(now.getTime() - 2 * 60 * 1000);

    // Find scheduled (non-ad-hoc) events that are candidates for extension:
    // - Not cancelled
    // - Start time has passed (event is live)
    // - Effective end time (COALESCE(extended_until, upper(duration))) is
    //   between windowBehind and windowAhead
    const candidates = await this.db
      .select({
        id: schema.events.id,
        duration: schema.events.duration,
        extendedUntil: schema.events.extendedUntil,
        discordScheduledEventId: schema.events.discordScheduledEventId,
      })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.isAdHoc, false),
          sql`${schema.events.cancelledAt} IS NULL`,
          sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${windowBehind.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) <= ${windowAhead.toISOString()}::timestamptz`,
        ),
      );

    if (candidates.length === 0) return;

    for (const candidate of candidates) {
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
