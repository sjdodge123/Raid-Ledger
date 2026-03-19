import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import { ActiveEventCacheService } from '../../events/active-event-cache.service';

/** Look-ahead window: find events ending within the next 5 minutes (ms). */
const WINDOW_AHEAD_MS = 5 * 60 * 1000;

/** Look-behind window: catch events that ended within the last 5 minutes (ms). */
const WINDOW_BEHIND_MS = 5 * 60 * 1000;

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
    @Optional() private readonly eventCache: ActiveEventCacheService | null,
  ) {}

  @Cron('0 */1 * * * *', {
    name: 'EventAutoExtendService_checkExtensions',
    waitForCompletion: true,
  })
  async handleCheckExtensions(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'EventAutoExtendService_checkExtensions',
      () => this.checkAndExtendEvents(),
    );
  }

  async checkAndExtendEvents(): Promise<void | false> {
    const enabled = await this.settingsService.getEventAutoExtendEnabled();
    if (!enabled) {
      this.logger.debug('Auto-extend is disabled, skipping');
      return false;
    }
    if (this.eventCache) {
      const now = new Date();
      const active = this.eventCache.getActiveEvents(now);
      const recent = this.eventCache.getRecentlyEndedEvents(
        now,
        WINDOW_BEHIND_MS,
      );
      if (active.length === 0 && recent.length === 0) return false;
    }
    const config = await this.loadExtendConfig();
    const now = new Date();
    const candidates = await this.queryCandidates(now);
    this.logger.debug(`Auto-extend candidates found: ${candidates.length}`);
    if (candidates.length === 0) return false;
    for (const c of candidates) {
      await this.tryExtendCandidate(c, config);
    }
  }

  /** Load auto-extend configuration from settings. */
  private async loadExtendConfig(): Promise<ExtendConfig> {
    const [incrementMinutes, maxOverageMinutes, minVoiceMembers] =
      await Promise.all([
        this.settingsService.getEventAutoExtendIncrementMinutes(),
        this.settingsService.getEventAutoExtendMaxOverageMinutes(),
        this.settingsService.getEventAutoExtendMinVoiceMembers(),
      ]);
    return { incrementMinutes, maxOverageMinutes, minVoiceMembers };
  }

  /** Find events approaching their effective end time. */
  private async queryCandidates(now: Date): Promise<ExtendCandidate[]> {
    const ahead = new Date(now.getTime() + WINDOW_AHEAD_MS);
    const behind = new Date(now.getTime() - WINDOW_BEHIND_MS);
    return this.db
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
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${behind.toISOString()}::timestamptz`,
          sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) <= ${ahead.toISOString()}::timestamptz`,
        ),
      );
  }

  /** Check and extend a single candidate event. */
  private async tryExtendCandidate(
    c: ExtendCandidate,
    config: ExtendConfig,
  ): Promise<void> {
    const activeCount = this.voiceAttendanceService.getActiveCount(c.id);
    if (activeCount < config.minVoiceMembers) {
      this.logger.debug(
        `Event ${c.id}: ${activeCount} voice members (threshold: ${config.minVoiceMembers}), skip`,
      );
      return;
    }
    const newEnd = this.computeNewEnd(c, config);
    if (!newEnd) return;
    await this.applyExtension(c, newEnd, activeCount);
  }

  /** Compute the new extended end time, or null if max overage reached. */
  private computeNewEnd(c: ExtendCandidate, config: ExtendConfig): Date | null {
    const originalEnd = c.duration[1];
    const effectiveEnd = c.extendedUntil ?? originalEnd;
    const maxOverageMs = config.maxOverageMinutes * 60 * 1000;
    if (effectiveEnd.getTime() - originalEnd.getTime() >= maxOverageMs) {
      this.logger.debug(`Event ${c.id}: max overage reached, skip`);
      return null;
    }
    const incrementMs = config.incrementMinutes * 60 * 1000;
    const maxEnd = new Date(originalEnd.getTime() + maxOverageMs);
    const raw = new Date(effectiveEnd.getTime() + incrementMs);
    return raw > maxEnd ? maxEnd : raw;
  }

  /** Persist extension and fire side effects. */
  private async applyExtension(
    c: ExtendCandidate,
    newEnd: Date,
    activeCount: number,
  ): Promise<void> {
    await this.db
      .update(schema.events)
      .set({ extendedUntil: newEnd, updatedAt: new Date() })
      .where(eq(schema.events.id, c.id));
    this.eventCache?.invalidate(c.id);
    this.eventCache?.refresh().catch((e) => this.logger.warn(`Cache refresh after extend failed: ${e}`));
    this.logger.log(`Extended event ${c.id} until ${newEnd.toISOString()} (${activeCount} voice members)`);
    this.adHocGateway.emitEndTimeExtended(c.id, newEnd.toISOString());
    if (c.isAdHoc && c.channelBindingId) this.adHocNotificationService.queueUpdate(c.id, c.channelBindingId);
    if (c.discordScheduledEventId) {
      this.scheduledEventService.updateEndTime(c.id, newEnd).catch((err: unknown) => {
        this.logger.warn(`Failed to update scheduled event end time for ${c.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
      });
    }
  }
}

interface ExtendConfig {
  incrementMinutes: number;
  maxOverageMinutes: number;
  minVoiceMembers: number;
}

interface ExtendCandidate {
  id: number;
  duration: Date[];
  extendedUntil: Date | null;
  discordScheduledEventId: string | null;
  isAdHoc: boolean;
  channelBindingId: string | null;
}
