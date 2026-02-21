import { Module } from '@nestjs/common';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SettingsModule } from '../settings/settings.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

@Module({
  imports: [CronJobModule, SettingsModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
