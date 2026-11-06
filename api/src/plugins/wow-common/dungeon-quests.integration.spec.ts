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
import { defined } from '../../common/testing/narrow';

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
  return defined(quest, 'inserted quest');
}

let testApp: TestApp;

async function setupTestApp() {
  testApp = await getTestApp();
}

async function cleanupTestApp() {
  testApp.seed = await truncateAllTables(testApp.db);
  await loginAsAdmin(testApp.request, testApp.seed);
}

async function testQuestsFilteredByVariant() {
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
  const names = (res.body as Array<{ name: string }>).map((q) => q.name);
  expect(names).toContain('Classic Quest');
  expect(names).not.toContain('TBC Quest');
}

async function testSubInstanceQuestResolution() {
  const parentId = 316;
  const subInstanceId = 31603;
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
  const names = (res.body as Array<{ name: string }>).map((q) => q.name);
  expect(names).toContain('Complex-wide Quest');
  expect(names).toContain('Wing-specific Quest');
}

describe('Dungeon Quests — instance quests (integration)', () => {
  beforeAll(() => setupTestApp());
  afterEach(() => cleanupTestApp());

  describe('GET /plugins/wow-classic/instances/:id/quests', () => {
    it('should return quests for an instance filtered by variant', () =>
      testQuestsFilteredByVariant());

    it('should include parent instance quests for sub-instance queries', () =>
      testSubInstanceQuestResolution());

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
});

describe('Dungeon Quests — quest chain (integration)', () => {
  beforeAll(() => setupTestApp());
  afterEach(() => cleanupTestApp());

  describe('GET /plugins/wow-classic/quests/:questId/chain', () => {
    it('should walk the quest chain backwards and forwards', async () => {
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
      const names = (res.body as Array<{ name: string }>).map((q) => q.name);
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
});

/** Forever-style reward ids absent from quest-reward-items.json + boss loot. */
const META_REWARD_ID = 991001;
const UNKNOWN_REWARD_ID = 991002;

async function testRewardFromItemMetaCache() {
  const instanceId = 401;
  await insertQuest(testApp, {
    questId: 5101,
    dungeonInstanceId: instanceId,
    name: 'Forever Reward Quest',
    expansion: 'classic',
    questLevel: 30,
    rewardsJson: [META_REWARD_ID, UNKNOWN_REWARD_ID],
  });
  await testApp.db.insert(schema.wowItemMeta).values({
    itemId: META_REWARD_ID,
    status: 'resolved',
    env: 16,
    name: 'Blade of the Forever Depths',
    quality: 3,
    icon: 'inv_sword_04',
    fetchedAt: new Date(),
  });
  const res = await testApp.request.get(
    `/plugins/wow-classic/instances/${instanceId}/quests/enriched?variant=classic_era`,
  );
  expect(res.status).toBe(200);
  type Reward = { itemId: number; itemName: string; quality: string };
  const quest = (res.body as Array<{ rewards: Reward[] | null }>)[0];
  expect(quest?.rewards).toEqual([
    {
      itemId: META_REWARD_ID,
      itemName: 'Blade of the Forever Depths',
      quality: 'Rare',
      slot: null,
      itemLevel: null,
      iconUrl:
        'https://wow.zamimg.com/images/wow/icons/medium/inv_sword_04.jpg',
      itemSubclass: null,
    },
    expect.objectContaining({
      itemId: UNKNOWN_REWARD_ID,
      itemName: `Item #${UNKNOWN_REWARD_ID}`,
      quality: 'Common',
    }),
  ]);
}

describe('Dungeon Quests — enriched quests (integration)', () => {
  beforeAll(() => setupTestApp());
  afterEach(() => cleanupTestApp());

  describe('GET /plugins/wow-classic/instances/:id/quests/enriched', () => {
    it('should return enriched quests with prerequisite chains resolved', async () => {
      const instanceId = 400;
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
      type QuestRow = { questId: number; prerequisiteChain: unknown[] | null };
      const questList = res.body as QuestRow[];
      const mainQuest = questList.find((q) => q.questId === 5002);
      expect(mainQuest).toBeDefined();
      expect(mainQuest?.prerequisiteChain).not.toBeNull();
      expect(mainQuest?.prerequisiteChain?.length).toBe(2);
      const prereqQuest = questList.find((q) => q.questId === 5001);
      expect(prereqQuest!.prerequisiteChain).toBeNull();
    });

    it('resolves a reward id with no lookup entry from the wow_item_meta cache', () =>
      testRewardFromItemMetaCache());

    it('should return 400 for invalid variant', async () => {
      const res = await testApp.request.get(
        '/plugins/wow-classic/instances/400/quests/enriched?variant=invalid',
      );

      expect(res.status).toBe(400);
    });
  });
});
