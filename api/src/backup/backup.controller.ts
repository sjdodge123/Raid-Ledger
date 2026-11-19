import { Controller, Post, Delete, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { validateBackupType } from './backup-type.helpers';
import { BackupService } from './backup.service';

/**
 * The destructive backup routes — session admins only. List / create /
 * download live on `BackupExportController` (ROK-2263) so an export token can
 * never reach these.
 */
@Controller('admin/backups')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@RateLimit('admin')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Delete(':type/:filename')
  deleteBackup(
    @Param('type') type: string,
    @Param('filename') filename: string,
  ) {
    this.backupService.deleteBackup(validateBackupType(type), filename);
    return { success: true, message: `Deleted ${type}/${filename}` };
  }

  @Post(':type/:filename/restore')
  async restoreBackup(
    @Param('type') type: string,
    @Param('filename') filename: string,
  ) {
    await this.backupService.restoreFromBackup(
      validateBackupType(type),
      filename,
    );
    return {
      success: true,
      message: `Database restored from ${type}/${filename}`,
    };
  }

  @Post('reset-instance')
  async resetInstance() {
    const { password } = await this.backupService.resetInstance();
    return {
      success: true,
      message: 'Instance has been reset to factory defaults',
      password,
    };
  }
}
