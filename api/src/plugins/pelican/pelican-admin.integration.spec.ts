/**
 * ROK-121 — Pelican admin config + connection test against a real database:
 * `GET|PUT /admin/plugins/pelican/config`, `POST /admin/plugins/pelican/test`.
 * Write-only client key, URL normalisation, validation, guards, and the
 * uninstall path (rows deleted AND the SettingsService cache evicted).
 *
 * No test talks to a real Pelican panel: the network case points the client at
 * a localhost port that was just closed, and the other codes resolve before
 * any request is made.
 */
import * as net from 'node:net';
import * as bcrypt from 'bcrypt';
import { inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import {
  PELICAN_INTEGRATION_KEY,
  PELICAN_PLUGIN_ID,
} from './pelican.constants';
import { PELICAN_SETTING_KEYS } from './pelican.manifest';
import { PelicanModule } from './pelican.module';

const CONFIG_ROUTE = '/admin/plugins/pelican/config';
const TEST_ROUTE = '/admin/plugins/pelican/test';
/** Fake client key — a fixture, never a real credential. */
const FAKE_CLIENT_KEY = 'pacc_integrationFixtureNotARealKey0001';
const FAKE_APPLICATION_KEY = 'papp_integrationFixtureNotARealKey0002';

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const settings = () => testApp.app.get(SettingsService);

async function memberToken(username: string): Promise<string> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return res.body.access_token as string;
}

const getConfig = (token = adminToken) =>
  testApp.request.get(CONFIG_ROUTE).set('Authorization', `Bearer ${token}`);

const putConfig = (body: Record<string, unknown>, token = adminToken) =>
  testApp.request
    .put(CONFIG_ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const postTest = (token = adminToken) =>
  testApp.request.post(TEST_ROUTE).set('Authorization', `Bearer ${token}`);

const pluginAction = (action: string) =>
  testApp.request
    .post(`/admin/plugins/${PELICAN_PLUGIN_ID}/${action}`)
    .set('Authorization', `Bearer ${adminToken}`);

async function pelicanSettingRows(): Promise<string[]> {
  const rows = await testApp.db
    .select({ key: schema.appSettings.key })
    .from(schema.appSettings)
    .where(inArray(schema.appSettings.key, [...PELICAN_SETTING_KEYS]));
  return rows.map((r) => r.key);
}

/** A localhost port with nothing listening (bound, then closed). */
async function closedLocalPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') {
    throw new Error('closedLocalPort: expected an AddressInfo');
  }
  return address.port;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  // Pelican is never auto-installed and truncateAllTables may wipe `plugins`.
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  // Restore the pre-file state (Pelican NOT installed) inside the spec's own
  // lifecycle — the shared integration-setup afterAll closes the DB before a
  // file-level afterAll would run. Deactivating first drops 'pelican' from the
  // registry's in-memory active set; the truncate then deletes its plugins and
  // settings rows, so no later file depends on this one having run.
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  settings().invalidateCache(true);
});

describe('GET /admin/plugins/pelican/config (ROK-121)', () => {
  it('reports an unconfigured panel with the UTC fallback timezone', async () => {
    const res = await getConfig();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      panelUrl: null,
      apiKeySet: false,
      defaultTimezone: 'UTC',
      timezoneInherited: true,
    });
  });

  it('inherits the community default timezone when none is stored', async () => {
    await settings().set(SETTING_KEYS.DEFAULT_TIMEZONE, 'America/Chicago');
    const res = await getConfig();
    expect(res.body).toMatchObject({
      defaultTimezone: 'America/Chicago',
      timezoneInherited: true,
    });
  });
});

describe('GET /admin/plugins Pelican integration status (ROK-121 AC2)', () => {
  type ListedIntegration = { key: string; configured: boolean };
  async function pelicanIntegrations(): Promise<ListedIntegration[]> {
    const list = await testApp.request
      .get('/admin/plugins')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const listed = list.body.data as {
      slug: string;
      integrations: ListedIntegration[];
    }[];
    const pelican = listed.find((p) => p.slug === PELICAN_PLUGIN_ID);
    if (!pelican) throw new Error('pelican missing from GET /admin/plugins');
    return pelican.integrations;
  }
  const configured = async () =>
    (await pelicanIntegrations()).find(
      (i) => i.key === PELICAN_INTEGRATION_KEY,
    );

  it('stays Not Configured until both the URL and the key are saved', async () => {
    expect((await configured())?.configured).toBe(false);

    const urlOnly = await putConfig({ panelUrl: 'https://panel.example.com' });
    expect(urlOnly.status).toBe(200);
    expect((await configured())?.configured).toBe(false);

    const withKey = await putConfig({ apiKey: FAKE_CLIENT_KEY });
    expect(withKey.status).toBe(200);
    expect((await configured())?.configured).toBe(true);
  });
});

describe('PUT /admin/plugins/pelican/config (ROK-121)', () => {
  it('stores the key write-only and normalises the URL', async () => {
    const saved = await putConfig({
      panelUrl: '  https://panel.example.com/sub/  ',
      apiKey: FAKE_CLIENT_KEY,
      defaultTimezone: 'Europe/Berlin',
    });
    expect(saved.status).toBe(200);
    const expected = {
      panelUrl: 'https://panel.example.com/sub',
      apiKeySet: true,
      defaultTimezone: 'Europe/Berlin',
      timezoneInherited: false,
    };
    expect(saved.body).toEqual(expected);
    expect(JSON.stringify(saved.body)).not.toContain(FAKE_CLIENT_KEY);

    const res = await getConfig();
    expect(res.body).toEqual(expected);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_CLIENT_KEY);
    expect(res.text).not.toContain('pacc_');
  });

  it('leaves omitted fields unchanged', async () => {
    await putConfig({
      panelUrl: 'https://panel.example.com',
      apiKey: FAKE_CLIENT_KEY,
    });
    const res = await putConfig({ defaultTimezone: 'Asia/Tokyo' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      panelUrl: 'https://panel.example.com',
      apiKeySet: true,
      defaultTimezone: 'Asia/Tokyo',
      timezoneInherited: false,
    });
  });

  it("clears every field when sent ''", async () => {
    await putConfig({
      panelUrl: 'https://panel.example.com',
      apiKey: FAKE_CLIENT_KEY,
      defaultTimezone: 'Asia/Tokyo',
    });
    const res = await putConfig({
      panelUrl: '',
      apiKey: '',
      defaultTimezone: '',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      panelUrl: null,
      apiKeySet: false,
      defaultTimezone: 'UTC',
      timezoneInherited: true,
    });
    expect(await pelicanSettingRows()).toEqual([]);
  });
});

describe('PUT /admin/plugins/pelican/config validation (ROK-121)', () => {
  it.each([
    ['a non-http(s) scheme', { panelUrl: 'ftp://panel.example.com' }],
    [
      'credentials in the URL',
      { panelUrl: 'https://admin:hunter2@panel.example.com' },
    ],
    ['a query string', { panelUrl: 'https://panel.example.com/?x=1' }],
    ['not a URL', { panelUrl: 'panel.example.com' }],
    ['an unknown timezone', { defaultTimezone: 'Mars/Olympus_Mons' }],
    ['an unknown field', { apiKeyValue: FAKE_CLIENT_KEY }],
  ])('rejects %s with 400 and stores nothing', async (_label, body) => {
    const res = await putConfig(body);
    expect(res.status).toBe(400);
    expect(await pelicanSettingRows()).toEqual([]);
    const cfg = await getConfig();
    expect(cfg.body).toMatchObject({ panelUrl: null, apiKeySet: false });
  });
});

describe('POST /admin/plugins/pelican/test (ROK-121)', () => {
  it('returns not_configured before a URL and key are saved', async () => {
    await putConfig({ panelUrl: 'https://panel.example.com' });
    const res = await postTest();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      code: 'not_configured',
      message: 'Save a panel URL and client API key first.',
    });
  });

  it('returns network for a panel nobody is listening on', async () => {
    const port = await closedLocalPort();
    await putConfig({
      panelUrl: `http://127.0.0.1:${port}`,
      apiKey: FAKE_CLIENT_KEY,
    });
    const res = await postTest();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      code: 'network',
      message: `Could not reach the panel at 127.0.0.1:${port}.`,
    });
    expect(res.text).not.toContain(FAKE_CLIENT_KEY);
  });

  it('returns application_key for a papp_ key without calling the panel', async () => {
    // Port 9 (discard) is never contacted: the prefix check runs first.
    await putConfig({
      panelUrl: 'http://127.0.0.1:9',
      apiKey: FAKE_APPLICATION_KEY,
    });
    const res = await postTest();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: false,
      code: 'application_key',
    });
    expect(res.text).not.toContain(FAKE_APPLICATION_KEY);
  });
});

describe('/admin/plugins/pelican guards (ROK-121)', () => {
  it('rejects unauthenticated requests with 401 on every route', async () => {
    const results = await Promise.all([
      testApp.request.get(CONFIG_ROUTE),
      testApp.request.put(CONFIG_ROUTE).send({ apiKey: FAKE_CLIENT_KEY }),
      testApp.request.post(TEST_ROUTE),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401]);
  });

  it('rejects a non-admin member with 403 on every route', async () => {
    const token = await memberToken('pelicanmember');
    const results = [
      await getConfig(token),
      await putConfig({ apiKey: FAKE_CLIENT_KEY }, token),
      await postTest(token),
    ];
    expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(await pelicanSettingRows()).toEqual([]);
  });

  it('rejects every route with 403 while the plugin is deactivated', async () => {
    expect((await pluginAction('deactivate')).status).toBe(200);
    const results = [
      await getConfig(),
      await putConfig({ apiKey: FAKE_CLIENT_KEY }),
      await postTest(),
    ];
    expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
    expect(await pelicanSettingRows()).toEqual([]);
  });
});

describe('Pelican uninstall (ROK-121)', () => {
  async function configureThenUninstall(): Promise<void> {
    const saved = await putConfig({
      panelUrl: 'https://panel.example.com',
      apiKey: FAKE_CLIENT_KEY,
      defaultTimezone: 'Europe/Berlin',
    });
    expect(saved.body).toMatchObject({ apiKeySet: true });
    expect((await pluginAction('deactivate')).status).toBe(200);
    expect((await pluginAction('uninstall')).status).toBe(200);
  }

  it('deletes the settings rows and evicts the cached key', async () => {
    await configureThenUninstall();
    expect(await pelicanSettingRows()).toEqual([]);
    // The eviction listener is fire-and-forget; wait for the cache to drop.
    await waitFor(async () => {
      expect(
        await settings().get(SETTING_KEYS.PELICAN_CLIENT_API_KEY),
      ).toBeNull();
    });

    expect((await pluginAction('install')).status).toBe(200);
    const res = await getConfig();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      panelUrl: null,
      apiKeySet: false,
      defaultTimezone: 'UTC',
      timezoneInherited: true,
    });
  });

  it('stays uninstalled when the Pelican module re-initialises', async () => {
    await configureThenUninstall();
    const mod = testApp.app.get(PelicanModule);
    mod.onModuleInit(); // the boot path: registers the manifest only
    mod.onModuleDestroy(); // drop the duplicate listener it just added

    const list = await testApp.request
      .get('/admin/plugins')
      .set('Authorization', `Bearer ${adminToken}`);
    const pelican = (list.body.data as { slug: string; status: string }[]).find(
      (p) => p.slug === PELICAN_PLUGIN_ID,
    );
    expect(pelican?.status).toBe('not_installed');
    expect((await getConfig()).status).toBe(403);
  });
});
