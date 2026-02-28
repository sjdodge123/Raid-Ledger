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
import { SettingsService } from '../settings/settings.service';
import type { BackupFileDto } from '@raid-ledger/contract';

const execFileAsync = promisify(execFile);

/** Default backup path — relative to cwd, works in both dev and Docker.
 *  Docker overrides via BACKUP_DIR env var to use the /data volume. */
const DEFAULT_BACKUP_BASE = path.join(process.cwd(), 'backups');

/** Number of days to retain daily backups */
const DAILY_RETENTION_DAYS = 30;

/** Default container name for the Docker DB (used to route pg_dump/pg_restore
 *  through the container so the tool version matches the server).
 *  Override via DB_CONTAINER_NAME env var, or set to empty to use direct execution. */
const DEFAULT_DB_CONTAINER = 'raid-ledger-db';

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private readonly databaseUrl: string;
  private readonly backupBase: string;
  private readonly dailyDir: string;
  private readonly migrationDir: string;
  /** When set, pg_dump/pg_restore route through this Docker container.
   *  Empty string = use direct execution (production or integration tests). */
  private readonly dbContainer: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly cronJobService: CronJobService,
    private readonly settingsService: SettingsService,
  ) {
    const url = this.configService.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error('DATABASE_URL is required for BackupService');
    }
    this.databaseUrl = url;
    const isProduction = process.env.NODE_ENV === 'production';
    // In production, pg tools are co-located with the DB — use direct execution.
    // In dev, route through the Docker container to avoid version mismatch.
    // DB_CONTAINER_NAME env var allows override (empty = direct execution).
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
  listBackups(): BackupFileDto[] {
    const backups: BackupFileDto[] = [];

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
      if (!this.dbContainer) {
        await execFileAsync('pg_restore', [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-privileges',
          `--dbname=${this.databaseUrl}`,
          filepath,
        ]);
      } else {
        // Route through Docker container so pg_restore version matches the server.
        const containerTmp = '/tmp/restore.dump';
        await execFileAsync('docker', [
          'cp',
          filepath,
          `${this.dbContainer}:${containerTmp}`,
        ]);
        await execFileAsync('docker', [
          'exec',
          this.dbContainer,
          'pg_restore',
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-privileges',
          `--dbname=${this.databaseUrl}`,
          containerTmp,
        ]);
        await execFileAsync('docker', [
          'exec',
          this.dbContainer,
          'rm',
          '-f',
          containerTmp,
        ]);
      }
      this.logger.log(`Database restore complete from: ${filename}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // pg_restore exits with code 1 for warnings (e.g. objects that don't exist,
      // unrecognized config parameters from version mismatches). These are harmless
      // when the restore summary says "errors ignored on restore".
      const isFatal =
        message.includes('pg_restore: error:') &&
        !message.includes('errors ignored on restore');
      if (isFatal) {
        this.logger.error(`pg_restore failed: ${message}`);
        throw new InternalServerErrorException(
          `Database restore failed: ${message}`,
        );
      }
      this.logger.warn(`pg_restore completed with warnings: ${message}`);
    }

    // Run migrations to bring schema up to date if backup is from an older version
    this.logger.warn('Running post-restore migrations...');
    const apiRoot = path.resolve(__dirname, '../../..');
    const isDocker = process.env.NODE_ENV === 'production';
    try {
      if (isDocker) {
        await execFileAsync('node', [
          path.resolve('drizzle/run-migrations.js'),
        ]);
      } else {
        await execFileAsync('npx', ['drizzle-kit', 'migrate'], {
          cwd: apiRoot,
        });
      }
      this.logger.log('Post-restore migrations complete');
    } catch (migErr) {
      const msg = migErr instanceof Error ? migErr.message : String(migErr);
      this.logger.warn(`Post-restore migration note: ${msg}`);
    }

    // Reload settings and reconnect integrations from restored config
    await this.settingsService.reloadAndReconnectIntegrations();
    this.logger.log(`Database restore complete from: ${filename}`);
  }

  /**
   * Factory-reset the instance: drop all data, re-run migrations, reseed.
   * Creates a pre-reset safety backup first.
   * Returns new admin credentials.
   */
  async resetInstance(): Promise<{ password: string }> {
    this.logger.warn('FACTORY RESET initiated — creating safety backup...');
    await this.createMigrationSnapshot('factory-reset');

    // Disconnect live integrations before wiping the DB
    this.settingsService.emitAllIntegrationsCleared();

    this.logger.warn('Dropping all database schemas...');
    const dropSql =
      'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;';
    if (!this.dbContainer) {
      await execFileAsync('psql', [this.databaseUrl, '-c', dropSql]);
    } else {
      await execFileAsync('docker', [
        'exec',
        this.dbContainer,
        'psql',
        this.databaseUrl,
        '-c',
        dropSql,
      ]);
    }

    // __dirname at runtime = api/dist/src/backup/
    // Go up 3 levels to reach the api/ root
    const apiRoot = path.resolve(__dirname, '../../..');

    this.logger.warn('Running database migrations...');
    const isDocker = process.env.NODE_ENV === 'production';
    if (isDocker) {
      await execFileAsync('node', [path.resolve('drizzle/run-migrations.js')]);
    } else {
      await execFileAsync('npx', ['drizzle-kit', 'migrate'], {
        cwd: apiRoot,
      });
    }

    this.logger.warn('Bootstrapping admin account...');
    const runner = isDocker ? 'node' : 'npx';
    const runnerArgs = isDocker
      ? [path.resolve('dist/scripts/bootstrap-admin.js'), '--reset']
      : [
          'ts-node',
          path.resolve(apiRoot, 'scripts/bootstrap-admin.ts'),
          '--reset',
        ];

    const { stdout: adminOutput } = await execFileAsync(runner, runnerArgs, {
      cwd: apiRoot,
      env: { ...process.env, RESET_PASSWORD: 'true' },
    });

    // Extract password from bootstrap output
    const passwordMatch = adminOutput.match(/Password:\s+(.+)/);
    const password = passwordMatch ? passwordMatch[1].trim() : '';
    if (!password) {
      this.logger.error(
        'Could not extract admin password from bootstrap output',
      );
      throw new InternalServerErrorException(
        'Reset completed but failed to extract new admin credentials',
      );
    }

    this.logger.warn('Seeding game data...');
    const seedRunner = isDocker ? 'node' : 'npx';
    const seedGamesArgs = isDocker
      ? [path.resolve('dist/scripts/seed-games.js')]
      : ['ts-node', path.resolve(apiRoot, 'scripts/seed-games.ts')];
    const seedIgdbArgs = isDocker
      ? [path.resolve('dist/scripts/seed-igdb-games.js')]
      : ['ts-node', path.resolve(apiRoot, 'scripts/seed-igdb-games.ts')];

    await execFileAsync(seedRunner, seedGamesArgs, { cwd: apiRoot });
    await execFileAsync(seedRunner, seedIgdbArgs, { cwd: apiRoot });

    // Invalidate settings cache so API immediately reflects the wiped state
    this.settingsService.invalidateCache();

    this.logger.warn('FACTORY RESET complete — instance has been reset');
    return { password };
  }

  /**
   * Run pg_dump in custom format (compressed, supports selective restore).
   * In dev mode, routes through Docker to avoid pg_dump version mismatch
   * (host pg_dump may be newer than the Postgres server in the container).
   */
  private async runPgDump(outputPath: string): Promise<void> {
    try {
      if (!this.dbContainer) {
        await execFileAsync('pg_dump', [
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          `--file=${outputPath}`,
          this.databaseUrl,
        ]);
      } else {
        // Route through Docker container so pg_dump version matches the server.
        // Dump to a temp file inside the container, then docker cp it out.
        const containerTmp = '/tmp/backup.dump';
        await execFileAsync('docker', [
          'exec',
          this.dbContainer,
          'pg_dump',
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          `--file=${containerTmp}`,
          this.databaseUrl,
        ]);
        await execFileAsync('docker', [
          'cp',
          `${this.dbContainer}:${containerTmp}`,
          outputPath,
        ]);
        // Clean up temp file in container
        await execFileAsync('docker', [
          'exec',
          this.dbContainer,
          'rm',
          '-f',
          containerTmp,
        ]);
      }
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
