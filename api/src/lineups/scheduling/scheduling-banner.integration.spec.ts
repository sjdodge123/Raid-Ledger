/**
 * Scheduling Banner Integration Tests (ROK-1235)
 *
 * Verifies GET /scheduling/banner returns 200 for an authenticated user
 * (regression guard against the original LineupsController @Get(':id')
 * ParseIntPipe shadowing that returned 400 on /lineups/scheduling-banner),
 * and 200 with null body for an anonymous request.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('GET /scheduling/banner (ROK-1235)', () => {
  it('returns 200 for a logged-in user with no scheduling polls', async () => {
    const res = await testApp.request
      .get('/scheduling/banner')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('returns 200 with null body for an anonymous request', async () => {
    const res = await testApp.request.get('/scheduling/banner');

    expect(res.status).toBe(200);
    const bodyEmpty =
      res.text === '' ||
      res.text === 'null' ||
      Object.keys(res.body ?? {}).length === 0;
    expect(bodyEmpty).toBe(true);
  });
});
