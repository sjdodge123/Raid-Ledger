import { Module } from '@nestjs/common';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SettingsModule } from '../settings/settings.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { BackupExportTokensController } from './export-token/backup-export-tokens.controller';
import { BackupExportTokensRepository } from './export-token/backup-export-tokens.repository';
import { BackupExportTokensService } from './export-token/backup-export-tokens.service';

@Module({
  imports: [CronJobModule, SettingsModule],
  controllers: [BackupController, BackupExportTokensController],
  providers: [
    BackupService,
    BackupExportTokensRepository,
    BackupExportTokensService,
  ],
  exports: [BackupService, BackupExportTokensRepository],
})
export class BackupModule {}
