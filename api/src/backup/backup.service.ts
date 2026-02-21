import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CronJobService } from '../cron-jobs/cron-job.service';

const execFileAsync = promisify(execFile);

/** Default backup path (inside /data Docker volume in production) */
const DEFAULT_BACKUP_BASE = '/data/backups';

/** Number of days to retain daily backups */
const DAILY_RETENTION_DAYS = 30;

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly databaseUrl: string;
  private readonly backupBase: string;
  private readonly dailyDir: string;
  private readonly migrationDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly cronJobService: CronJobService,
  ) {
    const url = this.configService.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error('DATABASE_URL is required for BackupService');
    }
    this.databaseUrl = url;
    this.backupBase =
      this.configService.get<string>('BACKUP_DIR') || DEFAULT_BACKUP_BASE;
    this.dailyDir = path.join(this.backupBase, 'daily');
    this.migrationDir = path.join(this.backupBase, 'migrations');
  }

  onModuleInit(): void {
    this.ensureDirectories();
  }

  /**
   * Create backup directories if they don't exist.
   */
  private ensureDirectories(): void {
    try {
      fs.mkdirSync(this.dailyDir, { recursive: true });
      fs.mkdirSync(this.migrationDir, { recursive: true });
      this.logger.log(`Backup directories ready at ${this.backupBase}`);
    } catch (err) {
      this.logger.warn(
        `Could not create backup directories (expected in dev): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Daily scheduled backup at 2 AM.
   * Produces a pg_dump custom-format compressed file.
   */
  @Cron('0 2 * * *', { name: 'BackupService_dailyBackup' })
  async handleDailyBackup(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'BackupService_dailyBackup',
      async () => {
        await this.createDailyBackup();
        this.rotateDailyBackups();
      },
    );
  }

  /**
   * Create a daily pg_dump backup.
   */
  async createDailyBackup(): Promise<string> {
    const timestamp = this.formatTimestamp(new Date());
    const filename = `raid_ledger_${timestamp}.dump`;
    const filepath = path.join(this.dailyDir, filename);

    this.logger.log(`Starting daily backup: ${filename}`);

    await this.runPgDump(filepath);

    const stats = fs.statSync(filepath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    this.logger.log(`Daily backup complete: ${filename} (${sizeMb} MB)`);

    return filepath;
  }

  /**
   * Create a pre-migration snapshot.
   * Called from docker-entrypoint.sh before drizzle-kit migrate.
   * Can also be called programmatically if needed.
   */
  async createMigrationSnapshot(migrationLabel: string): Promise<string> {
    const timestamp = this.formatTimestamp(new Date());
    const safeName = migrationLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `pre_${safeName}_${timestamp}.dump`;
    const filepath = path.join(this.migrationDir, filename);

    this.logger.log(`Starting pre-migration snapshot: ${filename}`);

    await this.runPgDump(filepath);

    const stats = fs.statSync(filepath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    this.logger.log(
      `Pre-migration snapshot complete: ${filename} (${sizeMb} MB)`,
    );

    return filepath;
  }

  /**
   * Remove daily backups older than DAILY_RETENTION_DAYS.
   */
  rotateDailyBackups(): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAILY_RETENTION_DAYS);

    let removed = 0;

    try {
      const files = fs.readdirSync(this.dailyDir);
      for (const file of files) {
        const filepath = path.join(this.dailyDir, file);
        const stats = fs.statSync(filepath);
        if (stats.mtime < cutoff) {
          fs.unlinkSync(filepath);
          removed++;
          this.logger.log(`Rotated old backup: ${file}`);
        }
      }
    } catch (err) {
      this.logger.warn(
        `Backup rotation error: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (removed > 0) {
      this.logger.log(
        `Rotated ${removed} backup(s) older than ${DAILY_RETENTION_DAYS} days`,
      );
    }

    return removed;
  }

  /**
   * List all backup files from both daily and migrations directories.
   */
  listBackups(): {
    filename: string;
    type: 'daily' | 'migration';
    sizeBytes: number;
    createdAt: string;
  }[] {
    const backups: {
      filename: string;
      type: 'daily' | 'migration';
      sizeBytes: number;
      createdAt: string;
    }[] = [];

    for (const [dir, type] of [
      [this.dailyDir, 'daily'],
      [this.migrationDir, 'migration'],
    ] as const) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (!file.endsWith('.dump')) continue;
          const filepath = path.join(dir, file);
          const stats = fs.statSync(filepath);
          backups.push({
            filename: file,
            type,
            sizeBytes: stats.size,
            createdAt: stats.birthtime.toISOString(),
          });
        }
      } catch {
        // Directory may not exist yet
      }
    }

    return backups.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /**
   * Delete a specific backup file.
   */
  deleteBackup(type: 'daily' | 'migration', filename: string): void {
    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..')
    ) {
      throw new BadRequestException('Invalid filename');
    }

    const dir = type === 'daily' ? this.dailyDir : this.migrationDir;
    const filepath = path.join(dir, filename);

    if (!fs.existsSync(filepath)) {
      throw new NotFoundException(`Backup file not found: ${filename}`);
    }

    fs.unlinkSync(filepath);
    this.logger.log(`Deleted backup: ${type}/${filename}`);
  }

  /**
   * Restore the database from a backup file.
   * Creates a pre-restore safety snapshot first.
   */
  async restoreFromBackup(
    type: 'daily' | 'migration',
    filename: string,
  ): Promise<void> {
    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..')
    ) {
      throw new BadRequestException('Invalid filename');
    }

    const dir = type === 'daily' ? this.dailyDir : this.migrationDir;
    const filepath = path.join(dir, filename);

    if (!fs.existsSync(filepath)) {
      throw new NotFoundException(`Backup file not found: ${filename}`);
    }

    this.logger.warn(
      `Creating pre-restore safety snapshot before restoring from ${filename}`,
    );
    await this.createMigrationSnapshot('restore');

    this.logger.warn(`Starting database restore from: ${type}/${filename}`);

    try {
      await execFileAsync('pg_restore', [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        `--dbname=${this.databaseUrl}`,
        filepath,
      ]);
      this.logger.log(`Database restore complete from: ${filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // pg_restore exits with code 1 for warnings (e.g. objects that don't exist)
      // Only treat as failure if stderr contains actual errors
      if (message.includes('pg_restore: error:')) {
        this.logger.error(`pg_restore failed: ${message}`);
        throw new InternalServerErrorException(
          `Database restore failed: ${message}`,
        );
      }
      this.logger.warn(`pg_restore completed with warnings: ${message}`);
    }
  }

  /**
   * Run pg_dump in custom format (compressed, supports selective restore).
   */
  private async runPgDump(outputPath: string): Promise<void> {
    try {
      await execFileAsync('pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--file=${outputPath}`,
        this.databaseUrl,
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`pg_dump failed: ${message}`);
      // Clean up partial file
      try {
        fs.unlinkSync(outputPath);
      } catch {
        // ignore cleanup errors
      }
      throw new Error(`pg_dump failed: ${message}`);
    }
  }

  /**
   * Format a Date as YYYY-MM-DD_HHMMSS.
   */
  private formatTimestamp(date: Date): string {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d}_${h}${mi}${s}`;
  }
}
