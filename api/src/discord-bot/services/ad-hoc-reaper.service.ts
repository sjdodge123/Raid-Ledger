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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  LFG_EVENTS,
  type LfgGroupChangedPayload,
} from '../../lfg/lfg.constants';
import { lfgSpawnedEventGameId } from '../lfg-now/lfg-now.db-helpers';
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
    private readonly eventEmitter: EventEmitter2,
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
    await this.announceLfgSessionEnd(event.id);
    this.logger.warn(`Reaped orphaned ad-hoc event ${event.id}`);
  }

  /**
   * ROK-1494 Q4 — tell LFG that a spawned session has ended.
   *
   * `finalizeAll` is a single bulk UPDATE that deliberately bypasses
   * `markLeave`, so no `PARTICIPANT_LEFT` fires and the LFG surfaces never
   * learn the session is over: the forum post reads `PLAYING NOW · N in voice`
   * forever and its `lfg_group_messages` row stays `open`, which holds the game
   * hostage to `uq_lfg_group_messages_game_open` — that game can then never
   * post another LFM message. This is the one emit that closes the loop.
   *
   * `'converted'` with the event as its own target is chosen because it is the
   * existing vocabulary that produces the CONVERTED terminal render, closes the
   * row and archives the thread. Nothing new was added to the reason set.
   *
   * Emitted AFTER the end has been written, and never allowed to throw: this
   * runs inside a cron sweep, and one unreachable game must not stop the rest
   * of the orphans from being reaped.
   *
   * @param eventId - The event that was just ended.
   */
  private async announceLfgSessionEnd(eventId: number): Promise<void> {
    try {
      const gameId = await lfgSpawnedEventGameId(this.db, eventId);
      if (gameId === null) return; // Not LFG-born: nothing subscribes.
      this.eventEmitter.emit(LFG_EVENTS.GROUP_CHANGED, {
        gameId,
        reason: 'converted',
        eventId,
      } satisfies LfgGroupChangedPayload);
    } catch (err) {
      this.logger.warn(
        `Could not tell LFG that session ${eventId} ended: ${String(err)}. ` +
          'Its group message will be closed by the next reconcile.',
      );
    }
  }
}
