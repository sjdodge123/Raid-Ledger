import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Res,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { BackupService } from './backup.service';

@Controller('admin/backups')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@RateLimit('admin')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  private readonly logger = new Logger(BackupController.name);

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

  @Get(':type/:filename/download')
  downloadBackup(
    @Param('type') type: string,
    @Param('filename') filename: string,
    @Res({ passthrough: false }) res: Response,
  ): void {
    this.validateType(type);
    const absPath = this.backupService.getBackupFilePath(
      type as 'daily' | 'migration',
      filename,
    );
    const basename = path.basename(absPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${basename}"`);
    const stream = fs.createReadStream(absPath);
    stream.on('error', (err) => {
      this.logger.warn(
        `Backup download stream error for ${basename}: ${err.message}`,
      );
      res.destroy(err);
    });
    stream.pipe(res);
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

  @Post('reset-instance')
  async resetInstance() {
    const { password } = await this.backupService.resetInstance();
    return {
      success: true,
      message: 'Instance has been reset to factory defaults',
      password,
    };
  }

  private validateType(type: string): void {
    if (type !== 'daily' && type !== 'migration') {
      throw new BadRequestException('Type must be "daily" or "migration"');
    }
  }
}
