/**
 * ITAD-primary search pipeline orchestration (ROK-773).
 * Searches ITAD first, then enriches with IGDB via exact
 * external_games match (category=1, uid=steamAppId).
 */
import { Logger } from '@nestjs/common';
import type { GameDetailDto } from '@raid-ledger/contract';
import { ADULT_KEYWORDS, ADULT_THEME_IDS } from './igdb.constants';
import type { SearchResult } from './igdb.constants';
import {
  mergeItadWithIgdb,
  buildItadOnlyDetail,
  type ItadSearchGame,
  type IgdbEnrichedData,
} from './igdb-itad-merge.helpers';

const logger = new Logger('ItadSearchPipeline');

/** Dependencies injected into the ITAD search pipeline. */
export interface ItadSearchDeps {
  searchItad: (query: string) => Promise<ItadSearchGame[]>;
  lookupSteamAppIds: (
    games: { id: string; slug: string }[],
  ) => Promise<Map<string, number>>;
  enrichFromIgdb: (steamAppId: number) => Promise<IgdbEnrichedData | null>;
  getAdultFilter: () => Promise<boolean>;
  isBannedOrHidden: (slug: string) => Promise<boolean>;
  upsertGame: (game: GameDetailDto) => Promise<GameDetailDto>;
}

/**
 * Filter DLC games from ITAD results.
 * @param games - ITAD search results
 * @returns Non-DLC games only
 */
export function filterDlc(games: ItadSearchGame[]): ItadSearchGame[] {
  return games.filter((g) => g.type !== 'dlc');
}

/**
 * Filter adult content from ITAD games (pre-IGDB enrichment).
 * Checks ITAD mature flag and ADULT_KEYWORDS.
 * @param games - ITAD search results
 * @param adultFilter - Whether adult filter is enabled
 * @returns Filtered games
 */
export function filterAdultItadGames(
  games: ItadSearchGame[],
  adultFilter: boolean,
): ItadSearchGame[] {
  if (!adultFilter) return games;
  return games.filter((g) => !g.mature && !matchesAdultKeyword(g.title));
}

/**
 * Execute the full ITAD-primary search pipeline.
 * 1. Search ITAD for games
 * 2. Filter DLC
 * 3. Apply pre-enrichment adult filter
 * 4. Resolve Steam app IDs
 * 5. Enrich with IGDB where possible
 * 6. Apply post-enrichment adult filter (IGDB themes)
 * 7. Exclude banned/hidden games
 * @param deps - Pipeline dependencies
 * @param query - Search query string
 * @returns Search results with source='itad'
 */
export async function executeItadSearch(
  deps: ItadSearchDeps,
  query: string,
): Promise<SearchResult> {
  const raw = await deps.searchItad(query);
  const nonDlc = filterDlc(raw);
  const adultFilter = await deps.getAdultFilter();
  const preFiltered = filterAdultItadGames(nonDlc, adultFilter);

  const steamMap = await deps.lookupSteamAppIds(
    preFiltered.map((g) => ({ id: g.id, slug: g.slug })),
  );

  const enriched = await enrichAll(deps, preFiltered, steamMap);
  const postFiltered = applyPostFilters(enriched, adultFilter);
  const visible = await removeHidden(deps, postFiltered);
  const persisted = await upsertAll(deps, visible);

  logger.debug(
    `ITAD search "${query}": ${raw.length} raw, ${persisted.length} final`,
  );

  return { games: persisted, cached: false, source: 'itad' };
}

/** Enrich all games with IGDB data where Steam app ID is available. */
async function enrichAll(
  deps: ItadSearchDeps,
  games: ItadSearchGame[],
  steamMap: Map<string, number>,
): Promise<GameDetailDto[]> {
  const results: GameDetailDto[] = [];

  for (const game of games) {
    const steamAppId = steamMap.get(game.id);
    const enrichedGame = { ...game, steamAppId };

    if (steamAppId) {
      const igdb = await deps.enrichFromIgdb(steamAppId);
      if (igdb) {
        results.push(mergeItadWithIgdb(enrichedGame, igdb));
        continue;
      }
    }
    results.push(buildItadOnlyDetail(enrichedGame));
  }

  return results;
}

/** Apply post-enrichment adult filter (IGDB themes). */
function applyPostFilters(
  games: GameDetailDto[],
  adultFilter: boolean,
): GameDetailDto[] {
  if (!adultFilter) return games;
  return games.filter(
    (g) => !g.themes.some((t) => ADULT_THEME_IDS.includes(t)),
  );
}

/** Remove banned/hidden games by slug. */
async function removeHidden(
  deps: ItadSearchDeps,
  games: GameDetailDto[],
): Promise<GameDetailDto[]> {
  const results: GameDetailDto[] = [];
  for (const game of games) {
    if (!(await deps.isBannedOrHidden(game.slug))) {
      results.push(game);
    }
  }
  return results;
}

/** Upsert all games to DB to get real IDs. */
async function upsertAll(
  deps: ItadSearchDeps,
  games: GameDetailDto[],
): Promise<GameDetailDto[]> {
  const results: GameDetailDto[] = [];
  for (const game of games) {
    try {
      results.push(await deps.upsertGame(game));
    } catch {
      logger.warn(`Failed to upsert game "${game.slug}", using in-memory`);
      results.push(game);
    }
  }
  return results;
}

/** Check if a game name matches adult keywords. */
function matchesAdultKeyword(name: string): boolean {
  const lower = name.toLowerCase();
  return ADULT_KEYWORDS.some((kw) => lower.includes(kw));
}
