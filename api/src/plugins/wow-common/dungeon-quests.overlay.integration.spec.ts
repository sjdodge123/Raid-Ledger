/**
 * ROK-2143 — the Quest Prep read path against a real DB: Blizzard overlay
 * rows (`wow_dungeon_quest_blizzard`) win for title / XP / money / reward item
 * ids, survive a re-seed of the bundled JSON (AC5), drop out when the kill
 * switch is off (AC6), a prerequisite not in our data gives no chain (AC7),
 * an overlay-only quest shows in its dungeon's list (R4), and chain links
 * walked from a quest take the Blizzard prevQuestId (review M3), a
 * prerequisite only Blizzard has joins the chain, and the chain route walks
 * from the root's Blizzard prevQuestId (Codex P2s).
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { defined } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { INSIDE_DUNGEON_QUEST_IDS } from './data/dungeon-quest-inside-allowlist';
import { DungeonQuestsService } from './dungeon-quests.service';
import { WOW_FOREVER_QUEST_IMPORT_KEY } from './forever.settings';

interface QuestBody {
  questId: number;
  name: string;
  rewardXp: number | null;
  rewardGold: number | null;
  rewardsJson: number[] | null;
  startsInsideDungeon: boolean;
  questGiverNpc: string | null;
  prerequisiteChain?: unknown;
}

/** Bundled quests: The Fury Runs Deep (Stockade), Rocknot's Ale (BRD, inside). */
const FURY = { questId: 378, instanceId: 238, npc: 'Motley Garmason' };
const ROCKNOT = { questId: 4295, instanceId: 228, npc: 'Private Rocknot' };
/** A Stockade quest only Blizzard lists (R4). */
const OVERLAY_ONLY_ID = 990501;

let testApp: TestApp;

const service = () => testApp.app.get(DungeonQuestsService);
const settings = () => testApp.app.get(SettingsService);

async function insertOverlay(
  questId: number,
  instanceId: number | null,
  title: string,
  requirementsRaw: unknown = null,
): Promise<void> {
  await testApp.db.insert(schema.wowDungeonQuestBlizzard).values({
    questId,
    areaId: 717,
    dungeonInstanceId: instanceId,
    title,
    typeId: 81,
    rewardXp: 5750,
    rewardMoneyCopper: 1800,
    rewardItems: [{ id: 918, name: 'Deviate Hide Pack' }],
    requirementsRaw,
    raw: { id: questId },
    fetchedAt: new Date(),
    runId: 'run-it',
  });
}

async function questsOf(instanceId: number): Promise<QuestBody[]> {
  const res = await testApp.request.get(
    `/plugins/wow-classic/instances/${instanceId}/quests?variant=classic_era`,
  );
  expect(res.status).toBe(200);
  return res.body as QuestBody[];
}

async function questOf(instanceId: number, questId: number) {
  const found = (await questsOf(instanceId)).find((q) => q.questId === questId);
  return defined(found, `quest ${questId} in instance ${instanceId}`);
}

function expectBlizzardValues(q: QuestBody, title: string): void {
  expect(q).toMatchObject({
    name: title,
    rewardXp: 5750,
    rewardGold: 1800,
    rewardsJson: [918],
  });
}

async function expectOverlayWins(): Promise<void> {
  const fury = await questOf(FURY.instanceId, FURY.questId);
  expectBlizzardValues(fury, 'Fury (Blizzard)');
  expect(fury.questGiverNpc).toBe(FURY.npc);
  expect(fury.startsInsideDungeon).toBe(
    INSIDE_DUNGEON_QUEST_IDS.has(FURY.questId),
  );
  const rocknot = await questOf(ROCKNOT.instanceId, ROCKNOT.questId);
  expectBlizzardValues(rocknot, 'Rocknot (Blizzard)');
  expect(rocknot.questGiverNpc).toBe(ROCKNOT.npc);
  expect(rocknot.startsInsideDungeon).toBe(
    INSIDE_DUNGEON_QUEST_IDS.has(ROCKNOT.questId),
  );
}

/**
 * M3 chain: A (instance 990) ← B ← C in the bundled data (B, C, D live in
 * instance 991, so only the chain walk fetches them). B's Blizzard row names
 * D as its prerequisite instead of C.
 */
const CHAIN = { a: 990601, b: 990602, c: 990603, d: 990604 };
/** A prerequisite only the overlay has, imported with no dungeon (Codex P2). */
const OVERLAY_PREREQ_ID = 990605;
const CHAIN_INSTANCE = 990;

async function insertBundledQuest(
  questId: number,
  instanceId: number,
  prevQuestId: number | null,
): Promise<void> {
  await testApp.db.insert(schema.wowClassicDungeonQuests).values({
    questId,
    dungeonInstanceId: instanceId,
    name: `Chain ${questId}`,
    expansion: 'classic',
    questLevel: 30,
    prevQuestId,
    startsInsideDungeon: false,
    sharable: true,
  });
}

async function seedBundledChain(): Promise<void> {
  await insertBundledQuest(CHAIN.a, CHAIN_INSTANCE, CHAIN.b);
  await insertBundledQuest(CHAIN.b, 991, CHAIN.c);
  await insertBundledQuest(CHAIN.c, 991, null);
  await insertBundledQuest(CHAIN.d, 991, null);
}

/** Blizzard's live requirements shape (quest 4132): an AND group of targets. */
function requiresQuest(id: number): unknown {
  return {
    quests: {
      operator: { name: 'And', type: 'AND' },
      conditions: [{ target: { id, name: `Chain ${id}` } }],
    },
  };
}

/** Quest ids of A's prerequisite chain on the enriched list (expandFrontier). */
async function enrichedChainIds(): Promise<number[]> {
  const res = await testApp.request.get(
    `/plugins/wow-classic/instances/${CHAIN_INSTANCE}/quests/enriched?variant=classic_era`,
  );
  expect(res.status).toBe(200);
  const quest = (res.body as QuestBody[]).find((q) => q.questId === CHAIN.a);
  const chain = defined(quest, 'chain quest A').prerequisiteChain;
  expect(Array.isArray(chain)).toBe(true);
  return Array.isArray(chain)
    ? chain.map((q: { questId: number }) => q.questId)
    : [];
}

/** Quest ids of A's chain from the chain route (walkChainDirection). */
async function routeChainIds(): Promise<number[]> {
  const res = await testApp.request.get(
    `/plugins/wow-classic/quests/${CHAIN.a}/chain`,
  );
  expect(res.status).toBe(200);
  return (res.body as { questId: number }[]).map((q) => q.questId);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await service().seedQuests();
  await insertOverlay(FURY.questId, FURY.instanceId, 'Fury (Blizzard)');
  await insertOverlay(
    ROCKNOT.questId,
    ROCKNOT.instanceId,
    'Rocknot (Blizzard)',
  );
});

afterEach(async () => {
  await service().clearCache();
  testApp.seed = await truncateAllTables(testApp.db);
  settings().invalidateCache(true);
  await loginAsAdmin(testApp.request, testApp.seed);
});

describe('Quest Prep overlay read path (ROK-2143)', () => {
  it('AC5: Blizzard values win, curated flags stay, and survive a re-seed', async () => {
    expect(INSIDE_DUNGEON_QUEST_IDS.has(ROCKNOT.questId)).toBe(true);
    expect(INSIDE_DUNGEON_QUEST_IDS.has(FURY.questId)).toBe(false);
    await expectOverlayWins();
    await service().seedQuests();
    await expectOverlayWins();
  });

  it('AC6: kill switch off shows the bundled values, cache included', async () => {
    const enriched = `/plugins/wow-classic/instances/${FURY.instanceId}/quests/enriched?variant=classic_era`;
    const before = await testApp.request.get(enriched);
    const furyOn = (before.body as QuestBody[]).find(
      (q) => q.questId === FURY.questId,
    );
    expect(furyOn?.name).toBe('Fury (Blizzard)');
    await settings().set(WOW_FOREVER_QUEST_IMPORT_KEY, 'false');
    const fury = await questOf(FURY.instanceId, FURY.questId);
    expect(fury).toMatchObject({
      name: 'The Fury Runs Deep',
      rewardXp: null,
      rewardGold: null,
      rewardsJson: [3562, 1264],
    });
    const after = await testApp.request.get(enriched);
    const furyOff = (after.body as QuestBody[]).find(
      (q) => q.questId === FURY.questId,
    );
    expect(furyOff?.name).toBe('The Fury Runs Deep');
  });

  it('AC7: a prerequisite not in our data gives prerequisiteChain null', async () => {
    await testApp.db.insert(schema.wowClassicDungeonQuests).values({
      questId: 990502,
      dungeonInstanceId: 990,
      name: 'Dangling Prereq',
      expansion: 'classic',
      questLevel: 30,
      prevQuestId: 990999,
      startsInsideDungeon: false,
      sharable: true,
    });
    const res = await testApp.request.get(
      '/plugins/wow-classic/instances/990/quests/enriched?variant=classic_era',
    );
    expect(res.status).toBe(200);
    const quest = (res.body as QuestBody[]).find((q) => q.questId === 990502);
    expect(defined(quest, 'dangling quest').prerequisiteChain).toBeNull();
  });

  it('R4: an overlay-only quest appears in its dungeon list', async () => {
    await insertOverlay(OVERLAY_ONLY_ID, FURY.instanceId, 'Only On Blizzard');
    const only = await questOf(FURY.instanceId, OVERLAY_ONLY_ID);
    expectBlizzardValues(only, 'Only On Blizzard');
    expect(only.startsInsideDungeon).toBe(false);
  });
});

describe('Quest Prep chain links (ROK-2143 M3)', () => {
  it('M3: chain links walked from a quest use the Blizzard overlay prevQuestId', async () => {
    await seedBundledChain();
    const bundled = [CHAIN.c, CHAIN.b, CHAIN.a];
    expect(await enrichedChainIds()).toEqual(bundled);
    expect(await routeChainIds()).toEqual(bundled);

    await insertOverlay(CHAIN.b, 991, 'B (Blizzard)', requiresQuest(CHAIN.d));
    await service().clearCache();
    const blizzard = [CHAIN.d, CHAIN.b, CHAIN.a];
    expect(await enrichedChainIds()).toEqual(blizzard);
    expect(await routeChainIds()).toEqual(blizzard);
  });
});

describe('Quest Prep chain sources (ROK-2143 Codex P2)', () => {
  it('a prerequisite only in the overlay (no dungeon) joins the chain', async () => {
    await insertBundledQuest(CHAIN.a, CHAIN_INSTANCE, OVERLAY_PREREQ_ID);
    await insertOverlay(OVERLAY_PREREQ_ID, null, 'Overlay Prereq');
    const expected = [OVERLAY_PREREQ_ID, CHAIN.a];
    expect(await routeChainIds()).toEqual(expected);
    expect(await enrichedChainIds()).toEqual(expected);
  });

  it('kill switch off: an overlay-only prerequisite is ignored', async () => {
    await insertBundledQuest(CHAIN.a, CHAIN_INSTANCE, OVERLAY_PREREQ_ID);
    await insertOverlay(OVERLAY_PREREQ_ID, null, 'Overlay Prereq');
    await settings().set(WOW_FOREVER_QUEST_IMPORT_KEY, 'false');
    expect(await routeChainIds()).toEqual([CHAIN.a]);
  });

  it('the chain route walks from the root quest Blizzard prevQuestId', async () => {
    await seedBundledChain();
    await insertOverlay(
      CHAIN.a,
      CHAIN_INSTANCE,
      'A (Blizzard)',
      requiresQuest(CHAIN.d),
    );
    const res = await testApp.request.get(
      `/plugins/wow-classic/quests/${CHAIN.a}/chain`,
    );
    expect(res.status).toBe(200);
    const chain = res.body as { questId: number; prevQuestId: number | null }[];
    expect(chain.map((q) => q.questId)).toEqual([CHAIN.d, CHAIN.a]);
    expect(chain.find((q) => q.questId === CHAIN.a)?.prevQuestId).toBe(CHAIN.d);
    expect(await enrichedChainIds()).toEqual([CHAIN.d, CHAIN.a]);
  });
});
