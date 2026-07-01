/**
 * ROK-1322: the restore-time migration path
 * (`backup.helpers.ts::runMigrations`, invoked by `backup.service.ts` for
 * both post-restore and factory-reset) must route through the SAME
 * instrumented failure contract as the deploy-time boot runner — capturing
 * migration failures to Sentry with the `restore-migration` tag and flushing
 * the event BEFORE the error propagates — rather than propagating an
 * un-instrumented error that the caller can silently swallow.
 *
 * Before ROK-1322, `reportMigrationFailure` (the Sentry capture+flush helper
 * in `run-migrations.ts`) only ran when the script was invoked directly via
 * `require.main === module` (db:migrate / validate-migrations.sh). The backup
 * service call site got NO Sentry visibility. This spec pins the unified path.
 *
 * Mirrors `run-migrations.spec.ts` (the `reportMigrationFailure` capture
 * contract) but asserts the wiring at the `backup.helpers` boundary. The
 * broader loud-propagation guarantee is covered by
 * `backup.helpers.loud-failure.integration.spec.ts`.
 */
const captureException = jest.fn();
const flush = jest.fn(() => Promise.resolve(true));

jest.mock('@sentry/nestjs', () => ({
  captureException,
  flush,
  // The instrument import has side effects; stub init to a no-op.
  init: jest.fn(),
}));

// Force folder resolution to succeed without touching the real filesystem —
// `runMigrations` picks the first candidate whose `meta/_journal.json` exists.
jest.mock('node:fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
}));

// Replace ONLY the in-process migrate primitive with a rejecting stub; keep
// the REAL `reportMigrationFailure` so the Sentry capture+flush contract is
// exercised end-to-end through `backup.helpers`.
jest.mock('../scripts/run-migrations', () => {
  const actual = jest.requireActual('../scripts/run-migrations');
  return {
    ...actual,
    runMigrations: jest.fn(() =>
      Promise.reject(new Error('syntax error at or near "THIS"')),
    ),
  };
});

import { runMigrations } from './backup.helpers';
import { runMigrations as inProcessRunMigrations } from '../scripts/run-migrations';

const API_ROOT = '/tmp/rok-1322-fake-api-root';

describe('ROK-1322 backup.helpers.runMigrations instrumentation', () => {
  beforeEach(() => {
    captureException.mockClear();
    flush.mockClear();
    (inProcessRunMigrations as jest.Mock).mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('propagates the underlying SQL error loudly (does not swallow)', async () => {
    await expect(runMigrations(API_ROOT)).rejects.toThrow(/syntax error/i);
  });

  it('captures the failure to Sentry with the restore-migration tag', async () => {
    const caught = await runMigrations(API_ROOT).catch((err: unknown) => err);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(caught, {
      tags: { context: 'restore-migration' },
    });
  });

  it('captures then awaits flush(2000) before the error propagates', async () => {
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

    await expect(runMigrations(API_ROOT)).rejects.toThrow(/syntax error/i);

    expect(flush).toHaveBeenCalledWith(2000);
    expect(order).toEqual(['capture', 'flush-start', 'flush-end']);
  });

  it('does NOT touch Sentry when migrations succeed', async () => {
    (inProcessRunMigrations as jest.Mock).mockResolvedValueOnce(undefined);

    await expect(runMigrations(API_ROOT)).resolves.toBeUndefined();

    expect(captureException).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
});
