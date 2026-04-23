import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { ChurnDetectionService } from './churn-detection.service';
import { CliqueDetectionService } from './clique-detection.service';
import { KeyInsightsService } from './key-insights.service';
import { runRefreshSnapshot } from './pipelines/refresh-snapshot';

export type CommunityInsightsSnapshotRow =
  typeof schema.communityInsightsSnapshots.$inferSelect;

/**
 * Facade for the community-insights module. Reads the latest snapshot row
 * and triggers the refresh pipeline. All heavy lifting lives in
 * `pipelines/` and the three algorithmic services.
 */
@Injectable()
export class CommunityInsightsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
    private readonly settings: SettingsService,
    private readonly churn: ChurnDetectionService,
    private readonly clique: CliqueDetectionService,
    private readonly keyInsights: KeyInsightsService,
  ) {}

  @Cron('0 30 6 * * *', { name: 'CommunityInsightsService_refreshSnapshot' })
  async refreshSnapshotCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'CommunityInsightsService_refreshSnapshot',
      async () => {
        await this.refreshSnapshot();
      },
    );
  }

  /**
   * Rebuild today's snapshot. Returns a freshly-minted opaque job id so
   * callers (admin refresh button) can correlate the trigger with the
   * resulting row — the id is NOT persisted; it's cosmetic.
   */
  async refreshSnapshot(): Promise<{ jobId: string; snapshotDate: string }> {
    const result = await runRefreshSnapshot(this.db, {
      settings: this.settings,
      churn: this.churn,
      clique: this.clique,
      keyInsights: this.keyInsights,
    });
    return { jobId: randomUUID(), snapshotDate: result.snapshotDate };
  }

  /** Latest snapshot row or null if none has been produced yet. */
  async readLatestSnapshot(): Promise<CommunityInsightsSnapshotRow | null> {
    const rows = await this.db
      .select()
      .from(schema.communityInsightsSnapshots)
      .orderBy(desc(schema.communityInsightsSnapshots.snapshotDate))
      .limit(1);
    return rows[0] ?? null;
  }
}
