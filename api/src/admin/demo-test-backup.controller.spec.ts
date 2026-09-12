import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DemoTestBackupController } from './demo-test-backup.controller';
import { BackupService } from '../backup/backup.service';

jest.mock('node:fs');

const mockFs = fs as jest.Mocked<typeof fs>;
const DAILY = path.join('/var/backups', 'daily');

/** A real pg_dump custom-format archive starts with the magic bytes `PGDMP`. */
function realDump(size: number): Buffer {
  const buf = Buffer.alloc(size, 7);
  buf.write('PGDMP', 0, 'utf8');
  return buf;
}

function writtenCall(): [string, Buffer] {
  const call = mockFs.writeFileSync.mock.calls[0];
  return [String(call[0]), call[1] as Buffer];
}

describe('DemoTestBackupController (T-C1)', () => {
  let controller: DemoTestBackupController;
  let backupService: { getBackupFilePath: jest.Mock };
  const originalDemoMode = process.env.DEMO_MODE;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.DEMO_MODE = 'true';
    backupService = {
      getBackupFilePath: jest
        .fn()
        .mockImplementation((_t: string, f: string) => path.join(DAILY, f)),
    };

    const module = await Test.createTestingModule({
      controllers: [DemoTestBackupController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('/var/backups') },
        },
        { provide: BackupService, useValue: backupService },
      ],
    }).compile();

    controller = module.get(DemoTestBackupController);
  });

  afterAll(() => {
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  });

  it('writes a non-pg-archive file into the daily dir for mode=garbage', () => {
    const result = controller.simulateCorruption({ mode: 'garbage' });

    const [target, contents] = writtenCall();
    expect(path.dirname(target)).toBe(DAILY);
    expect(path.basename(target)).toBe(result.filename);
    // `corrupt_` prefix so an operator reading GET /admin/backups can never
    // mistake it for a real backup.
    expect(result.filename.startsWith('corrupt_')).toBe(true);
    expect(result.filename.endsWith('.dump')).toBe(true);
    expect(contents.subarray(0, 5).toString('utf8')).not.toBe('PGDMP');
    expect(contents.length).toBeGreaterThan(0);
    // Post-write self-check: the drill's D3 fetch must find it here.
    expect(backupService.getBackupFilePath).toHaveBeenCalledWith(
      'daily',
      result.filename,
    );
  });

  it('truncates a copy of the newest real daily dump to 1 KB for mode=truncate', () => {
    mockFs.readdirSync.mockReturnValue([
      'old.dump',
      'newest.dump',
      'notes.txt',
      'corrupt_garbage_earlier.dump',
    ] as never);
    mockFs.statSync.mockImplementation(
      (p) =>
        ({
          mtimeMs: String(p).includes('newest.dump') ? 2_000 : 1_000,
        }) as fs.Stats,
    );
    mockFs.readFileSync.mockReturnValue(realDump(50_000) as never);

    const result = controller.simulateCorruption({ mode: 'truncate' });

    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      path.join(DAILY, 'newest.dump'),
    );
    const [target, contents] = writtenCall();
    expect(path.basename(target)).toBe(result.filename);
    expect(result.filename.startsWith('corrupt_')).toBe(true);
    expect(contents.length).toBe(1024);
    // Truncation keeps the header -- that is exactly why pg_restore fails late.
    expect(contents.subarray(0, 5).toString('utf8')).toBe('PGDMP');
  });

  it('rejects mode=truncate with 400 naming the missing source dump', () => {
    mockFs.readdirSync.mockReturnValue([
      'notes.txt',
      'corrupt_garbage_earlier.dump',
    ] as never);

    expect(() => controller.simulateCorruption({ mode: 'truncate' })).toThrow(
      BadRequestException,
    );
    // A silent fall back to `garbage` would make AC3 untestable.
    expect(() => controller.simulateCorruption({ mode: 'truncate' })).toThrow(
      /no source .*dump/i,
    );
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('refuses outside DEMO_MODE and writes nothing', () => {
    process.env.DEMO_MODE = 'false';

    expect(() => controller.simulateCorruption({ mode: 'garbage' })).toThrow(
      ForbiddenException,
    );
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
    expect(backupService.getBackupFilePath).not.toHaveBeenCalled();
  });

  it('rejects an unknown mode with 400 via parseDemoBody', () => {
    expect(() => controller.simulateCorruption({ mode: 'shred' })).toThrow(
      BadRequestException,
    );
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});
