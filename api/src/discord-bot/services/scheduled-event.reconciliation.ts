/**
 * Reconciliation cron for Discord Scheduled Events (ROK-755).
 *
 * Finds future events missing `discord_scheduled_event_id` and creates
 * Discord scheduled events for them. Runs every 15 minutes.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { ScheduledEventService } from './scheduled-event.service';
import {
  findReconciliationCandidates,
  setReconcileBackoff,
  type ReconciliationCandidate,
} from './scheduled-event.db-helpers';
import { CapacityStillSaturatedError } from './scheduled-event.helpers';

/** ROK-1332: pause-window applied to remaining candidates when Discord's
 *  guild-wide 100-SE cap is still saturated after GC. One hour matches the
 *  cron's 15-min cadence × 4 → next ~4 ticks skip the row. */
const CAPACITY_BACKOFF_MS = 60 * 60 * 1000;

@Injectable()
export class ScheduledEventReconciliationService {
  private readonly logger = new Logger(
    ScheduledEventReconciliationService.name,
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly cronJobService: CronJobService,
    private readonly scheduledEventService: ScheduledEventService,
  ) {}

  @Cron('0 */15 * * * *', {
    name: 'ScheduledEventReconciliation_reconcileMissing',
  })
  async handleReconcileMissing(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'ScheduledEventReconciliation_reconcileMissing',
      () => this.reconcileMissingScheduledEvents(),
    );
  }

  async reconcileMissingScheduledEvents(): Promise<void | false> {
    if (!this.clientService.isConnected()) return false;
    if (!this.clientService.getGuild()) return false;
    const candidates = await findReconciliationCandidates(this.db);
    if (candidates.length === 0) return false;
    this.logger.log(
      `Reconciling ${candidates.length} events missing Discord scheduled events`,
    );
    const processed: number[] = [];
    for (const c of candidates) {
      try {
        await this.scheduledEventService.createScheduledEvent(
          c.id,
          c,
          c.gameId,
          c.isAdHoc,
          c.notificationChannelOverride,
        );
        processed.push(c.id);
      } catch (err) {
        if (err instanceof CapacityStillSaturatedError) {
          await this.applyCapacityBackoff(candidates, processed, err);
          return;
        }
        this.logger.error(
          `Reconciliation failed for event ${c.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
  }

  /** ROK-1332: write 1h backoff to every still-unprocessed candidate and log
   *  a single WARN so the cap doesn't trigger an N-event Sentry storm. */
  private async applyCapacityBackoff(
    candidates: ReconciliationCandidate[],
    processed: number[],
    err: CapacityStillSaturatedError,
  ): Promise<void> {
    const processedSet = new Set(processed);
    const remaining = candidates
      .filter((c) => !processedSet.has(c.id))
      .map((c) => c.id);
    await setReconcileBackoff(
      this.db,
      remaining,
      new Date(Date.now() + CAPACITY_BACKOFF_MS),
    );
    this.logger.warn(
      `Discord SE capacity still saturated after GC (freed=0, orphanCount=${err.orphanCount}). Backing off ${remaining.length} events for 1h.`,
    );
  }
}
