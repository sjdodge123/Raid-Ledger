import {
  findStaleClassicBossIds,
  pruneStaleClassicBosses,
  type BossKeyRow,
} from './boss-encounter-prune.helpers';

const json = [
  { instanceId: 238, name: 'Targorr the Dread', expansion: 'classic' },
  { instanceId: 238, name: 'Hamhock', expansion: 'classic' },
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
});

function mockDb() {
  const where = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockReturnValue({ where });
  return { db: { delete: del } as never, del, where };
}

describe('pruneStaleClassicBosses (ROK-2142)', () => {
  it('deletes loot then bosses for the stale ids and returns them', async () => {
    const { db, del, where } = mockDb();
    const pruned = await pruneStaleClassicBosses(db, rows, json);
    expect([...pruned]).toEqual([2, 3, 6]);
    expect(del).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
  });

  it('issues no delete when nothing is stale', async () => {
    const { db, del } = mockDb();
    const pruned = await pruneStaleClassicBosses(db, rows.slice(0, 1), json);
    expect(pruned.size).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });
});
