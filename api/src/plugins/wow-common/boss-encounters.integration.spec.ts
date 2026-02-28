/* eslint-disable @typescript-eslint/no-unsafe-call */
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
  return boss;
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
  return loot;
}

describe('Boss Encounters (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ===================================================================
  // GET /plugins/wow-classic/instances/:id/bosses
  // ===================================================================

  describe('GET /plugins/wow-classic/instances/:id/bosses', () => {
    it('should return bosses for an instance filtered by classic_era variant', async () => {
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
      // TBC boss should be excluded in classic_era
      const names = res.body.map((b: { name: string }) => b.name);
      expect(names).not.toContain('TBC Boss');
    });

    it('should include tbc bosses for classic_anniversary variant', async () => {
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
      const names = res.body.map((b: { name: string }) => b.name);
      expect(names).toContain('Classic Boss');
      expect(names).toContain('TBC Boss');
    });

    it('should resolve sub-instance IDs to parent and filter by wing', async () => {
      // Scarlet Monastery parent = 316
      // SM:Armory = 31603 (suffix 3)
      // Wing 3 bosses: ['Herod']
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
        `/plugins/wow-classic/instances/31603/bosses?variant=classic_era`,
      );

      expect(res.status).toBe(200);
      const names = res.body.map((b: { name: string }) => b.name);
      expect(names).toContain('Herod');
      expect(names).not.toContain('Arcanist Doan');
    });

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

  // ===================================================================
  // GET /plugins/wow-classic/bosses/:id/loot
  // ===================================================================

  describe('GET /plugins/wow-classic/bosses/:id/loot', () => {
    it('should return loot for a boss filtered by variant', async () => {
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
      const itemNames = res.body.map((l: { itemName: string }) => l.itemName);
      expect(itemNames).toContain('Classic Sword');
      expect(itemNames).not.toContain('TBC Sword');
    });

    it('should include tbc loot for classic_anniversary variant', async () => {
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
      const itemNames = res.body.map((l: { itemName: string }) => l.itemName);
      expect(itemNames).toContain('Classic Ring');
      expect(itemNames).toContain('TBC Ring');
    });

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
