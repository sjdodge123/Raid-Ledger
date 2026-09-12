import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { BackupService } from '../backup/backup.service';
import { SimulateBackupCorruptionSchema } from './demo-test.schemas';
import { parseDemoBody } from './demo-test.utils';
import { resolveDailyDir, writeCorruptDump } from './demo-test-backup.helpers';

/**
 * Backup corruption endpoint — DEMO_MODE only (ROK-1160 D9).
 *
 * Produces the deliberately bad artefact the weekly restore drill is pointed
 * at, so AC3 ("the alert fires on failure") is a tested claim rather than an
 * assumption. The DEMO_MODE gate is the only thing keeping a `corrupt_*.dump`
 * out of a production backup listing — never relax it to make a test easier.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestBackupController {
  constructor(
    private readonly configService: ConfigService,
    private readonly backupService: BackupService,
  ) {}

  /** Write an intentionally bad `.dump` into the daily dir — DEMO_MODE only. */
  @Post('backup/simulate-corruption')
  @HttpCode(HttpStatus.OK)
  simulateCorruption(@Body() body: unknown): {
    filename: string;
    path: string;
    mode: 'truncate' | 'garbage';
  } {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Only available in DEMO_MODE');
    }
    const { mode } = parseDemoBody(SimulateBackupCorruptionSchema, body);
    const dailyDir = resolveDailyDir(this.configService);
    const filename = writeCorruptDump(dailyDir, mode);
    // Post-write self-check only: getBackupFilePath sanitizes the name AND
    // asserts existence (backup.service.ts:194-203), so it proves the file
    // landed where the drill's fetch step will look for it.
    const resolved = this.backupService.getBackupFilePath('daily', filename);
    return { filename, path: resolved, mode };
  }
}
