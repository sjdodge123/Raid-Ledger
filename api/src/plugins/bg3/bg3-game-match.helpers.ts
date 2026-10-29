/**
 * ROK-2038 — the ONE definition of "this `games` row is Baldur's Gate 3":
 * its slug is one of `BG3_GAME_SLUGS` OR its IGDB id is `BG3_IGDB_ID`. The
 * route guard (`refuseNonBg3Hub`) and the gallery query (`bg3HubIds`) both
 * use it, so a hub listed in the gallery never 404s on its own routes.
 */
import { inArray, eq, or, type SQL } from 'drizzle-orm';
import {
  BG3_GAME_SLUGS,
  BG3_IGDB_ID,
  isBg3GameSlug,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

/** True when a game with this slug / IGDB id is Baldur's Gate 3. */
export function isBg3Game(
  slug: string | null | undefined,
  igdbId: number | null | undefined,
): boolean {
  return isBg3GameSlug(slug) || igdbId === BG3_IGDB_ID;
}

/** SQL twin of `isBg3Game` over `schema.games` (join it first). */
export function bg3GameCondition(): SQL {
  const condition = or(
    inArray(schema.games.slug, [...BG3_GAME_SLUGS]),
    eq(schema.games.igdbId, BG3_IGDB_ID),
  );
  if (!condition) throw new Error('bg3GameCondition: empty OR');
  return condition;
}
