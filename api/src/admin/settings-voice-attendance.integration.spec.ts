/**
 * ROK-1940 (AC-6): the voice-attendance grace setting is admin-only.
 * A signed-in member gets 403 on PUT (and GET) and the stored value is unchanged.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../users/game-time.integration.spec-helpers';

const ROUTE = '/admin/settings/voice-attendance';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function adminGrace(): Promise<unknown> {
  const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const res = await testApp.request
    .get(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('PUT /admin/settings/voice-attendance auth (ROK-1940 AC-6)', () => {
  it('returns 403 to a non-admin and does not persist the value', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'vagmember',
      'vagmember@t.local',
    );
    const res = await testApp.request
      .put(ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .send({ graceMinutes: 30 });
    expect(res.status).toBe(403);
    expect(await adminGrace()).toEqual({ graceMinutes: 5 });
  });

  it('returns 403 to a non-admin GET', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'vagreader',
      'vagreader@t.local',
    );
    const res = await testApp.request
      .get(ROUTE)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    const res = await testApp.request.put(ROUTE).send({ graceMinutes: 30 });
    expect(res.status).toBe(401);
  });

  it('lets an admin save, so the 403 is the guard and not the route', async () => {
    const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    const res = await testApp.request
      .put(ROUTE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ graceMinutes: 30 });
    expect(res.status).toBe(200);
    expect(await adminGrace()).toEqual({ graceMinutes: 30 });
  });
});
