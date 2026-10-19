import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1831 D6 — each hub game's icon (`games.cover_url`, the same source as
 * the server hub's status pill) for the nav guild menu, keyed by game id.
 */
export async function hubGameIcons(
  db: Db,
  gameIds: readonly number[],
): Promise<Map<number, string | null>> {
  const ids = [...new Set(gameIds)];
  if (ids.length === 0) return new Map();
  const g = schema.games;
  const rows = await db
    .select({ id: g.id, coverUrl: g.coverUrl })
    .from(g)
    .where(inArray(g.id, ids));
  return new Map(rows.map((r) => [r.id, r.coverUrl]));
}
