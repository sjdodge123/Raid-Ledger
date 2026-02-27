/**
 * Integration test setup — loaded via setupFilesAfterEnv in jest.integration.config.js.
 *
 * Registers a global afterAll hook to close the TestApp singleton.
 * This runs in the worker process (where the singleton lives), unlike
 * globalTeardown which runs in the parent process and cannot access it.
 */
import { closeTestApp } from './test-app';

afterAll(async () => {
  await closeTestApp();
});
