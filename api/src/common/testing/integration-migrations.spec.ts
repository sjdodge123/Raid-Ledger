/**
 * ROK-2196: the per-file migrate() is skipped ONLY for the exact DB the CI
 * globalSetup already migrated in this run.
 */
const mockMigrate = jest.fn<Promise<void>, unknown[]>();
const mockEnd = jest.fn<Promise<void>, unknown[]>();

jest.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: (...args: unknown[]) => mockMigrate(...args),
}));
jest.mock('drizzle-orm/postgres-js', () => ({ drizzle: () => ({}) }));
jest.mock('postgres', () => ({
  __esModule: true,
  default: () => ({ end: (...args: unknown[]) => mockEnd(...args) }),
}));

import {
  MIGRATED_TEST_DB_URL_ENV,
  ensureTestDbMigrated,
  isTestDbMigrated,
  markTestDbMigrated,
} from './integration-migrations';

const URL_A = 'postgres://user:pw@db-a:5432/raid_ledger_test';
const URL_B = 'postgres://user:pw@db-b:5432/raid_ledger_test';

describe('integration-migrations (ROK-2196)', () => {
  const saved = process.env[MIGRATED_TEST_DB_URL_ENV];

  beforeEach(() => {
    delete process.env[MIGRATED_TEST_DB_URL_ENV];
    mockMigrate.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (saved === undefined) delete process.env[MIGRATED_TEST_DB_URL_ENV];
    else process.env[MIGRATED_TEST_DB_URL_ENV] = saved;
  });

  it('treats a DB as migrated only after it is marked, and only that URL', () => {
    expect(isTestDbMigrated(URL_A)).toBe(false);
    markTestDbMigrated(URL_A);
    expect(isTestDbMigrated(URL_A)).toBe(true);
    expect(isTestDbMigrated(URL_B)).toBe(false);
    expect(isTestDbMigrated('')).toBe(false);
  });

  it('skips migrate() for the DB the globalSetup already migrated', async () => {
    markTestDbMigrated(URL_A);
    await ensureTestDbMigrated(URL_A);
    expect(mockMigrate).not.toHaveBeenCalled();
  });

  it('still migrates (and closes the client) for any other DB', async () => {
    markTestDbMigrated(URL_A);
    await ensureTestDbMigrated(URL_B);
    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('closes the client even when migrate() throws', async () => {
    mockMigrate.mockRejectedValue(new Error('boom'));
    await expect(ensureTestDbMigrated(URL_B)).rejects.toThrow('boom');
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});
