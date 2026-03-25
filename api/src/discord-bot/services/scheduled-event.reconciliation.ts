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
import { findReconciliationCandidates } from './scheduled-event.db-helpers';

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
    for (const c of candidates) {
      try {
        await this.scheduledEventService.createScheduledEvent(
          c.id,
          c,
          c.gameId,
          c.isAdHoc,
          c.notificationChannelOverride,
        );
      } catch (err) {
        this.logger.error(
          `Reconciliation failed for event ${c.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }
  }
}
