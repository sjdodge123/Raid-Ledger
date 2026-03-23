/**
 * Early access sync helpers for the ITAD price sync (ROK-934).
 * Enriches games with earlyAccess status from ITAD game info.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadService } from './itad.service';

type Db = PostgresJsDatabase<typeof schema>;

/** Bulk-update earlyAccess for matched games via UPDATE ... FROM VALUES. */
export async function executeBulkEarlyAccessUpdate(
  db: Db,
  rows: { id: number; earlyAccess: boolean }[],
): Promise<void> {
  const frags = rows.map(
    (r) => sql`(${r.id}::int, ${r.earlyAccess}::boolean)`,
  );
  await db.execute(sql`
    UPDATE ${schema.games} AS g
    SET early_access = v.ea
    FROM (VALUES ${sql.join(frags, sql`, `)}) AS v(id, ea)
    WHERE g.id = v.id
  `);
}

/** Fetch earlyAccess for a chunk and bulk-update. */
export async function enrichChunkEarlyAccess(
  db: Db,
  itadService: ItadService,
  chunk: { id: number; itadGameId: string }[],
): Promise<number> {
  const updates: { id: number; earlyAccess: boolean }[] = [];
  for (const game of chunk) {
    try {
      const info = await itadService.getGameInfo(game.itadGameId);
      if (info) updates.push({ id: game.id, earlyAccess: info.earlyAccess ?? false });
    } catch {
      /* skip — don't fail the batch for one game */
    }
  }
  if (updates.length === 0) return 0;
  await executeBulkEarlyAccessUpdate(db, updates);
  return updates.length;
}
