/**
 * Integration test setup — loaded via setupFilesAfterEnv in jest.integration.config.js.
 *
 * Registers a global afterAll hook to close the TestApp singleton.
 * This runs in the worker process (where the singleton lives), unlike
 * globalTeardown which runs in the parent process and cannot access it.
 */

// Set env vars before any imports to disable rate-limiting in integration tests.
// Must be before the test-app import to take effect before modules are evaluated.
process.env.THROTTLE_DISABLED = 'true';
process.env.THROTTLE_DEFAULT_LIMIT = '999999';

import { closeTestApp, getTestApp } from './test-app';
import { truncateAllTables } from './integration-helpers';

// ConfigModule.forRoot() in AppModule reads api/.env during the import above,
// setting process.env.DATABASE_URL to the dev DB. Delete it so getTestApp()
// uses Testcontainers for a fresh database instead of hitting the dev DB.
if (!process.env.CI) {
  delete process.env.DATABASE_URL;
}

// ROK-1058: defensive per-file reset. Boots the TestApp (no-op after first
// file's `closeTestApp`) then truncates rows + obliterates BullMQ queues so
// state from prior spec files cannot bleed into this one. Catches the specs
// that don't call `truncateAllTables` themselves (e.g. the BullMQ leak repro
// pair) without requiring per-spec edits across the integration suite.
beforeAll(async () => {
  const testApp = await getTestApp();
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(async () => {
  await closeTestApp();
});
