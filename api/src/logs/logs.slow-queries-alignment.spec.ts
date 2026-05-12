/**
 * Regression: ROK-1266 — `/admin/logs` listing returns empty despite
 * `slow-queries.log` being written.
 *
 * Reproduces the original bug end-to-end with real filesystem (no fs mock):
 *   1. SlowQueriesService.appendDigestToLog → writes to LOG_DIR.
 *   2. LogsService.listLogFiles(LOG_DIR) → MUST surface the file.
 *
 * The pre-fix bug was a silent path/IO mismatch:
 *   - Both services resolved `LOG_DIR` via `configService.get('LOG_DIR') ||
 *     '/data/logs'`. On Mac dev / non-prod containers `/data/logs` is
 *     unwritable → the writer's `mkdir+appendFile` failed inside a try/catch
 *     and the seed endpoint reported `success: true` regardless. The listing
 *     endpoint then read from the same nonexistent dir and returned an empty
 *     array. Net effect: GET /admin/logs always returned `{ files: [], total: 0 }`.
 *
 * Fix (ROK-1266):
 *   - Centralise LOG_DIR resolution in `common/log-dir.ts` with a writable
 *     dev fallback (`<tmp>/raid-ledger-logs`).
 *   - `appendDigestToLog` now returns whether the write succeeded.
 *   - The `/admin/test/seed-slow-queries-log` endpoint surfaces a 500 when
 *     the writer reports failure (covered separately in
 *     `demo-test-core.controller.spec.ts`).
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LogsService } from './logs.service';
import { SlowQueriesService } from '../slow-queries/slow-queries.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

/**
 * Build a fake drizzle handle that makes `db.execute(sql)` reject — the
 * service treats this as "extension absent" and writes an empty digest block,
 * which is exactly what we want to assert on (we're testing the IO path, not
 * the pg_stat_statements query).
 */
function fakeDb() {
  return {
    execute: jest
      .fn()
      .mockRejectedValue(new Error('pg_stat_statements absent')),
  };
}

describe('Regression: ROK-1266 — slow-queries seed/listing alignment', () => {
  let logDir: string;
  let module: TestingModule;
  let logsService: LogsService;
  let slowQueriesService: SlowQueriesService;

  beforeEach(async () => {
    // Use a real, writable temp dir to mirror production behaviour. The
    // original bug was that BOTH services resolved an unwritable default —
    // pinning LOG_DIR here proves that when both resolve the same writable
    // path, the listing surfaces the file the writer just created.
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok-1266-'));

    module = await Test.createTestingModule({
      providers: [
        LogsService,
        SlowQueriesService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'LOG_DIR' ? logDir : undefined,
            ),
          },
        },
        { provide: DrizzleAsyncProvider, useValue: fakeDb() },
      ],
    }).compile();

    logsService = module.get<LogsService>(LogsService);
    slowQueriesService = module.get<SlowQueriesService>(SlowQueriesService);
  });

  afterEach(async () => {
    await module.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('writer and listing resolve to the same directory', () => {
    // The writer's path must live inside the listing's logDir, otherwise the
    // listing can never see what was written. This catches future regressions
    // where one service is updated without the other.
    const writerPath = slowQueriesService.getLogFilePath();
    expect(path.dirname(writerPath)).toBe(path.resolve(logDir));
  });

  it('seed → listing surfaces slow-queries.log immediately (no race)', async () => {
    // Pre-condition: dir is empty.
    expect(logsService.listLogFiles()).toHaveLength(0);

    // Seed: writer must report success when LOG_DIR is writable.
    const written = await slowQueriesService.appendDigestToLog();
    expect(written).toBe(true);

    // Sanity: the file is on disk.
    const expectedPath = path.join(logDir, 'slow-queries.log');
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.statSync(expectedPath).size).toBeGreaterThan(0);

    // Regression assertion: the listing endpoint MUST return the file with
    // service='slow-queries'. Pre-fix this returned []. The append is
    // synchronous from the writer's perspective (await fs.appendFile
    // resolved), so a follow-up readdirSync MUST see the entry — there is
    // no eventual-consistency race here.
    const files = logsService.listLogFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'slow-queries.log',
      service: 'slow-queries',
    });
    expect(files[0].sizeBytes).toBeGreaterThan(0);
  });

  it('listing filtered by service="slow-queries" still surfaces the file', async () => {
    await slowQueriesService.appendDigestToLog();
    const filtered = logsService.listLogFiles('slow-queries');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].service).toBe('slow-queries');
  });

  it('appendDigestToLog returns false when LOG_DIR is unwritable', async () => {
    // Recreate the services with an unwritable LOG_DIR (a regular file's
    // child path can never be created as a directory). This is the actual
    // failure mode reported in production logs as "Failed to append slow-
    // query digest to /data/logs/slow-queries.log: EACCES".
    const unwritableParent = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rok-1266-unwritable-'),
    );
    const wedgeFile = path.join(unwritableParent, 'wedge');
    fs.writeFileSync(wedgeFile, 'block');
    const blockedLogDir = path.join(wedgeFile, 'logs'); // mkdir under a file

    const blockedModule = await Test.createTestingModule({
      providers: [
        SlowQueriesService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'LOG_DIR' ? blockedLogDir : undefined,
            ),
          },
        },
        { provide: DrizzleAsyncProvider, useValue: fakeDb() },
      ],
    }).compile();

    try {
      const blockedService =
        blockedModule.get<SlowQueriesService>(SlowQueriesService);
      const written = await blockedService.appendDigestToLog();
      // Pre-fix the writer would also return undefined here (no return value)
      // and the seed endpoint would happily report success. Now it returns
      // false and the endpoint converts that into a 500 (covered by the
      // controller spec).
      expect(written).toBe(false);
    } finally {
      await blockedModule.close();
      fs.rmSync(unwritableParent, { recursive: true, force: true });
    }
  });
});
