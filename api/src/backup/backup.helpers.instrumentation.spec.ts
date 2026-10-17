/**
 * ROK-1322: the restore-time migration path (`backup.helpers.ts::runMigrations`,
 * invoked by `backup.service.ts` for both post-restore and factory-reset) must
 * route through the SAME instrumented runner as the deploy-time boot path —
 * `runBootMigrations` — so restore gets the pre-migrate `games_dedup_audit`
 * refresh + `validateMigrationState` + Sentry capture (tagged `restore-migration`)
 * as ONE enforced invariant for boot AND restore.
 *
 * This spec pins the WIRING at the `backup.helpers` boundary:
 *   - the restore-resolved migrations folder is threaded into `runBootMigrations`
 *     (the switch must NOT silently change which folder restore uses), and
 *   - the failure context is `restore-migration` (NOT the boot `boot.migration`
 *     tag), and
 *   - the DATABASE_URL is threaded from the caller (or the process env), and
 *   - failures still propagate loudly.
 *
 * The runner's own instrumentation contract (capture + flush + rethrow with the
 * supplied context) is proven in `run-migrations-with-sentry.spec.ts`; the
 * real-DB refresh is proven in
 * `backup.helpers.restore-dedup-refresh.integration.spec.ts`.
 */
const runBootMigrations = jest.fn(() => Promise.resolve());

jest.mock('../../scripts/run-migrations-with-sentry', () => ({
  runBootMigrations,
}));

// Force folder resolution to succeed without touching the real filesystem —
// `runMigrations` picks the first candidate whose `meta/_journal.json` exists.
// Keep the rest of `node:fs` real (transitive deps such as @sentry promisify
// `fs.readFile` at import time).
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  existsSync: jest.fn().mockReturnValue(true),
}));

import * as path from 'node:path';
import { runMigrations } from './backup.helpers';

const API_ROOT = '/tmp/rok-1322-fake-api-root';
const DB_URL = 'postgres://user:pass@localhost:5432/restore_target';
const SRC_MIGRATIONS = path.join('src', 'drizzle', 'migrations');

describe('ROK-1322 backup.helpers.runMigrations routes through runBootMigrations', () => {
  const savedDbUrl = process.env.DATABASE_URL;
  const savedMigrationsFolder = process.env.MIGRATIONS_FOLDER;

  beforeEach(() => {
    runBootMigrations.mockClear();
    runBootMigrations.mockResolvedValue(undefined);
    delete process.env.MIGRATIONS_FOLDER;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDbUrl;
    if (savedMigrationsFolder === undefined)
      delete process.env.MIGRATIONS_FOLDER;
    else process.env.MIGRATIONS_FOLDER = savedMigrationsFolder;
  });

  it('threads the resolved migrations folder + restore-migration context', async () => {
    await runMigrations(API_ROOT, DB_URL);

    expect(runBootMigrations).toHaveBeenCalledTimes(1);
    expect(runBootMigrations).toHaveBeenCalledWith(DB_URL, {
      migrationsFolder: expect.stringContaining(SRC_MIGRATIONS),
      context: 'restore-migration',
    });
  });

  it('honours an explicit MIGRATIONS_FOLDER override', async () => {
    process.env.MIGRATIONS_FOLDER = '/opt/app/drizzle/migrations';

    await runMigrations(API_ROOT, DB_URL);

    expect(runBootMigrations).toHaveBeenCalledWith(DB_URL, {
      migrationsFolder: '/opt/app/drizzle/migrations',
      context: 'restore-migration',
    });
  });

  it('falls back to process.env.DATABASE_URL when no url is threaded', async () => {
    process.env.DATABASE_URL = DB_URL;

    await runMigrations(API_ROOT);

    expect(runBootMigrations).toHaveBeenCalledWith(
      DB_URL,
      expect.objectContaining({ context: 'restore-migration' }),
    );
  });

  it('throws when no DATABASE_URL is available and never calls the runner', async () => {
    delete process.env.DATABASE_URL;

    await expect(runMigrations(API_ROOT)).rejects.toThrow(/DATABASE_URL/i);
    expect(runBootMigrations).not.toHaveBeenCalled();
  });

  it('propagates a runner failure loudly (does not swallow)', async () => {
    runBootMigrations.mockRejectedValueOnce(
      new Error('syntax error at or near "THIS"'),
    );

    await expect(runMigrations(API_ROOT, DB_URL)).rejects.toThrow(
      /syntax error/i,
    );
  });
});
