/**
 * ROK-2186: quest rewards carry the parsed `wow_item_meta` tooltip so the
 * shared ItemCompareRow can show stat deltas — one batched select, and the
 * shared reward lookup objects are never mutated.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EnrichedQuestReward, ItemTooltip } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { attachItemTooltips } from './dungeon-quests.item-meta';

const TOOLTIP: ItemTooltip = {
  env: 4,
  slotLabel: 'Wrist',
  subclass: 'Leather',
  binding: 'Binds when picked up',
  unique: false,
  requiredLevel: 52,
  armor: 61,
  weapon: null,
  stats: [{ key: 'AGILITY', name: 'Agility', value: 9 }],
  effects: [],
  setName: null,
  randomEnchant: false,
};

const REWARD: EnrichedQuestReward = {
  itemId: 11962,
  itemName: 'Manacle Cuffs',
  quality: 'Uncommon',
  slot: 'WRIST',
  itemLevel: 57,
  iconUrl: null,
  itemSubclass: 'Leather',
};

/** A db whose single select resolves `rows`; exposes the spies. */
function fakeDb(rows: Array<{ itemId: number; tooltip: ItemTooltip | null }>) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const db = { select } as unknown as PostgresJsDatabase<typeof schema>;
  return { db, select, where };
}

describe('attachItemTooltips (ROK-2186)', () => {
  it('attaches each cached tooltip with ONE select for every reward id', async () => {
    const lookup = { ...REWARD };
    const map = new Map([
      [11962, lookup],
      [11866, { ...REWARD, itemId: 11866 }],
    ]);
    const { db, select, where } = fakeDb([{ itemId: 11962, tooltip: TOOLTIP }]);
    await attachItemTooltips(db, map);
    expect(select).toHaveBeenCalledTimes(1);
    const cond = where.mock.calls[0]?.[0] as SQL;
    const { params } = new PgDialect().sqlToQuery(cond);
    expect(params).toEqual([11962, 11866]);
    expect(map.get(11962)?.tooltip).toEqual(TOOLTIP);
    expect(map.get(11866)?.tooltip).toBeUndefined();
    expect(lookup.tooltip).toBeUndefined();
  });

  it('an empty map runs no query', async () => {
    const { db, select } = fakeDb([]);
    await attachItemTooltips(db, new Map());
    expect(select).not.toHaveBeenCalled();
  });
});
