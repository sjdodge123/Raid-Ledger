/**
 * ROK-1717 — WoW: Forever runtime config against a real database:
 * `PUT|GET /admin/plugins/blizzard/forever` (admin-only, 400 on a bad prefix)
 * and the public `GET /blizzard/capabilities` flag, plus persistence across a
 * SettingsService cache reload (the boot path).
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { ForeverConfigService } from './forever-config.service';
import {
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';
import { WOW_FOREVER_NAMESPACE_PREFIX_KEY } from './forever.settings';

const ADMIN_ROUTE = '/admin/plugins/blizzard/forever';

let testApp: TestApp;
let adminToken: string;

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

const put = (token: string, body: Record<string, unknown>) =>
  testApp.request
    .put(ADMIN_ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  // truncateAllTables may wipe `plugins`; re-install, then activate.
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  setForeverNamespacePrefix(null);
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('GET /blizzard/capabilities (ROK-1717)', () => {
  it('reports Forever Armory import off by default', async () => {
    const res = await testApp.request.get('/blizzard/capabilities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ armoryImport: { wow_forever: false } });
  });

  it('reports it on after an admin enables it', async () => {
    const saved = await put(adminToken, {
      namespacePrefix: 'foo',
      armoryImportEnabled: true,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      namespacePrefix: 'foo',
      namespacePrefixIsDefault: false,
      armoryImportEnabled: true,
    });

    const res = await testApp.request.get('/blizzard/capabilities');
    expect(res.body).toEqual({ armoryImport: { wow_forever: true } });
    expect(getForeverNamespacePrefix()).toBe('foo');
  });
});

describe('/admin/plugins/blizzard/forever guards (ROK-1717)', () => {
  it('rejects a non-admin with 403 on GET and PUT', async () => {
    const token = await memberToken('foreverplayer');
    const get = await testApp.request
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(403);
    const res = await put(token, {
      namespacePrefix: 'foo',
      armoryImportEnabled: true,
    });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid prefix with 400 and keeps the default', async () => {
    const res = await put(adminToken, {
      namespacePrefix: 'profile-foo-us&x=1',
      armoryImportEnabled: true,
    });
    expect(res.status).toBe(400);
    const cfg = await testApp.request
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(cfg.body).toEqual({
      namespacePrefix: 'classicforever',
      namespacePrefixIsDefault: true,
      armoryImportEnabled: false,
    });
  });
});

describe('Forever config persistence (ROK-1717)', () => {
  it('survives a SettingsService cache reload and re-seeds the resolver', async () => {
    await put(adminToken, {
      namespacePrefix: 'foo',
      armoryImportEnabled: true,
    });
    const rows = await testApp.db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, WOW_FOREVER_NAMESPACE_PREFIX_KEY));
    expect(rows).toHaveLength(1);

    testApp.app.get(SettingsService).invalidateCache(true);
    setForeverNamespacePrefix(null);
    await testApp.app.get(ForeverConfigService).onModuleInit();

    expect(getForeverNamespacePrefix()).toBe('foo');
    const cfg = await testApp.request
      .get(ADMIN_ROUTE)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(cfg.body).toMatchObject({ namespacePrefix: 'foo' });
  });
});
