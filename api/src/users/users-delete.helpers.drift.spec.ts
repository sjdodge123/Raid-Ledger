/**
 * Drift guard for the moderation data-wipe manifest (ROK-313 §9.6, modelled on
 * the games-insert-paths guard). Enumerates EVERY table with a foreign key to
 * `users.id` straight from the drizzle schema metadata and asserts each one is
 * classified in exactly ONE bucket: WIPE (by-column or special) / REASSIGN /
 * KEEP. A new FK-to-users table added later without classification fails here,
 * forcing the author to decide whether a banned/deleted user's rows in it should
 * be wiped, reassigned, or intentionally kept.
 */
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../drizzle/schema';
import {
  KEEP_TABLES,
  REASSIGN_TABLES,
  WIPE_BY_COLUMN,
  WIPE_SPECIAL_TABLES,
} from './users-delete.helpers';

/** SQL name of a drizzle table object. */
function tableName(table: PgTable): string {
  return getTableConfig(table).name;
}

/** All SQL table names that have at least one FK column referencing users.id. */
function tablesReferencingUsers(): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (config.name === 'users') continue;
    const referencesUsers = config.foreignKeys.some(
      (fk) => fk.reference().foreignTable === schema.users,
    );
    if (referencesUsers) names.add(config.name);
  }
  return names;
}

describe('user-FK wipe manifest drift guard (ROK-313 §9.6)', () => {
  const classified: string[] = [
    ...WIPE_BY_COLUMN.map((w) => tableName(w.table)),
    ...WIPE_SPECIAL_TABLES.map(tableName),
    ...REASSIGN_TABLES.map(tableName),
    ...KEEP_TABLES.map(tableName),
  ];
  const classifiedSet = new Set(classified);
  const referencing = tablesReferencingUsers();

  it('classifies every table that references users.id (completeness)', () => {
    const unclassified = [...referencing].filter((n) => !classifiedSet.has(n));
    expect(unclassified).toEqual([]);
  });

  it('classifies each table in exactly one bucket (no double / stale entries)', () => {
    // No table name appears in two buckets.
    expect(classified.length).toBe(classifiedSet.size);
    // No manifest entry points at a table that no longer references users.
    const stale = classified.filter((n) => !referencing.has(n));
    expect(stale).toEqual([]);
  });

  it('sanity: the manifest is non-trivial and the users table is excluded', () => {
    expect(referencing.size).toBeGreaterThan(20);
    expect(classifiedSet.has('users')).toBe(false);
    expect(classifiedSet.has('admin_actions')).toBe(true);
  });
});
