/**
 * DemoTestPostgresController integration tests (ROK-1156).
 *
 * - 404 when DEMO_MODE !== 'true' (test fixtures must never be reachable
 *   on a non-demo deployment, even by an admin).
 * - Returns `{ ranInMs: number }` with a value >= 500 when DEMO_MODE is on.
 */
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { getTestApp, type TestApp } from '../common/testing/test-app';

describe('DemoTestPostgresController (integration)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let originalDemoMode: string | undefined;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    originalDemoMode = process.env.DEMO_MODE;
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    if (originalDemoMode === undefined) {
      delete process.env.DEMO_MODE;
    } else {
      process.env.DEMO_MODE = originalDemoMode;
    }
  });

  it('returns 404 when DEMO_MODE is not "true"', async () => {
    delete process.env.DEMO_MODE;
    const res = await testApp.request
      .post('/admin/test/postgres/slow-query')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('runs the slow query and reports the elapsed time when DEMO_MODE is on', async () => {
    process.env.DEMO_MODE = 'true';
    const res = await testApp.request
      .post('/admin/test/postgres/slow-query')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.ranInMs).toBe('number');
    // pg_sleep(0.5) must take at least ~500ms (allow small clock drift).
    expect(res.body.ranInMs).toBeGreaterThanOrEqual(450);
  });
});
