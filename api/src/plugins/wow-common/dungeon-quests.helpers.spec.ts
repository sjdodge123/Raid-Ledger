/**
 * ROK-2170: quest rewards resolved through the boss-loot table never mix
 * Classic and Forever rows — Forever wins under WoW: Forever, and Classic
 * variants never read it.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { buildItemDetailsMap } from './dungeon-quests.helpers';

jest.mock('./dungeon-quests.item-meta', () => ({
  mergeItemMetaFallback: jest.fn().mockResolvedValue(undefined),
}));

type LootRow = {
  itemId: number;
  itemName: string;
  quality: string;
  slot: string | null;
  itemLevel: number | null;
  iconUrl: string | null;
  itemSubclass: string | null;
  expansion: string;
};

const CLASSIC_6903: LootRow = {
  itemId: 6903,
  itemName: 'Gaze Dreamer Pants',
  quality: 'Uncommon',
  slot: 'Legs',
  itemLevel: 23,
  iconUrl: null,
  itemSubclass: 'Cloth',
  expansion: 'classic',
};
const FOREVER_6903: LootRow = {
  ...CLASSIC_6903,
  quality: 'Rare',
  itemLevel: 28,
  expansion: 'forever',
};

/** A db whose loot select resolves `rows` in the given (DB) order. */
function fakeDb(rows: LootRow[]): PostgresJsDatabase<typeof schema> {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { select } as unknown as PostgresJsDatabase<typeof schema>;
}

async function resolve6903(rows: LootRow[], preferForever: boolean) {
  const map = await buildItemDetailsMap(
    fakeDb(rows),
    new Set([6903]),
    {},
    preferForever,
  );
  return map.get(6903);
}

describe('buildItemDetailsMap — Classic vs Forever loot rows (ROK-2170)', () => {
  it('prefers the Forever row whatever order the DB returns', async () => {
    for (const rows of [
      [CLASSIC_6903, FOREVER_6903],
      [FOREVER_6903, CLASSIC_6903],
    ]) {
      const item = await resolve6903(rows, true);
      expect(item).toMatchObject({ quality: 'Rare', itemLevel: 28 });
      expect(item).not.toHaveProperty('expansion');
    }
  });

  it('never uses a Forever row for a Classic variant', async () => {
    for (const rows of [[FOREVER_6903, CLASSIC_6903], [FOREVER_6903]]) {
      const item = await resolve6903(rows, false);
      if (rows.length === 1) expect(item).toBeUndefined();
      else expect(item).toMatchObject({ quality: 'Uncommon', itemLevel: 23 });
    }
  });
});
