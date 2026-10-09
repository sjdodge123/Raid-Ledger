/**
 * ROK-1727: WoW: Forever gear on the public character detail
 * (`GET /characters/:id`) against a real database. The LedgerLink `char`
 * snapshot is the source of truth (R1); `characters.equipment` and
 * `last_synced_at` are never written; newest wins against Armory data;
 * unknown item ids are enqueued fire-and-forget; other variants unchanged.
 */
import { eq } from 'drizzle-orm';
import type { CharacterEquipmentDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { WowItemMetaService } from '../plugins/wow-common/wowhead-item/wow-item-meta.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const CAPTURED_AT = new Date('2026-09-15T12:00:00.000Z');

/** char-normal.json fixture gear: 19019 main hand, 16921 head. */
const SNAPSHOT_DATA = {
  gear: [
    { slot: 16, itemId: 19019, ilvl: 80, bonusIds: [6646, 7890] },
    { slot: 1, itemId: 16921, ilvl: 76, bonusIds: [] },
  ],
  talents: { configId: 7, nodes: [{ nodeId: 101, rank: 2 }] },
  lockouts: [],
};

const ARMORY_EQUIPMENT = (syncedAt: string): CharacterEquipmentDto => ({
  equippedItemLevel: 70,
  syncedAt,
  items: [
    {
      slot: 'HEAD',
      name: 'Armory Helm',
      itemId: 11111,
      quality: 'EPIC',
      itemLevel: 70,
      itemSubclass: null,
      enchantments: [],
      sockets: [],
    },
  ],
});

async function ensureGame(testApp: TestApp, slug: string): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug })
      .returning(),
    slug,
  );
  return game.id;
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

describe('Forever addon equipment on GET /characters/:id (integration)', () => {
  let testApp: TestApp;
  let enqueue: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    await activateBlizzard(testApp);
    const meta = testApp.app.get(WowItemMetaService);
    enqueue = jest.spyOn(meta, 'enqueue').mockResolvedValue(0);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function seedCharacter(opts: {
    slug: string;
    gameVariant?: string | null;
    equipment?: CharacterEquipmentDto | null;
  }): Promise<string> {
    const gameId = await ensureGame(testApp, opts.slug);
    const [row] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId,
          name: 'Ana Forever',
          region: 'us',
          gameVariant: opts.gameVariant ?? null,
          equipment: opts.equipment ?? null,
        })
        .returning(),
      'character',
    );
    return row.id;
  }

  async function seedSnapshot(characterId: string): Promise<void> {
    await testApp.db.insert(schema.characterAddonSnapshots).values({
      characterId,
      section: 'char',
      schema: 1,
      data: SNAPSHOT_DATA,
      capturedAt: CAPTURED_AT,
      payloadSha256: 'a'.repeat(64),
    });
  }

  async function seedResolvedMeta(): Promise<void> {
    await testApp.db.insert(schema.wowItemMeta).values({
      itemId: 19019,
      status: 'resolved',
      env: 16,
      name: 'Thunderfury, Blessed Blade of the Windseeker',
      quality: 5,
      icon: 'inv_sword_39',
      fetchedAt: new Date(),
    });
  }

  const get = (id: string) => testApp.request.get(`/characters/${id}`);

  it('renders the snapshot gear with resolved + placeholder items and leaves the row untouched', async () => {
    const id = await seedCharacter({ slug: FOREVER_SLUG });
    await seedSnapshot(id);
    await seedResolvedMeta();

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(res.body.lastSyncedAt).toBeNull();
    const equipment = res.body.equipment as CharacterEquipmentDto;
    expect(equipment).toMatchObject({
      source: 'addon',
      syncedAt: CAPTURED_AT.toISOString(),
    });
    expect(equipment.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: 'MAIN_HAND',
          itemId: 19019,
          name: 'Thunderfury, Blessed Blade of the Windseeker',
          quality: 'LEGENDARY',
          wowheadEnv: 16,
          resolved: true,
        }),
        expect.objectContaining({
          slot: 'HEAD',
          itemId: 16921,
          name: 'Item #16921',
          resolved: false,
        }),
      ]),
    );
    const [stored] = await testApp.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    expect(stored?.equipment).toBeNull();
    expect(stored?.lastSyncedAt).toBeNull();
  });

  it('enqueues the unknown item id (not the resolved one) without blocking the read', async () => {
    const id = await seedCharacter({ slug: FOREVER_SLUG });
    await seedSnapshot(id);
    await seedResolvedMeta();

    expect((await get(id)).status).toBe(200);

    await waitFor(() => {
      expect(enqueue).toHaveBeenCalledWith([16921]);
      return Promise.resolve();
    });
  });

  it('newest wins: an older Armory sync shows the addon gear', async () => {
    const id = await seedCharacter({
      slug: FOREVER_SLUG,
      gameVariant: 'wow_forever',
      equipment: ARMORY_EQUIPMENT('2026-09-01T00:00:00.000Z'),
    });
    await seedSnapshot(id);

    const res = await get(id);

    expect(res.body.equipment.source).toBe('addon');
    expect(res.body.equipment.syncedAt).toBe(CAPTURED_AT.toISOString());
  });

  it('newest wins: a newer Armory sync keeps the Armory gear', async () => {
    const armory = ARMORY_EQUIPMENT('2026-09-20T00:00:00.000Z');
    const id = await seedCharacter({
      slug: FOREVER_SLUG,
      gameVariant: 'wow_forever',
      equipment: armory,
    });
    await seedSnapshot(id);

    const res = await get(id);

    expect(res.body.equipment).toEqual(armory);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('a Classic character keeps its stored equipment even with a snapshot row', async () => {
    const armory = ARMORY_EQUIPMENT('2026-09-01T00:00:00.000Z');
    const id = await seedCharacter({
      slug: 'world-of-warcraft-classic',
      gameVariant: 'classic_era',
      equipment: armory,
    });
    await seedSnapshot(id);

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(res.body.equipment).toEqual(armory);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a Forever character without a snapshot keeps today's output", async () => {
    const id = await seedCharacter({ slug: FOREVER_SLUG });

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(res.body.equipment).toBeNull();
  });
});
