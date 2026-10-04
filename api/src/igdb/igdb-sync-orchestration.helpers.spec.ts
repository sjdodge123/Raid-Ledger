/**
 * runSyncAllGames threads its ITAD fetch options into the enrichment phase:
 * the BullMQ job waits out a 429 pause, the admin HTTP sync fails fast.
 */
import {
  runSyncAllGames,
  type SyncAllDeps,
} from './igdb-sync-orchestration.helpers';
import { enrichSyncedGamesWithItad } from './igdb-helpers.barrel';
import { ITAD_BACKGROUND_FETCH } from '../itad/itad.constants';
import { at } from '../common/testing/narrow';

jest.mock('./igdb-helpers.barrel', () => ({
  refreshExistingGames: jest.fn().mockResolvedValue(0),
  discoverPopularGames: jest.fn().mockResolvedValue(0),
  clearDiscoveryCache: jest.fn().mockResolvedValue(undefined),
  buildAdultThemeFilter: jest.fn().mockReturnValue(''),
  backfillMissingCovers: jest.fn().mockResolvedValue(0),
  enrichSyncedGamesWithItad: jest.fn().mockResolvedValue(0),
  reEnrichGamesWithIgdb: jest.fn().mockResolvedValue({}),
}));

function buildDeps(itadOpts?: SyncAllDeps['itadOpts']) {
  const itadService = {
    lookupBySteamAppId: jest.fn().mockResolvedValue(null),
    getGameInfo: jest.fn().mockResolvedValue(null),
  };
  const deps = {
    db: {},
    redis: {},
    itadService,
    queryIgdb: jest.fn(),
    isAdultFilterEnabled: jest.fn().mockResolvedValue(false),
    onGameChanged: jest.fn(),
    ...(itadOpts ? { itadOpts } : {}),
  } as unknown as SyncAllDeps;
  return { deps, itadService };
}

/** Run the sync, then invoke the enrichment phase's ITAD callbacks. */
async function runEnrichmentCallbacks(deps: SyncAllDeps): Promise<void> {
  await runSyncAllGames(deps);
  const [, lookup, getInfo] = at(
    jest.mocked(enrichSyncedGamesWithItad).mock.calls,
    0,
  );
  await lookup(620);
  await getInfo('itad-1');
}

describe('runSyncAllGames — ITAD fetch options', () => {
  beforeEach(() => jest.mocked(enrichSyncedGamesWithItad).mockClear());

  it('forwards the background options of the BullMQ job to every ITAD call', async () => {
    const { deps, itadService } = buildDeps(ITAD_BACKGROUND_FETCH);

    await runEnrichmentCallbacks(deps);

    expect(itadService.lookupBySteamAppId).toHaveBeenCalledWith(
      620,
      ITAD_BACKGROUND_FETCH,
    );
    expect(itadService.getGameInfo).toHaveBeenCalledWith('itad-1', {
      ...ITAD_BACKGROUND_FETCH,
      throwOnExhausted: true,
    });
  });

  it('keeps the fail-fast default without options (admin HTTP sync)', async () => {
    const { deps, itadService } = buildDeps();

    await runEnrichmentCallbacks(deps);

    expect(itadService.lookupBySteamAppId).toHaveBeenCalledWith(620, undefined);
    expect(itadService.getGameInfo).toHaveBeenCalledWith('itad-1', {
      throwOnExhausted: true,
    });
  });
});
