/**
 * Game-registry read helper — the `GET /games/configured` projection,
 * extracted from `igdb.controller.ts` (ROK-1314) to keep that file under
 * the 300-line cap.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameRegistryListResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** List enabled games with their registry/config columns, ordered by name. */
export async function listConfiguredGames(
  db: Db,
): Promise<GameRegistryListResponseDto> {
  const rows = await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      name: schema.games.name,
      shortName: schema.games.shortName,
      coverUrl: schema.games.coverUrl,
      colorHex: schema.games.colorHex,
      hasRoles: schema.games.hasRoles,
      hasSpecs: schema.games.hasSpecs,
      enabled: schema.games.enabled,
      maxCharactersPerUser: schema.games.maxCharactersPerUser,
      genres: schema.games.genres,
      playerCount: schema.games.playerCount,
    })
    .from(schema.games)
    .where(eq(schema.games.enabled, true))
    .orderBy(schema.games.name);
  const data = rows.map((r) => ({ ...r, genres: r.genres ?? [] }));
  return { data, meta: { total: data.length } };
}
