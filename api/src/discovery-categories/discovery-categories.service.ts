import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { LlmService } from '../ai/llm.service';
import { SettingsService } from '../settings/settings.service';
import { runGenerateSuggestions } from './pipelines/generate-suggestions';
import { runExpireSuggestions } from './pipelines/expire-suggestions';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Weekly dynamic-discovery-category pipeline (ROK-567).
 *
 * Runs Sundays 00:00 UTC, wrapped in `cronJobService.executeWithTracking`
 * so the admin cron panel sees runs + timing + failures. Generates new
 * LLM-proposed rows and expires stale approved ones in the same pass.
 */
@Injectable()
export class DiscoveryCategoriesService {
  private readonly logger = new Logger(DiscoveryCategoriesService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: Db,
    private readonly cronJobService: CronJobService,
    private readonly llmService: LlmService,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron('0 0 0 * * 0', { name: 'DiscoveryCategoriesService_weeklyGenerate' })
  async weeklyGenerateCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'DiscoveryCategoriesService_weeklyGenerate',
      async () => {
        await this.weeklyGenerate();
      },
    );
  }

  /**
   * Same pass: generate new pending rows then expire stale approved ones.
   * Pass `bypassQuota=true` for manual admin-triggered runs so the
   * operator's explicit click isn't blocked by the backlog cap; the cron
   * path always respects the quota.
   */
  async weeklyGenerate(opts?: {
    bypassQuota?: boolean;
  }): Promise<{ inserted: number; expired: number }> {
    const inserted = await runGenerateSuggestions(this.db, {
      llmService: this.llmService,
      settingsService: this.settingsService,
      logger: this.logger,
      bypassQuota: opts?.bypassQuota,
    });
    const expired = await runExpireSuggestions(this.db);
    this.logger.log(
      `dynamic_categories weekly pass: inserted=${inserted} expired=${expired} bypassQuota=${opts?.bypassQuota ?? false}`,
    );
    return { inserted, expired };
  }
}
