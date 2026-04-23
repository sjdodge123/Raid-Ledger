import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { AiModule } from '../ai/ai.module';
import { SettingsModule } from '../settings/settings.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { DiscoveryCategoriesService } from './discovery-categories.service';
import { DiscoveryCategoriesAdminController } from './discovery-categories.admin.controller';
import { DemoTestDiscoveryCategoriesController } from './demo-test-discovery-categories.controller';

/**
 * Dynamic Discovery Categories (ROK-567).
 *
 * Hosts the weekly cron, the admin review controller, and the helper
 * `loadApprovedDynamicRows` (exported via the helpers file) that the
 * `igdb.controller.ts` merges into `/games/discover`.
 */
@Module({
  imports: [DrizzleModule, AiModule, SettingsModule, CronJobModule],
  controllers: [
    DiscoveryCategoriesAdminController,
    DemoTestDiscoveryCategoriesController,
  ],
  providers: [DiscoveryCategoriesService],
  exports: [DiscoveryCategoriesService],
})
export class DiscoveryCategoriesModule {}
