/**
 * Boss Encounters Integration Tests (ROK-569)
 *
 * Verifies boss encounter queries (variant-aware expansion filtering,
 * sub-instance resolution) and loot table queries against a real
 * PostgreSQL database via HTTP endpoints.
 *
 * The blizzard plugin auto-installs on app boot, so the PluginActiveGuard
 * allows these endpoints without manual activation.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { defined } from '../../common/testing/narrow';

/** Insert a boss encounter directly and return the row. */
async function insertBoss(
  testApp: TestApp,
  overrides: Partial<typeof schema.wowClassicBosses.$inferInsert> & {
    instanceId: number;
    name: string;
    order: number;
    expansion: string;
  },
): Promise<typeof schema.wowClassicBosses.$inferSelect> {
  const [boss] = await testApp.db
    .insert(schema.wowClassicBosses)
    .values({
      sodModified: false,
      ...overrides,
    })
    .returning();
  return defined(boss, 'inserted boss');
}

/** Insert a loot item for a boss and return the row. */
async function insertLoot(
  testApp: TestApp,
  overrides: Partial<typeof schema.wowClassicBossLoot.$inferInsert> & {
    bossId: number;
    itemId: number;
    itemName: string;
    quality: string;
    expansion: string;
  },
): Promise<typeof schema.wowClassicBossLoot.$inferSelect> {
  const [loot] = await testApp.db
    .insert(schema.wowClassicBossLoot)
    .values(overrides)
    .returning();
  return defined(loot, 'inserted loot');
}

let testApp: TestApp;

async function testBossesFilteredByClassicEra() {
  const instanceId = 100;
  await insertBoss(testApp, {
    instanceId,
    name: 'Lucifron',
    order: 1,
    expansion: 'classic',
  });
  await insertBoss(testApp, {
    instanceId,
    name: 'TBC Boss',
    order: 2,
    expansion: 'tbc',
  });

  const res = await testApp.request.get(
    `/plugins/wow-classic/instances/${instanceId}/bosses?variant=classic_era`,
  );

  expect(res.status).toBe(200);
  expect(res.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'Lucifron', expansion: 'classic' }),
    ]),
  );
  const names = (res.body as Array<{ name: string }>).map((b) => b.name);
  expect(names).not.toContain('TBC Boss');
}

async function testBossesClassicAnniversaryIncludesTbc() {
  const instanceId = 101;
  await insertBoss(testApp, {
    instanceId,
    name: 'Classic Boss',
    order: 1,
    expansion: 'classic',
  });
  await insertBoss(testApp, {
    instanceId,
    name: 'TBC Boss',
    order: 2,
    expansion: 'tbc',
  });

  const res = await testApp.request.get(
    `/plugins/wow-classic/instances/${instanceId}/bosses?variant=classic_anniversary`,
  );

  expect(res.status).toBe(200);
  const names = (res.body as Array<{ name: string }>).map((b) => b.name);
  expect(names).toContain('Classic Boss');
  expect(names).toContain('TBC Boss');
}

async function testSubInstanceResolution() {
  const parentId = 316;
  await insertBoss(testApp, {
    instanceId: parentId,
    name: 'Herod',
    order: 1,
    expansion: 'classic',
  });
  await insertBoss(testApp, {
    instanceId: parentId,
    name: 'Arcanist Doan',
    order: 2,
    expansion: 'classic',
  });

  const res = await testApp.request.get(
    '/plugins/wow-classic/instances/31603/bosses?variant=classic_era',
  );

  expect(res.status).toBe(200);
  const names = (res.body as Array<{ name: string }>).map((b) => b.name);
  expect(names).toContain('Herod');
  expect(names).not.toContain('Arcanist Doan');
}

async function testLootFilteredByVariant() {
  const boss = await insertBoss(testApp, {
    instanceId: 200,
    name: 'Test Boss',
    order: 1,
    expansion: 'classic',
  });
  await insertLoot(testApp, {
    bossId: boss.id,
    itemId: 5001,
    itemName: 'Classic Sword',
    quality: 'Rare',
    expansion: 'classic',
  });
  await insertLoot(testApp, {
    bossId: boss.id,
    itemId: 5002,
    itemName: 'TBC Sword',
    quality: 'Epic',
    expansion: 'tbc',
  });

  const res = await testApp.request.get(
    `/plugins/wow-classic/bosses/${boss.id}/loot?variant=classic_era`,
  );

  expect(res.status).toBe(200);
  const itemNames = (res.body as Array<{ itemName: string }>).map(
    (l) => l.itemName,
  );
  expect(itemNames).toContain('Classic Sword');
  expect(itemNames).not.toContain('TBC Sword');
}

async function testLootClassicAnniversaryIncludesTbc() {
  const boss = await insertBoss(testApp, {
    instanceId: 201,
    name: 'Multi-Expansion Boss',
    order: 1,
    expansion: 'classic',
  });
  await insertLoot(testApp, {
    bossId: boss.id,
    itemId: 6001,
    itemName: 'Classic Ring',
    quality: 'Uncommon',
    expansion: 'classic',
  });
  await insertLoot(testApp, {
    bossId: boss.id,
    itemId: 6002,
    itemName: 'TBC Ring',
    quality: 'Rare',
    expansion: 'tbc',
  });

  const res = await testApp.request.get(
    `/plugins/wow-classic/bosses/${boss.id}/loot?variant=classic_anniversary`,
  );

  expect(res.status).toBe(200);
  const itemNames = (res.body as Array<{ itemName: string }>).map(
    (l) => l.itemName,
  );
  expect(itemNames).toContain('Classic Ring');
  expect(itemNames).toContain('TBC Ring');
}

/** GET a boss's loot under `variant` and return the item names. */
async function lootNames(bossId: number, variant: string): Promise<string[]> {
  const res = await testApp.request.get(
    `/plugins/wow-classic/bosses/${bossId}/loot?variant=${variant}`,
  );
  expect(res.status).toBe(200);
  return (res.body as Array<{ itemName: string }>).map((l) => l.itemName);
}

/**
 * ROK-2170: Forever's own loot replaces the classic table, per boss.
 * ROK-2209: on a Forever catalogue instance (63 = Deadmines).
 */
async function testForeverLootReplacesClassic() {
  const boss = await insertBoss(testApp, {
    instanceId: 63,
    name: 'Edwin VanCleef',
    order: 1,
    expansion: 'classic',
  });
  await insertLoot(testApp, {
    bossId: boss.id,
    itemId: 7001,
    itemName: 'Classic Cloak',
    quality: 'Rare',
    expansion: 'classic',
  });
  await insertLoot(testApp, {
    bossId: boss.id,
    itemId: 7002,
    itemName: 'Forever Cloak',
    quality: 'Rare',
    expansion: 'forever',
  });
  expect(await lootNames(boss.id, 'wow_forever')).toEqual(['Forever Cloak']);
  expect(await lootNames(boss.id, 'classic_era')).toEqual(['Classic Cloak']);
}

/**
 * ROK-2209 regression: a boss with only Classic loot (240 = Wailing Caverns,
 * no Forever loot captured) reads as [] for a Forever guild — never the
 * Classic table — while a Classic Era guild still sees it.
 */
async function testForeverNeverFallsBackToClassic() {
  const boss = await insertBoss(testApp, {
    instanceId: 240,
    name: 'Lord Cobrahn',
    order: 1,
    expansion: 'classic',
  });
  await insertLoot(testApp, {
    bossId: boss.id,
    itemId: 7101,
    itemName: 'Classic Serpent Gloves',
    quality: 'Rare',
    expansion: 'classic',
  });
  expect(await lootNames(boss.id, 'wow_forever')).toEqual([]);
  expect(await lootNames(boss.id, 'classic_era')).toEqual([
    'Classic Serpent Gloves',
  ]);
}

describe('Boss Encounters (integration)', () => {
  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  describe('GET /plugins/wow-classic/instances/:id/bosses', () => {
    it('should return bosses filtered by classic_era variant', () =>
      testBossesFilteredByClassicEra());

    it('should include tbc bosses for classic_anniversary variant', () =>
      testBossesClassicAnniversaryIncludesTbc());

    it('should resolve sub-instance IDs to parent and filter by wing', () =>
      testSubInstanceResolution());

    it('should return empty array for instance with no bosses', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/instances/99999/bosses?variant=classic_era',
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return 400 for invalid variant', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/instances/100/bosses?variant=invalid_variant',
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /plugins/wow-classic/bosses/:id/loot', () => {
    it('should return loot for a boss filtered by variant', () =>
      testLootFilteredByVariant());

    it('should include tbc loot for classic_anniversary variant', () =>
      testLootClassicAnniversaryIncludesTbc());

    it('returns only forever loot under wow_forever, only classic under classic_era (ROK-2170)', () =>
      testForeverLootReplacesClassic());

    it('returns [] under wow_forever for a boss with only classic loot — never the classic table (ROK-2209)', () =>
      testForeverNeverFallsBackToClassic());

    it('should return empty array for boss with no loot', async () => {
      const boss = await insertBoss(testApp, {
        instanceId: 202,
        name: 'Lootless Boss',
        order: 1,
        expansion: 'classic',
      });
      const res = await testApp.request.get(
        `/plugins/wow-classic/bosses/${boss.id}/loot?variant=classic_era`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return 400 for invalid variant', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/bosses/1/loot?variant=bad',
      );
      expect(res.status).toBe(400);
    });
  });
});
