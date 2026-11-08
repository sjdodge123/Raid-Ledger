/**
 * ROK-2133: the roster Armory due query's filter (rendered SQL).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../../../common/testing/drizzle-mock';
import type * as schema from '../../../drizzle/schema';
import { listDueRosterMembers } from './roster-armory.queries';

const dialect = new PgDialect();

/** The rendered WHERE of one `listDueRosterMembers` call. */
async function renderedWhere(): Promise<string> {
  const mock = createDrizzleMock();
  mock.limit.mockResolvedValueOnce([]);
  const db = mock as unknown as PostgresJsDatabase<typeof schema>;
  await listDueRosterMembers(db, { gameId: 1, now: new Date(), limit: 150 });
  const where: unknown = mock.where.mock.calls[0]?.[0];
  if (where === undefined) throw new Error('expected a where call');
  return dialect.sqlToQuery(where as SQL).sql;
}

describe('listDueRosterMembers', () => {
  it('only takes members in their guild latest snapshot (soft-removed members are never due)', async () => {
    expect(await renderedWhere()).toContain(
      '"guild_members"."last_seen_at" >= "guilds"."last_snapshot_at"',
    );
  });
});
