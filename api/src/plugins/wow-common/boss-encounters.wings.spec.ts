import bossData from './data/boss-encounter-data.json';
import { resolveSubInstance, wingBossSets } from './boss-encounters.wings';

const namesOf = (id: number): string[] => [
  ...(resolveSubInstance(id).wingBossNames ?? []),
];

describe('resolveSubInstance (ROK-2210: wing parents from the catalogue)', () => {
  it.each([
    [31601, 316, ['Interrogator Vishas', 'Bloodmage Thalnos']],
    [31603, 316, ['Herod']],
    [23203, 232, ['Tinkerer Gizlock', 'Rotgrip', 'Princess Theradras']],
  ])(
    'filters synthetic wing %i to its parent %i bosses',
    (id, parent, names) => {
      expect(resolveSubInstance(id).queryId).toBe(parent);
      expect(namesOf(id)).toEqual(names);
    },
  );

  it('resolves Upper Blackrock Spire (22901) to the five UBRS bosses on 229', () => {
    expect(resolveSubInstance(22901).queryId).toBe(229);
    expect(namesOf(22901)).toEqual([
      'Pyroguard Emberseer',
      'Solakar Flamewreath',
      'Warchief Rend Blackhand',
      'The Beast',
      'General Drakkisath',
    ]);
  });

  it.each([1276, 1277, 1292])(
    'keeps journal wing %i on its own boss rows (no parent redirect)',
    (id) => {
      expect(resolveSubInstance(id)).toEqual({ queryId: id });
    },
  );

  it.each([229, 316, 741, 90000001, 424242])(
    'queries a non-wing id %i as-is with no filter',
    (id) => {
      expect(resolveSubInstance(id)).toEqual({ queryId: id });
    },
  );

  it('names only bosses the classic boss data files under each wing parent', () => {
    const missing = wingBossSets().flatMap(([key, names]) => {
      const parent = Number(key.split(':')[0]);
      const onParent = new Set(
        bossData
          .filter((b) => b.instanceId === parent && b.expansion === 'classic')
          .map((b) => b.name),
      );
      return [...names]
        .filter((n) => !onParent.has(n))
        .map((n) => `${key} ${n}`);
    });
    expect(missing).toEqual([]);
  });
});
