/**
 * Unit tests for igdb-upsert.helpers.ts — upsertSingleGameRow and upsertGamesFromApi.
 */
import { upsertSingleGameRow, upsertGamesFromApi } from './igdb-upsert.helpers';
import { mapApiGameToDbRow } from './igdb.mappers';
import type { IgdbApiGame } from './igdb.constants';

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

// ============================================================================
// Batch upsert mock infrastructure (ROK-1024)
// ============================================================================

interface SelectCall {
  type: 'banned' | 'steamMerge' | 'finalFetch';
  result: unknown[];
}

/**
 * Mock DB for batch upsert tests. Records each SELECT call with its intent
 * and returns canned results in call order. Also counts INSERT and UPDATE
 * invocations so tests can assert ONE INSERT for the batch.
 */
function createBatchUpsertMockDb(selectQueue: SelectCall[]) {
  const calls = {
    selectCount: 0,
    insertCount: 0,
    updateCount: 0,
  };

  // select chain: .select().from().where() — terminates at where() (awaited)
  const buildSelectChain = () => {
    const queued = selectQueue[calls.selectCount] ?? { result: [] };
    calls.selectCount++;
    const where = jest.fn().mockResolvedValue(queued.result);
    const from = jest.fn().mockReturnValue({ where });
    return { from };
  };
  const select = jest.fn().mockImplementation(() => buildSelectChain());

  // insert chain: .insert().values().onConflictDoUpdate()
  const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = jest.fn().mockImplementation(() => {
    calls.insertCount++;
    return { values };
  });

  // update chain: .update().set().where()
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockImplementation(() => {
    calls.updateCount++;
    return { set: updateSet };
  });

  return {
    db: { select, insert, update } as unknown,
    calls,
    insertMock: insert,
    updateMock: update,
    selectMock: select,
    valuesMock: values,
    onConflictMock: onConflictDoUpdate,
  };
}

/** Inspect a Drizzle SQL value by serializing its chunks to a readable string. */
function sqlToString(value: unknown): string {
  if (value == null) return String(value);
  const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return JSON.stringify(value);
  return chunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk;
      if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        return String((chunk as { value: unknown[] }).value.join(''));
      }
      return '';
    })
    .join('');
}

function makeApiGame(overrides: Partial<IgdbApiGame>): IgdbApiGame {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'Test Game',
    slug: overrides.slug ?? 'test-game',
    ...overrides,
  };
}

describe('upsertGamesFromApi (batch path — ROK-1024)', () => {
  it('returns empty array when given no games', async () => {
    const { db } = createBatchUpsertMockDb([]);
    const result = await upsertGamesFromApi(db as never, []);
    expect(result).toEqual([]);
  });

  it('issues ONE INSERT for many games (not N inserts)', async () => {
    const { db, calls, valuesMock } = createBatchUpsertMockDb([
      { type: 'banned', result: [] }, // no banned games
      { type: 'steamMerge', result: [] }, // no existing steam merges (but called only if any steamAppIds)
      { type: 'finalFetch', result: [] },
    ]);
    const apiGames = [
      makeApiGame({ id: 1, slug: 'g-1', name: 'G1' }),
      makeApiGame({ id: 2, slug: 'g-2', name: 'G2' }),
      makeApiGame({ id: 3, slug: 'g-3', name: 'G3' }),
      makeApiGame({ id: 4, slug: 'g-4', name: 'G4' }),
      makeApiGame({ id: 5, slug: 'g-5', name: 'G5' }),
    ];

    await upsertGamesFromApi(db as never, apiGames);

    expect(calls.insertCount).toBe(1);
    // Values called with array of all 5 rows
    const valuesArg = valuesMock.mock.calls[0][0];
    expect(Array.isArray(valuesArg)).toBe(true);
    expect(valuesArg).toHaveLength(5);
  });

  it('uses at most ONE SELECT for steamAppId merge pre-check (not N SELECTs)', async () => {
    // Simulate 3 games, all with steamAppIds — old code would do 3 per-row SELECTs
    // on top of the banned-check SELECT and final-fetch SELECT.
    const apiGamesWithSteam: IgdbApiGame[] = [
      {
        id: 10,
        slug: 's-10',
        name: 'Steam Game 10',
        external_games: [{ category: 1, uid: '100' }],
      },
      {
        id: 20,
        slug: 's-20',
        name: 'Steam Game 20',
        external_games: [{ category: 1, uid: '200' }],
      },
      {
        id: 30,
        slug: 's-30',
        name: 'Steam Game 30',
        external_games: [{ category: 1, uid: '300' }],
      },
    ];
    const { db, calls } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'steamMerge', result: [] }, // single batched steam merge pre-check
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGamesWithSteam);

    // banned-check (1) + steam-merge-check (1) + final fetch (1) = 3 total
    expect(calls.selectCount).toBe(3);
  });

  it('skips the steam merge SELECT entirely when no rows have steamAppId', async () => {
    const apiGames = [
      makeApiGame({ id: 1, slug: 'g-1', name: 'G1' }),
      makeApiGame({ id: 2, slug: 'g-2', name: 'G2' }),
    ];
    const { db, calls } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    // banned-check (1) + final fetch (1) = 2 (no steam merge SELECT)
    expect(calls.selectCount).toBe(2);
  });

  it('handles mixed new and existing (via steamAppId) games — merges existing, inserts new', async () => {
    // Two games with steamAppId: game 200 already exists (pre-enriched via ITAD),
    // game 300 is new. Game 100 has no steamAppId (pure IGDB).
    const apiGames: IgdbApiGame[] = [
      { id: 100, slug: 'p-100', name: 'Pure IGDB' },
      {
        id: 200,
        slug: 's-200',
        name: 'Existing ITAD',
        external_games: [{ category: 1, uid: '2000' }],
      },
      {
        id: 300,
        slug: 's-300',
        name: 'New Steam',
        external_games: [{ category: 1, uid: '3000' }],
      },
    ];
    // Existing row: steamAppId=2000 with no igdbId, id=77
    const { db, calls } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'steamMerge', result: [{ id: 77, steamAppId: 2000 }] },
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    // One UPDATE for the merged-by-steam row (id=77)
    expect(calls.updateCount).toBe(1);
    // One INSERT for the remaining two rows (100 + 300)
    expect(calls.insertCount).toBe(1);
  });

  it('filters banned games before attempting the batch insert', async () => {
    const apiGames = [
      makeApiGame({ id: 50, slug: 'banned', name: 'Banned' }),
      makeApiGame({ id: 51, slug: 'ok', name: 'OK' }),
    ];
    const { db, calls, valuesMock } = createBatchUpsertMockDb([
      { type: 'banned', result: [{ igdbId: 50 }] }, // igdb=50 is banned
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    expect(calls.insertCount).toBe(1);
    const valuesArg = valuesMock.mock.calls[0][0];
    expect(Array.isArray(valuesArg)).toBe(true);
    // Only game 51 survives the banned filter
    expect(valuesArg).toHaveLength(1);
    expect(valuesArg[0].igdbId).toBe(51);
  });

  it('early-exits when all games are banned (no insert, no final fetch)', async () => {
    const apiGames = [makeApiGame({ id: 50, slug: 'banned', name: 'Banned' })];
    const { db, calls } = createBatchUpsertMockDb([
      { type: 'banned', result: [{ igdbId: 50 }] },
    ]);

    const result = await upsertGamesFromApi(db as never, apiGames);

    expect(result).toEqual([]);
    expect(calls.insertCount).toBe(0);
  });

  it('batch SET clause references excluded.* (not first-row hardcoded values)', async () => {
    // This guards against a classic batch-upsert bug: using the first row's
    // values in the SET clause, which would overwrite ALL conflicting rows
    // with the first row's data. The fix uses sql`excluded.<column>` so each
    // row's own values survive the ON CONFLICT update.
    const apiGames = [
      makeApiGame({ id: 1, slug: 'row-a', name: 'Row A' }),
      makeApiGame({ id: 2, slug: 'row-b', name: 'Row B' }),
    ];
    const { db, onConflictMock } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    expect(onConflictMock).toHaveBeenCalledTimes(1);
    const conflictArg = onConflictMock.mock.calls[0][0];
    const setObj = conflictArg.set as Record<string, unknown>;

    // Every field in the set should be a SQL chunk, not a literal value
    for (const key of ['name', 'slug', 'coverUrl', 'summary']) {
      const serialized = sqlToString(setObj[key]);
      expect(serialized).toContain('excluded.');
    }
    // The first-row values must NOT appear as literal JS strings in the set
    expect(setObj.name).not.toBe('Row A');
    expect(setObj.slug).not.toBe('row-a');
  });
});
