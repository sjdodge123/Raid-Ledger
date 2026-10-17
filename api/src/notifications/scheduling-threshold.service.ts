/**
 * Cron service that notifies poll organizers when a scheduling poll
 * reaches its minimum vote threshold (ROK-1015).
 *
 * Every 5 minutes, finds polls where:
 *   - the effective threshold (minVoteThreshold, or the live match-member
 *     count when it is NULL — ROK-1632) is greater than zero
 *   - unique YES voter count >= that effective threshold
 *   - thresholdNotifiedAt IS NULL (not yet notified)
 *
 * Sends a one-time community_lineup notification to the poll creator, and
 * stamps thresholdNotifiedAt only once that send was accepted.
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

/**
 * Eligible-poll query.
 *
 * ROK-1617: the count is YES answers only. "Members have voted on your poll"
 * is an invitation to pick a time, so members who answered "that time does
 * not work" must not be what tips it over — three rejections and one yes is
 * not a poll ready for review. The count lives in ONE lateral subquery so the
 * message and the `>=` gate cannot drift apart.
 *
 * ROK-1632: `min_vote_threshold` is written by the standalone-poll path only,
 * so a lineup-born match carries NULL and the old `IS NOT NULL` gate made its
 * creator DM impossible. NULL therefore means "every current member", resolved
 * as a LIVE count of `community_lineup_match_members` — members can still be
 * added after the poll is created (`SchedulingAddMembersAction`), so a
 * threshold frozen at insert time would go stale while a live count cannot.
 * Explicit thresholds are untouched. The effective value lives in the `eff`
 * lateral and is both the gate and the "N of M" in the message.
 */
const ELIGIBLE_POLLS_QUERY = sql`
  SELECT
    m.id AS "matchId",
    m.lineup_id AS "lineupId",
    m.game_id AS "gameId",
    g.name AS "gameName",
    l.created_by AS "creatorId",
    eff.min_votes::int AS "minVoteThreshold",
    tally.yes_voters::int AS "uniqueVoterCount"
  FROM community_lineup_matches m
  JOIN community_lineups l ON l.id = m.lineup_id
  JOIN games g ON g.id = m.game_id
  CROSS JOIN LATERAL (
    SELECT COUNT(DISTINCT v.user_id) AS yes_voters
    FROM community_lineup_schedule_votes v
    JOIN community_lineup_schedule_slots s ON s.id = v.slot_id
    WHERE s.match_id = m.id
      AND v.stance = 'yes'
  ) tally
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      m.min_vote_threshold,
      (
        SELECT COUNT(*)
        FROM community_lineup_match_members mm
        WHERE mm.match_id = m.id
      )
    ) AS min_votes
  ) eff
  WHERE m.threshold_notified_at IS NULL
    AND m.status = 'scheduling'
    AND eff.min_votes > 0
    AND tally.yes_voters >= eff.min_votes
`;

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
    await this.cronJobService.executeWithTracking(
      'SchedulingThresholdService_checkThresholds',
      () => this.checkThresholds(),
    );
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

  /** Polls that have met their effective threshold and were never notified. */
  private async findEligiblePolls(): Promise<EligiblePollRow[]> {
    return (await this.db.execute(
      ELIGIBLE_POLLS_QUERY,
    )) as unknown as EligiblePollRow[];
  }

  /**
   * Send the notification, then stamp thresholdNotifiedAt.
   *
   * ROK-1632: the stamp is a receipt for an ACCEPTED send. Stamping after a
   * throw filtered the poll out of every later sweep, so one transient
   * failure lost the creator's DM forever — on a throw we log and leave the
   * column NULL so the next tick retries. A `create` that RESOLVES has
   * decided the outcome (it returns null when the creator's preferences
   * suppress the category) and stamps like any other success; re-querying a
   * poll whose recipient opted out would loop every 5 minutes forever.
   */
  private async notifyAndStamp(poll: EligiblePollRow): Promise<void> {
    try {
      await this.notificationService.create(buildThresholdNotification(poll));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Notification failed for match ${poll.matchId}: ${msg} — ` +
          'leaving threshold_notified_at NULL so the next tick retries',
      );
      return;
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
