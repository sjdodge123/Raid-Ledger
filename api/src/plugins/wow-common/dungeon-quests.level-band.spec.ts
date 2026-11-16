/**
 * ROK-1908: the band an imported-only quest shows follows the guild's game
 * variant — a Classic guild never shows the Forever finder span.
 */
import { getInstance } from './instance-catalogue/instance-catalogue';
import { instanceLevelBand } from './dungeon-quests.level-band';

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
