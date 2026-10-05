import { INSTANCE_SHORT_NAMES } from './blizzard-instance-data';
import {
  FOREVER_INSTANCES,
  FOREVER_SEED_ID_BASE,
  findForeverSeedInstance,
  foreverSeedOnlyList,
  isForeverSeedId,
  mergeForeverSeed,
  normalizeInstanceName,
} from './forever-instance-data';

/** ROK-1719: hand-seeded WoW: Forever instances. */
describe('FOREVER_INSTANCES seed (ROK-1719)', () => {
  const dungeons = FOREVER_INSTANCES.filter((i) => i.category === 'dungeon');
  const raids = FOREVER_INSTANCES.filter((i) => i.category === 'raid');

  it('has 9 dungeons and 2 raids, all labelled Forever', () => {
    expect(dungeons).toHaveLength(9);
    expect(raids.map((r) => r.name)).toEqual(['Barrow Deeps', 'Hyjal Summit']);
    expect(new Set(FOREVER_INSTANCES.map((i) => i.expansion))).toEqual(
      new Set(['Forever']),
    );
  });

  it('uses unique ids inside the reserved range, clear of synthetic wings', () => {
    const ids = FOREVER_INSTANCES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      Array.from({ length: 11 }, (_, n) => FOREVER_SEED_ID_BASE + n + 1),
    );
    for (const id of ids) {
      expect(id).toBeGreaterThan(10000);
      expect(isForeverSeedId(id)).toBe(true);
      expect(id).toBeLessThanOrEqual(2 ** 31 - 1); // Postgres integer
    }
  });

  it('gives Hyjal Summit Forever levels (60), not the TBC override (70)', () => {
    const hyjal = raids.find((r) => r.name === 'Hyjal Summit');
    expect(hyjal).toMatchObject({ minimumLevel: 60, maximumLevel: 60 });
    expect(hyjal?.maxPlayers).toBe(20);
    expect(raids.find((r) => r.name === 'Barrow Deeps')?.maxPlayers).toBe(10);
  });

  it('uses short names that collide with no existing instance short name', () => {
    const taken = new Set(Object.values(INSTANCE_SHORT_NAMES));
    const clashes = FOREVER_INSTANCES.filter((i) => taken.has(i.shortName!));
    expect(clashes.map((i) => `${i.name} -> ${i.shortName}`)).toEqual([]);
    const own = FOREVER_INSTANCES.map((i) => i.shortName);
    expect(new Set(own).size).toBe(own.length);
  });
});

describe('isForeverSeedId / findForeverSeedInstance (ROK-1719)', () => {
  it('resolves seeded ids to their detail', () => {
    expect(findForeverSeedInstance(90_000_001)).toMatchObject({
      name: 'Hall of Thanes',
      category: 'dungeon',
      maxPlayers: 5,
      minimumLevel: 13,
      maximumLevel: 18,
    });
    expect(findForeverSeedInstance(90_000_011)).toMatchObject({
      name: 'Hyjal Summit',
      category: 'raid',
      maxPlayers: 20,
    });
  });

  it('returns null outside the seed (journal, synthetic, unused range ids)', () => {
    expect(isForeverSeedId(FOREVER_SEED_ID_BASE)).toBe(false);
    expect(findForeverSeedInstance(316)).toBeNull();
    expect(findForeverSeedInstance(31601)).toBeNull();
    expect(findForeverSeedInstance(90_000_500)).toBeNull();
  });
});

describe('mergeForeverSeed — journal wins (ROK-1719)', () => {
  const vanilla = [{ id: 1, name: 'Molten Core', expansion: 'Classic' }];

  it('appends the seeded raids after the journal list, list-shaped', () => {
    const merged = mergeForeverSeed(vanilla, 'raid');
    expect(merged.map((r) => r.name)).toEqual([
      'Molten Core',
      'Barrow Deeps',
      'Hyjal Summit',
    ]);
    expect(merged[1]).not.toHaveProperty('maxPlayers');
    expect(merged[1]).not.toHaveProperty('category');
  });

  it('drops a seed row the journal already exposes as Forever, after normalizing', () => {
    const journal = [
      ...vanilla,
      { id: 5000, name: 'The Barrow Deeps', expansion: 'Forever' },
    ];
    const names = mergeForeverSeed(journal, 'raid').map((r) => r.name);
    expect(names).toEqual(['Molten Core', 'The Barrow Deeps', 'Hyjal Summit']);
  });

  it('keeps a journal Forever Hyjal Summit id but the seed 60-60 levels', () => {
    const journal = [{ id: 5001, name: 'Hyjal Summit', expansion: 'Forever' }];
    expect(mergeForeverSeed(journal, 'raid')).toEqual([
      {
        id: 5001,
        name: 'Hyjal Summit',
        shortName: 'HS',
        expansion: 'Forever',
        minimumLevel: 60,
        maximumLevel: 60,
      },
      expect.objectContaining({ id: 90_000_010, name: 'Barrow Deeps' }),
    ]);
  });

  it('never lets a non-Forever row (TBC Hyjal Summit) suppress the seed', () => {
    const journal = [
      { id: 750, name: 'Hyjal Summit', expansion: 'Burning Crusade' },
    ];
    const merged = mergeForeverSeed(journal, 'raid');
    expect(merged.filter((r) => r.name === 'Hyjal Summit')).toHaveLength(2);
    expect(merged.some((r) => r.id === 90_000_011)).toBe(true);
  });

  it('normalizes "the", case and punctuation', () => {
    expect(normalizeInstanceName("The Krol'dok  Stronghold")).toBe(
      normalizeInstanceName("krol'dok stronghold"),
    );
    expect(normalizeInstanceName('Drowned City')).toBe(
      normalizeInstanceName('The Drowned City'),
    );
  });

  it('builds a seed-only list for the degraded path', () => {
    const { dungeons, raids } = foreverSeedOnlyList();
    expect(dungeons).toHaveLength(9);
    expect(raids).toHaveLength(2);
  });
});
