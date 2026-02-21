import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { BackupService } from './backup.service';

@Controller('admin/backups')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@RateLimit('admin')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get()
  listBackups() {
    const backups = this.backupService.listBackups();
    return { backups, total: backups.length };
  }

  @Post()
  async createBackup() {
    const filepath = await this.backupService.createDailyBackup();
    const backups = this.backupService.listBackups();
    const filename = filepath.split('/').pop()!;
    const backup = backups.find((b) => b.filename === filename);
    return { success: true, message: `Backup created: ${filename}`, backup };
  }

  @Delete(':type/:filename')
  deleteBackup(
    @Param('type') type: string,
    @Param('filename') filename: string,
  ) {
    this.validateType(type);
    this.backupService.deleteBackup(type as 'daily' | 'migration', filename);
    return { success: true, message: `Deleted ${type}/${filename}` };
  }

  @Post(':type/:filename/restore')
  async restoreBackup(
    @Param('type') type: string,
    @Param('filename') filename: string,
  ) {
    this.validateType(type);
    await this.backupService.restoreFromBackup(
      type as 'daily' | 'migration',
      filename,
    );
    return {
      success: true,
      message: `Database restored from ${type}/${filename}`,
    };
  }

  private validateType(type: string): void {
    if (type !== 'daily' && type !== 'migration') {
      throw new BadRequestException('Type must be "daily" or "migration"');
    }
  }
}
