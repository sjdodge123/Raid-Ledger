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
import { defined } from '../common/defined.helpers';

const logger = new Logger('ItadSearchPipeline');

/** Dependencies injected into the ITAD search pipeline. */
export interface ItadSearchDeps {
  searchItad: (query: string) => Promise<ItadSearchGame[]>;
  lookupSteamAppIds: (
    games: { id: string; slug: string }[],
  ) => Promise<Map<string, number>>;
  enrichFromIgdb: (steamAppId: number) => Promise<IgdbEnrichedData | null>;
  getAdultFilter: () => Promise<boolean>;
  /** READLOGS:D2: batch lookup — returns the subset of `slugs` that are
   * banned or hidden, in ONE query for the whole result set. */
  findBannedOrHiddenSlugs: (slugs: string[]) => Promise<Set<string>>;
  /** ROK-1843: the subset of persisted game `ids` that are banned or hidden.
   * Re-applied after the upsert, which can land on a moderated row by
   * steamAppId / igdbId / name even though its incoming slug was clean. */
  findBannedOrHiddenIds: (ids: number[]) => Promise<Set<number>>;
  /** ROK-1843: whether a candidate collides with a banned/hidden row on ANY
   * key — consulted when its upsert failed, before the in-memory fallback. */
  hasModeratedMatch: (game: GameDetailDto) => Promise<boolean>;
  upsertGame: (game: GameDetailDto) => Promise<GameDetailDto>;
  /** ROK-986: Callback when a game is upserted without IGDB data. */
  onUnenriched?: (gameId: number) => void;
  /** ROK-1082: fired after every successful upsert so callers can enqueue a
   * taste-vector recompute for that game id. */
  onGameUpserted?: (gameId: number) => void;
}

/**
 * Filter non-game entries from ITAD results.
 * Excludes DLC, bundles/packages, and soundtracks — only standalone games.
 */
export function filterDlc(games: ItadSearchGame[]): ItadSearchGame[] {
  return games.filter((g) => g.type === 'game');
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
  const upserted = await removeHiddenPersisted(
    deps,
    await upsertAll(deps, visible),
  );
  notifyUpserted(deps, upserted);
  const persisted = upserted.map((u) => u.game);

  logger.debug(
    `ITAD search "${query}": ${raw.length} raw, ${persisted.length} final`,
  );

  return { games: persisted, cached: false, source: 'itad' };
}

/** Concurrency limit for parallel IGDB enrichment calls. */
const ENRICH_BATCH_SIZE = 5;

/** Enrich a single game with IGDB data if Steam app ID is available. */
function enrichSingleGame(
  deps: ItadSearchDeps,
  game: ItadSearchGame,
  steamAppId: number | undefined,
): Promise<GameDetailDto> {
  const enrichedGame: ItadSearchGame = { ...game };
  if (steamAppId === undefined) delete enrichedGame.steamAppId;
  else enrichedGame.steamAppId = steamAppId;
  if (!steamAppId) return Promise.resolve(buildItadOnlyDetail(enrichedGame));
  return deps
    .enrichFromIgdb(steamAppId)
    .then((igdb) =>
      igdb
        ? mergeItadWithIgdb(enrichedGame, igdb)
        : buildItadOnlyDetail(enrichedGame),
    );
}

/** Enrich all games with IGDB data, batched for concurrency. */
async function enrichAll(
  deps: ItadSearchDeps,
  games: ItadSearchGame[],
  steamMap: Map<string, number>,
): Promise<GameDetailDto[]> {
  const results: GameDetailDto[] = [];

  for (let i = 0; i < games.length; i += ENRICH_BATCH_SIZE) {
    const batch = games.slice(i, i + ENRICH_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((g) => enrichSingleGame(deps, g, steamMap.get(g.id))),
    );
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        const { slug } = defined(batch[idx], 'enrichment batch game');
        logger.debug(`Enrichment failed for "${slug}": ${reason}`);
      }
    });
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

/** Remove banned/hidden games by slug (one batched lookup, READLOGS:D2). */
async function removeHidden(
  deps: ItadSearchDeps,
  games: GameDetailDto[],
): Promise<GameDetailDto[]> {
  if (games.length === 0) return games;
  const slugs = [...new Set(games.map((g) => g.slug))];
  const excluded = await deps.findBannedOrHiddenSlugs(slugs);
  return games.filter((g) => !excluded.has(g.slug));
}

/**
 * Remove persisted rows that are banned or hidden, by DB id (ROK-1843). The
 * slug filter above only saw the incoming ITAD slug; the upsert may have
 * matched a moderated row by an alternate key.
 */
async function removeHiddenPersisted(
  deps: ItadSearchDeps,
  upserted: UpsertOutcome[],
): Promise<UpsertOutcome[]> {
  const ids = [
    ...new Set(upserted.filter((u) => u.persisted).map((u) => u.game.id)),
  ];
  if (ids.length === 0) return upserted;
  const excluded = await deps.findBannedOrHiddenIds(ids);
  return upserted.filter((u) => !(u.persisted && excluded.has(u.game.id)));
}

/** One search hit after the upsert; `persisted` = it has a real DB id. */
interface UpsertOutcome {
  game: GameDetailDto;
  persisted: boolean;
}

/** Upsert all games to DB to get real IDs. */
async function upsertAll(
  deps: ItadSearchDeps,
  games: GameDetailDto[],
): Promise<UpsertOutcome[]> {
  const results: UpsertOutcome[] = [];
  for (const game of games) {
    try {
      results.push({ game: await deps.upsertGame(game), persisted: true });
    } catch {
      if (await isModeratedCandidate(deps, game)) continue;
      logger.warn(`Failed to upsert game "${game.slug}", using in-memory`);
      results.push({ game, persisted: false });
    }
  }
  return results;
}

/**
 * ROK-1843: a candidate whose upsert failed is surfaced in-memory only when
 * no banned/hidden row matches it on any key. Fails closed: if the lookup
 * itself fails, the candidate is dropped.
 */
async function isModeratedCandidate(
  deps: ItadSearchDeps,
  game: GameDetailDto,
): Promise<boolean> {
  try {
    return await deps.hasModeratedMatch(game);
  } catch {
    logger.warn(`Moderation lookup failed for "${game.slug}", dropping it`);
    return true;
  }
}

/** Fire the upsert callbacks for persisted rows that survived moderation. */
function notifyUpserted(deps: ItadSearchDeps, upserted: UpsertOutcome[]): void {
  for (const { game, persisted } of upserted) {
    if (!persisted || game.id == null) continue;
    deps.onGameUpserted?.(game.id);
    if (!game.igdbId) deps.onUnenriched?.(game.id);
  }
}

/** Check if a game name matches adult keywords. */
function matchesAdultKeyword(name: string): boolean {
  const lower = name.toLowerCase();
  return ADULT_KEYWORDS.some((kw) => lower.includes(kw));
}
