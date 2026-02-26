/**
 * Auth Flow Integration Tests
 *
 * Verifies the complete local auth flow: login with credentials,
 * receive JWT, and access protected endpoints with that token.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';

describe('Auth flow (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db as never);
  });

  it('should login with valid credentials and return a JWT', async () => {
    const res = await testApp.request.post('/auth/local').send({
      email: testApp.seed.adminEmail,
      password: testApp.seed.adminPassword,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      access_token: expect.any(String),
      user: {
        id: expect.any(Number),
        username: 'admin',
        role: 'admin',
      },
    });
  });

  it('should reject invalid password', async () => {
    const res = await testApp.request.post('/auth/local').send({
      email: testApp.seed.adminEmail,
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
  });

  it('should reject non-existent user', async () => {
    const res = await testApp.request.post('/auth/local').send({
      email: 'nobody@test.local',
      password: 'anything',
    });

    expect(res.status).toBe(401);
  });

  it('should access protected endpoint with valid token', async () => {
    // Login
    const loginRes = await testApp.request.post('/auth/local').send({
      email: testApp.seed.adminEmail,
      password: testApp.seed.adminPassword,
    });

    const token = loginRes.body.access_token;

    // Access protected endpoint (admin/settings/oauth)
    const protectedRes = await testApp.request
      .get('/admin/settings/oauth')
      .set('Authorization', `Bearer ${token}`);

    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body).toHaveProperty('configured');
  });

  it('should reject access to protected endpoint without token', async () => {
    const res = await testApp.request.get('/admin/settings/oauth');

    expect(res.status).toBe(401);
  });

  it('should reject access to protected endpoint with invalid token', async () => {
    const res = await testApp.request
      .get('/admin/settings/oauth')
      .set('Authorization', 'Bearer invalid-token-here');

    expect(res.status).toBe(401);
  });

  it('should accept username field as alias for email', async () => {
    const res = await testApp.request.post('/auth/local').send({
      username: testApp.seed.adminEmail,
      password: testApp.seed.adminPassword,
    });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
  });
});
