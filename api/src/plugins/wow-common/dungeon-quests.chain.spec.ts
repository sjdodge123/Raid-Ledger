/**
 * ROK-2143 — a dangling `prevQuestId` (the prerequisite is not in our data)
 * must not produce a chain holding only the quest itself.
 */
import {
  prerequisiteChainOf,
  walkChainInMemory,
} from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';

function quest(
  questId: number,
  overrides: Partial<DungeonQuestDto> = {},
): DungeonQuestDto {
  return {
    questId,
    dungeonInstanceId: 238,
    name: `Quest ${questId}`,
    questLevel: 25,
    requiredLevel: 20,
    expansion: 'classic',
    questGiverNpc: null,
    questGiverZone: null,
    prevQuestId: null,
    nextQuestId: null,
    rewardsJson: null,
    objectives: null,
    classRestriction: null,
    raceRestriction: null,
    startsInsideDungeon: false,
    sharable: true,
    rewardXp: null,
    rewardGold: null,
    rewardType: 'none',
    ...overrides,
  };
}

function lookupOf(...quests: DungeonQuestDto[]): Map<number, DungeonQuestDto> {
  return new Map(quests.map((q) => [q.questId, q]));
}

describe('walkChainInMemory — dangling prerequisite', () => {
  it('stops at a prevQuestId that is not in the lookup and never repeats the quest', () => {
    const q = quest(378, { prevQuestId: 303 });
    const chain = walkChainInMemory(q, lookupOf(q));
    expect(chain.map((c) => c.questId)).toEqual([378]);
  });
});

describe('prerequisiteChainOf', () => {
  it('is null for a dangling prevQuestId (AC7)', () => {
    const q = quest(378, { prevQuestId: 303 });
    expect(prerequisiteChainOf(q, lookupOf(q))).toBeNull();
  });

  it('is null when only follow-up quests were found', () => {
    const q = quest(10, { prevQuestId: 9, nextQuestId: 11 });
    const next = quest(11, { prevQuestId: 10 });
    expect(prerequisiteChainOf(q, lookupOf(q, next))).toBeNull();
  });

  it('returns the whole chain once a prerequisite resolves', () => {
    const first = quest(9, { nextQuestId: 10 });
    const q = quest(10, { prevQuestId: 9, nextQuestId: 11 });
    const next = quest(11, { prevQuestId: 10 });
    const chain = prerequisiteChainOf(q, lookupOf(first, q, next));
    expect(chain?.map((c) => c.questId)).toEqual([9, 10, 11]);
  });
});
