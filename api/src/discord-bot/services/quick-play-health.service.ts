/**
 * ROK-1417 (plan B3b, Tier 3) — Quick Play health canary.
 *
 * A daily cron that answers one question the per-join trace can't: "did Quick
 * Play actually work lately?" It lands a `cron_job_executions` row (admin-
 * rendered, re-runnable via POST /admin/cron-jobs/:id/run) so a silent stall —
 * zero ad-hoc events spawned while inert bindings sit on channels that should
 * be spawning — surfaces as a FAILED job + Sentry message instead of a
 * dashboard nobody reads (the ROK-1415 failure mode).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gt, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as Sentry from '@sentry/nestjs';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SETTING_KEYS } from '../../drizzle/schema';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { SettingsService } from '../../settings/settings.service';
import {
  isInertQuickPlayBind,
  type HealBinding,
} from './channel-bindings-heal.helpers';

const JOB_NAME = 'QuickPlayHealthService_checkQuickPlayHealth';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class QuickPlayHealthService {
  private readonly logger = new Logger(QuickPlayHealthService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron('0 15 5 * * *', { name: JOB_NAME })
  async checkQuickPlayHealth(): Promise<void> {
    await this.cronJobService.executeWithTracking(JOB_NAME, () =>
      this.runHealthCheck(),
    );
  }

  /** Gather the four metrics, always log, and fail loudly on a silent stall. */
  private async runHealthCheck(): Promise<void> {
    const adHoc = await this.countAdHocLast7Days();
    const inert = await this.findInertBindings();
    const monitorsNoAdHoc = await this.countMonitorsWithoutAdHoc();
    const enabled = await this.settingsService.get(
      SETTING_KEYS.AD_HOC_EVENTS_ENABLED,
    );
    this.logger.log(
      `[quick-play-health] adhoc_7d=${adHoc.count} ` +
        // max(created_at) comes back from postgres-js as a raw string for the
        // aggregate expression (no column parser), so interpolate it as-is
        // rather than calling Date methods on it.
        `last=${String(adHoc.lastCreatedAt ?? 'never')} ` +
        `inert=${inert.length} monitors_no_adhoc=${monitorsNoAdHoc} ` +
        `enabled=${enabled ?? 'unset'}`,
    );
    // The alarm: Quick Play produced nothing in a week AND channels exist that
    // should be able to spawn but can't (the ROK-1415 inert shape).
    if (adHoc.count === 0 && inert.length > 0) this.reportInert(inert);
  }

  /** Sentry + throw so CronJobService records status='failed' with the detail. */
  private reportInert(inert: HealBinding[]): never {
    const channels = inert.map((b) => b.channelId).join(', ');
    Sentry.captureMessage('Quick Play health canary failed', {
      level: 'warning',
      tags: { context: 'quick-play-health' },
      extra: { inertChannels: channels },
    });
    throw new Error(
      `Quick Play produced 0 ad-hoc events in the last 7 days but ` +
        `${inert.length} inert binding(s) exist: ${channels}`,
    );
  }

  /** Metric 1: ad-hoc events created in the last 7 days (the "does it work" #). */
  private async countAdHocLast7Days(): Promise<{
    count: number;
    lastCreatedAt: Date | string | null;
  }> {
    const since = new Date(Date.now() - SEVEN_DAYS_MS);
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        lastCreatedAt: sql<
          Date | string | null
        >`max(${schema.events.createdAt})`,
      })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.isAdHoc, true),
          gt(schema.events.createdAt, since),
        ),
      );
    return {
      count: Number(row?.count ?? 0),
      lastCreatedAt: row?.lastCreatedAt ?? null,
    };
  }

  /** Metric 2: null-game voice monitors (ROK-1415 inert shape) via the heal guard. */
  private async findInertBindings(): Promise<HealBinding[]> {
    const rows = await this.db
      .select({
        channelId: schema.channelBindings.channelId,
        channelType: schema.channelBindings.channelType,
        bindingPurpose: schema.channelBindings.bindingPurpose,
        gameId: schema.channelBindings.gameId,
        recurrenceGroupId: schema.channelBindings.recurrenceGroupId,
      })
      .from(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.channelType, 'voice'),
          eq(schema.channelBindings.bindingPurpose, 'game-voice-monitor'),
        ),
      );
    return rows.filter(isInertQuickPlayBind);
  }

  /** Metric 3: voice monitors that have never produced an ad-hoc event. */
  private async countMonitorsWithoutAdHoc(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.channelBindings)
      .where(
        and(
          eq(schema.channelBindings.channelType, 'voice'),
          eq(schema.channelBindings.bindingPurpose, 'game-voice-monitor'),
          sql`NOT EXISTS (SELECT 1 FROM events e WHERE e.channel_binding_id = ${schema.channelBindings.id} AND e.is_ad_hoc = true)`,
        ),
      );
    return Number(row?.count ?? 0);
  }
}
