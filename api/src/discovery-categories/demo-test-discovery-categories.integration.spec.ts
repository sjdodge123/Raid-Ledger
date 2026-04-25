/**
 * Integration test for the DEMO_MODE-only seed / clear endpoints used by the
 * ROK-567 smoke fixtures. Drives the HTTP layer against a real Postgres.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

describe('DemoTestDiscoveryCategoriesController (ROK-567)', () => {
  let testApp: TestApp;
  let adminToken: string;
  const originalDemoEnv = process.env.DEMO_MODE;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    process.env.DEMO_MODE = originalDemoEnv;
  });

  async function enableDemoMode(): Promise<void> {
    process.env.DEMO_MODE = 'true';
    const settings = testApp.app.get(SettingsService);
    await settings.setDemoMode(true);
  }

  it('seeds a pending suggestion and returns its id', async () => {
    await enableDemoMode();
    const res = await testApp.request
      .post('/admin/test/seed-discovery-categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Smoke Fixture', candidateGameIds: [1, 2, 3] });
    expect(res.status).toBe(200);
    const body = res.body as { id: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await testApp.db
      .select()
      .from(schema.discoveryCategorySuggestions);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Smoke Fixture');
    expect(rows[0].candidateGameIds).toEqual([1, 2, 3]);
  });

  it('rejects seed calls when DEMO_MODE is off with 403', async () => {
    process.env.DEMO_MODE = 'false';
    const res = await testApp.request
      .post('/admin/test/seed-discovery-categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('clears the discovery_category_suggestions table', async () => {
    await enableDemoMode();
    await testApp.db.insert(schema.discoveryCategorySuggestions).values({
      name: 'X',
      description: 'y',
      categoryType: 'trend',
      themeVector: [0, 0, 0, 0, 0, 0, 0],
      status: 'pending',
      populationStrategy: 'vector',
    });
    const res = await testApp.request
      .post('/admin/test/clear-discovery-categories')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = await testApp.db
      .select()
      .from(schema.discoveryCategorySuggestions);
    expect(rows).toEqual([]);
  });
});
