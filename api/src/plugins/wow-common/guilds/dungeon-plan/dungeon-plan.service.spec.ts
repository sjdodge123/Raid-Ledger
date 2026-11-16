/**
 * ROK-2214 — DungeonPlanService composition with mocked reads (the real-DB
 * cases are the integration spec's). Ranges come from the catalogue (R2).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import { SettingsService } from '../../../../settings/settings.service';
import type { DungeonQuestDto } from '../../dungeon-quests.types';
import { loadEventQuestSet } from '../../event-forever-progress.query';
import { WowFactsService } from '../../facts/wow-facts.service';
import { loadForeverQuestSources } from '../../forever-quest-source.query';
import { InstanceCatalogueService } from '../../instance-catalogue/instance-catalogue.service';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';
import { loadGuildRows } from '../roster-insights/roster-insights.refs';
import { loadPlanHub, loadPlanSignups } from './dungeon-plan.query';
import { DungeonPlanService } from './dungeon-plan.service';

jest.mock('./dungeon-plan.query');
jest.mock('../roster-insights/roster-insights.refs');
jest.mock('../../event-forever-progress.query');
jest.mock('../../forever-quest-source.query');

const CHAR_A = '00000000-0000-4000-8000-00000000000a';
const CHAR_X = '00000000-0000-4000-8000-00000000000f';
const catalogue = new InstanceCatalogueService();
const dungeon = catalogue.list('wow_forever', 'dungeon')[0];
const raid = catalogue.list('wow_forever', 'raid')[0];

function quest(
  questId: number,
  raceRestriction: string[] | null,
): DungeonQuestDto {
  return {
    questId,
    dungeonInstanceId: dungeon?.id ?? 1,
    name: `Quest ${questId}`,
    questLevel: null,
    requiredLevel: null,
    expansion: 'classic',
    questGiverNpc: null,
    questGiverZone: null,
    prevQuestId: null,
    nextQuestId: null,
    rewardsJson: null,
    objectives: null,
    classRestriction: null,
    raceRestriction,
    startsInsideDungeon: false,
    sharable: true,
    rewardXp: null,
    rewardGold: null,
    rewardType: null,
  };
}

const rosterRow = (characterId: string | null, userId: number | null) => ({
  key: 'm7',
  memberId: 7,
  name: 'Aelin',
  characterId,
  userId,
  isMain: true,
  rankIndex: 0,
  onlineAtExport: null,
  lastOnlineDays: null,
});

const resolveFacts = jest.fn();

async function makeService(): Promise<DungeonPlanService> {
  const mod = await Test.createTestingModule({
    providers: [
      DungeonPlanService,
      InstanceCatalogueService,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: SettingsService, useValue: {} },
      { provide: WowFactsService, useValue: { resolveFacts } },
    ],
  }).compile();
  return mod.get(DungeonPlanService);
}

function seedHappyPath(): void {
  const quests = [quest(1, ['Orc']), quest(2, null)];
  jest.mocked(loadPlanHub).mockResolvedValue({
    kind: 'wow_guild',
    gameSlug: WOW_FOREVER_GAME_SLUG,
    faction: 'Alliance',
  });
  jest.mocked(loadGuildRows).mockResolvedValue([rosterRow(CHAR_A, 3)]);
  jest.mocked(loadEventQuestSet).mockResolvedValue({
    eventQuests: quests,
    lookup: new Map(quests.map((q) => [q.questId, q])),
    knownIds: new Set([1, 2]),
  });
  jest.mocked(loadPlanSignups).mockResolvedValue([
    {
      userId: 3,
      username: 'u3',
      characterId: CHAR_A,
      characterName: 'Aelin',
      charClass: 'Mage',
      charRace: 'Human',
      charFaction: 'alliance',
    },
  ]);
  jest.mocked(loadForeverQuestSources).mockResolvedValue(new Map());
  resolveFacts.mockResolvedValue({
    facts: new Map([['m7', { level: { value: dungeon?.minimumLevel } }]]),
    truncated: false,
  });
}

describe('DungeonPlanService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('404s off a Forever wow_guild hub', async () => {
    const svc = await makeService();
    jest.mocked(loadPlanHub).mockResolvedValue({
      kind: 'game_community',
      gameSlug: WOW_FOREVER_GAME_SLUG,
      faction: null,
    });
    await expect(
      svc.plan(1, { instanceId: 1, characterIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400s for a raid id', async () => {
    seedHappyPath();
    const svc = await makeService();
    await expect(
      svc.plan(1, { instanceId: raid?.id ?? 0, characterIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps claimed ids, drops the rest, filters to the guild side', async () => {
    seedHappyPath();
    const svc = await makeService();
    const got = await svc.plan(1, {
      instanceId: dungeon?.id ?? 0,
      characterIds: [CHAR_A, CHAR_X],
    });
    expect(got.side).toBe('alliance');
    expect(got.sideSource).toBe('guild');
    expect(got.hiddenOtherFaction).toBe(1);
    expect(got.readiness.quests.map((q) => q.questId)).toEqual([2]);
    expect(got.droppedCharacterIds).toEqual([CHAR_X]);
    expect(got.characters).toEqual([
      {
        characterId: CHAR_A,
        name: 'Aelin',
        class: 'Mage',
        level: dungeon?.minimumLevel,
        levelFit: 'in',
      },
    ]);
  });

  it('skips every character read when none are kept', async () => {
    seedHappyPath();
    const svc = await makeService();
    const got = await svc.plan(1, {
      instanceId: dungeon?.id ?? 0,
      characterIds: [],
    });
    expect(got.characters).toEqual([]);
    expect(got.readiness.signups).toEqual([]);
    expect(loadPlanSignups).not.toHaveBeenCalled();
    expect(loadForeverQuestSources).not.toHaveBeenCalled();
    expect(resolveFacts).not.toHaveBeenCalled();
  });
});
