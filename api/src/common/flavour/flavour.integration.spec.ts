/**
 * ROK-1700 — RL_FLAVOUR=cloud through the real app (real DB).
 *
 *   - GET /system/status serves `flavour` (nas when unset, cloud when set);
 *   - every /admin/settings/cooptimus route is a 404 under cloud — even for an
 *     admin, even with a Co-Optimus user-agent configured — and unchanged
 *     under nas.
 *
 * The flavour is read per request (no boot cache), so each case sets
 * process.env.RL_FLAVOUR and restores it afterwards. The boot guards
 * (cloud + DEMO_MODE refuses) run in main.ts only, never in the test app.
 */
import { getTestApp, type TestApp } from '../testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../testing/integration-helpers';

describe('ROK-1700 — RL_FLAVOUR through the real app', () => {
  let testApp: TestApp;
  let adminToken: string;
  const savedFlavour = process.env.RL_FLAVOUR;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    if (savedFlavour === undefined) delete process.env.RL_FLAVOUR;
    else process.env.RL_FLAVOUR = savedFlavour;
    // The nas cases store a Co-Optimus UA; reset so no state leaks.
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  describe('GET /system/status flavour', () => {
    it('is "nas" when RL_FLAVOUR is unset', async () => {
      delete process.env.RL_FLAVOUR;
      const res = await testApp.request.get('/system/status');
      expect(res.status).toBe(200);
      expect(res.body.flavour).toBe('nas');
    });

    it('is "cloud" when RL_FLAVOUR=cloud', async () => {
      process.env.RL_FLAVOUR = 'cloud';
      const res = await testApp.request.get('/system/status');
      expect(res.status).toBe(200);
      expect(res.body.flavour).toBe('cloud');
    });
  });

  describe('/admin/settings/cooptimus', () => {
    const auth = () => `Bearer ${adminToken}`;

    it('nas: an admin can configure the user-agent and read the status', async () => {
      delete process.env.RL_FLAVOUR;
      const put = await testApp.request
        .put('/admin/settings/cooptimus')
        .set('Authorization', auth())
        .send({ userAgent: 'RaidLedger-Test/1.0' });
      expect(put.status).toBe(200);
      const get = await testApp.request
        .get('/admin/settings/cooptimus')
        .set('Authorization', auth());
      expect(get.status).toBe(200);
      expect(get.body.configured).toBe(true);
    });

    it.each([
      ['GET', '/admin/settings/cooptimus'],
      ['PUT', '/admin/settings/cooptimus'],
      ['PUT', '/admin/settings/cooptimus/prose'],
      ['POST', '/admin/settings/cooptimus/test'],
      ['POST', '/admin/settings/cooptimus/clear'],
    ])(
      'cloud: %s %s is 404 for an admin, UA configured',
      async (method, path) => {
        delete process.env.RL_FLAVOUR;
        await testApp.request
          .put('/admin/settings/cooptimus')
          .set('Authorization', auth())
          .send({ userAgent: 'RaidLedger-Test/1.0' })
          .expect(200);
        process.env.RL_FLAVOUR = 'cloud';
        const base =
          method === 'GET'
            ? testApp.request.get(path)
            : method === 'PUT'
              ? testApp.request
                  .put(path)
                  .send({ userAgent: 'x', enabled: true })
              : testApp.request.post(path);
        const res = await base.set('Authorization', auth());
        expect(res.status).toBe(404);
      },
    );

    it('cloud: an unauthenticated probe is also a 404 (guard runs first)', async () => {
      process.env.RL_FLAVOUR = 'cloud';
      const res = await testApp.request.get('/admin/settings/cooptimus');
      expect(res.status).toBe(404);
    });
  });
});
