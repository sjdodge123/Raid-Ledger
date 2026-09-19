/**
 * ROK-1612 AC2 — the two reads behind the composer's search.
 *
 * Split from the classification so all four outcomes stay unit-testable with no
 * database. The first query is DELIBERATELY the same pair of helpers `/lfg`'s
 * autocomplete uses (`buildGameNameMatchFilter` + `gameRelevanceOrder`): the
 * composer must not develop a second idea of what "matches" means, or the modal
 * and the slash command disagree about the same library.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  buildGameNameMatchFilter,
  gameRelevanceOrder,
} from '../../igdb/game-search-relevance.helpers';
import { LFG_COMPOSER_MAX_CANDIDATES } from './lfg-composer.constants';
import type { LfgComposerGame } from './lfg-composer-search.helpers';

/**
 * Trigram floor for the "Did you mean" re-query.
 *
 * 0.25, not the 0.2 the 2026-09-17 experiment ran at. The measured recoveries
 * sit at 0.27 (`minecfaft`), 0.33 (`deep rok`, `valhiem`), 0.50 and 0.64, while
 * the worst false neighbour in that run — `Valorant` for `valhiem` — sits at
 * 0.21. 0.25 clears every real recovery and drops that neighbour. `pg_trgm` and
 * `idx_games_name_trgm` have existed since migration 0095.
 */
export const LFG_COMPOSER_TRIGRAM_THRESHOLD = 0.25;

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Games matching the typed term through the shared word/acronym filter.
 *
 * @param db - Drizzle handle.
 * @param term - Raw typed text.
 * @returns Up to 25 rows in relevance order.
 */
export async function searchComposerGames(
  db: Db,
  term: string,
): Promise<LfgComposerGame[]> {
  return db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(buildGameNameMatchFilter(term))
    .orderBy(...gameRelevanceOrder(term))
    .limit(LFG_COMPOSER_MAX_CANDIDATES);
}

/**
 * The trigram re-query, run ONLY when the word filter found nothing.
 *
 * @param db - Drizzle handle.
 * @param term - Raw typed text.
 * @returns Up to 25 rows above the threshold, most similar first.
 */
export async function searchComposerGamesFuzzy(
  db: Db,
  term: string,
): Promise<LfgComposerGame[]> {
  const similarity = sql`similarity(${schema.games.name}, ${term})`;
  return db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(sql`${similarity} >= ${LFG_COMPOSER_TRIGRAM_THRESHOLD}`)
    .orderBy(sql`${similarity} DESC`)
    .limit(LFG_COMPOSER_MAX_CANDIDATES);
}
