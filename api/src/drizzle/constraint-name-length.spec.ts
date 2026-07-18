import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './schema';

/**
 * ROK-1387: Postgres silently truncates identifiers longer than 63 chars.
 * Two truncated FK names colliding on their first 63 chars would make a
 * migration fail (`constraint already exists`) or attach a constraint to the
 * wrong relation. This guard keeps every generated constraint name under the
 * limit so new long-named FKs fail here instead of as a NOTICE at deploy.
 */
const PG_IDENTIFIER_LIMIT = 63;

describe('drizzle constraint identifier lengths (ROK-1387)', () => {
  const tables = Object.values(schema).filter(
    (value): value is PgTable => value instanceof PgTable,
  );

  it('finds tables to audit', () => {
    expect(tables.length).toBeGreaterThan(30);
  });

  it('keeps every FK constraint name within the 63-char Postgres limit', () => {
    const offenders: string[] = [];
    for (const table of tables) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        const name = fk.getName();
        if (name.length > PG_IDENTIFIER_LIMIT) {
          offenders.push(`${config.name}: ${name} (${name.length})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every unique constraint name within the limit', () => {
    const offenders: string[] = [];
    for (const table of tables) {
      const config = getTableConfig(table);
      for (const unique of config.uniqueConstraints) {
        const name =
          unique.name ??
          `${config.name}_${unique.columns.map((c) => c.name).join('_')}_unique`;
        if (name.length > PG_IDENTIFIER_LIMIT) {
          offenders.push(`${config.name}: ${name} (${name.length})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
