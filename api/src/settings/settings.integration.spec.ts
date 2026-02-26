/**
 * Settings CRUD Integration Tests
 *
 * Verifies that settings persist to and read from a real PostgreSQL database.
 * This was the exact gap that caused ROK-293 bugs — mocked DB tests could not
 * detect that encrypted settings were not persisting correctly.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';

describe('Settings CRUD (integration)', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request as never, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db as never);
    adminToken = await loginAsAdmin(testApp.request as never, testApp.seed);
  });

  it('should persist timezone setting and return it on GET', async () => {
    // PUT the timezone
    const putRes = await testApp.request
      .put('/admin/settings/timezone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ timezone: 'America/New_York' });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // GET the timezone back
    const getRes = await testApp.request
      .get('/admin/settings/timezone')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.timezone).toBe('America/New_York');
  });

  it('should clear timezone on PUT with null', async () => {
    // Set it first
    await testApp.request
      .put('/admin/settings/timezone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ timezone: 'Europe/London' });

    // Clear it
    const clearRes = await testApp.request
      .put('/admin/settings/timezone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ timezone: null });

    expect(clearRes.status).toBe(200);

    // Verify cleared
    const getRes = await testApp.request
      .get('/admin/settings/timezone')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.body.timezone).toBeNull();
  });

  it('should reject invalid timezone', async () => {
    const res = await testApp.request
      .put('/admin/settings/timezone')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ timezone: 'Invalid/Timezone' });

    expect(res.status).toBe(400);
  });

  it('should persist and return OAuth configuration status', async () => {
    // Initially not configured
    const getRes = await testApp.request
      .get('/admin/settings/oauth')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.configured).toBe(false);

    // Configure OAuth
    const putRes = await testApp.request
      .put('/admin/settings/oauth')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        callbackUrl: 'http://localhost:3000/auth/discord/callback',
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);

    // Verify configured
    const getRes2 = await testApp.request
      .get('/admin/settings/oauth')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes2.status).toBe(200);
    expect(getRes2.body.configured).toBe(true);
    expect(getRes2.body.callbackUrl).toBe(
      'http://localhost:3000/auth/discord/callback',
    );
  });

  it('should clear OAuth configuration', async () => {
    // Configure first
    await testApp.request
      .put('/admin/settings/oauth')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      });

    // Clear it
    const clearRes = await testApp.request
      .post('/admin/settings/oauth/clear')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(clearRes.status).toBe(200);
    expect(clearRes.body.success).toBe(true);

    // Verify cleared
    const getRes = await testApp.request
      .get('/admin/settings/oauth')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getRes.body.configured).toBe(false);
  });

  it('should require admin role for settings endpoints', async () => {
    const res = await testApp.request.get('/admin/settings/oauth');

    expect(res.status).toBe(401);
  });
});
