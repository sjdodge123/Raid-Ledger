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
            get: jest
              .fn()
              .mockReturnValue(
                'postgresql://user:pass@localhost:5432/raid_ledger',
              ),
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
});
