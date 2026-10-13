/**
 * ROK-1094 — POST /admin/test/pelican/seed-servers (integration, real DB).
 * The DEMO_MODE fixture the fleet UI test plan seeds before each run: four
 * admin-table rows, a fake unreachable connection, and reset on re-run.
 * (403 without DEMO_MODE is the shared DemoModeGuard's own spec.)
 */
import { PelicanServerListResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../plugins/pelican/pelican.constants';
import {
  DEMO_PELICAN_API_KEY,
  DEMO_PELICAN_PANEL_URL,
  type PelicanSeedResult,
} from './demo-test-pelican.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/pelican/seed-servers';

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);

async function enableDemoMode(): Promise<void> {
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
}

async function seed(): Promise<PelicanSeedResult> {
  const res = await testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.text).not.toContain(DEMO_PELICAN_API_KEY);
  return res.body as PelicanSeedResult;
}

async function adminGet(path: string) {
  const res = await testApp.request
    .get(path)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res;
}

/** The admin table as the web panel sees it, keyed by row id. */
async function adminRows() {
  const res = await adminGet('/admin/plugins/pelican/servers');
  const body = PelicanServerListResponseSchema.parse(res.body);
  return new Map(body.data.map((r) => [r.id, r]));
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/pelican/seed-servers (ROK-1094)', () => {
  it('activates Pelican with a fake connection and seeds the four table states', async () => {
    const seeded = await seed();
    expect(registry().isActive(PELICAN_PLUGIN_ID)).toBe(true);
    const config = await adminGet('/admin/plugins/pelican/config');
    expect(config.body).toMatchObject({
      panelUrl: DEMO_PELICAN_PANEL_URL,
      apiKeySet: true,
    });
    expect(config.text).not.toContain(DEMO_PELICAN_API_KEY);

    expect(seeded.gameId).toBeGreaterThan(0);
    expect(seeded.servers.map((s) => s.kind)).toEqual([
      'running_mapped',
      'offline_unmapped',
      'unknown_hidden',
      'missing',
    ]);
    const rows = await adminRows();
    const view = seeded.servers.map((s) => {
      const r = rows.get(s.id);
      if (!r) throw new Error(`seeded row ${s.id} missing from GET servers`);
      return [s.kind, r.state, r.gameId, r.showOnCalendar, r.missing];
    });
    expect(view).toEqual([
      ['running_mapped', 'running', seeded.gameId, true, false],
      ['offline_unmapped', 'offline', null, true, false],
      ['unknown_hidden', 'unknown', seeded.gameId, false, false],
      ['missing', 'unknown', null, true, true],
    ]);
    expect(rows.size).toBe(4);
  });

  it('is idempotent: a re-run wipes edits and leaves exactly four fresh rows', async () => {
    const first = await seed();
    const unmapped = first.servers.find((s) => s.kind === 'offline_unmapped');
    if (!unmapped) throw new Error('first seed: no offline_unmapped row');
    const edit = await testApp.request
      .patch(`/admin/plugins/pelican/servers/${unmapped.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: first.gameId });
    expect(edit.status).toBe(200);

    const second = await seed();
    const stored = await testApp.db.select().from(schema.pelicanServers);
    expect(stored).toHaveLength(4);
    expect(stored.map((r) => r.id).sort()).toEqual(
      second.servers.map((s) => s.id).sort(),
    );
    const firstIds = new Set(first.servers.map((s) => s.id));
    expect(second.servers.filter((s) => firstIds.has(s.id))).toEqual([]);
    const reset = second.servers.find((s) => s.kind === 'offline_unmapped');
    expect(stored.find((r) => r.id === reset?.id)?.gameId).toBeNull();
    expect(second.gameId).toBe(first.gameId);
  });
});
