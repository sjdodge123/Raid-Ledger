/**
 * Co-Optimus enrichment sync (ROK-1397).
 *
 * UPDATE-only by design: this path never INSERTs into `games`, which keeps
 * it entirely outside the findGameByNormalizedName dedup-guard requirement
 * (reference_games_insert_paths). Writes touch cooptimus_* columns only —
 * blanket updates clobbering operator-customized fields is a documented
 * prior incident.
 *
 * Matching (plan §4): pinned cooptimus_id re-syncs by id; otherwise name
 * search → steam-id arbiter / exact-normalized title; edition-suffix base
 * hits go to the REVIEW QUEUE (Redis list, admin-visible later), never
 * auto-map. An empty envelope is a positive "no co-op entry": counts zeroed
 * and cooptimus_synced_at stamped, distinct from never-synced NULL.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { CooptimusService } from './cooptimus.service';
import {
  COOPTIMUS_SYNC_CRON,
  COOPTIMUS_STALE_AFTER_DAYS,
  COOPTIMUS_REVIEW_QUEUE_KEY,
  COOPTIMUS_REVIEW_QUEUE_MAX,
} from './cooptimus.constants';
import {
  matchEntries,
  pickPlatformEntry,
  stripEditionSuffix,
  deriveFeatureFlags,
} from './cooptimus-match.helpers';
import type { CooptimusEntry } from './cooptimus-xml.util';

type GameRow = {
  id: number;
  name: string;
  steamAppId: number | null;
  cooptimusId: number | null;
};

export type SyncOutcome = 'synced' | 'no-entry' | 'review' | 'failed';

export interface SyncSummary {
  scanned: number;
  synced: number;
  noEntry: number;
  review: number;
  failed: number;
  /** True when the batch stopped early on consecutive transport failures. */
  aborted: boolean;
}

/** Abort a batch after this many consecutive failures (revoked UA etc.). */
const MAX_CONSECUTIVE_FAILURES = 5;

@Injectable()
export class CooptimusSyncService {
  private readonly logger = new Logger(CooptimusSyncService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly cooptimus: CooptimusService,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Weekly delta sync — records a no-op run while unconfigured (ITAD convention). */
  @Cron(COOPTIMUS_SYNC_CRON, { name: 'CooptimusSyncService_weeklySync' })
  async weeklySync(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'CooptimusSyncService_weeklySync',
      async () => {
        if (!(await this.cooptimus.isConfigured())) return false;
        await this.runSync();
      },
    );
  }

  /** Sync every never-synced or stale, visible game. Serial — rate-limited transport. */
  async runSync(): Promise<SyncSummary> {
    const staleBefore = new Date(
      Date.now() - COOPTIMUS_STALE_AFTER_DAYS * 24 * 3600 * 1000,
    );
    const rows: GameRow[] = await this.db
      .select({
        id: schema.games.id,
        name: schema.games.name,
        steamAppId: schema.games.steamAppId,
        cooptimusId: schema.games.cooptimusId,
      })
      .from(schema.games)
      .where(
        and(
          eq(schema.games.hidden, false),
          eq(schema.games.banned, false),
          or(
            isNull(schema.games.cooptimusSyncedAt),
            lt(schema.games.cooptimusSyncedAt, staleBefore),
          ),
        ),
      );
    const summary: SyncSummary = {
      scanned: rows.length,
      synced: 0,
      noEntry: 0,
      review: 0,
      failed: 0,
      aborted: false,
    };
    let consecutiveFailures = 0;
    for (const row of rows) {
      const outcome = await this.syncGame(row);
      if (outcome === 'synced') summary.synced++;
      else if (outcome === 'no-entry') summary.noEntry++;
      else if (outcome === 'review') summary.review++;
      else summary.failed++;
      // A revoked UA fails EVERY row — don't grind a whole library of
      // throttled, guaranteed-futile requests weekly (review finding).
      consecutiveFailures = outcome === 'failed' ? consecutiveFailures + 1 : 0;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        summary.aborted = true;
        this.logger.error(
          `Co-Optimus sync aborted after ${consecutiveFailures} consecutive failures — check the UA allowlisting (admin Test button)`,
        );
        break;
      }
    }
    // Staleness visibility: rows that STILL couldn't refresh this run keep
    // aging silently otherwise (deliberate lightweight take on the ITAD
    // clearStale analog — see ROK-1397 notes).
    this.logger.log(
      `Co-Optimus sync: ${summary.synced} synced, ${summary.noEntry} no-entry, ` +
        `${summary.review} review, ${summary.failed} failed of ${summary.scanned}` +
        (summary.aborted ? ' (ABORTED)' : ''),
    );
    return summary;
  }

  /** Sync one game row; isolated failures never abort a batch. */
  async syncGame(row: GameRow): Promise<SyncOutcome> {
    try {
      // Pinned id (manual override or prior match) re-syncs directly.
      if (row.cooptimusId != null) {
        const byId = await this.cooptimus.searchById(row.cooptimusId);
        if (byId == null) return 'failed';
        if (byId.entries.length > 0) {
          await this.applyEntries(row.id, byId.entries);
          return 'synced';
        }
        // Zero entries WITHOUT the literal empty envelope = garbage 200
        // (challenge HTML, truncated body). Never let it destroy a pin
        // (HIGH review finding) — bail as transient failure.
        if (!byId.empty) return 'failed';
        // Positive empty: the pin points at a removed entry — fall through.
      }
      const lookup = await this.cooptimus.searchByName(row.name);
      if (lookup == null) return 'failed'; // transport disabled mid-run
      // Same garbage-200 guard: only a positive empty envelope (or real
      // entries that fail to match) may reach markNoEntry.
      if (lookup.entries.length === 0 && !lookup.empty) return 'failed';
      const match = matchEntries(lookup.entries, row.name, row.steamAppId);
      if (match.status === 'matched') {
        await this.applyEntries(row.id, match.entries);
        return 'synced';
      }
      if (match.status === 'review') {
        await this.pushReview(row, match.baseTitle);
        return 'review';
      }
      // Edition-suffix fallback needs a SECOND query: their LIKE search on
      // the longer edition name cannot return the shorter base title.
      const base = stripEditionSuffix(row.name);
      if (base) {
        const baseLookup = await this.cooptimus.searchByName(base);
        const baseMatch =
          baseLookup &&
          matchEntries(baseLookup.entries, row.name, row.steamAppId);
        // Steam-id equality is the designated exact-match arbiter — a
        // base-query hit carrying OUR steam id is auto-accept grade, not
        // review (rl-review #2). Everything else from the fallback query
        // stays review-only.
        if (baseMatch && baseMatch.status === 'matched') {
          if (baseMatch.method === 'steam-id') {
            await this.applyEntries(row.id, baseMatch.entries);
            return 'synced';
          }
          await this.pushReview(row, base);
          return 'review';
        }
        if (baseMatch && baseMatch.status === 'review') {
          await this.pushReview(row, base);
          return 'review';
        }
      }
      await this.markNoEntry(row.id);
      return 'no-entry';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Co-Optimus sync failed for game ${row.id} (${row.name}): ${msg}`,
      );
      return 'failed';
    }
  }

  /** Peek the review queue (admin surface consumes this later). */
  async getReviewQueue(): Promise<string[]> {
    return this.redis.lrange(COOPTIMUS_REVIEW_QUEUE_KEY, 0, -1);
  }

  private async applyEntries(
    gameId: number,
    entries: CooptimusEntry[],
  ): Promise<void> {
    const chosen = pickPlatformEntry(entries);
    if (!chosen) return;
    const flags = deriveFeatureFlags(chosen.featurelist);
    await this.db
      .update(schema.games)
      .set({
        cooptimusId: chosen.id,
        cooptimusOnlineMax: chosen.online,
        cooptimusCouchMax: chosen.local,
        cooptimusLanMax: chosen.lan,
        cooptimusSplitscreen: chosen.splitscreen,
        cooptimusDropIn: chosen.dropInDropOut,
        cooptimusCampaignCoop: chosen.campaign,
        cooptimusComboCoop: flags.comboCoop,
        cooptimusUrl: chosen.url,
        cooptimusExtras: {
          system: chosen.system,
          steamAppId: chosen.steam,
          featurelist: chosen.featurelist,
          coopExperience: chosen.coopExperience,
          description: chosen.description,
          downloadableOnly: flags.downloadableOnly,
        },
        cooptimusSyncedAt: new Date(),
      })
      .where(eq(schema.games.id, gameId));
  }

  /** Positive "no co-op entry": zeroed counts + stamp, never-synced ≠ this. */
  private async markNoEntry(gameId: number): Promise<void> {
    await this.db
      .update(schema.games)
      .set({
        cooptimusId: null,
        cooptimusOnlineMax: 0,
        cooptimusCouchMax: 0,
        cooptimusLanMax: 0,
        cooptimusSplitscreen: false,
        cooptimusDropIn: false,
        cooptimusCampaignCoop: false,
        cooptimusComboCoop: false,
        cooptimusUrl: null,
        cooptimusExtras: null,
        cooptimusSyncedAt: new Date(),
      })
      .where(eq(schema.games.id, gameId));
  }

  private async pushReview(row: GameRow, baseTitle: string): Promise<void> {
    // Dedup by gameId — the same unresolved candidate would otherwise
    // re-queue every staleness cycle (review finding). O(queue cap) weekly.
    const existing = await this.redis.lrange(COOPTIMUS_REVIEW_QUEUE_KEY, 0, -1);
    const already = existing.some((raw) => {
      try {
        return (JSON.parse(raw) as { gameId?: number }).gameId === row.id;
      } catch {
        return false;
      }
    });
    if (already) {
      await this.stampSyncedAt(row.id);
      return;
    }
    const item = JSON.stringify({
      gameId: row.id,
      name: row.name,
      baseTitle,
      at: new Date().toISOString(),
    });
    await this.redis.lpush(COOPTIMUS_REVIEW_QUEUE_KEY, item);
    await this.redis.ltrim(
      COOPTIMUS_REVIEW_QUEUE_KEY,
      0,
      COOPTIMUS_REVIEW_QUEUE_MAX - 1,
    );
    this.logger.warn(
      `Co-Optimus review candidate: game ${row.id} "${row.name}" → base "${baseTitle}" (pin cooptimus_id to accept)`,
    );
    // Stamp synced_at so the weekly cron doesn't re-queue the same candidate
    // every run; the pin (cooptimus_id) or a stale re-sync revisits it.
    await this.stampSyncedAt(row.id);
  }

  private async stampSyncedAt(gameId: number): Promise<void> {
    await this.db
      .update(schema.games)
      .set({ cooptimusSyncedAt: new Date() })
      .where(eq(schema.games.id, gameId));
  }
}
