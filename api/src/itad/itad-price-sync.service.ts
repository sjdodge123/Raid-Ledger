/**
 * ITAD pricing sync service (ROK-818).
 * Periodically syncs pricing data from ITAD API into the games table.
 */
import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { isNotNull, eq, and, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { ItadPriceService } from './itad-price.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import type { ItadOverviewGameEntry } from './itad-price.types';

/** Number of games to fetch from ITAD per batch request. */
export const CHUNK_SIZE = 50;

/** Delay (ms) before bootstrap sync fires. */
const BOOTSTRAP_DELAY_MS = 30_000;

/** Clear stale pricing after this many days without valid data. */
const STALE_PRICING_DAYS = 7;

type Db = PostgresJsDatabase<typeof schema>;

/** Build the SET clause data from an ITAD entry. */
export function buildUpdateData(
  entry: ItadOverviewGameEntry,
  now: Date,
): Record<string, unknown> {
  return {
    itadCurrentPrice: entry.current?.price.amount.toFixed(2) ?? null,
    itadCurrentCut: entry.current?.cut ?? null,
    itadCurrentShop: entry.current?.shop.name ?? null,
    itadCurrentUrl: entry.current?.url ?? null,
    itadLowestPrice: entry.lowest?.price.amount.toFixed(2) ?? null,
    itadLowestCut: entry.lowest?.cut ?? null,
    itadPriceUpdatedAt: now,
  };
}

@Injectable()
export class ItadPriceSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ItadPriceSyncService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly itadPriceService: ItadPriceService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Trigger initial pricing sync after startup delay. */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      this.syncPricing().catch((err) =>
        this.logger.error(`Bootstrap pricing sync failed: ${err}`),
      );
    }, BOOTSTRAP_DELAY_MS);
  }

  /** Cron: sync ITAD pricing every 4 hours. */
  @Cron('0 */4 * * *', { name: 'ItadPriceSyncService_syncPricing' })
  async scheduledSync(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'ItadPriceSyncService_syncPricing',
      () => this.syncPricing(),
    );
  }

  /**
   * Fetch ITAD pricing for all games with an itadGameId and persist to DB.
   * Processes in chunks of 50. Logs errors per chunk and continues.
   */
  async syncPricing(): Promise<void> {
    const games = await this.queryGamesWithItadId();
    if (games.length === 0) {
      this.logger.log('No games with ITAD IDs — skipping pricing sync');
      return;
    }

    this.logger.log(`Syncing ITAD pricing for ${games.length} games`);
    const chunks = this.chunkArray(games, CHUNK_SIZE);

    for (const chunk of chunks) {
      await this.processChunk(chunk);
    }
    const cleared = await this.clearStalePricing();
    if (cleared > 0) {
      this.logger.log(`Cleared stale pricing for ${cleared} games`);
    }
    this.logger.log('ITAD pricing sync complete');
  }

  /** Query all games that have an itadGameId. */
  private async queryGamesWithItadId(): Promise<
    { id: number; itadGameId: string }[]
  > {
    const rows = await this.db
      .select({ id: schema.games.id, itadGameId: schema.games.itadGameId })
      .from(schema.games)
      .where(isNotNull(schema.games.itadGameId));

    return rows.filter(
      (r): r is { id: number; itadGameId: string } => r.itadGameId !== null,
    );
  }

  /** Process a single chunk: fetch pricing and update DB rows. */
  private async processChunk(
    chunk: { id: number; itadGameId: string }[],
  ): Promise<void> {
    try {
      const itadIds = chunk.map((g) => g.itadGameId);
      const entries = await this.itadPriceService.getOverviewBatch(itadIds);
      const entryMap = new Map(entries.map((e) => [e.id, e]));

      await this.updateGamesWithPricing(chunk, entryMap);
    } catch (err) {
      this.logger.error(
        `Failed to process ITAD pricing chunk: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Update each game row with its ITAD pricing data. */
  private async updateGamesWithPricing(
    chunk: { id: number; itadGameId: string }[],
    entryMap: Map<string, ItadOverviewGameEntry>,
  ): Promise<void> {
    const now = new Date();
    for (const game of chunk) {
      const entry = entryMap.get(game.itadGameId);
      if (!entry) continue; // skip — stale cleanup handles missing entries
      await this.db
        .update(schema.games)
        .set(buildUpdateData(entry, now))
        .where(eq(schema.games.id, game.id));
    }
  }

  /** Clear pricing columns for games not updated in STALE_PRICING_DAYS. */
  async clearStalePricing(): Promise<number> {
    const result = await this.db
      .update(schema.games)
      .set({
        itadCurrentPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        itadLowestPrice: null,
        itadLowestCut: null,
      })
      .where(
        and(
          isNotNull(schema.games.itadGameId),
          isNotNull(schema.games.itadCurrentPrice),
          lt(
            schema.games.itadPriceUpdatedAt,
            sql`NOW() - INTERVAL '${sql.raw(String(STALE_PRICING_DAYS))} days'`,
          ),
        ),
      )
      .returning({ id: schema.games.id });
    return result.length;
  }

  /** Split an array into chunks of the given size. */
  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
