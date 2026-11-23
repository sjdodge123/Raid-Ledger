/**
 * ROK-2263 D3: the three export routes (list, create, download), split off
 * `BackupController` so an `rlbx_` export token can reach exactly these and
 * nothing else. Paths and responses are unchanged for an admin session.
 * Handlers never read `req.user` — a token request has none.
 */
import {
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { validateBackupType } from './backup-type.helpers';
import { BackupService } from './backup.service';
import { BackupExportAuthGuard } from './export-token/backup-export-auth.guard';

@Controller('admin/backups')
@UseGuards(BackupExportAuthGuard)
@RateLimit('admin')
export class BackupExportController {
  constructor(private readonly backupService: BackupService) {}

  private readonly logger = new Logger(BackupExportController.name);

  @Get()
  listBackups() {
    const backups = this.backupService.listBackups();
    return { backups, total: backups.length };
  }

  @Post()
  async createBackup() {
    const filepath = await this.backupService.createDailyBackup();
    const backups = this.backupService.listBackups();
    const filename = path.basename(filepath);
    const backup = backups.find((b) => b.filename === filename);
    return { success: true, message: `Backup created: ${filename}`, backup };
  }

  @Get(':type/:filename/download')
  downloadBackup(
    @Param('type') type: string,
    @Param('filename') filename: string,
    @Res({ passthrough: false }) res: Response,
  ): void {
    const absPath = this.backupService.getBackupFilePath(
      validateBackupType(type),
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
}
