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
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

function describeDemoData() {
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

  function describeInstallAndClearLifecycle() {
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
  }
  describe('install and clear lifecycle', () =>
    describeInstallAndClearLifecycle());

  // ===================================================================
  // Activity log entries (ROK-1116)
  // ===================================================================

  function describeActivityLogOnInstall() {
    it('should log event_created for every demo event with a live actor', async () => {
      await testApp.request
        .post('/admin/settings/demo/install')
        .set('Authorization', `Bearer ${adminToken}`);

      const demoEventIds = (
        await testApp.db.select({ id: schema.events.id }).from(schema.events)
      ).map((r) => r.id);
      expect(demoEventIds.length).toBeGreaterThan(0);

      const eventCreatedRows = await testApp.db
        .select({
          entityId: schema.activityLog.entityId,
          actorId: schema.activityLog.actorId,
        })
        .from(schema.activityLog)
        .where(
          and(
            eq(schema.activityLog.entityType, 'event'),
            eq(schema.activityLog.action, 'event_created'),
            inArray(schema.activityLog.entityId, demoEventIds),
          ),
        );

      const eventsWithActivity = new Set(
        eventCreatedRows.map((r) => r.entityId),
      );
      for (const id of demoEventIds)
        expect(eventsWithActivity.has(id)).toBe(true);
      for (const r of eventCreatedRows) expect(r.actorId).not.toBeNull();
    });

    it('should log signup_added for every demo signup with a live actor', async () => {
      await testApp.request
        .post('/admin/settings/demo/install')
        .set('Authorization', `Bearer ${adminToken}`);

      const demoSignups = await testApp.db
        .select({
          eventId: schema.eventSignups.eventId,
          userId: schema.eventSignups.userId,
        })
        .from(schema.eventSignups);
      const linkedSignups = demoSignups.filter((s) => s.userId !== null);
      expect(linkedSignups.length).toBeGreaterThan(0);

      const signupRows = await testApp.db
        .select({
          entityId: schema.activityLog.entityId,
          actorId: schema.activityLog.actorId,
        })
        .from(schema.activityLog)
        .where(
          and(
            eq(schema.activityLog.entityType, 'event'),
            eq(schema.activityLog.action, 'signup_added'),
          ),
        );

      const present = new Set(
        signupRows.map((r) => `${r.entityId}:${r.actorId}`),
      );
      for (const s of linkedSignups) {
        expect(present.has(`${s.eventId}:${s.userId}`)).toBe(true);
      }
      for (const r of signupRows) expect(r.actorId).not.toBeNull();
    });

    it('should not produce orphan activity actor refs after install', async () => {
      await testApp.request
        .post('/admin/settings/demo/install')
        .set('Authorization', `Bearer ${adminToken}`);

      const orphanActors = await testApp.db
        .select({ id: schema.activityLog.id })
        .from(schema.activityLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.activityLog.actorId))
        .where(isNull(schema.users.id));

      expect(orphanActors).toHaveLength(0);
    });
  }
  describe('activity_log on install (ROK-1116)', () =>
    describeActivityLogOnInstall());

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
}
describe('Demo Data (integration)', () => describeDemoData());
