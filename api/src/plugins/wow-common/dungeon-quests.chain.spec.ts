/**
 * ROK-2143 — a dangling `prevQuestId` (the prerequisite is not in our data)
 * must not produce a chain holding only the quest itself.
 */
import {
  prerequisiteChainOf,
  walkChainInMemory,
  walkChainWithExternalRoot,
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

// ROK-2221: a prerequisite EXTERNAL_PREREQS names (8926 -> 8977 Return to
// Deliana, AQ war effort) becomes a named first step instead of a dead end.
describe('walkChainWithExternalRoot — named outside prerequisite', () => {
  const dependent = quest(8926, { dungeonInstanceId: null, prevQuestId: 8977 });

  it('prepends the named prerequisite when it is not in the lookup', () => {
    const chain = walkChainWithExternalRoot(dependent, new Map());
    expect(chain.map((q) => [q.questId, q.name])).toEqual([
      [8977, 'Return to Deliana'],
      [8926, 'Quest 8926'],
    ]);
    expect(chain[0]).toMatchObject({
      dungeonInstanceId: null,
      nextQuestId: 8926,
    });
  });

  it('gives prerequisiteChainOf a chain instead of null', () => {
    const chain = prerequisiteChainOf(dependent, new Map());
    expect(chain?.map((q) => q.questId)).toEqual([8977, 8926]);
  });

  it('prepends it to the root of a longer chain too', () => {
    const child = quest(500, { prevQuestId: 8926 });
    const lookup = new Map([[8926, dependent]]);
    expect(
      walkChainWithExternalRoot(child, lookup).map((q) => q.questId),
    ).toEqual([8977, 8926, 500]);
  });

  it('uses the real row when the prerequisite is in the lookup', () => {
    const real = quest(8977, { name: 'Real 8977' });
    const chain = walkChainWithExternalRoot(dependent, new Map([[8977, real]]));
    expect(chain.map((q) => q.name)).toEqual(['Real 8977', 'Quest 8926']);
  });

  it('ignores the entry once prevQuestId names a different quest', () => {
    const moved = quest(8926, { prevQuestId: 1234 });
    expect(
      walkChainWithExternalRoot(moved, new Map()).map((q) => q.questId),
    ).toEqual([8926]);
  });

  it('leaves an unlisted dangling prerequisite alone', () => {
    const other = quest(42, { prevQuestId: 41 });
    expect(prerequisiteChainOf(other, new Map())).toBeNull();
  });
});
