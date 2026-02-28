/**
 * Demo Data Integration Tests (ROK-569)
 *
 * Verifies demo data install, status, and clear endpoints against a real
 * PostgreSQL database. The install operation inserts across 13+ tables;
 * the clear operation cascading-deletes in FK-safe order.
 *
 * Note: installDemoData depends on having games in the DB (seeded baseline
 * has one game). The full ~100-user install is tested end-to-end.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';

describe('Demo Data (integration)', () => {
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

  // ===================================================================
  // GET /admin/settings/demo/status
  // ===================================================================

  describe('GET /admin/settings/demo/status', () => {
    it('should return status with zero counts when no demo data exists', async () => {
      const res = await testApp.request
        .get('/admin/settings/demo/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        demoMode: expect.any(Boolean),
        users: 0,
        events: 0,
        characters: 0,
        signups: 0,
      });
    });

    it('should require admin authentication', async () => {
      const res = await testApp.request.get('/admin/settings/demo/status');

      expect(res.status).toBe(401);
    });
  });

  // ===================================================================
  // POST /admin/settings/demo/install + clear lifecycle
  // ===================================================================

  describe('install and clear lifecycle', () => {
    it('should install demo data and report counts', async () => {
      const installRes = await testApp.request
        .post('/admin/settings/demo/install')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(installRes.status).toBe(200);
      expect(installRes.body.success).toBe(true);
      expect(installRes.body.counts).toMatchObject({
        users: expect.any(Number),
        events: expect.any(Number),
        characters: expect.any(Number),
        signups: expect.any(Number),
      });
      expect(installRes.body.counts.users).toBeGreaterThan(0);
      expect(installRes.body.counts.events).toBeGreaterThan(0);

      // Status should reflect installed data
      const statusRes = await testApp.request
        .get('/admin/settings/demo/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.users).toBeGreaterThan(0);
    });

    it('should prevent double install', async () => {
      // Install once
      await testApp.request
        .post('/admin/settings/demo/install')
        .set('Authorization', `Bearer ${adminToken}`);

      // Second install should fail gracefully
      const res = await testApp.request
        .post('/admin/settings/demo/install')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should clear demo data and return counts of deleted entities', async () => {
      // Install first
      await testApp.request
        .post('/admin/settings/demo/install')
        .set('Authorization', `Bearer ${adminToken}`);

      // Clear
      const clearRes = await testApp.request
        .post('/admin/settings/demo/clear')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(clearRes.status).toBe(200);
      expect(clearRes.body.success).toBe(true);
      expect(clearRes.body.counts.users).toBeGreaterThan(0);

      // Status should show zero counts
      const statusRes = await testApp.request
        .get('/admin/settings/demo/status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.users).toBe(0);
    });

    it('should handle clear gracefully when no demo data exists', async () => {
      const res = await testApp.request
        .post('/admin/settings/demo/clear')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require admin for install endpoint', async () => {
      const res = await testApp.request.post('/admin/settings/demo/install');

      expect(res.status).toBe(401);
    });

    it('should require admin for clear endpoint', async () => {
      const res = await testApp.request.post('/admin/settings/demo/clear');

      expect(res.status).toBe(401);
    });
  });
});
