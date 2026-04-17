import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { runAggregateVectors } from './pipelines/aggregate-vectors';
import { runWeeklyIntensityRollup } from './pipelines/weekly-intensity';
import { runBuildCoPlayGraph } from './pipelines/build-co-play-graph';
import {
  findSimilarPlayers,
  getTasteProfile,
  type SimilarPlayerRow,
  type TasteProfileResult,
} from './queries/taste-profile-queries';

@Injectable()
export class TasteProfileService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  // ─── Cron wrappers ────────────────────────────────────────────

  @Cron('0 30 5 * * *', { name: 'TasteProfileService_aggregateVectors' })
  async aggregateVectorsCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'TasteProfileService_aggregateVectors',
      () => this.aggregateVectors(),
    );
  }

  @Cron('0 45 5 * * *', { name: 'TasteProfileService_buildCoPlayGraph' })
  async buildCoPlayGraphCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'TasteProfileService_buildCoPlayGraph',
      () => this.buildCoPlayGraph(),
    );
  }

  @Cron('0 0 6 * * 0', { name: 'TasteProfileService_weeklyIntensityRollup' })
  async weeklyIntensityRollupCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'TasteProfileService_weeklyIntensityRollup',
      () => this.weeklyIntensityRollup(),
    );
  }

  // ─── Pipeline entry points (also callable by tests) ───────────

  aggregateVectors(): Promise<void> {
    return runAggregateVectors(this.db);
  }

  buildCoPlayGraph(): Promise<void> {
    return runBuildCoPlayGraph(this.db);
  }

  weeklyIntensityRollup(): Promise<void> {
    return runWeeklyIntensityRollup(this.db);
  }

  // ─── Controller-facing queries ────────────────────────────────

  getTasteProfile(userId: number): Promise<TasteProfileResult | null> {
    return getTasteProfile(this.db, userId);
  }

  findSimilarPlayers(
    userId: number,
    limit: number,
  ): Promise<SimilarPlayerRow[]> {
    return findSimilarPlayers(this.db, userId, limit);
  }
}
