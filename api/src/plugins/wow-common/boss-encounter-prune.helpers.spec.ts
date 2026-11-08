import {
  findStaleClassicBossIds,
  findStaleClassicLootIds,
  pruneClassicRows,
  type BossKeyRow,
  type LootKeyRow,
} from './boss-encounter-prune.helpers';

const json = [
  { instanceId: 238, name: 'Targorr the Dread', expansion: 'classic' },
  { instanceId: 238, name: 'Hamhock', expansion: 'classic' },
  { instanceId: 238, name: 'Kam Deepfury', expansion: 'classic' },
  { instanceId: 238, name: 'Bazil Thredd', expansion: 'classic' },
  { instanceId: 249, name: 'Prince Malchezaar', expansion: 'tbc' },
];

const rows: BossKeyRow[] = [
  { id: 1, instanceId: 238, name: 'Targorr the Dread', expansion: 'classic' },
  { id: 2, instanceId: 238, name: 'Hogger', expansion: 'classic' },
  { id: 3, instanceId: 311, name: 'Houndmaster Braun', expansion: 'classic' },
  // Not in the JSON but NOT classic: must never be a candidate.
  { id: 4, instanceId: 999, name: 'Some TBC Boss', expansion: 'tbc' },
  { id: 5, instanceId: 999, name: 'Some SoD Boss', expansion: 'sod' },
  // Same name, other instance: keyed by (instanceId, name), so stale.
  { id: 6, instanceId: 63, name: 'Hamhock', expansion: 'classic' },
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

  it('skips with a warning when the JSON classic count is below 80% of the DB (truncated-file floor, review r1)', () => {
    const warn = jest.fn();
    // 2 classic JSON rows vs 4 classic DB rows → 50% < 80%.
    expect(findStaleClassicBossIds(rows, json.slice(0, 2), warn)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('2 classic bosses'),
    );
  });
});

const loot: LootKeyRow[] = [
  { id: 10, bossId: 1, itemId: 100, expansion: 'classic' },
  { id: 11, bossId: 1, itemId: 151403, expansion: 'classic' }, // retail leftover
  { id: 12, bossId: 6, itemId: 200, expansion: 'classic' },
  { id: 13, bossId: 4, itemId: 300, expansion: 'tbc' }, // other expansion
  { id: 14, bossId: 5, itemId: 400, expansion: 'classic' }, // non-classic boss
];
const wantedLoot = [
  { bossId: 1, itemId: 100, expansion: 'classic' },
  { bossId: 6, itemId: 200, expansion: 'classic' },
  { bossId: 4, itemId: 999, expansion: 'tbc' },
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
      findStaleClassicLootIds(loot, wantedLoot.slice(2), classicBossIds, warn),
    ).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('skips with a warning when the JSON classic loot is below 50% of the DB', () => {
    const warn = jest.fn();
    // 1 wanted vs 3 classic-boss classic loot rows → 33% < 50%.
    expect(
      findStaleClassicLootIds(
        loot,
        wantedLoot.slice(0, 1),
        classicBossIds,
        warn,
      ),
    ).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('1 classic loot rows'),
    );
  });
});

function mockDb() {
  const where = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockReturnValue({ where });
  const tx = { delete: del };
  const transaction = jest.fn((fn: (t: typeof tx) => Promise<void>) => fn(tx));
  return { db: { transaction, delete: jest.fn() } as never, transaction, del };
}

describe('pruneClassicRows (ROK-2142)', () => {
  it('deletes stale loot and bosses inside ONE transaction', async () => {
    const { db, transaction, del } = mockDb();
    await pruneClassicRows(db, [2, 3], [11]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('opens no transaction when nothing is stale', async () => {
    const { db, transaction } = mockDb();
    await pruneClassicRows(db, [], []);
    expect(transaction).not.toHaveBeenCalled();
  });
});
