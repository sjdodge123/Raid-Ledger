/**
 * ROK-1343 M4: unit test for the Sentry-capture path in the legacy
 * restore-time migration runner (`api/src/scripts/run-migrations.ts`).
 *
 * Modeled on `run-migrations-with-sentry.spec.ts`. Verifies that
 * `reportMigrationFailure`:
 *   - Calls `Sentry.captureException` with the `restore-migration` tag
 *   - Awaits `Sentry.flush(2000)` BEFORE returning (so the script's
 *     subsequent `process.exit(1)` doesn't kill the in-flight HTTP POST
 *     to Sentry's ingest endpoint)
 *
 * TDD: this spec MUST fail today — `run-migrations.ts` does not yet
 * export `reportMigrationFailure`. The import below resolves to
 * `undefined`, and the first invocation throws a TypeError.
 */
const captureException = jest.fn();
const flush = jest.fn(() => Promise.resolve(true));

jest.mock('@sentry/nestjs', () => ({
  captureException,
  flush,
  // The instrument import has side effects; stub init to a no-op.
  init: jest.fn(),
}));

import { reportMigrationFailure } from './run-migrations';

describe('ROK-1343 reportMigrationFailure', () => {
  beforeEach(() => {
    captureException.mockClear();
    flush.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('captures the exception with the restore-migration tag', async () => {
    const err = new Error('synthetic restore-migration failure');
    await reportMigrationFailure(err);
    expect(captureException).toHaveBeenCalledTimes(1);
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

    await reportMigrationFailure(new Error('any'));

    expect(flush).toHaveBeenCalledWith(2000);
    expect(order).toEqual(['capture', 'flush-start', 'flush-end']);
  });

  it('still propagates if flush rejects (avoid hanging the exit)', async () => {
    flush.mockRejectedValueOnce(new Error('sentry network down'));
    await expect(reportMigrationFailure(new Error('any'))).rejects.toThrow(
      'sentry network down',
    );
    // captureException still ran — flush failure is visible but doesn't
    // swallow the original error path; the script's exit(1) still fires.
    expect(captureException).toHaveBeenCalled();
  });
});
