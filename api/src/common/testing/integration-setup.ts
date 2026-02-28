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

import { closeTestApp } from './test-app';

// ConfigModule.forRoot() in AppModule reads api/.env during the import above,
// setting process.env.DATABASE_URL to the dev DB. Delete it so getTestApp()
// uses Testcontainers for a fresh database instead of hitting the dev DB.
if (!process.env.CI) {
  delete process.env.DATABASE_URL;
}

afterAll(async () => {
  await closeTestApp();
});
