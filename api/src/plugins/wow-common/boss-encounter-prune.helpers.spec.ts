import {
  findStaleClassicBossIds,
  findStaleClassicLootIds,
  findStaleForeverLootIds,
  MIN_BUNDLED_CLASSIC_BOSSES,
  MIN_BUNDLED_CLASSIC_LOOT,
  MIN_BUNDLED_FOREVER_LOOT,
  pruneStaleRows,
  type BossJsonKey,
  type BossKeyRow,
  type LootKeyRow,
} from './boss-encounter-prune.helpers';

/** `n` classic bosses on a filler instance, present in both JSON and DB. */
const fillerJson = (n: number, from = 0): BossJsonKey[] =>
  Array.from({ length: n }, (_, i) => ({
    instanceId: 9000,
    name: `Filler ${from + i}`,
    expansion: 'classic',
  }));
const fillerRows = (keys: BossJsonKey[], firstId: number): BossKeyRow[] =>
  keys.map((k, i) => ({ id: firstId + i, ...k }));

const baseJson: BossJsonKey[] = [
  { instanceId: 238, name: 'Targorr the Dread', expansion: 'classic' },
  { instanceId: 238, name: 'Hamhock', expansion: 'classic' },
  { instanceId: 238, name: 'Kam Deepfury', expansion: 'classic' },
  { instanceId: 238, name: 'Bazil Thredd', expansion: 'classic' },
  { instanceId: 249, name: 'Prince Malchezaar', expansion: 'tbc' },
];
// Padded to the absolute floor so the small fixture is a "complete" file.
const padding = fillerJson(MIN_BUNDLED_CLASSIC_BOSSES);
const json = [...baseJson, ...padding];

const rows: BossKeyRow[] = [
  { id: 1, instanceId: 238, name: 'Targorr the Dread', expansion: 'classic' },
  { id: 2, instanceId: 238, name: 'Hogger', expansion: 'classic' },
  { id: 3, instanceId: 311, name: 'Houndmaster Braun', expansion: 'classic' },
  // Not in the JSON but NOT classic: must never be a candidate.
  { id: 4, instanceId: 999, name: 'Some TBC Boss', expansion: 'tbc' },
  { id: 5, instanceId: 999, name: 'Some SoD Boss', expansion: 'sod' },
  // Same name, other instance: keyed by (instanceId, name), so stale.
  { id: 6, instanceId: 63, name: 'Hamhock', expansion: 'classic' },
  ...fillerRows(padding, 1000),
];

describe('findStaleClassicBossIds (ROK-2142)', () => {
  it('returns classic rows whose (instanceId, name) left the JSON', () => {
    expect(findStaleClassicBossIds(rows, json)).toEqual([2, 3, 6]);
  });

  it('never returns a non-classic row', () => {
    const stale = findStaleClassicBossIds(rows, json);
    expect(stale).not.toContain(4);
    expect(stale).not.toContain(5);
  });

  it('returns nothing when the JSON has no classic rows (empty-file guard)', () => {
    expect(findStaleClassicBossIds(rows, [])).toEqual([]);
    expect(
      findStaleClassicBossIds(rows, [
        { instanceId: 249, name: 'Prince Malchezaar', expansion: 'tbc' },
      ]),
    ).toEqual([]);
  });

  it('skips with a warning when the JSON is below the absolute floor even if the DB is smaller (truncated file, ROK-2168)', () => {
    const warn = jest.fn();
    // 150 classic JSON rows vs 160 stored: the old 80% ratio (150 >= 128)
    // would have pruned the 10 rows missing from the cut file.
    const cut = fillerJson(150);
    const stored = fillerRows(fillerJson(160), 1);
    expect(findStaleClassicBossIds(stored, cut, warn)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('150 classic bosses (minimum 200)'),
    );
  });
});

describe('findStaleClassicBossIds on a production-shaped DB (ROK-2168)', () => {
  // The bundled 1.12 Stockade list (instance 238).
  const stockade112 = [
    'Targorr the Dread',
    'Kam Deepfury',
    'Hamhock',
    'Bazil Thredd',
    'Dextren Ward',
  ].map((name) => ({ instanceId: 238, name, expansion: 'classic' }));
  // 220 bundled classic bosses: the five Stockade rows + 215 others.
  const bundled = [...stockade112, ...fillerJson(215)];
  // Old retail-journal Stockade rows left by pre-2142 seeds.
  const retail = ['Hogger', 'Lord Overheat', 'Randolph Moloch'].map(
    (name, i) => ({ id: 501 + i, instanceId: 238, name, expansion: 'classic' }),
  );
  // 64 more orphans (map-id rows, other retail leftovers): 220 + 3 + 64 = 287.
  const orphans = fillerRows(
    fillerJson(64, 5000).map((k) => ({ ...k, instanceId: 409 })),
    600,
  );
  const stored = [...fillerRows(bundled, 1), ...retail, ...orphans];

  it('prunes the retail Stockade bosses and keeps the five 1.12 bosses', () => {
    expect(stored.filter((r) => r.expansion === 'classic')).toHaveLength(287);
    const warn = jest.fn();
    const stale = findStaleClassicBossIds(stored, bundled, warn);
    expect(stale).toEqual(expect.arrayContaining([501, 502, 503]));
    expect(stale).toHaveLength(67);
    for (const id of [1, 2, 3, 4, 5]) expect(stale).not.toContain(id);
    expect(warn).not.toHaveBeenCalled();
  });
});

const loot: LootKeyRow[] = [
  { id: 10, bossId: 1, itemId: 100, expansion: 'classic' },
  { id: 11, bossId: 1, itemId: 151403, expansion: 'classic' }, // retail leftover
  { id: 12, bossId: 6, itemId: 200, expansion: 'classic' },
  { id: 13, bossId: 4, itemId: 300, expansion: 'tbc' }, // other expansion
  { id: 14, bossId: 5, itemId: 400, expansion: 'classic' }, // non-classic boss
];
// Filler loot on boss 1, present in both JSON and DB, padding the fixture
// to the absolute floor.
const lootPadding = Array.from(
  { length: MIN_BUNDLED_CLASSIC_LOOT },
  (_, i) => ({ bossId: 1, itemId: 50_000 + i, expansion: 'classic' }),
);
loot.push(...lootPadding.map((l, i) => ({ id: 10_000 + i, ...l })));
const wantedLoot = [
  { bossId: 1, itemId: 100, expansion: 'classic' },
  { bossId: 6, itemId: 200, expansion: 'classic' },
  { bossId: 4, itemId: 999, expansion: 'tbc' },
  ...lootPadding,
];
const classicBossIds = new Set([1, 2, 3, 6]);

describe('findStaleClassicLootIds (ROK-2142 review r1)', () => {
  it('returns classic loot on classic bosses whose (bossId, itemId) left the JSON', () => {
    expect(findStaleClassicLootIds(loot, wantedLoot, classicBossIds)).toEqual([
      11,
    ]);
  });

  it('returns nothing when the JSON has no classic loot', () => {
    const warn = jest.fn();
    expect(
      findStaleClassicLootIds(
        loot,
        wantedLoot.filter((l) => l.expansion !== 'classic'),
        classicBossIds,
        warn,
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('prunes when the DB holds far more loot than the JSON (accumulated history, ROK-2168)', () => {
    // 2000 old classic loot rows on boss 2 (a stale boss still live in this
    // call): the old 50% ratio skipped once stored > 2x wanted.
    const history = Array.from({ length: 2000 }, (_, i) => ({
      id: 20_000 + i,
      bossId: 2,
      itemId: 70_000 + i,
      expansion: 'classic',
    }));
    const warn = jest.fn();
    const stale = findStaleClassicLootIds(
      [...loot, ...history],
      wantedLoot,
      classicBossIds,
      warn,
    );
    expect(stale).toHaveLength(2001);
    expect(stale).toContain(11);
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips with a warning when the JSON classic loot is below the absolute floor', () => {
    const warn = jest.fn();
    // 1 wanted classic row, below the 600-row floor.
    expect(
      findStaleClassicLootIds(
        loot,
        wantedLoot.slice(0, 1),
        classicBossIds,
        warn,
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('1 classic loot rows (minimum 600)'),
    );
  });
});

// Forever loot hangs off the CLASSIC boss rows (1, 6); 4 is a tbc boss.
const liveBossIds = new Set([1, 4, 6]);
// Bundled forever rows on classic boss 1, padded to the absolute floor.
const bundled = Array.from({ length: MIN_BUNDLED_FOREVER_LOOT }, (_, i) => ({
  bossId: 1,
  itemId: 80_000 + i,
  expansion: 'forever',
}));
const storedBundled: LootKeyRow[] = bundled.map((l, i) => ({
  id: 30_000 + i,
  ...l,
}));
const classicOnBoss1: LootKeyRow[] = [
  { id: 40, bossId: 1, itemId: 100, expansion: 'classic' },
  { id: 41, bossId: 1, itemId: 151403, expansion: 'classic' },
];

describe('findStaleForeverLootIds (ROK-2170 D7)', () => {
  it('prunes nothing when every stored forever row is bundled on its classic boss', () => {
    const warn = jest.fn();
    const stored = [...classicOnBoss1, ...storedBundled];
    expect(findStaleForeverLootIds(stored, bundled, liveBossIds, warn)).toEqual(
      [],
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('prunes an extra stored forever row on a live boss and leaves the classic rows on it alone', () => {
    const stray = [
      { id: 50, bossId: 1, itemId: 99_999, expansion: 'forever' },
      { id: 51, bossId: 4, itemId: 99_998, expansion: 'forever' },
    ];
    const stored = [...classicOnBoss1, ...storedBundled, ...stray];
    expect(findStaleForeverLootIds(stored, bundled, liveBossIds)).toEqual([
      50, 51,
    ]);
  });

  it('ignores forever rows on a boss that is not live', () => {
    const orphan = { id: 52, bossId: 77, itemId: 1, expansion: 'forever' };
    expect(
      findStaleForeverLootIds([...storedBundled, orphan], bundled, liveBossIds),
    ).toEqual([]);
  });

  it('skips with a warning when the JSON forever loot is below the absolute floor', () => {
    const warn = jest.fn();
    const stray = { id: 50, bossId: 1, itemId: 99_999, expansion: 'forever' };
    expect(
      findStaleForeverLootIds(
        [...storedBundled, stray],
        bundled.slice(0, 5),
        liveBossIds,
        warn,
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('5 forever loot rows (minimum 200)'),
    );
  });

  it('never crosses expansions: classic rows are not forever candidates and vice versa', () => {
    // Same (bossId, itemId) stored under both expansions; wanted lists only
    // carry the OTHER expansion's key for the cross-check.
    const both: LootKeyRow[] = [
      { id: 60, bossId: 1, itemId: 555, expansion: 'classic' },
      { id: 61, bossId: 1, itemId: 555, expansion: 'forever' },
      ...storedBundled,
      ...loot,
    ];
    const foreverStale = findStaleForeverLootIds(both, bundled, liveBossIds);
    expect(foreverStale).toEqual([61]);
    const classicStale = findStaleClassicLootIds(
      both,
      [...wantedLoot, ...bundled],
      classicBossIds,
    );
    expect(classicStale).toEqual([60, 11]);
    expect(classicStale.some((id) => id >= 30_000 && id < 40_000)).toBe(false);
  });
});

function mockDb() {
  const where = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockReturnValue({ where });
  const tx = { delete: del };
  const transaction = jest.fn((fn: (t: typeof tx) => Promise<void>) => fn(tx));
  return { db: { transaction, delete: jest.fn() } as never, transaction, del };
}

describe('pruneStaleRows (ROK-2142)', () => {
  it('deletes stale loot and bosses inside ONE transaction', async () => {
    const { db, transaction, del } = mockDb();
    await pruneStaleRows(db, [2, 3], [11]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('opens no transaction when nothing is stale', async () => {
    const { db, transaction } = mockDb();
    await pruneStaleRows(db, [], []);
    expect(transaction).not.toHaveBeenCalled();
  });
});
