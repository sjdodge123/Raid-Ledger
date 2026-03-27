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
import { isNotNull, and, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { ItadPriceService } from './itad-price.service';
import { ItadService } from './itad.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import type { ItadOverviewGameEntry } from './itad-price.types';
import { enrichChunkEarlyAccess } from './itad-early-access-sync.helpers';

/** Number of games to fetch from ITAD per batch request. */
export const CHUNK_SIZE = 50;

/** Delay (ms) before bootstrap sync fires. */
const BOOTSTRAP_DELAY_MS = 30_000;

type Db = PostgresJsDatabase<typeof schema>;

/** Pricing fields extracted from an ITAD entry for DB persistence. */
export interface ItadPricingData {
  itadCurrentPrice: string | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
  itadLowestPrice: string | null;
  itadLowestCut: number | null;
  itadPriceUpdatedAt: string;
}

/** Build the SET clause data from an ITAD entry. */
export function buildUpdateData(
  entry: ItadOverviewGameEntry,
  now: Date,
): ItadPricingData {
  return {
    itadCurrentPrice: entry.current?.price.amount.toFixed(2) ?? null,
    itadCurrentCut: entry.current?.cut ?? null,
    itadCurrentShop: entry.current?.shop.name ?? null,
    itadCurrentUrl: entry.current?.url ?? null,
    itadLowestPrice: entry.lowest?.price.amount.toFixed(2) ?? null,
    itadLowestCut: entry.lowest?.cut ?? null,
    itadPriceUpdatedAt: now.toISOString(),
  };
}

/** Row shape for the bulk pricing UPDATE ... FROM VALUES. */
type PricingRow = ItadPricingData & { id: number };

/**
 * Execute a single UPDATE ... FROM VALUES for all matched games.
 * Uses COALESCE for lowest_* columns so null API responses don't
 * overwrite existing historical data. Current_* columns are NOT
 * coalesced -- null means no active deal (ROK-854).
 */
export async function executeBulkPricingUpdate(
  db: Db,
  rows: PricingRow[],
): Promise<void> {
  const frags = rows.map(
    (r) =>
      sql`(${r.id}::int, ${r.itadCurrentPrice}::numeric, ${r.itadCurrentCut}::int, ${r.itadCurrentShop}::text, ${r.itadCurrentUrl}::text, ${r.itadLowestPrice}::numeric, ${r.itadLowestCut}::int, ${r.itadPriceUpdatedAt}::timestamptz)`,
  );
  const valuesList = sql.join(frags, sql`, `);

  await db.execute(sql`
    UPDATE ${schema.games} AS g
    SET
      itad_current_price = v.current_price,
      itad_current_cut = v.current_cut,
      itad_current_shop = v.current_shop,
      itad_current_url = v.current_url,
      itad_lowest_price = COALESCE(v.lowest_price, g.itad_lowest_price),
      itad_lowest_cut = COALESCE(v.lowest_cut, g.itad_lowest_cut),
      itad_price_updated_at = v.updated_at
    FROM (VALUES ${valuesList})
      AS v(id, current_price, current_cut, current_shop, current_url, lowest_price, lowest_cut, updated_at)
    WHERE g.id = v.id
  `);
}

/** Shape of postgres.js error properties we want to extract. */
interface PgErrorLike {
  message?: string;
  code?: string;
  detail?: string;
  hint?: string;
  cause?: PgErrorLike;
}

/**
 * Extract Postgres error details from a Drizzle-wrapped error.
 * Drizzle wraps PG errors so `err.message` is "Failed query: <SQL>".
 * The real PG error is in `.cause` with code, detail, and hint.
 */
export function extractErrorDetail(err: unknown): string {
  const raw = err instanceof Error ? err : { message: String(err) };
  const pgError: PgErrorLike = (raw as PgErrorLike).cause ?? raw;
  return [
    pgError.message,
    pgError.code ? `code=${pgError.code}` : null,
    pgError.detail ? `detail=${pgError.detail}` : null,
    pgError.hint ? `hint=${pgError.hint}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
}

@Injectable()
export class ItadPriceSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ItadPriceSyncService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly itadPriceService: ItadPriceService,
    private readonly itadService: ItadService,
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
   * @returns false if no games need syncing (no-op).
   */
  async syncPricing(): Promise<void | false> {
    const games = await this.queryGamesWithItadId();
    if (games.length === 0) {
      this.logger.log('No games with ITAD IDs — skipping pricing sync');
      return false;
    }

    this.logger.log(`Syncing ITAD pricing for ${games.length} games`);
    const chunks = this.chunkArray(games, CHUNK_SIZE);

    let succeeded = 0;
    let failed = 0;
    for (const chunk of chunks) {
      const ok = await this.processChunk(chunk);
      if (ok) succeeded++;
      else failed++;
    }
    const cleared = await this.clearStalePricing();
    if (cleared > 0) {
      this.logger.log(`Cleared stale pricing for ${cleared} games`);
    }
    this.logSyncSummary(succeeded, failed, games.length);

    await this.syncEarlyAccess(games);
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
  ): Promise<boolean> {
    try {
      const itadIds = chunk.map((g) => g.itadGameId);
      const entries = await this.itadPriceService.getOverviewBatch(itadIds);
      const entryMap = new Map(entries.map((e) => [e.id, e]));

      await this.updateGamesWithPricing(chunk, entryMap);
      this.logger.debug(`Updated pricing for chunk of ${chunk.length} games`);
      return true;
    } catch (err) {
      const detail = extractErrorDetail(err);
      this.logger.error(`Failed to process ITAD pricing chunk: ${detail}`);
      return false;
    }
  }

  /**
   * Bulk-update game rows with ITAD pricing data.
   * Uses a single UPDATE ... FROM VALUES instead of N individual queries.
   */
  private async updateGamesWithPricing(
    chunk: { id: number; itadGameId: string }[],
    entryMap: Map<string, ItadOverviewGameEntry>,
  ): Promise<void> {
    const now = new Date();
    const matched = chunk.filter((g) => entryMap.has(g.itadGameId));
    if (matched.length === 0) return;

    const rows = matched.map((g) => {
      const data = buildUpdateData(entryMap.get(g.itadGameId)!, now);
      return { id: g.id, ...data };
    });
    await executeBulkPricingUpdate(this.db, rows);
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
          lt(schema.games.itadPriceUpdatedAt, sql`NOW() - INTERVAL '7 days'`),
        ),
      )
      .returning({ id: schema.games.id });
    return result.length;
  }

  /** Log sync completion summary at appropriate level. */
  private logSyncSummary(
    succeeded: number,
    failed: number,
    totalGames: number,
  ): void {
    const msg = `ITAD pricing sync complete: ${succeeded} chunks succeeded, ${failed} failed, ${totalGames} games total`;
    if (failed > 0) {
      this.logger.warn(msg);
    } else {
      this.logger.log(msg);
    }
  }

  /**
   * Enrich games with earlyAccess status from ITAD game info.
   * Runs after pricing sync. Results are Redis-cached via ItadService.
   */
  private async syncEarlyAccess(
    games: { id: number; itadGameId: string }[],
  ): Promise<void> {
    let updated = 0;
    for (const chunk of this.chunkArray(games, CHUNK_SIZE)) {
      updated += await enrichChunkEarlyAccess(this.db, this.itadService, chunk);
    }
    if (updated > 0) {
      this.logger.log(`Updated earlyAccess for ${updated} games`);
    }
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
