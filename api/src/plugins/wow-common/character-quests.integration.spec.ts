/**
 * ROK-1745: `GET /plugins/wow/characters/:id/quests` against a real database,
 * without a JWT (public like the character page, D3). The LedgerLink `char`
 * snapshot's `quests` slice is intersected with the known dungeon quests; the
 * raw completed-id list never reaches the response. Hidden cases return 200
 * with `{ quests: null }`.
 */
import { eq } from 'drizzle-orm';
import { CharacterQuestsResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

const CAPTURED_AT = new Date('2026-10-01T12:00:00.000Z');
/** Completed ids: two known classic quests, one tbc (not Forever) and one unknown. */
const COMPLETED = [5001, 5002, 6001, 92460];
const QUESTS = {
  completed: COMPLETED,
  inProgress: [
    {
      questId: 92472,
      title: 'Into the Depths',
      objectives: [{ text: 'Slay oozes', done: false, have: 3, need: 8 }],
    },
    // Real LedgerLink log entries carry no instance id; the API resolves it.
    { questId: 5002, title: 'VC Quest' },
  ],
};
const BASE_DATA = { gear: [], talents: { nodes: [] }, lockouts: [] };

async function ensureGame(testApp: TestApp, slug: string): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const rows = await testApp.db
    .insert(schema.games)
    .values({ name: slug, slug })
    .returning();
  return nonEmpty(rows, slug)[0].id;
}

async function activateBlizzard(testApp: TestApp): Promise<void> {
  const registry = testApp.app.get(PluginRegistryService);
  const manifest = registry.getManifest('blizzard');
  await testApp.db
    .insert(schema.plugins)
    .values({
      slug: 'blizzard',
      name: manifest?.name ?? 'blizzard',
      version: manifest?.version ?? '0.0.0',
      active: true,
    })
    .onConflictDoUpdate({
      target: schema.plugins.slug,
      set: { active: true, updatedAt: new Date() },
    });
  await registry.onModuleInit();
}

async function seedKnownQuests(testApp: TestApp): Promise<void> {
  await testApp.db.insert(schema.wowClassicDungeonQuests).values([
    {
      questId: 5001,
      dungeonInstanceId: 226,
      name: 'RFC Quest',
      expansion: 'classic',
      questLevel: 15,
    },
    {
      questId: 5002,
      dungeonInstanceId: 63,
      name: 'VC Quest',
      expansion: 'classic',
      questLevel: 20,
    },
    {
      questId: 6001,
      dungeonInstanceId: 63,
      name: 'Outland Quest',
      expansion: 'tbc',
      questLevel: 62,
    },
  ]);
}

describe('GET /plugins/wow/characters/:id/quests (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  beforeEach(async () => {
    await activateBlizzard(testApp);
    await seedKnownQuests(testApp);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedCharacter(slug: string): Promise<string> {
    const gameId = await ensureGame(testApp, slug);
    const rows = await testApp.db
      .insert(schema.characters)
      .values({
        userId: testApp.seed.adminUser.id,
        gameId,
        name: 'Quest Forever',
        region: 'us',
      })
      .returning();
    return nonEmpty(rows, 'character')[0].id;
  }

  async function seedSnapshot(
    characterId: string,
    version: number,
    data: Record<string, unknown>,
  ): Promise<void> {
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId,
      section: 'char',
      schema: version,
      data: data as typeof schema.characterAddonSnapshots.$inferInsert.data,
      capturedAt: CAPTURED_AT,
      payloadSha256: 'b'.repeat(64),
    });
  }

  const get = (id: string) =>
    testApp.request.get(`/plugins/wow/characters/${id}/quests`);

  it('returns the joined quest DTO for a Forever snapshot with quests', async () => {
    const id = await seedCharacter(WOW_FOREVER_GAME_SLUG);
    await seedSnapshot(id, 2, { ...BASE_DATA, quests: QUESTS });
    const res = await get(id);
    expect(res.status).toBe(200);
    const body = CharacterQuestsResponseSchema.parse(res.body).quests;
    expect(body).not.toBeNull();
    expect(body?.syncedAt).toBe(CAPTURED_AT.toISOString());
    expect(body?.counts).toEqual({
      completedKnown: 2,
      knownTotal: 2,
      completedTotal: 4,
      inProgress: 2,
    });
    expect(body?.completedKnown.map((g) => g.instanceName).sort()).toEqual([
      'Deadmines',
      'Ragefire Chasm',
    ]);
    expect(body?.inProgress[0]?.objectives[0]).toMatchObject({
      have: 3,
      need: 8,
    });
    expect(body?.inProgress[1]).toMatchObject({
      dungeonInstanceId: 63,
      instanceName: 'Deadmines',
    });
  });

  /** ROK-2109: write the Armory column the Forever sync owns. */
  async function setArmory(id: string, fetchedAt: Date, completed: number[]) {
    await testApp.db
      .update(schema.characters)
      .set({ armoryQuests: { fetchedAt: fetchedAt.toISOString(), completed } })
      .where(eq(schema.characters.id, id));
  }

  const HOUR = 3600_000;
  const ADDON_ONE = { ...QUESTS, completed: [5001] };

  it('AC9: a newer Armory list wins the completed list; the addon log stays', async () => {
    const id = await seedCharacter(WOW_FOREVER_GAME_SLUG);
    await seedSnapshot(id, 2, { ...BASE_DATA, quests: ADDON_ONE });
    const later = new Date(CAPTURED_AT.getTime() + HOUR);
    await setArmory(id, later, [5001, 5002]);
    const body = CharacterQuestsResponseSchema.parse(
      (await get(id)).body,
    ).quests;
    expect(body?.source).toBe('blizzard');
    expect(body?.syncedAt).toBe(later.toISOString());
    expect(body?.inProgressSyncedAt).toBe(CAPTURED_AT.toISOString());
    expect(body?.counts.completedKnown).toBe(2);
    expect(body?.inProgress.map((q) => q.questId)).toEqual([92472, 5002]);
  });

  it('AC9: a newer addon snapshot wins; the older Armory id is not counted', async () => {
    const id = await seedCharacter(WOW_FOREVER_GAME_SLUG);
    await seedSnapshot(id, 2, { ...BASE_DATA, quests: ADDON_ONE });
    await setArmory(id, new Date(CAPTURED_AT.getTime() - HOUR), [5001, 5002]);
    const body = CharacterQuestsResponseSchema.parse(
      (await get(id)).body,
    ).quests;
    expect(body?.source).toBe('addon');
    expect(body?.syncedAt).toBe(CAPTURED_AT.toISOString());
    expect(body?.counts.completedKnown).toBe(1);
    expect(body?.inProgress.map((q) => q.questId)).toEqual([92472, 5002]);
  });

  it('shows the section for an Armory-only Forever character (ROK-2109)', async () => {
    const id = await seedCharacter(WOW_FOREVER_GAME_SLUG);
    await setArmory(id, CAPTURED_AT, [5001, 5002]);
    const body = CharacterQuestsResponseSchema.parse(
      (await get(id)).body,
    ).quests;
    expect(body?.source).toBe('blizzard');
    expect(body?.inProgressSyncedAt).toBeNull();
    expect(body?.inProgress).toEqual([]);
    expect(body?.counts.completedKnown).toBe(2);
  });

  it('never returns the raw completed id array', async () => {
    const id = await seedCharacter(WOW_FOREVER_GAME_SLUG);
    await seedSnapshot(id, 2, { ...BASE_DATA, quests: QUESTS });
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('92460');
    expect(res.text).not.toContain('6001');
    expect(res.text).not.toContain(JSON.stringify(COMPLETED));
  });

  it('returns 200 with quests: null for a schema-1 snapshot without quests', async () => {
    const id = await seedCharacter(WOW_FOREVER_GAME_SLUG);
    await seedSnapshot(id, 1, BASE_DATA);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quests: null });
  });

  it('returns 200 with quests: null when the Forever character has no snapshot', async () => {
    const id = await seedCharacter(WOW_FOREVER_GAME_SLUG);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quests: null });
  });

  it('returns 200 with quests: null for a non-Forever character', async () => {
    const id = await seedCharacter('world-of-warcraft-classic');
    await seedSnapshot(id, 2, { ...BASE_DATA, quests: QUESTS });
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quests: null });
  });

  it('returns 404 for an unknown character id', async () => {
    const res = await get('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-uuid id', async () => {
    const res = await get('not-a-uuid');
    expect(res.status).toBe(400);
  });
});
