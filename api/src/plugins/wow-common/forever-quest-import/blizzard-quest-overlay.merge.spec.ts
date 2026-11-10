import type { DungeonQuestDto } from '../dungeon-quests.types';
import {
  mergeBlizzardOverlay,
  reputationRewardFields,
  type BlizzardQuestOverlay,
} from './blizzard-quest-overlay.merge';

/** Curated row as the bundled JSON seeds it (quest 1486 Deviate Hides). */
function curated(overrides: Partial<DungeonQuestDto> = {}): DungeonQuestDto {
  return {
    questId: 1486,
    dungeonInstanceId: 240,
    name: 'Deviate Hides (curated)',
    questLevel: 17,
    requiredLevel: 13,
    expansion: 'classic',
    questGiverNpc: 'Nalpak',
    questGiverZone: 'Wailing Caverns',
    prevQuestId: null,
    nextQuestId: null,
    rewardsJson: [6480],
    objectives: 'Bring 20 Deviate Hides to Nalpak.',
    classRestriction: null,
    raceRestriction: ['Orc'],
    startsInsideDungeon: true,
    sharable: false,
    rewardXp: 999,
    rewardGold: 1,
    rewardType: 'choice',
    ...overrides,
  };
}

function overlay(
  overrides: Partial<BlizzardQuestOverlay> = {},
): BlizzardQuestOverlay {
  return {
    questId: 1486,
    title: 'Deviate Hides',
    rewardXp: 3100,
    rewardMoneyCopper: 1800,
    rewardItems: [{ id: 918, name: 'Deviate Hide Pack' }],
    reputations: [],
    requirementsRaw: {},
    ...overrides,
  };
}

describe('mergeBlizzardOverlay', () => {
  it('returns the row unchanged for a null or undefined overlay', () => {
    const row = curated();
    expect(mergeBlizzardOverlay(row, null)).toBe(row);
    expect(mergeBlizzardOverlay(row, undefined)).toBe(row);
  });

  it('lets each Blizzard field win', () => {
    const merged = mergeBlizzardOverlay(curated(), overlay());
    expect(merged.name).toBe('Deviate Hides');
    expect(merged.rewardXp).toBe(3100);
    expect(merged.rewardGold).toBe(1800);
    expect(merged.rewardsJson).toEqual([918]);
  });

  it('keeps every curated field', () => {
    const row = curated();
    const merged = mergeBlizzardOverlay(row, overlay());
    expect(merged).toEqual({
      ...row,
      name: 'Deviate Hides',
      rewardXp: 3100,
      rewardGold: 1800,
      rewardsJson: [918],
    });
    expect(merged.startsInsideDungeon).toBe(true);
    expect(merged.questGiverNpc).toBe('Nalpak');
    expect(merged.questGiverZone).toBe('Wailing Caverns');
    expect(merged.objectives).toBe('Bring 20 Deviate Hides to Nalpak.');
    expect(merged.rewardType).toBe('choice');
  });

  it('keeps curated values where the overlay has none', () => {
    const merged = mergeBlizzardOverlay(
      curated(),
      overlay({
        title: '  ',
        rewardXp: null,
        rewardMoneyCopper: null,
        rewardItems: [],
      }),
    );
    expect(merged.name).toBe('Deviate Hides (curated)');
    expect(merged.rewardXp).toBe(999);
    expect(merged.rewardGold).toBe(1);
    expect(merged.rewardsJson).toEqual([6480]);
  });

  it('fills fields the curated row lacks (R7: nulled synthetic numbers)', () => {
    const merged = mergeBlizzardOverlay(
      curated({ rewardXp: null, rewardGold: null, rewardsJson: null }),
      overlay(),
    );
    expect(merged.rewardXp).toBe(3100);
    expect(merged.rewardGold).toBe(1800);
    expect(merged.rewardsJson).toEqual([918]);
  });

  it('treats a zero amount as a real Blizzard value', () => {
    const merged = mergeBlizzardOverlay(curated(), overlay({ rewardXp: 0 }));
    expect(merged.rewardXp).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const row = curated();
    const ov = overlay();
    mergeBlizzardOverlay(row, ov);
    expect(row).toEqual(curated());
    expect(ov).toEqual(overlay());
  });

  it('maps requirements onto prevQuestId and the class/race restrictions (L6)', () => {
    const merged = mergeBlizzardOverlay(
      curated({ prevQuestId: 77, classRestriction: null }),
      overlay({
        requirementsRaw: {
          classes: [{ id: 9, name: 'Warlock' }],
          faction: { name: 'Horde', type: 'HORDE' },
          quests: { operator: { type: 'AND' }, conditions: [{ id: 1485 }] },
        },
      }),
    );
    expect(merged.prevQuestId).toBe(1485);
    expect(merged.classRestriction).toEqual(['Warlock']);
    expect(merged.raceRestriction).toEqual([
      'Troll',
      'Tauren',
      'Undead',
      'Orc',
    ]);
    expect(merged.requiredLevel).toBe(13);
  });

  it('keeps the curated prerequisite and restrictions for empty requirements', () => {
    for (const requirementsRaw of [{}, null]) {
      const merged = mergeBlizzardOverlay(
        curated({ prevQuestId: 77, classRestriction: ['Mage'] }),
        overlay({ requirementsRaw }),
      );
      expect(merged.prevQuestId).toBe(77);
      expect(merged.classRestriction).toEqual(['Mage']);
      expect(merged.raceRestriction).toEqual(['Orc']);
    }
  });

  it('never makes a quest its own prerequisite', () => {
    const merged = mergeBlizzardOverlay(
      curated({ prevQuestId: null }),
      overlay({ requirementsRaw: { quests: { conditions: [{ id: 1486 }] } } }),
    );
    expect(merged.prevQuestId).toBeNull();
  });
});

describe('reputation rewards (ROK-2161)', () => {
  const ironforge = { factionId: 47, name: 'Ironforge', value: 150 };

  it('maps non-zero reputations to { factionName, amount }', () => {
    const merged = mergeBlizzardOverlay(
      curated(),
      overlay({
        reputations: [
          ironforge,
          { factionId: 54, name: 'Gnomeregan', value: -25 },
        ],
      }),
    );
    expect(merged.reputationRewards).toEqual([
      { factionName: 'Ironforge', amount: 150 },
      { factionName: 'Gnomeregan', amount: -25 },
    ]);
  });

  it('omits the key when the overlay has no reputations', () => {
    const merged = mergeBlizzardOverlay(
      curated(),
      overlay({ reputations: [] }),
    );
    expect('reputationRewards' in merged).toBe(false);
  });

  it('drops zero-value reputations and omits the key when none remain', () => {
    const zero = { factionId: 47, name: 'Ironforge', value: 0 };
    expect(reputationRewardFields([zero])).toEqual({});
    expect(reputationRewardFields([zero, ironforge])).toEqual({
      reputationRewards: [{ factionName: 'Ironforge', amount: 150 }],
    });
  });

  it('drops reputations whose faction name is blank after trim', () => {
    const blank = { factionId: 72, name: '  ', value: 250 };
    expect(reputationRewardFields([blank])).toEqual({});
    expect(reputationRewardFields([blank, ironforge])).toEqual({
      reputationRewards: [{ factionName: 'Ironforge', amount: 150 }],
    });
  });
});
