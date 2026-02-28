/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Dungeon Quests Integration Tests (ROK-569)
 *
 * Verifies dungeon quest queries (variant-aware filtering, sub-instance
 * resolution, quest chain walking, enriched quests) against a real
 * PostgreSQL database via HTTP endpoints.
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';

/** Insert a dungeon quest directly and return the row. */
async function insertQuest(
  testApp: TestApp,
  overrides: Partial<typeof schema.wowClassicDungeonQuests.$inferInsert> & {
    questId: number;
    name: string;
    expansion: string;
  },
): Promise<typeof schema.wowClassicDungeonQuests.$inferSelect> {
  const [quest] = await testApp.db
    .insert(schema.wowClassicDungeonQuests)
    .values({
      dungeonInstanceId: null,
      startsInsideDungeon: false,
      sharable: true,
      ...overrides,
    })
    .returning();
  return quest;
}

describe('Dungeon Quests (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ===================================================================
  // GET /plugins/wow-classic/instances/:id/quests
  // ===================================================================

  describe('GET /plugins/wow-classic/instances/:id/quests', () => {
    it('should return quests for an instance filtered by variant', async () => {
      const instanceId = 300;
      await insertQuest(testApp, {
        questId: 1001,
        dungeonInstanceId: instanceId,
        name: 'Classic Quest',
        expansion: 'classic',
        questLevel: 30,
      });
      await insertQuest(testApp, {
        questId: 1002,
        dungeonInstanceId: instanceId,
        name: 'TBC Quest',
        expansion: 'tbc',
        questLevel: 65,
      });

      const res = await testApp.request.get(
        `/plugins/wow-classic/instances/${instanceId}/quests?variant=classic_era`,
      );

      expect(res.status).toBe(200);
      const names = res.body.map((q: { name: string }) => q.name);
      expect(names).toContain('Classic Quest');
      expect(names).not.toContain('TBC Quest');
    });

    it('should include parent instance quests for sub-instance queries', async () => {
      const parentId = 316;
      const subInstanceId = 31603; // SM:Armory

      await insertQuest(testApp, {
        questId: 2001,
        dungeonInstanceId: parentId,
        name: 'Complex-wide Quest',
        expansion: 'classic',
        questLevel: 35,
      });
      await insertQuest(testApp, {
        questId: 2002,
        dungeonInstanceId: subInstanceId,
        name: 'Wing-specific Quest',
        expansion: 'classic',
        questLevel: 36,
      });

      const res = await testApp.request.get(
        `/plugins/wow-classic/instances/${subInstanceId}/quests?variant=classic_era`,
      );

      expect(res.status).toBe(200);
      const names = res.body.map((q: { name: string }) => q.name);
      expect(names).toContain('Complex-wide Quest');
      expect(names).toContain('Wing-specific Quest');
    });

    it('should return empty array for instance with no quests', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/instances/99999/quests?variant=classic_era',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('should return 400 for invalid variant', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/instances/300/quests?variant=bad_variant',
      );

      expect(res.status).toBe(400);
    });
  });

  // ===================================================================
  // GET /plugins/wow-classic/quests/:questId/chain
  // ===================================================================

  describe('GET /plugins/wow-classic/quests/:questId/chain', () => {
    it('should walk the quest chain backwards and forwards', async () => {
      // Chain: A -> B -> C
      await insertQuest(testApp, {
        questId: 3001,
        name: 'Quest A',
        expansion: 'classic',
        prevQuestId: null,
        nextQuestId: 3002,
      });
      await insertQuest(testApp, {
        questId: 3002,
        name: 'Quest B',
        expansion: 'classic',
        prevQuestId: 3001,
        nextQuestId: 3003,
      });
      await insertQuest(testApp, {
        questId: 3003,
        name: 'Quest C',
        expansion: 'classic',
        prevQuestId: 3002,
        nextQuestId: null,
      });

      const res = await testApp.request.get(
        '/plugins/wow-classic/quests/3002/chain',
      );

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);

      const names = res.body.map((q: { name: string }) => q.name);
      expect(names).toEqual(['Quest A', 'Quest B', 'Quest C']);
    });

    it('should return single-element array for quest with no chain', async () => {
      await insertQuest(testApp, {
        questId: 4001,
        name: 'Standalone Quest',
        expansion: 'classic',
        prevQuestId: null,
        nextQuestId: null,
      });

      const res = await testApp.request.get(
        '/plugins/wow-classic/quests/4001/chain',
      );

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Standalone Quest');
    });

    it('should return empty array for non-existent quest', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/quests/99999/chain',
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ===================================================================
  // GET /plugins/wow-classic/instances/:id/quests/enriched
  // ===================================================================

  describe('GET /plugins/wow-classic/instances/:id/quests/enriched', () => {
    it('should return enriched quests with prerequisite chains resolved', async () => {
      const instanceId = 400;

      // Chain: prereq -> main
      await insertQuest(testApp, {
        questId: 5001,
        dungeonInstanceId: instanceId,
        name: 'Prereq Quest',
        expansion: 'classic',
        prevQuestId: null,
        nextQuestId: 5002,
        questLevel: 30,
      });
      await insertQuest(testApp, {
        questId: 5002,
        dungeonInstanceId: instanceId,
        name: 'Main Quest',
        expansion: 'classic',
        prevQuestId: 5001,
        nextQuestId: null,
        questLevel: 31,
      });

      const res = await testApp.request.get(
        `/plugins/wow-classic/instances/${instanceId}/quests/enriched?variant=classic_era`,
      );

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);

      // The quest with a prevQuestId should have a prerequisiteChain
      const mainQuest = res.body.find(
        (q: { questId: number }) => q.questId === 5002,
      );
      expect(mainQuest).toBeDefined();
      expect(mainQuest.prerequisiteChain).not.toBeNull();
      expect(mainQuest.prerequisiteChain.length).toBe(2);

      // The quest without a prevQuestId should have null prerequisiteChain
      const prereqQuest = res.body.find(
        (q: { questId: number }) => q.questId === 5001,
      );
      expect(prereqQuest.prerequisiteChain).toBeNull();
    });

    it('should return 400 for invalid variant', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/instances/400/quests/enriched?variant=invalid',
      );

      expect(res.status).toBe(400);
    });
  });
});
