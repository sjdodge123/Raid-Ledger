import {
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
  formatBackupTimestamp,
} from './backup.helpers';
import {
  rotateDailyDir,
  rotateMigrationDir,
  rotateUploadsArchives,
} from './backup-rotation.helpers';
import {
  uploadsArchiveFailure,
  type UploadsArchiveResult,
} from './backup-uploads.helpers';
import {
  archiveUploadsForDump,
  deleteUploadsArchiveOf,
  removeStalePartialArchives,
} from './backup-uploads.wiring';
import {
  reportBackgroundArchive,
  UploadsArchiveTracker,
} from './backup-uploads.tracker';
import { listBackupFiles, resolveBackupFile } from './backup-list.helpers';

const DEFAULT_BACKUP_BASE = path.join(process.cwd(), 'backups');
const DAILY_RETENTION_DAYS = 30;
/** ROK-1663: newest pre_migration_*.dump snapshots kept (one is written per boot). */
const MIGRATION_SNAPSHOT_KEEP = 10;
/** ROK-2023 (spec D10b): newest daily uploads archives kept. */
const UPLOADS_ARCHIVE_KEEP = 7;
const DEFAULT_DB_CONTAINER = 'raid-ledger-db';

// ROK-1279: tables whose ROW DATA is excluded from every dump produced by this
// service. Schema is preserved (so restore works); contents are not. Local
// bootstrap repopulates app_settings from env; --reset-password rehydrates
// local_credentials.
const SANITIZED_EXCLUDED_TABLES = [
  'app_settings',
  'local_credentials',
  'sessions',
  'consumed_intent_tokens',
] as const;

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly databaseUrl: string;
  private readonly backupBase: string;
  private readonly dailyDir: string;
  private readonly migrationDir: string;
  private readonly dbContainer: string;
  /** Public for the integration spec's `whenIdle()` seam. */
  readonly uploadsArchives: UploadsArchiveTracker;

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
    this.uploadsArchives = new UploadsArchiveTracker(
      this.dailyDir,
      this.logger,
    );
  }

  onModuleInit(): void {
    this.ensureDirectories();
    removeStalePartialArchives(this.dailyDir, this.logger);
    this.rotateMigrationSnapshots();
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

  /**
   * Daily scheduled backup at 2 AM. ROK-2023 (spec D9): every rotation runs
   * even when the uploads archive failed (a full disk must still free up);
   * only then does a failed archive fail the tracked run.
   */
  @Cron('10 0 2 * * *', { name: 'BackupService_dailyBackup' })
  async handleDailyBackup(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'BackupService_dailyBackup',
      async () => {
        const { archive } = await this.createDailyBackupWithArchive();
        this.rotateDailyBackups();
        this.rotateMigrationSnapshots();
        this.rotateUploadsArchives();
        const failure = uploadsArchiveFailure(archive);
        if (failure) throw new Error(failure);
      },
    );
  }

  /**
   * Admin "Create backup": resolves once the dump is written and archives the
   * uploads in the BACKGROUND (nginx gives /api/ 60 s). The list shows the
   * archive as `archiving` until it settles; a failure is logged and sent to
   * Sentry, never thrown — the dump is already safe. Archives run one at a
   * time: a Create while one is queued or running is a 409, before any dump.
   */
  async createDailyBackup(): Promise<string> {
    this.uploadsArchives.assertIdle();
    const filename = await this.dumpDaily();
    void this.archiveUploadsOf(filename).then(reportBackgroundArchive);
    return path.join(this.dailyDir, filename);
  }

  /** Cron: dump FIRST, then archive (spec D3) — queued behind a running one and awaited, so rotation follows it. */
  private async createDailyBackupWithArchive(): Promise<{
    dumpPath: string;
    archive: UploadsArchiveResult;
  }> {
    const filename = await this.dumpDaily();
    const archive = await this.archiveUploadsOf(filename);
    return { dumpPath: path.join(this.dailyDir, filename), archive };
  }

  /** Write `daily/raid_ledger_<ts>.dump`; returns its filename. */
  private async dumpDaily(): Promise<string> {
    const filename = `raid_ledger_${formatBackupTimestamp(new Date())}.dump`;
    const dumpPath = path.join(this.dailyDir, filename);
    this.logger.log(`Starting daily backup: ${filename}`);
    await this.runPgDump(dumpPath);
    const stats = fs.statSync(dumpPath);
    this.logger.log(
      `Daily backup complete: ${filename} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`,
    );
    return filename;
  }

  /** The dump's companion archive, tracked; joins one already running. Never rejects. */
  private archiveUploadsOf(filename: string): Promise<UploadsArchiveResult> {
    return this.uploadsArchives.run(filename, () =>
      archiveUploadsForDump(
        this.dailyDir,
        filename,
        this.logger,
        UPLOADS_ARCHIVE_KEEP,
      ),
    );
  }

  /** Create a pre-migration snapshot. */
  async createMigrationSnapshot(migrationLabel: string): Promise<string> {
    const timestamp = formatBackupTimestamp(new Date());
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
    const removed = rotateDailyDir(this.dailyDir, DAILY_RETENTION_DAYS, (m) =>
      this.logger.warn(m),
    );
    if (removed > 0) this.logger.log(`Rotated ${removed} backup(s)`);
    return removed;
  }

  /** Keep the newest MIGRATION_SNAPSHOT_KEEP pre_migration_ dumps (warns, never throws). */
  rotateMigrationSnapshots(): number {
    const removed = rotateMigrationDir(
      this.migrationDir,
      MIGRATION_SNAPSHOT_KEEP,
      (m) => this.logger.warn(m),
    );
    if (removed > 0)
      this.logger.log(`Pruned ${removed} pre-migration snapshot(s)`);
    return removed;
  }

  /** Keep the newest UPLOADS_ARCHIVE_KEEP uploads archives (warns, never throws). */
  rotateUploadsArchives(): number {
    const removed = rotateUploadsArchives(
      this.dailyDir,
      UPLOADS_ARCHIVE_KEEP,
      (m) => this.logger.warn(m),
    );
    if (removed > 0) this.logger.log(`Pruned ${removed} uploads archive(s)`);
    return removed;
  }

  /** List all backup files from both directories. */
  listBackups(): BackupFileDto[] {
    return listBackupFiles(
      [
        [this.dailyDir, 'daily'],
        [this.migrationDir, 'migration'],
      ],
      (dump) => this.uploadsArchives.stateOf(dump),
    );
  }

  /**
   * Resolve a sanitized absolute path for the given backup file, or throw
   * NotFoundException. Used by the download, delete, and restore endpoints.
   * Path traversal attempts collapse to 404 — never 400 — to avoid leaking
   * whether a path shape was malformed vs. a file is missing (ROK-1279).
   */
  getBackupFilePath(type: 'daily' | 'migration', filename: string): string {
    const dir = type === 'daily' ? this.dailyDir : this.migrationDir;
    return resolveBackupFile(dir, type, filename);
  }

  /** Delete a specific backup file (a daily dump takes its uploads archive with it). */
  deleteBackup(type: 'daily' | 'migration', filename: string): void {
    if (type === 'daily') this.uploadsArchives.assertNotArchiving(filename);
    fs.unlinkSync(this.getBackupFilePath(type, filename));
    this.logger.log(`Deleted backup: ${type}/${filename}`);
    if (type !== 'daily' || !filename.endsWith('.dump')) return;
    deleteUploadsArchiveOf(this.dailyDir, filename, this.logger);
    this.uploadsArchives.forget(filename);
  }

  /** Restore the database from a backup file. */
  async restoreFromBackup(
    type: 'daily' | 'migration',
    filename: string,
  ): Promise<void> {
    // Only pg_dump files restore; a sibling .uploads.tar must 404 (ROK-2023).
    if (!filename.endsWith('.dump'))
      throw new NotFoundException(`Backup file not found: ${type}/${filename}`);
    const filepath = this.getBackupFilePath(type, filename);
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
    await runMigrations(apiRoot, this.databaseUrl);
    this.logger.warn('Bootstrapping admin account...');
    const password = await bootstrapAdmin(apiRoot);
    this.logger.warn('Seeding game data...');
    await seedGameData(apiRoot);
    this.settingsService.invalidateCache();
    this.logger.warn('FACTORY RESET complete — instance has been reset');
    return { password };
  }

  // ─── Private helpers ──────────────────────────────────────────

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
      await runMigrations(apiRoot, this.databaseUrl);
      this.logger.log('Post-restore migrations complete');
    } catch (err) {
      // ROK-1413: log at ERROR — a failed post-restore migration is a real
      // data-integrity hazard (the DB may be missing tables the app expects),
      // not a benign note. We deliberately SWALLOW (do not rethrow) so the
      // restore still completes and `reloadAndReconnectIntegrations` runs —
      // rethrowing would leave settings/integrations disconnected on a DB that
      // is otherwise restored. Sentry capture already happens exactly ONCE
      // inside `runMigrations` → `runBootMigrations` (tagged `restore-migration`,
      // flushed before it rethrows to us), so we add NO second capture here.
      this.logger.error(
        `Post-restore migration note: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Run pg_dump (direct or via Docker), excluding ROW DATA for sanitized tables. */
  private async runPgDump(outputPath: string): Promise<void> {
    try {
      if (!this.dbContainer) {
        await runPgDumpDirect(
          outputPath,
          this.databaseUrl,
          SANITIZED_EXCLUDED_TABLES,
        );
      } else {
        await runPgDumpDocker(
          outputPath,
          this.databaseUrl,
          this.dbContainer,
          SANITIZED_EXCLUDED_TABLES,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`pg_dump failed: ${msg}`);
      cleanupPartialFile(outputPath);
      throw new Error(`pg_dump failed: ${msg}`, { cause: err });
    }
  }
}
