/**
 * The steamAppId half of a discovery merge's SET clause (ROK-1843), split out
 * of `steam-itad-discovery.helpers.ts` to keep that file under 300 lines.
 */
import { sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

type GameInsertRow = typeof schema.games.$inferInsert;

/** The steamAppId columns of a merge's SET: a value, or an SQL expression. */
interface SteamAppIdWrite {
  steamAppId: GameInsertRow['steamAppId'] | SQL;
  steamAppIdSource: GameInsertRow['steamAppIdSource'] | SQL;
}

/**
 * The steamAppId columns a merge writes. ROK-1843: a hidden row keeps its
 * non-null steamAppId (and its source) — it is the anchor by-steam-id checks
 * before rediscovering, so moving it would let the old id miss and rediscover.
 */
export function steamAppIdWrite(
  existing: { hidden?: boolean | undefined },
  row: GameInsertRow,
): SteamAppIdWrite {
  if (existing.hidden !== true) {
    return {
      steamAppId: row.steamAppId,
      steamAppIdSource: row.steamAppIdSource,
    };
  }
  const g = schema.games;
  return {
    steamAppId: sql`COALESCE(${g.steamAppId}, ${row.steamAppId ?? null})`,
    steamAppIdSource: sql`CASE WHEN ${g.steamAppId} IS NULL THEN ${row.steamAppIdSource ?? null} ELSE ${g.steamAppIdSource} END`,
  };
}
