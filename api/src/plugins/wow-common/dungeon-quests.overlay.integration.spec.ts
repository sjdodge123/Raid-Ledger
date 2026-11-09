/**
 * ROK-2143 — the Quest Prep read path against a real DB: Blizzard overlay
 * rows (`wow_dungeon_quest_blizzard`) win for title / XP / money / reward item
 * ids, survive a re-seed of the bundled JSON (AC5), drop out when the kill
 * switch is off (AC6), a prerequisite not in our data gives no chain (AC7),
 * and an overlay-only quest shows in its dungeon's list (R4).
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
  instanceId: number,
  title: string,
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
