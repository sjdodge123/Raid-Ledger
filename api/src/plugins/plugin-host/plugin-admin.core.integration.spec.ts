/**
 * ROK-1969 I1–I3 — the built-in Core plugin over the admin plugin routes:
 * it refuses deactivate/uninstall (400, row untouched) and `GET
 * /admin/plugins` lists it as built in, active, with its hub declaration.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from './plugin-registry.service';

interface ListedPlugin {
  slug: string;
  builtIn: boolean;
  status: string;
  hub: { widgets: { id: string }[]; tabs: { id: string }[] };
}

describe('Core plugin admin routes (ROK-1969, integration)', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(async () => {
    // The row the boot-time ensureInstalled creates (a truncate removes it).
    await testApp.app.get(PluginRegistryService).ensureInstalled('core');
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  async function coreRow(): Promise<(typeof schema.plugins.$inferSelect)[]> {
    return testApp.db
      .select()
      .from(schema.plugins)
      .where(eq(schema.plugins.slug, 'core'));
  }

  it('I1: deactivating Core is a 400 and the row stays active', async () => {
    const res = await testApp.request
      .post('/admin/plugins/core/deactivate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Plugin "core" is built in and cannot be deactivated',
    );
    expect((await coreRow()).map((r) => r.active)).toEqual([true]);
    expect(testApp.app.get(PluginRegistryService).isActive('core')).toBe(true);
  });

  it('I2: uninstalling Core is a 400 and the row remains', async () => {
    const res = await testApp.request
      .post('/admin/plugins/core/uninstall')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Plugin "core" is built in and cannot be uninstalled',
    );
    expect((await coreRow()).map((r) => r.active)).toEqual([true]);
  });

  it('I3: GET /admin/plugins lists Core built in + active with its hub', async () => {
    const res = await testApp.request
      .get('/admin/plugins')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const list = res.body.data as ListedPlugin[];
    const core = list.find((p) => p.slug === 'core');
    expect(core).toMatchObject({ builtIn: true, status: 'active' });
    expect(core?.hub.widgets.map((w) => w.id)).toContain('gallery');
    const valheim = list.find((p) => p.slug === 'valheim');
    expect(valheim?.builtIn).toBe(false);
    expect(valheim?.hub.tabs.map((t) => t.id)).toEqual([
      'characters',
      'map',
      'materials',
      'planner',
    ]);
  });
});
