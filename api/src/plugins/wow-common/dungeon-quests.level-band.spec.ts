/**
 * ROK-1908: the band an imported-only quest shows follows the guild's game
 * variant — a Classic guild never shows the Forever finder span.
 */
import { getInstance } from './instance-catalogue/instance-catalogue';
import {
  instanceLevelBand,
  withLevelBandFallback,
} from './dungeon-quests.level-band';
import type { DungeonQuestDto } from './dungeon-quests.types';

const WAILING_CAVERNS = 240;

function bandOf(variant: 'classic_era' | 'wow_forever') {
  const row = getInstance(WAILING_CAVERNS, variant);
  if (!row) throw new Error(`no ${variant} catalogue row for 240`);
  return { min: row.minimumLevel, max: row.maximumLevel };
}

describe('instanceLevelBand', () => {
  it('reads the Forever row for a Forever guild', () => {
    expect(instanceLevelBand(WAILING_CAVERNS, 'wow_forever')).toEqual(
      bandOf('wow_forever'),
    );
  });

  it.each(['classic_era', 'classic_era_sod', 'classic_anniversary', 'classic'])(
    'reads the classic_era row for a %s guild',
    (variant) => {
      expect(instanceLevelBand(WAILING_CAVERNS, variant)).toEqual(
        bandOf('classic_era'),
      );
    },
  );

  it('the two rows differ, so the variant choice is observable', () => {
    expect(bandOf('classic_era')).not.toEqual(bandOf('wow_forever'));
  });

  it('returns null with no dungeon', () => {
    expect(instanceLevelBand(null, 'classic_era')).toBeNull();
  });
});

// ROK-2221: a quest bundled from an overlay-only card has no level, so it
// keeps the same catalogue band overlayOnlyDto gave the card.
describe('withLevelBandFallback', () => {
  const curated = (over: Partial<DungeonQuestDto> = {}): DungeonQuestDto => ({
    questId: 962,
    dungeonInstanceId: WAILING_CAVERNS,
    name: 'Serpentbloom',
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
    raceRestriction: null,
    startsInsideDungeon: false,
    sharable: true,
    rewardXp: null,
    rewardGold: null,
    rewardType: 'none',
    ...over,
  });

  it('gives a level-less curated row the band its overlay card showed', () => {
    expect(withLevelBandFallback(curated(), 'classic_era').levelBand).toEqual(
      instanceLevelBand(WAILING_CAVERNS, 'classic_era'),
    );
    expect(withLevelBandFallback(curated()).levelBand).toEqual(
      bandOf('wow_forever'),
    );
  });

  it('follows the guild variant', () => {
    expect(withLevelBandFallback(curated(), 'classic').levelBand).toEqual(
      bandOf('classic_era'),
    );
  });

  it('leaves a row with a level unchanged (no levelBand key)', () => {
    const row = withLevelBandFallback(curated({ questLevel: 22 }), 'classic');
    expect(row).not.toHaveProperty('levelBand');
    const req = withLevelBandFallback(
      curated({ requiredLevel: 10 }),
      'classic',
    );
    expect(req).not.toHaveProperty('levelBand');
  });

  it('leaves an outside step (no dungeon) without a band', () => {
    const row = withLevelBandFallback(curated({ dungeonInstanceId: null }));
    expect(row).not.toHaveProperty('levelBand');
  });
});
