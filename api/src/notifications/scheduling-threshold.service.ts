/**
 * Cron service that notifies poll organizers when a scheduling poll
 * reaches its minimum vote threshold (ROK-1015).
 *
 * Every 5 minutes, finds polls where:
 *   - minVoteThreshold IS NOT NULL
 *   - unique voter count >= minVoteThreshold
 *   - thresholdNotifiedAt IS NULL (not yet notified)
 *
 * Sends a one-time community_lineup notification to the poll creator.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { NotificationService } from './notification.service';
import {
  buildThresholdNotification,
  type EligiblePollRow,
} from './scheduling-threshold.helpers';

@Injectable()
export class SchedulingThresholdService {
  private readonly logger = new Logger(SchedulingThresholdService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly cronJobService: CronJobService,
  ) {}

  /**
   * Cron handler: check for polls meeting their vote threshold.
   * Runs every 5 minutes.
   */
  @Cron('0 */5 * * * *', {
    name: 'SchedulingThresholdService_checkThresholds',
  })
  async handleCheck(): Promise<void> {
    try {
      await this.cronJobService.executeWithTracking(
        'SchedulingThresholdService_checkThresholds',
        () => this.checkThresholds(),
      );
    } catch {
      // Swallow errors — cron is fire-and-forget. Prevents deadlocks
      // with integration test table truncation from crashing the scheduler.
    }
  }

  /** Core logic: find eligible polls and notify creators. */
  async checkThresholds(): Promise<void> {
    const polls = await this.findEligiblePolls();
    if (polls.length === 0) return;
    this.logger.log(`Found ${polls.length} poll(s) meeting threshold`);
    for (const poll of polls) {
      await this.notifyAndStamp(poll);
    }
  }

  /** Query for polls that have met their threshold but not yet notified. */
  private async findEligiblePolls(): Promise<EligiblePollRow[]> {
    try {
      return (await this.db.execute(sql`
      SELECT
        m.id AS "matchId",
        m.lineup_id AS "lineupId",
        m.game_id AS "gameId",
        g.name AS "gameName",
        l.created_by AS "creatorId",
        m.min_vote_threshold AS "minVoteThreshold",
        (
          SELECT COUNT(DISTINCT v.user_id)
          FROM community_lineup_schedule_votes v
          JOIN community_lineup_schedule_slots s ON s.id = v.slot_id
          WHERE s.match_id = m.id
        )::int AS "uniqueVoterCount"
      FROM community_lineup_matches m
      JOIN community_lineups l ON l.id = m.lineup_id
      JOIN games g ON g.id = m.game_id
      WHERE m.min_vote_threshold IS NOT NULL
        AND m.threshold_notified_at IS NULL
        AND m.status = 'scheduling'
        AND (
          SELECT COUNT(DISTINCT v2.user_id)
          FROM community_lineup_schedule_votes v2
          JOIN community_lineup_schedule_slots s2 ON s2.id = v2.slot_id
          WHERE s2.match_id = m.id
        ) >= m.min_vote_threshold
    `)) as unknown as EligiblePollRow[];
    } catch {
      return [];
    }
  }

  /** Send notification and stamp thresholdNotifiedAt (idempotent). */
  private async notifyAndStamp(poll: EligiblePollRow): Promise<void> {
    try {
      await this.notificationService.create(buildThresholdNotification(poll));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Notification failed for match ${poll.matchId}: ${msg}`);
    }
    await this.stampNotified(poll.matchId);
  }

  /** Mark a poll as notified so it won't be processed again. */
  private async stampNotified(matchId: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE community_lineup_matches
      SET threshold_notified_at = NOW()
      WHERE id = ${matchId}
    `);
  }
}
