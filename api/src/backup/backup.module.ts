import { Module } from '@nestjs/common';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { SettingsModule } from '../settings/settings.module';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { BackupExportController } from './backup-export.controller';
import {
  BackupExportAuthGuard,
  BackupExportSessionJwtGuard,
} from './export-token/backup-export-auth.guard';
import { BackupExportTokensController } from './export-token/backup-export-tokens.controller';
import { BackupExportTokensRepository } from './export-token/backup-export-tokens.repository';
import { BackupExportTokensService } from './export-token/backup-export-tokens.service';

@Module({
  imports: [CronJobModule, SettingsModule],
  controllers: [
    BackupExportController,
    BackupController,
    BackupExportTokensController,
  ],
  providers: [
    BackupService,
    BackupExportTokensRepository,
    BackupExportTokensService,
    BackupExportAuthGuard,
    BackupExportSessionJwtGuard,
  ],
  exports: [BackupService],
})
export class BackupModule {}
