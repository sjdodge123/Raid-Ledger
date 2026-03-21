/**
 * Barrel re-export for IGDB helper modules used by IgdbService.
 * Reduces import section size in the service file.
 */
export { mapApiGameToDbRow, mapDbRowToDetail } from './igdb.mappers';
export { searchLocalGames } from './igdb-search.helpers';
export {
  lookupGameById,
  lookupGameDetailById,
} from './igdb-game-lookup.helpers';
export {
  fetchTwitchToken,
  fetchFromIgdb,
  fetchWithRetry,
} from './igdb-api.helpers';
export {
  upsertGamesFromApi,
  upsertSingleGameRow,
  backfillMissingCovers,
} from './igdb-upsert.helpers';
export { queryNowPlaying } from './igdb-activity.helpers';
export {
  querySyncStatus,
  buildHealthStatus,
  queryGameActivity,
} from './igdb-status.helpers';
export {
  toggleGameVisibility,
  banGame as banGameHelper,
  unbanGame as unbanGameHelper,
  hideAdultGames as hideAdultGamesHelper,
} from './igdb-moderation.helpers';
export {
  refreshExistingGames,
  discoverPopularGames,
  clearDiscoveryCache,
  buildAdultThemeFilter,
  enrichSyncedGamesWithItad,
} from './igdb-sync.helpers';
export { executeIgdbQuery } from './igdb-query.helpers';
export {
  executeSearch,
  doSearchRefresh,
  type SearchDeps,
} from './igdb-search-executor.helpers';
export {
  executeItadSearch,
  type ItadSearchDeps,
} from './igdb-itad-search.helpers';
export {
  buildExternalGamesQuery,
  parseIgdbEnrichment,
} from './igdb-itad-enrich.helpers';
