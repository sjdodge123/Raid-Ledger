import type { IgdbService } from '../igdb/igdb.service';
import type { IgdbSyncStatusDto } from '@raid-ledger/contract';
import type { Logger } from '@nestjs/common';

/**
 * Extracted IGDB sync helpers from settings.controller.ts for file size compliance.
 */

export function getIgdbSyncStatus(
  igdbService: IgdbService,
): Promise<IgdbSyncStatusDto> {
  return igdbService.getSyncStatus();
}

export async function triggerIgdbSync(
  igdbService: IgdbService,
  logger: Logger,
): Promise<{
  success: boolean;
  message: string;
  refreshed: number;
  discovered: number;
  backfilled: number;
}> {
  try {
    // An admin waits on this request (nginx proxy_read_timeout 120s), so ITAD
    // enrichment keeps the fail-fast default on a long 429 pause.
    const result = await igdbService.syncAllGames();
    return {
      success: true,
      message: `Sync complete: ${result.refreshed} refreshed, ${result.discovered} discovered, ${result.backfilled} backfilled`,
      ...result,
    };
  } catch (error) {
    logger.error('Manual IGDB sync failed:', error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'Sync failed unexpectedly',
      refreshed: 0,
      discovered: 0,
      backfilled: 0,
    };
  }
}
