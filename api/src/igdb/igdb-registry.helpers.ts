/**
 * Game-registry read helper — the `GET /games/configured` projection,
 * extracted from `igdb.controller.ts` (ROK-1314) to keep that file under
 * the 300-line cap.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameRegistryListResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The 12 registry/config columns the endpoint projects. */
const REGISTRY_COLUMNS = {
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
} as const;

/**
 * List enabled, non-banned games with their registry/config columns.
 *
 * ROK-1407: the body must be byte-stable between real config changes so the
 * weak ETag Express emits revalidates to 304. Two churn sources are removed
 * here — `ORDER BY name` alone lets duplicate names swap rows between runs
 * (Postgres does not guarantee a stable sort), and `genres` is stored in
 * IGDB's response order, so a reorder of the same set flips the ETag with no
 * change in body length. Both are sorted deterministically.
 */
export async function listConfiguredGames(
  db: Db,
): Promise<GameRegistryListResponseDto> {
  const rows = await db
    .select(REGISTRY_COLUMNS)
    .from(schema.games)
    .where(and(eq(schema.games.enabled, true), eq(schema.games.banned, false)))
    .orderBy(schema.games.name, schema.games.id);
  const data = rows.map((r) => ({
    ...r,
    // Sorted COPY — never mutate the row the driver handed us.
    genres: [...(r.genres ?? [])].sort((a, b) => a - b),
  }));
  return { data, meta: { total: data.length } };
}
