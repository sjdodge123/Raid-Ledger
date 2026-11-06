/**
 * ROK-1722 — WoW: Forever Armory import, refresh and auto-sync against a real
 * database, with Blizzard `fetch` stubbed at the global seam using the
 * invented fixtures in `plugins/wow-common/testing/fixtures/blizzard-forever/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { BlizzardService } from '../plugins/wow-common/blizzard.service';
import {
  FOREVER_NAMESPACE_ALIAS,
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from '../plugins/wow-common/forever-namespace.resolver';
import { CharactersService } from './characters.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const FIXTURES = join(
  __dirname,
  '..',
  'plugins',
  'wow-common',
  'testing',
  'fixtures',
  'blizzard-forever',
);
const CHAR = 'https://us.api.blizzard.com/profile/wow/character/ana-forever';
const NS = '?namespace=profile-forever-us&locale=en_US';
const ROUTES: Record<string, string> = {
  [`${CHAR}${NS}`]: 'profile.json',
  [`${CHAR}/character-media${NS}`]: 'media.json',
  [`${CHAR}/equipment${NS}`]: 'equipment.json',
  [`${CHAR}/professions${NS}`]: 'professions.json',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });
const fixture = (file: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));

let testApp: TestApp;
let gameId: number;
let profileStatus: number;
let previousPrefix: string;

function stubBlizzard(): void {
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('battle.net/oauth/token'))
        return Promise.resolve(json({ access_token: 't', expires_in: 3600 }));
      if (url === `${CHAR}${NS}` && profileStatus !== 200)
        return Promise.resolve(json({}, profileStatus));
      const file = ROUTES[url];
      return Promise.resolve(file ? json(fixture(file)) : json({}, 404));
    });
}

/** The Forever game with the namespace alias the import resolves it by. */
async function ensureForeverGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG))
    .limit(1);
  if (existing) {
    await testApp.db
      .update(schema.games)
      .set({ apiNamespacePrefix: FOREVER_NAMESPACE_ALIAS })
      .where(eq(schema.games.id, existing.id));
    return existing.id;
  }
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name: 'World of Warcraft: Forever',
        slug: FOREVER_SLUG,
        apiNamespacePrefix: FOREVER_NAMESPACE_ALIAS,
      })
      .returning(),
    'forever game',
  );
  return game.id;
}

async function memberToken(
  username: string,
): Promise<{ userId: number; token: string }> {
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
  return { userId: user.id, token: res.body.access_token as string };
}

const importBody = {
  name: 'Ana Forever',
  region: 'us',
  gameVariant: 'wow_forever',
  ruleset: 'pvp',
};
const importAs = (token: string, body: Record<string, unknown> = importBody) =>
  testApp.request
    .post('/users/me/characters/import/wow')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const foreverRows = () =>
  testApp.db
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.gameId, gameId),
        eq(schema.characters.region, 'us'),
      ),
    );

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  profileStatus = 200;
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  gameId = await ensureForeverGame();
  stubBlizzard();
  await testApp.app
    .get(SettingsService)
    .setBlizzardConfig({ clientId: 'cid', clientSecret: 'secret' });
  previousPrefix = getForeverNamespacePrefix();
  setForeverNamespacePrefix('forever');
});

afterEach(async () => {
  setForeverNamespacePrefix(previousPrefix);
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('Forever Armory import (ROK-1722)', () => {
  it('creates a realmless, Armory-linked row from the Battle.net profile', async () => {
    const { userId, token } = await memberToken('foreverimport');
    const res = await importAs(token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Ana Forever',
      realm: null,
      region: 'us',
      ruleset: 'pvp',
      gameVariant: 'wow_forever',
      class: 'Mage',
      level: 24,
    });
    const rows = await foreverRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      realm: null,
      ruleset: 'pvp',
      gameVariant: 'wow_forever',
    });
  });

  it("merges into the player's own manual row instead of duplicating it", async () => {
    const { token } = await memberToken('forevermerge');
    const manual = await testApp.request
      .post('/users/me/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        gameId,
        name: 'ana forever',
        region: 'us',
        ruleset: 'normal',
        class: 'Paladin',
        role: 'healer',
      });
    expect(manual.status).toBe(201);
    expect(manual.body.gameVariant).toBeNull();

    const res = await importAs(token);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(manual.body.id);
    const rows = await foreverRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: manual.body.id,
      ruleset: 'pvp',
      gameVariant: 'wow_forever',
      class: 'Mage',
    });
  });

  it("409s when another player's row holds the region + name", async () => {
    const a = await memberToken('foreverowner');
    const b = await memberToken('foreverthief');
    expect((await importAs(a.token)).status).toBe(201);
    const res = await importAs(b.token);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'Ana Forever (US) is already claimed by another player',
    );
    const rows = await foreverRows();
    expect(rows.map((r) => r.userId)).toEqual([a.userId]);
  });

  it('turns a Blizzard 403 into a 502 and stores nothing', async () => {
    profileStatus = 403;
    const { token } = await memberToken('forever403');
    const res = await importAs(token);
    expect(res.status).toBe(502);
    expect(await foreverRows()).toHaveLength(0);
  });

  it('turns a Blizzard 404 into a 404 with the "not visible yet" copy', async () => {
    profileStatus = 404;
    const { token } = await memberToken('forever404');
    const res = await importAs(token);
    expect(res.status).toBe(404);
    expect(res.body.message).toContain("isn't visible on Battle.net yet (US)");
    expect(await foreverRows()).toHaveLength(0);
  });
});

describe('Forever Armory refresh + auto-sync (ROK-1722)', () => {
  /** Import, then age the row so the refresh cooldown and the level change show. */
  async function importAndAge(token: string): Promise<string> {
    const res = await importAs(token);
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    await testApp.db
      .update(schema.characters)
      .set({ level: 1, lastSyncedAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(schema.characters.id, id));
    return id;
  }

  it('refresh re-reads the realmless profile and updates the row', async () => {
    const { token } = await memberToken('foreverrefresh');
    const id = await importAndAge(token);
    const res = await testApp.request
      .post(`/users/me/characters/${id}/refresh`)
      .set('Authorization', `Bearer ${token}`)
      .send({ region: 'us', gameVariant: 'wow_forever' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id, realm: null, level: 24 });
    const [row] = await testApp.db
      .select({ level: schema.characters.level })
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(row?.level).toBe(24);
  });

  it('syncAllCharacters syncs the imported row and skips a manual one', async () => {
    const { token } = await memberToken('foreversyncer');
    const id = await importAndAge(token);
    const other = await memberToken('forevermanual');
    await testApp.db.insert(schema.characters).values({
      userId: other.userId,
      gameId,
      name: 'Bo Tester',
      realm: null,
      region: 'us',
      ruleset: 'normal',
      gameVariant: null,
      isMain: true,
    });
    const fetchProfile = jest.spyOn(
      testApp.app.get(BlizzardService),
      'fetchCharacterProfile',
    );
    const result = await testApp.app.get(CharactersService).syncAllCharacters();
    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(fetchProfile.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['Ana Forever', null, 'us'],
    ]);
    const [row] = await testApp.db
      .select({ level: schema.characters.level })
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(row?.level).toBe(24);
  });
});
