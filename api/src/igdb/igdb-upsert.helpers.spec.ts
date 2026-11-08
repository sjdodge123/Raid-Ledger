/**
 * Unit tests for igdb-upsert.helpers.ts — upsertSingleGameRow and upsertGamesFromApi.
 */
import {
  upsertSingleGameRow,
  upsertGamesFromApi,
  backfillMissingCovers,
} from './igdb-upsert.helpers';
import { Logger } from '@nestjs/common';
import { withMockTransaction } from '../common/testing/drizzle-mock';
import { mapApiGameToDbRow } from './igdb.mappers';
import { at } from '../common/testing/narrow';
import type { IgdbApiGame } from './igdb.constants';

/** Minimal mock DB that tracks insert/update calls for upsertSingleGameRow. */
function createUpsertMockDb() {
  // ROK-1438: the insert now ends in .returning({ id }) so the id resolves
  // without the follow-up SELECT the old code needed.
  const returning = jest.fn().mockResolvedValue([{ id: 1 }]);
  const onConflictDoUpdate = jest.fn().mockReturnValue({ returning });
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = jest.fn().mockReturnValue({ values });

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set: updateSet });

  // ROK-1113: select() chain used by mergeByNormalizedName.
  // Default: prefilter returns no candidates → no-op.
  const where = jest.fn().mockResolvedValue([]);
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });

  // ROK-1438: withGameNameLock opens a transaction and issues the lock SELECT.
  return withMockTransaction({
    insert,
    values,
    onConflictDoUpdate,
    returning,
    update,
    updateSet,
    updateWhere,
    select,
    from,
    where,
  });
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
  type: 'banned' | 'steamMerge' | 'nameMerge' | 'keyOwners' | 'finalFetch';
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
    // ROK-1438: withGameNameLock opens a transaction and issues the lock SELECT.
    db: withMockTransaction({ select, insert, update }) as unknown,
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
      // Nested SQL (e.g. the ROK-1643 seed-owned CASE wrapper) — recurse so
      // an `excluded.*` inside it is still seen.
      if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
        return sqlToString(chunk);
      }
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
      // no steamMerge SELECT — none of these rows have steamAppId
      { type: 'nameMerge', result: [] }, // ROK-1113 normalized-name pre-check
      { type: 'keyOwners', result: [] }, // ROK-2120 unique-key owner pre-check
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
      { type: 'nameMerge', result: [] }, // ROK-1113 normalized-name pre-check
      { type: 'keyOwners', result: [] }, // ROK-2120 unique-key owner pre-check
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGamesWithSteam);

    // banned (1) + steam-merge (1) + name-merge (1) + key-owners (1, ROK-2120)
    // + final-fetch (1) = 5
    expect(calls.selectCount).toBe(5);
  });

  it('skips the steam merge SELECT entirely when no rows have steamAppId', async () => {
    const apiGames = [
      makeApiGame({ id: 1, slug: 'g-1', name: 'G1' }),
      makeApiGame({ id: 2, slug: 'g-2', name: 'G2' }),
    ];
    const { db, calls } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'nameMerge', result: [] }, // ROK-1113 normalized-name pre-check
      { type: 'keyOwners', result: [] }, // ROK-2120 unique-key owner pre-check
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    // banned (1) + name-merge (1) + key-owners (1, ROK-2120) + final-fetch (1)
    // = 4 (no steam merge SELECT)
    expect(calls.selectCount).toBe(4);
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
      { type: 'nameMerge', result: [] }, // ROK-1113 — no name matches
      { type: 'keyOwners', result: [] }, // ROK-2120 unique-key owner pre-check
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
      { type: 'nameMerge', result: [] }, // ROK-1113
      { type: 'keyOwners', result: [] }, // ROK-2120 unique-key owner pre-check
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
      { type: 'nameMerge', result: [] }, // ROK-1113
      { type: 'keyOwners', result: [] }, // ROK-2120 unique-key owner pre-check
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

describe('upsertGamesFromApi — unique-key collisions (ROK-2120)', () => {
  afterEach(() => jest.restoreAllMocks());

  const apiGames: IgdbApiGame[] = [
    { id: 100, slug: 'p-100', name: 'Pure IGDB' },
    {
      id: 200,
      slug: 's-200',
      name: 'Existing ITAD',
      external_games: [{ category: 1, uid: '2000' }],
    },
  ];

  it('skips a steamAppId merge whose igdb_id another row owns and reports the pair', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    // Row 77 is the ITAD copy (steam 2000, no igdb id); row 55 is the
    // IGDB-first twin that already holds igdb_id 200.
    const { db, calls, valuesMock } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'steamMerge', result: [{ id: 77, steamAppId: 2000 }] },
      { type: 'nameMerge', result: [] },
      {
        type: 'keyOwners',
        result: [
          { id: 77, igdbId: null, slug: 'itad-200', steamAppId: 2000 },
          { id: 55, igdbId: 200, slug: 'igdb-200', steamAppId: null },
        ],
      },
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    expect(calls.updateCount).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      'IGDB duplicate pair skipped: keep=55 dup=77 key=igdb_id',
    );
    // The row is rerouted to the ON CONFLICT (igdb_id) insert so twin 55
    // still refreshes — minus the steam id row 77 holds.
    expect(warn).toHaveBeenCalledWith(
      'IGDB duplicate pair skipped: keep=77 dup=55 key=steam_app_id',
    );
    const inserted: Array<{
      igdbId: number;
      steamAppId: number | null;
    }> = at(at(valuesMock.mock.calls, 0), 0);
    expect(inserted.map((r) => [r.igdbId, r.steamAppId])).toEqual([
      [100, null],
      [200, null],
    ]);
  });

  it('drops an insert row whose slug another game holds instead of violating games_slug_unique', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { db, valuesMock } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'steamMerge', result: [] },
      { type: 'nameMerge', result: [] },
      {
        type: 'keyOwners',
        result: [{ id: 91, igdbId: null, slug: 'p-100', steamAppId: null }],
      },
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    expect(warn).toHaveBeenCalledWith(
      'IGDB duplicate pair skipped: keep=91 dup=igdb:100 key=slug',
    );
    const inserted: Array<{
      igdbId: number;
    }> = at(at(valuesMock.mock.calls, 0), 0);
    expect(inserted.map((r) => r.igdbId)).toEqual([200]);
  });

  it('names the real merge reason in the merge log (steamAppId)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { db } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'steamMerge', result: [{ id: 77, steamAppId: 2000 }] },
      { type: 'nameMerge', result: [] },
      { type: 'keyOwners', result: [] },
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, apiGames);

    expect(log.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining([
        'Merged IGDB 200 into existing game 77 by steamAppId',
      ]),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining('by normalized name'),
    );
  });
});

describe('upsertGamesFromApi — key ownership after a merge (ROK-2120 r3)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('frees the merged row’s old slug so a new game using it in the same batch is inserted', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    // Row 77 (ITAD copy, slug `old-slug`) merges with IGDB 200 by steam id
    // and takes slug `new-slug`; NEW game 300 uses the freed `old-slug`.
    const { db, valuesMock } = createBatchUpsertMockDb([
      { type: 'banned', result: [] },
      { type: 'steamMerge', result: [{ id: 77, steamAppId: 2000 }] },
      { type: 'nameMerge', result: [] },
      {
        type: 'keyOwners',
        result: [{ id: 77, igdbId: null, slug: 'old-slug', steamAppId: 2000 }],
      },
      { type: 'finalFetch', result: [] },
    ]);

    await upsertGamesFromApi(db as never, [
      {
        id: 200,
        slug: 'new-slug',
        name: 'Merged Game',
        external_games: [{ category: 1, uid: '2000' }],
      },
      { id: 300, slug: 'old-slug', name: 'Other Game' },
    ]);

    // Before the fix the stale `old-slug -> 77` claim dropped 300: [] here.
    const batches: Array<Array<{ igdbId: number }>> = valuesMock.mock.calls.map(
      (c) => c[0],
    );
    expect(batches.flat().map((r) => r.igdbId)).toEqual([300]);
  });
});

describe('backfillMissingCovers (IGDB 500-id query cap)', () => {
  /** Mock DB: select().from().where() → the missing-cover rows; update().set().where() → ok. */
  function createBackfillMockDb(rows: { igdbId: number | null }[]) {
    const where = jest.fn().mockResolvedValue(rows);
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });
    return { db: { select, update } as never, update, updateSet };
  }

  it('splits 501 missing ids into two IGDB queries and survives a rejected chunk', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ igdbId: i + 1 }));
    const { db, update, updateSet } = createBackfillMockDb(rows);
    const queryIgdb = jest
      .fn<Promise<IgdbApiGame[]>, [string]>()
      .mockRejectedValueOnce(new Error('IGDB API error: 400'))
      .mockResolvedValueOnce([
        { id: 501, cover: { image_id: 'cocxj2' } } as IgdbApiGame,
      ]);

    const backfilled = await backfillMissingCovers(db, queryIgdb);

    expect(queryIgdb).toHaveBeenCalledTimes(2);
    expect(queryIgdb.mock.calls[0]?.[0]).toMatch(
      /where id = \(1,2,.*,500\); limit 500;$/,
    );
    expect(queryIgdb.mock.calls[0]?.[0]).not.toContain(',501)');
    expect(queryIgdb.mock.calls[1]?.[0]).toMatch(
      /where id = \(501\); limit 1;$/,
    );
    expect(backfilled).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({
      coverUrl: expect.stringContaining('/cocxj2.jpg'),
    });
  });

  it('rethrows when EVERY chunk is rejected (IGDB down ≠ nothing missing)', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ igdbId: i + 1 }));
    const { db, update } = createBackfillMockDb(rows);
    const queryIgdb = jest
      .fn<Promise<IgdbApiGame[]>, [string]>()
      .mockRejectedValue(new Error('IGDB API error: 401'));

    await expect(backfillMissingCovers(db, queryIgdb)).rejects.toThrow(
      'IGDB API error: 401',
    );
    expect(queryIgdb).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 0 and never queries IGDB when nothing is missing', async () => {
    const { db } = createBackfillMockDb([]);
    const queryIgdb = jest.fn<Promise<IgdbApiGame[]>, [string]>();
    await expect(backfillMissingCovers(db, queryIgdb)).resolves.toBe(0);
    expect(queryIgdb).not.toHaveBeenCalled();
  });
});
