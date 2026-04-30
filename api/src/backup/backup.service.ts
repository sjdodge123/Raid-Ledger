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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import type { BackupFileDto } from '@raid-ledger/contract';
import {
  runPgDumpDirect,
  runPgDumpDocker,
  runPgRestoreDirect,
  runPgRestoreDocker,
  isRestoreFatal,
  runMigrations,
  bootstrapAdmin,
  seedGameData,
  dropSchemas,
  cleanupPartialFile,
} from './backup.helpers';

const DEFAULT_BACKUP_BASE = path.join(process.cwd(), 'backups');
const DAILY_RETENTION_DAYS = 30;
const DEFAULT_DB_CONTAINER = 'raid-ledger-db';

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly databaseUrl: string;
  private readonly backupBase: string;
  private readonly dailyDir: string;
  private readonly migrationDir: string;
  private readonly dbContainer: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly cronJobService: CronJobService,
    private readonly settingsService: SettingsService,
  ) {
    const url = this.configService.get<string>('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL is required for BackupService');
    this.databaseUrl = url;
    const isProduction = process.env.NODE_ENV === 'production';
    this.dbContainer = isProduction
      ? ''
      : (this.configService.get<string>('DB_CONTAINER_NAME') ??
        DEFAULT_DB_CONTAINER);
    this.backupBase =
      this.configService.get<string>('BACKUP_DIR') || DEFAULT_BACKUP_BASE;
    this.dailyDir = path.join(this.backupBase, 'daily');
    this.migrationDir = path.join(this.backupBase, 'migrations');
  }

  onModuleInit(): void {
    this.ensureDirectories();
  }

  /** Create backup directories if they don't exist. */
  private ensureDirectories(): void {
    try {
      fs.mkdirSync(this.dailyDir, { recursive: true });
      fs.mkdirSync(this.migrationDir, { recursive: true });
      this.logger.log(`Backup directories ready at ${this.backupBase}`);
    } catch (err) {
      this.logger.warn(
        `Could not create backup directories: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Daily scheduled backup at 2 AM. */
  @Cron('10 0 2 * * *', { name: 'BackupService_dailyBackup' })
  async handleDailyBackup(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'BackupService_dailyBackup',
      async () => {
        await this.createDailyBackup();
        this.rotateDailyBackups();
      },
    );
  }

  /** Create a daily pg_dump backup. */
  async createDailyBackup(): Promise<string> {
    const timestamp = this.formatTimestamp(new Date());
    const filename = `raid_ledger_${timestamp}.dump`;
    const filepath = path.join(this.dailyDir, filename);
    this.logger.log(`Starting daily backup: ${filename}`);
    await this.runPgDump(filepath);
    const stats = fs.statSync(filepath);
    this.logger.log(
      `Daily backup complete: ${filename} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`,
    );
    return filepath;
  }

  /** Create a pre-migration snapshot. */
  async createMigrationSnapshot(migrationLabel: string): Promise<string> {
    const timestamp = this.formatTimestamp(new Date());
    const safeName = migrationLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `pre_${safeName}_${timestamp}.dump`;
    const filepath = path.join(this.migrationDir, filename);
    this.logger.log(`Starting pre-migration snapshot: ${filename}`);
    await this.runPgDump(filepath);
    const stats = fs.statSync(filepath);
    this.logger.log(
      `Snapshot complete: ${filename} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`,
    );
    return filepath;
  }

  /** Remove daily backups older than retention period. */
  rotateDailyBackups(): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAILY_RETENTION_DAYS);
    let removed = 0;
    try {
      for (const file of fs.readdirSync(this.dailyDir)) {
        const filepath = path.join(this.dailyDir, file);
        if (fs.statSync(filepath).mtime < cutoff) {
          fs.unlinkSync(filepath);
          removed++;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Backup rotation error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (removed > 0) this.logger.log(`Rotated ${removed} backup(s)`);
    return removed;
  }

  /** List all backup files from both directories. */
  listBackups(): BackupFileDto[] {
    const backups: BackupFileDto[] = [];
    for (const [dir, type] of [
      [this.dailyDir, 'daily'],
      [this.migrationDir, 'migration'],
    ] as const) {
      try {
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.dump')) continue;
          const stats = fs.statSync(path.join(dir, file));
          backups.push({
            filename: file,
            type,
            sizeBytes: stats.size,
            createdAt: stats.birthtime.toISOString(),
          });
        }
      } catch {
        /* Directory may not exist yet */
      }
    }
    return backups.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  /** Delete a specific backup file. */
  deleteBackup(type: 'daily' | 'migration', filename: string): void {
    this.validateFilename(filename);
    const dir = type === 'daily' ? this.dailyDir : this.migrationDir;
    const filepath = path.join(dir, filename);
    if (!fs.existsSync(filepath))
      throw new NotFoundException(`Backup file not found: ${filename}`);
    fs.unlinkSync(filepath);
    this.logger.log(`Deleted backup: ${type}/${filename}`);
  }

  /** Restore the database from a backup file. */
  async restoreFromBackup(
    type: 'daily' | 'migration',
    filename: string,
  ): Promise<void> {
    const filepath = this.resolveBackupPath(type, filename);
    await this.createMigrationSnapshot('restore');
    this.logger.warn(`Starting database restore from: ${type}/${filename}`);
    await this.executeRestore(filepath);
    await this.runPostRestoreMigrations();
    await this.settingsService.reloadAndReconnectIntegrations();
    this.logger.log(`Database restore complete from: ${filename}`);
  }

  /** Factory-reset the instance. */
  async resetInstance(): Promise<{ password: string }> {
    this.logger.warn('FACTORY RESET initiated — creating safety backup...');
    await this.createMigrationSnapshot('factory-reset');
    this.settingsService.emitAllIntegrationsCleared();
    this.logger.warn('Dropping all database schemas...');
    await dropSchemas(this.databaseUrl, this.dbContainer);
    const apiRoot = path.resolve(__dirname, '../../..');
    this.logger.warn('Running database migrations...');
    await runMigrations(apiRoot);
    this.logger.warn('Bootstrapping admin account...');
    const password = await bootstrapAdmin(apiRoot);
    this.logger.warn('Seeding game data...');
    await seedGameData(apiRoot);
    this.settingsService.invalidateCache();
    this.logger.warn('FACTORY RESET complete — instance has been reset');
    return { password };
  }

  // ─── Private helpers ──────────────────────────────────────────

  /** Validate backup filename for path traversal. */
  private validateFilename(filename: string): void {
    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('..')
    ) {
      throw new BadRequestException('Invalid filename');
    }
  }

  /** Resolve and validate a backup file path. */
  private resolveBackupPath(
    type: 'daily' | 'migration',
    filename: string,
  ): string {
    this.validateFilename(filename);
    const dir = type === 'daily' ? this.dailyDir : this.migrationDir;
    const filepath = path.join(dir, filename);
    if (!fs.existsSync(filepath))
      throw new NotFoundException(`Backup file not found: ${filename}`);
    return filepath;
  }

  /** Execute pg_restore with error handling. */
  private async executeRestore(filepath: string): Promise<void> {
    try {
      if (!this.dbContainer) {
        await runPgRestoreDirect(filepath, this.databaseUrl);
      } else {
        await runPgRestoreDocker(filepath, this.databaseUrl, this.dbContainer);
      }
    } catch (err) {
      if (isRestoreFatal(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`pg_restore failed: ${msg}`);
        throw new InternalServerErrorException(
          `Database restore failed: ${msg}`,
        );
      }
      this.logger.warn(
        `pg_restore completed with warnings: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Run post-restore migrations. */
  private async runPostRestoreMigrations(): Promise<void> {
    this.logger.warn('Running post-restore migrations...');
    const apiRoot = path.resolve(__dirname, '../../..');
    try {
      await runMigrations(apiRoot);
      this.logger.log('Post-restore migrations complete');
    } catch (err) {
      this.logger.warn(
        `Post-restore migration note: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Run pg_dump (direct or via Docker). */
  private async runPgDump(outputPath: string): Promise<void> {
    try {
      if (!this.dbContainer) {
        await runPgDumpDirect(outputPath, this.databaseUrl);
      } else {
        await runPgDumpDocker(outputPath, this.databaseUrl, this.dbContainer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`pg_dump failed: ${msg}`);
      cleanupPartialFile(outputPath);
      throw new Error(`pg_dump failed: ${msg}`, { cause: err });
    }
  }

  /** Format a Date as YYYY-MM-DD_HHMMSS. */
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
