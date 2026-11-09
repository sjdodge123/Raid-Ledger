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
import type { ItadFetchOptions } from '../itad/itad-http.util';
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
import { collectChangedGames } from './taste-input-change.helpers';

export interface SyncAllDeps {
  db: PostgresJsDatabase<typeof schema>;
  redis: Redis;
  itadService: ItadService;
  /** ITAD fetch options for enrichment: default fail-fast (admin HTTP path). */
  itadOpts?: ItadFetchOptions;
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

type PhaseCounts = Omit<SyncAllSummary, 'reEnriched'>;

/**
 * Refresh → discover → backfill covers → ITAD enrichment: the phases that
 * report a taste-input change through `notify`.
 */
async function runChangeEmittingPhases(
  deps: SyncAllDeps,
  themeFilter: string,
  notify: (gameId: number) => void,
): Promise<PhaseCounts> {
  const { db, queryIgdb } = deps;
  const refreshed = await refreshExistingGames(
    db,
    queryIgdb,
    themeFilter,
    notify,
  );
  const discovered = await discoverPopularGames(
    db,
    queryIgdb,
    themeFilter,
    notify,
  );
  const backfilled = await backfillMissingCovers(db, queryIgdb);
  const enriched = await enrichSyncedGamesWithItad(
    db,
    (id) => deps.itadService.lookupBySteamAppId(id, deps.itadOpts),
    // Rate-limited info rejects, so enrichment keeps the row's existing tags.
    (itadId) =>
      deps.itadService.getGameInfo(itadId, {
        ...deps.itadOpts,
        throwOnExhausted: true,
      }),
    notify,
  );
  return { refreshed, discovered, backfilled, enriched };
}

/** Execute the full IGDB+ITAD sync pipeline. */
export async function runSyncAllGames(
  deps: SyncAllDeps,
): Promise<SyncAllSummary> {
  const themeFilter = buildAdultThemeFilter(await deps.isAdultFilterEnabled());
  // ROK-2121: one recompute per changed game, enqueued after the ITAD phase
  // so it sees the final row; `finally` still enqueues on a mid-sync throw.
  const changed = collectChangedGames(deps.onGameChanged);
  const counts = await runChangeEmittingPhases(
    deps,
    themeFilter,
    changed.notify,
  ).finally(() => changed.flush());
  const reEnriched = await reEnrichGamesWithIgdb(deps.db, deps.queryIgdb);
  await clearDiscoveryCache(deps.redis);
  return { ...counts, reEnriched };
}
