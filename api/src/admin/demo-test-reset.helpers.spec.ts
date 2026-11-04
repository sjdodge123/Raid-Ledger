/**
 * Unit spec for the reset-to-seed wipe SQL (demo-test-reset.helpers.ts).
 * Renders each executed drizzle `sql` to text so the wiped table list is
 * asserted directly — the integration spec covers the real truncate.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { wipeAllTestData } from './demo-test-reset.helpers';

const dialect = new PgDialect();

function buildDb() {
  const statements: string[] = [];
  const execute = jest.fn((q: SQL) => {
    const text = dialect.sqlToQuery(q).sql;
    statements.push(text);
    if (text.includes('SELECT COUNT')) return Promise.resolve([{ count: '1' }]);
    return Promise.resolve([]);
  });
  return { db: { execute } as never, statements };
}

describe('wipeAllTestData', () => {
  it('truncates notifications with the RESTART IDENTITY wipe so a reused event id inherits no stale DM rows', async () => {
    const { db, statements } = buildDb();
    await wipeAllTestData(db);
    const truncates = statements.filter((s) => s.includes('TRUNCATE'));
    // `\bnotifications\b` does not match `notification_dedup`.
    expect(truncates.join('\n')).toMatch(
      /TRUNCATE TABLE[^;]*\bnotifications\b[^;]*RESTART IDENTITY/,
    );
  });

  it('skips every TRUNCATE when the snapshot counts are all zero', async () => {
    const statements: string[] = [];
    const execute = jest.fn((q: SQL) => {
      statements.push(dialect.sqlToQuery(q).sql);
      return Promise.resolve([{ count: '0' }]);
    });
    await wipeAllTestData({ execute } as never);
    expect(statements.filter((s) => s.includes('TRUNCATE'))).toEqual([]);
  });
});
