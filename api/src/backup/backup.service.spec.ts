import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { BackupService } from './backup.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { runBootMigrations } from '../../scripts/run-migrations-with-sentry';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as childProcess from 'node:child_process';

jest.mock('node:fs');
jest.mock('node:child_process');

// ROK-1322: backup.helpers::runMigrations now routes through the instrumented
// boot runner `runBootMigrations` (refresh dedup-audit → migrate → validate →
// Sentry capture tagged `restore-migration`). The unit suite doesn't carry a
// live Postgres, so stub the runner to a no-op. The dedup-refresh + loud-failure
// behavior is covered by `backup.helpers.restore-via-runboot.integration.spec.ts`
// and `backup.helpers.loud-failure.integration.spec.ts`.
jest.mock('../../scripts/run-migrations-with-sentry', () => ({
  runBootMigrations: jest.fn(() => Promise.resolve()),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;
const mockRunBootMigrations = runBootMigrations as jest.Mock;

// ROK-1663 fixtures. The unit suite runs with the cwd-relative default
// BACKUP_DIR, so snapshots live at <cwd>/backups/migrations.
const MIGRATION_DIR = path.join(process.cwd(), 'backups', 'migrations');
const migrationPath = (name: string) => path.join(MIGRATION_DIR, name);
const BASE_MS = Date.UTC(2026, 8, 1);
const minutes = (m: number) => new Date(BASE_MS + m * 60_000);

/** `pre_migration_2026-09-DD_020000.dump` for DD = 01..n (name order = age). */
function snapshotNames(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) =>
      `pre_migration_2026-09-${String(i + 1).padStart(2, '0')}_020000.dump`,
  );
}

/** Serve `files` from backups/migrations (daily/ stays empty); `symlinks` lstat as non-regular. */
function mockMigrationDir(
  files: string[],
  mtimeOf: (name: string) => Date,
  symlinks: string[] = [],
): void {
  (mockFs.readdirSync as jest.Mock).mockImplementation((dir: string) =>
    dir === MIGRATION_DIR ? [...files] : [],
  );
  (mockFs.lstatSync as jest.Mock).mockImplementation((p: string) => ({
    isFile: () => !symlinks.includes(path.basename(p)),
    mtime: mtimeOf(path.basename(p)),
  }));
}

/**
 * 12 snapshots whose mtime order deliberately differs from name order (so the
 * sort key is provably mtime), plus an older pre_restore_ dump and an older
 * prefixed .txt. Returns the two paths that must be pruned (09-07, 09-03).
 */
function twelveSnapshotFixture(): string[] {
  const names = snapshotNames(12);
  const ranks = [5, 9, 1, 11, 3, 7, 0, 8, 2, 10, 4, 6]; // 0 = oldest mtime
  const extras = [
    'pre_restore_2026-08-01_000000.dump',
    'pre_migration_notes.txt',
  ];
  mockMigrationDir([...extras, ...[...names].reverse()], (n) => {
    const i = names.indexOf(n);
    return i < 0 ? minutes(-1440) : minutes(ranks[i]);
  });
  return [names[6], names[2]].map(migrationPath).sort();
}

const unlinkedPaths = (): string[] =>
  mockFs.unlinkSync.mock.calls.map((c) => String(c[0])).sort();

function describeBackupService() {
  let service: BackupService;
  let mockCronJobService: { executeWithTracking: jest.Mock };
  let mockSettingsService: {
    invalidateCache: jest.Mock;
    emitAllIntegrationsCleared: jest.Mock;
    reloadAndReconnectIntegrations: jest.Mock;
  };

  async function beforeEachHelper() {
    mockCronJobService = {
      executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
        fn(),
      ),
    };
    mockSettingsService = {
      invalidateCache: jest.fn(),
      emitAllIntegrationsCleared: jest.fn(),
      reloadAndReconnectIntegrations: jest.fn().mockResolvedValue(undefined),
    };
    mockRunBootMigrations.mockReset();
    mockRunBootMigrations.mockResolvedValue(undefined);

    // Reset mocks
    mockFs.mkdirSync.mockReturnValue(undefined);
    (mockFs.readdirSync as jest.Mock).mockReturnValue([]);
    (mockFs.statSync as jest.Mock).mockReturnValue({
      size: 1024,
      mtime: new Date(),
    });
    mockFs.unlinkSync.mockReturnValue(undefined);

    // Mock execFile to call callback with success
    (mockChildProcess.execFile as unknown as jest.Mock).mockImplementation(
      (...args: unknown[]) => {
        // Find the callback (last function argument)
        const callback = args.find((a) => typeof a === 'function') as (
          err: Error | null,
          result?: { stdout: string; stderr: string },
        ) => void;
        if (callback) {
          callback(null, { stdout: '', stderr: '' });
        }
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'DATABASE_URL')
                return 'postgresql://user:pass@localhost:5432/raid_ledger';
              if (key === 'DB_CONTAINER_NAME') return '';
              return undefined;
            }),
          },
        },
        { provide: CronJobService, useValue: mockCronJobService },
        {
          provide: SettingsService,
          useValue: mockSettingsService,
        },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  }
  beforeEach(() => beforeEachHelper());

  describe('onModuleInit', () => {
    it('should create backup directories', () => {
      service.onModuleInit();
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('backups/daily'),
        { recursive: true },
      );
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('backups/migrations'),
        { recursive: true },
      );
    });
  });

  describe('handleDailyBackup', () => {
    it('should use cron job tracking', async () => {
      await service.handleDailyBackup();
      expect(mockCronJobService.executeWithTracking).toHaveBeenCalledWith(
        'BackupService_dailyBackup',
        expect.any(Function),
      );
    });
  });

  function describeRotateDailyBackups() {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should remove files older than 30 days', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);

      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        'raid_ledger_old.dump',
      ]);
      (mockFs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        mtime: oldDate,
      });

      const removed = service.rotateDailyBackups();
      expect(removed).toBe(1);
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should keep files newer than 30 days', () => {
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        'raid_ledger_recent.dump',
      ]);
      (mockFs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        mtime: new Date(),
      });

      const removed = service.rotateDailyBackups();
      expect(removed).toBe(0);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });
  }
  describe('rotateDailyBackups', () => describeRotateDailyBackups());

  // ROK-1663: every boot writes a pre_migration_ dump; keep only the newest 10.
  function describeRotateMigrationSnapshots() {
    let warnSpy: jest.SpyInstance;
    beforeEach(() => {
      jest.clearAllMocks();
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy.mockRestore();
      mockFs.unlinkSync.mockReset(); // drop any unconsumed once-impl
    });

    it('the daily cron unlinks exactly the 2 oldest pre_migration_ dumps (AC2, AC6a)', async () => {
      const expected = twelveSnapshotFixture();
      await service.handleDailyBackup();
      expect(unlinkedPaths()).toEqual(expected);
    });

    it('unlinks nothing with 10 or fewer snapshots (AC6b)', () => {
      const names = snapshotNames(10);
      mockMigrationDir(names, (n) => minutes(names.indexOf(n)));
      expect(service.rotateMigrationSnapshots()).toBe(0);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('onModuleInit prunes, after the directories are ensured (AC3, AC6c)', () => {
      const expected = twelveSnapshotFixture();
      service.onModuleInit();
      expect(unlinkedPaths()).toEqual(expected);
      const lastMkdir = Math.max(
        ...(mockFs.mkdirSync as jest.Mock).mock.invocationCallOrder,
      );
      const firstRead = (mockFs.readdirSync as jest.Mock).mock
        .invocationCallOrder[0];
      expect(firstRead).toBeGreaterThan(lastMkdir);
    });

    it('never counts or deletes pre_factory-reset_, pre_restore_, symlinks or non-.dump files (AC4)', () => {
      const names = snapshotNames(10);
      const symlink = 'pre_migration_2026-01-02_000000.dump';
      const others = [
        'pre_factory-reset_2026-01-01_000000.dump',
        'pre_restore_2026-01-01_000000.dump',
        'pre_migration_2026-01-01_000000.dump.txt',
        symlink,
      ];
      // Every non-candidate is older than all 10 real snapshots: counting any
      // of them would make 11 and prune it.
      mockMigrationDir(
        [...others, ...names],
        (n) => (names.includes(n) ? minutes(names.indexOf(n)) : minutes(-1440)),
        [symlink],
      );
      expect(service.rotateMigrationSnapshots()).toBe(0);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('never reads or deletes anything under daily/ (AC4)', () => {
      const names = snapshotNames(12);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(names); // every dir looks full
      (mockFs.lstatSync as jest.Mock).mockImplementation((p: string) => ({
        isFile: () => true,
        mtime: minutes(names.indexOf(path.basename(p))),
      }));
      service.rotateMigrationSnapshots();
      const dirsRead = (mockFs.readdirSync as jest.Mock).mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(dirsRead).toEqual([MIGRATION_DIR]);
      expect(unlinkedPaths()).toEqual(
        [names[0], names[1]].map(migrationPath).sort(),
      );
    });

    it('breaks equal-mtime ties by filename timestamp, whatever the readdir order', () => {
      const names = snapshotNames(11);
      for (const order of [names, [...names].reverse()]) {
        jest.clearAllMocks();
        mockMigrationDir(order, () => minutes(0));
        service.rotateMigrationSnapshots();
        expect(unlinkedPaths()).toEqual([migrationPath(names[0])]);
      }
    });

    it('warns without throwing on an unreadable directory; boot and cron still succeed (AC5)', async () => {
      (mockFs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
        if (dir === MIGRATION_DIR) throw new Error('EACCES: permission denied');
        return [];
      });
      expect(() => service.onModuleInit()).not.toThrow();
      await expect(service.handleDailyBackup()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EACCES: permission denied'),
      );
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('skips a snapshot whose lstat fails and still prunes the rest (AC5)', () => {
      const names = snapshotNames(12);
      mockMigrationDir(names, (n) => minutes(names.indexOf(n)));
      const lstat = (mockFs.lstatSync as jest.Mock).getMockImplementation()!;
      (mockFs.lstatSync as jest.Mock).mockImplementation((p: string) => {
        if (p === migrationPath(names[0])) throw new Error('ENOENT: vanished');
        return lstat(p);
      });
      // The unstat-able file is neither counted nor deleted: 11 left, 1 pruned.
      expect(service.rotateMigrationSnapshots()).toBe(1);
      expect(unlinkedPaths()).toEqual([migrationPath(names[1])]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ENOENT: vanished'),
      );
    });

    it('warns on a failed unlink, still tries the rest, and the cron succeeds (AC5)', async () => {
      const expected = twelveSnapshotFixture();
      mockFs.unlinkSync.mockImplementationOnce(() => {
        throw new Error('EBUSY: locked');
      });
      await expect(service.handleDailyBackup()).resolves.toBeUndefined();
      expect(unlinkedPaths()).toEqual(expected);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('EBUSY: locked'),
      );
    });
  }
  describe('rotateMigrationSnapshots', () =>
    describeRotateMigrationSnapshots());

  describe('listBackups', () => {
    it('should list .dump files from both directories sorted newest first', () => {
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-02-01T00:00:00Z');

      (mockFs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
        if (dir.includes('daily')) return ['old.dump', 'skip.txt'];
        if (dir.includes('migrations')) return ['new.dump'];
        return [];
      });
      (mockFs.statSync as jest.Mock).mockImplementation((filepath: string) => {
        if (filepath.includes('old.dump'))
          return { size: 100, birthtime: older };
        return { size: 200, birthtime: newer };
      });

      const result = service.listBackups();
      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe('new.dump');
      expect(result[0].type).toBe('migration');
      expect(result[1].filename).toBe('old.dump');
      expect(result[1].type).toBe('daily');
    });
  });

  describe('deleteBackup', () => {
    it('should reject path traversal attempts', () => {
      expect(() => service.deleteBackup('daily', '../etc/passwd')).toThrow(
        'Backup file not found',
      );
      expect(() => service.deleteBackup('daily', 'foo/bar')).toThrow(
        'Backup file not found',
      );
    });

    it('should throw NotFoundException for missing file', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      expect(() => service.deleteBackup('daily', 'missing.dump')).toThrow(
        'Backup file not found',
      );
    });

    it('should delete an existing file', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      service.deleteBackup('daily', 'test.dump');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('test.dump'),
      );
    });

    it('should accept listed filenames with spaces or plus signs', () => {
      // listBackups only filters on '.dump' — any listed file must remain
      // deletable/restorable (a strict charset regressed this once).
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      service.deleteBackup('daily', 'pre migration+copy.dump');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('pre migration+copy.dump'),
      );
    });
  });

  function describeResetInstance() {
    async function testCreateASafetyBackupDropSchemasRunMigrationsAndRe() {
      (mockFs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        birthtime: new Date(),
      });

      // Make bootstrap-admin output contain a password
      (mockChildProcess.execFile as unknown as jest.Mock).mockImplementation(
        (...args: unknown[]) => {
          const cmd = args[0] as string;
          const cmdArgs = args[1] as string[];
          const callback = args.find((a) => typeof a === 'function') as (
            err: Error | null,
            result?: { stdout: string; stderr: string },
          ) => void;
          if (callback) {
            const isBootstrap =
              cmd === 'npx' &&
              cmdArgs.some((a: string) => a.includes('bootstrap-admin'));
            callback(null, {
              stdout: isBootstrap ? '  Password: testPassword123\n' : '',
              stderr: '',
            });
          }
        },
      );

      const result = await service.resetInstance();
      expect(result.password).toBe('testPassword123');

      const execFileCalls = (mockChildProcess.execFile as unknown as jest.Mock)
        .mock.calls;

      // Should have called psql to drop schemas
      const psqlCall = execFileCalls.find(
        (call: unknown[]) => call[0] === 'psql',
      ) as unknown[] | undefined;
      expect(psqlCall).toBeDefined();
      expect(psqlCall![1]).toEqual(
        expect.arrayContaining([
          expect.stringContaining('DROP SCHEMA public CASCADE'),
        ]),
      );
    }
    it('should create a safety backup, drop schemas, run migrations, and return password', () =>
      testCreateASafetyBackupDropSchemasRunMigrationsAndRe());
  }
  describe('resetInstance', () => describeResetInstance());

  describe('restoreFromBackup', () => {
    it('should reject path traversal attempts', async () => {
      await expect(
        service.restoreFromBackup('daily', '../bad'),
      ).rejects.toThrow('Backup file not found');
    });

    it('should throw NotFoundException for missing file', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      await expect(
        service.restoreFromBackup('daily', 'missing.dump'),
      ).rejects.toThrow('Backup file not found');
    });

    it('should create a pre-restore snapshot then run pg_restore', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.statSync as jest.Mock).mockReturnValue({
        size: 1024,
        birthtime: new Date(),
      });

      await service.restoreFromBackup('daily', 'test.dump');

      // pg_dump called twice: once for pre-restore snapshot, once already in daily backup setup
      const execFileCalls = (mockChildProcess.execFile as unknown as jest.Mock)
        .mock.calls;
      const pgRestoreCall = execFileCalls.find(
        (call: unknown[]) => call[0] === 'pg_restore',
      ) as unknown[] | undefined;
      expect(pgRestoreCall).toBeDefined();
      expect(pgRestoreCall![1]).toEqual(
        expect.arrayContaining(['--clean', '--if-exists']),
      );
    });

    it('logs a post-restore migration failure at error and still completes restore', async () => {
      // ROK-1413: a swallowed migration failure must surface at logger.error
      // (was warn); the catch is kept (no rethrow) so restore completes + the
      // settings reload still runs, and Sentry captures ONCE in runBootMigrations.
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      // statSync default (size/mtime) comes from beforeEach; only existsSync
      // needs overriding so the backup file resolves.
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      mockRunBootMigrations.mockRejectedValueOnce(
        new Error('relation "games" does not exist'),
      );

      await expect(
        service.restoreFromBackup('daily', 'test.dump'),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Post-restore migration note'),
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Post-restore migration note'),
      );
      expect(
        mockSettingsService.reloadAndReconnectIntegrations,
      ).toHaveBeenCalled();

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
}
describe('BackupService', () => describeBackupService());
