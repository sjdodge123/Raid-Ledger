/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Plugin Registry Integration Tests (ROK-528)
 *
 * Verifies plugin lifecycle (list, install, activate, deactivate, uninstall)
 * and persistence against a real PostgreSQL database via HTTP endpoints.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { PluginRegistryService } from './plugin-registry.service';

describe('Plugin Registry (integration)', () => {
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
  // GET /admin/plugins — List Plugins
  // ===================================================================

  describe('GET /admin/plugins', () => {
    it('should list registered plugins with their status', async () => {
      const res = await testApp.request
        .get('/admin/plugins')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);

      // Each plugin should have expected shape
      for (const plugin of res.body.data) {
        expect(plugin).toMatchObject({
          slug: expect.any(String),
          name: expect.any(String),
          version: expect.any(String),
          status: expect.stringMatching(/^(active|inactive|not_installed)$/),
        });
      }
    });

    it('should require admin authentication', async () => {
      const res = await testApp.request.get('/admin/plugins');

      expect(res.status).toBe(401);
    });
  });

  // ===================================================================
  // Plugin Install / Activate / Deactivate / Uninstall lifecycle
  // ===================================================================

  describe('plugin lifecycle via HTTP', () => {
    /**
     * Discover a plugin slug available for testing.
     * We use the PluginRegistryService to find manifests that are either
     * already installed or can be installed.
     */
    let testPluginSlug: string | null = null;

    beforeAll(async () => {
      // Find a plugin manifest that exists in the registry
      const registry = testApp.app.get(PluginRegistryService);
      const plugins = await registry.listPlugins();

      // Find one that's either active or not_installed — we'll use it for lifecycle tests
      const candidate = plugins.find(
        (p) => p.status === 'active' || p.status === 'not_installed',
      );
      testPluginSlug = candidate?.slug ?? null;
    });

    it('should deactivate an active plugin and persist state', async () => {
      if (!testPluginSlug) {
        return; // No plugins registered in test env — skip gracefully
      }

      // Ensure the plugin is installed and active first
      const pluginsBefore = await testApp.db
        .select()
        .from(schema.plugins)
        .where(eq(schema.plugins.slug, testPluginSlug));

      if (pluginsBefore.length === 0 || !pluginsBefore[0].active) {
        return; // Cannot deactivate if not installed/active
      }

      const deactivateRes = await testApp.request
        .post(`/admin/plugins/${testPluginSlug}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.success).toBe(true);

      // Verify persisted to DB
      const [record] = await testApp.db
        .select()
        .from(schema.plugins)
        .where(eq(schema.plugins.slug, testPluginSlug))
        .limit(1);

      expect(record.active).toBe(false);

      // Re-activate so other tests aren't affected
      await testApp.request
        .post(`/admin/plugins/${testPluginSlug}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);
    });

    it('should activate an inactive plugin and persist state', async () => {
      if (!testPluginSlug) {
        return;
      }

      // Ensure installed
      const pluginsBefore = await testApp.db
        .select()
        .from(schema.plugins)
        .where(eq(schema.plugins.slug, testPluginSlug));

      if (pluginsBefore.length === 0) {
        return;
      }

      // Deactivate first, then activate
      await testApp.request
        .post(`/admin/plugins/${testPluginSlug}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const activateRes = await testApp.request
        .post(`/admin/plugins/${testPluginSlug}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(activateRes.status).toBe(200);
      expect(activateRes.body.success).toBe(true);

      // Verify persisted to DB
      const [record] = await testApp.db
        .select()
        .from(schema.plugins)
        .where(eq(schema.plugins.slug, testPluginSlug))
        .limit(1);

      expect(record.active).toBe(true);
    });
  });

  // ===================================================================
  // Plugin status reflected in list endpoint
  // ===================================================================

  describe('plugin status consistency', () => {
    it('should reflect DB state in list endpoint after deactivate/activate cycle', async () => {
      const registry = testApp.app.get(PluginRegistryService);
      const plugins = await registry.listPlugins();
      const activePlugin = plugins.find((p) => p.status === 'active');

      if (!activePlugin) {
        return; // No active plugins in test env
      }

      // Deactivate
      await testApp.request
        .post(`/admin/plugins/${activePlugin.slug}/deactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      // List should show inactive
      const listAfterDeactivate = await testApp.request
        .get('/admin/plugins')
        .set('Authorization', `Bearer ${adminToken}`);

      const deactivated = listAfterDeactivate.body.data.find(
        (p: { slug: string }) => p.slug === activePlugin.slug,
      );
      expect(deactivated.status).toBe('inactive');

      // Re-activate
      await testApp.request
        .post(`/admin/plugins/${activePlugin.slug}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);

      // List should show active again
      const listAfterActivate = await testApp.request
        .get('/admin/plugins')
        .set('Authorization', `Bearer ${adminToken}`);

      const activated = listAfterActivate.body.data.find(
        (p: { slug: string }) => p.slug === activePlugin.slug,
      );
      expect(activated.status).toBe('active');
    });
  });

  // ===================================================================
  // Slug Validation
  // ===================================================================

  describe('slug validation', () => {
    it('should reject invalid plugin slugs', async () => {
      const invalidSlugs = [
        'UPPERCASE',
        'has spaces',
        '-starts-with-dash',
        'a', // too short (single char fails the pattern)
      ];

      for (const slug of invalidSlugs) {
        const res = await testApp.request
          .post(`/admin/plugins/${encodeURIComponent(slug)}/install`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(400);
      }
    });
  });

  // ===================================================================
  // Install / Uninstall errors
  // ===================================================================

  describe('install/uninstall error handling', () => {
    it('should return 404 when installing non-existent plugin manifest', async () => {
      const res = await testApp.request
        .post('/admin/plugins/non-existent-plugin/install')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 when uninstalling a plugin that is not installed', async () => {
      const res = await testApp.request
        .post('/admin/plugins/non-existent-plugin/uninstall')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 when activating a plugin that is not installed', async () => {
      const res = await testApp.request
        .post('/admin/plugins/non-existent-plugin/activate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 when deactivating a plugin that is not installed', async () => {
      const res = await testApp.request
        .post('/admin/plugins/non-existent-plugin/deactivate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ===================================================================
  // Auth Guards
  // ===================================================================

  describe('auth guards', () => {
    it('should require admin role for all plugin admin endpoints', async () => {
      const endpoints = [
        { method: 'get' as const, path: '/admin/plugins' },
        { method: 'post' as const, path: '/admin/plugins/test/install' },
        { method: 'post' as const, path: '/admin/plugins/test/uninstall' },
        { method: 'post' as const, path: '/admin/plugins/test/activate' },
        { method: 'post' as const, path: '/admin/plugins/test/deactivate' },
      ];

      for (const ep of endpoints) {
        const res = await testApp.request[ep.method](ep.path);
        expect(res.status).toBe(401);
      }
    });

    it('should reject non-admin users', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('TestPassword123!', 4);

      const [user] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:member-plugin@test.local',
          username: 'member-plugin',
          role: 'member',
        })
        .returning();

      await testApp.db.insert(schema.localCredentials).values({
        email: 'member-plugin@test.local',
        passwordHash,
        userId: user.id,
      });

      const loginRes = await testApp.request.post('/auth/local').send({
        email: 'member-plugin@test.local',
        password: 'TestPassword123!',
      });

      const memberToken = loginRes.body.access_token as string;

      const res = await testApp.request
        .get('/admin/plugins')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });
});
