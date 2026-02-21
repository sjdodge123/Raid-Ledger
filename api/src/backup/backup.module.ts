import { Module } from '@nestjs/common';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { BackupService } from './backup.service';

@Module({
  imports: [CronJobModule],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
