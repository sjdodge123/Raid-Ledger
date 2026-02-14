import { Module } from '@nestjs/common';
import { VersionController } from './version.controller';
import { VersionCheckService } from './version-check.service';
import { SettingsModule } from '../settings/settings.module';
import { CronJobModule } from '../cron-jobs/cron-job.module';

/**
 * Version module (ROK-294).
 * Provides version info endpoints and scheduled update checks.
 */
@Module({
  imports: [SettingsModule, CronJobModule],
  controllers: [VersionController],
  providers: [VersionCheckService],
  exports: [VersionCheckService],
})
export class VersionModule {}
