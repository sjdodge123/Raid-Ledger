/**
 * Seed-owned games keep their curated name and slug (ROK-1643).
 *
 * The boot seed defines a handful of games (the WoW variants, FFXIV, …) with
 * names the operator chose. IGDB's name for the same `igdb_id` differs — IGDB
 * 75379 is "World of Warcraft Classic", while the seed calls that row
 * "World of Warcraft Classic Era" to tell it apart from Classic progression.
 * Every enrichment write that sets `name`/`slug` routes through
 * `keepSeedOwned`, which leaves the column alone when the TARGET row's slug is
 * on the seed's own list. The check runs in SQL against the existing row, so
 * it also covers ON CONFLICT DO UPDATE, where the row is not known up front.
 *
 * `short_name` needs no guard: enrichment never writes it, and the seed
 * rewrites it on every boot.
 */
import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { GAMES_SEED } from './seed-games.data';

/** Slugs of every game the boot seed defines. */
export const SEED_OWNED_GAME_SLUGS: readonly string[] = GAMES_SEED.map(
  (g) => g.slug,
);

/**
 * SET expression: keep `column` on a seed-owned row, else write `incoming`.
 * `incoming` may be a plain value or SQL (e.g. `excluded.name`).
 */
export function keepSeedOwned(column: AnyColumn, incoming: unknown): SQL {
  const slugs = sql.join(
    SEED_OWNED_GAME_SLUGS.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`CASE WHEN ${schema.games.slug} IN (${slugs}) THEN ${column} ELSE ${incoming} END`;
}
