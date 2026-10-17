/**
 * Controller-level glue for /games/pricing/batch (ROK-800, ROK-1047).
 * Pulled out of igdb.controller.ts to keep the file under the 300-line cap.
 */
import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadBatchPricingResponseDto } from '@raid-ledger/contract';
import { fetchBatchGamePricing } from './igdb-pricing.helpers';
import { enqueuePriceSync } from '../itad/itad-price-sync.helpers';

export async function handleBatchPricing(args: {
  db: PostgresJsDatabase<typeof schema>;
  itadPriceService: ItadPriceService;
  priceSyncQueue: Queue;
  logger: Logger;
  gameIds: number[];
}): Promise<ItadBatchPricingResponseDto> {
  const { db, itadPriceService, priceSyncQueue, logger, gameIds } = args;
  if (gameIds.length === 0) return { data: {} };
  const data = await fetchBatchGamePricing(
    db,
    itadPriceService,
    gameIds,
    (id) =>
      void enqueuePriceSync(priceSyncQueue, id).catch((err) =>
        logger.warn(`enqueue price sync ${id}: ${err}`),
      ),
  );
  return { data };
}
