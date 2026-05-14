/**
 * ROK-1281: unit test for the Sentry-capture path in the boot-time runner.
 *
 * Verifies that `reportBootFailure`:
 *   - Calls `Sentry.captureException` with the `boot.migration` tag
 *   - Awaits `Sentry.flush(2000)` BEFORE returning (so the script's
 *     subsequent `process.exit(1)` doesn't kill the in-flight HTTP POST
 *     to Sentry's ingest endpoint)
 *
 * This is the closest a unit test can get to the script's catch handler
 * without forking a process — the production catch calls this function
 * verbatim, then `process.exit(1)` separately.
 */
const captureException = jest.fn();
const flush = jest.fn(() => Promise.resolve(true));

jest.mock('@sentry/nestjs', () => ({
  captureException,
  flush,
  // The instrument import has side effects; stub init to a no-op.
  init: jest.fn(),
}));

import { reportBootFailure } from '../../scripts/run-migrations-with-sentry';

describe('ROK-1281 reportBootFailure', () => {
  beforeEach(() => {
    captureException.mockClear();
    flush.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('captures the exception with the boot.migration tag', async () => {
    const err = new Error('synthetic migration failure');
    await reportBootFailure(err);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { context: 'boot.migration' },
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
