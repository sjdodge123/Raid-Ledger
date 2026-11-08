/**
 * ROK-1722 — WoW: Forever Armory import, refresh and auto-sync against a real
 * database, with Blizzard `fetch` stubbed at the global seam using the
 * invented fixtures in `plugins/wow-common/testing/fixtures/blizzard-forever/`.
 */
import { readFileSync } from 'node:fs';
import type { AddonCharSnapshotData } from '@raid-ledger/contract';
import { join } from 'node:path';
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { CharacterProfessionsSchema } from '@raid-ledger/contract';
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
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../plugins/wow-common/forever.settings';
import { CharactersService } from './characters.service';
import { ArmoryQuestsSchema } from '../plugins/wow-common/blizzard-quests.helpers';

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
  [`${CHAR}/specializations${NS}`]: 'specializations.json',
  [`${CHAR}/quests/completed${NS}`]: 'quests-completed.json',
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
      name: 'Ana Forever',
      realm: null,
      ruleset: 'pvp',
      gameVariant: 'wow_forever',
      externalId: '900001',
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

  it('Main ticked on a merge promotes the row and demotes the old main', async () => {
    const { token } = await memberToken('forevermainmerge');
    const create = (name: string) =>
      testApp.request
        .post('/users/me/characters')
        .set('Authorization', `Bearer ${token}`)
        .send({ gameId, name, region: 'us', ruleset: 'normal', class: 'Mage' });
    const oldMain = await create('Bea Forever');
    expect(oldMain.status).toBe(201);
    expect(oldMain.body.isMain).toBe(true);
    const alt = await create('ana forever');
    expect(alt.status).toBe(201);
    expect(alt.body.isMain).toBe(false);

    const res = await importAs(token, { ...importBody, isMain: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: alt.body.id, isMain: true });
    const byId = new Map((await foreverRows()).map((r) => [r.id, r.isMain]));
    expect(byId.get(String(alt.body.id))).toBe(true);
    expect(byId.get(String(oldMain.body.id))).toBe(false);
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

describe('Forever Armory refresh + auto-sync (ROK-1722)', () => {
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

describe('Forever Armory kill switch off (ROK-1722)', () => {
  const OFF = 'Armory import for WoW: Forever is turned off';
  const settings = () => testApp.app.get(SettingsService);
  const switchOff = () =>
    settings().set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'false');

  afterEach(async () => {
    await settings().delete(WOW_FOREVER_ARMORY_IMPORT_KEY);
  });

  it('403s preview and import, and stores nothing', async () => {
    const { token } = await memberToken('foreverswitchoff');
    await switchOff();
    const preview = await testApp.request
      .get('/blizzard/character-preview')
      .query({ name: 'Ana Forever', region: 'us', gameVariant: 'wow_forever' })
      .set('Authorization', `Bearer ${token}`);
    expect(preview.status).toBe(403);
    expect(preview.body.message).toBe(OFF);
    const res = await importAs(token);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(OFF);
    expect(await foreverRows()).toHaveLength(0);
  });

  it('403s a refresh and leaves Forever rows out of the nightly sync', async () => {
    const { token } = await memberToken('foreverswitchsync');
    const imported = await importAs(token);
    expect(imported.status).toBe(201);
    const id = imported.body.id as string;
    await testApp.db
      .update(schema.characters)
      .set({ level: 1, lastSyncedAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(schema.characters.id, id));
    await switchOff();
    const refresh = await testApp.request
      .post(`/users/me/characters/${id}/refresh`)
      .set('Authorization', `Bearer ${token}`)
      .send({ region: 'us', gameVariant: 'wow_forever' });
    expect(refresh.status).toBe(403);
    expect(refresh.body.message).toBe(OFF);
    const fetchProfile = jest.spyOn(
      testApp.app.get(BlizzardService),
      'fetchCharacterProfile',
    );
    const result = await testApp.app.get(CharactersService).syncAllCharacters();
    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(fetchProfile).not.toHaveBeenCalled();
    const [row] = await testApp.db
      .select({ level: schema.characters.level })
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(row?.level).toBe(1);
  });
});

describe('Forever professions provenance (ROK-2107)', () => {
  it('a hand-entered profession survives a refresh; Blizzard lands in armory_professions and wins (ROK-2107 AC3, ruling F0)', async () => {
    const { token } = await memberToken('foreverprofs');
    const id = await importAndAge(token);
    const manual = {
      primary: [
        {
          id: 165,
          name: 'Leatherworking',
          slug: 'leatherworking',
          skillLevel: 60,
          maxSkillLevel: 75,
          tiers: [],
        },
      ],
      secondary: [],
      syncedAt: '2026-11-01T00:00:00.000Z',
    };
    const patch = await testApp.request
      .patch(`/users/me/characters/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ professions: manual });
    expect(patch.status).toBe(200);
    const res = await testApp.request
      .post(`/users/me/characters/${id}/refresh`)
      .set('Authorization', `Bearer ${token}`)
      .send({ region: 'us', gameVariant: 'wow_forever' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      professionsSource: 'blizzard',
      hasManualProfessions: true,
    });
    const shown = CharacterProfessionsSchema.parse(res.body.professions);
    expect(shown.primary.map((p) => p.name)).toEqual(['Tailoring']);
    const [row] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.id, id)),
      'refreshed row',
    );
    expect(row.professions).toEqual(manual);
    const armory = CharacterProfessionsSchema.parse(row.armoryProfessions);
    expect(armory.primary.map((p) => p.name)).toEqual(['Tailoring']);
    expect(armory.secondary.map((p) => p.name)).toEqual(['Cooking']);
  });
});

describe('Forever Blizzard talents on the character page (ROK-2110)', () => {
  it('GET /characters/:id renders the stored Blizzard talents as the Forever DTO', async () => {
    const { token } = await memberToken('forevertalents');
    const created = await importAs(token);
    expect(created.status).toBe(201);
    const res = await testApp.request
      .get(`/characters/${String(created.body.id)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.talents).toMatchObject({
      format: 'forever',
      source: 'blizzard',
      layout: 'grid',
      trees: [
        { index: 0, spent: 8, name: 'Arms' },
        { index: 1, spent: 2, name: 'Fury' },
      ],
    });
  });
});

const SYNCED = new Date('2026-06-01T00:00:00.000Z');
const ADDON: AddonCharSnapshotData = {
  gear: [],
  lockouts: [],
  talents: { nodes: [{ nodeId: 9001, rank: 2, name: 'Addon Talent' }] },
};

/** An imported Forever character with a pinned sync time and a `char` snapshot captured at `capturedAt`. */
async function seedWithSnapshot(username: string, capturedAt: Date) {
  const { token } = await memberToken(username);
  const created = await importAs(token);
  expect(created.status).toBe(201);
  const id = String(created.body.id);
  await testApp.db
    .update(schema.characters)
    .set({ lastSyncedAt: SYNCED })
    .where(eq(schema.characters.id, id));
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId: id,
    section: 'char',
    schema: 2,
    data: ADDON,
    capturedAt,
    payloadSha256: 'c'.repeat(64),
  });
  return testApp.request
    .get(`/characters/${id}`)
    .set('Authorization', `Bearer ${token}`);
}

describe('Forever talents source against the real snapshot query (ROK-2110 D4, ROK-2138)', () => {
  it('Blizzard primary (ROK-2138): an addon capture newer than the sync still serves the Blizzard nodes', async () => {
    const captured = new Date('2026-07-01T00:00:00.000Z');
    const res = await seedWithSnapshot('forevernewestaddon', captured);
    expect(res.status).toBe(200);
    expect(res.body.talents).toMatchObject({
      format: 'forever',
      source: 'blizzard',
      syncedAt: SYNCED.toISOString(),
    });
    expect(res.body.talents.nodes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ nodeId: 9001 })]),
    );
  });

  it('a Blizzard sync newer than the capture serves the Blizzard nodes', async () => {
    const res = await seedWithSnapshot(
      'forevernewestblizz',
      new Date('2026-05-01T00:00:00.000Z'),
    );
    expect(res.status).toBe(200);
    expect(res.body.talents).toMatchObject({
      format: 'forever',
      source: 'blizzard',
      syncedAt: SYNCED.toISOString(),
    });
    const nodes: unknown[] = res.body.talents.nodes;
    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 124,
          rank: 3,
          name: 'Improved Heroic Strike',
          tree: 0,
          row: 0,
          col: 0,
        }),
      ]),
    );
    expect(nodes).not.toContainEqual(expect.objectContaining({ nodeId: 9001 }));
  });
});

describe('Forever Armory quests (ROK-2109)', () => {
  it('a refresh writes quests/completed ids to armory_quests and leaves the addon snapshots alone (AC4)', async () => {
    const { token } = await memberToken('foreverquests');
    const id = await importAndAge(token);
    await testApp.db
      .update(schema.characters)
      .set({ armoryQuests: null })
      .where(eq(schema.characters.id, id));
    const res = await testApp.request
      .post(`/users/me/characters/${id}/refresh`)
      .set('Authorization', `Bearer ${token}`)
      .send({ region: 'us', gameVariant: 'wow_forever' });
    expect(res.status).toBe(201);
    const [row] = nonEmpty(
      await testApp.db
        .select({ armoryQuests: schema.characters.armoryQuests })
        .from(schema.characters)
        .where(eq(schema.characters.id, id)),
      'refreshed row',
    );
    const stored = ArmoryQuestsSchema.parse(row.armoryQuests);
    expect(stored.completed).toEqual([7001, 7002, 7003, 7004, 7005]);
    expect(stored).not.toHaveProperty('completedTruncated');
    expect(JSON.stringify(row.armoryQuests)).not.toContain('Invented Quest');
    const snapshots = await testApp.db
      .select({ id: schema.characterAddonSnapshots.id })
      .from(schema.characterAddonSnapshots)
      .where(eq(schema.characterAddonSnapshots.characterId, id));
    expect(snapshots).toEqual([]);
  });
});
