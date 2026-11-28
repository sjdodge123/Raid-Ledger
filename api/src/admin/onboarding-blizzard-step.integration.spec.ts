/**
 * ROK-2361 #9 — GET /admin/onboarding/status: saved Blizzard keys mark
 * `steps.connectPlugins` done only while the `blizzard` plugin is active.
 * Keys left behind after the plugin is switched off must not count — the core
 * onboarding treats Blizzard as hidden while its plugin is inactive.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

const SLUG = 'blizzard';
const BLIZZARD_KEYS = [
  SETTING_KEYS.BLIZZARD_CLIENT_ID,
  SETTING_KEYS.BLIZZARD_CLIENT_SECRET,
] as const;

let testApp: TestApp;
let adminToken: string;
let settings: SettingsService;
let registry: PluginRegistryService;

async function setActive(active: boolean): Promise<void> {
  await registry.ensureInstalled(SLUG);
  await registry.activate(SLUG);
  if (!active) await registry.deactivate(SLUG);
}

async function saveBlizzardKeys(): Promise<void> {
  await settings.set(SETTING_KEYS.BLIZZARD_CLIENT_ID, 'rok-2361-id');
  await settings.set(SETTING_KEYS.BLIZZARD_CLIENT_SECRET, 'rok-2361-secret');
}

async function connectPluginsStep(): Promise<unknown> {
  const res = await testApp.request
    .get('/admin/onboarding/status')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const body = res.body as { steps: Record<string, unknown> };
  return body.steps.connectPlugins;
}

beforeAll(async () => {
  testApp = await getTestApp();
  settings = testApp.app.get(SettingsService);
  registry = testApp.app.get(PluginRegistryService);
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  for (const key of BLIZZARD_KEYS) await settings.delete(key);
  await setActive(true);
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-2361 #9 — onboarding steps.connectPlugins and the blizzard plugin', () => {
  it('counts saved Blizzard keys while the plugin is active', async () => {
    await setActive(true);
    // Precondition: nothing else (IGDB, Discord OAuth) already marks the step.
    expect(await connectPluginsStep()).toBe(false);

    await saveBlizzardKeys();
    expect(await connectPluginsStep()).toBe(true);
  });

  it('ignores Blizzard keys left behind while the plugin is inactive', async () => {
    await setActive(true);
    await saveBlizzardKeys();
    expect(await connectPluginsStep()).toBe(true);

    await setActive(false);
    // The keys survive deactivation, so only the plugin gate can flip the step.
    expect(await settings.isBlizzardConfigured()).toBe(true);
    expect(await connectPluginsStep()).toBe(false);
  });
});
