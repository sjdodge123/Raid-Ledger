import type { Sql } from 'postgres';
import { collectStats } from './crosswalk-stats';

/** A tagged-template stand-in that records each query's text. */
function fakeTx(queries: string[]) {
  return (first: unknown): unknown => {
    if (!Array.isArray(first)) return first; // sql(column) identifier helper
    const text = first.join('?');
    queries.push(text);
    if (text.includes('FROM hub_games')) return Promise.resolve([{ n: 3 }]);
    if (text.includes('FROM hub_crosswalk_conflicts')) {
      return Promise.resolve([{ open: 1, total: 2 }]);
    }
    return Promise.resolve([{ k: 'steam_app_id', n: 4 }]);
  };
}

describe('collectStats (ROK-1674 L4)', () => {
  it('reads every aggregate inside one read-only REPEATABLE READ transaction', async () => {
    const queries: string[] = [];
    const outside = jest.fn(() => {
      throw new Error('query issued outside the snapshot transaction');
    });
    const begin = jest.fn(
      (_options: string, cb: (tx: unknown) => Promise<unknown>) =>
        cb(fakeTx(queries)),
    );
    const sql = Object.assign(outside, { begin }) as unknown as Sql;

    const stats = await collectStats(sql);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0]?.[0]).toMatch(
      /^isolation level repeatable read read only$/i,
    );
    expect(outside).not.toHaveBeenCalled();
    expect(queries).toHaveLength(5);
    expect(stats.games).toBe(3);
    expect(stats.conflicts).toEqual({ open: 1, total: 2 });
    expect(stats.ids.byKind['steam_app_id']).toBe(4);
  });
});
