/**
 * Reaps orphaned Quick Play (ad-hoc) events that were never finalized.
 *
 * Quick Play events rely on voice-leave events to trigger grace period and
 * finalization. If those events are missed (e.g., bot restart, network hiccup),
 * events can stay in 'live' or 'grace_period' status indefinitely (ROK-970).
 *
 * Runs every 5 minutes. Finds events whose effective end time passed > 30 min
 * ago and force-finalizes them.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  findOrphanedAdHocEvents,
  forceClaimOrphanedEvent,
  setEventEndTime,
} from './ad-hoc-event.helpers';

@Injectable()
export class AdHocReaperService {
  private readonly logger = new Logger(AdHocReaperService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly participantService: AdHocParticipantService,
    private readonly gateway: AdHocEventsGateway,
    private readonly cronJobService: CronJobService,
  ) {}

  /** Cron entry point: every 5 minutes, reap orphaned ad-hoc events. */
  @Cron('0 */5 * * * *', {
    name: 'AdHocReaperService_reapOrphans',
    waitForCompletion: true,
  })
  async handleReapOrphans(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'AdHocReaperService_reapOrphans',
      () => this.reapOrphanedEvents(),
    );
  }

  /** Find and finalize all orphaned ad-hoc events. */
  async reapOrphanedEvents(): Promise<void> {
    const orphans = await findOrphanedAdHocEvents(this.db);
    if (orphans.length === 0) return;
    this.logger.warn(`Found ${orphans.length} orphaned ad-hoc event(s)`);
    for (const event of orphans) {
      await this.reapSingleEvent(event);
    }
  }

  /** Force-finalize a single orphaned event. */
  private async reapSingleEvent(
    event: typeof schema.events.$inferSelect,
  ): Promise<void> {
    const now = new Date();
    const claimed = await forceClaimOrphanedEvent(this.db, event.id, now);
    if (!claimed) return;
    await this.participantService.finalizeAll(event.id);
    await setEventEndTime(this.db, event.id, claimed, now);
    this.gateway.emitStatusChange(event.id, 'ended');
    this.logger.warn(`Reaped orphaned ad-hoc event ${event.id}`);
  }
}
