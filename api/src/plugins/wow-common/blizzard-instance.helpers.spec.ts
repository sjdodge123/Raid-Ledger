import { filterByVariant } from './blizzard-instance.helpers';

/**
 * ROK-1563: WoW: Forever is a Classic-expansion-only variant. These cases lock
 * that in so a future edit can't quietly fall through to the retail (unfiltered)
 * branch.
 */
describe('filterByVariant — wow_forever (ROK-1563)', () => {
  const dungeons = [
    { id: 1, name: 'Deadmines', expansion: 'Classic' },
    { id: 2, name: 'Hellfire Ramparts', expansion: 'Burning Crusade' },
  ];
  const raids = [
    { id: 10, name: 'Molten Core', expansion: 'Classic' },
    { id: 11, name: 'Karazhan', expansion: 'Burning Crusade' },
  ];

  it('keeps Classic instances only', () => {
    const result = filterByVariant(dungeons, raids, 'wow_forever');
    expect(result.dungeons.map((d) => d.name)).toEqual(['Deadmines']);
    expect(result.raids.map((r) => r.name)).toEqual(['Molten Core']);
  });

  it('does not fall through to the unfiltered retail branch', () => {
    const result = filterByVariant(dungeons, raids, 'wow_forever');
    expect(result.dungeons).toHaveLength(1);
    expect(result.raids).toHaveLength(1);
  });

  it('leaves the existing variants unchanged (AC4)', () => {
    expect(filterByVariant(dungeons, raids, 'classic_era').raids).toHaveLength(
      1,
    );
    expect(
      filterByVariant(dungeons, raids, 'classic_anniversary').raids,
    ).toHaveLength(2);
    expect(filterByVariant(dungeons, raids, 'retail').raids).toHaveLength(2);
  });
});
