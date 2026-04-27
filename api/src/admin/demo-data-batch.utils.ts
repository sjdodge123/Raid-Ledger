// ROK-1142: extracted from demo-data.service.ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

export const BATCH_SIZE = 500;

export function makeBatchInsert(db: Db) {
  return async function batchInsert(
    table: Parameters<Db['insert']>[0],
    rows: Record<string, unknown>[],
    onConflict?: 'doNothing',
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const q = db.insert(table).values(batch as never);
      if (onConflict === 'doNothing') {
        await q.onConflictDoNothing();
      } else {
        await q;
      }
    }
  };
}

export function makeBatchInsertReturning(db: Db) {
  return async function batchInsertReturning(
    table: Parameters<Db['insert']>[0],
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const inserted = await db
        .insert(table)
        .values(batch as never)
        .returning();
      results.push(...inserted);
    }
    return results;
  };
}
