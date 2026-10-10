/**
 * ITAD search dependency builder for IgdbService (ROK-773).
 * Constructs the ItadSearchDeps interface used by executeItadSearch.
 */
import { Logger } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ItadService } from '../itad/itad.service';
import type { IgdbApiGame } from './igdb.constants';
import type { ItadSearchDeps } from './igdb-itad-search.helpers';
import type { ItadSearchGame } from './igdb-itad-merge.helpers';
import {
  ITAD_INTERACTIVE_FETCH,
  type ItadGame,
  type ItadGameInfo,
} from '../itad/itad.constants';
import {
  buildExternalGamesQuery,
  parseIgdbEnrichment,
} from './igdb-itad-enrich.helpers';
import { upsertItadGame } from './igdb-itad-upsert.helpers';

const logger = new Logger('ItadSearchDeps');

/** Parameters for building ITAD search deps. */
export interface ItadDepsBuildParams {
  itadService: ItadService;
  db: PostgresJsDatabase<typeof schema>;
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>;
  getAdultFilter: () => Promise<boolean>;
  /** ROK-986: Callback when a game is upserted without IGDB data. */
  onUnenriched?: (gameId: number) => void;
  /** ROK-1082: fired after every successful upsert so callers can enqueue a
   * taste-vector recompute for that game id. */
  onGameUpserted?: (gameId: number) => void;
}

/**
 * Build ITAD search dependencies from service references.
 * @param params - Service references
 * @returns ItadSearchDeps for executeItadSearch
 */
export function buildItadSearchDeps(
  params: ItadDepsBuildParams,
): ItadSearchDeps {
  return {
    searchItad: (q) => searchAndMapItad(params.itadService, q),
    lookupSteamAppIds: (games) =>
      params.itadService.lookupSteamAppIds(games, ITAD_INTERACTIVE_FETCH),
    enrichFromIgdb: (appId) => enrichViaExternalGames(params.queryIgdb, appId),
    getAdultFilter: params.getAdultFilter,
    findBannedOrHiddenSlugs: (slugs) =>
      findBannedOrHiddenSlugs(params.db, slugs),
    upsertGame: (game) => upsertItadGame(params.db, game),
    ...(params.onUnenriched !== undefined
      ? { onUnenriched: params.onUnenriched }
      : {}),
    ...(params.onGameUpserted !== undefined
      ? { onGameUpserted: params.onGameUpserted }
      : {}),
  };
}

/** Search ITAD and map results to ItadSearchGame format. */
async function searchAndMapItad(
  itadService: ItadService,
  query: string,
): Promise<ItadSearchGame[]> {
  const results = await itadService.searchGames(
    query,
    undefined,
    ITAD_INTERACTIVE_FETCH,
  );
  return Promise.all(results.map((g) => mapItadGameToSearch(itadService, g)));
}

/** Map an ItadGame to the ItadSearchGame format with info enrichment. */
async function mapItadGameToSearch(
  itadService: ItadService,
  game: ItadGame,
): Promise<ItadSearchGame> {
  const info = await itadService.getGameInfo(game.id, ITAD_INTERACTIVE_FETCH);
  return mapToSearchGame(game, info);
}

/** Map ItadGame + optional ItadGameInfo to ItadSearchGame. */
function mapToSearchGame(
  game: ItadGame,
  info: ItadGameInfo | null,
): ItadSearchGame {
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    type: game.type,
    mature: game.mature,
    ...(game.assets !== undefined ? { assets: game.assets } : {}),
    ...(info?.tags !== undefined ? { tags: info.tags } : {}),
    ...(info?.releaseDate !== undefined
      ? { releaseDate: info.releaseDate }
      : {}),
  };
}

/** Query IGDB via external_games exact match for enrichment. */
async function enrichViaExternalGames(
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
  steamAppId: number,
) {
  try {
    const query = buildExternalGamesQuery(steamAppId);
    const games = await queryIgdb(query);
    const first = games[0];
    if (first === undefined) return null;
    return parseIgdbEnrichment(first);
  } catch (err) {
    logger.warn(
      `IGDB enrichment via external_games failed for steamAppId=${steamAppId}: ${String(err)}`,
    );
    return null;
  }
}

/**
 * Return the subset of `slugs` that are banned or hidden, in one query
 * (READLOGS:D2 — was one SELECT per search result). `games.slug` is unique,
 * so this matches the old per-slug `limit(1)` check exactly.
 */
async function findBannedOrHiddenSlugs(
  db: PostgresJsDatabase<typeof schema>,
  slugs: string[],
): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await db
    .select({ slug: schema.games.slug })
    .from(schema.games)
    .where(
      and(
        inArray(schema.games.slug, slugs),
        or(eq(schema.games.hidden, true), eq(schema.games.banned, true)),
      ),
    );
  return new Set(rows.map((r) => r.slug));
}
