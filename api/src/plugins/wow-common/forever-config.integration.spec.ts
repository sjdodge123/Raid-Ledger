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
import {
  WOW_FOREVER_ARMORY_IMPORT_KEY,
  WOW_FOREVER_NAMESPACE_PREFIX_KEY,
  WOW_FOREVER_QUEST_IMPORT_KEY,
} from './forever.settings';
import { DungeonQuestsService } from './dungeon-quests.service';

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
  it('reports Forever Armory import on by default (ROK-1722)', async () => {
    const res = await testApp.request.get('/blizzard/capabilities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ armoryImport: { wow_forever: true } });
  });

  it('reports it off after an admin flips the kill switch, and on again after re-enabling', async () => {
    const saved = await put(adminToken, {
      namespacePrefix: 'foo',
      armoryImportEnabled: false,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      namespacePrefix: 'foo',
      namespacePrefixIsDefault: false,
      armoryImportEnabled: false,
      wowheadResolverEnabled: true,
      questImportEnabled: true,
    });
    const flagRows = () =>
      testApp.db
        .select({ key: schema.appSettings.key })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, WOW_FOREVER_ARMORY_IMPORT_KEY));
    // The kill switch is the only stored state; on-by-default stores nothing.
    expect(await flagRows()).toHaveLength(1);

    const off = await testApp.request.get('/blizzard/capabilities');
    expect(off.body).toEqual({ armoryImport: { wow_forever: false } });
    expect(getForeverNamespacePrefix()).toBe('foo');

    await put(adminToken, {
      namespacePrefix: 'foo',
      armoryImportEnabled: true,
    });
    const on = await testApp.request.get('/blizzard/capabilities');
    expect(on.body).toEqual({ armoryImport: { wow_forever: true } });
    expect(await flagRows()).toHaveLength(0);
  });
});

describe('PUT /admin/plugins/blizzard/forever quest import switch (ROK-2143)', () => {
  it('turning it off stores "false" and drops the quest cache; on again deletes the key', async () => {
    const clearCache = jest.spyOn(
      testApp.app.get(DungeonQuestsService),
      'clearCache',
    );
    try {
      const base = { namespacePrefix: 'forever', armoryImportEnabled: true };
      const off = await put(adminToken, { ...base, questImportEnabled: false });
      expect(off.status).toBe(200);
      expect(off.body.questImportEnabled).toBe(false);
      const rows = () =>
        testApp.db
          .select({ key: schema.appSettings.key })
          .from(schema.appSettings)
          .where(eq(schema.appSettings.key, WOW_FOREVER_QUEST_IMPORT_KEY));
      expect(await rows()).toHaveLength(1);
      expect(clearCache).toHaveBeenCalledTimes(1);

      const on = await put(adminToken, { ...base, questImportEnabled: true });
      expect(on.body.questImportEnabled).toBe(true);
      expect(await rows()).toHaveLength(0);
      expect(clearCache).toHaveBeenCalledTimes(2);
    } finally {
      clearCache.mockRestore();
    }
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
      namespacePrefix: 'forever',
      namespacePrefixIsDefault: true,
      armoryImportEnabled: true,
      wowheadResolverEnabled: true,
      questImportEnabled: true,
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
