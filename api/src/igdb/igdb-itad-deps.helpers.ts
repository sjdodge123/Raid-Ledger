/**
 * ITAD search dependency builder for IgdbService (ROK-773).
 * Constructs the ItadSearchDeps interface used by executeItadSearch.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { ItadService } from '../itad/itad.service';
import type { IgdbApiGame } from './igdb.constants';
import type { ItadSearchDeps } from './igdb-itad-search.helpers';
import type { ItadSearchGame } from './igdb-itad-merge.helpers';
import type { ItadGame, ItadGameInfo } from '../itad/itad.constants';
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
    lookupSteamAppIds: (games) => params.itadService.lookupSteamAppIds(games),
    enrichFromIgdb: (appId) => enrichViaExternalGames(params.queryIgdb, appId),
    getAdultFilter: params.getAdultFilter,
    isBannedOrHidden: (slug) => checkBannedOrHidden(params.db, slug),
    upsertGame: (game) => upsertItadGame(params.db, game),
    onUnenriched: params.onUnenriched,
  };
}

/** Search ITAD and map results to ItadSearchGame format. */
async function searchAndMapItad(
  itadService: ItadService,
  query: string,
): Promise<ItadSearchGame[]> {
  const results = await itadService.searchGames(query);
  return Promise.all(results.map((g) => mapItadGameToSearch(itadService, g)));
}

/** Map an ItadGame to the ItadSearchGame format with info enrichment. */
async function mapItadGameToSearch(
  itadService: ItadService,
  game: ItadGame,
): Promise<ItadSearchGame> {
  const info = await itadService.getGameInfo(game.id);
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
    assets: game.assets,
    tags: info?.tags,
    releaseDate: info?.releaseDate,
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
    if (games.length === 0) return null;
    return parseIgdbEnrichment(games[0]);
  } catch (err) {
    logger.warn(
      `IGDB enrichment via external_games failed for steamAppId=${steamAppId}: ${String(err)}`,
    );
    return null;
  }
}

/** Check if a game slug is banned or hidden in the database. */
async function checkBannedOrHidden(
  db: PostgresJsDatabase<typeof schema>,
  slug: string,
): Promise<boolean> {
  const rows = await db
    .select({
      hidden: schema.games.hidden,
      banned: schema.games.banned,
    })
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  return rows.length > 0 && (rows[0].hidden || rows[0].banned);
}
