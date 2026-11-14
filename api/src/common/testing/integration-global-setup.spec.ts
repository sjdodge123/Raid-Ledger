import integrationGlobalSetup, {
  CONTAINER_KEY,
  type GlobalWithContainer,
} from './integration-global-setup';
import {
  MIGRATED_TEST_DB_URL_ENV,
  isTestDbMigrated,
  runTestMigrations,
} from './integration-migrations';
import {
  SHARED_TEST_DB_OWNER_ENV,
  SHARED_TEST_DB_URL_ENV,
  startTestPostgres,
} from './test-postgres-container';

jest.mock('./integration-migrations', () => ({
  ...jest.requireActual<object>('./integration-migrations'),
  runTestMigrations: jest.fn((): Promise<void> => Promise.resolve()),
}));
jest.mock('./test-postgres-container', () => ({
  ...jest.requireActual<object>('./test-postgres-container'),
  startTestPostgres: jest.fn(() =>
    Promise.resolve({ getConnectionUri: () => 'postgres://container/db' }),
  ),
}));

const CI_URL = 'postgres://ci-service/raid_ledger_test';
const ENV_KEYS = [
  'CI',
  'DATABASE_URL',
  MIGRATED_TEST_DB_URL_ENV,
  SHARED_TEST_DB_URL_ENV,
  SHARED_TEST_DB_OWNER_ENV,
] as const;

describe('integrationGlobalSetup migrate-once path (ROK-2196)', () => {
  const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete (globalThis as GlobalWithContainer)[CONTAINER_KEY];
    jest.clearAllMocks();
  });

  it('on CI migrates the service DB once and marks it migrated', async () => {
    process.env.CI = 'true';
    process.env.DATABASE_URL = CI_URL;
    await integrationGlobalSetup();
    expect(runTestMigrations).toHaveBeenCalledTimes(1);
    expect(runTestMigrations).toHaveBeenCalledWith(CI_URL);
    expect(isTestDbMigrated(CI_URL)).toBe(true);
    expect(startTestPostgres).not.toHaveBeenCalled();
  });

  it('off CI starts a container and marks nothing migrated', async () => {
    process.env.CI = 'false';
    process.env.DATABASE_URL = CI_URL;
    process.env[MIGRATED_TEST_DB_URL_ENV] = 'postgres://stale/db';
    await integrationGlobalSetup();
    expect(startTestPostgres).toHaveBeenCalledTimes(1);
    expect(runTestMigrations).not.toHaveBeenCalled();
    expect(process.env[MIGRATED_TEST_DB_URL_ENV]).toBeUndefined();
    expect(isTestDbMigrated(CI_URL)).toBe(false);
  });
});
