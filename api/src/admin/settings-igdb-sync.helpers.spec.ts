/**
 * The admin "Sync now" endpoint holds an HTTP request, so it must run the
 * IGDB sync with the fail-fast ITAD default, never the background wait.
 */
import type { Logger } from '@nestjs/common';
import type { IgdbService } from '../igdb/igdb.service';
import { triggerIgdbSync } from './settings-igdb-sync.helpers';

describe('triggerIgdbSync — ITAD fetch options', () => {
  it('runs the sync without ITAD options, so enrichment fails fast on a long 429 pause', async () => {
    const syncAllGames = jest
      .fn()
      .mockResolvedValue({ refreshed: 1, discovered: 2, backfilled: 3 });
    const igdbService = { syncAllGames } as unknown as IgdbService;
    const logger = { error: jest.fn() } as unknown as Logger;

    const result = await triggerIgdbSync(igdbService, logger);

    expect(result.success).toBe(true);
    expect(syncAllGames).toHaveBeenCalledTimes(1);
    expect(syncAllGames).toHaveBeenCalledWith();
  });
});
