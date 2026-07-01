/**
 * ROK-1281 / ROK-1322: unit tests for the instrumented boot-time migration
 * runner (`api/scripts/run-migrations-with-sentry.ts`).
 *
 * ROK-1281 pinned `reportBootFailure` (Sentry capture + flush before the
 * script's `process.exit(1)`).
 *
 * ROK-1322 routes the RESTORE path (`backup.helpers.ts::runMigrations`)
 * through the SAME runner. That required:
 *   - `runBootMigrations(url, { migrationsFolder, context })` — restore passes
 *     its already-resolved folder + a `restore-migration` failure context so
 *     the switch does NOT silently change the migrations folder and restore
 *     failures are NOT mis-tagged `boot.migration`.
 *   - `runBootMigrations` now instruments failures INTERNALLY (capture with the
 *     supplied context, flush, rethrow) so a single call site covers boot AND
 *     restore with no double-capture.
 *
 * The migrate primitive + postgres client are mocked so the runner's
 * orchestration (refresh → migrate → validate, and the failure contract) is
 * unit-testable without a live database or forking a Node process.
 */
const captureException = jest.fn();
const flush = jest.fn(() => Promise.resolve(true));

jest.mock('@sentry/nestjs', () => ({
  captureException,
  flush,
  // The instrument import has side effects; stub init to a no-op.
  init: jest.fn(),
}));

// Record the interleaving of DB queries vs the drizzle migrate call so we can
// prove the dedup-audit refresh runs BEFORE migrate on every code path.
const mockEvents: string[] = [];

jest.mock('postgres', () => {
  const sql = (): Promise<unknown[]> => {
    mockEvents.push('sql');
    return Promise.resolve([]);
  };
  (sql as unknown as { end: jest.Mock }).end = jest.fn(() =>
    Promise.resolve(undefined),
  );
  (sql as unknown as { json: jest.Mock }).json = jest.fn((v: unknown) => v);
  return jest.fn(() => sql);
});

jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => ({}) }));

jest.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: jest.fn(() => {
    mockEvents.push('migrate');
    return Promise.resolve();
  }),
}));

import * as path from 'path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  reportBootFailure,
  runBootMigrations,
} from '../../scripts/run-migrations-with-sentry';

// Real migrations folder so `validateMigrationState` can read a real journal
// on the success path (its SQL runs against the mocked client, which is fine).
const REAL_MIGRATIONS = path.resolve(__dirname, '../drizzle/migrations');

describe('ROK-1281 reportBootFailure', () => {
  beforeEach(() => {
    captureException.mockClear();
    flush.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('captures the exception with the boot.migration tag by default', async () => {
    const err = new Error('synthetic migration failure');
    await reportBootFailure(err);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { context: 'boot.migration' },
    });
  });

  it('captures with the supplied context (restore-migration)', async () => {
    const err = new Error('synthetic restore failure');
    await reportBootFailure(err, 'restore-migration');
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { context: 'restore-migration' },
    });
  });

  it('awaits flush(2000) before returning', async () => {
    const order: string[] = [];
    captureException.mockImplementation(() => {
      order.push('capture');
    });
    flush.mockImplementation(async () => {
      order.push('flush-start');
      await new Promise((r) => setImmediate(r));
      order.push('flush-end');
      return true;
    });

    await reportBootFailure(new Error('any'));

    expect(flush).toHaveBeenCalledWith(2000);
    expect(order).toEqual(['capture', 'flush-start', 'flush-end']);
  });

  it('still completes even if flush rejects (avoid hanging the exit)', async () => {
    flush.mockRejectedValueOnce(new Error('sentry network down'));
    await expect(reportBootFailure(new Error('any'))).rejects.toThrow(
      'sentry network down',
    );
    // captureException still ran — flush failure is visible but doesn't
    // swallow the original error path; the script's exit(1) still fires.
    expect(captureException).toHaveBeenCalled();
  });
});

describe('ROK-1322 runBootMigrations orchestration + failure contract', () => {
  beforeEach(() => {
    captureException.mockClear();
    flush.mockClear();
    mockEvents.length = 0;
    (migrate as jest.Mock).mockClear();
    (migrate as jest.Mock).mockImplementation(() => {
      mockEvents.push('migrate');
      return Promise.resolve();
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes games_dedup_audit BEFORE running migrate', async () => {
    await runBootMigrations('postgres://fake/db', {
      migrationsFolder: REAL_MIGRATIONS,
    });

    // The first DB query is the dedup-audit table-existence probe from
    // refreshDedupAudit; it MUST precede the migrate call.
    expect(mockEvents[0]).toBe('sql');
    expect(mockEvents.indexOf('sql')).toBeLessThan(
      mockEvents.indexOf('migrate'),
    );
  });

  it('does NOT touch Sentry when migrations succeed', async () => {
    await runBootMigrations('postgres://fake/db', {
      migrationsFolder: REAL_MIGRATIONS,
    });
    expect(captureException).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('captures migrate failures with the restore-migration context and rethrows', async () => {
    (migrate as jest.Mock).mockRejectedValueOnce(
      new Error('syntax error at or near "THIS"'),
    );

    await expect(
      runBootMigrations('postgres://fake/db', {
        migrationsFolder: REAL_MIGRATIONS,
        context: 'restore-migration',
      }),
    ).rejects.toThrow(/syntax error/i);

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { context: 'restore-migration' },
    });
    expect(flush).toHaveBeenCalledWith(2000);
  });

  it('defaults the failure context to boot.migration', async () => {
    (migrate as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    await expect(
      runBootMigrations('postgres://fake/db', {
        migrationsFolder: REAL_MIGRATIONS,
      }),
    ).rejects.toThrow(/boom/);

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { context: 'boot.migration' },
    });
  });

  it('rethrows the ORIGINAL migration error even if the Sentry flush fails', async () => {
    (migrate as jest.Mock).mockRejectedValueOnce(new Error('real db error'));
    flush.mockRejectedValueOnce(new Error('sentry network down'));

    await expect(
      runBootMigrations('postgres://fake/db', {
        migrationsFolder: REAL_MIGRATIONS,
        context: 'restore-migration',
      }),
    ).rejects.toThrow(/real db error/);
  });
});
