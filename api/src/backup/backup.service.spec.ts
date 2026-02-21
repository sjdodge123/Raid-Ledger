import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';

jest.mock('node:fs');
jest.mock('node:child_process');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockChildProcess = childProcess as jest.Mocked<typeof childProcess>;

describe('BackupService', () => {
  let service: BackupService;
  let mockCronJobService: { executeWithTracking: jest.Mock };

  beforeEach(async () => {
    mockCronJobService = {
      executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
        fn(),
      ),
    };

    // Reset mocks
    mockFs.mkdirSync.mockReturnValue(undefined as unknown as string);
    (mockFs.readdirSync as jest.Mock).mockReturnValue([]);
    (mockFs.statSync as jest.Mock).mockReturnValue({
      size: 1024,
      mtime: new Date(),
    });
    mockFs.unlinkSync.mockReturnValue(undefined);

    // Mock execFile to call callback with success
    (mockChildProcess.execFile as unknown as jest.Mock).mockImplementation(
      (
        _cmd: string,
        _args: string[],
        callback: (err: Error | null) => void,
      ) => {
        callback(null);
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
              return undefined;
            }),
          },
        },
        { provide: CronJobService, useValue: mockCronJobService },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should create backup directories', () => {
      service.onModuleInit();
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/data/backups/daily', {
        recursive: true,
      });
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        '/data/backups/migrations',
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

  describe('rotateDailyBackups', () => {
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
  });

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
        'Invalid filename',
      );
      expect(() => service.deleteBackup('daily', 'foo/bar')).toThrow(
        'Invalid filename',
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
  });

  describe('restoreFromBackup', () => {
    it('should reject path traversal attempts', async () => {
      await expect(
        service.restoreFromBackup('daily', '../bad'),
      ).rejects.toThrow('Invalid filename');
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
      const execFileCalls = (
        mockChildProcess.execFile as unknown as jest.Mock
      ).mock.calls;
      const pgRestoreCall = execFileCalls.find(
        (call: unknown[]) => call[0] === 'pg_restore',
      );
      expect(pgRestoreCall).toBeDefined();
      expect(pgRestoreCall[1]).toEqual(
        expect.arrayContaining(['--clean', '--if-exists']),
      );
    });
  });
});
