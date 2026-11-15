/**
 * ROK-1715 — refreshExistingGames must only select rows that HAVE an IGDB id.
 * A NULL igdb_id joined into the batch body becomes an empty slot
 * (`where id = (1,,2)`), which can fail the whole 10-row batch. The filter
 * lives in SQL, so this renders the WHERE the helper builds and asserts it.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { refreshExistingGames } from './igdb-sync.helpers';
import { upsertGamesFromApi } from './igdb-upsert.helpers';

jest.mock('./igdb-upsert.helpers', () => ({
  upsertGamesFromApi: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./igdb-api.helpers', () => ({
  delay: jest.fn().mockResolvedValue(undefined),
}));

function fakeDb(rows: { igdbId: number | null }[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const db = {
    select: jest
      .fn()
      .mockReturnValue({ from: jest.fn().mockReturnValue({ where }) }),
  };
  return { db, where };
}

describe('refreshExistingGames (ROK-1715)', () => {
  it('filters out rows with a NULL igdb_id in the select', async () => {
    const { db, where } = fakeDb([]);
    await refreshExistingGames(db as never, jest.fn(), '');
    const cond = where.mock.calls[0][0] as SQL;
    const rendered = new PgDialect().sqlToQuery(cond).sql;
    expect(rendered).toContain('"games"."igdb_id" is not null');
  });

  it('sends only the selected ids, comma-joined, with no empty slot', async () => {
    const { db } = fakeDb([{ igdbId: 101 }, { igdbId: 417650 }]);
    const queryIgdb = jest.fn().mockResolvedValue([]);
    await refreshExistingGames(db as never, queryIgdb, '');
    expect(queryIgdb).toHaveBeenCalledTimes(1);
    expect(queryIgdb.mock.calls[0][0]).toContain('where id = (101,417650)');
  });
});

describe('refreshExistingGames batch retry (prod logs 2026-11-09..11)', () => {
  const timeout = () =>
    Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });

  it('retries a timed-out batch once and upserts + counts its games', async () => {
    const { db } = fakeDb([{ igdbId: 101 }]);
    const games = [{ id: 101, name: 'Valheim' }];
    const queryIgdb = jest
      .fn()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(games);
    const refreshed = await refreshExistingGames(db as never, queryIgdb, '');
    expect(queryIgdb).toHaveBeenCalledTimes(2);
    expect(upsertGamesFromApi).toHaveBeenLastCalledWith(db, games, undefined);
    expect(refreshed).toBe(1);
  });

  it('does not retry a non-transient error and drops the batch', async () => {
    const { db } = fakeDb([{ igdbId: 101 }]);
    const queryIgdb = jest
      .fn()
      .mockRejectedValue(new Error('IGDB API error 400: Bad Request'));
    const refreshed = await refreshExistingGames(db as never, queryIgdb, '');
    expect(queryIgdb).toHaveBeenCalledTimes(1);
    expect(refreshed).toBe(0);
  });
});
