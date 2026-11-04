/**
 * ROK-1931 SQL R (rendered) + `recordReportedDeaths` (mocked tx): world
 * filter (D3), one lock per batch keyed on the profile name (D9), one
 * statement per in-world entry, inserted = rows returned.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { ValheimDeathRecord } from '@raid-ledger/contract';
import { reportedDeathSql } from './valheim-deaths-reported.sql';
import {
  ValheimDeathsRepository,
  type ReportedDeathProfile,
} from './valheim-deaths.repository';

const dialect = new PgDialect();
const WORLD = '1234567890123';
const FOREIGN = '987654321';
const PROFILE: ReportedDeathProfile = {
  pelicanServerId: 3,
  steamId: '76561198000000001',
  playerId: '4242',
  name: 'Ragnar',
  worldUid: WORLD,
};
const death = (worldUid: string, at: string): ValheimDeathRecord => ({
  worldUid,
  x: -412.5,
  z: 1210.25,
  at,
});

function render(d = death(WORLD, '2026-10-17T20:05:12Z')) {
  const q = dialect.sqlToQuery(reportedDeathSql(PROFILE, d, 120));
  return { text: q.sql.replace(/\s+/g, ' '), params: q.params };
}

describe('reportedDeathSql (SQL R)', () => {
  it('merges only into an unpositioned log/discord death of the same character', () => {
    const { text } = render();
    expect(text).toContain(
      "d.source IN ('log', 'discord') AND d.reported_at IS NULL",
    );
    expect(text).toMatch(
      /lower\(d\.character_name\) = lower\(\$\d+::text\) AND \(d\.steam_id = \$\d+::text OR d\.steam_id IS NULL\)/,
    );
    expect(text).toMatch(
      /BETWEEN \$\d+::timestamptz - make_interval\(secs => \$\d+::int\)/,
    );
  });

  it('blocks both the merge and the insert on a replay of the same `at`', () => {
    const { text } = render();
    expect(text).toMatch(
      /e\.player_id = \$\d+::text AND e\.reported_at = \$\d+::timestamptz/,
    );
    expect(text).toContain('AND NOT EXISTS (SELECT 1 FROM existing) ORDER BY');
    expect(text).toContain(
      'WHERE NOT EXISTS (SELECT 1 FROM merged) AND NOT EXISTS (SELECT 1 FROM existing)',
    );
    expect(text).toContain(
      'ON CONFLICT (pelican_server_id, steam_id, player_id, reported_at) WHERE reported_at IS NOT NULL DO NOTHING',
    );
  });

  it('fills the position without touching the merged row source, and inserts a mod row', () => {
    const { text } = render();
    const set = /UPDATE valheim_player_deaths d SET (.*?) FROM cand/.exec(
      text,
    )?.[1];
    expect(set).toContain('reported_at = ');
    expect(set).toContain('steam_id = coalesce(d.steam_id, ');
    expect(set).not.toContain('source');
    // A merged discord row takes the profile name; a log row keeps its own.
    expect(set).toMatch(
      /character_name = CASE WHEN d\.logged_at IS NULL THEN \$\d+::text ELSE d\.character_name END/,
    );
    expect(text).toMatch(/\$\d+::text, 'mod',/);
  });

  it('binds the mod `at` verbatim, the world, the position and the window', () => {
    const { params } = render();
    expect(params).toEqual(
      expect.arrayContaining([3, PROFILE.steamId, '4242', 'Ragnar', WORLD]),
    );
    expect(params).toEqual(
      expect.arrayContaining(['2026-10-17T20:05:12Z', -412.5, 1210.25, 120]),
    );
  });
});

function mockDb(returns: unknown[][]) {
  const execute = jest.fn<Promise<unknown[]>, [SQL]>();
  execute.mockResolvedValueOnce([]); // the advisory lock
  for (const r of returns) execute.mockResolvedValueOnce(r);
  const tx = { execute };
  const db = { transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
  const params = () =>
    execute.mock.calls.flatMap(([q]) => dialect.sqlToQuery(q).params);
  return { db, execute, params };
}

describe('ValheimDeathsRepository.recordReportedDeaths', () => {
  const repo = new ValheimDeathsRepository({} as never);
  const batch = [
    death(WORLD, '2026-10-17T20:05:12Z'),
    death(FOREIGN, '2026-10-16T18:40:00.5Z'),
    death(WORLD, '2026-10-15T21:02:33.125Z'),
  ];

  it('stores only this world, one statement each under one name lock', async () => {
    const { db, execute, params } = mockDb([[{ id: 1 }], []]);
    const out = await repo.recordReportedDeaths(db as never, PROFILE, batch);
    expect(out).toEqual({ inserted: 1, foreign: 1 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(3);
    const first = execute.mock.calls[0];
    if (!first) throw new Error('the advisory lock was never taken');
    const lock = dialect.sqlToQuery(first[0]);
    expect(lock.sql).toContain('pg_advisory_xact_lock');
    expect(lock.params).toEqual(expect.arrayContaining(['3', 'Ragnar']));
    expect(params()).not.toContain(FOREIGN);
    expect(params()).toEqual(
      expect.arrayContaining([
        '2026-10-17T20:05:12Z',
        '2026-10-15T21:02:33.125Z',
      ]),
    );
  });

  it('takes no lock when every entry is from another world', async () => {
    const { db } = mockDb([]);
    const out = await repo.recordReportedDeaths(db as never, PROFILE, [
      death(FOREIGN, '2026-10-16T18:40:00.5Z'),
    ]);
    expect(out).toEqual({ inserted: 0, foreign: 1 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('takes no lock for an empty list', async () => {
    const { db } = mockDb([]);
    expect(await repo.recordReportedDeaths(db as never, PROFILE, [])).toEqual({
      inserted: 0,
      foreign: 0,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
