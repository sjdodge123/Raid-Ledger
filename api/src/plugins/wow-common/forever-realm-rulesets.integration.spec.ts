/**
 * ROK-1739 — the admin WoW: Forever realm → ruleset map against a real
 * database: `GET|PUT /admin/plugins/blizzard/forever/realm-rulesets`
 * (admin-only, whole-list replace, 400 on an invalid list) persisted as one
 * plugin-owned setting, with or without Blizzard API credentials.
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
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { WOW_FOREVER_REALM_RULESETS_KEY } from './forever.settings';

const ROUTE = '/admin/plugins/blizzard/forever/realm-rulesets';

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

const get = (token: string) =>
  testApp.request.get(ROUTE).set('Authorization', `Bearer ${token}`);
const put = (token: string, body: unknown) =>
  testApp.request
    .put(ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);

async function storedRow() {
  return testApp.db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, WOW_FOREVER_REALM_RULESETS_KEY));
}

const SEEDED = {
  entries: [{ region: 'us', realmName: 'Skyfall', ruleset: 'normal' }],
};

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
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('GET|PUT /admin/plugins/blizzard/forever/realm-rulesets (ROK-1739)', () => {
  it('I1: returns no rows when nothing is stored', async () => {
    const res = await get(adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [] });
  });

  it('I2: round-trips a saved map (Hardcore included) sorted, across a cache reload', async () => {
    const saved = await put(adminToken, {
      entries: [
        { region: 'us', realmName: 'Skyfall', ruleset: 'normal' },
        { region: 'us', realmName: 'Last Stand', ruleset: 'hardcore' },
        { region: 'eu', realmName: 'Frostmane', ruleset: 'pvp' },
        { region: 'us', realmName: ' bloodmoon ', ruleset: 'pvp' },
      ],
    });
    const sorted = {
      entries: [
        { region: 'eu', realmName: 'Frostmane', ruleset: 'pvp' },
        { region: 'us', realmName: 'bloodmoon', ruleset: 'pvp' },
        { region: 'us', realmName: 'Last Stand', ruleset: 'hardcore' },
        { region: 'us', realmName: 'Skyfall', ruleset: 'normal' },
      ],
    };
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(sorted);
    testApp.app.get(SettingsService).invalidateCache(true);
    const res = await get(adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sorted);
  });

  it('I3: rejects a duplicate realm in a region with 400 naming the row, keeping the stored map', async () => {
    expect((await put(adminToken, SEEDED)).status).toBe(200);
    const res = await put(adminToken, {
      entries: [
        { region: 'us', realmName: 'Bloodmoon', ruleset: 'pvp' },
        { region: 'us', realmName: '  BLOODMOON ', ruleset: 'normal' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual([
      'entries.1.realmName: Duplicate realm for this region',
    ]);
    expect((await get(adminToken)).body).toEqual(SEEDED);
  });
});

describe('realm-rulesets guards and limits (ROK-1739)', () => {
  it('I4: rejects a non-admin with 403 on GET and PUT', async () => {
    const token = await memberToken('realmplayer');
    expect((await get(token)).status).toBe(403);
    expect((await put(token, SEEDED)).status).toBe(403);
    expect(await storedRow()).toHaveLength(0);
  });

  it('I5: accepts 500 rows and rejects 501 with 400', async () => {
    const rows = (n: number) => ({
      entries: Array.from({ length: n }, (_, i) => ({
        region: 'us',
        realmName: `Realm ${i}`,
        ruleset: 'normal',
      })),
    });
    const tooMany = await put(adminToken, rows(501));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toEqual([expect.stringMatching(/^entries: /)]);
    expect(await storedRow()).toHaveLength(0);
    const ok = await put(adminToken, rows(500));
    expect(ok.status).toBe(200);
    expect(ok.body.entries).toHaveLength(500);
  });

  it('I6: saving an empty list deletes the setting row', async () => {
    expect((await put(adminToken, SEEDED)).status).toBe(200);
    expect(await storedRow()).toHaveLength(1);
    const res = await put(adminToken, { entries: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entries: [] });
    expect(await storedRow()).toHaveLength(0);
  });

  it('I7: works with no Blizzard API credentials configured', async () => {
    const settings = testApp.app.get(SettingsService);
    await settings.delete(SETTING_KEYS.BLIZZARD_CLIENT_ID);
    await settings.delete(SETTING_KEYS.BLIZZARD_CLIENT_SECRET);
    expect(await settings.get(SETTING_KEYS.BLIZZARD_CLIENT_ID)).toBeNull();
    expect((await put(adminToken, SEEDED)).status).toBe(200);
    const res = await get(adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SEEDED);
  });
});
