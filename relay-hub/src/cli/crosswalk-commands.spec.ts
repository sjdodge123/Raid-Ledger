import type { Sql } from 'postgres';
import type { CrosswalkStats } from '../crosswalk/crosswalk-stats';
import type { RepoRunner, SqlRunner } from './cli-db';
import { formatStats } from './commands/stats.command';
import { parseLookupArgs } from './commands/lookup.command';
import { main } from './hub-admin';

const noRepo: RepoRunner = () => Promise.reject(new Error('repo used'));

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const query = jest.fn(() => Promise.reject(new Error('query issued')));
  // `stats` reads inside sql.begin(...) (one snapshot); the fake runs the
  // callback with the same rejecting query so "query issued" still surfaces.
  const begin = jest.fn((_options: string, cb: (tx: unknown) => unknown) =>
    cb(query),
  );
  const sql = Object.assign(query, { begin });
  const runner: SqlRunner = (_env, fn) => fn(sql as unknown as Sql);
  const io = {
    env: {},
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
  };
  const run = (argv: string[]) => main(argv, io, noRepo, runner);
  return { out, err, query, run };
}

describe('hub-admin lookup argument checks (ROK-1674 L5, AC 5)', () => {
  it.each([
    [['lookup', '--kind', 'bogus', '--value', '570']],
    [['lookup', '--kind', 'steam_app_id']],
    [['lookup', '--value', '570']],
  ])('%j is a usage error (exit 2) before any query', async (argv) => {
    const h = harness();
    expect(await h.run(argv)).toBe(2);
    expect(h.query).not.toHaveBeenCalled();
    expect(h.err.join('\n')).toContain('lookup --kind');
  });

  it('lower-cases ITAD values only', () => {
    const uuid = '018F4A2C-7B3E-7C91-9D2A-5E6F7A8B9C0D';
    expect(parseLookupArgs(['--kind', 'itad_uuid', '--value', uuid])).toEqual({
      kind: 'itad_uuid',
      value: uuid.toLowerCase(),
    });
    expect(parseLookupArgs(['--value', 'AbC', '--kind', 'igdb_slug'])).toEqual({
      kind: 'igdb_slug',
      value: 'AbC',
    });
  });
});

describe('hub-admin crosswalk dispatch', () => {
  it('routes stats/lookup/conflicts to the SQL runner, not the repository', async () => {
    const h = harness();
    expect(await h.run(['stats'])).toBe(1);
    expect(h.query).toHaveBeenCalled();
    expect(h.err.join('\n')).toContain('hub-admin stats: query issued');
  });
});

describe('formatStats (AC 4 text form)', () => {
  it('prints games, every count group and the conflicts line', () => {
    const stats: CrosswalkStats = {
      games: 2,
      ids: {
        byKind: { steam_app_id: 1 },
        bySource: { instance: 1 },
        byProvenance: { steam: 1, none: 0 },
      },
      conflicts: { open: 1, total: 3 },
    };
    expect(formatStats(stats)).toEqual([
      'games: 2',
      'ids by kind:',
      '  steam_app_id  1',
      'ids by source:',
      '  instance  1',
      'ids by provenance:',
      '  steam  1',
      '  none   0',
      'conflicts: open 1 / total 3',
    ]);
  });
});
