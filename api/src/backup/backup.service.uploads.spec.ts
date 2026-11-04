/**
 * ROK-2023 (spec D1/D3/D9/D10) — BackupService wiring of the companion
 * `/data/uploads` archive. The archive helper, pg_dump and the rotations are
 * mocked: this suite pins ORDER and FAILURE SEMANTICS, not tar itself
 * (backup-uploads.helpers.spec.ts + backup-uploads.integration.spec.ts do).
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as Sentry from '@sentry/nestjs';

import { BackupService } from './backup.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { SettingsService } from '../settings/settings.service';
import { runPgDumpDocker } from './backup.helpers';
import {
  rotateDailyDir,
  rotateMigrationDir,
  rotateUploadsArchives,
} from './backup-rotation.helpers';
import {
  archiveUploads,
  type UploadsArchiveResult,
} from './backup-uploads.helpers';
import {
  UPLOADS_TAR_TIMEOUT_MS,
  type TarRunOptions,
} from './backup-uploads.deadline';

jest.mock('node:fs');
jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('../../scripts/run-migrations-with-sentry', () => ({
  runBootMigrations: jest.fn(() => Promise.resolve()),
}));
jest.mock('./backup.helpers', () => ({
  ...jest.requireActual<object>('./backup.helpers'),
  runPgDumpDocker: jest.fn(),
  runPgDumpDirect: jest.fn(),
}));
jest.mock('./backup-rotation.helpers', () => ({
  rotateDailyDir: jest.fn(() => 0),
  rotateMigrationDir: jest.fn(() => 0),
  rotateUploadsArchives: jest.fn(() => 0),
}));
jest.mock('./backup-uploads.helpers', () => ({
  ...jest.requireActual<object>('./backup-uploads.helpers'),
  archiveUploads: jest.fn(),
  resolveUploadsDir: jest.fn(() => '/srv/uploads'),
}));

const mockFs = jest.mocked(fs);
const mockDump = jest.mocked(runPgDumpDocker);
const mockArchive = jest.mocked(archiveUploads);
const DAILY_DIR = path.join(process.cwd(), 'backups', 'daily');
const DUMP_RE = /^raid_ledger_(\d{4}-\d{2}-\d{2}_\d{6})\.dump$/;

let service: BackupService;
let events: string[];
let errorSpy: jest.SpyInstance;

async function build(): Promise<BackupService> {
  const config = {
    get: jest.fn((key: string) =>
      key === 'DATABASE_URL' ? 'postgresql://u:p@localhost:5432/rl' : undefined,
    ),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      BackupService,
      { provide: ConfigService, useValue: config },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest.fn((_n: string, fn: () => Promise<void>) =>
            fn(),
          ),
        },
      },
      { provide: SettingsService, useValue: {} },
    ],
  }).compile();
  return moduleRef.get(BackupService);
}

/** Let the background archive chain (resolved mocks → .then) run to the end. */
function flushBackground(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function archiveReturns(result: UploadsArchiveResult): void {
  mockArchive.mockImplementation(() => {
    events.push('archive');
    return Promise.resolve(result);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  events = [];
  errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
  (mockFs.statSync as jest.Mock).mockReturnValue({ size: 2048 });
  mockDump.mockImplementation(() => {
    events.push('pg_dump');
    return Promise.resolve();
  });
  jest.mocked(rotateDailyDir).mockImplementation(() => {
    events.push('rotate-daily');
    return 0;
  });
  jest.mocked(rotateUploadsArchives).mockImplementation(() => {
    events.push('rotate-uploads');
    return 0;
  });
  archiveReturns({ status: 'written', path: '/x.uploads.tar' });
  service = await build();
});

describe('createDailyBackup — companion uploads archive (AC1)', () => {
  it('archives AFTER pg_dump, next to the dump, with the same timestamp', async () => {
    const dumpPath = await service.createDailyBackup();

    expect(events).toEqual(['pg_dump', 'archive']);
    const ts = DUMP_RE.exec(path.basename(dumpPath))?.[1];
    if (!ts) throw new Error(`dump name has no timestamp: ${dumpPath}`);
    expect(mockArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadsDir: '/srv/uploads',
        outPath: path.join(DAILY_DIR, `raid_ledger_${ts}.uploads.tar`),
        dailyDir: DAILY_DIR,
      }),
    );
  });

  it('never archives when pg_dump fails', async () => {
    mockDump.mockRejectedValue(new Error('boom'));
    await expect(service.createDailyBackup()).rejects.toThrow('pg_dump failed');
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it('a failed archive keeps the dump and resolves (manual POST) but logs an error (AC4/AC5)', async () => {
    archiveReturns({
      status: 'failed',
      reason: 'tar-failed',
      detail: 'exit 2',
    });
    const dumpPath = await service.createDailyBackup();
    await flushBackground();
    expect(path.dirname(dumpPath)).toBe(DAILY_DIR);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/uploads archive failed.*tar-failed.*exit 2/),
    );
  });
});

describe('handleDailyBackup — cron outcome (D9)', () => {
  it('runs every rotation, keeps 7 archives, and succeeds when the archive was written', async () => {
    await expect(service.handleDailyBackup()).resolves.toBeUndefined();
    expect(events).toEqual([
      'pg_dump',
      'archive',
      'rotate-daily',
      'rotate-uploads',
    ]);
    expect(rotateMigrationDir).toHaveBeenCalled();
    expect(rotateUploadsArchives).toHaveBeenCalledWith(
      DAILY_DIR,
      7,
      expect.any(Function),
    );
  });

  it('succeeds when the uploads root is missing (skipped is not a failure, AC3)', async () => {
    archiveReturns({ status: 'skipped', reason: 'missing-root' });
    await expect(service.handleDailyBackup()).resolves.toBeUndefined();
  });

  it('fails the cron run AFTER all rotations when the archive failed (AC4)', async () => {
    archiveReturns({ status: 'failed', reason: 'insufficient-space' });
    await expect(service.handleDailyBackup()).rejects.toThrow(
      /uploads archive failed.*insufficient-space/,
    );
    expect(events).toEqual([
      'pg_dump',
      'archive',
      'rotate-uploads', // pre-prune to 6 found nothing → no retry
      'rotate-daily',
      'rotate-uploads',
    ]);
    expect(rotateMigrationDir).toHaveBeenCalled();
  });
});

describe('insufficient space with 7 archives present (Codex P2)', () => {
  it('prunes to 6 and retries once, so the run succeeds', async () => {
    mockArchive
      .mockResolvedValueOnce({ status: 'failed', reason: 'insufficient-space' })
      .mockResolvedValueOnce({ status: 'written', path: '/x.uploads.tar' });
    jest.mocked(rotateUploadsArchives).mockReturnValueOnce(1);
    await expect(service.handleDailyBackup()).resolves.toBeUndefined();
    expect(mockArchive).toHaveBeenCalledTimes(2);
    expect(jest.mocked(rotateUploadsArchives).mock.calls[0]?.[1]).toBe(6);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not retry on a non-space failure', async () => {
    archiveReturns({ status: 'failed', reason: 'tar-failed', detail: 'x' });
    await expect(service.handleDailyBackup()).rejects.toThrow(/tar-failed/);
    expect(mockArchive).toHaveBeenCalledTimes(1);
  });
});

describe('deleteBackup — companion archive (D10c, AC7)', () => {
  const dump = 'raid_ledger_2026-10-27_020010.dump';
  const companion = path.join(
    DAILY_DIR,
    'raid_ledger_2026-10-27_020010.uploads.tar',
  );

  it('deletes the dump and its companion archive', () => {
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    service.deleteBackup('daily', dump);
    expect(
      mockFs.unlinkSync.mock.calls.map((c) => String(c[0])).sort(),
    ).toEqual([path.join(DAILY_DIR, dump), companion].sort());
  });

  it('deletes a dump that has no companion without error', () => {
    (mockFs.existsSync as jest.Mock).mockImplementation(
      (p: string) => p !== companion,
    );
    expect(() => service.deleteBackup('daily', dump)).not.toThrow();
    expect(mockFs.unlinkSync.mock.calls.map((c) => String(c[0]))).toEqual([
      path.join(DAILY_DIR, dump),
    ]);
  });

  it('never looks for a companion of a migration snapshot', () => {
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    service.deleteBackup('migration', 'pre_migration_2026-10-27_020010.dump');
    expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
  });
});

let settleArchive: (r: UploadsArchiveResult) => void;
let failArchive: (err: Error) => void;

/** The archive stays pending until the test settles it. */
function archivePending(): void {
  mockArchive.mockImplementation(
    () =>
      new Promise<UploadsArchiveResult>((resolve, reject) => {
        settleArchive = resolve;
        failArchive = reject;
      }),
  );
}

/** `dump` is the only daily dump; its companion tar measures 4096 bytes. */
function listing(dump: string): void {
  (mockFs.readdirSync as jest.Mock).mockImplementation((dir: string) =>
    dir === DAILY_DIR ? [dump] : [],
  );
  (mockFs.statSync as jest.Mock).mockImplementation((p: string) =>
    p.endsWith('.uploads.tar')
      ? { size: 4096 }
      : { size: 2048, birthtime: new Date('2026-11-04T10:00:00Z') },
  );
}

function archiveStateOf(dump: string): unknown {
  const entry = service.listBackups().find((b) => b.filename === dump);
  if (!entry) throw new Error(`${dump} is not listed`);
  return entry.uploadsArchive;
}

describe('createDailyBackup — uploads archive in the background (504 fix)', () => {
  it('resolves once the dump is written, before the archive settles', async () => {
    archivePending();
    const outcome = await Promise.race([
      service.createDailyBackup().then(() => 'resolved after dump'),
      flushBackground().then(() => 'still waiting on the archive'),
    ]);
    expect(outcome).toBe('resolved after dump');
    expect(events).toEqual(['pg_dump']);
    expect(mockArchive).toHaveBeenCalledTimes(1);
  });

  it('lists the archive as archiving while it runs, then ready with its size', async () => {
    archivePending();
    const dump = path.basename(await service.createDailyBackup());
    listing(dump);
    expect(archiveStateOf(dump)).toEqual({ state: 'archiving' });

    settleArchive({ status: 'written', path: '/x.uploads.tar' });
    await flushBackground();
    expect(archiveStateOf(dump)).toEqual({ state: 'ready', sizeBytes: 4096 });
  });

  it('an archive that throws never escapes the request: logged, captured, listed failed', async () => {
    archivePending();
    const dump = path.basename(await service.createDailyBackup());
    listing(dump);
    failArchive(new Error("EIO reading '/data/uploads/hub-media'"));
    await flushBackground();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "EIO reading '/data/uploads/hub-media'",
      }),
      expect.anything(),
    );
    // Reported once: the captured exception, not a second captureMessage.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("EIO reading '/data/uploads/hub-media'"),
    );
    expect(archiveStateOf(dump)).toEqual({
      state: 'failed',
      error: 'Archive failed — see server logs',
    });
  });
});

describe('listBackups — uploads archive state', () => {
  it('a migration snapshot never carries an uploads archive state', () => {
    (mockFs.readdirSync as jest.Mock).mockImplementation((dir: string) =>
      dir === DAILY_DIR ? [] : ['pre_migration_2026-11-04_100000.dump'],
    );
    (mockFs.statSync as jest.Mock).mockReturnValue({
      size: 1,
      birthtime: new Date('2026-11-04T10:00:00Z'),
    });
    const [entry] = service.listBackups();
    expect(entry?.type).toBe('migration');
    expect(entry && 'uploadsArchive' in entry).toBe(false);
  });
});

/** Fake ONLY `Date` (the dump-name clock); the chain still needs real timers. */
function freezeClock(at: string): void {
  jest.useFakeTimers({
    now: new Date(at),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

describe('uploads archives run one at a time (504 review MAJOR 1)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a manual Create while an archive runs is a 409 before any dump', async () => {
    archivePending();
    await service.createDailyBackup();
    await expect(service.createDailyBackup()).rejects.toThrow(
      new ConflictException(
        'An uploads archive is still running — try again when it finishes',
      ),
    );
    expect(events).toEqual(['pg_dump']);
    expect(mockArchive).toHaveBeenCalledTimes(1);
  });

  it('Create is allowed again once the running archive settles', async () => {
    archivePending();
    await service.createDailyBackup();
    settleArchive({ status: 'written', path: '/x.uploads.tar' });
    await flushBackground();
    await service.createDailyBackup();
    expect(events).toEqual(['pg_dump', 'pg_dump']);
  });

  it('the cron dumps, waits for a running archive, then archives and rotates', async () => {
    // Two real dumps are seconds apart, so their names (and archives) differ.
    freezeClock('2026-11-04T10:00:00Z');
    archivePending();
    await service.createDailyBackup();
    await flushBackground();
    const finishManual = settleArchive;

    jest.setSystemTime(new Date('2026-11-04T10:00:05Z'));
    const cron = service.handleDailyBackup();
    await flushBackground();
    expect(events).toEqual(['pg_dump', 'pg_dump']);
    expect(mockArchive).toHaveBeenCalledTimes(1);

    finishManual({ status: 'written', path: '/manual.uploads.tar' });
    await flushBackground();
    expect(mockArchive).toHaveBeenCalledTimes(2);
    expect(events).not.toContain('rotate-uploads');

    settleArchive({ status: 'written', path: '/cron.uploads.tar' });
    await cron;
    expect(events).toEqual([
      'pg_dump',
      'pg_dump',
      'rotate-daily',
      'rotate-uploads',
    ]);
  });
});

describe('two Creates at the same moment (504 review MINOR 14)', () => {
  it('the second is a 409 while the first still dumps; only one pg_dump runs', async () => {
    const first = service.createDailyBackup();
    const second = service.createDailyBackup();
    await expect(second).rejects.toThrow(
      new ConflictException(
        'An uploads archive is still running — try again when it finishes',
      ),
    );
    await expect(first).resolves.toMatch(/raid_ledger_.+\.dump$/);
    expect(events.filter((e) => e === 'pg_dump')).toHaveLength(1);
    await flushBackground();
  });
});

describe('a hung uploads tar (504 review MAJOR 13)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /** The REAL archiveUploads (default deadline) around a tar that never exits. */
  function tarHangs(seen: TarRunOptions[]): void {
    const real = jest.requireActual<{ archiveUploads: typeof archiveUploads }>(
      './backup-uploads.helpers',
    ).archiveUploads;
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    mockArchive.mockImplementation((input) =>
      real({
        ...input,
        measure: () => 0,
        statfs: () => ({ bavail: Number.MAX_SAFE_INTEGER, bsize: 1 }),
        runTar: (_args, opts) => {
          seen.push(opts);
          events.push('tar');
          return new Promise(() => undefined);
        },
      }),
    );
  }

  it('is SIGKILLed at the deadline; the cron still rotates, then fails, and Create works again', async () => {
    const seen: TarRunOptions[] = [];
    tarHangs(seen);
    jest.useFakeTimers();
    const cron = service.handleDailyBackup();
    const outcome = expect(cron).rejects.toThrow(
      /uploads archive failed \(timeout: tar still running after 180 min — killed\)/,
    );
    await jest.advanceTimersByTimeAsync(UPLOADS_TAR_TIMEOUT_MS - 1);
    expect(events).toEqual(['pg_dump', 'tar']);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('uploads archive still running after 30 min'),
      'warning',
    );
    await jest.advanceTimersByTimeAsync(1);
    await outcome;
    expect(seen[0]?.killSignal).toBe('SIGKILL');
    expect(seen[0]?.signal.aborted).toBe(true);
    expect(events).toEqual([
      'pg_dump',
      'tar',
      'rotate-daily',
      'rotate-uploads',
    ]);
    expect(rotateMigrationDir).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
    archiveReturns({ status: 'written', path: '/next.uploads.tar' });
    await expect(service.createDailyBackup()).resolves.toMatch(/\.dump$/);
    await flushBackground();
    expect(events.slice(-2)).toEqual(['pg_dump', 'archive']);
  });
});

describe('deleteBackup while its archive runs (504 review MAJOR 2)', () => {
  it('is a 409 and deletes nothing; after the archive settles it deletes dump and archive', async () => {
    archivePending();
    const dump = path.basename(await service.createDailyBackup());
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);

    expect(() => service.deleteBackup('daily', dump)).toThrow(
      new ConflictException(
        'Uploads archive in progress — delete after it finishes',
      ),
    );
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();

    settleArchive({ status: 'written', path: '/x.uploads.tar' });
    await flushBackground();
    service.deleteBackup('daily', dump);
    expect(mockFs.unlinkSync.mock.calls.map((c) => String(c[0]))).toEqual([
      path.join(DAILY_DIR, dump),
      path.join(DAILY_DIR, dump.replace(/\.dump$/, '.uploads.tar')),
    ]);
  });
});

describe('failed uploads archive — admin-facing copy (504 review MINOR 3)', () => {
  it('lists a failed archive with a path-free message; the raw error goes only to the log and Sentry', async () => {
    archivePending();
    const dump = path.basename(await service.createDailyBackup());
    listing(dump);
    const raw = 'Command failed: tar -c -f /srv/backups/daily/x.partial';
    settleArchive({ status: 'failed', reason: 'tar-failed', detail: raw });
    await flushBackground();
    expect(archiveStateOf(dump)).toEqual({
      state: 'failed',
      error: 'Archive failed — see server logs',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      `uploads archive failed (tar-failed: ${raw})`,
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      `uploads archive failed (tar-failed: ${raw})`,
      'error',
    );
  });

  it('a no-room failure tells the admin the disk is full, not the byte counts', async () => {
    archivePending();
    const dump = path.basename(await service.createDailyBackup());
    listing(dump);
    settleArchive({ status: 'failed', reason: 'insufficient-space' });
    await flushBackground();
    expect(archiveStateOf(dump)).toEqual({
      state: 'failed',
      error: 'Not enough free space on the backup disk',
    });
  });
});
