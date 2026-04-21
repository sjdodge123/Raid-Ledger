/**
 * IgdbService.syncAllGames orchestration helper (extracted to keep
 * igdb.service.ts under the 300-line ESLint limit).
 *
 * The full sync pipeline runs six distinct phases against IGDB+ITAD:
 * refresh → discover → backfill covers → ITAD enrichment → IGDB
 * re-enrichment → discovery-cache clear. Each phase is its own helper
 * elsewhere in the module; this file just sequences them.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type * as schema from '../drizzle/schema';
import type { ItadService } from '../itad/itad.service';
import type { IgdbApiGame } from './igdb.constants';
import {
  refreshExistingGames,
  discoverPopularGames,
  clearDiscoveryCache,
  buildAdultThemeFilter,
  backfillMissingCovers,
  enrichSyncedGamesWithItad,
  reEnrichGamesWithIgdb,
} from './igdb-helpers.barrel';
import type { ReEnrichResult } from './igdb-reenrichment.helpers';

export interface SyncAllDeps {
  db: PostgresJsDatabase<typeof schema>;
  redis: Redis;
  itadService: ItadService;
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>;
  isAdultFilterEnabled: () => Promise<boolean>;
  onGameChanged: (gameId: number) => void;
}

export interface SyncAllSummary {
  refreshed: number;
  discovered: number;
  backfilled: number;
  enriched: number;
  reEnriched: ReEnrichResult;
}

/** Execute the full IGDB+ITAD sync pipeline. */
export async function runSyncAllGames(
  deps: SyncAllDeps,
): Promise<SyncAllSummary> {
  const themeFilter = buildAdultThemeFilter(await deps.isAdultFilterEnabled());
  const refreshed = await refreshExistingGames(
    deps.db,
    deps.queryIgdb,
    themeFilter,
  );
  const discovered = await discoverPopularGames(
    deps.db,
    deps.queryIgdb,
    themeFilter,
  );
  const backfilled = await backfillMissingCovers(deps.db, deps.queryIgdb);
  const enriched = await enrichSyncedGamesWithItad(
    deps.db,
    (id) => deps.itadService.lookupBySteamAppId(id),
    (itadId) => deps.itadService.getGameInfo(itadId),
    deps.onGameChanged,
  );
  const reEnriched = await reEnrichGamesWithIgdb(deps.db, deps.queryIgdb);
  await clearDiscoveryCache(deps.redis);
  return { refreshed, discovered, backfilled, enriched, reEnriched };
}
