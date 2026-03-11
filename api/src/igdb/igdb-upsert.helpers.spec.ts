/**
 * Unit tests for igdb-upsert.helpers.ts — upsertSingleGameRow and upsertGamesFromApi.
 */
import { upsertSingleGameRow } from './igdb-upsert.helpers';
import { mapApiGameToDbRow } from './igdb.mappers';

/** Minimal mock DB that tracks insert/update calls for upsertSingleGameRow. */
function createUpsertMockDb() {
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = jest.fn().mockReturnValue({ values });

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  return { insert, values, onConflictDoUpdate, update, updateSet, updateWhere };
}

describe('upsertSingleGameRow', () => {
  it('inserts a normal game without calling update', async () => {
    const mock = createUpsertMockDb();
    const row = mapApiGameToDbRow({
      id: 100,
      name: 'Valheim',
      slug: 'valheim',
    });

    await upsertSingleGameRow(mock as never, row);

    expect(mock.insert).toHaveBeenCalledTimes(1);
    expect(mock.update).not.toHaveBeenCalled();
  });

  it('does NOT auto-hide WoW Classic variant slugs', async () => {
    const wowVariantSlugs = [
      'world-of-warcraft-classic-the-burning-crusade',
      'world-of-warcraft-classic-anniversary',
      'world-of-warcraft-classic-burning-crusade-classic',
    ];

    for (const slug of wowVariantSlugs) {
      const mock = createUpsertMockDb();
      const row = mapApiGameToDbRow({
        id: 9000,
        name: `WoW Variant (${slug})`,
        slug,
      });

      await upsertSingleGameRow(mock as never, row);

      expect(mock.update).not.toHaveBeenCalled();
    }
  });
});
