import { and, eq, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Flip approved rows whose `expires_at` has passed to `status='expired'` so
 * they stop appearing in discover responses. Runs in the same weekly pass as
 * the generator. Only touches status='approved' rows — never pending ones
 * (those are admin-owned).
 */
export async function runExpireSuggestions(db: Db): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(schema.discoveryCategorySuggestions)
    .set({ status: 'expired' })
    .where(
      and(
        eq(schema.discoveryCategorySuggestions.status, 'approved'),
        sql`${schema.discoveryCategorySuggestions.expiresAt} IS NOT NULL`,
        lt(schema.discoveryCategorySuggestions.expiresAt, now),
      ),
    )
    .returning({ id: schema.discoveryCategorySuggestions.id });
  return rows.length;
}
