import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SettingsModule } from '../settings/settings.module';
import { ChurnDetectionService } from './churn-detection.service';
import { CliqueDetectionService } from './clique-detection.service';
import { CommunityInsightsController } from './community-insights.controller';
import { CommunityInsightsService } from './community-insights.service';
import { KeyInsightsService } from './key-insights.service';

@Module({
  imports: [DrizzleModule, CronJobModule, SettingsModule],
  controllers: [CommunityInsightsController],
  providers: [
    CommunityInsightsService,
    ChurnDetectionService,
    CliqueDetectionService,
    KeyInsightsService,
  ],
  exports: [CommunityInsightsService],
})
export class CommunityInsightsModule {}
